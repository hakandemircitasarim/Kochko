/**
 * Eval runner core (§9.1). Every fixture is one production turn up to the commit, as a function
 * call over the REAL pieces:
 *
 *   T2      scanTripwires(message) → explicit hit: today's canned reply, Stage A NOT called
 *           (resolveTripwires; the `t2` and `reply` roots carry what the user would get)
 *   T4      buildStageARequest() (stage-a-request.ts: prefix + registry doc + rendered TurnInput +
 *           tripwire facts + message, strict buildUnderstandSchema) → transport (ai-decide | fake
 *           | replay) → `decision`; ai-decide's refusal / invalid / incomplete = the model's failure
 *   T5      validateDecision() → `validation`; rows → `commit`; toActionReceipt() → `receipts`
 *   (T6+)   an optional port adds Stage B roots (reply, envelope, facts) once they exist
 *
 * then evaluates the fixture's expectations. No DB, no clock in the request, no I/O beyond the
 * injected ports — the same function backs the CLI, the CI replay test and the unit tests.
 */
import type { EvalFixture, EvalReport, FixtureRunResult, RubricOutcome, RunStatus, StageOutputs, StageRoot, TurnResult } from './types.ts';
import { evaluateAll } from './expect.ts';
import { evaluateRubric, type JudgePort, replyText } from './rubric.ts';
import { buildFixtureRequest, fixtureT2 } from './request.ts';
import { isModelAnswer, type LlmTransport, parseDecision } from './transport.ts';
import { requestKey } from './replay-store.ts';
import { postStageA } from './bind.ts';
import { type Budget, computeGates, costOf, percentile, type QualityPair } from './gates.ts';
import { stageASchema } from '../stage-a-request.ts';
import { validateJsonSchema } from '../../../shared/json-schema-check.ts';

/** Integration seam for Stage B (+ envelope, facts) once they land: extra roots after the commit. */
export type PostProcessPort = (fixture: EvalFixture, turn: Readonly<TurnResult>) => Promise<StageOutputs> | StageOutputs;

export interface RunOptions {
  fixtures: EvalFixture[];
  reps: number;
  /** Stage A model (§3.2 T4: gpt-5.6-terra). */
  model: string;
  transport: LlmTransport;
  mode: string;
  postprocess?: PostProcessPort;
  judge?: JudgePort;
  concurrency?: number;
  budget?: Budget;
  quality?: QualityPair[];
  keepDecisions?: boolean;
  onResult?: (r: FixtureRunResult) => void;
}

function emptyTurn(): TurnResult {
  return { outputs: {}, stages: {}, stage_errors: {}, unbound: {} };
}

function statusOf(outcomes: { status: string }[], rubric: RubricOutcome[]): RunStatus {
  const all = [...outcomes.map((o) => o.status), ...rubric.map((r) => r.status)];
  if (all.includes('fail')) return 'fail';
  return all.includes('pass') ? 'pass' : 'skipped';
}

function setStage(turn: TurnResult, root: StageRoot, value: unknown): void {
  turn.outputs[root] = value;
  turn.stages[root] = 'ok';
}

async function judgeRubric(fixture: EvalFixture, turn: TurnResult, opts: RunOptions): Promise<RubricOutcome[]> {
  let rubric = evaluateRubric(fixture.reply_rubric, turn);
  const reply = turn.stages.reply === 'ok' ? replyText(turn.outputs) : null;
  const judgeable = rubric.filter((r) => r.rubric === 'claims_subset_of_receipts' || r.rubric === 'answers_user_question');
  if (opts.judge && reply !== null && judgeable.length) {
    try {
      const verdicts = await opts.judge.judge({ fixture_id: fixture.id, message: fixture.message, reply, receipts: turn.outputs.receipts ?? [], rubric: judgeable.map((r) => r.rubric) });
      // The judge is authoritative for the items it scored; the machine lint stays for the rest.
      rubric = rubric.map((r) => verdicts.find((v) => v.rubric === r.rubric) ?? r);
    } catch (err) {
      rubric = rubric.map((r) => (judgeable.some((j) => j.rubric === r.rubric) ? { ...r, status: 'fail', detail: `yargıç hatası (kapalı-başarısız): ${(err as Error).message}`, by: 'judge' } : r));
    }
  }
  return rubric;
}

