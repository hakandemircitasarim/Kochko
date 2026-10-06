/**
 * registry.test.ts — the write registry's contract (AI_MIMARI_V2 §4.1, §9.4 paket D).
 *
 *  1. BYTE SNAPSHOT: the strict schemas and the Turkish docs are Stage A/B's cached prefix. Their
 *     bytes may change only together with SCHEMA_VERSION. To accept a deliberate change: bump
 *     SCHEMA_VERSION in registry.ts, then
 *       UPDATE_SNAPSHOTS=1 npx deno test --config supabase/functions/deno.json --allow-env --allow-read --allow-write supabase/functions/shared/write-registry/
 *  2. Strict-mode shape (every object closed, every property required) and provider size limits.
 *  3. Registry integrity: unique ids, a receipt builder and a golden sample for every op.
 *  4. Golden per op: the persisted row == the model's args + the op's declared derive() + listed
 *     lossless normalisations — nothing else (no silent rewrite, §2 rule 1).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { CHANNELS, getOp, opsIn, REGISTRY, SCHEMA_VERSION } from './registry.ts';
import {
  buildFusedSchema, buildReplySchema, buildUnderstandSchema, schemaBytes, schemaStats, SCHEMA_NAMES, strictFormat, type JsonSchema,
} from './schema.ts';
import { buildMemoryDoc, buildWriteDoc } from './doc.ts';
import { STAGE_A_REGISTRY_BUDGET, stageARegistrySize } from './budget.ts';
import { estimateTokens, TR_CHARS_PER_TOKEN } from './tokens.ts';
import { buildCapabilities } from './capabilities.ts';
import { RECEIPT_OPS } from './receipts.ts';
import { validateChannelItems, type WriteVerdict } from './validate.ts';
import { SAMPLE_MESSAGES, SAMPLE_WRITES, sampleContext, sampleDecision, sampleMeal } from './samples.ts';
import { strictSchemaIssues, validateJsonSchema } from '../json-schema-check.ts';
import { ERASE_HOLD_OP } from './ops/pending.ts';
import { isRecord, jsonEqual } from './util.ts';
import { ERASE_OP } from '../erase-hold.ts';
import type { EDTier } from '../safety-state.ts';
import type { EdTier } from './dsl.ts';

// ─── 1. byte snapshots ───────────────────────────────────────────────────────

const SNAP_DIR = new URL('./snapshots/', import.meta.url);
const UPDATE = (() => {
  try {
    return Deno.env.get('UPDATE_SNAPSHOTS') === '1';
  } catch {
    return false;
  }
})();

/** JSON snapshots are stored pretty for review and compared as canonical compact bytes. */
async function snapshotJson(name: string, schema: JsonSchema): Promise<void> {
  const file = new URL(`${name}.${SCHEMA_VERSION}.json`, SNAP_DIR);
  const bytes = schemaBytes(schema);
  if (UPDATE) {
    await Deno.mkdir(SNAP_DIR, { recursive: true });
    await Deno.writeTextFile(file, JSON.stringify(schema, null, 1) + '\n');
    return;
  }
  let stored: string;
  try {
    stored = await Deno.readTextFile(file);
  } catch {
    throw new Error(`snapshot yok: ${file.pathname} — SCHEMA_VERSION=${SCHEMA_VERSION} için UPDATE_SNAPSHOTS=1 ile yaz`);
  }
  assertEquals(bytes, JSON.stringify(JSON.parse(stored)),
    `${name} şemasının baytları değişti ama SCHEMA_VERSION (${SCHEMA_VERSION}) artırılmadı — önbellek öneki kırılır`);
}

async function snapshotText(name: string, text: string): Promise<void> {
  const file = new URL(`${name}.${SCHEMA_VERSION}.txt`, SNAP_DIR);
  if (UPDATE) {
    await Deno.mkdir(SNAP_DIR, { recursive: true });
    await Deno.writeTextFile(file, text + '\n');
    return;
  }
  let stored: string;
  try {
    stored = await Deno.readTextFile(file);
  } catch {
    throw new Error(`snapshot yok: ${file.pathname} — SCHEMA_VERSION=${SCHEMA_VERSION} için UPDATE_SNAPSHOTS=1 ile yaz`);
  }
  // git may check text out with CRLF on Windows; the cached bytes are the LF form.
  assertEquals(text, stored.replace(/\r\n/g, '\n').replace(/\n$/, ''),
    `${name} metni değişti ama SCHEMA_VERSION (${SCHEMA_VERSION}) artırılmadı — önbellek öneki kırılır`);
}

