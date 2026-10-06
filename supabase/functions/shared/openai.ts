/**
 * OpenAI API client for Kochko Edge Functions.
 * Supports text and vision (image) inputs.
 * Spec 5.25: Model versioning, fallback, structured output.
 *
 * TRANSPORT (2026-08 · GPT-5.6 migration). Two wire formats live behind ONE facade:
 *
 *   - Reasoning models (gpt-5.x / o-series) -> POST /responses. They REJECT `temperature`
 *     ("Unsupported value: only the default (1) is supported") and rename `max_tokens` to
 *     `max_output_tokens`, so sending the old body 400s every single call. They also expose
 *     `reasoning.effort`, which is the real quality dial now that model tier is not.
 *   - Everything else (gpt-4o, any OpenAI-compatible gateway) -> POST /chat/completions,
 *     byte-for-byte the pre-migration body.
 *
 * WHY BOTH, and why this is not hedging: KOCHKO_MODEL_* are secrets, so the operator can roll
 * the whole app back to gpt-4o in seconds without a deploy — the property audit AI-MDL-01 built
 * OPENAI_BASE_URL for. Deleting the legacy path would turn a 10-second recovery into a redeploy
 * during an incident, and would also break Azure/OpenRouter gateways that never shipped /responses.
 * The predicate is the model id, so the transport always matches whatever the secret names.
 *
 * v2 (AI_MIMARI_V2 §10 Faz 1): `respond()` at the bottom is a SEPARATE strict-schema path for the
 * decide/understand calls. chatCompletion and its fallback chain are untouched for v1 callers.
 */
import { SCHEMA_NAME_RE, validateJsonSchema, type JsonSchema } from './json-schema-check.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
// Provider/base-URL is configurable so the project can be pointed at any
// OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, a self-hosted gateway,
// or a different OpenAI account) by setting ONE secret — no code change/redeploy
// of logic needed. Defaults to OpenAI. Combined with KOCHKO_MODEL_* overrides
// (model-router.ts) this lets the operator swap the whole LLM backend in seconds,
// e.g. to recover from a quota outage without waiting on a deploy.
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
// prompt_cache_key is an OpenAI parameter. Strict OpenAI-compatible gateways (the documented incident
// rollback path via OPENAI_BASE_URL) can 400 on unknown arguments, and a 400 has no fallback — so
// the hint is only sent to OpenAI itself.
const SENDS_CACHE_KEY = (() => { try { return new URL(OPENAI_BASE_URL).hostname === 'api.openai.com'; } catch { return false; } })();

// FIX (audit AI-MDL-01): drive MODELS from env so a non-OpenAI gateway swap is a single
// secret-set, not a code edit. The transient/empty-content fallback below uses MODELS.fallback —
// hardcoded 'gpt-4o-mini' broke the moment OPENAI_BASE_URL pointed at OpenRouter/Azure/self-host
// (the override only covered the primary call; the first hiccup downgraded to an unknown model →
// 404/400). KOCHKO_MODEL_* mirror model-router.ts; current literals stay as defaults.
//
// 2026-08 defaults: terra is the production conversational tier (GPT-5.5-class, 1.05M context);
// luna is the cheap tier reserved for schema-constrained mechanical calls. Luna is deliberately
// NOT the primary: its long-context recall degrades to ~41%, which is precisely the axis this
// app lives on (full profile + person summary + 30-message history every single turn).
//
// 2026-10-04 benchmark (production-shaped prompt, 5 Turkish coaching scenarios × 2 reps, 15 blind
// judges): gpt-6.1-sol scored best (7.9 vs terra 7.3) but produced output ~2.5× slower (meal-log
// turns 10–13 s vs 3–4 s; plans would roughly double), so terra stays the chat tier. gpt-6-luna at
// effort `none` was fastest/cheapest but ignored a recorded allergy and injury — unfit to answer
// the user. The fast tier (extraction + fallback) moved to gpt-6-luna: half the price of
// gpt-5.6-luna and it scored highest on memory use at effort `low`.
const MODELS = {
  primary: Deno.env.get('KOCHKO_MODEL_SMART') || 'gpt-5.6-terra',
  vision: Deno.env.get('KOCHKO_MODEL_VISION') || 'gpt-5.6-terra',
  fallback: Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-6-luna',
};

/**
 * Reasoning effort — the per-task quality dial that REPLACED per-task model switching.
 *
 * The old design routed cheap turns to a weaker model, which meant the user faced a different
 * assistant every turn (see the 2026-08-01 "tek baglam omurgasi" commit). Effort varies how long
 * ONE model thinks; the model and the memory it sees stay identical, so that split-brain cannot
 * come back. `none` makes a reasoning model behave like a classic instruct model.
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Reasoning models are billed for — and budget-limited by — tokens the caller never sees.
 * With effort above `none`, thinking is drawn from max_output_tokens BEFORE any visible text,
 * so the old flat 2000 ceiling would return a completed-but-empty response. Every tier below
 * therefore reserves headroom on top of whatever the caller asked for.
 */
const REASONING_RESERVE: Record<ReasoningEffort, { add: number; floor: number }> = {
  none: { add: 0, floor: 0 },
  low: { add: 4_000, floor: 6_000 },
  medium: { add: 8_000, floor: 12_000 },
  high: { add: 16_000, floor: 24_000 },
  xhigh: { add: 24_000, floor: 32_000 },
  max: { add: 32_000, floor: 48_000 },
};

export function resolveOutputBudget(maxTokens: number, effort: ReasoningEffort | undefined): number {
  if (!effort || effort === 'none') return maxTokens;
  const { add, floor } = REASONING_RESERVE[effort];
  return Math.max(maxTokens + add, floor);
}

/**
 * Which wire format does this model speak? Matched on the id because that is what the secret
 * carries. Deliberately permissive: any gpt-5+/o-series id routes to /responses, everything
 * else keeps the legacy body, so pointing KOCHKO_MODEL_SMART at gpt-4o still works untouched.
 */
/**
 * Clamp a requested effort to what the model accepts. Effort levels are NOT uniform across the
 * family: gpt-6.x Sol/Astra reject `none` (and `minimal`) with a 400, while Terra/Luna accept it.
 * The router asks for `none` on greetings and the mechanical tier — on a model without it that
 * would turn every "merhaba" into an error. Closest supported level is `low`.
 */
export function effortFor(model: string, effort: ReasoningEffort): ReasoningEffort {
  if (effort === 'none' && /^gpt-6(\.\d+)?-(sol|astra)\b/i.test(model.trim())) return 'low';
  return effort;
}

