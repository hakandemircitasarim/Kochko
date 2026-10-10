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
 *      line or any of the coach's sentences (§5.3).
 *
 * Reads the coach's reply and structured data only — never the user's message (§2 rule 2). The few
 * presence checks over the reply are substring tests that err toward "missing": a false "missing"
 * costs one appended line, a false "present" would drop protection.
 */
import type { CoachInput, CoachReply, V2Hold } from './contracts.ts';
import type { CoachRun } from './coach.ts';
import type { TurnInput } from './input.ts';
import { isSafetyHold, orderHolds, vocabLabel } from './facts.ts';
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
        timeoutMs: deps.timeoutMs ?? JUDGE_TIMEOUT_MS,
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

function emptyReply(text: string, memory: unknown[] = []): CoachReply {
  return { reply: text, suggested_foods: [], suggested_exercises: [], memory, ui: { navigate_to: null, task_completion_summary: null }, referral_included: false, why: null };
}

export function safeFallbackReply(input: CoachInput, profile: SafetyProfile, memory: unknown[] = []): CoachReply {
  const c = constraintPhrase(profile);
  const first = SAFE_FALLBACK_VARIANTS[0](c);
  const pick = lastAssistant(input).includes(first) ? SAFE_FALLBACK_VARIANTS[1](c) : first;
  const okWrites = input.commit.receipts.some((r) => r.ok);
  return emptyReply(okWrites ? `Bu turdaki kaydın yerinde. ${pick}` : pick, memory);
}

/** Stage B produced nothing usable on a normal turn: an honest line, the receipts speak for the writes. */
export const COACH_UNAVAILABLE_TR = 'Şu an cevabımı toparlayamadım; birkaç saniye sonra yeniden yazarsan kaldığımız yerden devam ederiz.';

export function coachFailedReply(input: CoachInput): CoachReply {
  const any = input.commit.receipts.length > 0;
  return emptyReply(any ? `Bu turdaki kayıtların durumunu aşağıda görebilirsin. ${COACH_UNAVAILABLE_TR}` : COACH_UNAVAILABLE_TR);
}

// ─── mandatory lines ───────────────────────────────────────────────────────────────────────────────

/** Lowercase, diacritics dropped (combining marks U+0300–U+036F), dotless ı → i. */
function fold(s: string): string {
  return [...(s ?? '').toLocaleLowerCase('tr').normalize('NFKD')]
    .filter((ch) => { const cp = ch.codePointAt(0) ?? 0; return cp < 0x300 || cp > 0x36f; })
    .join('')
    .replaceAll('ı', 'i');
}

/** Folded keyword stems that show the coach asked THIS hold (code-owned, per hold kind). */
const HOLD_KEYWORDS: Record<string, readonly string[]> = {
  constraint_retract: ['kaldir', 'sil', 'cikar'],
  iki_adimli_kaldirma: ['kaldir', 'sil', 'cikar'],
  data_erase_request: ['sil'],
  account_erase_request: ['sil'],
  kvkk_onay: ['sil'],
  goal_set: ['hedef'],
  hedef_degisiyor: ['hedef'],
  target_change: ['kalori', 'aralig', 'program', 'baslat'],
  bant_degisimi: ['kalori', 'aralig', 'program', 'baslat'],
};

/**
 * Did the reply ask this hold's question? It must contain a question mark AND either the template
 * itself or one of the hold's keyword stems. Errs toward "not asked" (then the template is added).
 */
