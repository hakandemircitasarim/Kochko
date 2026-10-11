/**
 * ai-chat/v2/postcheck.ts — T7: checks on the STRUCTURE of Stage B's reply, then the mandatory code
 * lines LAST (AI_MIMARI_V2 §3.2 T7, §7.1, §7.2, §5.2).
 *
 *   1. Suggestion invariant (§7.1 öneri değişmezi): every suggested food's (allergens ∪ may_contain ∪
 *      name-dictionary tags) ∩ the user's SEVERE allergens (severe, unknown, 'moderate' = defaulted,
 *      anything not explicitly mild) = ∅, and every suggested exercise's (loads ∪ name dictionary) ∩
 *      injured regions = ∅ — shared/safety-invariants.ts, the dictionaries only ADD hits.
 *   2. Prose judge (§7.2 nesir yargıcı): for a user with a severe constraint, an independent
 *      gpt-6-luna strict-schema call reads the prose for a food/exercise the lists missed (the hidden
 *      allergen: "mayonezli sandviç" with nothing in suggested_foods). Fail-closed: a judge error,
 *      timeout, refusal or malformed answer counts as a violation.
 *   3. On a violation: ONE regeneration naming the excluded items; if that still fails (or cannot
 *      run), a code-authored safe fallback that suggests nothing and keeps every other notice. Two
 *      consecutive turns never get the same fallback sentence.
 *   4. Mandatory lines, appended in this order and only when missing — 112 / specialist referral when
 *      the tripwire resolution demands it, the allergen-exposure acknowledgement, the safety-hold
 *      question. Each is a CodeNote (chat_messages.code_notes); none deletes or rewrites another
 *      line or any of the coach's sentences (§5.3). A code-authored reply also gets the reject
 *      reasons (before the mandatory lines) and, when no hold is asked, the clarify question.
 *
 * Reads the coach's reply and structured data only — never the user's message (§2 rule 2). The
 * presence checks over the reply err toward "missing": a false "missing" costs one appended line, a
 * false "present" would drop protection. So a safety line is judged by the TEXT alone, never by a
 * model flag (referral_included is logged, not trusted), and a safety hold counts as asked only when
 * the reply carries its template question itself.
 *
 * Latency (§3.3, §7.2): the whole T6+T7 run has ONE budget (coach.ts: 6 s on the protective path,
 * 25 s otherwise) covering the coach, the judge and the regen; `remainingMs` reports what is left.
 * A judge that cannot run inside it counts as failed (fail-closed) and a regen that cannot start
 * goes straight to the fallback — on the protective path the ready-made safety reply.
 *
 * Deliberate cost/latency decision (§3.3): for a user with a severe constraint EVERY reply with
 * prose is judged (one gpt-6-luna call, ~0.5–1.5 s), not only replies whose lists are non-empty —
 * code has no food/exercise lexicon to tell "a food name appears" (§7.2 (a)), and the hidden
 * allergen the judge exists for is exactly the one no list or dictionary names. A luna outage
 * therefore turns these users' replies into the safe fallback (fail-closed); log.judge records every
 * failure so the shadow can alert on it. Narrowing this is a protection removal (§7: shadow proof).
 */
import type { CoachInput, CoachReply, V2Hold } from './contracts.ts';
import type { CoachRun } from './coach.ts';
import { isSafetyHold, opTitle, orderHolds, vocabLabel } from './facts.ts';
import { turnRefs, type TurnInput } from './input.ts';
import { quoteLine } from './stage-a-request.ts';
import {
  allergenSpine, checkSuggestionInvariants, injuredRegionsFromSpine, type SpineRow, type SuggestionViolation, unlocatedInjuries,
} from '../../shared/safety-invariants.ts';
import { hasRequiredSafetyLine, REQUIRED_SAFETY_LINE, type SafetyCategory } from '../../shared/safety-tripwires.ts';
import { buildSupplementAllergenLine, replyWarnsAboutExposure } from '../../shared/supplement-allergens.ts';
import { MODELS, respond, type StructuredSchema, type Transport } from '../../shared/openai.ts';
import type { CodeNote, CodeNoteKind } from '../../shared/v2-db-types.ts';
import { BODY_PARTS } from '../../shared/write-registry/vocab.ts';

