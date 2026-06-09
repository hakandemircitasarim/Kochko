/**
 * OpenAI API client for Kochko Edge Functions.
 * Supports text and vision (image) inputs.
 * Spec 5.25: Model versioning, fallback, structured output.
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const MODELS = {
  primary: 'gpt-4o',
  vision: 'gpt-4o',
  fallback: 'gpt-4o-mini',
};

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
};

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown[];
}

interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  stream?: boolean;
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
  let effectiveMessages = messages;

  if (options?.jsonMode) {
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

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    const transient = response.status === 429 || response.status >= 500;
    // Retry with fallback model only on transient failures (Spec 5.25); re-throw 4xx immediately
    if (model !== MODELS.fallback && transient) {
      if (response.status === 429) {
        // respect Retry-After if present, else short backoff
        const ra = Number(response.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500));
      }
      console.error(`OpenAI ${model} failed (${response.status}), falling back to ${MODELS.fallback}: ${err.substring(0, 200)}`);
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback });
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
    if (options?.jsonMode) {
      const bumped = (options?.maxTokens ?? 2000) * 2;
      if (bumped <= 16000 && (options?.maxTokens ?? 2000) < bumped) {
        return chatCompletion<T>(messages, { ...options, maxTokens: bumped });
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
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback });
    }
    throw new Error(`OpenAI returned empty content (finish_reason=${finish}${refusal ? `, refusal=${refusal}` : ''})`);
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
