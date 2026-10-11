/**
 * ai-chat/v2/guarantees.ts — what CODE guarantees about the reply, whatever Stage B and whatever T7
 * port produced it (AI_MIMARI_V2 §3.2 T7, §5.2, §5.3, §7.1, §7.2). Pure: no I/O, no model.
 *
 * The handler calls applyGuarantees after ANY PostcheckPort, as the FINAL step before the envelope:
 *
 *   1. The suggestion invariant, re-checked on STRUCTURE (suggested_foods / suggested_exercises tags ∪
 *      the name dictionaries ∩ severe allergens / injured regions = ∅, the user's spine plus this
 *      turn's own protective declarations). A reply that still violates it — or carries suggestions
 *      while the spine could not be read — does not go out: the code-authored safe fallback does
 *      (on the protective path: today's ready-made safety reply). The default port (postcheck.ts)
 *      already enforces this with its ONE regen; this re-check only fires when a port did not.
 *   2. The code-owned lines, appended LAST and only when missing, never removing a character:
 *        112 / specialist referral when the tripwire resolution demands it (safetyLines: judged by the
 *        TEXT — the code-owned 112 line itself, never a mere "112" — and never by the model's
 *        referral_included flag) · the KVKK erase outcome · the allergen-exposure
 *        acknowledgement · EVERY safety hold's template question (on a normal turn; on a safety turn
 *        the hold waits and expires unconfirmed — no allergy-removal question next to a crisis reply).
 *      A code-authored reply also gets the reject reasons first and, when no safety hold is asked,
 *      the turn's one ordinary hold question or the clarify question (nobody else will ask them).
 *
 * The same mandatoryLines() is what postcheck.ts appends itself, so with the default port step 2
 * adds nothing (each line is checked against the text INCLUDING the port's notes); with a port that
 * drops a line, step 2 puts it back. The presence checks err toward "missing": a false "missing"
 * costs one appended line, a false "present" would drop protection.
 *
 * No regex (arch-guard G13): index scans and the shared, tested helpers.
 */
import type { CoachInput, CoachReply, CoachTurnOutput, PostcheckOutput, TripwireResolution, V2Hold } from './contracts.ts';
import { isSafetyHold, opTitle, orderHolds, vocabLabel } from './facts.ts';
import { turnRefs, type TurnInput } from './input.ts';
import { quoteLine } from './stage-a-request.ts';
import {
  allergenSpine, checkSuggestionInvariants, injuredRegionsFromSpine, type SpineRow, type SuggestionViolation, unlocatedInjuries,
} from '../../shared/safety-invariants.ts';
import { hasRequiredSafetyLine, REQUIRED_SAFETY_LINE, type SafetyCategory } from '../../shared/safety-tripwires.ts';
import { buildSupplementAllergenLine, replyWarnsAboutExposure } from '../../shared/supplement-allergens.ts';
import type { CodeNote, CodeNoteKind } from '../../shared/v2-db-types.ts';
import { BODY_PARTS } from '../../shared/write-registry/vocab.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── the user's safety profile (spine ∪ this turn's protective declarations) ──────────────────────

export interface SafetyProfile {
  /** Allergen subjects that block a suggestion (everything not explicitly mild). */
  severeAllergens: string[];
  injuredRegions: string[];
  /** Injury/surgery rows with no usable region — only the prose judge can protect these. */
  unlocated: string[];
  /** A severe constraint exists → the prose judge runs (§7.2 (a)). */
  needsJudge: boolean;
  /** The constraints section could not be read: an empty list would read as "no allergy" (fail-closed). */
  unknown: boolean;
}

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
    unknown: ti.load_errors.some((e) => e.section === 'constraints'),
  };
}

export function hasSuggestions(reply: Pick<CoachReply, 'suggested_foods' | 'suggested_exercises'>): boolean {
  return (reply.suggested_foods?.length ?? 0) + (reply.suggested_exercises?.length ?? 0) > 0;
}

export function suggestionViolations(reply: CoachReply, profile: SafetyProfile): SuggestionViolation[] {
  return checkSuggestionInvariants(
    { foods: reply.suggested_foods ?? [], exercises: reply.suggested_exercises ?? [] },
    { severeAllergens: profile.severeAllergens, injuredRegions: profile.injuredRegions },
  );
}

export type SuggestionCheck =
  | { ok: true }
  | { ok: false; reason: 'violation'; violations: SuggestionViolation[] }
  | { ok: false; reason: 'unverified' };

/**
 * §7.1 on structure: suggestions with no severe-allergen / injured-region hit pass; suggestions while
 * the spine is unreadable are unverifiable (no list goes out — fail-closed). No suggestions: nothing
 * to check here (the prose is the judge's, postcheck.ts).
 */
