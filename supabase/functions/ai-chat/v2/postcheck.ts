/**
 * ai-chat/v2/postcheck.ts — T7: the default post-check PORT — checks on the STRUCTURE of Stage B's
 * reply, the ONE regeneration, the code-authored fallbacks and the mandatory code lines LAST
 * (AI_MIMARI_V2 §3.2 T7, §7.1, §7.2, §5.2). ports.ts wires it as V2Deps.postcheck.
 *
 *   1. Suggestion invariant (§7.1 öneri değişmezi): every suggested food's (allergens ∪ may_contain ∪
 *      name-dictionary tags) ∩ the user's SEVERE allergens (severe, unknown, 'moderate' = defaulted,
 *      anything not explicitly mild) = ∅, and every suggested exercise's (loads ∪ name dictionary) ∩
 *      injured regions = ∅ — shared/safety-invariants.ts, the dictionaries only ADD hits. A spine that
 *      could not be read makes any suggestion list unverifiable: no list goes out (fail-closed).
 *      A TAG hit (the model's own allergens / may_contain / loads) always blocks. A hit only the NAME
 *      dictionary makes while the tags are clean (isNameOnlyViolation) is blind to negation — live
 *      2026-10-12, a regen named its dish "… deniz ürünü olmadan" and got a code refusal — so it is
 *      sent to the judge, with the matched word named and an id (n1, n2…), and the judge returns a
 *      verdict PER ITEM (strict schema, name_only[]). Only an item the judge explicitly calls an
 *      exclusion / absent mention (excluded_mention) is cleared; touches, unsure, a missing or
 *      duplicated-and-conflicting verdict, an item the judge also lists as a violation, a failed judge —
 *      all stay a hard block. The overall 'clean' verdict never clears a name-only hit by itself
 *      (pre-retrial #3 review: "karides güveç" with allergens: [] would otherwise pass on a judge that
 *      erred once). Clears are logged per attempt (log.name_only_cleared) and as their own issue code.
 *   2. Prose judge (§7.2 nesir yargıcı): for a user with a severe constraint, an independent
 *      gpt-6-luna strict-schema call reads the prose for a food/exercise the lists missed (the hidden
 *      allergen: "mayonezli sandviç" with nothing in suggested_foods). Fail-closed: a judge error,
 *      timeout, refusal or malformed answer counts as a violation.
 *   3. On a violation: ONE regeneration naming the excluded items; if that still fails (or cannot
 *      run), a code-authored safe fallback that suggests nothing, names only the constraints of what
 *      was withheld (food → allergens, exercise → injuries) and keeps every other notice. Two
 *      consecutive turns never get the same fallback sentence.
 *   4. Mandatory lines (guarantees.ts mandatoryLines — the SAME function the handler runs again after
 *      any port, so nothing here is the only place a safety line lives): 112 / specialist referral,
 *      the KVKK erase outcome, the allergen-exposure acknowledgement, every safety-hold question.
 *
 * Reads the coach's reply and structured data only — never the user's message (§2 rule 2).
 *
 * Latency (§3.3, §7.2): the whole T6+T7 run has ONE budget (budgets.ts: 6 s on the protective path,
 * 25 s otherwise) covering the coach, the judge and the regen; `remainingMs` reports what is left.
 * A judge that cannot run inside it counts as failed (fail-closed) and a regen that cannot start
 * goes straight to the fallback — on the protective path the ready-made safety reply.
 *
 * Judge scope, a cost/latency decision (§3.3). 'always' (the default; eval, tests): EVERY reply with
 * prose of a severe-constraint user is judged. Production runs 'suggestions' (LIVE_JUDGE_SCOPE,
 * live.ts; the 2026-10-12 re-trial fix round: p50 13–14 s, the judge + its regen on the critical
 * path of every turn, a motivation reply with no food in it regenerated): the judge runs
 * when the reply carries a suggestion list, when Stage A read the message as one that asks for
 * advice (a question, a "yesem?", a plan — the model's reading, not a keyword), or when the prose
 * NAMES one of the user's own allergens / a move loading an injured region (the dictionaries, add-
 * only: they can trigger a judge call, never clear anything). What it gives up: a food suggested in
 * the prose of a report/chat reply, missing from the lists, whose name carries no dictionary word —
 * the constitution's "every suggestion goes into the list" is then the only protection. The
 * structural invariant, the name-only hits, the fail-closed judge and every code-owned line are
 * unchanged. log.judge records 'skipped' per attempt, so the shadow sees how often it ran.
 */
