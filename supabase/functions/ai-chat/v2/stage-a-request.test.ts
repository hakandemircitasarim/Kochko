/**
 * stage-a-request.test.ts — the ONE Stage A composer (docs/AI_MIMARI_V2.md §3.2 T4, §8.4, §9.1).
 *
 * Pinned: the prefix and schema come from their owners; the TurnInput block is rendered once, in a
 * fixed order with the registry's block titles, the day anchors, the ED-tier write gate and the
 * history window; ONE effort rule (any tripwire fact — a declaration cue included — is medium);
 * max_tokens rides in the request; and the shadow (understand.ts over input.ts stageAView) and the
 * eval (the ai-decide body) put the SAME bytes on the wire for the same view.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildStageARequest, composeStageA, renderTurnInputBlock, STAGE_A_HISTORY_MESSAGES, STAGE_A_MAX_OUTPUT_TOKENS, stageAEffort,
  type StageATurnView, stageASchema, stageASystemPrompt, stageAUserContent, TIER_GATE_LINE, TURN_BLOCK_TITLES,
} from './stage-a-request.ts';
import { buildUnderstandPrefix, UNDERSTAND_CACHE_KEY, UNDERSTAND_RULES } from './understand-prompt.ts';
import { BLOCK_TITLES, buildUnderstandSchema, buildWriteDoc, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { renderTripwireFacts, scanTripwires, tripwireFacts } from '../../shared/safety-tripwires.ts';
import { strictSchemaIssues } from '../../shared/json-schema-check.ts';
import { handleDecide, parseDecideRequest } from '../../ai-decide/handler.ts';
import { loadTurnInput, stageAView } from './input.ts';
import { buildUnderstandRequest, understand } from './understand.ts';
import { fakeResponses, fakeTurnInputDb, NOW, responsesBody, seedTables, USER } from './testing.ts';
import { sampleDecision } from '../../shared/write-registry/samples.ts';

const view = (over: Partial<StageATurnView> = {}): StageATurnView => ({
  now: { today: '2026-10-04', local_date: '2026-10-04', local_time: '21:10', tz: 'Europe/Istanbul' },
  ed_tier: 'none',
  profile: ['cinsiyet erkek', 'kilo 78,2 kg'],
  gates: [],
  today: ['su 3,20 L'],
  records: [{ ref: 'd3', line: 'bugün su: gün toplamı 3,40 L', last_turn: true }, { ref: 'm30', line: 'Paz 4 Eki akşam · mercimek çorbası 165 kcal' }],
  constraints: [{ ref: 'c1', line: 'alerji · deniz ürünleri · orta' }],
  pending: [],
  commitments: [],
  drafts: [],
  active_plans: [],
  references: [],
  image: false,
  last_turn_writes: ['water_log'],
  history: [{ role: 'assistant', content: 'Ekledim.', receipts: ['d3 su +0,20 L'] }],
  ...over,
});

Deno.test('Stage A system prompt = understand rules + the registry Turkish doc + few-shots, byte-stable', () => {
  const sys = stageASystemPrompt();
  assertEquals(sys, buildUnderstandPrefix({ registryDoc: buildWriteDoc() }), 'composed from the owners, not re-written here');
  assert(sys.startsWith(UNDERSTAND_RULES));
  assert(sys.includes(buildWriteDoc()));
  assertEquals(stageASystemPrompt(), sys, 'one global cache prefix');
});

Deno.test('Stage A schema is the registry strict understand schema and passes the strict pre-flight', () => {
  const s = stageASchema();
  assertEquals(s.name, SCHEMA_NAMES.understand);
  assertEquals(s.schema, buildUnderstandSchema());
  assertEquals(s.strict, true);
  assertEquals(strictSchemaIssues(s.schema), []);
});

Deno.test('TurnInput block: fixed §4.2 order with the registry block titles; day anchors; "yok" blocks; deterministic', () => {
  const block = renderTurnInputBlock(view({
    pending: [{ ref: 'p1', line: 'constraint_retract · c1 kaldırma' }],
    commitments: [{ ref: 'k1', line: '"akşam 8’den sonra yememe"' }],
    drafts: [{ ref: 'dft1', line: 'beslenme taslağı v3 · bakım 2812 kcal' }],
    active_plans: ['antrenman (hafta 2026-09-28)'],
    gates: ['bekleyen onay: p1 deniz ürünleri alerjisini kaldırma'],
    references: [{ key: 'lahmacun', line: '240 kcal/100 g' }],
    image: true,
  }));
  const T = TURN_BLOCK_TITLES;
  const order = [
    `${T.now}:`, `${T.profile}:`, `${T.gates}:`, `${T.today}:`, `${BLOCK_TITLES.records} (`, `${BLOCK_TITLES.constraints}:`, `${BLOCK_TITLES.pending}:`,
    `${BLOCK_TITLES.commitments}:`, `${BLOCK_TITLES.draft}:`, `${T.active_plan}:`, `${BLOCK_TITLES.references} (`, `${T.image}:`, `${T.last_turn} (`,
    `${T.history}:`,
  ];
  const idx = order.map((h) => block.indexOf(h));
  assert(idx.every((i) => i >= 0), JSON.stringify(idx));
  assertEquals([...idx].sort((a, b) => a - b), idx, 'fixed order');
  // The day anchors f.day() resolves 'today'/'yesterday' against (ported from the shadow renderer).
  assert(block.startsWith('ŞİMDİ: Pazar 4 Eki 2026, saat 21:10 (Europe/Istanbul) · today = 2026-10-04 · yesterday = 2026-10-03'), block.split('\n')[0]);
  assert(block.includes('d3 · bugün su: gün toplamı 3,40 L (son tur)'));
  assert(block.includes('SON TUR (koçun son cevabıyla kaydedilenler): water_log'));
  assert(block.includes('koç: "Ekledim."\n  ⟦d3 su +0,20 L⟧'));
  assertEquals(renderTurnInputBlock(view()), renderTurnInputBlock(view()), 'deterministic');
  // Empty ref blocks still appear ("evet" with no hold is not a confirmation); no YB SEVİYESİ line.
  const empty = renderTurnInputBlock(view({ records: [], constraints: [], profile: [], today: [], history: [], last_turn_writes: [] }));
  for (const b of [`${BLOCK_TITLES.constraints}:\nyok`, `${BLOCK_TITLES.pending}:\nyok`, `${BLOCK_TITLES.commitments}:\nyok`, `${BLOCK_TITLES.draft}:\nyok`, `${T.active_plan}: yok`, `${T.profile}: bilgi yok`]) {
    assert(empty.includes(b), b);
  }
  assert(empty.includes("ref'lerle):\nyok"));
  for (const absent of [`${T.today}:`, `${T.history}:`, `${T.last_turn} (`, 'YB SEVİYESİ', `${T.gates}:`]) assert(!empty.includes(absent), absent);
});

Deno.test('the ED-tier write gate is DERIVED by the renderer (amber / red / unreadable), never passed in', () => {
  for (const tier of ['amber', 'red', 'unknown'] as const) {
    assert(renderTurnInputBlock(view({ ed_tier: tier })).includes(`${TURN_BLOCK_TITLES.gates}: ${TIER_GATE_LINE}`), tier);
  }
  for (const tier of ['none', 'watch'] as const) assert(!renderTurnInputBlock(view({ ed_tier: tier })).includes(TURN_BLOCK_TITLES.gates), tier);
  // Extra gate lines follow the tier gate on the same line.
  assert(renderTurnInputBlock(view({ ed_tier: 'amber', gates: ['bekleyen onay: p1'] })).includes(`${TURN_BLOCK_TITLES.gates}: ${TIER_GATE_LINE} · bekleyen onay: p1`));
});

Deno.test('history: the last few messages, folded onto one line each, length-capped', () => {
  const long = 'çok uzun bir mesaj '.repeat(80);
  const history = Array.from({ length: STAGE_A_HISTORY_MESSAGES + 3 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `m${i}\nikinci satır` }));
  const block = renderTurnInputBlock(view({ history: [...history, { role: 'user', content: long }] }));
  const lines = block.split('\n');
  const start = lines.indexOf(`${TURN_BLOCK_TITLES.history}:`);
  const shown = lines.slice(start + 1).filter((l) => !l.startsWith('  ⟦'));
  assertEquals(shown.length, STAGE_A_HISTORY_MESSAGES, 'oldest dropped first');
  assert(!block.includes('m0 '), 'the oldest turn is out of the window');
  assert(shown.every((l) => !l.includes('\n')) && block.includes('"m6 ikinci satır"'), 'newlines folded');
  assert(shown[shown.length - 1].length < 320 && shown[shown.length - 1].endsWith('…"'), 'a user line is capped');
});

Deno.test('user content = TurnInput block · T2 tripwire facts · the message verbatim (no facts → no block)', () => {
  const benign = scanTripwires('1 bardak su daha içtim');
  const plain = stageAUserContent(view(), benign, '1 bardak su daha içtim');
  assert(plain.endsWith(`${TURN_BLOCK_TITLES.message}:\n1 bardak su daha içtim`));
  assert(!plain.includes('GÜVENLİK TETİKLERİ'));
  const scan = scanTripwires('bu tarife bayıldım!');
  const withFacts = stageAUserContent(view(), scan, 'bu tarife bayıldım!');
  const facts = renderTripwireFacts(scan);
  assert(facts.length > 0 && facts.includes('safety.tripwire_readings'), 'the facts name the schema field the readings go to');
  assert(withFacts.includes(`\n\n${facts}\n\n${TURN_BLOCK_TITLES.message}:`), 'facts sit between the block and the message');
});

Deno.test('§8.4 ONE effort rule: low by default; medium on image, open draft, ANY tripwire fact (declarations too) or ED tier ≥ watch', () => {
  const none = scanTripwires('akşam mercimek çorbası içtim');
  assertEquals(stageAEffort(view(), none), 'low');
  assertEquals(stageAEffort(view({ image: true }), none), 'medium');
  assertEquals(stageAEffort(view({ drafts: [{ ref: 'dft1', line: 'x' }] }), none), 'medium');
  assertEquals(stageAEffort(view({ ed_tier: 'watch' }), none), 'medium');
  assertEquals(stageAEffort(view({ ed_tier: 'unknown' }), none), 'medium', 'an unreadable tier fails closed');
  assertEquals(stageAEffort(view(), scanTripwires('bu tarife bayıldım')), 'medium');
  // The eval used to drop declaration cues ("alerjim var") and grade B+ allergy cases at low while
  // the shadow sent medium. §8.4 "tetik var" counts every fact Stage A is handed — the §7.4 side.
  const decl = scanTripwires('fıstık alerjim var');
  assert(tripwireFacts(decl).length > 0 && tripwireFacts(decl).every((f) => f.category === 'declaration'), 'precondition: a declaration-only scan');
  assertEquals(stageAEffort(view(), decl), 'medium');
});

Deno.test('buildStageARequest is exactly the body ai-decide accepts, max_tokens included (parsed by the real handler parser)', () => {
  const scan = scanTripwires('yok o yanlis, geri al');
  const req = buildStageARequest({ view: view(), scan, message: 'yok o yanlis, geri al', model: 'gpt-5.6-terra' });
  assertEquals(req.cache_key, UNDERSTAND_CACHE_KEY);
  assertEquals(req.effort, 'low');
  assertEquals(req.max_tokens, STAGE_A_MAX_OUTPUT_TOKENS);
  assertEquals(STAGE_A_MAX_OUTPUT_TOKENS, 2500);
  assertEquals(req.input.length, 1);
  assertEquals(Object.keys(req).sort(), ['cache_key', 'effort', 'input', 'max_tokens', 'model', 'schema', 'system'], 'nothing but the body (the replay key hashes it)');
  const parsed = parseDecideRequest(JSON.parse(JSON.stringify(req)));
  assert(parsed.ok, parsed.ok ? '' : `${parsed.error} ${JSON.stringify(parsed.issues)}`);
  if (parsed.ok) {
    assertEquals(parsed.value.schema.name, SCHEMA_NAMES.understand);
    assertEquals(parsed.value.messages[0], { role: 'system', content: stageASystemPrompt() });
    assertEquals(parsed.value.messages[1].content, req.input[0].content);
    assertEquals(parsed.value.cacheKey, UNDERSTAND_CACHE_KEY);
    assertEquals(parsed.value.effort, 'low');
    assertEquals(parsed.value.maxTokens, STAGE_A_MAX_OUTPUT_TOKENS, 'ai-decide forwards the same output budget the shadow uses');
  }
  // The body fits ai-decide's size limit with room to spare.
  assert(JSON.stringify(req).length < 512 * 1024 / 2, `${JSON.stringify(req).length} chars`);
  // composeStageA's sizes describe the very bytes it composed.
  const { request, sizes } = composeStageA({ view: view(), scan, message: 'yok o yanlis, geri al', model: 'gpt-5.6-terra' });
  assertEquals(request, req);
  assertEquals(sizes, { prefix: req.system.length, turn_input: renderTurnInputBlock(view()).length, tripwires: 0, message: 'yok o yanlis, geri al'.length });
});

Deno.test('BYTE IDENTITY: the shadow (understand.ts over stageAView) and the eval (ai-decide body) send the same request to the provider', async () => {
  const ti = await loadTurnInput(fakeTurnInputDb(seedTables()), { userId: USER, now: NOW });
  const v = stageAView(ti);
  for (const msg of ['1 bardak su daha içtim', 'antrenmanda bir an bayılacak gibi oldum', 'fıstık alerjim var']) {
    const scan = scanTripwires(msg);
    // 1. One composition: the shadow's request IS the eval body plus the live call's own knobs.
    const shadowReq = buildUnderstandRequest({ turnInput: ti, message: msg, scan, model: 'gpt-5.6-terra' });
    const evalBody = buildStageARequest({ view: v, scan, message: msg, model: 'gpt-5.6-terra' });
    const { timeoutMs: _t, sizes: _s, ...shadowBody } = shadowReq;
    assertEquals(shadowBody, evalBody, msg);

    // 2. On the wire: what understand() sends == what ai-decide sends for the eval body.
    const decision = sampleDecision();
    const shadowWire = fakeResponses(() => responsesBody(decision));
    const out = await understand(shadowReq, { transport: shadowWire.transport, apiKey: 'k', baseUrl: 'https://api.openai.com/v1' });
    assertEquals(out.status, 'parsed');
    const decideWire = fakeResponses(() => responsesBody(decision));
    const res = await handleDecide(
      new Request('http://localhost/functions/v1/ai-decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sb_secret_test' }, body: JSON.stringify(evalBody),
      }),
      { transport: decideWire.transport, serviceRoleKey: 'sb_secret_test', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', probeBaseUrl: '', probeApiKey: '' },
    );
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(shadowWire.calls.length, 1);
    assertEquals(decideWire.calls.length, 1);
    assertEquals(shadowWire.calls[0].url, decideWire.calls[0].url);
    assertEquals(JSON.stringify(shadowWire.calls[0].body), JSON.stringify(decideWire.calls[0].body), `${msg}: provider bytes differ`);
  }
});
