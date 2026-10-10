/**
 * v2 Stage A — the request composer (docs/AI_MIMARI_V2.md §3.2 T4, §4.2, §8.4).
 *
 * WHY one module: the Stage A call has to be byte-identical wherever it is made — the shadow
 * pipeline, the live v2 turn and the eval runner (§9.1 "her fixture bir fonksiyon çağrısıdır").
 * If each caller glued the prefix, the TurnInput block, the tripwire facts and the message together
 * on its own, the eval would grade a request production never sends. So every piece here is
 * IMPORTED from its owner and only the order is decided here:
 *
 *   system  = understand-prompt rules + registry Turkish doc (+ few-shots)   ← byte-identical for
 *             every user, one global cache key (UNDERSTAND_CACHE_KEY)
 *   user    = rendered TurnInput block · T2 tripwire facts · the user's message
 *   schema  = the registry's strict 'kochko_understand_vN'
 *   effort  = §8.4, from facts code knows for certain (image, open draft, a trigger, ED tier)
 *
 * The result is exactly the body ai-decide accepts ({model, effort, system, input, schema,
 * cache_key}) and maps 1:1 onto respond()'s options, so the dry-run endpoint, the eval and the
 * future understand.ts all send the same thing.
 *
 * Pure: no I/O, no clock, no reading of the user's words (the message is only placed; T2's scan is
 * computed by the caller with shared/safety-tripwires.ts, the one module allowed to read it).
 */
import { buildUnderstandPrefix, UNDERSTAND_CACHE_KEY } from './understand-prompt.ts';
import { BLOCK_TITLES, buildUnderstandSchema, buildWriteDoc, type EdTier, type JsonSchema, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { renderTripwireFacts, type TripwireScan, tripwireFacts } from '../../shared/safety-tripwires.ts';

/** Headings of the per-turn blocks that the registry doc does not name (it owns BLOCK_TITLES). */
export const TURN_BLOCK_TITLES = {
  now: 'ŞİMDİ',
  tier: 'YB SEVİYESİ',
  profile: 'PROFİL',
  today: 'BUGÜN',
  gates: 'YAZMA KAPILARI',
  image: 'GÖRSEL',
  history: 'SON KONUŞMA',
  message: 'KULLANICI MESAJI',
} as const;

/** A row the model may point at, already rendered by the loader (§4.2: `m12 · Per 2 Eki akşam …`). */
export interface RefLine {
  ref: string;
  line: string;
  /** Written in the previous turn → rendered with "(son tur)". */
  last_turn?: boolean;
}

/**
 * What Stage A reads about the user this turn, as rendered lines. The loader (input.ts, from
 * v2_turn_input) and the eval (from a fixture snapshot) both produce this; the text block is
 * rendered ONCE, here, with the registry's block titles so the doc's words point at real blocks.
 */
export interface StageATurnView {
  now: { local_date: string; weekday_tr?: string | null; local_time?: string | null; tz?: string | null };
  ed_tier: EdTier;
  /** [key, value] in display order. */
  profile: ReadonlyArray<readonly [string, string]>;
  constraints: readonly RefLine[];
  records: readonly RefLine[];
  /** Today's totals, already worded by the loader as the few-shots show them ("su 1,40 L"). */
  today: readonly string[];
  pending: readonly RefLine[];
  commitments: readonly RefLine[];
  draft: RefLine | null;
  /** "yazma kapıları" lines (§4.2/4): "kalori hedefi düşürme: KAPALI (YB amber)". */
  gates: readonly string[];
  /** REFERANS ADAYLARI — hints only, code never picks one (§4.2/5). */
  references: ReadonlyArray<{ key: string; line: string }>;
  image: boolean;
  /** Recent turns; each assistant turn may carry its receipt lines (§6.2 ⟦m12 düzeltildi → m15⟧). */
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; receipts?: readonly string[] }>;
}

function refBlock(out: string[], title: string, rows: readonly RefLine[]): void {
  if (!rows.length) return;
  out.push(`${title}:`);
  for (const r of rows) out.push(`${r.ref} · ${r.line}${r.last_turn ? ' (son tur)' : ''}`);
}

const pairs = (kv: ReadonlyArray<readonly [string, string]>) => kv.map(([k, v]) => `${k}=${v}`).join(' · ');

