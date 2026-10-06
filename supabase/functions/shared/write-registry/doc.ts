/**
 * write-registry/doc.ts — the Turkish "YAZILABİLİR KAYITLAR" block Stage A reads (§4.2 (2)).
 *
 * Generated from the same declarations as the schema, so the doc can never promise a field the
 * schema lacks or describe a unit the derive() does not use. It is part of Stage A's cached,
 * byte-identical prefix: same registry → same bytes (pinned by the snapshot test).
 *
 * Budget (§4.1: ~2.5K tokens; registry.test.ts "Stage A budget"). The doc is the ONE place field
 * semantics live — the understand schema has no descriptions — so it says only what the schema
 * (names, enum ids, nullability) and the Stage A rules (ai-chat/v2/understand-prompt.ts) do not:
 *   • per op: when / when not (one line), notes only for non-obvious fields, explained enums,
 *     what code computes ("Kod:"), the two-step policy, at most one example;
 *   • shared conventions (day, as_stated, evidence_quote, replaces, refs, allergen and body-part
 *     ids) once, in the header;
 *   • seldom-used ops (tier 'rare') as one line each in an appendix — still complete in the schema.
 * Plausibility thresholds (what is asked or flagged) are deliberately NOT listed: the model gives
 * its honest estimate and code decides; telling it "2500 kcal is asked" only invites shading.
 */
import { MAX_BACK_DAYS, type Channel, type Fields, type RegOp } from './dsl.ts';
import { ENVELOPE_HEAD, ENVELOPE_TAIL } from './envelope.ts';
import { BLOCK_REF_KINDS, BLOCK_TITLES, REF_KINDS } from './refs.ts';
import { opsIn, SCHEMA_VERSION } from './registry.ts';
import { RELATIVE_DAY_TOKENS } from './util.ts';
import { ALLERGEN_DOC_HINTS, ALLERGENS, BODY_PARTS } from './vocab.ts';

const CHANNEL_TITLES: Record<Channel, string> = {
  writes: 'writes[] — kullanıcının bildirdikleri',
  record_ops: 'record_ops[] — kayıtları ref ile geri al / düzelt',
  pending_ops: 'pending_ops[] — BEKLEYEN ONAYLAR’a cevap',
  commitment_ops: 'commitment_ops[] — sözler',
  memory: 'memory[] — koçun hafıza notları',
};

const STAGE_A_CHANNELS = ['writes', 'record_ops', 'pending_ops', 'commitment_ops'] as const;

/** `id=meaning` pairs; a meaning that only repeats the id is dropped ("litre"). */
function enumMeanings(values: Readonly<Record<string, string>>): string {
  return Object.entries(values).map(([id, tr]) => (tr === id ? id : `${id}=${tr}`)).join(' · ');
}

/**
 * Notes for the fields that need one: an explained enum and/or the field's `tr`. Nested fields
 * are addressed by path ("items[].grams", "safety.ed_signal.category"). Self-explanatory fields
 * produce nothing — the schema lists them.
 */
function fieldNotes(fields: Fields, base = ''): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(fields)) {
    const path = base ? `${base}.${name}` : name;
    if (s.kind === 'list') {
      if (s.tr) out.push(`${path}[]: ${s.tr}`);
      out.push(...fieldNotes(s.fields, `${path}[]`));
      continue;
    }
    if (s.kind === 'obj') {
      if (s.tr) out.push(`${path}: ${s.tr}`);
      out.push(...fieldNotes(s.fields, path));
      continue;
    }
    const parts: string[] = [];
    if (s.kind === 'enum' && s.explain) parts.push(enumMeanings(s.values));
    if (s.tr) parts.push(s.tr);
    if (parts.length) out.push(`${path}: ${parts.join(' — ')}`);
  }
  return out;
}

function opSection(o: RegOp, out: string[]): void {
  out.push('', `### ${o.op}`);
  out.push(o.not_when_tr ? `${o.when_tr} Değil: ${o.not_when_tr}` : o.when_tr);
  for (const n of fieldNotes(o.fields)) out.push(`- ${n}`);
  if (o.derive_tr) out.push(`Kod: ${o.derive_tr}`);
  if (o.hold_tr) out.push(`İki adım: ${o.hold_tr}`);
  for (const e of o.examples_tr) out.push(`Örnek: ${e}`);
  out.push(...o.doc_appendix_tr);
}

