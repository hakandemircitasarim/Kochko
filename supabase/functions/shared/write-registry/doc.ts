/**
 * write-registry/doc.ts — the Turkish "YAZILABİLİR KAYITLAR" block Stage A reads (§4.2 (2)).
 *
 * Generated from the same declarations as the schema, so the doc can never promise a field the
 * schema lacks or describe a unit the derive() does not use. It is part of Stage A's cached,
 * byte-identical prefix: same registry → same bytes (pinned by the snapshot test).
 */
import { MAX_BACK_DAYS, type Channel, type FieldSpec, type Fields, type RegOp } from './dsl.ts';
import { ENVELOPE_HEAD, ENVELOPE_TAIL } from './envelope.ts';
import { BLOCK_REF_KINDS, BLOCK_TITLES, REF_KINDS } from './refs.ts';
import { opsIn, SCHEMA_VERSION } from './registry.ts';
import { ALLERGENS, BODY_PARTS } from './vocab.ts';
import { trNum } from './util.ts';

const CHANNEL_TITLES: Record<Channel, string> = {
  writes: 'writes[] — kullanıcının bildirdikleri',
  record_ops: 'record_ops[] — KAYITLAR’daki bir kaydı ref ile geri al / düzelt',
  pending_ops: 'pending_ops[] — BEKLEYEN ONAYLAR’a cevap',
  commitment_ops: 'commitment_ops[] — sözler',
  memory: 'memory[] — koçun hafıza notları',
};

function enumText(values: Readonly<Record<string, string>>): string {
  if (values === ALLERGENS) return 'ALERJENLER listesinden id';
  if (values === BODY_PARTS) return 'BÖLGELER listesinden id';
  const entries = Object.entries(values);
  if (entries.length > 15) return 'id (aşağıdaki listeden)';
  return entries.map(([id, tr]) => `${id}=${tr}`).join(' · ');
}

function range(r: readonly [number, number] | undefined): string {
  return r ? ` ${trNum(r[0], r[0] % 1 ? 1 : 0)}–${trNum(r[1], r[1] % 1 ? 1 : 0)}` : '';
}

/**
 * Compact field notation — only what the schema itself cannot say (ranges, units, enum meanings,
 * formats). Each field's own meaning (`tr`) already travels as the schema `description`; repeating
 * it here would double the cached prefix for nothing.
 */
function fieldInline(name: string, s: FieldSpec): string {
  const opt = 'nullable' in s && s.nullable ? '|null' : '';
  const wrap = (detail: string) => (detail ? `${name}(${detail})` : name);
  switch (s.kind) {
    case 'num':
      return wrap(`${range(s.hard).trim()}${s.unit ? ' ' + s.unit : ''}${s.decimals === 0 ? ' tam' : ''}${opt}`.trim());
    case 'text':
      return wrap(`${s.format === 'hhmm' ? 'HH:MM' : ''}${opt}`);
    case 'bool':
      return wrap(`true/false${opt}`);
    case 'enum':
      return wrap(`${enumText(s.values)}${opt}`);
    case 'enumList':
      return wrap(`liste: ${enumText(s.values)}`);
    case 'textList':
      return wrap('metin listesi');
    case 'day':
      return wrap(`gün${opt}`);
    case 'date':
      return wrap(`YYYY-MM-DD${opt}`);
    case 'ref':
      return wrap(`${s.kinds.join('|')}-ref${opt}`);
    case 'list':
      return `${name}[${s.min}–${s.max}]{ ${fieldsInline(s.fields)} }`;
    case 'obj':
      return `${name}${opt ? '?' : ''}{ ${fieldsInline(s.fields)} }`;
    case 'write':
      return wrap('writes[]’teki bir yazmanın tam şekli');
  }
}

function fieldsInline(fields: Fields): string {
  return Object.entries(fields).map(([n, s]) => fieldInline(n, s)).join(' · ');
}