// ─── the user's safety profile (spine ∪ this turn's protective declarations) ──────────────────────

export interface SafetyProfile {
  /** Allergen subjects that block a suggestion (everything not explicitly mild). */
  severeAllergens: string[];
  injuredRegions: string[];
  /** Injury/surgery rows with no usable region — only the prose judge can protect these. */
  unlocated: string[];
  /** A severe constraint exists → the prose judge runs (§7.2 (a)). */
  needsJudge: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The spine rows of the TurnInput PLUS this turn's own protective declarations (constraint_add,
 * whose=self, polarity=has) whatever their commit outcome: protection is never deferred by a hold or
 * a quote check (§5, §7.4). A retraction never relaxes anything within the turn.
 */
export function safetyProfileOf(ti: TurnInput, decision: CoachInput['decision'] | null = null): SafetyProfile {
  const rows: SpineRow[] = ti.constraints.map((c) => ({ kind: c.kind, subject: c.subject, severity: c.severity, body_parts: c.body_parts }));
  for (const w of Array.isArray(decision?.writes) ? decision!.writes! : []) {
    if (!isRec(w) || w.op !== 'constraint_add' || w.whose !== 'self' || w.polarity !== 'has') continue;
    const severity = typeof w.severity === 'string' ? w.severity : null;
    const body_parts = Array.isArray(w.body_parts) ? w.body_parts.filter((p): p is string => typeof p === 'string') : [];
    for (const subject of new Set([w.subject_id, w.display_tr].filter((s): s is string => typeof s === 'string' && s.trim() !== ''))) {
      rows.push({ kind: String(w.kind), subject, severity, body_parts });
    }
  }
  const severeAllergens = allergenSpine(rows).severe;
  const injuredRegions = injuredRegionsFromSpine(rows);
  const unlocated = unlocatedInjuries(rows).map((r) => String(r.subject ?? r.kind ?? 'sakatlık'));
  return {
    severeAllergens, injuredRegions, unlocated,
    needsJudge: severeAllergens.length > 0 || injuredRegions.length > 0 || unlocated.length > 0,
  };
}

export function suggestionViolations(reply: CoachReply, profile: SafetyProfile): SuggestionViolation[] {
  return checkSuggestionInvariants(
    { foods: reply.suggested_foods, exercises: reply.suggested_exercises },
    { severeAllergens: profile.severeAllergens, injuredRegions: profile.injuredRegions },
  );
}

// ─── prose judge (gpt-6-luna, strict schema) ───────────────────────────────────────────────────────

export interface JudgeRequest {
  reply: string;
  suggested_foods: CoachReply['suggested_foods'];
  suggested_exercises: CoachReply['suggested_exercises'];
  profile: SafetyProfile;
  /** What is left of the turn's budget for this call (postcheck also stops waiting at this point). */
  timeoutMs?: number;
}

export interface JudgeItem {
  name: string;
  kind: 'food' | 'exercise';
  constraint: string;
  reason: string;
}

export type JudgeOutcome =
  | { status: 'ok'; violation: boolean; items: JudgeItem[]; ms: number }
  | { status: 'failed'; reason: string; ms: number };

/** Injected for tests; production uses lunaJudge(). */
export type ProseJudge = (req: JudgeRequest) => Promise<JudgeOutcome>;

