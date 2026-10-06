/**
 * openai-respond.test.ts — the v2 strict-schema seam (AI_MIMARI_V2 §10 Faz 1), driven entirely by
 * a fake transport: no network, no key.
 *
 * The properties pinned here are the ones whose absence produced live defects or would on the
 * first v2 turn: a refusal that silently became a luna answer, an off-schema object written as if
 * it were valid, `store` defaulting to true for health conversations, and a gateway rollback that
 * cannot do json_schema 400-ing every decision.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildRespondRequest,
  looksLikeFormatUnsupported,
  MODELS,
  parseSchemaFormat,
  resolveOutputBudget,
  respond,
  respondReceipt,
  type RespondResult,
  type StructuredSchema,
  type Transport,
} from './openai.ts';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

const WATER: StructuredSchema = {
  name: 'kochko_probe_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'writes'],
    properties: {
      intent: { type: 'string', enum: ['log', 'question', 'chat'] },
      writes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'as_stated', 'quantity', 'unit'],
          properties: {
            op: { type: 'string', const: 'water_log' },
            as_stated: { type: 'string' },
            quantity: { type: 'number', minimum: 0, maximum: 50 },
            unit: { type: 'string', enum: ['ml', 'litre', 'bardak'] },
          },
        },
      },
    },
  },
};

const GOOD = { intent: 'log', writes: [{ op: 'water_log', as_stated: '1 bardak', quantity: 1, unit: 'bardak' }] };
const OPENAI = 'https://api.openai.com/v1';
const GATEWAY = 'https://gateway.example.com/v1';

interface Call { url: string; body: Record<string, unknown>; headers: Headers; signal: AbortSignal | null }
type Reply = (call: Call) => Response | Promise<Response>;

function fake(...replies: Reply[]) {
  const calls: Call[] = [];
  const transport: Transport = (url, init) => {
    const call: Call = {
      url,
      body: JSON.parse(String(init.body)),
      headers: new Headers(init.headers),
      signal: init.signal ?? null,
    };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return Promise.resolve(reply(call));
  };
  return { transport, calls };
}

const jsonReply = (status: number, body: unknown, headers: Record<string, string> = {}): Reply =>
  () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function responsesBody(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'resp_1',
    model: 'gpt-5.6-terra-2026-08-01',
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ],
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      total_tokens: 1280,
      input_tokens_details: { cached_tokens: 1024 },
      output_tokens_details: { reasoning_tokens: 42 },
    },
    ...extra,
  };
}

function chatBody(message: Record<string, unknown>, finish = 'stop') {
  return {
    id: 'chatcmpl_1',
    model: 'gpt-4o-2024-08-06',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940, prompt_tokens_details: { cached_tokens: 512 } },
  };
}

const sleeps: number[] = [];
const noSleep = (ms: number) => { sleeps.push(ms); return Promise.resolve(); };

const base = {
  input: [{ role: 'system' as const, content: 'Anla kuralları' }, { role: 'user' as const, content: '1 bardak su içtim' }],
  schema: WATER,
  baseUrl: OPENAI,
  apiKey: 'sk-test',
  sleep: noSleep,
};

function expectKind<K extends RespondResult<unknown>['kind']>(r: RespondResult<unknown>, kind: K): Extract<RespondResult<unknown>, { kind: K }> {
  assertEquals(r.kind, kind, `expected ${kind}, got ${r.kind}: ${JSON.stringify(r).slice(0, 400)}`);
  return r as Extract<RespondResult<unknown>, { kind: K }>;
}

// ── strict success ──────────────────────────────────────────────────────────────────────────

Deno.test('respond: strict success on /responses — json_schema format, store:false, usage incl. cached/reasoning', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', effort: 'low', cacheKey: 'kochko-understand:v1', transport }), 'parsed');

  assertEquals(r.value, GOOD);
  assertEquals(calls.length, 1);
  const c = calls[0];
  assertEquals(c.url, `${OPENAI}/responses`);
  assertEquals(c.headers.get('Authorization'), 'Bearer sk-test');
  assertEquals(c.body.text, { format: { type: 'json_schema', name: 'kochko_probe_v1', schema: WATER.schema, strict: true } });
  assertEquals(c.body.store, false, 'health conversations must never be stored provider-side');
  assertEquals(c.body.reasoning, { effort: 'low' });
  assertEquals(c.body.max_output_tokens, resolveOutputBudget(2000, 'low'));
  assertEquals(c.body.prompt_cache_key, 'kochko-understand:v1');
  assert(!('temperature' in c.body), 'reasoning models 400 on temperature');
  // Strict mode needs no "json" hint message: the caller's messages go out untouched.
  assertEquals((c.body.input as unknown[]).length, 2);

  assertEquals(r.usage, { inputTokens: 1200, outputTokens: 80, totalTokens: 1280, reasoningTokens: 42, cachedTokens: 1024 });
  assertEquals(r.api, 'responses');
  assertEquals(r.format, 'json_schema');
  assertEquals(r.modelServed, 'gpt-5.6-terra');
  assertEquals(r.providerModel, 'gpt-5.6-terra-2026-08-01');
  assertEquals(r.responseId, 'resp_1');
  assertEquals(r.attempts, 1);
  assertEquals(r.retries, []);
  assert(r.latencyMs >= 0);
});

Deno.test('respond: strict success on the legacy path — response_format.json_schema, temperature, no reasoning', async () => {
  const { transport, calls } = fake(jsonReply(200, chatBody({ content: JSON.stringify(GOOD) })));
  const r = expectKind(await respond({ ...base, model: 'gpt-4o', transport }), 'parsed');

  assertEquals(r.value, GOOD);
  const c = calls[0];
  assertEquals(c.url, `${OPENAI}/chat/completions`);
  assertEquals(c.body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'kochko_probe_v1', schema: WATER.schema, strict: true },
  });
  assertEquals(c.body.temperature, 0.2);
  assertEquals(c.body.max_tokens, 2000);
  assertEquals(c.body.store, false);
  assert(!('reasoning' in c.body));
  assertEquals(r.api, 'chat_completions');
  assertEquals(r.effort, null);
  assertEquals(r.usage.cachedTokens, 512);
  assertEquals(r.usage.inputTokens, 900);
});

Deno.test('respond: OpenAI-only parameters are not sent to a gateway (strict gateways 400 on unknown args)', async () => {
  const chat = fake(jsonReply(200, chatBody({ content: JSON.stringify(GOOD) })));
  await respond({ ...base, baseUrl: GATEWAY, model: 'gpt-4o', cacheKey: 'k', transport: chat.transport });
  assert(!('store' in chat.calls[0].body));
  assert(!('prompt_cache_key' in chat.calls[0].body));
  assertEquals(chat.calls[0].url, `${GATEWAY}/chat/completions`);

  // /responses defines store itself and defaults it to TRUE — it is always sent there.
  const resp = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  await respond({ ...base, baseUrl: GATEWAY, model: 'gpt-5.6-terra', cacheKey: 'k', transport: resp.transport });
  assertEquals(resp.calls[0].body.store, false);
  assert(!('prompt_cache_key' in resp.calls[0].body));
});

Deno.test('respond: effort is clamped per model family (Sol rejects none)', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = await respond({ ...base, model: 'gpt-6.1-sol', effort: 'none', transport });
  assertEquals(calls[0].body.reasoning, { effort: 'low' });
  assertEquals(r.effort, 'low');
});

// ── refusal / empty: surfaced, never answered by another model ─────────────────────────────

Deno.test('respond: a /responses refusal is surfaced, not retried on the fast model', async () => {
  const body = responsesBody('', {
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Bu isteğe yardımcı olamam.' }] }],
  });
  const { transport, calls } = fake(jsonReply(200, body));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'refusal');

  assertEquals(r.refusal, 'Bu isteğe yardımcı olamam.');
  assertEquals(calls.length, 1, 'a refusal is an outcome, not a transient failure');
  assertEquals(r.modelServed, 'gpt-5.6-terra');
  assert(calls.every((c) => c.body.model === 'gpt-5.6-terra'), `no call may go to ${MODELS.fallback}`);
});

Deno.test('respond: a chat/completions refusal (content null) is surfaced', async () => {
  const { transport, calls } = fake(jsonReply(200, chatBody({ content: null, refusal: 'I cannot help with that.' })));
  const r = expectKind(await respond({ ...base, model: 'gpt-4o', transport }), 'refusal');
  assertEquals(r.refusal, 'I cannot help with that.');
  assertEquals(calls.length, 1);
});

Deno.test('respond: empty output is `invalid`, never a silent fallback', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody('')));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'invalid');
  assertEquals(r.issues, ['empty_output']);
  assertEquals(calls.length, 1);
});

// ── malformed / off-schema ──────────────────────────────────────────────────────────────────

Deno.test('respond: malformed JSON is `invalid` with the parse error, candidate null', async () => {
  const { transport } = fake(jsonReply(200, responsesBody('{"intent":"log","writes":[')));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'invalid');
  assert(r.issues[0].startsWith('malformed_json:'), r.issues[0]);
  assertEquals(r.candidate, null);
  assertEquals(r.text, '{"intent":"log","writes":[');
});

Deno.test('respond: an off-schema object is `invalid` with field paths, even on the strict path', async () => {
  const bad = { intent: 'log', writes: [{ op: 'water_log', as_stated: '1 bardak', quantity: 1, unit: 'glass' }] };
  const { transport } = fake(jsonReply(200, responsesBody(JSON.stringify(bad))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'invalid');
  assert(r.issues.some((i) => i.startsWith('$.writes[0].unit:')), r.issues.join(' | '));
  assertEquals(r.candidate, bad, 'the rejected object is kept for the ledger/eval, never written');
});

Deno.test('respond: an injected validator replaces the default one', async () => {
  const { transport } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({
    ...base,
    model: 'gpt-5.6-terra',
    transport,
    validator: (v) => ((v as typeof GOOD).writes.length > 0 ? ['registry: water_log needs a day field'] : []),
  }), 'invalid');
  assertEquals(r.issues, ['registry: water_log needs a day field']);
});

Deno.test('respond: a throwing validator becomes an issue, not a crashed turn', async () => {
  const { transport } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport, validator: () => { throw new Error('boom'); } }), 'invalid');
  assertEquals(r.issues, ['validator_threw: boom']);
});

// ── json_object degrade path (gateways without json_schema) ────────────────────────────────

Deno.test('respond: json_object mode sends the schema as a prepended instruction and validates locally', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', format: 'json_object', transport }), 'parsed');
  assertEquals(r.format, 'json_object');

  const c = calls[0];
  assertEquals(c.body.text, { format: { type: 'json_object' } });
  const input = c.body.input as Array<{ role: string; content: string }>;
  assertEquals(input.length, 3);
  // Prepended, so the prefix stays byte-identical for every user (cache); carries "JSON" (400 otherwise).
  assertEquals(input[0].role, 'system');
  assert(input[0].content.includes('JSON'));
  assert(input[0].content.includes('kochko_probe_v1'));
  assert(input[0].content.includes(JSON.stringify(WATER.schema)));
  assertEquals(input[1].content, 'Anla kuralları');
  assertEquals(input[2].content, '1 bardak su içtim');
});

Deno.test('respond: json_object mode on a legacy gateway — response_format json_object + local rejection', async () => {
  const offSchema = { ...GOOD, note: 'extra field the gateway let through' };
  const { transport, calls } = fake(jsonReply(200, chatBody({ content: JSON.stringify(offSchema) })));
  const r = expectKind(await respond({ ...base, baseUrl: GATEWAY, model: 'gpt-4o', format: 'json_object', transport }), 'invalid');
  assertEquals(calls[0].body.response_format, { type: 'json_object' });
  assert(r.issues.some((i) => i.includes('$.note') && i.includes('additionalProperties')), r.issues.join(' | '));
});

Deno.test('respond: auto mode degrades the FORMAT once (same model) when the gateway cannot do json_schema', async () => {
  const { transport, calls } = fake(
    jsonReply(400, { error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model." } }),
    jsonReply(200, chatBody({ content: JSON.stringify(GOOD) })),
  );
  const r = expectKind(await respond({ ...base, baseUrl: GATEWAY, model: 'gpt-4o', format: 'auto', transport }), 'parsed');
  assertEquals(calls.length, 2);
  assertEquals((calls[0].body.response_format as { type: string }).type, 'json_schema');
  assertEquals(calls[1].body.response_format, { type: 'json_object' });
  assert(calls.every((c) => c.body.model === 'gpt-4o'), 'format degrade never swaps the model');
  assertEquals(r.format, 'json_object');
  assertEquals(r.retries, ['format_degraded']);
  assertEquals(r.attempts, 2);
});

Deno.test('respond: auto mode also degrades on the Azure "enabled only for api versions" wording', async () => {
  const { transport, calls } = fake(
    jsonReply(400, { error: { code: 'BadRequest', message: 'response_format value as json_schema is enabled only for api versions 2024-08-01-preview and later' } }),
    jsonReply(200, chatBody({ content: JSON.stringify(GOOD) })),
  );
  const r = expectKind(await respond({ ...base, baseUrl: GATEWAY, model: 'gpt-4o', format: 'auto', transport }), 'parsed');
  assertEquals(calls.length, 2);
  assertEquals(calls[1].body.response_format, { type: 'json_object' });
  assertEquals(r.retries, ['format_degraded']);
});

Deno.test('respond: a bad SCHEMA is a surfaced error even in auto mode (never masked by degrading)', async () => {
  const { transport, calls } = fake(jsonReply(400, { error: { message: "Invalid schema for response_format 'kochko_probe_v1': additionalProperties is required" } }));
  const r = expectKind(await respond({ ...base, model: 'gpt-4o', format: 'auto', transport }), 'error');
  assertEquals(calls.length, 1);
  assertEquals(r.error.class, 'http');
  assertEquals(r.error.status, 400);
  assert(r.error.message.startsWith('Invalid schema'));
});

Deno.test('respond: without auto, an unsupported-format 400 is reported, not silently degraded', async () => {
  const { transport, calls } = fake(jsonReply(400, { error: { message: 'response_format json_schema is not supported' } }));
  const r = expectKind(await respond({ ...base, model: 'gpt-4o', format: 'json_schema', transport }), 'error');
  assertEquals(calls.length, 1);
  assertEquals(r.error.status, 400);
});

// ── function_call items ─────────────────────────────────────────────────────────────────────

Deno.test('respond: /responses function_call items are surfaced with parsed arguments', async () => {
  const body = responsesBody('', {
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_meals', arguments: '{"days":3}' },
    ],
  });
  const { transport, calls } = fake(jsonReply(200, body));
  const tools = [{ type: 'function' as const, name: 'read_meals', description: 'Son öğünleri oku', parameters: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'], additionalProperties: false } }];
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', tools, toolChoice: 'auto', transport }), 'function_call');

  assertEquals(r.functionCalls, [{ callId: 'call_1', name: 'read_meals', arguments: '{"days":3}', parsedArguments: { days: 3 } }]);
  assertEquals(r.finishReason, 'tool_calls');
  assertEquals((r.outputItems as unknown[]).length, 2, 'raw items are kept for a tool loop');
  assertEquals(calls[0].body.tools, [{ type: 'function', name: 'read_meals', description: 'Son öğünleri oku', parameters: tools[0].parameters, strict: true }]);
  assertEquals(calls[0].body.tool_choice, 'auto');
});

Deno.test('respond: chat/completions tool_calls are surfaced; tools use the nested legacy shape', async () => {
  const body = chatBody({ content: null, tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'read_meals', arguments: 'not json' } }] }, 'tool_calls');
  const { transport, calls } = fake(jsonReply(200, body));
  const tools = [{ type: 'function' as const, name: 'read_meals', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }];
  const r = expectKind(await respond({ ...base, model: 'gpt-4o', tools, transport }), 'function_call');
  assertEquals(r.functionCalls, [{ callId: 'call_9', name: 'read_meals', arguments: 'not json', parsedArguments: null }]);
  assertEquals(calls[0].body.tools, [{ type: 'function', function: { name: 'read_meals', parameters: tools[0].parameters, strict: true } }]);
});

// ── retries: same model only, bounded ───────────────────────────────────────────────────────

Deno.test('respond: a transient 503 is retried ONCE on the same model after backoff', async () => {
  sleeps.length = 0;
  const { transport, calls } = fake(jsonReply(503, 'upstream busy'), jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'parsed');
  assertEquals(calls.length, 2);
  assert(calls.every((c) => c.body.model === 'gpt-5.6-terra'));
  assertEquals(r.retries, ['http_503_retry']);
  assertEquals(r.attempts, 2);
  assert(sleeps[0] >= 500, 'never hammer a struggling provider');
});

Deno.test('respond: a second transient failure is an error — no third call, no fallback model', async () => {
  const { transport, calls } = fake(jsonReply(429, { error: { message: 'Rate limit' } }), jsonReply(429, { error: { message: 'Rate limit' } }));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'error');
  assertEquals(calls.length, 2);
  assertEquals(r.error, { class: 'http', status: 429, message: 'Rate limit' });
  assert(calls.every((c) => c.body.model === 'gpt-5.6-terra'), `no call may go to ${MODELS.fallback}`);
});

Deno.test('respond: the overall timeout is a hard bound even if the transport ignores the abort', async () => {
  const hang: Transport = () => new Promise<Response>(() => { /* never settles */ });
  const t0 = Date.now();
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', timeoutMs: 50, transport: hang }), 'error');
  assertEquals(r.error.class, 'timeout');
  assertEquals(r.attempts, 1, 'a timeout is never retried — the budget is spent');
  assert(Date.now() - t0 < 2_000);
});