export function suggestionCheck(reply: CoachReply, profile: SafetyProfile): SuggestionCheck {
  if (!hasSuggestions(reply)) return { ok: true };
  if (profile.unknown) return { ok: false, reason: 'unverified' };
  const violations = suggestionViolations(reply, profile);
  return violations.length > 0 ? { ok: false, reason: 'violation', violations } : { ok: true };
}

// ─── code-authored replies ─────────────────────────────────────────────────────────────────────────

export function regionLabel(id: string): string {
  return (BODY_PARTS as Record<string, string>)[id] ?? id;
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

/** The spine could not be read: say THAT, not a clash nobody checked. */
export const SUGGESTION_UNVERIFIED_LINE = 'Önerilerimi şu an kayıtlı kısıtlarına göre kontrol edemediğim için paylaşmıyorum; birkaç dakika sonra tekrar sorarsan bakarım.';

function lastAssistant(input: CoachInput): string {
  for (let i = input.history.length - 1; i >= 0; i--) if (input.history[i].role === 'assistant') return input.history[i].content ?? '';
  return '';
}

/**
 * A code-authored reply. It never carries memory[]: a draft that failed the safety check (or never
 * arrived) is not a source of durable notes about the person.
 */
export function emptyReply(text: string): CoachReply {
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

function withLead(input: CoachInput, text: string): CoachReply {
  const lead = receiptsLead(input);
  return emptyReply(lead ? `${lead} ${text}` : text);
}

export function safeFallbackReply(input: CoachInput, profile: SafetyProfile): CoachReply {
  const c = constraintPhrase(profile);
  const first = SAFE_FALLBACK_VARIANTS[0](c);
  return withLead(input, lastAssistant(input).includes(first) ? SAFE_FALLBACK_VARIANTS[1](c) : first);
}

export function unverifiedFallbackReply(input: CoachInput): CoachReply {
  return withLead(input, SUGGESTION_UNVERIFIED_LINE);
}

/** Stage B produced nothing usable on a normal turn: an honest line, the receipts speak for the writes. */
export const COACH_UNAVAILABLE_TR = 'Şu an cevabımı toparlayamadım; birkaç saniye sonra yeniden yazarsan kaldığımız yerden devam ederiz.';

export function coachFailedReply(input: CoachInput): CoachReply {
  const any = input.commit.receipts.length > 0;
  return emptyReply(any ? `${RECEIPTS_BELOW_TR} ${COACH_UNAVAILABLE_TR}` : COACH_UNAVAILABLE_TR);
}

/** The protective path's ready-made safety reply (§7.2: Stage B failed or was late). */
export function protectiveFallbackReply(t: Extract<TripwireResolution, { kind: 'protective' }>): CoachReply {
  return { ...emptyReply(t.fallback.message), referral_included: true };
}

/** Stage B (or its post-check) gave nothing usable: the ready-made safety reply, or the honest code line. */
export function failedReplyFor(input: CoachInput): CoachReply {
  return input.tripwire.kind === 'protective' ? protectiveFallbackReply(input.tripwire) : coachFailedReply(input);
}

// ─── the code-owned lines ──────────────────────────────────────────────────────────────────────────

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
  if (!isRec(c)) return null;
  const topic = typeof c.topic === 'string' ? quoteLine(c.topic, 160).trim() : '';
  if (topic === '') return null;
  const refs = turnRefs(input.turnInput).rendered;
  const cands = (Array.isArray(c.candidate_refs) ? c.candidate_refs : [])
    .map((r) => (typeof r === 'string' ? refs[r]?.user_summary_tr ?? refs[r]?.summary_tr : null))
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => quoteLine(s, 80));
  const bare = topic.endsWith('?') || topic.endsWith('.') ? topic.slice(0, -1).trimEnd() : topic;
  return `Devam etmeden önce netleştirmem gereken bir şey var: ${bare}${cands.length ? ` (${cands.join(' / ')})` : ''}. Kısaca yazar mısın?`;
}

export function exposureLine(e: CoachInput['commit']['exposures'][number], severe: boolean): string {
  // A same-turn declaration puts both its id and its Turkish word in the spine ('sesame', 'susam'):
  // one label each, never "susam, susam".
  const labels = [...new Set(e.allergens.map(vocabLabel))];
  if (e.source === 'supplement') {
    return buildSupplementAllergenLine({ item: 'kaydettiğin takviye', allergens: labels, sources: labels, possible: false, severe, source_hint: null });
  }
  const what = severe ? `ciddi ${labels.join(', ')} alerjisi` : `${labels.join(', ')} hassasiyeti`;
  const urgent = severe ? " Kaşıntı, şişlik ya da nefes darlığı olursa hemen 112'yi ara." : '';
  return `⚠️ Dikkat: profilinde ${what} kayıtlı ve kaydettiğin öğün ${labels.join(', ')} içeriyor. Kaydettim; kendini nasıl hissettiğini takip et.${urgent}`;
}