import type { CoachInput, CoachReply, CoachRun, PostcheckLog, PostcheckOutcome, PostcheckOutput, PostcheckRequest, RegenNote } from './contracts.ts';
import { MIN_COACH_CALL_MS, MIN_JUDGE_CALL_MS, withinBudget } from './budgets.ts';
import { vocabLabel } from './facts.ts';
import {
  failedReplyFor, hasSuggestions, mandatoryLines, regionLabel, requiredCategories, safeFallbackReply, type SafetyProfile, safetyProfileOf,
  suggestionCheck, unverifiedFallbackReply, withCodeNotes,
} from './guarantees.ts';
import { isNameOnlyViolation, proseDictionaryHits, type SuggestionViolation } from '../../shared/safety-invariants.ts';
import { hasRequiredSafetyLine } from '../../shared/safety-tripwires.ts';
import { MODELS, respond, type StructuredSchema, type Transport } from '../../shared/openai.ts';
import type { CodeNote } from '../../shared/v2-db-types.ts';

// The pure guarantees live in guarantees.ts (the handler's final step uses them too); re-exported
// here for the callers and tests that know them as the post-check's.
export {
  clarifyLine, mandatoryLines, RECEIPTS_BELOW_TR, rejectLine, replyAsksHold, SAFE_FALLBACK_VARIANTS, type SafetyProfile, safetyProfileOf,
  suggestionViolations, withCodeNotes,
} from './guarantees.ts';
export { MIN_COACH_CALL_MS, MIN_JUDGE_CALL_MS, withinBudget } from './budgets.ts';
export type { PostcheckLog, PostcheckOutcome, RegenNote } from './contracts.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── prose judge (gpt-6-luna, strict schema) ───────────────────────────────────────────────────────

export interface JudgeRequest {
  reply: string;
  suggested_foods: CoachReply['suggested_foods'];
  suggested_exercises: CoachReply['suggested_exercises'];
  profile: SafetyProfile;
  /**
   * Suggestions whose NAME carries a word the dictionary ties to one of the user's constraints while
   * their tags are clean (isNameOnlyViolation): the judge decides each one explicitly, by its id.
   */
  nameOnly?: NameOnlyHint[];
  /** What is left of the turn's budget for this call (postcheck also stops waiting at this point). */
  timeoutMs?: number;
}

/** One name-only suggestion the judge must decide (`id` = n1, n2… in the order of the reply's lists). */
export interface NameOnlyHint {
  id: string;
  name: string;
  constraints: string[];
}

export interface JudgeItem {
  name: string;
  kind: 'food' | 'exercise';
  constraint: string;
  reason: string;
}

/**
 * The judge's per-item verdict on a name-only suggestion. ONLY excluded_mention can clear it: the name
 * mentions the ingredient as removed / absent ("… olmadan", "-sız") and the rest does not touch it.
 */
export const NAME_ONLY_VERDICTS = ['excluded_mention', 'touches', 'unsure'] as const;
export interface JudgeNameOnlyVerdict {
  id: string;
  verdict: string;
}

export type JudgeOutcome =
  /** name_only absent = no per-item verdict was given: nothing is cleared (fail-closed). */
  | { status: 'ok'; violation: boolean; items: JudgeItem[]; name_only?: JudgeNameOnlyVerdict[]; ms: number }
  | { status: 'failed'; reason: string; ms: number };

/** Injected for tests; production uses lunaJudge(). */
export type ProseJudge = (req: JudgeRequest) => Promise<JudgeOutcome>;