// A body that sends `head` and then never closes — a gateway that stalls mid-body. `cancelled`
// flips when respond() releases the stream (the connection is not leaked).
function stalledBody(head: string) {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(head)); },
    cancel() { state.cancelled = true; },
  });
  return { stream, state };
}

/** Fails (instead of hanging the suite) if `p` does not settle within `ms`. */
async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test('respond: the timeout also bounds the BODY read (200 whose stream never closes)', async () => {
  const { stream, state } = stalledBody('{"id":"resp_1","output":[');
  const { transport, calls } = fake(() => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }));
  const t0 = Date.now();
  const r = expectKind(await settlesWithin(respond({ ...base, model: 'gpt-5.6-terra', timeoutMs: 300, transport }), 3_000), 'error');
  const elapsed = Date.now() - t0;
  assertEquals(r.error.class, 'timeout');
  assertEquals(r.attempts, 1, 'a timeout is never retried — the budget is spent');
  assert(elapsed < 1_500, `bounded by the 300ms budget, took ${elapsed}ms`);
  assert(calls[0].signal?.aborted, 'the request is aborted, so a real fetch drops the socket');
  assert(state.cancelled, 'the stalled body stream is released, not leaked');
});

Deno.test('respond: the timeout also bounds an ERROR body read (503 whose stream stalls)', async () => {
  const { stream, state } = stalledBody('{"error":{"message":"upstream');
  const { transport, calls } = fake(() => new Response(stream, { status: 503 }));
  const r = expectKind(await settlesWithin(respond({ ...base, model: 'gpt-5.6-terra', timeoutMs: 300, transport }), 3_000), 'error');
  assertEquals(r.error.class, 'timeout');
  assertEquals(calls.length, 1, 'no transient retry once the budget is spent');
  assert(state.cancelled);
});

