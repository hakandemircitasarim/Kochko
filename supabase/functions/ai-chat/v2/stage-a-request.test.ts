import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildStageARequest, hasSafetyTrigger, renderTurnInputBlock, stageAEffort, type StageATurnView, stageASchema, stageASystemPrompt,
  stageAUserContent, TURN_BLOCK_TITLES,
} from './stage-a-request.ts';
import { buildUnderstandPrefix, UNDERSTAND_CACHE_KEY, UNDERSTAND_RULES } from './understand-prompt.ts';
import { BLOCK_TITLES, buildUnderstandSchema, buildWriteDoc, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { renderTripwireFacts, scanTripwires } from '../../shared/safety-tripwires.ts';
import { strictSchemaIssues } from '../../shared/json-schema-check.ts';
import { parseDecideRequest } from '../../ai-decide/handler.ts';

const view = (over: Partial<StageATurnView> = {}): StageATurnView => ({
  now: { local_date: '2026-10-04', weekday_tr: 'Pazar', local_time: '21:10', tz: 'Europe/Istanbul' },
  ed_tier: 'none',
  profile: [['gender', 'male'], ['weight_kg', '78.2']],
  constraints: [{ ref: 'c1', line: 'allergen · deniz ürünleri · moderate · self · aktif' }],
  records: [{ ref: 'd3', line: 'su +0,20 L → gün 3,4 L', last_turn: true }, { ref: 'm30', line: 'Paz 4 Eki akşam · mercimek çorbası 165 kcal' }],
  today: ['su 3,20 L'],
  pending: [],
  commitments: [],
  draft: null,
  gates: [],
  references: [],
  image: false,
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

Deno.test('TurnInput block uses the registry block titles verbatim (the doc points at real blocks)', () => {
  const block = renderTurnInputBlock(view({
    pending: [{ ref: 'p1', line: 'constraint_retract · c1 kaldırma' }],
    commitments: [{ ref: 'k1', line: 'akşam 8’den sonra yememe' }],
    draft: { ref: 'dft1', line: 'diet v3 · bakım 2812 kcal' },
    gates: ['kalori hedefi düşürme: KAPALI (YB amber)'],
    references: [{ key: 'lahmacun', line: '240 kcal/100 g' }],
    image: true,
  }));
  const order = [
    `${TURN_BLOCK_TITLES.now}:`, `${TURN_BLOCK_TITLES.tier}:`, `${TURN_BLOCK_TITLES.profile}:`, `${BLOCK_TITLES.constraints}:`, `${BLOCK_TITLES.records}:`,
    `${TURN_BLOCK_TITLES.today}:`, `${BLOCK_TITLES.pending}:`, `${BLOCK_TITLES.commitments}:`, `${BLOCK_TITLES.draft}:`, `${TURN_BLOCK_TITLES.gates}:`,
    BLOCK_TITLES.references, `${TURN_BLOCK_TITLES.image}:`, `${TURN_BLOCK_TITLES.history}:`,
  ];
  const idx = order.map((h) => block.indexOf(h));
  assert(idx.every((i) => i >= 0), JSON.stringify(idx));
  assertEquals([...idx].sort((a, b) => a - b), idx, 'fixed order');
  assert(block.includes('d3 · su +0,20 L → gün 3,4 L (son tur)'));
  assert(block.includes('  ⟦d3 su +0,20 L⟧'));
  assertEquals(renderTurnInputBlock(view()), renderTurnInputBlock(view()), 'deterministic');
});

Deno.test('user content = TurnInput block · T2 tripwire facts · the message verbatim (no facts → no block)', () => {
  const benign = scanTripwires('1 bardak su daha içtim');
  const plain = stageAUserContent(view(), benign, '1 bardak su daha içtim');
  assert(plain.endsWith(`${TURN_BLOCK_TITLES.message}:\n1 bardak su daha içtim`));
  assert(!plain.includes('GÜVENLİK TETİKLERİ'));
  const scan = scanTripwires('bu tarife bayıldım!');
  const withFacts = stageAUserContent(view(), scan, 'bu tarife bayıldım!');
  const facts = renderTripwireFacts(scan);
  assert(facts.length > 0);
  assert(withFacts.includes(`\n\n${facts}\n\n${TURN_BLOCK_TITLES.message}:`), 'facts sit between the block and the message');
});

Deno.test('§8.4 effort: low by default; medium on image, open draft, a safety trigger or ED tier ≥ watch (unknown fails closed)', () => {
  const none = scanTripwires('akşam mercimek çorbası içtim');
  assertEquals(stageAEffort(view(), none), 'low');
  assertEquals(stageAEffort(view({ image: true }), none), 'medium');
  assertEquals(stageAEffort(view({ draft: { ref: 'dft1', line: 'x' } }), none), 'medium');
  assertEquals(stageAEffort(view({ ed_tier: 'watch' }), none), 'medium');
  assertEquals(stageAEffort(view({ ed_tier: 'unknown' }), none), 'medium');
  const trig = scanTripwires('bu tarife bayıldım');
  assert(hasSafetyTrigger(trig));
  assertEquals(stageAEffort(view(), trig), 'medium');
  // A declaration cue ("alerjim var") is a fact for the backstop, not a safety trigger to read.
  const decl = scanTripwires('fıstık alerjim var');
  assert(decl.hits.length > 0 && !hasSafetyTrigger(decl));
  assertEquals(stageAEffort(view(), decl), 'low');
});

Deno.test('buildStageARequest is exactly the body ai-decide accepts (parsed by the real handler parser)', () => {
  const scan = scanTripwires('yok o yanlis, geri al');
  const req = buildStageARequest({ view: view(), scan, message: 'yok o yanlis, geri al', model: 'gpt-5.6-terra' });
  assertEquals(req.cache_key, UNDERSTAND_CACHE_KEY);
  assertEquals(req.effort, 'low');
  assertEquals(req.input.length, 1);
  const parsed = parseDecideRequest(JSON.parse(JSON.stringify(req)));
  assert(parsed.ok, parsed.ok ? '' : `${parsed.error} ${JSON.stringify(parsed.issues)}`);
  if (parsed.ok) {
    assertEquals(parsed.value.schema.name, SCHEMA_NAMES.understand);
    assertEquals(parsed.value.messages[0], { role: 'system', content: stageASystemPrompt() });
    assertEquals(parsed.value.messages[1].content, req.input[0].content);
    assertEquals(parsed.value.cacheKey, UNDERSTAND_CACHE_KEY);
    assertEquals(parsed.value.effort, 'low');
  }
  // The body fits ai-decide's size limit with room to spare.
  assert(JSON.stringify(req).length < 512 * 1024 / 2, `${JSON.stringify(req).length} chars`);
});