export function usesResponsesApi(model: string): boolean {
  return /^(gpt-5|gpt-6|o[1-9])/i.test(model.trim());
}

// FIX (audit AI-MDL-02): hard per-request timeout. Without an AbortController a hung upstream
// (custom gateway stall / OpenAI incident) blocks until the edge platform wall-clock kills the
// whole function, and the transient-retry path would stack a SECOND timeout-less hang.
//
// Reasoning models think before they speak, so the old flat 45s ceiling aborted healthy calls at
// medium effort. The budget now scales with effort; `none` keeps the original 45s.
const OPENAI_TIMEOUT_MS = 45_000;
const EFFORT_TIMEOUT_MS: Record<ReasoningEffort, number> = {
  none: 45_000,
  low: 60_000,
  medium: 90_000,
  high: 120_000,
  xhigh: 150_000,
  max: 180_000,
};

function resolveTimeoutMs(effort: ReasoningEffort | undefined): number {
  if (!effort) return OPENAI_TIMEOUT_MS;
  return EFFORT_TIMEOUT_MS[effort] ?? OPENAI_TIMEOUT_MS;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = OPENAI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Temperature presets per task mode (Spec 5.27).
//
// KEPT, not dead: these still drive the legacy /chat/completions path (gpt-4o rollback, non-OpenAI
// gateways). On the /responses path temperature is not sent at all — reasoning models reject it —
// and EFFORT below is the equivalent dial. Both maps are keyed by the same canonical task mode so
// a caller never has to know which transport it is on.
export const TEMPERATURE: Record<string, number> = {
  register: 0.2,    // parse: exact, consistent
  plan: 0.4,        // structured, some variety
  coaching: 0.5,    // human, contextual
  analyst: 0.2,     // numerical accuracy
  qa: 0.3,          // factual
  recipe: 0.7,      // creative
  simulation: 0.3,  // calculation accuracy
  mvd: 0.5,         // empathetic
  eating_out: 0.4,  // variety + accuracy
  plateau: 0.4,     // strategic
  recovery: 0.4,    // empathetic + calculation
  // F1/B1a: these three can only ever be produced by a client hint or the plan promotion, so the
  // map never had them — and the moment temperature reads the CANONICAL mode, their absence turns
  // into a silent `?? 0.5` for the app's most structure-sensitive turns.
  plan_diet: 0.4,     // structured JSON snapshot — same as 'plan'
  plan_workout: 0.4,  // structured JSON snapshot — same as 'plan'
  daily_log: 0.5,     // conversational logging — same as 'coaching'
  onboarding: 0.4,    // fact collection: consistent, not creative
};

/**
 * Reasoning effort per task mode — the /responses-path twin of TEMPERATURE, same keys.
 *
 * Calibration: chat turns are latency-sensitive and the hard thinking already happened when the
 * context spine was assembled, so they run `low`. Pure extraction/parse is mechanical and runs
 * `none` (a schema constrains the output; thinking buys nothing and costs seconds). Anything that
 * commits a NUMBER the user will act on — plans, targets, analysis, recovery maths — runs `medium`.
 */
export const EFFORT: Record<string, ReasoningEffort> = {
  register: 'none',       // parse into a schema — deterministic, no thinking needed
  plan: 'medium',         // commits calories/macros the user eats to
  coaching: 'low',        // conversational, latency-sensitive
  analyst: 'medium',      // numerical claims about the user's body
  qa: 'low',              // factual recall from supplied context
  recipe: 'low',          // generative, low stakes
  simulation: 'medium',   // projection maths
  mvd: 'low',             // empathetic conversation
  eating_out: 'low',      // suggestion under constraints
  plateau: 'medium',      // diagnosis -> strategy change
  recovery: 'medium',     // deficit maths after a lapse
  plan_diet: 'medium',    // structured JSON snapshot with real numbers
  plan_workout: 'medium', // structured JSON snapshot with real numbers
  daily_log: 'low',       // conversational logging
  onboarding: 'low',      // fact collection
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown[];
}

/**
 * #arch step 5: the observability receipt every LLM turn can emit. Previously token usage, the
 * ACTUAL served model, latency, and the fallback reason were all discarded (fallbacks logged only
 * to a vanishing console.error) — so cost, silent model-downgrades, and reliability were invisible.
 * chatCompletion fills one of these on success and hands it to options.onReceipt; ai_turn_log
 * persists it fail-loud.
 */
export interface UsageReceipt {
  modelRequested: string;   // what the caller asked for
  modelServed: string;      // what actually produced the content (may be the fallback)
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;        // wall-clock across ALL retries/fallbacks
  finishReason: string;
  fallbackReason: string | null; // why we downgraded/retried, if we did
  attempts: number;         // how many upstream calls this turn cost
  // Reasoning tokens are invisible in the output but ARE billed as output tokens. Without this
  // field a cost review cannot explain why output tokens tripled after the GPT-5.6 migration.
  reasoningTokens: number;
  // Input tokens served from OpenAI's prompt cache (billed at ~5–10% of the input rate). The whole
  // context spine (base prompt + profile + memory + history) is resent every turn, so this number IS
  // the cost/latency story of the app — and it was invisible before migration 105.
  cachedTokens: number;
}

interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Ignored on the legacy /chat/completions path (see TEMPERATURE above).
  reasoningEffort?: ReasoningEffort;
  jsonMode?: boolean;
  // #arch S2: like jsonMode (forces response_format=json_object) but returns the RAW JSON string
  // instead of JSON.parse-ing it — so the caller can parse a structured envelope with its OWN
  // graceful fallback (treat a non-envelope response as plain prose) rather than throwing.
  jsonRaw?: boolean;
  // #arch step 5: optional receipt sink. When set, chatCompletion calls it once on success with a
  // UsageReceipt spanning all retries/fallbacks. Non-breaking — callers that don't set it are
  // unaffected. Carried across the recursive fallback calls so the receipt reports the whole turn.
  onReceipt?: (r: UsageReceipt) => void;
  // Routing hint for OpenAI's prompt cache (`prompt_cache_key`). Requests that share a key AND a
  // prefix land on the same cache shard, so per-user keys let one user's long, stable prefix stay
  // warm between their turns. Purely an optimisation: omitting it changes nothing but hit rate.
  cacheKey?: string;
  // FIX (audit AI-MDL-03) internal recursion flag: true once the current model
  // has already been retried once for a transient failure. Callers never set this.
  _sameModelRetried?: boolean;
  // #arch step 5 internal (never set by callers): threaded through recursion so the final
  // successful call can report total latency, the originally-requested model, why we fell back,
  // and the attempt count.
  _startedAt?: number;
  _modelRequested?: string;
  _fallbackReason?: string;
  _attempt?: number;
  // Internal: set once a truncation retry has already doubled the budget, so a model that is
  // structurally unable to finish cannot loop doubling forever.
  _budgetRetried?: boolean;
}