/** The safety categories whose 112 / referral line this turn's resolution demands. */
export function requiredCategories(t: TripwireResolution): SafetyCategory[] {
  if (t.kind === 'protective') return [...new Set([t.category, ...t.categories])];
  if (t.kind === 'fallback' || t.kind === 'canned') return [t.category];
  return [];
}

/** reply + notes, joined the way chat_messages.content stores them (model text, then code notes). */
export function withCodeNotes(reply: string, notes: readonly CodeNote[]): string {
  return [(reply ?? '').trim(), ...notes.map((n) => n.text)].filter((s) => s !== '').join('\n\n');
}

/**
 * THE 112 / referral lines this tripwire resolution demands and `text` still lacks, in order, each
 * judged against the text INCLUDING the lines added before it. The ONE source of these lines:
 * mandatoryLines (T7) and the handler's crash path (honestCrashResponse, where no T7 ran) both call
 * it, so a protective turn carries the same code-owned line whichever way it ends.
 * Presence is judged by the TEXT (shared/safety-tripwires.ts hasRequiredSafetyLine: the code-owned
 * 112 line itself, never a mere "112"; a referral that is not waved away), never by the coach's
 * referral_included flag (§7.2 "kod garanti eder").
 */
export function safetyLines(t: TripwireResolution, text: string): CodeNote[] {
  const out: CodeNote[] = [];
  let acc = text ?? '';
  const addIfMissing = (cat: SafetyCategory, line: string) => {
    if (hasRequiredSafetyLine(acc, cat)) return;
    out.push({ kind: cat === 'emergency' ? 'emergency' : 'referral', text: line });
    acc = `${acc}\n\n${line}`;
  };
  if (t.kind === 'protective') {
    for (const cat of requiredCategories(t)) addIfMissing(cat, cat === t.category ? t.required_line : REQUIRED_SAFETY_LINE[cat]);
  } else if (t.kind === 'fallback' || t.kind === 'canned') {
    addIfMissing(t.category, t.kind === 'fallback' && t.mode === 'append' ? t.response.message : REQUIRED_SAFETY_LINE[t.category]);
  }
  return out;
}

/**
 * The code lines this reply still needs, in order, each judged against the text INCLUDING `existing`
 * notes and the lines added before it:
 *   (code-authored reply, normal turn) the reject reasons — facts, not safety lines, so they go first
 *   112 / referral → the KVKK erase outcome → allergen exposure → every safety hold's question →
 *   (code-authored, normal turn, no safety hold) the turn's one ordinary hold question, else the
 *   clarify question
 * so the mandatory safety lines stay LAST. `codeAuthored` = the reply is a fallback written by code.
 */
export function mandatoryLines(
  input: CoachInput, reply: CoachReply, opts: { codeAuthored?: boolean; existing?: readonly CodeNote[] } = {},
): CodeNote[] {
  const existing = opts.existing ?? [];
  const notes: CodeNote[] = [];
  let text = withCodeNotes(reply.reply ?? '', existing);
  // A code-authored fallback names the user's allergies to explain a withheld suggestion; that is not
  // an acknowledgement of THIS turn's exposure, so only the coach's own words and code lines count.
  let ackText = [opts.codeAuthored ? '' : (reply.reply ?? ''), ...existing.map((n) => n.text)].join('\n\n');
  const add = (kind: CodeNoteKind, line: string) => {
    notes.push({ kind, text: line });
    text = `${text}\n\n${line}`;
    ackText = `${ackText}\n\n${line}`;
  };
  const t = input.tripwire;
  const normal = t.kind === 'normal';

  // The coach tells the rejects in its own words from the facts; a code-authored reply cannot, so the
  // reasons are stated here (a red badge alone says nothing). Never next to a safety reply.
  if (opts.codeAuthored && normal) {
    for (const r of input.commit.rejects) {
      const line = rejectLine(r);
      if (!text.includes(line)) add('other', line);
    }
  }

  // The 112 / referral line (safetyLines: the code-owned line, judged by the TEXT, never the flag).
  for (const n of safetyLines(t, text)) add(n.kind, n.text);

  // The KVKK erase outcome is a fact the code owns (erase-hold.ts lines), never the model's claim.
  for (const r of input.commit.receipts) {
    if (r.legacy_type === 'data_erase_confirm' && r.ok && r.user_line && !text.includes(r.user_line)) add('other', r.user_line);
  }

  const severe = new Set(safetyProfileOf(input.turnInput, input.decision).severeAllergens.map((s) => s.toLocaleLowerCase('tr')));
  for (const e of input.commit.exposures) {
    const isSevere = e.allergens.some((a) => severe.has(a.toLocaleLowerCase('tr')) || severe.has(vocabLabel(a).toLocaleLowerCase('tr')));
    const labels = e.allergens.map(vocabLabel);
    const line = exposureLine(e, isSevere);
    const probe = { item: e.ref, allergens: [...e.allergens, ...labels], sources: labels, possible: false, severe: isSevere };
    if (!text.includes(line) && !replyWarnsAboutExposure(ackText, probe)) add('allergen_exposure', line);
  }

  // Holds: never on a safety turn (crisis, ED, emergency) — the hold waits and expires unconfirmed,
  // which changes nothing. On a normal turn EVERY safety hold's template question (facts.ts tells the
  // coach code appends it); a code-authored reply also asks the one ordinary question (nobody else will).
  if (normal) {
    const ordered = orderHolds(input.commit.holds);
    const safety = ordered.filter(isSafetyHold);
    for (const h of safety) {
      if (h.question_tr && !replyAsksHold(text, h)) add('safety_hold', h.question_tr);
    }
    if (opts.codeAuthored && safety.length === 0) {
      const h = ordered[0];
      if (h && h.question_tr) {
        if (!replyAsksHold(text, h)) add('other', h.question_tr);
      } else {
        const q = clarifyLine(input);
        if (q && !text.includes(q)) add('other', q);
      }
    }
  }
  return notes;
}

