/**
 * doc.test.ts — the Turkish doc Stage A reads and the coach's capability list are generated from
 * the registry and say what the schema and the validator actually do (AI_MIMARI_V2 §4.2).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { buildMemoryDoc, buildWriteDoc } from './doc.ts';
import { buildCapabilities, firstSentence } from './capabilities.ts';
import { opsIn, REGISTRY, SCHEMA_VERSION } from './registry.ts';
import { LIQUID_UNIT_TR } from './units.ts';
import { BLOCK_TITLES } from './refs.ts';

const doc = buildWriteDoc();

Deno.test('doc: names the schema version and has a section for every Stage A op (memory lives in the coach doc)', () => {
  assert(doc.startsWith(`YAZILABİLİR KAYITLAR (şema kochko_understand_${SCHEMA_VERSION})`));
  for (const o of REGISTRY) {
    const inStageA = o.channel !== 'memory';
    assertEquals(doc.includes(`### ${o.op} — ${o.title_tr}`), inStageA, o.type);
  }
  for (const o of opsIn('memory')) assert(buildMemoryDoc().includes(`### ${o.op} — ${o.title_tr}`));
});

Deno.test('doc: the units the model reads are the ones derive() multiplies by (one table)', () => {
  assert(doc.includes(`bardak=${LIQUID_UNIT_TR.bardak}`));
  assert(doc.includes('bardak ≈200 ml'));
  assert(doc.includes('1 bardak su daha içtim'));
  assert(doc.includes('+0,20 L'));
});

Deno.test('doc: tells the model what is held, rejected and flagged — and that nothing is silently changed', () => {
  assert(doc.includes('Kod hiçbir sayını sessizce değiştirmez'));
  assert(doc.includes('Sorulur (yazılmaz, bekletilir): tek seferde 1,5 L üstü'));
  assert(doc.includes('2 çimdik'));
  assert(doc.includes('basis=suspicious'), 'the suspicious-record path is documented');
  assert(doc.includes('ALERJENLER: gluten='));
  assert(doc.includes('BÖLGELER: knee=diz'));
});

Deno.test('doc: every block heading the op texts mention is declared in BLOCK_TITLES (the input renderer uses the same words)', () => {
  for (const t of Object.values(BLOCK_TITLES)) assert(doc.includes(t), t);
  for (const word of ['KAYITLAR’', 'BEKLEYEN ONAYLAR’', 'AÇIK SÖZLER’', 'REFERANS ADAYLARI']) {
    assert(Object.values(BLOCK_TITLES).some((t) => word.startsWith(t)), `op text mentions "${word}" without a BLOCK_TITLES entry`);
  }
});

Deno.test('doc: field meanings are not duplicated (they travel as schema descriptions)', () => {
  assert(!doc.includes('kullanıcının söylediği sayı, seçtiğin birimde'), 'water.quantity description belongs to the schema');
  assert(doc.includes('quantity(0–50)'));
});

Deno.test('capabilities: one line per op, no internal field names, abbreviations do not cut sentences', () => {
  const cap = buildCapabilities();
  assert(cap.startsWith('BU UYGULAMADA GERÇEKTEN YAPABİLDİKLERİN'));
  assert(!/basis=|scope account|pending_ops|record_ops/.test(cap), cap);
  assert(cap.includes('- Kaydı düzelt: Yanlış bir kaydı düzeltmek; fark ettiğin şüpheli bir geçmiş kaydı'));
  assert(cap.includes('Burada olmayan bir değişikliği yaptığını ya da yapacağını söyleme.'));
  assertEquals(firstSentence('Kan tahlili vb. sonuçları paylaşıyorsa. İkinci cümle.'), 'Kan tahlili vb. sonuçları paylaşıyorsa.');
  assertEquals(firstSentence('Tek cümle'), 'Tek cümle');
});
