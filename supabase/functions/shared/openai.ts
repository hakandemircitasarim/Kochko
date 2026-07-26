/**
 * OpenAI API client for Kochko Edge Functions.
 * Supports text and vision (image) inputs.
 * Spec 5.25: Model versioning, fallback, structured output.
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
const MODELS = {
  primary: Deno.env.get('KOCHKO_MODEL_SMART') || 'gpt-4o',
  vision: Deno.env.get('KOCHKO_MODEL_VISION') || 'gpt-4o',
  fallback: Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-4o-mini',
};

// FIX (audit AI-MDL-02): hard per-request timeout. Without an AbortController a hung upstream
// (custom gateway stall / OpenAI incident) blocks until the edge platform wall-clock kills the
// whole function, and the transient-retry path would stack a SECOND timeout-less hang. 45s is well
// above the p99 latency; on abort we surface a clean error (callers map to a Turkish message).
const OPENAI_TIMEOUT_MS = 45_000;
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = OPENAI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Temperature presets per task mode (Spec 5.27)
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

interface ChatMessage {
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
}

interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  // #arch S2: like jsonMode (forces response_format=json_object) but returns the RAW JSON string
  // instead of JSON.parse-ing it — so the caller can parse a structured envelope with its OWN
  // graceful fallback (treat a non-envelope response as plain prose) rather than throwing.
  jsonRaw?: boolean;
  stream?: boolean;
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
 * Call OpenAI Chat Completion.
 * Returns parsed JSON if jsonMode, raw text otherwise.
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
  let effectiveMessages = messages;

  if (options?.jsonMode || options?.jsonRaw) {
    // OpenAI rejects response_format=json_object (400) unless the literal token
    // "json" appears somewhere in the messages. Some prompts only SHOW a JSON
    // shape (e.g. `{"send": false}`) without the word "json" — that 400'd the
    // whole ai-proactive cron. Guarantee the precondition here so every caller
    // (current + future) is protected, not just the ones that happen to say "json".
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

  const body: Record<string, unknown> = {
    model,
    messages: effectiveMessages,
    temperature: options?.temperature ?? 0.5,
    max_tokens: options?.maxTokens ?? 2000,
  };

  if (options?.jsonMode || options?.jsonRaw) {
    body.response_format = { type: 'json_object' };
  }

  // FIX (audit AI-MDL-02): wrap in AbortController. On a timeout, fall back ONCE to the
  // fast model (cheaper + often a different node) before surfacing a clean Turkish error,
  // mirroring the transient-failure fallback below.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    const isAbort = (fetchErr as Error)?.name === 'AbortError';
    if (isAbort && model !== MODELS.fallback) {
      console.error(`OpenAI ${model} timed out after ${OPENAI_TIMEOUT_MS}ms, falling back to ${MODELS.fallback}`);
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
    // downgrade gpt-4o to mini, and 5xx must not be retried instantly (which would
    // hammer an already-struggling provider). Backoff now applies to 5xx too.
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
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? '';
  const finishReason = choice?.finish_reason;

  if (finishReason === 'length') {
    // Truncated by the token ceiling — the historical plan-snapshot failure mode.
    console.error(
      `OpenAI output truncated (finish_reason=length); max_tokens=${body.max_tokens} too small for model ${model}, jsonMode=${!!options?.jsonMode}`
    );
    // For JSON, a truncated body will not parse — fail loudly with a truncation-specific message
    // (and optionally retry once with a larger ceiling) rather than the generic 'invalid JSON'.
    if (options?.jsonMode || options?.jsonRaw) {
      const bumped = (options?.maxTokens ?? 2000) * 2;
      if (bumped <= 16000 && (options?.maxTokens ?? 2000) < bumped) {
        return chatCompletion<T>(messages, { ...options, maxTokens: bumped, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: 'truncation_retry' });
      }
      throw new Error('OpenAI output truncated (finish_reason=length): increase maxTokens');
    }
    // For text, surface truncation rather than returning a half-finished reply silently.
    throw new Error('OpenAI output truncated (finish_reason=length): increase maxTokens');
  }

  if (typeof content !== 'string' || content.trim() === '') {
    const finish = finishReason ?? 'unknown';
    const refusal = choice?.message?.refusal;
    // Empty completion (content_filter / refusal / length). Try fallback model once.
    if (model !== MODELS.fallback) {
      // FIX (audit AI-MDL-03) reset the per-model HTTP-retry flag so the fallback
      // model still gets its own single transient-retry budget when reached this way.
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback, _sameModelRetried: false, _startedAt: startedAt, _modelRequested: modelRequested, _attempt: attempt, _fallbackReason: `empty_${finish}` });
    }
    throw new Error(`OpenAI returned empty content (finish_reason=${finish}${refusal ? `, refusal=${refusal}` : ''})`);
  }

  // #arch step 5: emit the turn receipt on success (spans all retries/fallbacks above).
  if (options?.onReceipt) {
    const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    try {
      options.onReceipt({
        modelRequested,
        modelServed: model,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? ((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)),
        latencyMs: Date.now() - startedAt,
        finishReason: finishReason ?? 'stop',
        fallbackReason: options._fallbackReason ?? null,
        attempts: attempt,
      });
    } catch (_e) { /* receipt sink must never break the turn */ }
  }

  if (options?.jsonMode) {
    try {
      return JSON.parse(content) as T;
    } catch (parseErr) {
      console.error('OpenAI JSON parse failed. Raw content:', content.substring(0, 200));
      throw new Error('OpenAI returned invalid JSON');
    }
  }

  return content as T;
}

/**
 * Build a vision message content array (image + text).
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
