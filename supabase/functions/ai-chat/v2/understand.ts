/**
 * ai-chat/v2/understand.ts — Stage A: the request and the call (AI_MIMARI_V2 §3.2 T4, §8.3, §8.4).
 *
 * Request order = cache order:
 *   system  : understand rules + the registry's Turkish doc + few-shots — byte-identical for EVERY
 *             user, so the provider caches it globally under STAGE_A_CACHE_KEY
 *             ('kochko-understand:<prompt version>-<SCHEMA_VERSION>')
 *             (the strict schema in text.format is part of that same cached prefix);
 *   user    : the rendered TurnInput (input.ts) → the tripwire facts (safety-tripwires.ts) → the
 *             user's message, verbatim.
 * The model answers in the strict 'kochko_understand_vN' schema. respond() validates the JSON
 * shape; MEANING is checked afterwards by validateDecision (shadow.ts / the future handler).
 *
 * A refusal is surfaced as its own status (never silently retried on another model), and an
 * off-schema answer is 'invalid' with the issues — both are counted by the Faz 2 shadow report.
 */
import {
  MODELS, respond,
  type ChatMessage, type RespondError, type RespondResult, type RespondUsage, type StructuredSchema, type Transport,
} from '../../shared/openai.ts';
import { renderTripwireFacts, tripwireFacts, type TripwireScan } from '../../shared/safety-tripwires.ts';
import { buildUnderstandSchema, buildWriteDoc, SCHEMA_NAMES, type EdTier } from '../../shared/write-registry/mod.ts';
import { edTierOf, renderTurnInput, type TurnInput } from './input.ts';
import { buildUnderstandPrefix, UNDERSTAND_CACHE_KEY } from './understand-prompt.ts';

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
/** Visible-output budget; respond() adds the reasoning reserve on top. A decision is 60–350 tokens. */
export const STAGE_A_MAX_OUTPUT_TOKENS = 2_500;

let prefixMemo: string | null = null;
let schemaMemo: StructuredSchema | null = null;

/** The cached system prefix (rules → registry doc → few-shots). Built once per isolate. */
export function understandPrefix(): string {
  prefixMemo ??= buildUnderstandPrefix({ registryDoc: buildWriteDoc() });
  return prefixMemo;
}

/** The strict schema sent as text.format (Responses) / response_format (legacy). Built once per isolate. */
export function understandSchema(): StructuredSchema {
  schemaMemo ??= { name: SCHEMA_NAMES.understand, schema: buildUnderstandSchema(), strict: true };
  return schemaMemo;
}

/** Stage A model: KOCHKO_MODEL_UNDERSTAND (a luna/eval experiment) or the chat tier (terra). */
export function understandModel(): string {
  let own = '';
  try { own = Deno.env.get('KOCHKO_MODEL_UNDERSTAND') ?? ''; } catch { /* no env permission */ }
  return own.trim() || MODELS.primary;
}

export interface EffortFacts {
  hasImage: boolean;
  /** An open plan draft (PLAN TASLAĞI not empty). */
  draftOpen: boolean;
  /** Tripwire facts handed to Stage A (ambiguous/signal hits). */
  tripwireFacts: number;
  edTier: EdTier;
}

/**
 * §8.4 — from facts code knows for CERTAIN, never from keyword guesses: base `low` (never `none`),
 * `medium` for an image, an open plan draft, a tripwire fact, or ED tier ≥ watch. An unreadable tier
 * ('unknown') thinks harder too: it is the fail-closed side.
 */
export function stageAEffort(f: EffortFacts): 'low' | 'medium' {
  return f.hasImage || f.draftOpen || f.tripwireFacts > 0 || f.edTier !== 'none' ? 'medium' : 'low';
}

export interface UnderstandRequest {
  model: string;
  effort: 'low' | 'medium';
  schema: StructuredSchema;
  cacheKey: string;
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
  /** Character sizes of the parts (the shadow logs them; §3.3 budget check). */
  sizes: { prefix: number; turn_input: number; tripwires: number; message: number };
}

/** The per-turn user content: TurnInput block, tripwire facts (only when there are any), the message. */
export function stageAUserContent(turnBlock: string, tripwireBlock: string, message: string): string {
  return [turnBlock, tripwireBlock, `KULLANICI MESAJI:\n${message}`].filter((s) => s !== '').join('\n\n');
}

export function buildUnderstandRequest(p: {
  turnInput: TurnInput;
  message: string;
  scan: TripwireScan;
  hasImage?: boolean;
  model?: string;
  timeoutMs?: number;
}): UnderstandRequest {
  const prefix = understandPrefix();
  const turnBlock = renderTurnInput(p.turnInput);
  const tripwireBlock = renderTripwireFacts(p.scan);
  const effort = stageAEffort({
    hasImage: p.hasImage === true,
    draftOpen: p.turnInput.plans.drafts.length > 0,
    tripwireFacts: tripwireFacts(p.scan).length,
    edTier: edTierOf(p.turnInput),
  });
  return {
    model: p.model ?? understandModel(),
    effort,
    schema: understandSchema(),
    cacheKey: STAGE_A_CACHE_KEY,
    messages: [
      { role: 'system', content: prefix },
      { role: 'user', content: stageAUserContent(turnBlock, tripwireBlock, p.message) },
    ],
    maxTokens: STAGE_A_MAX_OUTPUT_TOKENS,
    timeoutMs: p.timeoutMs ?? STAGE_A_SHADOW_TIMEOUT_MS,
    sizes: { prefix: prefix.length, turn_input: turnBlock.length, tripwires: tripwireBlock.length, message: p.message.length },
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
      model: req.model,
      effort: req.effort,
      input: req.messages,
      schema: req.schema,
      maxTokens: req.maxTokens,
      cacheKey: req.cacheKey,
      store: false,
      timeoutMs: req.timeoutMs,
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
