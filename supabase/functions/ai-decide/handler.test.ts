/**
 * ai-decide/handler.test.ts — the dry-run endpoint's three promises: only the service role gets
 * in, nothing is ever written, and every upstream outcome (decision, refusal, off-schema) is
 * REPORTED with usage and latency instead of being smoothed over.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleDecide, isServiceRoleCaller, jwtClaims, parseDecideRequest } from './handler.ts';
import type { StructuredSchema, Transport } from '../shared/openai.ts';

const SCHEMA = {
  name: 'kochko_probe_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'liters'],
    properties: {
      intent: { type: 'string', enum: ['log', 'question'] },
      liters: { type: ['number', 'null'], minimum: 0, maximum: 8 },
    },
  },
};

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.sig`;
const SERVICE = jwt({ role: 'service_role', iss: 'supabase' });
const ANON = jwt({ role: 'anon', iss: 'supabase' });
const USER = jwt({ role: 'authenticated', sub: '00000000-0000-0000-0000-000000000001' });

function req(body: unknown, token: string | null = SERVICE, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/functions/v1/ai-decide', {
    method,
    headers,
    body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

function fakeTransport(payload: unknown, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }));
  };
  return { transport, calls };
}

const responses = (content: unknown[]) => ({
  id: 'resp_1',
  model: 'gpt-5.6-terra-2026-08-01',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content }],
  usage: { input_tokens: 300, output_tokens: 20, total_tokens: 320, input_tokens_details: { cached_tokens: 256 }, output_tokens_details: { reasoning_tokens: 7 } },
});

const VALID_BODY = { model: 'gpt-5.6-terra', effort: 'low', system: 'Anla kuralları', input: '1 bardak su içtim', schema: SCHEMA };
const deps = (transport: Transport) => ({ transport, serviceRoleKey: 'sb_secret_test' });

// ── gate ────────────────────────────────────────────────────────────────────────────────────

Deno.test('ai-decide: only the service role gets in', async () => {
  const { transport, calls } = fakeTransport(responses([]));
  for (const tok of [null, ANON, USER, 'not-a-jwt', '']) {
    const res = await handleDecide(req(VALID_BODY, tok), deps(transport));
    assertEquals(res.status, 403, `token ${tok} must be refused`);
    await res.body?.cancel();
  }
  assertEquals(calls.length, 0, 'a refused caller never costs a token');
});

Deno.test('ai-decide: the raw service-role key is accepted (non-JWT sb_secret keys)', () => {
  assert(isServiceRoleCaller(req({}, 'sb_secret_test'), 'sb_secret_test'));
  assert(!isServiceRoleCaller(req({}, 'sb_secret_tesT'), 'sb_secret_test'));
  assert(!isServiceRoleCaller(req({}, 'sb_secret_test'), ''), 'an unset key must not match an empty token');
});

Deno.test('ai-decide: an expired service-role JWT is refused', () => {
  const expired = jwt({ role: 'service_role', exp: 1_000 });
  assert(!isServiceRoleCaller(req({}, expired), '', 2_000_000));
  const live = jwt({ role: 'service_role', exp: 4_000_000_000 });
  assert(isServiceRoleCaller(req({}, live), '', 2_000_000));
});

Deno.test('ai-decide: jwtClaims tolerates garbage', () => {
  assertEquals(jwtClaims('a.b.c'), null);
  assertEquals(jwtClaims(''), null);
  assertEquals(jwtClaims(`x.${b64url([1, 2])}.y`), null);
  assertEquals(jwtClaims(SERVICE)?.role, 'service_role');
});

Deno.test('ai-decide: non-POST is 405, bad JSON is 400', async () => {
  const { transport } = fakeTransport(responses([]));
  const get = await handleDecide(req(null, SERVICE, 'GET'), deps(transport));
  assertEquals(get.status, 405);
  await get.body?.cancel();
  const bad = await handleDecide(req('{not json', SERVICE), deps(transport));
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
});

// ── the dry run ─────────────────────────────────────────────────────────────────────────────

Deno.test('ai-decide: returns the parsed decision + usage + latency, strict schema on the wire', async () => {
  const { transport, calls } = fakeTransport(responses([{ type: 'output_text', text: '{"intent":"log","liters":0.2}' }]));
  const res = await handleDecide(req({ ...VALID_BODY, cache_key: 'kochko-understand:v1' }), deps(transport));
  assertEquals(res.status, 200);
  const out = await res.json();

  assertEquals(out.dry_run, true);
  assertEquals(out.ok, true);
  assertEquals(out.kind, 'parsed');
  assertEquals(out.decision, { intent: 'log', liters: 0.2 });
  assertEquals(out.usage, { input_tokens: 300, output_tokens: 20, total_tokens: 320, reasoning_tokens: 7, cached_tokens: 256 });
  assertEquals(typeof out.latency_ms, 'number');
  assertEquals(out.model_requested, 'gpt-5.6-terra');
  assertEquals(out.model_served, 'gpt-5.6-terra');
  assertEquals(out.provider_model, 'gpt-5.6-terra-2026-08-01');
  assertEquals(out.format, 'json_schema');
  assertEquals(out.schema_name, 'kochko_probe_v1');
  assert(!('output_items' in out), 'raw items only on request');

  assertEquals(calls.length, 1);
  const body = calls[0].body;
  assertEquals((body.text as { format: { type: string; strict: boolean } }).format.type, 'json_schema');
  assertEquals((body.text as { format: { strict: boolean } }).format.strict, true);
  assertEquals(body.store, false);
  assertEquals(body.input, [{ role: 'system', content: 'Anla kuralları' }, { role: 'user', content: '1 bardak su içtim' }]);
});

Deno.test('ai-decide: a refusal is reported as such (200), not as a decision', async () => {
  const { transport, calls } = fakeTransport(responses([{ type: 'refusal', refusal: 'Yardımcı olamam.' }]));
  const res = await handleDecide(req(VALID_BODY), deps(transport));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.ok, false);
  assertEquals(out.kind, 'refusal');
  assertEquals(out.refusal, 'Yardımcı olamam.');
  assertEquals(out.decision, null);
  assertEquals(calls.length, 1);
});

Deno.test('ai-decide: an off-schema answer comes back with issues and the candidate', async () => {
  const { transport } = fakeTransport(responses([{ type: 'output_text', text: '{"intent":"log","liters":12}' }]));
  const out = await (await handleDecide(req(VALID_BODY), deps(transport))).json();
  assertEquals(out.kind, 'invalid');
  assert(out.issues.some((i: string) => i.startsWith('$.liters:')), out.issues.join(' | '));
  assertEquals(out.candidate, { intent: 'log', liters: 12 });
});

Deno.test('ai-decide: an upstream 400 is reported in the body, the endpoint itself still answers 200', async () => {
  const { transport } = fakeTransport({ error: { message: "Invalid schema for response_format 'kochko_probe_v1'" } }, 400);
  const out = await (await handleDecide(req(VALID_BODY), deps(transport))).json();
  assertEquals(out.kind, 'error');
  assertEquals(out.error.class, 'http');
  assertEquals(out.error.status, 400);
});

Deno.test('ai-decide: json_object probe + array input + output items on request', async () => {
  const { transport, calls } = fakeTransport({
    id: 'c1', model: 'gpt-4o', choices: [{ message: { role: 'assistant', content: '{"intent":"question","liters":null}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  const out = await (await handleDecide(req({
    model: 'gpt-4o', format: 'json_object', system: '', include_output_items: true, schema: SCHEMA,
    input: [{ role: 'assistant', content: 'Bugün ne kadar su içtin?' }, { role: 'user', content: 'günde 3 litre içmem gerekiyor mu?' }],
  }), deps(transport))).json();
  assertEquals(out.kind, 'parsed');
  assertEquals(out.format, 'json_object');
  assertEquals(out.api, 'chat_completions');
  assertEquals(out.output_items.length, 1);
  assertEquals(calls[0].body.response_format, { type: 'json_object' });
  const msgs = calls[0].body.messages as Array<{ role: string; content: string }>;
  assertEquals(msgs.length, 3, 'schema instruction + the two caller messages (empty system is dropped)');
  assert(msgs[0].content.includes('kochko_probe_v1'));
});

Deno.test('ai-decide: a named registry schema can be referenced instead of sent', async () => {
  const { transport, calls } = fakeTransport(responses([{ type: 'output_text', text: '{"intent":"log","liters":0.2}' }]));
  const named: Record<string, StructuredSchema> = { kochko_probe_v1: SCHEMA };
  const { schema: _raw, ...rest } = VALID_BODY;
  const res = await handleDecide(req({ ...rest, schema_name: 'kochko_probe_v1' }), { ...deps(transport), schemas: named });
  assertEquals((await res.json()).kind, 'parsed');
  assertEquals(calls.length, 1);
});

// ── request validation ──────────────────────────────────────────────────────────────────────

Deno.test('ai-decide: request validation names the bad field and spends no tokens', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...VALID_BODY, effort: 'turbo' }, 'effort'],
    [{ ...VALID_BODY, format: 'xml' }, 'format'],
    [{ ...VALID_BODY, model: 'bad model id' }, 'model'],
    [{ ...VALID_BODY, system: 42 }, 'system'],
    [{ ...VALID_BODY, input: '' }, 'input'],
    [{ ...VALID_BODY, input: [{ role: 'tool', content: 'x' }] }, 'input[0].role'],
    [{ ...VALID_BODY, schema: { name: 'has space', schema: SCHEMA.schema } }, 'schema.name'],
    [{ ...VALID_BODY, max_tokens: 0 }, 'max_tokens'],
    [{ ...VALID_BODY, timeout_ms: 10 }, 'timeout_ms'],
    [{ ...VALID_BODY, schema_name: 'kochko_probe_v1' }, 'either schema or schema_name'],
    [{ model: 'gpt-5.6-terra', system: 's', input: 'x', schema_name: 'nope' }, 'unknown schema_name'],
    [{ ...VALID_BODY, tools: [{ name: 'x' }] }, 'tools[0]'],
  ];
  const { transport, calls } = fakeTransport(responses([]));
  for (const [body, needle] of cases) {
    const res = await handleDecide(req(body), deps(transport));
    assertEquals(res.status, 400, needle);
    const out = await res.json();
    assert(String(out.error).includes(needle), `${needle} → ${out.error}`);
  }
  assertEquals(calls.length, 0);
});

Deno.test('ai-decide: a schema strict mode would reject is caught before the provider (with paths)', () => {
  const loose = { ...VALID_BODY, schema: { name: 'loose', schema: { type: 'object', properties: { a: { type: 'string' } } } } };
  const r = parseDecideRequest(loose);
  assert(!r.ok);
  if (!r.ok) {
    assert(r.issues?.some((i) => i.includes('additionalProperties')));
    assert(r.issues?.some((i) => i.includes('#/properties/a')));
  }
  // strict:false is an explicit opt-out for probing non-strict behaviour.
  assert(parseDecideRequest({ ...loose, schema: { ...loose.schema, strict: false } }).ok);
});

Deno.test('ai-decide: defaults — primary model, low effort (Stage A base, §8.4)', () => {
  const r = parseDecideRequest({ system: 's', input: 'x', schema: SCHEMA });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.effort, 'low');
    assert(r.value.model.length > 0);
    assertEquals(r.value.messages, [{ role: 'system', content: 's' }, { role: 'user', content: 'x' }]);
  }
});

// ── structural guarantees ───────────────────────────────────────────────────────────────────

Deno.test('ai-decide: no database client anywhere in the function (dry run means cannot write)', async () => {
  for (const f of ['./handler.ts', './index.ts']) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    for (const banned of ['supabase-admin', 'createClient', 'supabase-js', '.from(', '.rpc(']) {
      assert(!src.includes(banned), `${f} must not reference ${banned}`);
    }
  }
});

Deno.test('ai-decide: config.toml keeps verify_jwt = true (the role check trusts the gateway signature)', async () => {
  const toml = await Deno.readTextFile(new URL('../../config.toml', import.meta.url));
  const m = toml.match(/\[functions\.ai-decide\]\s*\r?\n\s*verify_jwt\s*=\s*(\w+)/);
  assert(m, 'config.toml must declare [functions.ai-decide]');
  assertEquals(m[1], 'true');
});