function opSection(o: RegOp, out: string[]): void {
  out.push('', `### ${o.op} — ${o.title_tr}`);
  out.push(`Ne zaman: ${o.when_tr}`);
  if (o.not_when_tr) out.push(`Ne zaman değil: ${o.not_when_tr}`);
  out.push(`Alanlar: ${fieldsInline(o.fields)}`);
  if (o.derive_tr) out.push(`Kod hesaplar: ${o.derive_tr}`);
  if (o.rule_docs.hard.length) out.push(`Reddedilir: ${o.rule_docs.hard.map((r) => r.doc_tr).join(' · ')}`);
  if (o.rule_docs.ask.length) out.push(`Sorulur (yazılmaz, bekletilir): ${o.rule_docs.ask.map((r) => r.doc_tr).join(' · ')}`);
  if (o.rule_docs.flag.length) out.push(`İşaretlenir (kaydedilir): ${o.rule_docs.flag.map((r) => r.doc_tr).join(' · ')}`);
  if (o.hold_tr) out.push(`İki adım: ${o.hold_tr}`);
  for (const e of o.examples_tr) out.push(`Örnek: ${e}`);
  out.push(...o.doc_appendix_tr);
}

/** The doc block for Stage A (writes, record/pending/commitment ops, envelope fields). */
export function buildWriteDoc(): string {
  const out: string[] = [];
  out.push(`YAZILABİLİR KAYITLAR (şema kochko_understand_${SCHEMA_VERSION})`);
  out.push('Sen anlarsın, kod denetler. Sayıyı SEN verirsin; kod yalnızca birim aritmetiği yapar ve sayının fiziksel olarak mümkün olup olmadığına bakar. "as_stated" kullanıcının ifadesidir: aynen saklanır, asla ayrıştırılmaz — "2 çimdik", "koca bir bardak" her zaman geçerlidir.');
  out.push('Her yazmanın sonucu dört şeyden biridir: KAYDET · İŞARETLE (kaydedilir, şüphe koça iletilir) · SOR (yazılmaz, bekletilir, koç tek soru sorar) · REDDET (yazılmaz, gerekçe koça iletilir). Kod hiçbir sayını sessizce değiştirmez.');
  out.push(`Gün (day): today | yesterday | YYYY-MM-DD; en fazla ${MAX_BACK_DAYS} gün geri, gelecek yok. Diğer tarihler YYYY-MM-DD; bağlamdaki yerel tarihe göre hesapla.`);
  out.push(`Ref’ler yalnızca bu turda gösterilenlerdir: ${Object.entries(REF_KINDS).map(([k, v]) => `${k}=${v.tr}`).join(' · ')}. Gösterilmeyen ref reddedilir. Hangi kayıt olduğundan emin değilsen yazma, clarify{candidate_refs} kullan.`);
  out.push(`Bağlam blokları: ${(Object.keys(BLOCK_TITLES) as Array<keyof typeof BLOCK_TITLES>).map((b) =>
    `${BLOCK_TITLES[b]} (${BLOCK_REF_KINDS[b].length ? BLOCK_REF_KINDS[b].join(', ') + ' ref’leri' : 'yalnız ipucu, ref değil; kod asla dayatmaz'})`).join(' · ')}.`);
  out.push('Soru, varsayım, plan ve başkası hakkındaki bilgi kullanıcının kendi kaydı değildir. Bir mesajda birden çok yazma olabilir; her biri ayrı denetlenir.');
  out.push(`ALERJENLER: ${Object.entries(ALLERGENS).map(([k, v]) => `${k}=${v}`).join(' · ')} · listede yoksa (yalnız kısıtta) custom:<ad>`);
  out.push(`BÖLGELER: ${Object.entries(BODY_PARTS).map(([k, v]) => `${k}=${v}`).join(' · ')}`);

  for (const ch of ['writes', 'record_ops', 'pending_ops', 'commitment_ops'] as const) {
    out.push('', `## ${CHANNEL_TITLES[ch]}`);
    for (const o of opsIn(ch)) opSection(o, out);
  }

  out.push('', '## Diğer alanlar');
  for (const [name, spec] of Object.entries({ ...ENVELOPE_HEAD, ...ENVELOPE_TAIL })) out.push(`- ${fieldInline(name, spec)}`);
  return out.join('\n');
}

/** The memory[] section, for the coach stage's prompt (and the fused envelope's doc). */
export function buildMemoryDoc(): string {
  const out: string[] = [`## ${CHANNEL_TITLES.memory}`];
  for (const o of opsIn('memory')) opSection(o, out);
  return out.join('\n');
}
