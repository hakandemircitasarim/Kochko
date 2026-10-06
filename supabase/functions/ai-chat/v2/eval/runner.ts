/**
 * Eval runner core (§9.1). Every fixture is a function call: build the Stage A request, send it
 * through a transport port (ai-decide | local | replay), parse, optionally post-process
 * (validateDecision + simulated commit + Stage B, once they exist), evaluate expectations.
 *
 * No DB, no clock in the request, no I/O beyond the injected ports — the same function backs the
 * CLI, the CI replay test and the unit tests.
 */
import type {
  EvalFixture,
  EvalReport,
  FixtureRunResult,
  RubricOutcome,
  RunStatus,
  StageOutputs,
  StageRoot,
  TurnResult,
} from './types.ts';
import { evaluateAll } from './expect.ts';
import { evaluateRubric, type JudgePort, replyText } from './rubric.ts';
import { checkSchema } from './schema-check.ts';
import { provisionalRequestBuilder, rawPayload, type RequestBuilder, resolveEffort, type StageAInputs, turnPayload } from './request.ts';
import { type LlmTransport, parseDecision } from './transport.ts';
import { requestKey } from './replay-store.ts';
import { type Budget, computeGates, costOf, percentile, type QualityPair } from './gates.ts';

/** Integration seam: validateDecision + toolPort commit simulation (+ Stage B) once they land.
 *  Returns extra stage outputs keyed by root (validation, commit, receipts, reply, envelope, facts). */
export type PostProcessPort = (fixture: EvalFixture, decision: unknown) => Promise<StageOutputs> | StageOutputs;

export interface RunOptions {
  fixtures: EvalFixture[];
  reps: number;
  inputs: StageAInputs;
  transport: LlmTransport;
  mode: string;
  buildRequest?: RequestBuilder;
  payloadMode?: 'raw' | 'turn';
  aliases?: Record<string, string>;
  postprocess?: PostProcessPort;
  judge?: JudgePort;
  concurrency?: number;
  budget?: Budget;
  quality?: QualityPair[];
  keepDecisions?: boolean;
  onResult?: (r: FixtureRunResult) => void;
}

const PASSTHROUGH: StageRoot[] = ['validation', 'commit', 'receipts', 'reply', 'envelope', 'facts'];

function emptyTurn(): TurnResult {
  return { outputs: {}, stages: {}, stage_errors: {} };
}

function statusOf(outcomes: { status: string }[], rubric: RubricOutcome[]): RunStatus {
  const all = [...outcomes.map((o) => o.status), ...rubric.map((r) => r.status)];
  if (all.includes('fail')) return 'fail';
  return all.includes('pass') ? 'pass' : 'skipped';
}

export async function runFixtureOnce(fixture: EvalFixture, rep: number, opts: RunOptions): Promise<FixtureRunResult> {
  const base = { fixture_id: fixture.id, package: fixture.package, source: fixture.source, rep };
  const turn = emptyTurn();
  const finish = (extra: Partial<FixtureRunResult>, rubric: RubricOutcome[] = []): FixtureRunResult => {
    const outcomes = evaluateAll(fixture.expect, { turn, message: fixture.message, aliases: opts.aliases });
    const status = extra.status ?? statusOf(outcomes, rubric);
    const r: FixtureRunResult = { ...base, cache: 'none', ...extra, status, outcomes, rubric };
    if (status === 'skipped' && !r.skip_reason) r.skip_reason = 'değerlendirilebilir beklenti yok (ilgili aşamalar çalışmadı)';
    return r;
  };

  if ((fixture.pipeline ?? 'chat') !== 'chat') return finish({ status: 'skipped', skip_reason: `${fixture.pipeline} hattı henüz eval'e bağlı değil` });
  if (fixture.client) return finish({ status: 'skipped', skip_reason: `T1 istemci protokolü (${fixture.client.protocol}) — Stage A çağrılmaz, handler bağlanınca değerlendirilir` });

  let payload: Record<string, unknown>;
  try {
    payload = opts.payloadMode === 'turn'
      ? turnPayload(fixture, opts.inputs)
      : rawPayload(await (opts.buildRequest ?? provisionalRequestBuilder)(fixture, opts.inputs));
  } catch (err) {
    return finish({ status: 'error', error: `istek kurulamadı: ${(err as Error).message}` });
  }
  const key = await requestKey(payload);
  const { response, cache } = await opts.transport.call({ fixture_id: fixture.id, rep, payload, key });
  const common = { cache, request_key: key, latency_ms: response.latency_ms, usage: response.usage };
  if (cache === 'miss') return finish({ ...common, status: 'skipped', skip_reason: 'replay kaydı yok' });
  if (!response.ok && !response.refusal) return finish({ ...common, status: 'error', error: response.error ?? `HTTP ${response.status ?? '?'}` });

  const parsed = parseDecision(response);
  let schema_errors: string[] | undefined;
  if (parsed.error) {
    turn.stages.decision = 'error';
    turn.stage_errors.decision = parsed.error;
  } else {
    turn.stages.decision = 'ok';
    turn.outputs.decision = parsed.decision;
    if (opts.inputs.schema?.schema) {
      const errs = checkSchema(parsed.decision, opts.inputs.schema.schema);
      if (errs.length) schema_errors = errs;
    }
  }
  for (const root of PASSTHROUGH) {
    const v = (response as unknown as Record<string, unknown>)[root];
    if (v !== undefined && v !== null) {
      turn.outputs[root] = v;
      turn.stages[root] = 'ok';
    }
  }
  if (opts.postprocess && turn.stages.decision === 'ok') {
    try {
      const extra = await opts.postprocess(fixture, turn.outputs.decision);
      for (const [root, v] of Object.entries(extra) as [StageRoot, unknown][]) {
        turn.outputs[root] = v;
        turn.stages[root] = 'ok';
      }
    } catch (err) {
      return finish({ ...common, status: 'error', error: `postprocess hatası: ${(err as Error).message}` });
    }
  }
  turn.outputs.meta = {
    latency_ms: response.latency_ms ?? null,
    usage: response.usage ?? null,
    cache,
    model_served: response.model_served ?? null,
    effort: resolveEffort(opts.inputs.effort, fixture.turn_input),
    schema_errors: schema_errors ?? [],
  };
  turn.stages.meta = 'ok';

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
  return finish({ ...common, schema_errors, parse_error: parsed.error, decision: opts.keepDecisions ? turn.outputs.decision : undefined }, rubric);
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
  const costs = results.map((r) => costOf(opts.inputs.model, r.usage)).filter((x): x is number => x !== null);
  return {
    started_at,
    finished_at: new Date().toISOString(),
    mode: opts.mode,
    model: opts.inputs.model,
    effort: opts.inputs.effort,
    reps: opts.reps,
    fixture_count: opts.fixtures.length,
    results,
    gates: computeGates(results, { budget: opts.budget, quality: opts.quality, model: opts.inputs.model }),
    totals,
    latency: { p50_ms: percentile(lat, 0.5), p90_ms: percentile(lat, 0.9), samples: lat.length },
    cost_usd_estimate: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(4)) : null,
  };
}