export const JUDGE_SCHEMA: StructuredSchema = {
  name: 'kochko_judge_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['violation', 'items'],
    properties: {
      violation: { type: 'boolean' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'kind', 'constraint', 'reason'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['food', 'exercise'] },
            constraint: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
};

export const JUDGE_INSTRUCTIONS = [
  'Bir sağlık koçluğu uygulamasında bağımsız güvenlik denetçisisin. Koçun cevabını yalnızca okursun, yeniden yazmazsın.',
  'Tek soruya cevap ver: cevap, kişinin aşağıdaki kısıtlarından birine dokunan bir yiyeceği ya da hareketi ÖNERİYOR mu?',
  '- Yiyecek: kısıttaki alerjeni içeren ya da içerebilecek her şey (sos, hamur, kaplama, yağ, çapraz bulaşma riski yüksek yemekler dahil). Önerilen öğünün malzemelerini düşün; adında alerjen geçmese de içinde olabilir.',
  '- Hareket: sakat bölgeye yük bindiren her şey. Bölgesi bilinmeyen sakatlıkta yük bindiren her hareketi şüpheli say.',
  '- Yalnızca ÖNERİ sayılır: kişinin yediğini anmak, bir yiyeceğin alerjen içerdiği için önerilmediğini söylemek ya da kaçınılacaklar listesi vermek öneri değildir.',
  '- Emin değilsen violation = true; her ihlal için items listesine adını, türünü, hangi kısıta dokunduğunu ve tek cümlelik gerekçeyi yaz.',
].join('\n');

function judgeUserText(r: JudgeRequest): string {
  const lines = ['KİŞİNİN KISITLARI'];
  if (r.profile.severeAllergens.length) lines.push(`- Ciddi alerjiler: ${r.profile.severeAllergens.map(vocabLabel).join(', ')}`);
  if (r.profile.injuredRegions.length) lines.push(`- Sakat bölgeler: ${r.profile.injuredRegions.map(regionLabel).join(', ')}`);
  if (r.profile.unlocated.length) lines.push(`- Bölgesi bilinmeyen sakatlık/ameliyat: ${r.profile.unlocated.join(', ')}`);
  lines.push('', 'KOÇUN ÖNERİ LİSTESİ (etiketlerle)');
  lines.push(`- Yiyecekler: ${r.suggested_foods.length ? r.suggested_foods.map((f) => `${f.name} [${[...f.allergens, ...f.may_contain].join(', ') || 'etiket yok'}]`).join('; ') : 'yok'}`);
  lines.push(`- Hareketler: ${r.suggested_exercises.length ? r.suggested_exercises.map((e) => `${e.name} [${e.loads.join(', ') || 'yük yok'}]`).join('; ') : 'yok'}`);
  lines.push('', 'KOÇUN CEVABI', r.reply);
  return lines.join('\n');
}

export const JUDGE_TIMEOUT_MS = 5_000;

/** The judge model: KOCHKO_MODEL_JUDGE, else the fast tier (gpt-6-luna by default). */
export function judgeModel(): string {
  let own = '';
  try { own = Deno.env.get('KOCHKO_MODEL_JUDGE') ?? ''; } catch { /* no env permission */ }
  return own.trim() || MODELS.fallback;
}

/** The production judge over shared/openai respond(). Never throws: every failure is 'failed'. */
export function lunaJudge(deps: {
  respond?: typeof respond; transport?: Transport; model?: string; timeoutMs?: number; apiKey?: string; baseUrl?: string;
} = {}): ProseJudge {
  const call = deps.respond ?? respond;
  return async (req) => {
    const started = Date.now();
    try {
      const r = await call<{ violation: boolean; items: JudgeItem[] }>({
        model: deps.model ?? judgeModel(),
        effort: 'low',
        input: [{ role: 'system', content: JUDGE_INSTRUCTIONS }, { role: 'user', content: judgeUserText(req) }],
        schema: JUDGE_SCHEMA,
        maxTokens: 600,
        store: false,
        timeoutMs: Math.max(1, Math.min(deps.timeoutMs ?? JUDGE_TIMEOUT_MS, req.timeoutMs ?? Infinity)),
        ...(deps.transport ? { transport: deps.transport } : {}),
        ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
        ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
      });
      const ms = Date.now() - started;
      if (r.kind !== 'parsed') return { status: 'failed', reason: r.kind === 'error' ? r.error.class : r.kind, ms };
      const items = Array.isArray(r.value.items) ? r.value.items.filter((i) => isRec(i) && typeof i.name === 'string') : [];
      return { status: 'ok', violation: r.value.violation === true || items.length > 0, items, ms };
    } catch (e) {
      return { status: 'failed', reason: ((e as Error)?.message ?? 'error').slice(0, 120), ms: Date.now() - started };
    }
  };
}

// ─── regen note + fallbacks ────────────────────────────────────────────────────────────────────────

/** What the ONE regeneration is told (coach.ts renders it as a closing system message). */
export interface RegenNote {
  excluded: { name: string; why: string }[];
  /** The judge could not confirm the previous draft (fail-closed): no item names to give. */
  judgeFailed: boolean;
}

function regionLabel(id: string): string {
  return (BODY_PARTS as Record<string, string>)[id] ?? id;
}

function violationWhy(v: SuggestionViolation): string {
  if (v.allergens.length) return `${v.allergens.map((a) => vocabLabel(a.allergen)).join(', ')} alerjisi`;
  return `${v.injuries.map((i) => regionLabel(i.region)).join(', ')} sakatlığı`;
}

function constraintPhrase(p: SafetyProfile): string {
  const bits: string[] = [];
  if (p.severeAllergens.length) bits.push(`${p.severeAllergens.map(vocabLabel).join(', ')} alerjin`);
  if (p.injuredRegions.length) bits.push(`${p.injuredRegions.map(regionLabel).join(', ')} sakatlığın`);
  if (!p.injuredRegions.length && p.unlocated.length) bits.push('sakatlığın');
  return bits.join(' ve ') || 'kısıtların';
}

/** Two wordings: the same fallback sentence never appears in two consecutive replies (§7.1). */
export const SAFE_FALLBACK_VARIANTS = [
  (c: string) => `Bu kez sana bir öneri vermiyorum: aklımdaki seçenekleri ${c} açısından güvenle doğrulayamadım. Elindeki seçenekleri ya da gittiğin yeri yazarsan, içeriklerine birlikte tek tek bakalım.`,
  (c: string) => `Önerebileceğim seçenekler ${c} ile çakışma riski taşıdığı için şimdilik öneri listesi çıkarmıyorum. Hangi seçenekler arasında kaldığını söylersen, her birini birlikte kontrol edelim.`,
] as const;

function lastAssistant(input: CoachInput): string {
  for (let i = input.history.length - 1; i >= 0; i--) if (input.history[i].role === 'assistant') return input.history[i].content ?? '';
  return '';
}

/**
 * A code-authored reply. It never carries memory[]: a draft that failed the safety check (or never
 * arrived) is not a source of durable notes about the person.
 */
function emptyReply(text: string): CoachReply {
  return { reply: text, suggested_foods: [], suggested_exercises: [], memory: [], ui: { navigate_to: null, task_completion_summary: null }, referral_included: false, why: null };
}

/** The receipts line of a code-authored reply: "in place" only when EVERY write of the turn landed. */
export const RECEIPTS_BELOW_TR = 'Bu turdaki kayıtların durumunu aşağıda görebilirsin.';

function receiptsLead(input: CoachInput): string {
  const rs = input.commit.receipts;
  if (rs.length === 0) return '';
  if (rs.every((r) => r.ok)) return rs.length === 1 ? 'Bu turdaki kaydın yerinde.' : 'Bu turdaki kayıtların yerinde.';
  return RECEIPTS_BELOW_TR;
}

export function safeFallbackReply(input: CoachInput, profile: SafetyProfile): CoachReply {
  const c = constraintPhrase(profile);
  const first = SAFE_FALLBACK_VARIANTS[0](c);
  const pick = lastAssistant(input).includes(first) ? SAFE_FALLBACK_VARIANTS[1](c) : first;
  const lead = receiptsLead(input);
  return emptyReply(lead ? `${lead} ${pick}` : pick);
}

/** Stage B produced nothing usable on a normal turn: an honest line, the receipts speak for the writes. */
export const COACH_UNAVAILABLE_TR = 'Şu an cevabımı toparlayamadım; birkaç saniye sonra yeniden yazarsan kaldığımız yerden devam ederiz.';

export function coachFailedReply(input: CoachInput): CoachReply {
  const any = input.commit.receipts.length > 0;
  return emptyReply(any ? `${RECEIPTS_BELOW_TR} ${COACH_UNAVAILABLE_TR}` : COACH_UNAVAILABLE_TR);
}

// ─── mandatory lines ───────────────────────────────────────────────────────────────────────────────

/** Lowercase, diacritics dropped (combining marks U+0300–U+036F), dotless ı → i. */
function fold(s: string): string {
  return [...(s ?? '').toLocaleLowerCase('tr').normalize('NFKD')]
    .filter((ch) => { const cp = ch.codePointAt(0) ?? 0; return cp < 0x300 || cp > 0x36f; })
    .join('')
    .replaceAll('ı', 'i');
}

/** fold() + every run of whitespace as one space (index scans: ai-chat/v2 carries no regex, G13). */
function foldSpaced(s: string): string {
  let out = '';
  let space = false;
  for (const ch of fold(s)) {
    const ws = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch.codePointAt(0) === 0xa0;
    if (ws) { space = out !== ''; continue; }
    if (space) out += ' ';
    space = false;
    out += ch;
  }
  return out;
}

/**
 * Did the reply ask this hold's question? Only when it carries the hold's TEMPLATE question itself
 * (case, diacritics and spacing aside). No keyword guess: "nasılsın?" contains "sil", "kaç kalori
 * aldın?" contains "kalori" — a stem match would let a KVKK erase or an allergy removal lapse without
 * the user ever being asked (§5.2, §7.1). A false "not asked" costs one appended line.
 */
export function replyAsksHold(reply: string, h: V2Hold): boolean {
  const q = foldSpaced(h.question_tr ?? '');
  return q !== '' && foldSpaced(reply ?? '').includes(q);
}

/** A reject the code tells in its own words when the reply is code-authored (nobody else will). */
export function rejectLine(r: CoachInput['commit']['rejects'][number]): string {
  const why = (r.reason_tr ?? '').trim();
  const end = why.endsWith('.') || why.endsWith('!') || why.endsWith('?') ? '' : '.';
  return `${opTitle(r.op)} kaydedilmedi: ${why || 'denetimden geçmedi'}${end}`;
}

/** The clarify question of a code-authored reply: the topic Stage A named, with what each candidate is. */
export function clarifyLine(input: CoachInput): string | null {
  const c = input.decision.clarify;
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null;
  const rec = c as Record<string, unknown>;
  const topic = typeof rec.topic === 'string' ? quoteLine(rec.topic, 160).trim() : '';
  if (topic === '') return null;
  const refs = turnRefs(input.turnInput).rendered;
  const cands = (Array.isArray(rec.candidate_refs) ? rec.candidate_refs : [])
    .map((r) => (typeof r === 'string' ? refs[r]?.summary_tr : null))
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => quoteLine(s, 80));
  const bare = topic.endsWith('?') || topic.endsWith('.') ? topic.slice(0, -1).trimEnd() : topic;
  return `Devam etmeden önce netleştirmem gereken bir şey var: ${bare}${cands.length ? ` (${cands.join(' / ')})` : ''}. Kısaca yazar mısın?`;
}