// FIX (audit AI-MDL-03) Resolve the backoff delay (ms) before a transient retry.
// Honours Retry-After when present (seconds OR HTTP-date), otherwise an exponential
// step (500ms on the first transient hit, 1s on the second) so a single hiccup does
// not silently downgrade quality and 5xx is never hammered without a pause.
function resolveBackoffMs(response: Response, sameModelRetried: boolean): number {
  const baseline = sameModelRetried ? 1000 : 500;
  const raw = response.headers.get('retry-after');
  if (raw) {
    const asSeconds = Number(raw);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.max(baseline, asSeconds * 1000);
    }
    // HTTP-date form (e.g. "Wed, 21 Oct 2026 07:28:00 GMT") — Number() yields NaN.
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate)) {
      const deltaMs = asDate - Date.now();
      if (deltaMs > 0) return Math.max(baseline, deltaMs);
    }
  }
  return baseline;
}

/**
 * Translate one Chat-Completions message into Responses-API `input` shape.
 *
 * String content passes through untouched — /responses accepts a bare string and that is by far
 * the least fragile form. Only multimodal arrays are rewritten, because the part type names
 * genuinely differ between the two APIs (`text` -> `input_text`, `image_url` object -> flat
 * `input_image`). Getting this wrong is a 400, not a degradation, so it is kept explicit.
 */
export function toResponsesMessage(m: ChatMessage): Record<string, unknown> {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const parts = (m.content as unknown[]).map((raw) => {
    const p = raw as Record<string, unknown>;
    if (p?.type === 'text') return { type: 'input_text', text: String(p.text ?? '') };
    if (p?.type === 'image_url') {
      const img = p.image_url as { url?: string; detail?: string } | undefined;
      return { type: 'input_image', image_url: img?.url ?? '', detail: img?.detail ?? 'high' };
    }
    return p;
  });
  return { role: m.role, content: parts };
}

/**
 * Pull the assistant text out of a /responses payload.
 *
 * `output_text` is an SDK convenience aggregate and is NOT guaranteed on the raw HTTP body, so the
 * array walk is the real implementation and the aggregate is only a fast path. Reasoning items are
 * skipped: they carry the model's private thinking, never the answer.
 */