Deno.test('snapshot: understand schema bytes are pinned to SCHEMA_VERSION', () => snapshotJson('understand', buildUnderstandSchema()));
Deno.test('snapshot: fused (single-call) schema bytes are pinned to SCHEMA_VERSION', () => snapshotJson('fused', buildFusedSchema()));
Deno.test('snapshot: reply schema bytes are pinned to SCHEMA_VERSION', () => snapshotJson('reply', buildReplySchema()));
Deno.test('snapshot: Stage A Turkish write doc is pinned to SCHEMA_VERSION', () => snapshotText('doc', buildWriteDoc()));
Deno.test('snapshot: memory doc + capabilities are pinned to SCHEMA_VERSION', async () => {
  await snapshotText('memory-doc', buildMemoryDoc());
  await snapshotText('capabilities', buildCapabilities());
});

Deno.test('generators are deterministic (same registry → same bytes)', () => {
  assertEquals(schemaBytes(buildUnderstandSchema()), schemaBytes(buildUnderstandSchema()));
  assertEquals(schemaBytes(buildFusedSchema()), schemaBytes(buildFusedSchema()));
  assertEquals(buildWriteDoc(), buildWriteDoc());
});

// ─── 2. strict-mode shape and provider limits ────────────────────────────────

function walkSchema(node: unknown, path: string, visit: (n: JsonSchema, path: string) => void): void {
  if (!isRecord(node)) return;
  visit(node, path);
  if (isRecord(node.properties)) for (const [k, v] of Object.entries(node.properties)) walkSchema(v, `${path}.${k}`, visit);
  if (node.items) walkSchema(node.items, `${path}[]`, visit);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((b, i) => walkSchema(b, `${path}|${i}`, visit));
  if (isRecord(node.$defs)) for (const [k, v] of Object.entries(node.$defs)) walkSchema(v, `$defs.${k}`, visit);
}

for (const [name, build] of [['understand', buildUnderstandSchema], ['fused', buildFusedSchema], ['reply', buildReplySchema]] as const) {
  Deno.test(`strict mode: every ${name} object is closed and lists every property as required`, () => {
    const root = build();
    assertEquals(root.type, 'object', 'root must be an object (never anyOf)');
    assert(!('anyOf' in root));
    let objects = 0;
    walkSchema(root, name, (n, path) => {
      const isObj = n.type === 'object';
      if (isObj) {
        objects++;
        assertEquals(n.additionalProperties, false, `${path}: additionalProperties must be false`);
        assertEquals(n.required, Object.keys(n.properties as object), `${path}: every property must be required`);
      }
      if (Array.isArray(n.type)) assert(n.type.length === 2 && n.type[1] === 'null', `${path}: unions are only "x | null"`);
      if (Array.isArray(n.enum) && Array.isArray(n.type)) assert(n.enum.includes(null), `${path}: nullable enum must list null`);
      for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'default']) {
        assert(!(banned in n), `${path}: "${banned}" would let the provider clamp silently — ranges belong to the validator`);
      }
    });
    assert(objects > 3);
  });

  Deno.test(`strict mode: ${name} schema fits the provider's limits`, () => {
    const s = schemaStats(build());
    assert(s.properties <= 5000, `properties ${s.properties}`);
    assert(s.maxDepth <= 5, `object nesting ${s.maxDepth} (conservative limit 5)`);
    assert(s.enumValues <= 1000, `enum values ${s.enumValues}`);
    assert(s.stringChars <= 15000, `name/enum string budget ${s.stringChars} (conservative limit 15000)`);
  });
}