function exposureLine(e: CoachInput['commit']['exposures'][number], severe: boolean): string {
  const labels = e.allergens.map(vocabLabel);
  if (e.source === 'supplement') {
    return buildSupplementAllergenLine({ item: 'kaydettiğin takviye', allergens: labels, sources: labels, possible: false, severe, source_hint: null });
  }
  const what = severe ? `ciddi ${labels.join(', ')} alerjisi` : `${labels.join(', ')} hassasiyeti`;
  const urgent = severe ? " Kaşıntı, şişlik ya da nefes darlığı olursa hemen 112'yi ara." : '';
  return `⚠️ Dikkat: profilinde ${what} kayıtlı ve kaydettiğin öğün ${labels.join(', ')} içeriyor. Kaydettim; kendini nasıl hissettiğini takip et.${urgent}`;
}

/** The safety categories whose 112 / referral line this turn's resolution demands. */
function requiredCategories(t: CoachInput['tripwire']): SafetyCategory[] {
  if (t.kind === 'protective') return [...new Set([t.category, ...t.categories])];
  if (t.kind === 'fallback' || t.kind === 'canned') return [t.category];
  return [];
}

/**
 * The coach SAID it included the referral but its text carries no 112 / referral line (shadow
 * triage only: the flag never suppresses the line — mandatoryLines appends it anyway).
 */