export function extractResponsesText(data: Record<string, unknown>): string {
  const direct = data.output_text;
  if (typeof direct === 'string' && direct.trim() !== '') return direct;

  const output = Array.isArray(data.output) ? data.output : [];
  const chunks: string[] = [];
  for (const raw of output) {
    const item = raw as Record<string, unknown>;
    if (item?.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const rawPart of content) {
      const part = rawPart as Record<string, unknown>;
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('');
}

/**
 * Call the LLM. Returns parsed JSON if jsonMode, raw text otherwise.
 *
 * The facade is transport-agnostic on purpose: all 17 call sites keep their existing options and
 * never learn which wire format ran.
 */
export async function chatCompletion<T = string>(
  messages: ChatMessage[],
  options?: CompletionOptions
): Promise<T> {
  const model = options?.model ?? MODELS.primary;
  // #arch step 5: turn-spanning observability state (survives the recursive fallback calls).
  const startedAt = options?._startedAt ?? Date.now();
  const modelRequested = options?._modelRequested ?? model;
  const attempt = (options?._attempt ?? 0) + 1;
  const responsesApi = usesResponsesApi(model);
  const effort: ReasoningEffort | undefined = responsesApi ? effortFor(model, options?.reasoningEffort ?? 'low') : undefined;
  const requestedMaxTokens = options?.maxTokens ?? 2000;
  let effectiveMessages = messages;

  if (options?.jsonMode || options?.jsonRaw) {
    // OpenAI rejects a json response format (400) unless the literal token "json" appears
    // somewhere in the messages. Some prompts only SHOW a JSON shape (e.g. `{"send": false}`)
    // without the word "json" — that 400'd the whole ai-proactive cron. Guarantee the
    // precondition here so every caller (current + future) is protected, not just the ones
    // that happen to say "json".
    const mentionsJson = messages.some((m) => {
      const c = m.content;
      const text = typeof c === 'string'
        ? c
        : Array.isArray(c)
          ? c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text?: unknown }).text ?? '') : '')).join(' ')
          : '';
      return /json/i.test(text);
    });
    if (!mentionsJson) {
      effectiveMessages = [...messages, { role: 'system', content: 'Yanıtını yalnızca geçerli bir JSON nesnesi olarak ver. (Respond with a valid JSON object.)' }];
    }
  }

  const wantsJson = !!(options?.jsonMode || options?.jsonRaw);
  const outputBudget = resolveOutputBudget(requestedMaxTokens, effort);

  let endpoint: string;
  let body: Record<string, unknown>;

  if (responsesApi) {
    endpoint = `${OPENAI_BASE_URL}/responses`;
    body = {
      model,
      input: effectiveMessages.map(toResponsesMessage),
      // NO temperature: reasoning models reject any value but the default and 400 the whole call.
      max_output_tokens: outputBudget,
      reasoning: { effort },
    };
    if (wantsJson) body.text = { format: { type: 'json_object' } };
    if (options?.cacheKey && SENDS_CACHE_KEY) body.prompt_cache_key = options.cacheKey;
  } else {
    endpoint = `${OPENAI_BASE_URL}/chat/completions`;
    body = {
      model,
      messages: effectiveMessages,
      temperature: options?.temperature ?? 0.5,
      max_tokens: requestedMaxTokens,
    };
    if (wantsJson) body.response_format = { type: 'json_object' };
    if (options?.cacheKey && SENDS_CACHE_KEY) body.prompt_cache_key = options.cacheKey;
  }

  // FIX (audit AI-MDL-02): wrap in AbortController. On a timeout, fall back ONCE to the
  // fast model (cheaper + often a different node) before surfacing a clean Turkish error,
  // mirroring the transient-failure fallback below.
  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, resolveTimeoutMs(effort));
  } catch (fetchErr) {
    const isAbort = (fetchErr as Error)?.name === 'AbortError';
    if (isAbort && model !== MODELS.fallback) {
      console.error(`OpenAI ${model} timed out after ${resolveTimeoutMs(effort)}ms, falling back to ${MODELS.fallback}`);
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback, _sameModelRetried: false, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: 'timeout' });
    }
    if (isAbort) {
      throw new Error(`OpenAI error (${model}): istek zaman aşımına uğradı (timeout)`);
    }
    throw fetchErr;
  }

  if (!response.ok) {
    const err = await response.text();
    const transient = response.status === 429 || response.status >= 500;
    // FIX (audit AI-MDL-03) On a transient failure (429 OR 5xx), first retry the
    // SAME model once after a bounded backoff — a single hiccup must not silently
    // downgrade the primary to the cheap tier, and 5xx must not be retried instantly
    // (which would hammer an already-struggling provider). Backoff applies to 5xx too.
    if (transient && !options?._sameModelRetried) {
      const delayMs = resolveBackoffMs(response, false);
      console.error(`OpenAI ${model} failed (${response.status}), retrying same model after ${delayMs}ms: ${err.substring(0, 200)}`);
      await new Promise((r) => setTimeout(r, delayMs));
      return chatCompletion<T>(messages, { ...options, model, _sameModelRetried: true, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: `http_${response.status}_retry` });
    }
    // Same-model retry also failed (or it was the first failure on the fallback path):
    // downgrade to the cheap fallback model, again after a bounded backoff (Spec 5.25).
    if (model !== MODELS.fallback && transient) {
      const delayMs = resolveBackoffMs(response, true);
      console.error(`OpenAI ${model} failed again (${response.status}), falling back to ${MODELS.fallback} after ${delayMs}ms: ${err.substring(0, 200)}`);
      await new Promise((r) => setTimeout(r, delayMs));
      // Reset the per-model retry flag so the fallback model also gets its own single retry.
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback, _sameModelRetried: false, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: `http_${response.status}_fallback` });
    }
    throw new Error(`OpenAI error (${model}): ${response.status} - ${err}`);
  }

  const data = await response.json();

  // Normalise both wire formats to one shape before any decision is made about them.
  let content: string;
  let finishReason: string;
  let usage: { input: number; output: number; total: number; reasoning: number; cached: number };

  if (responsesApi) {
    content = extractResponsesText(data);
    const status = typeof data.status === 'string' ? data.status : 'completed';
    const incompleteReason = (data.incomplete_details as { reason?: string } | undefined)?.reason;
    // /responses reports truncation as status=incomplete + reason=max_output_tokens, where
    // /chat/completions used finish_reason=length. Collapse to the legacy vocabulary so the
    // handling below stays single-path.
    finishReason = status === 'incomplete'
      ? (incompleteReason === 'max_output_tokens' ? 'length' : (incompleteReason ?? 'incomplete'))
      : 'stop';
    const u = (data.usage ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
      input_tokens_details?: { cached_tokens?: number };
    };
    usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      total: u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
      reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
      cached: u.input_tokens_details?.cached_tokens ?? 0,
    };
  } else {
    const choice = data.choices?.[0];
    content = choice?.message?.content ?? '';
    finishReason = choice?.finish_reason ?? 'stop';
    const u = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    usage = {
      input: u.prompt_tokens ?? 0,
      output: u.completion_tokens ?? 0,
      total: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
      reasoning: 0,
      cached: u.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  if (finishReason === 'length') {
    // Truncated by the token ceiling — the historical plan-snapshot failure mode.
    console.error(
      `OpenAI output truncated (finish_reason=length); budget=${outputBudget} too small for model ${model}, effort=${effort ?? 'n/a'}, reasoningTokens=${usage.reasoning}, jsonMode=${!!options?.jsonMode}`
    );
    // A reasoning model can burn the ENTIRE budget thinking and return zero visible text. That is
    // a budget problem, not a model problem, so retry once with double the ceiling regardless of
    // whether JSON was requested — the old code only rescued the JSON path and let prose 500.
    if (!options?._budgetRetried) {
      const bumped = requestedMaxTokens * 2;
      if (bumped <= 32_000) {
        return chatCompletion<T>(messages, { ...options, maxTokens: bumped, _budgetRetried: true, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: 'truncation_retry' });
      }
    }
    throw new Error('OpenAI output truncated (finish_reason=length): increase maxTokens');
  }

  if (typeof content !== 'string' || content.trim() === '') {
    const refusal = responsesApi ? undefined : data.choices?.[0]?.message?.refusal;
    // Empty completion (content_filter / refusal / silent reasoning overrun). Try fallback once.
    if (model !== MODELS.fallback) {
      // FIX (audit AI-MDL-03) reset the per-model HTTP-retry flag so the fallback
      // model still gets its own single transient-retry budget when reached this way.
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback, _sameModelRetried: false, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: `empty_${finishReason}` });
    }
    throw new Error(`OpenAI returned empty content (finish_reason=${finishReason}${refusal ? `, refusal=${refusal}` : ''})`);
  }

  // #arch step 5: emit the turn receipt on success (spans all retries/fallbacks above).
  if (options?.onReceipt) {
    try {
      options.onReceipt({
        modelRequested,
        modelServed: model,
        promptTokens: usage.input,
        completionTokens: usage.output,
        totalTokens: usage.total,
        latencyMs: Date.now() - startedAt,
        finishReason,
        fallbackReason: options._fallbackReason ?? null,
        attempts: attempt,
        reasoningTokens: usage.reasoning,
        cachedTokens: usage.cached,
      });
    } catch (_e) { /* receipt sink must never break the turn */ }
  }

  if (options?.jsonMode) {
    try {
      return JSON.parse(content) as T;
    } catch (_parseErr) {
      console.error('OpenAI JSON parse failed. Raw content:', content.substring(0, 200));
      throw new Error('OpenAI returned invalid JSON');
    }
  }

  return content as T;
}

/**
 * Build a vision message content array (image + text).
 *
 * Emitted in Chat-Completions shape and translated per-transport by toResponsesMessage, so callers
 * stay transport-agnostic and this helper keeps its single existing call site unchanged.
 */