/** The TurnInput block, in a fixed order. Deterministic: same view → same bytes (replay key). */
export function renderTurnInputBlock(v: StageATurnView): string {
  const T = TURN_BLOCK_TITLES;
  const out: string[] = [];
  const n = v.now;
  out.push(`${T.now}: ${n.local_date}${n.weekday_tr ? ` ${n.weekday_tr}` : ''}${n.local_time ? ` ${n.local_time}` : ''}${n.tz ? ` (${n.tz})` : ''}`);
  out.push(`${T.tier}: ${v.ed_tier}`);
  if (v.profile.length) out.push(`${T.profile}: ${pairs(v.profile)}`);
  refBlock(out, BLOCK_TITLES.constraints, v.constraints);
  refBlock(out, BLOCK_TITLES.records, v.records);
  if (v.today.length) out.push(`${T.today}: ${v.today.join(' · ')}`);
  refBlock(out, BLOCK_TITLES.pending, v.pending);
  refBlock(out, BLOCK_TITLES.commitments, v.commitments);
  if (v.draft) out.push(`${BLOCK_TITLES.draft}: ${v.draft.ref} · ${v.draft.line}`);
  if (v.gates.length) out.push(`${T.gates}: ${v.gates.join(' · ')}`);
  if (v.references.length) {
    out.push(`${BLOCK_TITLES.references} (yalnızca ipucu, kod dayatmaz):`);
    for (const c of v.references) out.push(`${c.key}: ${c.line}`);
  }
  if (v.image) out.push(`${T.image}: kullanıcı bir fotoğraf ekledi.`);
  if (v.history.length) {
    out.push(`${T.history}:`);
    for (const h of v.history) {
      out.push(`${h.role === 'user' ? 'kullanıcı' : 'koç'}: ${h.content}`);
      for (const rc of h.receipts ?? []) out.push(`  ⟦${rc}⟧`);
    }
  }
  return out.join('\n');
}

/** A tripwire fact Stage A must READ (not a declaration cue) — §8.4 "tetik var". */
export function hasSafetyTrigger(scan: TripwireScan): boolean {
  return tripwireFacts(scan).some((f) => f.category !== 'declaration');
}

/**
 * §8.4: Stage A is `low`; `medium` only on facts code knows for certain — an image, an open plan
 * draft, a safety trigger to read, or an ED tier ≥ watch ('unknown' = the read failed → fail
 * closed, think more). Never `none` here: that needs its own eval gate.
 */
export function stageAEffort(v: Pick<StageATurnView, 'image' | 'draft' | 'ed_tier'>, scan: TripwireScan): 'low' | 'medium' {
  const tierUp = v.ed_tier !== 'none';
  return v.image || v.draft !== null || hasSafetyTrigger(scan) || tierUp ? 'medium' : 'low';
}

let PREFIX: string | null = null;
let SCHEMA: StageASchema | null = null;

/** The cached prefix: rules → registry doc → few-shots (built once; byte-identical per process). */
export function stageASystemPrompt(): string {
  return PREFIX ??= buildUnderstandPrefix({ registryDoc: buildWriteDoc() });
}

export interface StageASchema { name: string; schema: JsonSchema; strict: true }

/** The registry's strict understand schema, in the {name, schema, strict} shape respond()/ai-decide take. */
export function stageASchema(): StageASchema {
  return SCHEMA ??= { name: SCHEMA_NAMES.understand, schema: buildUnderstandSchema(), strict: true };
}

/** The user turn: TurnInput block · tripwire facts (when any) · the message, verbatim. */
export function stageAUserContent(v: StageATurnView, scan: TripwireScan, message: string): string {
  const parts = [renderTurnInputBlock(v)];
  const facts = renderTripwireFacts(scan);
  if (facts) parts.push(facts);
  parts.push(`${TURN_BLOCK_TITLES.message}:\n${message}`);
  return parts.join('\n\n');
}

/** The Stage A call — ai-decide's body; respond({model, effort, input:[system, …input], schema, cacheKey}). */
export interface StageARequest {
  model: string;
  effort: 'low' | 'medium';
  system: string;
  input: Array<{ role: 'user'; content: string }>;
  schema: StageASchema;
  cache_key: string;
}

export function buildStageARequest(p: { view: StageATurnView; scan: TripwireScan; message: string; model: string }): StageARequest {
  return {
    model: p.model,
    effort: stageAEffort(p.view, p.scan),
    system: stageASystemPrompt(),
    input: [{ role: 'user', content: stageAUserContent(p.view, p.scan, p.message) }],
    schema: stageASchema(),
    cache_key: UNDERSTAND_CACHE_KEY,
  };
}