export async function runFixtureOnce(fixture: EvalFixture, rep: number, opts: RunOptions): Promise<FixtureRunResult> {
  const base = { fixture_id: fixture.id, package: fixture.package, source: fixture.source, rep };
  const turn = emptyTurn();
  const finish = (extra: Partial<FixtureRunResult>, rubric: RubricOutcome[] = []): FixtureRunResult => {
    const outcomes = evaluateAll(fixture.expect, { turn, message: fixture.message });
    const status = extra.status ?? statusOf(outcomes, rubric);
    const r: FixtureRunResult = { ...base, cache: 'none', ...extra, status, outcomes, rubric };
    if (status === 'skipped' && !r.skip_reason) r.skip_reason = 'değerlendirilebilir beklenti yok (ilgili aşamalar çalışmadı)';
    return r;
  };

  if ((fixture.pipeline ?? 'chat') !== 'chat') return finish({ status: 'skipped', skip_reason: `${fixture.pipeline} hattı henüz eval'e bağlı değil` });
  if (fixture.client) return finish({ status: 'skipped', skip_reason: `T1 istemci protokolü (${fixture.client.protocol}) — Stage A çağrılmaz, handler bağlanınca değerlendirilir` });

  // T2 — the deterministic floor runs first, exactly as in production.
  const t2 = fixtureT2(fixture.message);
  setStage(turn, 't2', t2.output);
  if (t2.floor.kind === 'canned') {
    // §7.1: explicit list → today's canned reply instantly, no LLM. That IS the reply the user gets.
    setStage(turn, 'reply', { reply: t2.floor.response.message, suggested_foods: [], suggested_exercises: [], referral_included: true });
    return finish({ canned: true }, await judgeRubric(fixture, turn, opts));
  }

  let payload: Record<string, unknown>;
  try {
    payload = buildFixtureRequest(fixture, opts.model, t2.scan) as unknown as Record<string, unknown>;
  } catch (err) {
    return finish({ status: 'error', error: `istek kurulamadı: ${(err as Error).message}` });
  }
  const key = await requestKey(payload);
  const { response, cache } = await opts.transport.call({ fixture_id: fixture.id, rep, payload, key });
  const common = { cache, request_key: key, latency_ms: response.latency_ms, usage: response.usage };
  if (cache === 'miss') return finish({ ...common, status: 'skipped', skip_reason: 'replay kaydı yok' });
  if (!isModelAnswer(response)) return finish({ ...common, status: 'error', error: response.error ?? `HTTP ${response.status ?? '?'}` });

  const parsed = parseDecision(response);
  let schema_errors: string[] | undefined = parsed.schema_issues?.length ? parsed.schema_issues : undefined;
  let repair_needed: boolean | undefined;
  if (parsed.error) {
    // The model failed this turn; everything downstream of Stage A failed with it (a D fixture
    // that only checks the commit must not turn a refusal into "skipped").
    for (const root of ['decision', 'validation', 'commit', 'receipts'] as StageRoot[]) {
      turn.stages[root] = 'error';
      turn.stage_errors[root] = root === 'decision' ? parsed.error : `Stage A başarısız: ${parsed.error}`;
    }
  } else {
    setStage(turn, 'decision', parsed.decision);
    // Defence in depth, as respond() does locally: the registry's strict schema, the shared validator.
    const errs = validateJsonSchema(stageASchema().schema, parsed.decision);
    if (errs.length) schema_errors = errs;
    try {
      const post = postStageA(fixture, parsed.decision);
      for (const [root, v] of Object.entries(post.outputs) as [StageRoot, unknown][]) setStage(turn, root, v);
      turn.unbound!.receipts = { ...post.unbound.receipts };
      repair_needed = post.validation.repair.needed;
    } catch (err) {
      return finish({ ...common, status: 'error', error: `validateDecision/commit simülasyonu hatası: ${(err as Error).message}` });
    }
  }
  if (opts.postprocess && turn.stages.decision === 'ok') {
    try {
      const extra = await opts.postprocess(fixture, turn);
      for (const [root, v] of Object.entries(extra) as [StageRoot, unknown][]) setStage(turn, root, v);
    } catch (err) {
      return finish({ ...common, status: 'error', error: `postprocess hatası: ${(err as Error).message}` });
    }
  }
  setStage(turn, 'meta', {
    latency_ms: response.latency_ms ?? null,
    usage: response.usage ?? null,
    cache,
    model_served: response.model_served ?? null,
    effort: payload.effort ?? null,
    schema_errors: schema_errors ?? [],
  });

  const rubric = await judgeRubric(fixture, turn, opts);
  return finish({
    ...common, schema_errors, parse_error: parsed.error, repair_needed,
    decision: opts.keepDecisions ? turn.outputs.decision : undefined,
  }, rubric);
}

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, worker));
  return out;
}

export async function runEval(opts: RunOptions): Promise<EvalReport> {
  const started_at = new Date().toISOString();
  const jobs: (() => Promise<FixtureRunResult>)[] = [];
  for (const f of opts.fixtures) {
    for (let rep = 0; rep < Math.max(1, opts.reps); rep++) {
      jobs.push(async () => {
        const r = await runFixtureOnce(f, rep, opts);
        opts.onResult?.(r);
        return r;
      });
    }
  }
  const results = await pool(jobs, opts.concurrency ?? 4);
  const totals = { pass: 0, fail: 0, skipped: 0, error: 0, cache_miss: 0 };
  for (const r of results) {
    totals[r.status]++;
    if (r.cache === 'miss') totals.cache_miss++;
  }
  const lat = results.filter((r) => r.cache === 'live' || r.cache === 'hit').map((r) => r.latency_ms).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const costs = results.map((r) => costOf(opts.model, r.usage)).filter((x): x is number => x !== null);
  return {
    started_at,
    finished_at: new Date().toISOString(),
    mode: opts.mode,
    model: opts.model,
    effort: '§8.4 (auto)',
    reps: opts.reps,
    fixture_count: opts.fixtures.length,
    results,
    gates: computeGates(results, { budget: opts.budget, quality: opts.quality, model: opts.model }),
    totals,
    latency: { p50_ms: percentile(lat, 0.5), p90_ms: percentile(lat, 0.9), samples: lat.length },
    cost_usd_estimate: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(4)) : null,
  };
}
