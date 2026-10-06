/**
 * doc.test.ts — the Turkish doc Stage A reads and the coach's capability list are generated from
 * the registry and say what the schema and the validator actually do (AI_MIMARI_V2 §4.2). Field
 * semantics live ONCE: in this doc for Stage A (the understand schema has no descriptions), as
 * schema descriptions for the reply side (no generated doc there).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildMemoryDoc, buildWriteDoc } from './doc.ts';
import { buildCapabilities, firstSentence } from './capabilities.ts';
import { opsIn, REGISTRY, SCHEMA_VERSION } from './registry.ts';
import { UNIT_ML } from './units.ts';
import { BLOCK_TITLES } from './refs.ts';
import { ENVELOPE_HEAD, ENVELOPE_TAIL } from './envelope.ts';
import { buildReplySchema, buildUnderstandSchema } from './schema.ts';
import type { Fields } from './dsl.ts';
import { DIETARY_SUBJECTS } from './vocab.ts';

const doc = buildWriteDoc();

/** The text of one op's section ("### op" up to the next heading). */
function section(op: string): string {
  const start = doc.indexOf(`\n### ${op}\n`);
  assert(start >= 0, `no section for ${op}`);
  const rest = doc.slice(start + 1);
  const end = rest.search(/\n##/);
  return end < 0 ? rest : rest.slice(0, end);
}

Deno.test('doc: names the schema version; every Stage A op is documented (full section or a rare one-liner); memory lives in the coach doc', () => {
  assert(doc.startsWith(`YAZILABİLİR KAYITLAR (şema kochko_understand_${SCHEMA_VERSION})`));
  for (const o of REGISTRY) {
    const section = doc.includes(`\n### ${o.op}\n`);
    const rare = doc.includes(`\n- ${o.op}${o.channel === 'writes' ? '' : ` (${o.channel})`}: `);
    if (o.channel === 'memory') assert(!section && !rare, `${o.type} must not be in the Stage A doc`);
    else assertEquals([section, rare], [o.tier !== 'rare', o.tier === 'rare'], o.type);
  }
  for (const o of opsIn('memory')) assert(buildMemoryDoc().includes(`### ${o.op}`));
});

Deno.test('doc: the units the model reads are generated from the table derive() multiplies by (one table)', () => {
  for (const u of ['bardak', 'su_bardagi', 'cay_bardagi', 'kupa'] as const) assert(doc.includes(`${u} ${UNIT_ML[u]} ml`), u);
  assert(doc.includes('1 bardak su daha içtim'));
  assert(doc.includes('+0,20 L'));
});

Deno.test('doc: says what code computes and what is two-step — and that nothing is silently changed', () => {
  assert(doc.includes('hiçbir sayını sessizce değiştirmez'));
  assert(doc.includes('2 çimdik'));
  assert(doc.includes('basis=suspicious'), 'the suspicious-record path is documented');
  for (const o of ['constraint_retract', 'data_erase_request', 'update']) assert(section(o).includes('İki adım:'), `${o}: two-step policy`);
  assert(section('water_log').includes('Kod: litre = quantity'), 'what code computes is stated where it applies');
  assert(doc.includes('ALERJENLER: gluten'));
  assert(doc.includes('peanut (yer fıstığı)') && doc.includes('pistachio (antep fıstığı)'), 'the ambiguous "fıstık" ids carry their hint');
  assert(doc.includes('BÖLGELER: knee=diz'));
  for (const d of Object.keys(DIETARY_SUBJECTS)) assert(doc.includes(d), `dietary id ${d} is listed for constraint_add.subject_id`);
});

Deno.test('doc: plausibility thresholds are not advertised (the model gives its honest estimate; code decides)', () => {
  for (const t of ['2500', '1,5 L', '%35', '%25', '9,5']) assert(!doc.includes(t), `threshold "${t}" leaked into the Stage A doc`);
});

Deno.test('doc: every block heading the op texts mention is declared in BLOCK_TITLES (the input renderer uses the same words)', () => {
  for (const t of Object.values(BLOCK_TITLES)) assert(doc.includes(t), t);
  for (const word of ['KAYITLAR’', 'KISITLAR’', 'BEKLEYEN ONAYLAR’', 'AÇIK SÖZLER’', 'REFERANS ADAYLARI']) {
    assert(Object.values(BLOCK_TITLES).some((t) => word.startsWith(t)), `op text mentions "${word}" without a BLOCK_TITLES entry`);
  }
  assert(!/KAYITLAR’da c-ref|KAYITLAR’daki bir kısıt/.test(doc), 'c-refs live in KISITLAR, not KAYITLAR');
});

/** Every field note (`tr`) and explained enum meaning of `fields`, recursively. */
function semantics(fields: Fields, out: string[] = []): string[] {
  for (const s of Object.values(fields)) {
    if (s.tr) out.push(s.tr);
    if (s.kind === 'enum' && s.explain) for (const [id, tr] of Object.entries(s.values)) out.push(tr === id ? id : `${id}=${tr}`);
    if (s.kind === 'list' || s.kind === 'obj') semantics(s.fields, out);
  }
  return out;
}

Deno.test('semantics live once: the understand schema has no descriptions, and every Stage A field note is in the doc', () => {
  assert(!JSON.stringify(buildUnderstandSchema()).includes('"description"'), 'understand schema must not repeat the doc');
  for (const o of REGISTRY.filter((x) => x.channel !== 'memory')) {
    for (const t of semantics(o.fields)) assert(doc.includes(t), `${o.type}: note "${t}" missing from the doc`);
    if (o.derive_tr) assert(doc.includes(o.derive_tr), `${o.type}: derive_tr missing`);
    if (o.hold_tr) assert(doc.includes(o.hold_tr), `${o.type}: hold_tr missing`);
  }
  for (const t of semantics({ ...ENVELOPE_HEAD, ...ENVELOPE_TAIL })) assert(doc.includes(t), `envelope note "${t}" missing`);
  // The reply side (Stage B) has no generated doc: its notes stay as schema descriptions.
  assert(JSON.stringify(buildReplySchema()).includes('"description"'));
});

Deno.test('capabilities: one line per op, no internal field names, abbreviations do not cut sentences', () => {
  const cap = buildCapabilities();
  assert(cap.startsWith('BU UYGULAMADA GERÇEKTEN YAPABİLDİKLERİN'));
  assert(!/basis=|scope account|pending_ops|record_ops|day =/.test(cap), cap);
  assert(cap.includes('- Kaydı düzelt: Yanlış bir kaydı düzeltmek; fark ettiğin şüpheli bir geçmiş kaydı'));
  assert(cap.includes('Burada olmayan bir değişikliği yaptığını ya da yapacağını söyleme.'));
  assertEquals(firstSentence('Kan tahlili vb. sonuçları paylaşıyorsa. İkinci cümle.'), 'Kan tahlili vb. sonuçları paylaşıyorsa.');
  assertEquals(firstSentence('Tek cümle'), 'Tek cümle');
});
