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
 *   2. Prose judge (§7.2 nesir yargıcı): for a user with a severe constraint, an independent
 *      gpt-6-luna strict-schema call reads the prose for a food/exercise the lists missed (the hidden
 *      allergen: "mayonezli sandviç" with nothing in suggested_foods). Fail-closed: a judge error,
 *      timeout, refusal or malformed answer counts as a violation.
 *   3. On a violation: ONE regeneration naming the excluded items; if that still fails (or cannot
 *      run), a code-authored safe fallback that suggests nothing and keeps every other notice. Two
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
 * Deliberate cost/latency decision (§3.3): for a user with a severe constraint EVERY reply with
 * prose is judged (one gpt-6-luna call, ~0.5–1.5 s), not only replies whose lists are non-empty —
 * code has no food/exercise lexicon to tell "a food name appears" (§7.2 (a)), and the hidden
 * allergen the judge exists for is exactly the one no list or dictionary names. A luna outage
 * therefore turns these users' replies into the safe fallback (fail-closed); log.judge records every
 * failure so the shadow can alert on it. Narrowing this is a protection removal (§7: shadow proof).
 */
import type { CoachInput, CoachReply, CoachRun, PostcheckLog, PostcheckOutcome, PostcheckOutput, PostcheckRequest, RegenNote } from './contracts.ts';
import { MIN_COACH_CALL_MS, MIN_JUDGE_CALL_MS, withinBudget } from './budgets.ts';
import { vocabLabel } from './facts.ts';
import {
  failedReplyFor, mandatoryLines, regionLabel, requiredCategories, safeFallbackReply, type SafetyProfile, safetyProfileOf, suggestionCheck,
  unverifiedFallbackReply, withCodeNotes,
} from './guarantees.ts';
import type { SuggestionViolation } from '../../shared/safety-invariants.ts';
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
  return { outcome, invariant_hits: [], judge: [], judge_fail_reasons: [], regens: 0, budget_exhausted: false, referral_flag_mismatch: false, code_notes: [] };
}

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
   * 'always' (default): every reply of a severe-constraint user is judged — the only reading of
   * "yemek ya da egzersiz adı geçen her cevap" that catches a food the lists missed. 'suggestions':
   * only replies with a non-empty suggestion list (latency escape hatch, weaker).
   */
  judgeScope?: 'always' | 'suggestions';
  /**
   * Milliseconds left of the turn's ONE budget (coach + judge + regen). Undefined = unbounded.
   * ports.ts runStageB sets it: CRISIS_TIMEOUT_MS on the protective path (§7.2 "6 sn'yi aşarsa hazır cevap").
   */
  remainingMs?: () => number;
}

interface Check {
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
    // A judge that throws synchronously is a failed judge too (never an escape from "never throws").
    const call = Promise.resolve().then(() => deps.judge!(req)).catch((e) => failedJudge(((e as Error)?.message ?? 'error').slice(0, 120)));
    return await withinBudget(call, left, () => failedJudge('timeout'));
  };

  const check = async (reply: CoachReply): Promise<Check> => {
    const structural = suggestionCheck(reply, profile);
    const violations = !structural.ok && structural.reason === 'violation' ? structural.violations : [];
    const unverified = !structural.ok && structural.reason === 'unverified';
    log.invariant_hits.push(violations.map((v) => v.name));
    const hasSuggestions = reply.suggested_foods.length + reply.suggested_exercises.length > 0;
    const judgeIt = !unverified && profile.needsJudge && !crisis && reply.reply.trim() !== ''
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
    return { violations, unverified, judge, bad: unverified || violations.length > 0 || judgeBad };
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
    // A regen that throws synchronously is a failed regen (never an escape from "never throws").
    const call = Promise.resolve().then(() => deps.regen(note, Number.isFinite(left) ? left : undefined)).catch(() => null);
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

/** postcheckReply as the T7 PostcheckPort (ports.ts stageBPorts). */
export function postcheckPort(deps: Pick<PostcheckDeps, 'judge' | 'judgeScope'>): (p: PostcheckRequest) => Promise<PostcheckOutput> {
  return (p) => postcheckReply(p.input, p.first, { ...deps, regen: p.regen, remainingMs: p.remainingMs });
}