Deno.test('writes[] and record_ops.update.patch share ONE $defs write union (no copy)', () => {
  const s = buildUnderstandSchema() as { $defs: { write: { anyOf: JsonSchema[] } }; properties: Record<string, JsonSchema> };
  assertEquals((s.properties.writes.items as JsonSchema).$ref, '#/$defs/write');
  const wires = s.$defs.write.anyOf.map((b) => ((b.properties as Record<string, { enum: string[] }>).op.enum[0]));
  assertEquals(wires, opsIn('writes').map((o) => o.op));
  const recBranches = ((s.properties.record_ops.items as JsonSchema).anyOf as JsonSchema[]);
  const update = recBranches.find((b) => (b.properties as Record<string, { enum?: string[] }>).op.enum?.[0] === 'update')!;
  assertEquals((update.properties as Record<string, JsonSchema>).patch.$ref, '#/$defs/write');
});

Deno.test('shared vocabularies are emitted once under $defs and referenced (allergens ×4, body parts) — never copied', () => {
  const s = buildUnderstandSchema() as { $defs: Record<string, JsonSchema> };
  assertEquals(Object.keys(s.$defs), ['write', 'allergens', 'body_parts']);
  const bytes = schemaBytes(buildUnderstandSchema());
  assertEquals(bytes.split('"#/$defs/allergens"').length - 1, 4, 'meal allergens/may_contain + supplement allergens/may_contain');
  assertEquals(bytes.split('"enum":["gluten"').length - 1, 1, 'the allergen id list appears exactly once');
  const r = buildReplySchema() as { $defs?: Record<string, JsonSchema> };
  assertEquals(Object.keys(r.$defs ?? {}), ['allergens', 'body_parts'], 'suggested_foods/exercises use the same vocabularies');
});

Deno.test('the slimmed schemas pass the strict-mode lint and accept every golden sample (shared $defs resolve)', () => {
  for (const s of [buildUnderstandSchema(), buildFusedSchema(), buildReplySchema()]) assertEquals(strictSchemaIssues(s), []);
  const byChannel = (ch: string) => REGISTRY.filter((o) => o.channel === ch).map((o) => SAMPLE_WRITES[o.type]);
  const decision = sampleDecision({
    writes: byChannel('writes'), record_ops: byChannel('record_ops'), pending_ops: byChannel('pending_ops'), commitment_ops: byChannel('commitment_ops'),
  });
  assertEquals(validateJsonSchema(buildUnderstandSchema(), decision, { maxIssues: 50 }), []);
  // …and still rejects what strict decoding could never produce.
  const bad = sampleDecision({ writes: [{ ...SAMPLE_WRITES.meal_log, items: [{ ...(SAMPLE_WRITES.meal_log.items as object[])[0], allergens: ['fındık'] }] }] });
  assert(validateJsonSchema(buildUnderstandSchema(), bad).length > 0, 'an allergen outside the vocabulary is not schema-valid');
});

// ─── 2b. Stage A budget (§3.3, §4.1) ─────────────────────────────────────────

Deno.test('Stage A budget: generated doc + strict schema stay within the prompt budget (the shared chars/3.2 estimate)', () => {
  const s = stageARegistrySize();
  const b = STAGE_A_REGISTRY_BUDGET;
  const report = `doc ${s.doc_chars} kr ≈ ${s.doc_tokens} tok · şema ${s.schema_chars} kr ≈ ${s.schema_tokens} tok · toplam ≈ ${s.total_tokens} tok`;
  console.log(`[Stage A kayıt öneki] ${report}`);
  assert(s.doc_tokens <= b.doc.ceiling, `doc ${s.doc_tokens} > ${b.doc.ceiling} (§4.1 ~3,1K) — ${report}`);
  assert(s.doc_tokens >= b.doc.floor, `doc ${s.doc_tokens} < ${b.doc.floor}: the model must see what it may write — ${report}`);
  assert(s.schema_tokens <= b.schema.ceiling, `schema ${s.schema_tokens} > ${b.schema.ceiling} — ${report}`);
  assert(s.total_tokens <= b.total.ceiling, `doc+schema ${s.total_tokens} > ${b.total.ceiling} — ${report}`);
  assert(b.doc.ceiling + b.schema.ceiling >= b.total.ceiling, 'the total ceiling is never looser than its parts');
});