export const JUDGE_SCHEMA: StructuredSchema = {
  // v2 (pre-retrial #3): name_only[] — one explicit verdict per AYRICA KARAR VER item, by id.
  name: 'kochko_judge_v2',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['violation', 'items', 'name_only'],
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
      name_only: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'verdict'],
          properties: {
            id: { type: 'string' },
            verdict: { type: 'string', enum: [...NAME_ONLY_VERDICTS] },
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
  '- Önerinin adı bir malzemenin çıkarıldığını söylüyorsa ("… olmadan", "-sız") o malzeme adına bakarak öneride sayılmaz; yemeğin geri kalanının kısıta dokunup dokunmadığına bak.',
  '- Emin değilsen violation = true; her ihlal için items listesine adını, türünü, hangi kısıta dokunduğunu ve tek cümlelik gerekçeyi yaz.',
  '- AYRICA KARAR VER altındaki HER öneri için name_only listesine kimliğiyle (n1, n2…) tek karar yaz: excluded_mention = ad o malzemeyi yalnızca çıkarılmış ya da olmayan olarak anıyor ve önerinin geri kalanı kısıta dokunmuyor; touches = öneri kısıta dokunuyor (adındaki malzeme gerçekten içinde); unsure = emin değilsin. AYRICA KARAR VER yoksa name_only boş kalır.',
].join('\n');

export function judgeUserText(r: JudgeRequest): string {
  const lines = ['KİŞİNİN KISITLARI'];
  if (r.profile.severeAllergens.length) lines.push(`- Ciddi alerjiler: ${[...new Set(r.profile.severeAllergens.map(vocabLabel))].join(', ')}`);
  if (r.profile.injuredRegions.length) lines.push(`- Sakat bölgeler: ${[...new Set(r.profile.injuredRegions.map(regionLabel))].join(', ')}`);
  if (r.profile.unlocated.length) lines.push(`- Bölgesi bilinmeyen sakatlık/ameliyat: ${r.profile.unlocated.join(', ')}`);
  lines.push('', 'KOÇUN ÖNERİ LİSTESİ (etiketlerle)');
  lines.push(`- Yiyecekler: ${r.suggested_foods.length ? r.suggested_foods.map((f) => `${f.name} [${[...f.allergens, ...f.may_contain].join(', ') || 'etiket yok'}]`).join('; ') : 'yok'}`);
  lines.push(`- Hareketler: ${r.suggested_exercises.length ? r.suggested_exercises.map((e) => `${e.name} [${e.loads.join(', ') || 'yük yok'}]`).join('; ') : 'yok'}`);
  if (r.nameOnly?.length) {
    lines.push('', 'AYRICA KARAR VER (her biri için name_only)');
    for (const n of r.nameOnly) {
      lines.push(`- ${n.id} · "${n.name}": adında ${n.constraints.join(', ')} ile ilgili bir sözcük geçiyor ama etiketleri temiz. Bu öneri o kısıta gerçekten dokunuyor mu, yoksa ad yalnızca çıkarılan bir malzemeyi mi anıyor?`);
    }
  }
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
      const r = await call<{ violation: boolean; items: JudgeItem[]; name_only?: JudgeNameOnlyVerdict[] }>({
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
      const nameOnly = Array.isArray(r.value.name_only)
        ? r.value.name_only.filter((n) => isRec(n) && typeof n.id === 'string' && typeof n.verdict === 'string')
        : [];
      return { status: 'ok', violation: r.value.violation === true || items.length > 0, items, name_only: nameOnly, ms };
    } catch (e) {
      return { status: 'failed', reason: ((e as Error)?.message ?? 'error').slice(0, 120), ms: Date.now() - started };
    }
  };
}

// ─── regen note ────────────────────────────────────────────────────────────────────────────────────

/** One label per allergen / region (a same-turn declaration is in the spine by id AND by its Turkish word). */
function violationWhy(v: SuggestionViolation): string {
  if (v.allergens.length) return `${[...new Set(v.allergens.map((a) => vocabLabel(a.allergen)))].join(', ')} alerjisi`;
  return `${[...new Set(v.injuries.map((i) => regionLabel(i.region)))].join(', ')} sakatlığı`;
}

/**
 * The coach SAID it included the referral but its text carries no 112 / referral line (shadow
 * triage only: the flag never suppresses the line — mandatoryLines appends it anyway).
 */
export function referralFlagMismatch(input: CoachInput, reply: CoachReply): boolean {
  return reply.referral_included === true && requiredCategories(input.tripwire).some((cat) => !hasRequiredSafetyLine(reply.reply ?? '', cat));
}

// ─── the T7 pipeline ───────────────────────────────────────────────────────────────────────────────

