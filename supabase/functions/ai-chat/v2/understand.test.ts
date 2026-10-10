/**
 * understand.test.ts — the Stage A CALL (a thin wrapper over stage-a-request.ts composeStageA),
 * through the REAL respond() with a fake transport (no network, no key).
 *
 * Pinned: the cached prefix is byte-identical for every user and carries no per-turn data; the
 * per-turn content is the ONE renderer's TurnInput block (input.ts stageAView) → tripwire facts →
 * message (verbatim, last); the strict schema, the global cache key and max_tokens go on the wire
 * with store:false; §8.4 effort; refusals / off-schema answers / provider errors / timeouts each
 * come back as their own status, never as a decision.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { scanTripwires } from '../../shared/safety-tripwires.ts';
import { buildWriteDoc, SCHEMA_NAMES, SCHEMA_VERSION } from '../../shared/write-registry/mod.ts';
import { sampleDecision, SAMPLE_WRITES } from '../../shared/write-registry/samples.ts';
import { loadTurnInput, renderTurnInput, stageAView, type TurnInput } from './input.ts';
import { fakeResponses, fakeTurnInputDb, NOW, refusalBody, responsesBody, seedTables, USER, OTHER } from './testing.ts';
import {
  buildUnderstandRequest, respondArgs, STAGE_A_CACHE_KEY, STAGE_A_LIVE_BUDGET_MS, STAGE_A_LIVE_BUDGETS_MS, STAGE_A_MAX_OUTPUT_TOKENS, STAGE_A_SHADOW_TIMEOUT_MS,
  stageALiveBudgetMs, understand,
} from './understand.ts';
import { buildStageARequest, renderTurnInputBlock, stageABudgetClass, stageASchema, stageASystemPrompt } from './stage-a-request.ts';
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
  const p = stageASystemPrompt();
  assert(p.startsWith(UNDERSTAND_RULES));
  assertStringIncludes(p, buildWriteDoc().trim());
  assertStringIncludes(p, '## Örnek kararlar');
  assertEquals(stageASystemPrompt(), p, 'memoised, same bytes');
  const a = buildUnderstandRequest({ turnInput: await turnInput(), message: 'merhaba', scan: scanTripwires('merhaba') });
  const b = buildUnderstandRequest({ turnInput: await turnInput(undefined, OTHER), message: 'başka bir mesaj', scan: scanTripwires('başka bir mesaj') });
  assertEquals(a.system, p);
  assertEquals(b.system, a.system, 'per-user data never enters the cached prefix');
  assert(!p.includes('merhaba') && !p.includes('KISITLAR:\nc1'), 'no turn data in the prefix');
  // ONE key for the cached bytes: the brain module's (prompt version + registry SCHEMA_VERSION).
  assertEquals(a.cache_key, STAGE_A_CACHE_KEY);
  assertEquals(STAGE_A_CACHE_KEY, UNDERSTAND_CACHE_KEY);
  assertEquals(STAGE_A_CACHE_KEY, `kochko-understand:${UNDERSTAND_PROMPT_VERSION}-${SCHEMA_VERSION}`);
  assert(STAGE_A_CACHE_KEY.startsWith('kochko-understand:') && STAGE_A_CACHE_KEY.endsWith(SCHEMA_VERSION), 'a schema bump moves the key');
  assertEquals(a.schema, stageASchema());
  assertEquals(a.schema.name, SCHEMA_NAMES.understand);
  assertEquals(a.schema.name, `kochko_understand_${SCHEMA_VERSION}`);
  assertEquals(a.schema.strict, true);
});

Deno.test('per-turn content: TurnInput block, then tripwire facts, then the message verbatim and last', async () => {
  const ti = await turnInput();
  const msg = 'antrenmanda bir an bayılacak gibi oldum, başım dönüyor';
  const scan = scanTripwires(msg);
  assert(scan.hits.length > 0, 'precondition: an ambiguous tripwire');
  const req = buildUnderstandRequest({ turnInput: ti, message: msg, scan });
  const user = req.input[0].content;
  assertEquals(req.input.map((m) => m.role), ['user']);
  const iTurn = user.indexOf('ŞİMDİ:');
  const iTrip = user.indexOf('GÜVENLİK TETİKLERİ');
  const iMsg = user.indexOf('KULLANICI MESAJI:');
  assert(iTurn === 0 && iTurn < iTrip && iTrip < iMsg, `order: ${iTurn} < ${iTrip} < ${iMsg}`);
  assert(user.endsWith(`KULLANICI MESAJI:\n${msg}`), 'message verbatim, last');
  // The block is the ONE renderer over input.ts's view (renderTurnInput is only a shorthand for it).
  assertEquals(renderTurnInput(ti), renderTurnInputBlock(stageAView(ti)));
  assert(user.startsWith(`${renderTurnInputBlock(stageAView(ti))}\n\n`));
  assertEquals(req.sizes, { prefix: stageASystemPrompt().length, turn_input: renderTurnInput(ti).length, tripwires: iMsg - iTrip - 2, message: msg.length });

  const plain = buildUnderstandRequest({ turnInput: ti, message: '1 bardak su içtim', scan: scanTripwires('1 bardak su içtim') });
  assert(!plain.input[0].content.includes('GÜVENLİK TETİKLERİ'), 'no tripwire block without hits');
});

Deno.test('§8.4 effort through the wrapper: low by default; medium for image, open draft, any tripwire fact, ED tier ≥ watch or unknown', async () => {
  const msg = '1 bardak su içtim';
  assertEquals(buildUnderstandRequest({ turnInput: await turnInput(noDraft), message: msg, scan: scanTripwires(msg) }).effort, 'low');
  assertEquals(buildUnderstandRequest({ turnInput: await turnInput(), message: msg, scan: scanTripwires(msg) }).effort, 'medium', 'seed has an open draft');
  const amber = await turnInput((t) => { noDraft(t); t.user_safety_state[0].ed_tier = 'amber'; });
  assertEquals(buildUnderstandRequest({ turnInput: amber, message: msg, scan: scanTripwires(msg) }).effort, 'medium');
  const plainTi = await turnInput(noDraft);
  assertEquals(buildUnderstandRequest({ turnInput: plainTi, message: msg, scan: scanTripwires(msg), hasImage: true }).effort, 'medium', 'image');
  assertEquals(buildUnderstandRequest({ turnInput: plainTi, message: 'fıstık alerjim var', scan: scanTripwires('fıstık alerjim var') }).effort, 'medium', 'a declaration fact');
  const t = seedTables();
  noDraft(t);
  const failedSafety = await loadTurnInput(fakeTurnInputDb(t, { user_safety_state: 'permission denied' }), { userId: USER, now: NOW });
  assertEquals(buildUnderstandRequest({ turnInput: failedSafety, message: msg, scan: scanTripwires(msg) }).effort, 'medium', 'unreadable tier');
});

Deno.test('§7.2 live budgets: ONE place (normal 4 s, tripwire 7 s), chosen by the same certain fact as effort; live mode times out at them', async () => {
  assertEquals(STAGE_A_LIVE_BUDGETS_MS, { normal: 4_000, tripwire: 7_000 });
  assertEquals(STAGE_A_LIVE_BUDGET_MS, STAGE_A_LIVE_BUDGETS_MS.normal, 'the old name is the normal budget, not a second constant');
  assert(STAGE_A_LIVE_BUDGETS_MS.tripwire > STAGE_A_LIVE_BUDGETS_MS.normal);
  assert(STAGE_A_SHADOW_TIMEOUT_MS > STAGE_A_LIVE_BUDGETS_MS.tripwire, 'the shadow measures past both budgets');
  const ti = await turnInput(noDraft);
  const cases: Array<[string, 'normal' | 'tripwire']> = [
    ['1 bardak su içtim', 'normal'],
    ['antrenmanda bir an bayılacak gibi oldum', 'tripwire'], // ambiguous emergency hit
    ['dün gece kustum', 'tripwire'], // ambiguous ED hit
    ['fıstık alerjim var', 'tripwire'], // declaration cue (also effort medium)
  ];
  for (const [msg, cls] of cases) {
    const scan = scanTripwires(msg);
    assertEquals(stageABudgetClass(scan), cls, msg);
    assertEquals(stageALiveBudgetMs(scan), STAGE_A_LIVE_BUDGETS_MS[cls], msg);
    const shadow = buildUnderstandRequest({ turnInput: ti, message: msg, scan });
    assertEquals([shadow.budgetClass, shadow.liveBudgetMs, shadow.timeoutMs], [cls, STAGE_A_LIVE_BUDGETS_MS[cls], STAGE_A_SHADOW_TIMEOUT_MS], msg);
    const live = buildUnderstandRequest({ turnInput: ti, message: msg, scan, mode: 'live' });
    assertEquals(live.timeoutMs, STAGE_A_LIVE_BUDGETS_MS[cls], `${msg}: a live call fails closed AT its budget`);
    assertEquals(respondArgs(live).timeoutMs, STAGE_A_LIVE_BUDGETS_MS[cls]);
    // Same predicate as §8.4 effort on a plain view (no image, no draft, tier none): never two keyword guesses.
    assertEquals(shadow.effort === 'medium', cls === 'tripwire', `${msg}: budget class and effort disagree`);
    // The budget is the call's, not the model's: the ai-decide body never carries it.
    const body = JSON.stringify(buildStageARequest({ view: stageAView(ti), scan, message: msg, model: 'gpt-5.6-terra' }));
    assert(!body.includes('live_ms') && !body.includes('liveBudget'), msg);
  }
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
  assertEquals(fmt.schema, stageASchema().schema);
  const input = body.input as Array<{ role: string; content: string }>;
  assertEquals(input.map((m) => m.role), ['system', 'user']);
  assertEquals(input[0].content, stageASystemPrompt());
  // The request's output budget reaches respond() (which adds the reasoning reserve on top).
  assertEquals(req.max_tokens, STAGE_A_MAX_OUTPUT_TOKENS);
  assertEquals(respondArgs(req).maxTokens, STAGE_A_MAX_OUTPUT_TOKENS);
  assert(typeof body.max_output_tokens === 'number' && body.max_output_tokens >= STAGE_A_MAX_OUTPUT_TOKENS, String(body.max_output_tokens));
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