Deno.test('respond: a response that arrives AFTER the deadline has its body released', async () => {
  const { stream, state } = stalledBody('{');
  let resolved: () => void = () => {};
  const arrived = new Promise<void>((r) => { resolved = r; });
  const late: Transport = () => new Promise<Response>((res) => {
    setTimeout(() => { res(new Response(stream, { status: 200 })); resolved(); }, 120);
  });
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', timeoutMs: 50, transport: late }), 'error');
  assertEquals(r.error.class, 'timeout');
  await arrived;
  await new Promise((r) => setTimeout(r, 10));
  assert(state.cancelled, 'a transport that ignored the abort must not leave an unread body behind');
});

Deno.test('respond: a body delivered in chunks (UTF-8 split mid-character) is read whole', async () => {
  const text = JSON.stringify(responsesBody(JSON.stringify({ ...GOOD, writes: [{ ...GOOD.writes[0], as_stated: 'bir bardak ılık su' }] })));
  const bytes = new TextEncoder().encode(text);
  const cut = bytes.indexOf(0xc4); // first byte of 'ı' (U+0131 = C4 B1)
  assert(cut > 0);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, cut + 1));
      c.enqueue(bytes.slice(cut + 1));
      c.close();
    },
  });
  const { transport } = fake(() => new Response(stream, { status: 200 }));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'parsed');
  assertEquals((r.value as typeof GOOD).writes[0].as_stated, 'bir bardak ılık su');
});