export function emptyPostcheckLog(outcome: PostcheckOutcome): PostcheckLog {
  return {
    outcome, invariant_hits: [], judge: [], judge_fail_reasons: [], regens: 0, budget_exhausted: false, referral_flag_mismatch: false, code_notes: [],
    name_only_hits: [], name_only_cleared: [], judge_items: [],
  };
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');

/**
 * The name-only suggestions the judge EXPLICITLY cleared, by name: every verdict it gave for the item's
 * id is excluded_mention (at least one), and it did not also list that suggestion as a violation. A
 * name that also belongs to an item that was not cleared stays blocked (two suggestions, one name).
 * Anything else — no verdict, touches, unsure, a failed judge — clears nothing.
 */
export function clearedNameOnly(hints: readonly NameOnlyHint[], judge: JudgeOutcome | null): Set<string> {
  if (!judge || judge.status !== 'ok') return new Set();
  const verdicts = judge.name_only ?? [];
  const cleared = new Set<string>();
  const blocked = new Set<string>();
  for (const h of hints) {
    const mine = verdicts.filter((v) => v.id === h.id);
    const ok = mine.length > 0 && mine.every((v) => v.verdict === 'excluded_mention') && !judge.items.some((i) => sameName(i.name, h.name));
    (ok ? cleared : blocked).add(h.name);
  }
  for (const n of blocked) cleared.delete(n);
  return cleared;
}

// ─── judge scope ───────────────────────────────────────────────────────────────────────────────────

export type JudgeScope = 'always' | 'suggestions';

/** What production runs (live.ts): see the header, "Judge scope". */
export const LIVE_JUDGE_SCOPE: JudgeScope = 'suggestions';

/** Stage A's reading of the message: does it ask for something a coach answers with advice? */
const ADVICE_INTENTS: ReadonlySet<string> = new Set(['question', 'hypothetical', 'plan']);

/**
 * Why a reply would be judged under 'suggestions' scope (null = it is not): it carries a suggestion
 * list ('lists'); Stage A read the message as a question, a "yesem?" or a plan ('asked' — the model's
 * reading, never a keyword); or the prose names one of the user's own allergens / a move loading an
 * injured region ('prose' — the dictionaries, which can only ADD this judge call). 'always' scope
 * judges every reply ('always').
 */
export function judgeReason(
  input: Pick<CoachInput, 'decision'>, reply: CoachReply, profile: SafetyProfile, scope: JudgeScope = 'always',
): 'always' | 'lists' | 'asked' | 'prose' | null {
  if (scope === 'always') return 'always';
  if (hasSuggestions(reply)) return 'lists';
  const d = input.decision;
  const intent = isRec(d.intent) && typeof d.intent.primary === 'string' ? d.intent.primary : null;
  const route = isRec(d.reply_route) ? d.reply_route.contract : null;
  if ((intent !== null && ADVICE_INTENTS.has(intent)) || isRec(d.simulation) || route === 'plan') return 'asked';
  const net = proseDictionaryHits(reply.reply, profile);
  return net.allergens.length + net.regions.length > 0 ? 'prose' : null;
}

/** What the name dictionary matched on a name-only hit, in the user's words (for the judge's question). */
function nameOnlyHint(v: SuggestionViolation, i: number): NameOnlyHint {
  return {
    id: `n${i + 1}`,
    name: v.name,
    constraints: [...new Set([...v.allergens.map((a) => vocabLabel(a.allergen)), ...v.injuries.map((i) => regionLabel(i.region))])],
  };
}

const clip = (s: unknown, max: number): string => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export interface PostcheckResult extends PostcheckOutput {
  /** reply.reply + the port's mandatory lines, appended last. */
  text: string;
  codeNotes: CodeNote[];
}

export interface PostcheckDeps {
  /**
   * One regeneration with the excluded items named (the coach port with a RegenNote), bounded by
   * `timeoutMs` (what is left of the turn's budget; undefined = no turn budget).
   */
  regen: (note: RegenNote, timeoutMs?: number) => Promise<CoachRun>;
  /** null = no judge configured; a severe-constraint reply then cannot be confirmed (fail-closed). */
  judge: ProseJudge | null;
  /**
   * 'always' (default): every reply of a severe-constraint user is judged. 'suggestions' (production,
   * LIVE_JUDGE_SCOPE): only a reply judgeReason() names — a suggestion list, a message Stage A read as
   * asking for advice, or prose naming the user's own constraint. A name-only hit is judged in either.
   */
  judgeScope?: JudgeScope;
  /**
   * Milliseconds left of the turn's ONE budget (coach + judge + regen). Undefined = unbounded.
   * ports.ts runStageB sets it: CRISIS_TIMEOUT_MS on the protective path (§7.2 "6 sn'yi aşarsa hazır cevap").
   */
  remainingMs?: () => number;
}

interface Check {
  /** The violations that block this reply: every tag hit, and the name-only hits the judge did not clear item by item. */
  violations: SuggestionViolation[];
  unverified: boolean;
  judge: JudgeOutcome | null;
  bad: boolean;
}

export async function postcheckReply(input: CoachInput, first: CoachRun, deps: PostcheckDeps): Promise<PostcheckResult> {
  const profile = safetyProfileOf(input.turnInput, input.decision);
  const log = emptyPostcheckLog('first');
  const crisis = input.tripwire.kind === 'protective' && input.tripwire.route === 'crisis';
  const remaining = deps.remainingMs ?? (() => Infinity);
  const failedJudge = (reason: string): JudgeOutcome => ({ status: 'failed', reason, ms: 0 });

  const runJudge = async (reply: CoachReply, hints: NameOnlyHint[]): Promise<JudgeOutcome> => {
    if (!deps.judge) return failedJudge('no_judge');
    const left = remaining();
    if (left < MIN_JUDGE_CALL_MS) {
      log.budget_exhausted = true;
      return failedJudge('budget_exhausted');
    }
    const req: JudgeRequest = {
      reply: reply.reply, suggested_foods: reply.suggested_foods, suggested_exercises: reply.suggested_exercises, profile,
      ...(hints.length ? { nameOnly: hints } : {}),
      ...(Number.isFinite(left) ? { timeoutMs: left } : {}),
    };
    // A judge that throws synchronously is a failed judge too (never an escape from "never throws").
    const call = Promise.resolve().then(() => deps.judge!(req)).catch((e) => failedJudge(((e as Error)?.message ?? 'error').slice(0, 120)));
    return await withinBudget(call, left, () => failedJudge('timeout'));
  };

  let attempt = 0;
  const check = async (reply: CoachReply): Promise<Check> => {
    attempt++;
    const structural = suggestionCheck(reply, profile);
    const all = !structural.ok && structural.reason === 'violation' ? structural.violations : [];
    const unverified = !structural.ok && structural.reason === 'unverified';
    // A tag hit is the model's own statement and blocks; a name-only hit is the judge's to decide, item by item.
    const tagHits = all.filter((v) => !isNameOnlyViolation(v));
    const nameOnly = all.filter(isNameOnlyViolation);
    const hints = nameOnly.map(nameOnlyHint);
    log.invariant_hits.push(tagHits.map((v) => v.name));
    log.name_only_hits!.push(nameOnly.map((v) => v.name));
    const judgeIt = !unverified && profile.needsJudge && !crisis && reply.reply.trim() !== ''
      && (nameOnly.length > 0 || judgeReason(input, reply, profile, deps.judgeScope ?? 'always') !== null);
    let judge: JudgeOutcome | null = null;
    if (judgeIt) {
      judge = await runJudge(reply, hints);
      log.judge.push(judge.status === 'failed' ? 'failed' : judge.violation ? 'violation' : 'clean');
      if (judge.status === 'failed') log.judge_fail_reasons.push(judge.reason);
      if (judge.status === 'ok' && judge.violation) {
        for (const i of judge.items) {
          log.judge_items!.push({ attempt, name: clip(i.name, 80), kind: clip(i.kind, 12), constraint: clip(i.constraint, 80), reason: clip(i.reason, 200) });
        }
      }
    } else {
      log.judge.push('skipped');
    }
    // Only the judge's explicit per-item exclusion verdict clears a name-only hit — never the overall 'clean'.
    const cleared = clearedNameOnly(hints, judge);
    log.name_only_cleared!.push(nameOnly.filter((v) => cleared.has(v.name)).map((v) => v.name));
    const violations = all.filter((v) => !(isNameOnlyViolation(v) && cleared.has(v.name)));
    const judgeClean = judge !== null && judge.status === 'ok' && !judge.violation;
    const judgeBad = judge !== null && !judgeClean;
    return { violations, unverified, judge, bad: unverified || violations.length > 0 || judgeBad };
  };

  // What the withheld suggestions were (food → allergens, exercise → injuries in the fallback's words).
  const kinds = new Set<'food' | 'exercise'>();
  const noteKinds = (c: Check, reply: CoachReply) => {
    for (const v of c.violations) kinds.add(v.kind);
    if (c.judge?.status === 'ok') for (const i of c.judge.items) if (i.kind === 'food' || i.kind === 'exercise') kinds.add(i.kind);
    // A failed judge names nothing: what the draft suggested is what was withheld.
    if (c.judge?.status === 'failed') {
      if (reply.suggested_foods.length) kinds.add('food');
      if (reply.suggested_exercises.length) kinds.add('exercise');
    }
  };

  const finish = (reply: CoachReply, outcome: PostcheckOutcome, codeAuthored: boolean): PostcheckResult => {
    const codeNotes = mandatoryLines(input, reply, { codeAuthored });
    log.outcome = outcome;
    log.code_notes = codeNotes.map((n) => n.kind);
    if (!codeAuthored) log.referral_flag_mismatch = referralFlagMismatch(input, reply);
    return { reply, text: withCodeNotes(reply.reply, codeNotes), codeNotes, codeAuthored, log };
  };
  // Code-authored: the protective path's ready-made safety reply, or the honest coach-failed line.
  const failedPath = (): PostcheckResult => finish(failedReplyFor(input), input.tripwire.kind === 'protective' ? 'crisis_canned' : 'coach_failed', true);

  if (first.status !== 'ok' || !first.reply) return failedPath();

  const c1 = await check(first.reply);
  if (!c1.bad) return finish(first.reply, 'first', false);
  // The spine could not be read: a regen cannot be verified either — no suggestion goes out.
  if (c1.unverified) {
    return input.tripwire.kind === 'protective' ? failedPath() : finish(unverifiedFallbackReply(input), 'safe_fallback', true);
  }
  noteKinds(c1, first.reply);

  // One entry per item: a name-only hit the judge then flagged is named by the structure and the judge.
  const seen = new Set<string>();
  const note: RegenNote = {
    excluded: [
      ...c1.violations.map((v) => ({ name: v.name, why: violationWhy(v) })),
      ...(c1.judge?.status === 'ok' ? c1.judge.items.map((i) => ({ name: i.name, why: i.reason || i.constraint })) : []),
    ].filter((x) => {
      const k = x.name.trim().toLocaleLowerCase('tr');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    judgeFailed: c1.judge?.status === 'failed',
  };
  const left = remaining();
  if (left < MIN_COACH_CALL_MS) {
    // No time for the ONE regen: straight to the fallback (never a late reply on the protective path).
    log.budget_exhausted = true;
  } else {
    log.regens = 1;
    // A regen that throws synchronously is a failed regen (never an escape from "never throws").
    const call = Promise.resolve().then(() => deps.regen(note, Number.isFinite(left) ? left : undefined)).catch(() => null);
    const second = await withinBudget<CoachRun | null>(call, left, () => null);
    if (second && second.status === 'ok' && second.reply) {
      const c2 = await check(second.reply);
      if (!c2.bad) return finish(second.reply, 'regen', false);
      noteKinds(c2, second.reply);
    }
  }
  // A protective (crisis/ED) turn falls back to its ready-made safety reply, never to a food fallback.
  if (input.tripwire.kind === 'protective') return failedPath();
  return finish(safeFallbackReply(input, profile, kinds), 'safe_fallback', true);
}

/** postcheckReply as the T7 PostcheckPort (ports.ts stageBPorts; live.ts passes LIVE_JUDGE_SCOPE). */
export function postcheckPort(deps: Pick<PostcheckDeps, 'judge' | 'judgeScope'>): (p: PostcheckRequest) => Promise<PostcheckOutput> {
  return (p) => postcheckReply(p.input, p.first, { ...deps, regen: p.regen, remainingMs: p.remainingMs });
}