export function referralFlagMismatch(input: CoachInput, reply: CoachReply): boolean {
  return reply.referral_included === true && requiredCategories(input.tripwire).some((cat) => !hasRequiredSafetyLine(reply.reply ?? '', cat));
}

/**
 * The code lines this reply still needs, in order, each judged against the text INCLUDING the lines
 * added before it:
 *   (code-authored reply, normal turn) the reject reasons — facts, not safety lines, so they go first
 *   112 / referral → allergen exposure → the turn's ONE question (the hold; for a code-authored reply
 *   with no hold to ask, the clarify question)
 * so the mandatory safety lines stay LAST. `codeAuthored` = the reply is a fallback written by code:
 * then an ordinary hold's question is added too (nobody else will ask it).
 */
export function mandatoryLines(input: CoachInput, reply: CoachReply, opts: { codeAuthored?: boolean } = {}): CodeNote[] {
  const notes: CodeNote[] = [];
  let text = reply.reply ?? '';
  // A code-authored fallback names the user's allergies to explain a withheld suggestion; that is not
  // an acknowledgement of THIS turn's exposure, so only the coach's own words (and lines added here) count.
  let ackText = opts.codeAuthored ? '' : text;
  const add = (kind: CodeNoteKind, line: string) => {
    notes.push({ kind, text: line });
    text = `${text}\n\n${line}`;
    ackText = `${ackText}\n\n${line}`;
  };
  const t = input.tripwire;

  // The coach told the rejects in its own words from the facts; a code-authored reply cannot, so the
  // reasons are stated here (a red badge alone says nothing). Never next to a safety reply.
  if (opts.codeAuthored && t.kind === 'normal') {
    for (const r of input.commit.rejects) add('other', rejectLine(r));
  }

  // The 112 / referral line is guaranteed by the TEXT: 112 literally, a referral by hasRequiredSafetyLine.
  // The coach's referral_included flag is never trusted for a safety line (§7.2 "kod garanti eder").
  const need = (cat: SafetyCategory): boolean => !hasRequiredSafetyLine(text, cat);
  if (t.kind === 'protective') {
    for (const cat of t.categories) {
      if (need(cat)) add(cat === 'emergency' ? 'emergency' : 'referral', cat === t.category ? t.required_line : REQUIRED_SAFETY_LINE[cat]);
    }
  } else if (t.kind === 'fallback' || t.kind === 'canned') {
    if (need(t.category)) add(t.category === 'emergency' ? 'emergency' : 'referral', t.kind === 'fallback' && t.mode === 'append' ? t.response.message : REQUIRED_SAFETY_LINE[t.category]);
  }

  const severe = new Set(safetyProfileOf(input.turnInput, input.decision).severeAllergens.map((s) => s.toLocaleLowerCase('tr')));
  for (const e of input.commit.exposures) {
    const isSevere = e.allergens.some((a) => severe.has(a.toLocaleLowerCase('tr')) || severe.has(vocabLabel(a).toLocaleLowerCase('tr')));
    const labels = e.allergens.map(vocabLabel);
    const probe = { item: e.ref, allergens: [...e.allergens, ...labels], sources: labels, possible: false, severe: isSevere };
    if (!replyWarnsAboutExposure(ackText, probe)) add('allergen_exposure', exposureLine(e, isSevere));
  }

  // The turn's ONE hold question (facts.ts orderHolds: safety holds first) — added when it is a safety
  // hold whose template the reply does not carry (facts.ts tells the coach code appends it), or when the
  // reply is code-authored (nobody else will ask it). Never on a safety turn (crisis, ED, emergency):
  // the hold waits and expires unconfirmed, which changes nothing.
  const h = t.kind === 'normal' ? orderHolds(input.commit.holds)[0] : undefined;
  if (h && h.question_tr && (isSafetyHold(h) || opts.codeAuthored)) {
    if (!replyAsksHold(text, h)) add(isSafetyHold(h) ? 'safety_hold' : 'other', h.question_tr);
  } else if (opts.codeAuthored && t.kind === 'normal') {
    // No hold to ask: a code-authored reply still asks what Stage A needed clarified (one question).
    const q = clarifyLine(input);
    if (q) add('other', q);
  }
  return notes;
}