Deno.test('respond: a body that errors mid-read on a 200 is `bad_response`, not a crash', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"id":'));
      c.error(new TypeError('connection reset'));
    },
  });
  const { transport, calls } = fake(() => new Response(stream, { status: 200 }));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'error');
  assertEquals(r.error.class, 'bad_response');
  assertEquals(r.error.status, 200);
  assert(r.error.message.includes('connection reset'), r.error.message);
  assertEquals(calls.length, 1);
});

Deno.test('respond: the transport receives an abort signal', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  await respond({ ...base, model: 'gpt-5.6-terra', transport });
  assert(calls[0].signal instanceof AbortSignal);
});

Deno.test('respond: truncation is retried once with a doubled budget; usage is summed over both', async () => {
  const truncated = responsesBody('{"intent":"lo', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  const { transport, calls } = fake(jsonReply(200, truncated), jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', effort: 'none', maxTokens: 300, transport }), 'parsed');
  assertEquals(calls[0].body.max_output_tokens, 300);
  assertEquals(calls[1].body.max_output_tokens, 600);
  assertEquals(r.retries, ['truncation_retry']);
  assertEquals(r.usage.inputTokens, 2400, 'the truncated attempt was billed too');
  assertEquals(r.usage.reasoningTokens, 84);
});

Deno.test('respond: still truncated after the retry → `incomplete`, not a half-parsed object', async () => {
  const truncated = responsesBody('{"intent":"lo', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  const { transport, calls } = fake(jsonReply(200, truncated));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'incomplete');
  assertEquals(r.reason, 'length');
  assertEquals(calls.length, 2);
});

Deno.test('respond: content_filter is `incomplete` and not retried', async () => {
  const filtered = responsesBody('', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } });
  const { transport, calls } = fake(jsonReply(200, filtered));
  const r = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport }), 'incomplete');
  assertEquals(r.reason, 'content_filter');
  assertEquals(calls.length, 1);
});