Deno.test('one token estimate: the registry budget and the v2 brain prompts measure with the same function', async () => {
  // Two ratios (3.6 here, 3.2 for the brain) let the same doc pass one ceiling and fail the other.
  const brain = await import('../../ai-chat/v2/prompt-size.ts');
  assertEquals(brain.TR_CHARS_PER_TOKEN, TR_CHARS_PER_TOKEN);
  assertEquals(brain.estimateTokens, estimateTokens, 'prompt-size.ts re-exports the registry estimate, it does not define one');
  const s = stageARegistrySize();
  assertEquals(s.doc_tokens, estimateTokens(buildWriteDoc()));
  assertEquals(s.schema_tokens, estimateTokens(schemaBytes(buildUnderstandSchema())));
  assertEquals(estimateTokens(''), 0);
  assertEquals(estimateTokens('x'.repeat(32)), 10);
  assertEquals(estimateTokens('x'.repeat(33)), 11, 'rounds up');
});

Deno.test('understand envelope is decision-first; fused puts suggested_* before the prose', () => {
  const u = Object.keys(buildUnderstandSchema().properties as object);
  assertEquals(u, ['intent', 'safety', 'writes', 'record_ops', 'pending_ops', 'commitment_ops', 'plan_action', 'simulation', 'clarify', 'reply_route', 'self_check']);
  const fz = Object.keys(buildFusedSchema().properties as object);
  assertEquals(fz.slice(0, u.length), u);
  assertEquals(fz.slice(u.length), ['suggested_foods', 'suggested_exercises', 'reply', 'why', 'memory', 'ui', 'referral_included']);
  assert(!('memory' in (buildUnderstandSchema().properties as object)), 'Stage A never writes memory');
});

Deno.test('strictFormat names carry SCHEMA_VERSION (Responses text.format, strict)', () => {
  const fmt = strictFormat('understand');
  assertEquals(fmt.name, `kochko_understand_${SCHEMA_VERSION}`);
  assertEquals(fmt.strict, true);
  assertEquals(fmt.type, 'json_schema');
  assertEquals(SCHEMA_NAMES.fused, `kochko_fused_${SCHEMA_VERSION}`);
});

// ─── 3. registry integrity ───────────────────────────────────────────────────

Deno.test('registry: unique ids, unique wire ops per channel, every channel populated', () => {
  const types = REGISTRY.map((o) => o.type);
  assertEquals(new Set(types).size, types.length);
  for (const ch of CHANNELS) {
    const wires = opsIn(ch).map((o) => o.op);
    assert(wires.length > 0, `${ch} has no ops`);
    assertEquals(new Set(wires).size, wires.length, `${ch}: duplicate wire op`);
  }
});

Deno.test('registry: covers every chat write path of map-writes (incl. data_erase, record_ops, commitments)', () => {
  for (const t of [
    'meal_log', 'water_log', 'body_weight', 'sleep_log', 'mood_log', 'step_log', 'workout_log', 'supplement_log', 'profile_set',
    'goal_set', 'constraint_add', 'constraint_retract', 'constraint_confirm', 'food_pref', 'life_event', 'lab_value', 'recipe_save',
    'periodic_state', 'target_change', 'data_erase_request', 'record_delete', 'record_update', 'record_restore_metric',
    'pending_confirm', 'pending_discard', 'commitment_add', 'commitment_resolve', 'memory_note',
  ]) assert(getOp(t), `missing op ${t}`);
});

Deno.test('registry: every op has a receipt builder and a golden sample', () => {
  for (const o of REGISTRY) {
    assert(RECEIPT_OPS.includes(o.type), `${o.type}: no receipt builder`);
    assert(SAMPLE_WRITES[o.type], `${o.type}: no sample in samples.ts`);
    assertEquals(SAMPLE_WRITES[o.type].op, o.op, `${o.type}: sample wire op`);
  }
});

Deno.test('registry: every op declares when it applies, a writer, an undo mode and Turkish text', () => {
  for (const o of REGISTRY) {
    assert(o.when_tr.length > 10, `${o.type}: when_tr`);
    assert(o.writes.rpc || o.writes.fn, `${o.type}: no writer`);
    assert(o.writes.tables.length > 0, `${o.type}: no tables`);
    assert(/[çğıöşüÇĞİÖŞÜ]/.test(o.when_tr + o.title_tr), `${o.type}: Turkish text without diacritics`);
  }
});