/** reply + notes, joined the way chat_messages.content stores them (model text, then code notes). */
export function withCodeNotes(reply: string, notes: readonly CodeNote[]): string {
  return [reply.trim(), ...notes.map((n) => n.text)].filter((s) => s !== '').join('\n\n');
}

// ─── the T7 pipeline ───────────────────────────────────────────────────────────────────────────────

export type PostcheckOutcome = 'first' | 'regen' | 'safe_fallback' | 'crisis_canned' | 'coach_failed';

export interface PostcheckLog {
  outcome: PostcheckOutcome;
  /** Names the suggestion invariant excluded, per attempt. */
  invariant_hits: string[][];
  /** Judge result per attempt ('skipped' when the user has no severe constraint). */
  judge: ('skipped' | 'clean' | 'violation' | 'failed')[];
  /** Why each failed judge call failed ('timeout', 'budget_exhausted', 'no_judge', an error class …). */
  judge_fail_reasons: string[];
  regens: number;
  /** The turn's budget ran out before a judge or the regen could start (the fallback went out). */
  budget_exhausted: boolean;
  /** The coach set referral_included but its text had no 112/referral line (code appended it). */
  referral_flag_mismatch: boolean;
  code_notes: CodeNoteKind[];
}

export function emptyPostcheckLog(outcome: PostcheckOutcome): PostcheckLog {
  return { outcome, invariant_hits: [], judge: [], judge_fail_reasons: [], regens: 0, budget_exhausted: false, referral_flag_mismatch: false, code_notes: [] };
}