Deno.test('respond: provider status failed / non-JSON body are `bad_response` errors', async () => {
  const failed = fake(jsonReply(200, { id: 'resp_x', status: 'failed', error: { message: 'server_error' }, output: [] }));
  const r1 = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport: failed.transport }), 'error');
  assertEquals(r1.error.class, 'bad_response');
  assertEquals(r1.error.message, 'server_error');

  const html = fake(() => new Response('<html>gateway</html>', { status: 200 }));
  const r2 = expectKind(await respond({ ...base, model: 'gpt-5.6-terra', transport: html.transport }), 'error');
  assertEquals(r2.error.class, 'bad_response');
});

Deno.test('respond: an invalid schema name never reaches the network', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = expectKind(await respond({ ...base, schema: { ...WATER, name: 'kochko understand v1' }, model: 'gpt-5.6-terra', transport }), 'error');
  assertEquals(r.error.class, 'invalid_request');
  assertEquals(calls.length, 0);
});

Deno.test('respond: a bare string input becomes one user message', async () => {
  const { transport, calls } = fake(jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  await respond({ ...base, input: 'bugün toplam 2 litre su içtim', model: 'gpt-5.6-terra', transport });
  assertEquals(calls[0].body.input, [{ role: 'user', content: 'bugün toplam 2 litre su içtim' }]);
});

// ── pure helpers ────────────────────────────────────────────────────────────────────────────

Deno.test('buildRespondRequest is deterministic (the eval replay cache keys on its body)', () => {
  const p = {
    model: 'gpt-5.6-terra', effort: 'low' as const, format: 'json_schema' as const,
    messages: [{ role: 'user' as const, content: 'x' }], schema: WATER, maxTokens: 800, baseUrl: OPENAI + '/',
  };
  const a = buildRespondRequest(p);
  const b = buildRespondRequest(p);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(a.url, `${OPENAI}/responses`, 'trailing slash on the base URL is tolerated');
  assertEquals((a.body.text as { format: { strict: boolean } }).format.strict, true);
  const loose = buildRespondRequest({ ...p, schema: { ...WATER, strict: false } });
  assertEquals((loose.body.text as { format: { strict: boolean } }).format.strict, false);
});

Deno.test('looksLikeFormatUnsupported: format-capability errors only', () => {
  assert(looksLikeFormatUnsupported(400, "'response_format' of type 'json_schema' is not supported with this model"));
  assert(looksLikeFormatUnsupported(422, 'Unknown field: text.format'));
  assert(!looksLikeFormatUnsupported(400, "Invalid schema for response_format 'x': missing required"), 'a schema bug must surface');
  assert(!looksLikeFormatUnsupported(500, 'response_format not supported'), 'a 5xx is transient, not a capability');
  assert(!looksLikeFormatUnsupported(400, 'max_tokens is too large'));
});

Deno.test('looksLikeFormatUnsupported: gateway / Azure capability wordings degrade too', () => {
  assert(looksLikeFormatUnsupported(400, 'This model does not support response_format of type json_schema.'));
  assert(looksLikeFormatUnsupported(400, "Provider doesn't support json_schema structured outputs"));
  assert(looksLikeFormatUnsupported(400, JSON.stringify({ error: { message: 'response_format value as json_schema is enabled only for api versions 2024-08-01-preview and later', code: 'BadRequest' } })));
  assert(looksLikeFormatUnsupported(400, 'json_schema response format is only supported for api version 2024-08-01-preview or later'));
  assert(looksLikeFormatUnsupported(422, 'text.format json_schema is not available for this deployment'));
  // A schema bug still surfaces, whatever else the message says.
  assert(!looksLikeFormatUnsupported(400, "Invalid schema for response_format 'x': 'format' is not supported in strict mode"));
  assert(!looksLikeFormatUnsupported(400, JSON.stringify({ error: { message: "response_format 'x': keyword not supported", code: 'invalid_json_schema' } })));
  // The capability phrase alone (no format subject) is not enough.
  assert(!looksLikeFormatUnsupported(400, 'This model does not support temperature'));
});

Deno.test('parseSchemaFormat: unknown secret values fall back to provider-enforced json_schema', () => {
  assertEquals(parseSchemaFormat(undefined), 'json_schema');
  assertEquals(parseSchemaFormat(''), 'json_schema');
  assertEquals(parseSchemaFormat(' JSON_OBJECT '), 'json_object');
  assertEquals(parseSchemaFormat('auto'), 'auto');
  assertEquals(parseSchemaFormat('yes please'), 'json_schema');
});

Deno.test('respondReceipt maps onto the ai_turn_log receipt (retries as fallbackReason, never a model swap)', async () => {
  const { transport } = fake(jsonReply(503, 'x'), jsonReply(200, responsesBody(JSON.stringify(GOOD))));
  const r = await respond({ ...base, model: 'gpt-5.6-terra', transport });
  const receipt = respondReceipt(r);
  assertEquals(receipt.modelRequested, 'gpt-5.6-terra');
  assertEquals(receipt.modelServed, 'gpt-5.6-terra');
  assertEquals(receipt.fallbackReason, 'http_503_retry');
  assertEquals(receipt.attempts, 2);
  assertEquals(receipt.cachedTokens, 1024);
  assertEquals(receipt.reasoningTokens, 42);
  assertEquals(receipt.finishReason, 'stop');

  const refused = fake(jsonReply(200, responsesBody('', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })));
  const rr = respondReceipt(await respond({ ...base, model: 'gpt-5.6-terra', transport: refused.transport }));
  assertEquals(rr.finishReason, 'refusal:stop');
  assertEquals(rr.fallbackReason, null);
});