/**
 * One compact line for a seldom-used op (the schema still has all of its fields). not_when is left
 * out: a rare op's "not this" cases are the main ops' own territory, documented there.
 */
function rareLine(o: RegOp): string {
  const parts = [`- ${o.op}${o.channel === 'writes' ? '' : ` (${o.channel})`}: ${o.when_tr}`];
  const notes = fieldNotes(o.fields);
  if (notes.length) parts.push(`Alanlar: ${notes.join('; ')}.`);
  if (o.derive_tr) parts.push(`Kod: ${o.derive_tr}`);
  if (o.hold_tr) parts.push(`İki adım: ${o.hold_tr}`);
  return parts.join(' ');
}

function refLine(): string {
  const blocks = (Object.keys(BLOCK_TITLES) as Array<keyof typeof BLOCK_TITLES>).map((b) => {
    const kinds = BLOCK_REF_KINDS[b];
    if (!kinds.length) return null;
    const list = kinds.length === 1 ? kinds[0] : kinds.map((k) => `${k}=${REF_KINDS[k].tr}`).join(' · ');
    return `${BLOCK_TITLES[b]}: ${list}`;
  }).filter((x): x is string => x !== null);
  return `Ref’ler yalnız bu turda gösterilenler: ${blocks.join(' | ')}.`;
}

/**
 * The `day` vocabulary, stated once (every log op has a `day`, and the schema only says "string").
 * Generated from the validator's own token list and window, so the doc cannot drift from what
 * checkField('day') accepts: a relative token, an ISO day ≤ MAX_BACK_DAYS back, never the future.
 */
function dayLine(): string {
  return `day: ${[...RELATIVE_DAY_TOKENS, 'YYYY-MM-DD'].join(' | ')}; en fazla ${MAX_BACK_DAYS} gün geri, gelecek yok.`;
}

/** The doc block for Stage A (writes, record/pending/commitment ops, envelope fields). */
export function buildWriteDoc(): string {
  const out: string[] = [];
  out.push(`YAZILABİLİR KAYITLAR (şema kochko_understand_${SCHEMA_VERSION})`);
  out.push('Sayıları sen verirsin; kod yalnız "Kod:" aritmetiğini yapar ve fiziksel aralığı denetler, hiçbir sayını sessizce değiştirmez. Her yazma ayrı denetlenir.');
  out.push(dayLine());
  out.push(`Ortak alanlar: diğer tarihler YYYY-MM-DD, saatler HH:MM. as_stated ve raw kullanıcının sözleri, aynen ("2 çimdik"). evidence_quote kullanıcının mesajından AYNEN alıntı. replaces: KAYITLAR’daki aynı türden kaydın düzeltilmiş hâliyse onun ref’i, değilse null.`);
  out.push(refLine());
  const allergenIds = (Object.keys(ALLERGENS) as Array<keyof typeof ALLERGENS>)
    .map((id) => (ALLERGEN_DOC_HINTS[id] ? `${id} (${ALLERGEN_DOC_HINTS[id]})` : id));
  out.push(`ALERJENLER: ${allergenIds.join(' · ')} · listede yoksa (yalnız kısıtta) custom:<ad>`);
  out.push(`BÖLGELER: ${enumMeanings(BODY_PARTS)}`);

  const rare: RegOp[] = [];
  for (const ch of STAGE_A_CHANNELS) {
    out.push('', `## ${CHANNEL_TITLES[ch]}`);
    for (const o of opsIn(ch)) {
      if (o.tier === 'rare') rare.push(o);
      else opSection(o, out);
    }
  }
  if (rare.length) {
    out.push('', '## Seyrek kayıtlar (şemada tüm alanlarıyla)');
    for (const o of rare) out.push(rareLine(o));
  }

  out.push('', '## Diğer alanlar');
  for (const n of fieldNotes({ ...ENVELOPE_HEAD, ...ENVELOPE_TAIL })) out.push(`- ${n}`);
  return out.join('\n');
}

/** The memory[] section, for the coach stage's prompt (and the fused envelope's doc). */
export function buildMemoryDoc(): string {
  const out: string[] = [`## ${CHANNEL_TITLES.memory}`];
  for (const o of opsIn('memory')) opSection(o, out);
  return out.join('\n');
}