/** Do not start a (re)generation with less than this left of the turn's budget: it could not finish. */
export const MIN_COACH_CALL_MS = 2_000;
/** Do not start a judge call with less than this left: the reply then counts as unconfirmed (fail-closed). */
export const MIN_JUDGE_CALL_MS = 750;

/**
 * `p`, or `late()` once `ms` have passed — whichever comes first — so a callee that ignores its own
 * timeout still cannot stretch the turn. An infinite `ms` means no bound. The timer is always cleared.
 */
export async function withinBudget<T>(p: Promise<T>, ms: number, late: () => T): Promise<T> {
  if (!Number.isFinite(ms)) return await p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(late()), Math.max(0, ms)); });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

export interface PostcheckResult {
  /** The reply that goes out (the model's, the regen's, or a code-authored fallback). */
  reply: CoachReply;
  /** reply.reply + the mandatory lines, appended last. */
  text: string;
  codeNotes: CodeNote[];
  log: PostcheckLog;
}

export interface PostcheckDeps {
  /**
   * One regeneration with the excluded items named (coach.ts runCoach with a RegenNote), bounded by
   * `timeoutMs` (what is left of the turn's budget; undefined = no turn budget).
   */
  regen: (note: RegenNote, timeoutMs?: number) => Promise<CoachRun>;
  /** null = no judge configured; a severe-constraint reply then cannot be confirmed (fail-closed). */
  judge: ProseJudge | null;
  /**
   * 'always' (default): every reply of a severe-constraint user is judged — the only reading of
   * "yemek ya da egzersiz adı geçen her cevap" that catches a food the lists missed. 'suggestions':
   * only replies with a non-empty suggestion list (latency escape hatch, weaker).
   */
  judgeScope?: 'always' | 'suggestions';
  /**
   * Milliseconds left of the turn's ONE budget (coach + judge + regen). Undefined = unbounded.
   * coach.ts sets it: CRISIS_TIMEOUT_MS on the protective path (§7.2 "6 sn'yi aşarsa hazır cevap").
   */
  remainingMs?: () => number;
}

interface Check {
  violations: SuggestionViolation[];
  judge: JudgeOutcome | null;
  bad: boolean;
}