export function replyAsksHold(reply: string, h: V2Hold): boolean {
  if (!reply.includes('?')) return false;
  const r = fold(reply);
  if (h.question_tr && r.includes(fold(h.question_tr))) return true;
  const keys = [...(HOLD_KEYWORDS[h.reason_code] ?? []), ...(HOLD_KEYWORDS[h.op] ?? [])];
  return keys.some((k) => r.includes(k));
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

/**
 * The code lines this reply still needs, in order (referral/112 → exposure → hold question), each
 * judged against the text INCLUDING the lines added before it. `codeAuthored` = the reply is a
 * fallback written by code: then an ordinary hold's question is added too (nobody else will ask it).
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

  // 112 is a literal requirement (the number in the text); an ED referral may be confirmed by the
  // coach's own structured flag (the constitution promises that flag prevents a duplicate line).
  const need = (cat: SafetyCategory): boolean =>
    cat === 'ed' ? !(reply.referral_included || hasRequiredSafetyLine(text, 'ed')) : !hasRequiredSafetyLine(text, cat);
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
  // hold the coach did not ask, or when the reply is code-authored (nobody else will ask it). Never on
  // a safety turn (crisis, ED, emergency): the hold waits and expires unconfirmed, which changes nothing.
  const h = t.kind === 'normal' ? orderHolds(input.commit.holds)[0] : undefined;
  if (h && h.question_tr && (isSafetyHold(h) || opts.codeAuthored) && !replyAsksHold(text, h)) {
    add(isSafetyHold(h) ? 'safety_hold' : 'other', h.question_tr);
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
  regens: number;
  code_notes: CodeNoteKind[];
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
  /** One regeneration with the excluded items named (coach.ts runCoach with a RegenNote). */
  regen: (note: RegenNote) => Promise<CoachRun>;
  /** null = no judge configured; a severe-constraint reply then cannot be confirmed (fail-closed). */
  judge: ProseJudge | null;
  /**
   * 'always' (default): every reply of a severe-constraint user is judged — the only reading of
   * "yemek ya da egzersiz adı geçen her cevap" that catches a food the lists missed. 'suggestions':
   * only replies with a non-empty suggestion list (latency escape hatch, weaker).
   */
  judgeScope?: 'always' | 'suggestions';
}

interface Check {
  violations: SuggestionViolation[];
  judge: JudgeOutcome | null;
  bad: boolean;
}

export async function postcheckReply(input: CoachInput, first: CoachRun, deps: PostcheckDeps): Promise<PostcheckResult> {
  const profile = safetyProfileOf(input.turnInput, input.decision);
  const log: PostcheckLog = { outcome: 'first', invariant_hits: [], judge: [], regens: 0, code_notes: [] };
  const crisis = input.tripwire.kind === 'protective' && input.tripwire.route === 'crisis';

  const check = async (reply: CoachReply): Promise<Check> => {
    const violations = suggestionViolations(reply, profile);
    log.invariant_hits.push(violations.map((v) => v.name));
    const hasSuggestions = reply.suggested_foods.length + reply.suggested_exercises.length > 0;
    const judgeIt = profile.needsJudge && !crisis && reply.reply.trim() !== ''
      && ((deps.judgeScope ?? 'always') === 'always' || hasSuggestions);
    let judge: JudgeOutcome | null = null;
    if (judgeIt) {
      judge = deps.judge
        ? await deps.judge({ reply: reply.reply, suggested_foods: reply.suggested_foods, suggested_exercises: reply.suggested_exercises, profile })
        : { status: 'failed', reason: 'no_judge', ms: 0 };
      log.judge.push(judge.status === 'failed' ? 'failed' : judge.violation ? 'violation' : 'clean');
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
    return { reply, text: withCodeNotes(reply.reply, codeNotes), codeNotes, log };
  };
  const failedPath = (memory: unknown[]): PostcheckResult => input.tripwire.kind === 'protective'
    ? finish({ ...emptyReply(input.tripwire.fallback.message, memory), referral_included: true }, 'crisis_canned', true)
    : finish({ ...coachFailedReply(input), memory }, 'coach_failed', true);

  if (first.status !== 'ok' || !first.reply) return failedPath([]);

  const c1 = await check(first.reply);
  if (!c1.bad) return finish(first.reply, 'first', false);

  const note: RegenNote = {
    excluded: [
      ...c1.violations.map((v) => ({ name: v.name, why: violationWhy(v) })),
      ...(c1.judge?.status === 'ok' ? c1.judge.items.map((i) => ({ name: i.name, why: i.reason || i.constraint })) : []),
    ],
    judgeFailed: c1.judge?.status === 'failed',
  };
  log.regens = 1;
  const second = await deps.regen(note);
  let memory = first.reply.memory;
  if (second.status === 'ok' && second.reply) {
    const c2 = await check(second.reply);
    if (!c2.bad) return finish(second.reply, 'regen', false);
    memory = second.reply.memory;
  }
  // A protective (crisis/ED) turn falls back to its ready-made safety reply, never to a food fallback.
  if (input.tripwire.kind === 'protective') return failedPath(memory);
  return finish(safeFallbackReply(input, profile, memory), 'safe_fallback', true);
}