// ─── the final step ────────────────────────────────────────────────────────────────────────────────

export interface GuaranteedReply extends CoachTurnOutput {
  codeAuthored: boolean;
  /** The lines THIS step added (a port that kept its contract leaves it nothing to add). */
  added: CodeNote[];
  /** ai_turn_log issue codes ('guarantee_suggestion_violation', 'guarantee_line:safety_hold', …). */
  issues: string[];
}

const CODE_NOTE_KINDS: ReadonlySet<string> = new Set(['emergency', 'referral', 'allergen_exposure', 'safety_hold', 'plan_honesty', 'other']);

function isNote(n: unknown): n is CodeNote {
  return isRec(n) && typeof n.text === 'string' && n.text.trim() !== '' && typeof n.kind === 'string' && CODE_NOTE_KINDS.has(n.kind);
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A port's reply, read defensively (an injected port is validated, not trusted). null = unusable. */
function usableReply(v: unknown): CoachReply | null {
  if (!isRec(v) || typeof v.reply !== 'string' || v.reply.trim() === '') return null;
  return {
    reply: v.reply,
    suggested_foods: (Array.isArray(v.suggested_foods) ? v.suggested_foods : []).filter(isRec)
      .map((f) => ({ name: String(f.name ?? ''), allergens: strs(f.allergens), may_contain: strs(f.may_contain) })),
    suggested_exercises: (Array.isArray(v.suggested_exercises) ? v.suggested_exercises : []).filter(isRec)
      .map((e) => ({ name: String(e.name ?? ''), loads: strs(e.loads) })),
    memory: Array.isArray(v.memory) ? v.memory : [],
    ui: v.ui ?? null,
    referral_included: v.referral_included === true,
    why: typeof v.why === 'string' && v.why.trim() !== '' ? v.why : null,
  };
}

/**
 * The handler's FINAL T7 step, after ANY post-check port: the suggestion invariant on structure, then
 * the code-owned lines appended LAST. Append-only: the port's text and notes are kept as they are; a
 * reply is replaced only when its suggestion lists break §7.1 (or it is unusable), by a code-authored
 * fallback that suggests nothing.
 */
export function applyGuarantees(
  input: CoachInput, out: PostcheckOutput | Pick<PostcheckOutput, 'reply' | 'codeNotes' | 'codeAuthored'> | null,
): GuaranteedReply {
  const issues: string[] = [];
  const notes = (Array.isArray(out?.codeNotes) ? out!.codeNotes : []).filter(isNote).map((n) => ({ kind: n.kind, text: n.text }));
  let reply = usableReply(out?.reply);
  let codeAuthored = out?.codeAuthored === true;
  if (!reply) {
    reply = failedReplyFor(input);
    codeAuthored = true;
    issues.push('guarantee_unusable_reply');
  }
  const profile = safetyProfileOf(input.turnInput, input.decision);
  const check = suggestionCheck(reply, profile);
  if (!check.ok) {
    issues.push(`guarantee_suggestion_${check.reason}`);
    reply = input.tripwire.kind === 'protective'
      ? protectiveFallbackReply(input.tripwire)
      : check.reason === 'unverified' ? unverifiedFallbackReply(input) : safeFallbackReply(input, profile);
    codeAuthored = true;
  }
  const added = mandatoryLines(input, reply, { codeAuthored, existing: notes });
  for (const n of added) issues.push(`guarantee_line:${n.kind}`);
  const codeNotes = [...notes, ...added];
  return { reply, text: withCodeNotes(reply.reply, codeNotes), codeNotes, codeAuthored, added, issues };
}
