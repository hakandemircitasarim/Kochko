/**
 * ai-chat/v2/understand.ts — Stage A: the CALL (AI_MIMARI_V2 §3.2 T4, §8.3).
 *
 * A thin respond() wrapper. The request itself — prefix, TurnInput block, tripwire facts, message,
 * strict schema, cache key, §8.4 effort and the output budget — is composed in ONE place,
 * stage-a-request.ts (composeStageA over input.ts stageAView), so the shadow, the live turn and
 * the eval (ai-decide body) send the same bytes. This file adds only what a live call needs:
 * timeouts, store:false, the injected transport, and the outcome statuses.
 *
 * The model answers in the strict 'kochko_understand_vN' schema. respond() validates the JSON
 * shape; MEANING is checked afterwards by validateDecision (shadow.ts / the future handler).
 *
 * A refusal is surfaced as its own status (never silently retried on another model), and an
 * off-schema answer is 'invalid' with the issues — both are counted by the Faz 2 shadow report.
 */
import {
  MODELS, respond, type RespondError, type RespondOptions, type RespondResult, type RespondUsage, type Transport,
} from '../../shared/openai.ts';
import type { TripwireScan } from '../../shared/safety-tripwires.ts';
import { stageAView, type TurnInput } from './input.ts';
import { composeStageA, STAGE_A_MAX_OUTPUT_TOKENS, type StageARequest, type StageASizes } from './stage-a-request.ts';
import { UNDERSTAND_CACHE_KEY } from './understand-prompt.ts';

/**
 * Global Stage A cache key (§3.2 T4): the prefix + schema are the same bytes for every user. It is
 * understand-prompt.ts's key — 'kochko-understand:' + prompt version + SCHEMA_VERSION — so ONE
 * constant names the cached bytes: a rules/few-shot change or a registry/schema bump moves it.
 * (understand.test.ts pins the shape; never a module-level throw — v1 imports this file.)
 */
export const STAGE_A_CACHE_KEY: string = UNDERSTAND_CACHE_KEY;
/** §7.2: a live Stage A slower than this falls back to today's protection. The shadow measures against it. */
export const STAGE_A_LIVE_BUDGET_MS = 4_000;
/** The shadow waits longer than the live budget so the latency distribution is measured, not truncated. */
export const STAGE_A_SHADOW_TIMEOUT_MS = 15_000;
/** Visible-output budget (owned by stage-a-request.ts, carried in the request as max_tokens). */
export { STAGE_A_MAX_OUTPUT_TOKENS };

/** Stage A model: KOCHKO_MODEL_UNDERSTAND (a luna/eval experiment) or the chat tier (terra). */
export function understandModel(): string {
  let own = '';
  try { own = Deno.env.get('KOCHKO_MODEL_UNDERSTAND') ?? ''; } catch { /* no env permission */ }
  return own.trim() || MODELS.primary;
}

/** The composed Stage A request (= ai-decide's body) + what a live call adds. */
export interface UnderstandRequest extends StageARequest {
  timeoutMs: number;
  /** Character sizes of the parts (the shadow logs them; §3.3 budget check). */
  sizes: StageASizes;
}

export function buildUnderstandRequest(p: {
  turnInput: TurnInput;
  message: string;
  scan: TripwireScan;
  hasImage?: boolean;
  model?: string;
  timeoutMs?: number;
}): UnderstandRequest {
  const { request, sizes } = composeStageA({
    view: stageAView(p.turnInput, { image: p.hasImage === true }),
    scan: p.scan,
    message: p.message,
    model: p.model ?? understandModel(),
  });
  return { ...request, timeoutMs: p.timeoutMs ?? STAGE_A_SHADOW_TIMEOUT_MS, sizes };
}

/** respond()'s options for a composed request — the same mapping ai-decide applies to its body. */
export function respondArgs(req: UnderstandRequest): RespondOptions {
  return {
    model: req.model,
    effort: req.effort,
    input: [{ role: 'system', content: req.system }, ...req.input],
    schema: req.schema,
    maxTokens: req.max_tokens,
    cacheKey: req.cache_key,
    store: false,
    timeoutMs: req.timeoutMs,
  };
}

export type UnderstandStatus = 'parsed' | 'refused' | 'invalid' | 'incomplete' | 'function_call' | 'error';

export interface UnderstandMeta {
  model: string;
  providerModel: string | null;
  api: 'responses' | 'chat_completions';
  format: 'json_schema' | 'json_object';
  effort: string | null;
  latencyMs: number;
  attempts: number;
  retries: string[];
  usage: RespondUsage;
  responseId: string | null;
  finishReason: string;
}

export interface UnderstandOutcome {
  status: UnderstandStatus;
  /** The parsed decision (status 'parsed' only). */
  decision: unknown | null;
  /** 'refused': the provider's refusal text. */
  refusal: string | null;
  /** 'invalid': schema/JSON issues; `candidate` is what came back (for triage, never written). */
  issues: string[];
  candidate: unknown | null;
  /** 'incomplete': why the provider stopped (length, content_filter …). */
  reason: string | null;
  /** 'error': transport/provider failure. */
  error: RespondError | null;
  meta: UnderstandMeta;
}

export interface UnderstandDeps {
  /** Injected for tests; defaults to shared/openai.ts respond(). */
  respond?: typeof respond;
  transport?: Transport;
  apiKey?: string;
  baseUrl?: string;
}

/** Map a respond() result onto the Stage A outcome (pure; exported for tests). */
export function toUnderstandOutcome(r: RespondResult<unknown>): UnderstandOutcome {
  const meta: UnderstandMeta = {
    model: r.modelRequested, providerModel: r.providerModel, api: r.api, format: r.format, effort: r.effort,
    latencyMs: r.latencyMs, attempts: r.attempts, retries: r.retries, usage: r.usage, responseId: r.responseId,
    finishReason: r.finishReason,
  };
  const base: UnderstandOutcome = {
    status: 'error', decision: null, refusal: null, issues: [], candidate: null, reason: null, error: null, meta,
  };
  switch (r.kind) {
    case 'parsed': return { ...base, status: 'parsed', decision: r.value };
    case 'refusal': return { ...base, status: 'refused', refusal: r.refusal };
    case 'invalid': return { ...base, status: 'invalid', issues: r.issues, candidate: r.candidate };
    case 'incomplete': return { ...base, status: 'incomplete', reason: r.reason };
    case 'function_call': return { ...base, status: 'function_call', reason: 'unexpected function_call' };
    case 'error': return { ...base, status: 'error', error: r.error };
  }
}

/** Run Stage A. Never throws: an exception from the transport layer becomes status 'error'. */
export async function understand(req: UnderstandRequest, deps: UnderstandDeps = {}): Promise<UnderstandOutcome> {
  const call = deps.respond ?? respond;
  const started = Date.now();
  try {
    const r = await call({
      ...respondArgs(req),
      ...(deps.transport ? { transport: deps.transport } : {}),
      ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
      ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
    });
    return toUnderstandOutcome(r);
  } catch (e) {
    return {
      status: 'error', decision: null, refusal: null, issues: [], candidate: null, reason: null,
      error: { class: 'network', status: null, message: ((e as Error)?.message ?? String(e)).slice(0, 300) },
      meta: {
        model: req.model, providerModel: null, api: 'responses', format: 'json_schema', effort: req.effort,
        latencyMs: Date.now() - started, attempts: 0, retries: [], responseId: null, finishReason: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
      },
    };
  }
}