export function buildVisionContent(text: string, imageBase64: string): unknown[] {
  const content: unknown[] = [];
  if (text) content.push({ type: 'text', text });
  content.push({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
  });
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// v2 strict-schema path — respond()  (docs/AI_MIMARI_V2.md §3.2 T4, §5.1, §10 Faz 1)
//
// Different contract from chatCompletion, on purpose:
//   - The output shape is a JSON schema the PROVIDER enforces (Responses `text.format`, legacy
//     `response_format.json_schema`). Gateways that cannot do that degrade to `json_object` and
//     the same schema is checked locally (injectable validator).
//   - It NEVER changes model. A refusal, an empty answer or an off-schema object comes back as a
//     typed outcome. The 2026-10-04 bench showed the fast tier ignoring a recorded allergy, so a
//     silent luna answer on a decision turn is worse than an honest failure the caller can route
//     (Stage A: fail closed to the ready-made reply, §7.2).
//   - It never throws for upstream behaviour; every path returns a RespondResult with usage,
//     latency and the retries it spent, so the ledger can record what actually happened.
//   - `store:false` is always sent on /responses (provider default there is true; these are
//     health conversations, §11 risk 10).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A named JSON schema for structured output. `strict` defaults to true. */
export interface StructuredSchema {
  name: string;
  schema: JsonSchema;
  strict?: boolean;
  description?: string;
}

/**
 * - `json_schema`: provider-enforced (default).
 * - `json_object`: for gateways without json_schema — the schema travels as an instruction and is
 *   validated locally.
 * - `auto`: try json_schema; if the gateway answers 400/422 saying the format is unsupported,
 *   degrade ONCE to json_object on the SAME model (recorded in `retries`).
 */
export type StructuredFormat = 'json_schema' | 'json_object' | 'auto';

/** Function tool declaration (Responses shape; translated for the legacy path). */
export interface FunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: JsonSchema;
  strict?: boolean;
}

export interface FunctionCall {
  callId: string;
  name: string;
  /** Raw argument string exactly as the model produced it. */
  arguments: string;
  /** JSON.parse(arguments), or null when it is not valid JSON. */
  parsedArguments: unknown;
}

export interface RespondUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Billed as output but never visible; explains cost when effort rises. */
  reasoningTokens: number;
  /** Input tokens served from the prompt cache (the Stage A prefix is shared by all users). */
  cachedTokens: number;
}

/** fetch-compatible seam. Tests and the eval replay runner inject a fake; production uses fetch. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface RespondOptions {
  model?: string;
  effort?: ReasoningEffort;
  /** A bare string is sent as one user message. */
  input: ChatMessage[] | string;
  schema: StructuredSchema;
  /** Defaults to the KOCHKO_SCHEMA_FORMAT secret, else 'json_schema'. */
  format?: StructuredFormat;
  /** Visible output budget; the reasoning reserve is added on top (resolveOutputBudget). */
  maxTokens?: number;
  cacheKey?: string;
  /** Only `false` is representable: decision calls are never stored provider-side. */
  store?: false;
  tools?: FunctionTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  /** /responses-only passthrough, e.g. ['reasoning.encrypted_content'] for a stateless tool loop. */
  include?: string[];
  /**
   * OVERALL wall-clock budget across every attempt (Stage A uses ~4 s). Default: effort-scaled.
   * It covers the whole exchange — headers AND the full body — so a gateway that stalls mid-body
   * is a `timeout`, never a hang (sendWithinBudget).
   */
  timeoutMs?: number;
  /** Local schema check; returns issues, [] = valid. Default: validateJsonSchema(schema.schema). */
  validator?: (value: unknown) => string[];
  /** Legacy /chat/completions only (reasoning models reject temperature). Default 0.2: parse-like. */
  temperature?: number;
  baseUrl?: string;
  apiKey?: string;
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
}

export interface RespondError {
  class: 'http' | 'timeout' | 'network' | 'bad_response' | 'invalid_request';
  status: number | null;
  message: string;
}

interface RespondMeta {
  modelRequested: string;
  /** Always the requested id — respond() has no model fallback. Kept for UsageReceipt parity. */
  modelServed: string;
  /** The provider's own `model` echo (often a dated snapshot), or null. */
  providerModel: string | null;
  api: 'responses' | 'chat_completions';
  /** What was actually sent on the final attempt. */
  format: 'json_schema' | 'json_object';
  effort: ReasoningEffort | null;
  /** Summed over every attempt that returned a body (a truncated attempt is still billed). */
  usage: RespondUsage;
  latencyMs: number;
  attempts: number;
  retries: string[];
  responseId: string | null;
  /** Provider status: 'completed' | 'incomplete' | chat finish_reason | 'error'. */
  status: string;
  /** Normalised: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | other. */
  finishReason: string;
  text: string;
  refusal: string | null;
  functionCalls: FunctionCall[];
  /** Raw provider output items (Responses `output[]`; legacy: [choices[0].message]). */
  outputItems: unknown[];
}

export type RespondResult<T> =
  | (RespondMeta & { kind: 'parsed'; value: T })
  | (RespondMeta & { kind: 'refusal'; refusal: string })
  | (RespondMeta & { kind: 'function_call' })
  | (RespondMeta & { kind: 'invalid'; issues: string[]; candidate: unknown })
  | (RespondMeta & { kind: 'incomplete'; reason: string })
  | (RespondMeta & { kind: 'error'; error: RespondError });

export function parseSchemaFormat(raw: string | undefined | null): StructuredFormat {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'json_object' || v === 'auto' ? v : 'json_schema';
}

// Operator lever for the gateway rollback: KOCHKO_SCHEMA_FORMAT=json_object (or auto) next to
// OPENAI_BASE_URL / KOCHKO_MODEL_SMART — a secret-set, not a deploy.
const DEFAULT_SCHEMA_FORMAT: StructuredFormat = parseSchemaFormat(Deno.env.get('KOCHKO_SCHEMA_FORMAT'));

// A retry only makes sense if a real attempt still fits in the caller's budget.
const MIN_ATTEMPT_MS = 1_000;
const MAX_RESPOND_TOKENS = 32_000;

function isOpenAiHost(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname === 'api.openai.com'; } catch { return false; }
}

/**
 * The instruction that carries the schema on the json_object path. It is PREPENDED (not appended
 * like chatCompletion's json hint) so the request still starts with a byte-stable prefix that is
 * identical for every user — the cache property the strict path gets from `text.format`.
 * Contains the literal word "JSON", which json_object mode requires.
 */
export function schemaInstruction(schema: StructuredSchema): string {
  return [
    'Yanıtını yalnızca aşağıdaki JSON şemasına birebir uyan tek bir JSON nesnesi olarak ver. Şemada olmayan alan ekleme, zorunlu alanları atlama; bilinmeyen değer için şemanın izin verdiği null değerini kullan.',
    '(Respond with exactly ONE JSON object that validates against this JSON schema.)',
    `Şema adı: ${schema.name}`,
    JSON.stringify(schema.schema),
  ].join('\n');
}

