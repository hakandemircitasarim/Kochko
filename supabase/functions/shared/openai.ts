/**
 * OpenAI API client for Kochko Edge Functions.
 * Supports text and vision (image) inputs.
 * Spec 5.25: Model versioning, fallback, structured output.
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const MODELS = {
  primary: 'gpt-4o-mini',
  vision: 'gpt-4o',
  fallback: 'gpt-4o-mini', // same but could be different
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
  const body: Record<string, unknown> = {
    model,
    messages,
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
    // Retry with fallback model on failure (Spec 5.25)
    if (model !== MODELS.fallback) {
      return chatCompletion<T>(messages, { ...options, model: MODELS.fallback });
    }
    throw new Error(`OpenAI error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  if (options?.jsonMode) {
    return JSON.parse(content) as T;
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
