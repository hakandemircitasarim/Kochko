/**
 * ai-chat/v2/ports.ts — the T6/T7/T8 seams of the v2 turn (AI_MIMARI_V2 §3.2): their production
 * implementations and the ONE T6+T7 orchestration the handler runs.
 *
 *   stageBPorts()   the ports V2Deps carries in production (live.ts) and in the end-to-end tests
 *                   (over a fake transport): coach = coach.ts runCoach (bounded), postcheck =
 *                   postcheck.ts postcheckReply (judge = gpt-6-luna over the same transport),
 *                   envelope = envelope.ts renderEnvelope. Types: contracts.ts.
 *   runStageB()     T6 + T7 under ONE end-to-end budget (budgets.ts coachTurnBudgetMs: 6 s on the
 *                   protective path, 25 s otherwise): the first generation, then the post-check port
 *                   (which may spend the ONE regen through the coach port). Every call gets only what
 *                   is left. A port that throws, hangs or answers nonsense never breaks the turn: the
 *                   code's own fallback (the ready-made safety reply on the protective path, the honest
 *                   "could not answer" line otherwise) stands in. It never throws.
 *   coachTurn()     runStageB with the production ports + guarantees.ts applyGuarantees — the whole
 *                   Stage B of a turn in one call (eval / shadow triage / tests).
 *
 * The handler runs runStageB and then ALWAYS applyGuarantees itself: the code-owned lines (112 /
 * referral, the KVKK erase outcome, the allergen-exposure acknowledgement, every safety-hold question)
 * do not depend on any port keeping its contract.
 */
import type {
  CoachInput, CoachPort, CoachRun, EnvelopePort, PostcheckLog, PostcheckOutput, PostcheckPort, RegenNote,
} from './contracts.ts';
import { coachTurnBudgetMs, POSTCHECK_GRACE_MS, withinBudget } from './budgets.ts';
import { coachModel, type CoachOptions, runCoachWithin } from './coach.ts';
import { renderEnvelope } from './envelope.ts';
import { applyGuarantees, emptyReply, failedReplyFor, type GuaranteedReply, mandatoryLines } from './guarantees.ts';
import { emptyPostcheckLog, lunaJudge, postcheckPort, type ProseJudge } from './postcheck.ts';
import type { respond, Transport } from '../../shared/openai.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

export interface StageBPorts {
  coach: CoachPort;
  postcheck: PostcheckPort;
  envelope: EnvelopePort;
}

export interface StageBPortOptions {
  /** Injected respond() / transport (tests, eval); production uses shared/openai.ts defaults. */
  respond?: typeof respond;
  transport?: Transport;
  apiKey?: string;
  baseUrl?: string;
  /** Stage B model override (default coach.ts coachModel: KOCHKO_MODEL_COACH, else terra). */
  model?: string;
  /** Registry capability list override (tests). */
  capabilities?: string;
  /** The §7.2 prose judge; default lunaJudge() over the same transport. null = none (fail-closed). */
  judge?: ProseJudge | null;
  judgeScope?: 'always' | 'suggestions';
}

/** The production T6/T7/T8 ports: the coach builder's modules, wired once. */
export function stageBPorts(o: StageBPortOptions = {}): StageBPorts {
  const coachOpts = (userId: string): CoachOptions => ({
    userId, model: o.model, capabilities: o.capabilities, respond: o.respond, transport: o.transport, apiKey: o.apiKey, baseUrl: o.baseUrl,
  });
  const judge = o.judge === undefined
    ? lunaJudge({ respond: o.respond, transport: o.transport, apiKey: o.apiKey, baseUrl: o.baseUrl })
    : o.judge;
  return {
    coach: (input, call) => runCoachWithin(input, coachOpts(call.userId), call.regen, call.timeoutMs),
    postcheck: postcheckPort({ judge, judgeScope: o.judgeScope }),
    envelope: (p) => renderEnvelope(p),
  };
}

export interface StageBRun {
  /** What the T7 port returned — or the code's fallback when the port failed, hung or answered nonsense. */
  out: PostcheckOutput;
  /** Every Stage B generation made (the first, and the ONE regen when there was one) — for ai_turn_log. */
  runs: CoachRun[];
  /** Wall time of T6 + T7. */
  ms: number;
  /** ai_turn_log issue codes of the orchestration itself ('postcheck_timeout', 'coach_port_threw' …). */
  issues: string[];
}

function failedRun(status: 'timeout' | 'error', regen: RegenNote | null, ms: number, detail: string): CoachRun {
  return {
    status, reply: null, model: coachModel(), effort: 'low', contract: null, latencyMs: ms, usage: null, attempts: 0, retries: [],
    detail: detail.slice(0, 300), regen: regen !== null,
  };
}