export interface RespondRequest {
  api: 'responses' | 'chat_completions';
  url: string;
  body: Record<string, unknown>;
}

/**
 * Pure request builder — the exact body respond() sends. Exported so the eval runner can key its
 * replay cache on sha256(body) and so tests can pin the wire shape without a network.
 */
export function buildRespondRequest(p: {
  model: string;
  effort: ReasoningEffort | null;
  format: 'json_schema' | 'json_object';
  messages: ChatMessage[];
  schema: StructuredSchema;
  maxTokens: number;
  baseUrl: string;
  cacheKey?: string;
  tools?: FunctionTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  include?: string[];
  temperature?: number;
}): RespondRequest {
  const base = p.baseUrl.replace(/\/+$/, '');
  const openAi = isOpenAiHost(base);
  const strict = p.schema.strict !== false;
  const messages: ChatMessage[] = p.format === 'json_object'
    ? [{ role: 'system', content: schemaInstruction(p.schema) }, ...p.messages]
    : p.messages;

  if (usesResponsesApi(p.model)) {
    const format = p.format === 'json_schema'
      ? {
        type: 'json_schema',
        name: p.schema.name,
        ...(p.schema.description ? { description: p.schema.description } : {}),
        schema: p.schema.schema,
        strict,
      }
      : { type: 'json_object' };
    const body: Record<string, unknown> = {
      model: p.model,
      input: messages.map(toResponsesMessage),
      max_output_tokens: resolveOutputBudget(p.maxTokens, p.effort ?? undefined),
      reasoning: { effort: p.effort ?? 'low' },
      text: { format },
      store: false,
    };
    if (p.tools?.length) {
      body.tools = p.tools.map((t) => ({
        type: 'function',
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.parameters,
        strict: t.strict !== false,
      }));
      if (p.toolChoice) body.tool_choice = p.toolChoice;
    }
    if (p.include?.length) body.include = p.include;
    if (p.cacheKey && openAi) body.prompt_cache_key = p.cacheKey;
    return { api: 'responses', url: `${base}/responses`, body };
  }

  const responseFormat = p.format === 'json_schema'
    ? {
      type: 'json_schema',
      json_schema: {
        name: p.schema.name,
        ...(p.schema.description ? { description: p.schema.description } : {}),
        schema: p.schema.schema,
        strict,
      },
    }
    : { type: 'json_object' };
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    temperature: p.temperature ?? 0.2,
    max_tokens: p.maxTokens,
    response_format: responseFormat,
  };
  if (p.tools?.length) {
    body.tools = p.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.parameters,
        strict: t.strict !== false,
      },
    }));
    if (p.toolChoice) body.tool_choice = p.toolChoice;
  }
  // Same reasoning as SENDS_CACHE_KEY: strict gateways 400 on unknown arguments, and on
  // OpenAI's chat endpoint store already defaults to false — explicit there, omitted elsewhere.
  if (openAi) body.store = false;
  if (p.cacheKey && openAi) body.prompt_cache_key = p.cacheKey;
  return { api: 'chat_completions', url: `${base}/chat/completions`, body };
}

interface ParsedOutput {
  text: string;
  refusal: string | null;
  functionCalls: FunctionCall[];
  items: unknown[];
  status: string;
  finishReason: string;
  usage: RespondUsage;
  responseId: string | null;
  providerModel: string | null;
  providerError: string | null;
}

function toFunctionCall(callId: unknown, name: unknown, args: unknown): FunctionCall {
  const raw = typeof args === 'string' ? args : JSON.stringify(args ?? null);
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  return { callId: typeof callId === 'string' ? callId : '', name: typeof name === 'string' ? name : '', arguments: raw, parsedArguments: parsed };
}

/**
 * Walk a /responses body. Unlike extractResponsesText (kept as-is for chatCompletion), this
 * surfaces `refusal` parts and `function_call` items instead of dropping them — a dropped refusal
 * is what used to turn into "empty content → retry on the fast model".
 */
export function parseResponsesOutput(data: Record<string, unknown>): ParsedOutput {
  const items = Array.isArray(data.output) ? data.output as unknown[] : [];
  const texts: string[] = [];
  const refusals: string[] = [];
  const functionCalls: FunctionCall[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    if (item?.type === 'function_call') {
      functionCalls.push(toFunctionCall(item.call_id ?? item.id, item.name, item.arguments));
      continue;
    }
    if (item?.type !== 'message') continue; // reasoning items are private thinking, never the answer
    const content = Array.isArray(item.content) ? item.content : [];
    for (const rawPart of content) {
      const part = rawPart as Record<string, unknown>;
      if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      else if (part?.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal);
    }
  }
  let text = texts.join('');
  if (text.trim() === '' && typeof data.output_text === 'string') text = data.output_text;
  const refusal = refusals.join(' ').trim();

  const status = typeof data.status === 'string' ? data.status : 'completed';
  const incompleteReason = (data.incomplete_details as { reason?: string } | undefined)?.reason;
  const finishReason = status === 'incomplete'
    ? (incompleteReason === 'max_output_tokens' ? 'length' : (incompleteReason ?? 'incomplete'))
    : status === 'failed' || status === 'cancelled'
      ? 'error'
      : functionCalls.length > 0 ? 'tool_calls' : 'stop';

  const u = (data.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
  };
  const err = data.error as { message?: string } | null | undefined;
  return {
    text,
    refusal: refusal === '' ? null : refusal,
    functionCalls,
    items,
    status,
    finishReason,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      totalTokens: u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: u.input_tokens_details?.cached_tokens ?? 0,
    },
    responseId: typeof data.id === 'string' ? data.id : null,
    providerModel: typeof data.model === 'string' ? data.model : null,
    providerError: err && typeof err.message === 'string' ? err.message : null,
  };
}

