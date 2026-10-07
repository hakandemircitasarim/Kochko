/**
 * understand.test.ts — Stage A request assembly and the call, through the REAL respond() with a fake
 * transport (no network, no key).
 *
 * Pinned: the cached prefix is byte-identical for every user and carries no per-turn data; the
 * per-turn content is TurnInput → tripwire facts → message (verbatim, last); the strict schema and
 * the global cache key go on the wire with store:false; §8.4 effort; refusals / off-schema answers /
 * provider errors / timeouts each come back as their own status, never as a decision.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { buildWriteDoc, SCHEMA_NAMES, SCHEMA_VERSION } from '../../shared/write-registry/mod.ts';
import { sampleDecision, SAMPLE_WRITES } from '../../shared/write-registry/samples.ts';
import { loadTurnInput, renderTurnInput, type TurnInput } from './input.ts';
import { fakeResponses, fakeTurnInputDb, NOW, refusalBody, responsesBody, seedTables, USER, OTHER } from './testing.ts';
import {
  buildUnderstandRequest, STAGE_A_CACHE_KEY, stageAEffort, stageAUserContent, understand, understandPrefix, understandSchema,
} from './understand.ts';
import { UNDERSTAND_CACHE_KEY, UNDERSTAND_PROMPT_VERSION, UNDERSTAND_RULES } from './understand-prompt.ts';

async function turnInput(mutate?: (t: ReturnType<typeof seedTables>) => void, userId = USER): Promise<TurnInput> {
  const t = seedTables();
  mutate?.(t);
  if (userId !== USER) {
    for (const rows of Object.values(t)) for (const r of rows) { if (r.user_id === USER) r.user_id = userId; if (r.id === USER) r.id = userId; }
  }
  return await loadTurnInput(fakeTurnInputDb(t), { userId, now: NOW });
}

const noDraft = (t: ReturnType<typeof seedTables>) => { t.weekly_plans = t.weekly_plans.filter((p) => p.status !== 'draft'); };

Deno.test('the cached prefix: rules → registry doc → few-shots, identical for every user and turn', async () => {
  const p = understandPrefix();
  assert(p.startsWith(UNDERSTAND_RULES));
  assertStringIncludes(p, buildWriteDoc().trim());
  assertStringIncludes(p, '## Örnek kararlar');
  assertEquals(understandPrefix(), p, 'memoised, same bytes');
  const a = buildUnderstandRequest({ turnInput: await turnInput(), message: 'merhaba', scan: scanTripwires('merhaba') });
  const b = buildUnderstandRequest({ turnInput: await turnInput(undefined, OTHER), message: 'başka bir mesaj', scan: scanTripwires('başka bir mesaj') });
  assertEquals(a.messages[0], { role: 'system', content: p });
  assertEquals(b.messages[0], a.messages[0], 'per-user data never enters the cached prefix');
  assert(!p.includes('merhaba') && !p.includes('KISITLAR:\nc1'), 'no turn data in the prefix');
  // ONE key for the cached bytes: the brain module's (prompt version + registry SCHEMA_VERSION).
  assertEquals(a.cacheKey, STAGE_A_CACHE_KEY);
  assertEquals(STAGE_A_CACHE_KEY, UNDERSTAND_CACHE_KEY);
  assertEquals(STAGE_A_CACHE_KEY, `kochko-understand:${UNDERSTAND_PROMPT_VERSION}-${SCHEMA_VERSION}`);
  assert(STAGE_A_CACHE_KEY.startsWith('kochko-understand:') && STAGE_A_CACHE_KEY.endsWith(SCHEMA_VERSION), 'a schema bump moves the key');
  assertEquals(a.schema, understandSchema());
  assertEquals(a.schema.name, SCHEMA_NAMES.understand);
  assertEquals(a.schema.name, `kochko_understand_${SCHEMA_VERSION}`);
  assertEquals(a.schema.strict, true);
});

Deno.test('per-turn content: TurnInput block, then tripwire facts, then the message verbatim and last', async () => {
  const ti = await turnInput();
  const msg = 'antrenmanda bir an bayıldım, başım dönüyor';
  const scan = scanTripwires(msg);
  assert(scan.hits.length > 0, 'precondition: an ambiguous tripwire');
  const req = buildUnderstandRequest({ turnInput: ti, message: msg, scan });
  const user = String(req.messages[1].content);
  assertEquals(req.messages[1].role, 'user');
  const iTurn = user.indexOf('ŞİMDİ:');
  const iTrip = user.indexOf('GÜVENLİK TETİKLERİ');
  const iMsg = user.indexOf('KULLANICI MESAJI:');
  assert(iTurn === 0 && iTurn < iTrip && iTrip < iMsg, `order: ${iTurn} < ${iTrip} < ${iMsg}`);
  assert(user.endsWith(`KULLANICI MESAJI:\n${msg}`), 'message verbatim, last');
  assertStringIncludes(user, renderTurnInput(ti));
  assertEquals(req.sizes, { prefix: understandPrefix().length, turn_input: renderTurnInput(ti).length, tripwires: iMsg - iTrip - 2, message: msg.length });

  const plain = buildUnderstandRequest({ turnInput: ti, message: '1 bardak su içtim', scan: scanTripwires('1 bardak su içtim') });
  assert(!String(plain.messages[1].content).includes('GÜVENLİK TETİKLERİ'), 'no tripwire block without hits');
  assertEquals(stageAUserContent('T', '', 'm'), 'T\n\nKULLANICI MESAJI:\nm');
});

Deno.test('§8.4 effort: low by default; medium for image, open draft, tripwire fact, ED tier ≥ watch or unknown', async () => {
  const base = { hasImage: false, draftOpen: false, tripwireFacts: 0, edTier: 'none' as const };
  assertEquals(stageAEffort(base), 'low');
  assertEquals(stageAEffort({ ...base, hasImage: true }), 'medium');
  assertEquals(stageAEffort({ ...base, draftOpen: true }), 'medium');
  assertEquals(stageAEffort({ ...base, tripwireFacts: 1 }), 'medium');
  for (const t of ['watch', 'amber', 'red', 'unknown'] as const) assertEquals(stageAEffort({ ...base, edTier: t }), 'medium', t);
  const msg = '1 bardak su içtim';
  assertEquals(buildUnderstandRequest({ turnInput: await turnInput(noDraft), message: msg, scan: scanTripwires(msg) }).effort, 'low');
  assertEquals(buildUnderstandRequest({ turnInput: await turnInput(), message: msg, scan: scanTripwires(msg) }).effort, 'medium', 'seed has an open draft');
  const amber = await turnInput((t) => { noDraft(t); t.user_safety_state[0].ed_tier = 'amber'; });
  assertEquals(buildUnderstandRequest({ turnInput: amber, message: msg, scan: scanTripwires(msg) }).effort, 'medium');
});

Deno.test('understand(): strict schema + cache key + store:false on the wire; a valid decision is parsed', async () => {
  const decision = sampleDecision({ writes: [SAMPLE_WRITES.water_log], self_check: { reported_new_facts: true, not_written_reason: null } });
  const { transport, calls } = fakeResponses(() => responsesBody(decision));
  const msg = '1 bardak su içtim';
  const req = buildUnderstandRequest({ turnInput: await turnInput(noDraft), message: msg, scan: scanTripwires(msg), model: 'gpt-5.6-terra' });
  const out = await understand(req, { transport, apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1' });
  assertEquals(out.status, 'parsed');
  assertEquals(out.decision, decision);
  assertEquals(calls.length, 1);
  const body = calls[0].body;
  assertEquals(calls[0].url, 'https://api.openai.com/v1/responses');
  assertEquals(body.store, false);
  assertEquals(body.prompt_cache_key, STAGE_A_CACHE_KEY);
  assertEquals((body.reasoning as Record<string, unknown>).effort, 'low');
  const fmt = (body.text as { format: Record<string, unknown> }).format;
  assertEquals([fmt.type, fmt.name, fmt.strict], ['json_schema', SCHEMA_NAMES.understand, true]);
  assertEquals(fmt.schema, understandSchema().schema);
  const input = body.input as Array<{ role: string; content: string }>;
  assertEquals(input.map((m) => m.role), ['system', 'user']);
  assertEquals(input[0].content, understandPrefix());
  assertEquals(out.meta.usage.cachedTokens, 8000);
  assertEquals(out.meta.providerModel, 'gpt-5.6-terra-2026-08-01');
});

Deno.test('understand(): refusal, off-schema, provider error and timeout are statuses, never decisions', async () => {
  const ti = await turnInput(noDraft);
  const msg = 'merhaba';
  const req = (timeoutMs?: number) => buildUnderstandRequest({ turnInput: ti, message: msg, scan: scanTripwires(msg), model: 'gpt-5.6-terra', timeoutMs });
  const deps = (t: ReturnType<typeof fakeResponses>['transport']) => ({ transport: t, apiKey: 'k', baseUrl: 'https://api.openai.com/v1' });

  const refused = await understand(req(), deps(fakeResponses(() => refusalBody('Bu isteğe yardımcı olamam.')).transport));
  assertEquals([refused.status, refused.refusal, refused.decision], ['refused', 'Bu isteğe yardımcı olamam.', null]);

  const bad = await understand(req(), deps(fakeResponses(() => responsesBody({ intent: { primary: 'chat' } })).transport));
  assertEquals(bad.status, 'invalid');
  assertEquals(bad.decision, null);
  assert(bad.issues.length > 0);
  assertEquals(bad.candidate, { intent: { primary: 'chat' } });

  const http = await understand(req(), deps(fakeResponses(() => new Response('{"error":{"message":"bad"}}', { status: 400 })).transport));
  assertEquals([http.status, http.error?.class, http.error?.status], ['error', 'http', 400]);

  const hang = fakeResponses((call) => new Promise<Response>(() => { void call; }));
  const slow = await understand(req(60), deps(hang.transport));
  assertEquals([slow.status, slow.error?.class], ['error', 'timeout']);
});

Deno.test('understand(): an injected respond() that throws becomes status error (never an exception)', async () => {
  const ti = await turnInput(noDraft);
  const r = buildUnderstandRequest({ turnInput: ti, message: 'x', scan: scanTripwires('x') });
  const out = await understand(r, { respond: () => { throw new Error('kaboom'); } });
  assertEquals(out.status, 'error');
  assertEquals(out.error?.message, 'kaboom');
});