/** A post-check port's answer, if it has the contract's shape (the guarantees re-check its content). */
function isOutput(v: unknown): v is PostcheckOutput {
  return isRec(v) && isRec(v.reply) && typeof v.reply.reply === 'string' && Array.isArray(v.codeNotes) && isRec(v.log);
}

/** The code's own T7 answer when the port gave none: nothing the model wrote, every notice kept. */
function codeFallback(input: CoachInput): PostcheckOutput {
  const reply = failedReplyFor(input);
  const codeNotes = mandatoryLines(input, reply, { codeAuthored: true });
  const log: PostcheckLog = {
    ...emptyPostcheckLog(input.tripwire.kind === 'protective' ? 'crisis_canned' : 'coach_failed'),
    code_notes: codeNotes.map((n) => n.kind),
  };
  return { reply, codeNotes, codeAuthored: true, log };
}

/**
 * T6 + T7 through the ports, under ONE budget. An explicit tripwire (canned) or a fail-closed replace
 * never reaches a model (§7.1: no LLM, no latency): the ready-made reply, with the turn's notices.
 */
export async function runStageB(
  input: CoachInput,
  ports: Pick<StageBPorts, 'coach' | 'postcheck'>,
  opts: { userId: string; budgetMs?: number; now?: () => number; log?: (line: string, data?: Record<string, unknown>) => void },
): Promise<StageBRun> {
  const t = input.tripwire;
  const now = opts.now ?? Date.now;
  const started = now();
  const issues: string[] = [];
  const runs: CoachRun[] = [];
  if (t.kind === 'canned' || (t.kind === 'fallback' && t.mode === 'replace')) {
    const reply = { ...emptyReply(t.response.message), referral_included: true };
    const codeNotes = mandatoryLines(input, reply, { codeAuthored: true });
    const log = { ...emptyPostcheckLog('crisis_canned'), code_notes: codeNotes.map((n) => n.kind) };
    return { out: { reply, codeNotes, codeAuthored: true, log }, runs, ms: 0, issues };
  }

  const deadline = started + (opts.budgetMs ?? coachTurnBudgetMs(input));
  const remainingMs = () => Math.max(0, deadline - now());
  const callCoach = async (regen: RegenNote | null, ms: number): Promise<CoachRun> => {
    const bounded = Math.max(1, Math.floor(ms));
    let r: CoachRun;
    try {
      // Bounded here too: a port that ignores its timeout still cannot stretch the turn.
      const call = Promise.resolve().then(() => ports.coach(input, { userId: opts.userId, timeoutMs: bounded, regen }));
      r = await withinBudget(call, bounded, () => failedRun('timeout', regen, bounded, `turn budget: no answer within ${bounded}ms`));
    } catch (e) {
      issues.push('coach_port_threw');
      r = failedRun('error', regen, 0, errMsg(e));
    }
    if (!isRec(r) || typeof r.status !== 'string') r = failedRun('error', regen, 0, 'coach port returned no run');
    runs.push(r);
    return r;
  };

  const first = await callCoach(null, remainingMs());
  let out: PostcheckOutput | null = null;
  try {
    const call = Promise.resolve().then(() => ports.postcheck({ input, first, regen: (note, ms) => callCoach(note, ms ?? remainingMs()), remainingMs }));
    out = await withinBudget<PostcheckOutput | null>(call, remainingMs() + POSTCHECK_GRACE_MS, () => {
      issues.push('postcheck_timeout');
      return null;
    });
  } catch (e) {
    issues.push('postcheck_failed');
    opts.log?.('[v2_turn] post-check port threw', { error: errMsg(e) });
  }
  if (out !== null && !isOutput(out)) {
    issues.push('postcheck_invalid');
    out = null;
  }
  // A copy: a regen the post-check stopped waiting for cannot change the returned record afterwards.
  return { out: out ?? codeFallback(input), runs: [...runs], ms: now() - started, issues };
}

export interface CoachTurnOptions extends StageBPortOptions {
  /** The cache key is per user (§3.2 T6). */
  userId: string;
  /** Override the end-to-end T6+T7 budget (default budgets.ts coachTurnBudgetMs). */
  budgetMs?: number;
  /** Clock (tests); default Date.now. */
  now?: () => number;
}

export interface CoachTurnResult extends GuaranteedReply {
  log: PostcheckLog;
  /** Every Stage B call made (first, and the regen when there was one) — for ai_turn_log. */
  runs: CoachRun[];
}

/** The whole Stage B of a turn: T6 + T7 (production ports) + the code-owned guarantees. Never throws. */
export async function coachTurn(input: CoachInput, opts: CoachTurnOptions): Promise<CoachTurnResult> {
  const stage = await runStageB(input, stageBPorts(opts), opts);
  return { ...applyGuarantees(input, stage.out), log: stage.out.log, runs: stage.runs };
}