/** Walk a /chat/completions body: content, `message.refusal`, `message.tool_calls`. */
export function parseChatCompletionOutput(data: Record<string, unknown>): ParsedOutput {
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const choice = choices[0] ?? {};
  const message = (choice.message ?? null) as Record<string, unknown> | null;
  const text = typeof message?.content === 'string' ? message.content : '';
  const refusalRaw = typeof message?.refusal === 'string' ? message.refusal.trim() : '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message!.tool_calls as Array<Record<string, unknown>> : [];
  const functionCalls = toolCalls
    .filter((c) => c?.type === 'function' || c?.function)
    .map((c) => {
      const fn = (c.function ?? {}) as Record<string, unknown>;
      return toFunctionCall(c.id, fn.name, fn.arguments);
    });
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop';
  const u = (data.usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  return {
    text,
    refusal: refusalRaw === '' ? null : refusalRaw,
    functionCalls,
    items: message ? [message] : [],
    status: finishReason,
    finishReason: finishReason === 'function_call' ? 'tool_calls' : finishReason,
    usage: {
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    },
    responseId: typeof data.id === 'string' ? data.id : null,
    providerModel: typeof data.model === 'string' ? data.model : null,
    providerError: null,
  };
}

const SCHEMA_BUG_RE = /invalid[ _](?:json[ _])?schema/i;
const FORMAT_SUBJECT_RE = /(json_schema|response_format|text\.format)/i;
// OpenAI ("is not supported with this model"), gateways ("does not support json_schema"), Azure
// ("… is enabled only for api versions 2024-08-01-preview and later").
const FORMAT_CAPABILITY_RE = new RegExp([
  'not supported', 'unsupported', "do(?:es)?(?: not|n't|n’t) support", 'unknown', 'unrecognized',
  'not allowed', 'not permitted', 'not available',
  '(?:enabled|supported|available|allowed) only', 'only (?:enabled|supported|available|allowed)',
  'only for api[ _-]?versions?',
].join('|'), 'i');

/**
 * Does this 400/422 say "this endpoint/model cannot do json_schema" (→ degrade the FORMAT) rather
 * than "your schema is wrong" (→ a bug that must surface)? Only consulted in `auto` mode. This
 * reads a provider error string, never user text. A miss is safe (the 400 is reported, fail
 * closed); a false hit only degrades to json_object, whose answer is still validated locally.
 */
export function looksLikeFormatUnsupported(status: number, errBody: string): boolean {
  if (status !== 400 && status !== 422) return false;
  // Checked FIRST: a schema bug (message "Invalid schema …" or code "invalid_json_schema") must
  // surface, whatever capability wording the rest of the message happens to contain.
  if (SCHEMA_BUG_RE.test(errBody)) return false;
  return FORMAT_SUBJECT_RE.test(errBody) && FORMAT_CAPABILITY_RE.test(errBody);
}

function providerMessage(errBody: string): string {
  try {
    const j = JSON.parse(errBody) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message;
    if (typeof m === 'string' && m.trim() !== '') return m.slice(0, 500);
  } catch { /* not JSON — fall through to the raw text */ }
  return errBody.slice(0, 500);
}

const ZERO_USAGE: RespondUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 };

/** One attempt's reply, read to the last byte inside the attempt's budget. */
interface BoundedReply {
  /** Status and headers only — its body has already been consumed into `text`. */
  response: Response;
  /** The whole body, or null when reading it failed (`readError` says why). */
  text: string | null;
  readError: string | null;
}

async function readBodyText(response: Response, onReader: (r: ReadableStreamDefaultReader<Uint8Array>) => void): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  onReader(reader);
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Send one request and read its body to the end, all inside `budgetMs`.
 *
 * The timer stays armed until the LAST body byte is in: a gateway that sends headers and then
 * stalls mid-body is as much a timeout as one that never answers (Stage A's 4 s fail-closed bound,
 * §7.2, depends on it). On expiry the request is aborted (a real fetch drops the socket), the body
 * reader is cancelled, and a Response that a signal-ignoring transport delivers late has its body
 * cancelled too — nothing is left holding a connection.
 *
 * Rejects with an AbortError on expiry and with the transport's own error on a network failure;
 * a body that fails mid-read before the deadline resolves with `readError`.
 */