Deno.test('KVKK erase hold op name matches shared/erase-hold.ts (one name, two owners)', () => {
  assertEquals(ERASE_HOLD_OP, ERASE_OP);
  assertEquals(getOp('data_erase_request')!.writes.hold_op, ERASE_OP);
});

Deno.test('EdTier is safety-state EDTier + "unknown" (fail-closed read)', () => {
  const t: EDTier = 'amber';
  const ours: EdTier = t; // compile-time: every EDTier is an EdTier
  assertEquals(ours, 'amber');
});

// ─── 4. golden per op: row == args + derive() + normalized ───────────────────

function leaves(v: unknown, path = '', out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (Array.isArray(v)) {
    if (v.length === 0) out.push([path, v]);
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  } else if (isRecord(v)) {
    const keys = Object.keys(v);
    if (keys.length === 0) out.push([path, v]);
    for (const k of keys) leaves(v[k], path ? `${path}.${k}` : k, out);
  } else {
    out.push([path, v]);
  }
  return out;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.match(/[^.[\]]+/g) ?? []) {
    if (Array.isArray(cur)) cur = cur[Number(k)];
    else if (isRecord(cur)) cur = cur[k];
    else return undefined;
  }
  return cur;
}

/**
 * Every stored leaf is the model's, or declared derive() output, or a listed normalisation. A
 * normalised path may be overridden only by derive()'s own arithmetic (a picked reference's kcal),
 * never by an echo of the model's raw, un-normalised value (that is the 22P02 column failure).
 */
function assertNothingRewritten(v: WriteVerdict): void {
  assert(v.row, `${v.op}: no row`);
  const derivedPaths = new Map(leaves(v.derived));
  const norm = new Map(v.normalized.map((n) => [n.path, n]));
  for (const [path, val] of leaves(v.row)) {
    const n = norm.get(path);
    if (derivedPaths.has(path)) {
      assert(jsonEqual(val, derivedPaths.get(path)), `${v.op}.${path}: row ≠ derive()`);
      if (n) assert(val !== n.from, `${v.op}.${path}: derive() re-emitted the un-normalised ${n.from} (row must carry ${n.to})`);
    } else if (n) {
      assertEquals(val, n.to, `${v.op}.${path}: row ≠ normalized`);
    } else {
      assert(jsonEqual(val, getPath(v.args, path)), `${v.op}.${path}: ${JSON.stringify(val)} is neither the model's value nor declared`);
    }
  }
  for (const n of v.normalized) assertEquals(getPath(v.args, n.path), n.from, `${v.op}.${n.path}: normalisation 'from' must be the model's value`);
}

Deno.test('golden meal_log with fractional model numbers: the row carries the column fits (313, 16.4), derive() does not undo them', () => {
  const ctx = sampleContext();
  const v = validateChannelItems('writes', [sampleMeal([{ kcal: 312.5, protein_g: 16.37 }])], ctx)[0];
  assert(v.verdict === 'COMMIT' || v.verdict === 'FLAG', JSON.stringify(v.issues));
  assert(v.normalized.length >= 2);
  assertNothingRewritten(v);
});

for (const o of REGISTRY) {
  Deno.test(`golden ${o.type}: sample validates and the row is args + derive (nothing else)`, () => {
    const ctx = sampleContext({ user_message: SAMPLE_MESSAGES[o.type] ?? '' });
    const sample = structuredClone(SAMPLE_WRITES[o.type]);
    const before = JSON.stringify(sample);
    const verdicts = validateChannelItems(o.channel, [sample], ctx);
    assertEquals(JSON.stringify(sample), before, `${o.type}: validator mutated the model's decision`);
    assert(verdicts.length >= 1);
    for (const v of verdicts) {
      assert(v.verdict !== 'REJECT', `${o.type}: sample rejected: ${JSON.stringify(v.issues)}`);
      assertEquals(v.op, o.type);
      if (v.verdict === 'COMMIT' || v.verdict === 'FLAG') assertNothingRewritten(v);
      else assertEquals(v.row, null);
      const { op: _wire, ...modelArgs } = v.args;
      for (const k of Object.keys(o.fields)) assert(k in modelArgs, `${o.type}: args lost field ${k}`);
    }
  });
}