export async function postcheckReply(input: CoachInput, first: CoachRun, deps: PostcheckDeps): Promise<PostcheckResult> {
  const profile = safetyProfileOf(input.turnInput, input.decision);
  const log = emptyPostcheckLog('first');
  const crisis = input.tripwire.kind === 'protective' && input.tripwire.route === 'crisis';
  const remaining = deps.remainingMs ?? (() => Infinity);
  const failedJudge = (reason: string): JudgeOutcome => ({ status: 'failed', reason, ms: 0 });

  const runJudge = async (reply: CoachReply): Promise<JudgeOutcome> => {
    if (!deps.judge) return failedJudge('no_judge');
    const left = remaining();
    if (left < MIN_JUDGE_CALL_MS) {
      log.budget_exhausted = true;
      return failedJudge('budget_exhausted');
    }
    const req: JudgeRequest = {
      reply: reply.reply, suggested_foods: reply.suggested_foods, suggested_exercises: reply.suggested_exercises, profile,
      ...(Number.isFinite(left) ? { timeoutMs: left } : {}),
    };
    const call = deps.judge(req).catch((e) => failedJudge(((e as Error)?.message ?? 'error').slice(0, 120)));
    return await withinBudget(call, left, () => failedJudge('timeout'));
  };

  const check = async (reply: CoachReply): Promise<Check> => {
    const violations = suggestionViolations(reply, profile);
    log.invariant_hits.push(violations.map((v) => v.name));
    const hasSuggestions = reply.suggested_foods.length + reply.suggested_exercises.length > 0;
    const judgeIt = profile.needsJudge && !crisis && reply.reply.trim() !== ''
      && ((deps.judgeScope ?? 'always') === 'always' || hasSuggestions);
    let judge: JudgeOutcome | null = null;
    if (judgeIt) {
      judge = await runJudge(reply);
      log.judge.push(judge.status === 'failed' ? 'failed' : judge.violation ? 'violation' : 'clean');
      if (judge.status === 'failed') log.judge_fail_reasons.push(judge.reason);
    } else {
      log.judge.push('skipped');
    }
    const judgeBad = judge !== null && (judge.status === 'failed' || judge.violation);
    return { violations, judge, bad: violations.length > 0 || judgeBad };
  };

  const finish = (reply: CoachReply, outcome: PostcheckOutcome, codeAuthored: boolean): PostcheckResult => {
    const codeNotes = mandatoryLines(input, reply, { codeAuthored });
    log.outcome = outcome;
    log.code_notes = codeNotes.map((n) => n.kind);
    if (!codeAuthored) log.referral_flag_mismatch = referralFlagMismatch(input, reply);
    return { reply, text: withCodeNotes(reply.reply, codeNotes), codeNotes, log };
  };
  // Code-authored: the protective path's ready-made safety reply, or the honest coach-failed line.
  const failedPath = (): PostcheckResult => input.tripwire.kind === 'protective'
    ? finish({ ...emptyReply(input.tripwire.fallback.message), referral_included: true }, 'crisis_canned', true)
    : finish(coachFailedReply(input), 'coach_failed', true);

  if (first.status !== 'ok' || !first.reply) return failedPath();

  const c1 = await check(first.reply);
  if (!c1.bad) return finish(first.reply, 'first', false);

  const note: RegenNote = {
    excluded: [
      ...c1.violations.map((v) => ({ name: v.name, why: violationWhy(v) })),
      ...(c1.judge?.status === 'ok' ? c1.judge.items.map((i) => ({ name: i.name, why: i.reason || i.constraint })) : []),
    ],
    judgeFailed: c1.judge?.status === 'failed',
  };
  const left = remaining();
  if (left < MIN_COACH_CALL_MS) {
    // No time for the ONE regen: straight to the fallback (never a late reply on the protective path).
    log.budget_exhausted = true;
  } else {
    log.regens = 1;
    const call = deps.regen(note, Number.isFinite(left) ? left : undefined).catch(() => null);
    const second = await withinBudget<CoachRun | null>(call, left, () => null);
    if (second && second.status === 'ok' && second.reply) {
      const c2 = await check(second.reply);
      if (!c2.bad) return finish(second.reply, 'regen', false);
    }
  }
  // A protective (crisis/ED) turn falls back to its ready-made safety reply, never to a food fallback.
  if (input.tripwire.kind === 'protective') return failedPath();
  return finish(safeFallbackReply(input, profile), 'safe_fallback', true);
}