async function sendWithinBudget(transport: Transport, url: string, init: RequestInit, budgetMs: number): Promise<BoundedReply> {
  const controller = new AbortController();
  let expired = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced against every await below, so a transport that ignores `signal` still cannot hang the turn.
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new DOMException('respond() budget exhausted', 'AbortError'));
      controller.abort();
      reader?.cancel().catch(() => { /* already errored by the abort */ });
    }, budgetMs);
  });
  try {
    const pending = Promise.resolve(transport(url, { ...init, signal: controller.signal }));
    pending.then((late) => {
      if (expired) late?.body?.cancel().catch(() => { /* locked or already closed */ });
    }).catch(() => { /* a rejection is handled by the race below; nothing here may go unhandled */ });
    const response = await Promise.race([pending, budget]);
    try {
      const text = await Promise.race([readBodyText(response, (r) => { reader = r; }), budget]);
      return { response, text, readError: null };
    } catch (e) {
      if (expired) throw e;
      return { response, text: null, readError: ((e as Error)?.message ?? String(e)).slice(0, 300) };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strict-schema structured call. Returns a typed outcome; the caller decides what each one means
 * (Stage A: `parsed` → validate, anything else → fail closed).
 *
 * Retries, all on the SAME model and all recorded in `retries`: one transient retry (429/5xx/
 * network) after backoff, one truncation retry with a doubled budget, and — `auto` only — one
 * format degrade to json_object. A timeout is never retried: the budget is already spent.
 */
export async function respond<T = unknown>(opts: RespondOptions): Promise<RespondResult<T>> {
  const startedAt = Date.now();
  const model = (opts.model ?? MODELS.primary).trim();
  const api: 'responses' | 'chat_completions' = usesResponsesApi(model) ? 'responses' : 'chat_completions';
  const effort: ReasoningEffort | null = api === 'responses' ? effortFor(model, opts.effort ?? 'low') : null;
  const requestedFormat = opts.format ?? DEFAULT_SCHEMA_FORMAT;
  let format: 'json_schema' | 'json_object' = requestedFormat === 'json_object' ? 'json_object' : 'json_schema';
  const budgetMs = opts.timeoutMs ?? resolveTimeoutMs(effort ?? undefined);
  const deadline = startedAt + budgetMs;
  const transport: Transport = opts.transport ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = opts.baseUrl ?? OPENAI_BASE_URL;
  const apiKey = opts.apiKey ?? OPENAI_API_KEY;
  const messages: ChatMessage[] = typeof opts.input === 'string' ? [{ role: 'user', content: opts.input }] : opts.input;
  const validator = opts.validator ?? ((v: unknown) => validateJsonSchema(opts.schema.schema, v));

  const usage: RespondUsage = { ...ZERO_USAGE };
  const retries: string[] = [];
  let attempts = 0;
  let maxTokens = opts.maxTokens ?? 2000;
  let transientRetried = false;
  let budgetRetried = false;
  let formatDegraded = false;

  const meta = (p: Partial<ParsedOutput> = {}): RespondMeta => ({
    modelRequested: model,
    modelServed: model,
    providerModel: p.providerModel ?? null,
    api,
    format,
    effort,
    usage: { ...usage },
    latencyMs: Date.now() - startedAt,
    attempts,
    retries: [...retries],
    responseId: p.responseId ?? null,
    status: p.status ?? 'error',
    finishReason: p.finishReason ?? 'error',
    text: p.text ?? '',
    refusal: p.refusal ?? null,
    functionCalls: p.functionCalls ?? [],
    outputItems: p.items ?? [],
  });
  const fail = (cls: RespondError['class'], status: number | null, message: string, p?: Partial<ParsedOutput>): RespondResult<T> =>
    ({ ...meta(p), kind: 'error', error: { class: cls, status, message } });

  if (!opts.schema || !SCHEMA_NAME_RE.test(opts.schema.name ?? '') || typeof opts.schema.schema !== 'object' || opts.schema.schema === null) {
    return fail('invalid_request', null, 'schema must be {name: /^[A-Za-z0-9_-]{1,64}$/, schema: object}');
  }
  if (messages.length === 0) return fail('invalid_request', null, 'input is empty');

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail('timeout', null, `no answer within ${budgetMs}ms`);
    attempts++;
    const req = buildRespondRequest({
      model, effort, format, messages, schema: opts.schema, maxTokens, baseUrl,
      cacheKey: opts.cacheKey, tools: opts.tools, toolChoice: opts.toolChoice, include: opts.include,
      temperature: opts.temperature,
    });

    let reply: BoundedReply;
    try {
      // Headers AND body inside the remaining budget — the timer is not cleared until the last byte.
      reply = await sendWithinBudget(transport, req.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }, remaining);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return fail('timeout', null, `no answer within ${budgetMs}ms`);
      const msg = (e as Error)?.message ?? String(e);
      if (!transientRetried && deadline - Date.now() > 500 + MIN_ATTEMPT_MS) {
        transientRetried = true;
        retries.push('network_retry');
        await sleep(500);
        continue;
      }
      return fail('network', null, msg.slice(0, 500));
    }
    const response = reply.response;

    if (!response.ok) {
      const errBody = reply.text ?? '';
      const status = response.status;
      const transient = status === 429 || status >= 500;
      if (transient && !transientRetried) {
        const delayMs = resolveBackoffMs(response, false);
        if (deadline - Date.now() > delayMs + MIN_ATTEMPT_MS) {
          transientRetried = true;
          retries.push(`http_${status}_retry`);
          await sleep(delayMs);
          continue;
        }
      }
      if (requestedFormat === 'auto' && format === 'json_schema' && !formatDegraded && looksLikeFormatUnsupported(status, errBody)) {
        formatDegraded = true;
        format = 'json_object';
        retries.push('format_degraded');
        continue;
      }
      return fail('http', status, providerMessage(errBody));
    }

    if (reply.text === null) {
      return fail('bad_response', response.status, `unreadable provider body: ${reply.readError ?? 'unknown error'}`);
    }
    let data: Record<string, unknown>;
    try {
      const parsedBody: unknown = JSON.parse(reply.text);
      if (typeof parsedBody !== 'object' || parsedBody === null) throw new Error('body is not an object');
      data = parsedBody as Record<string, unknown>;
    } catch (e) {
      return fail('bad_response', response.status, `unparseable provider body: ${(e as Error)?.message ?? e}`);
    }

    const out = api === 'responses' ? parseResponsesOutput(data) : parseChatCompletionOutput(data);
    usage.inputTokens += out.usage.inputTokens;
    usage.outputTokens += out.usage.outputTokens;
    usage.totalTokens += out.usage.totalTokens;
    usage.reasoningTokens += out.usage.reasoningTokens;
    usage.cachedTokens += out.usage.cachedTokens;

    // Truncated strict JSON is unparseable by construction; one same-model retry with room to finish.
    if (out.finishReason === 'length' && !out.refusal && out.functionCalls.length === 0 && !budgetRetried) {
      const bumped = maxTokens * 2;
      if (bumped <= MAX_RESPOND_TOKENS && deadline - Date.now() > MIN_ATTEMPT_MS) {
        budgetRetried = true;
        maxTokens = bumped;
        retries.push('truncation_retry');
        continue;
      }
    }

    const m = meta(out);
    if (out.refusal) return { ...m, kind: 'refusal', refusal: out.refusal };
    if (out.functionCalls.length > 0) return { ...m, kind: 'function_call' };
    if (out.finishReason === 'error') return fail('bad_response', response.status, out.providerError ?? `provider status ${out.status}`, out);
    if (out.status === 'incomplete' || out.finishReason === 'length' || out.finishReason === 'content_filter') {
      return { ...m, kind: 'incomplete', reason: out.finishReason };
    }

    const trimmed = out.text.trim();
    if (trimmed === '') return { ...m, kind: 'invalid', issues: ['empty_output'], candidate: null };
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch (e) {
      return { ...m, kind: 'invalid', issues: [`malformed_json: ${(e as Error)?.message ?? e}`], candidate: null };
    }
    let issues: string[];
    try {
      issues = validator(value);
    } catch (e) {
      issues = [`validator_threw: ${(e as Error)?.message ?? e}`];
    }
    if (issues.length > 0) return { ...m, kind: 'invalid', issues, candidate: value };
    return { ...m, kind: 'parsed', value: value as T };
  }
}

/**
 * Map a respond() result onto the ai_turn_log receipt shape, so writeTurnLog persists v2 calls
 * with the same columns as v1. `fallbackReason` carries the same-model retries (never a model swap).
 */
export function respondReceipt(r: RespondResult<unknown>): UsageReceipt {
  return {
    modelRequested: r.modelRequested,
    modelServed: r.modelServed,
    promptTokens: r.usage.inputTokens,
    completionTokens: r.usage.outputTokens,
    totalTokens: r.usage.totalTokens,
    latencyMs: r.latencyMs,
    finishReason: r.kind === 'parsed' ? r.finishReason : `${r.kind}:${r.finishReason}`,
    fallbackReason: r.retries.length > 0 ? r.retries.join(',') : null,
    attempts: r.attempts,
    reasoningTokens: r.usage.reasoningTokens,
    cachedTokens: r.usage.cachedTokens,
  };
}

export { MODELS };
