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
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
// Provider/base-URL is configurable so the project can be pointed at any
// OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, a self-hosted gateway,
// or a different OpenAI account) by setting ONE secret — no code change/redeploy
// of logic needed. Defaults to OpenAI. Combined with KOCHKO_MODEL_* overrides
// (model-router.ts) this lets the operator swap the whole LLM backend in seconds,
// e.g. to recover from a quota outage without waiting on a deploy.
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

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
const MODELS = {
  primary: Deno.env.get('KOCHKO_MODEL_SMART') || 'gpt-5.6-terra',
  vision: Deno.env.get('KOCHKO_MODEL_VISION') || 'gpt-5.6-terra',
  fallback: Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-5.6-luna',
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
  const effort: ReasoningEffort | undefined = responsesApi ? (options?.reasoningEffort ?? 'low') : undefined;
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
  } else {
    endpoint = `${OPENAI_BASE_URL}/chat/completions`;
    body = {
      model,
      messages: effectiveMessages,
      temperature: options?.temperature ?? 0.5,
      max_tokens: requestedMaxTokens,
    };
    if (wantsJson) body.response_format = { type: 'json_object' };
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
  let usage: { input: number; output: number; total: number; reasoning: number };

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
    };
    usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      total: u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
      reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
    };
  } else {
    const choice = data.choices?.[0];
    content = choice?.message?.content ?? '';
    finishReason = choice?.finish_reason ?? 'stop';
    const u = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    usage = {
      input: u.prompt_tokens ?? 0,
      output: u.completion_tokens ?? 0,
      total: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
      reasoning: 0,
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

export { MODELS };
