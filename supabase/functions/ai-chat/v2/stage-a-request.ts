/**
 * v2 Stage A — THE request composer (docs/AI_MIMARI_V2.md §3.2 T4, §4.2, §8.4).
 *
 * WHY one module: the Stage A call has to be byte-identical wherever it is made — the shadow
 * pipeline, the live v2 turn and the eval runner (§9.1 "her fixture bir fonksiyon çağrısıdır").
 * Before this module was the single owner there were two composers (understand.ts + input.ts
 * renderTurnInput for the shadow, this file for the eval) that sent different bytes, a different
 * §8.4 effort and a different output budget for the same turn — the eval graded a request
 * production never sent. Now:
 *
 *   input.ts    TurnInput → StageATurnView   (data → lines: meal / metric / workout / lab / hold
 *                                              wording, Turkish numbers, "(son tur)")
 *   eval        fixture snapshot → StageATurnView (eval/request.ts fixtureView)
 *   HERE        StageATurnView → the ONE TurnInput block (renderTurnInputBlock), the user turn,
 *               the effort rule, the output budget and the ai-decide body (buildStageARequest)
 *   understand  a thin respond() wrapper over composeStageA (timeouts, store:false, statuses)
 *
 *   system  = understand-prompt rules + registry Turkish doc (+ few-shots)   ← byte-identical for
 *             every user, one global cache key (UNDERSTAND_CACHE_KEY)
 *   user    = rendered TurnInput block · T2 tripwire facts · the user's message
 *   schema  = the registry's strict 'kochko_understand_vN'
 *   effort  = §8.4, from facts code knows for certain (image, open draft, a tripwire fact, ED tier)
 *   max_tokens = STAGE_A_MAX_OUTPUT_TOKENS (respond() adds the reasoning reserve on top)
 *
 * The request is exactly the body ai-decide accepts ({model, effort, system, input, schema,
 * cache_key, max_tokens}) and maps 1:1 onto respond()'s options.
 *
 * Pure: no I/O, no clock, no reading of the user's words (the message and history are only placed,
 * folded onto one line; T2's scan is computed by the caller with shared/safety-tripwires.ts, the
 * one module allowed to read them).
 */
import { buildUnderstandPrefix, UNDERSTAND_CACHE_KEY } from './understand-prompt.ts';
import { BLOCK_TITLES, buildUnderstandSchema, buildWriteDoc, type EdTier, type JsonSchema, SCHEMA_NAMES } from '../../shared/write-registry/mod.ts';
import { renderTripwireFacts, type TripwireScan, tripwireFacts } from '../../shared/safety-tripwires.ts';
import { shiftDateString } from '../../shared/day-boundary.ts';

/** Headings of the per-turn blocks that the registry doc does not name (it owns BLOCK_TITLES). */
export const TURN_BLOCK_TITLES = {
  now: 'ŞİMDİ',
  profile: 'PROFİL',
  gates: 'YAZMA KAPILARI',
  today: 'BUGÜN',
  active_plan: 'AKTİF PLAN',
  image: 'GÖRSEL',
  last_turn: 'SON TUR',
  history: 'SON KONUŞMA',
  message: 'KULLANICI MESAJI',
} as const;

/** Visible-output budget of a Stage A call (a decision is 60–350 tokens); respond() adds the reasoning reserve. */
export const STAGE_A_MAX_OUTPUT_TOKENS = 2_500;

/** How much of the recent conversation Stage A sees (oldest dropped first) and how long one line may be. */
export const STAGE_A_HISTORY_MESSAGES = 4;
const HISTORY_CHARS = { user: 300, assistant: 600 } as const;

// ─── Turkish rendering primitives (shared with input.ts's data → lines) ─────────────────────────

export const WEEKDAY_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'] as const;
export const WEEKDAY_SHORT_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] as const;
export const MONTH_SHORT_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'] as const;

/** "1540" → "1.540", 1.6 → "1,6" (Turkish number format, no Intl dependency). */
export function fmtTr(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  let grouped = '';
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) grouped += '.';
    grouped += int[i];
  }
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** 'bugün' / 'dün' / 'Per 2 Eki'. */
export function dayLabelTr(day: string, today: string): string {
  if (day === today) return 'bugün';
  if (day === shiftDateString(today, -1)) return 'dün';
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_SHORT_TR[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT_TR[d.getUTCMonth()]}`;
}

/** One line of quoted text: newlines folded, length capped (code never interprets it). */
export function quoteLine(text: string, max: number): string {
  const flat = text.split('\r').join(' ').split('\n').join(' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ─── the view ────────────────────────────────────────────────────────────────────────────────────

/** A row the model may point at, already worded by the producer (§4.2: `m12 · Per 2 Eki akşam …`). */
export interface RefLine {
  ref: string;
  line: string;
  /** Written in the previous turn → rendered with "(son tur)". */
  last_turn?: boolean;
}

/**
 * What Stage A reads about the user this turn, as worded lines. input.ts stageAView (from the
 * TurnInput) and the eval (from a fixture snapshot) both produce this; the text block is rendered
 * ONCE, here, with the registry's block titles so the doc's words point at real blocks.
 */
export interface StageATurnView {
  /**
   * `today` is the effective day (before the user's day boundary it is the calendar's yesterday) —
   * the day 'today'/'yesterday' resolve to (f.day()); `local_*` is the wall clock the user sees.
   */
  now: { today: string; local_date: string; local_time: string | null; tz: string | null };
  ed_tier: EdTier;
  /** PROFİL phrases, in display order ("cinsiyet kadın", "boy 165 cm"). Empty → "bilgi yok". */
  profile: readonly string[];
  /** Extra "yazma kapıları" lines (§4.2/4). The ED-tier gate is derived here, never passed in. */
  gates: readonly string[];
  /** BUGÜN phrases ("2 öğün 675 kcal", "su 1,60 L"); empty → no BUGÜN line. */
  today: readonly string[];
  records: readonly RefLine[];
  constraints: readonly RefLine[];
  pending: readonly RefLine[];
  commitments: readonly RefLine[];
  drafts: readonly RefLine[];
  /** AKTİF PLAN entries ("antrenman (hafta 2026-09-28)"); empty → "yok". */
  active_plans: readonly string[];
  /** REFERANS ADAYLARI — hints only, code never picks one (§4.2/5). */
  references: ReadonlyArray<{ key: string; line: string }>;
  image: boolean;
  /** What the coach's previous answer wrote, by type (SON TUR). */
  last_turn_writes: readonly string[];
  /** Recent turns, oldest first; an assistant turn may carry receipt lines (§6.2 ⟦m12 düzeltildi → m15⟧). */
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; receipts?: readonly string[] }>;
}

/** The write gate code derives from the ED tier (§4.2/4, §7.1): amber, red and an unreadable tier close it. */
export const TIER_GATE_LINE = 'kalori açığı ya da hedef düşürme KAPALI (güvenlik)';

export function tierGates(tier: EdTier): string[] {
  return tier === 'amber' || tier === 'red' || tier === 'unknown' ? [TIER_GATE_LINE] : [];
}

function nowLine(n: StageATurnView['now']): string {
  const [y, m, d] = n.local_date.split('-').map(Number);
  const weekday = WEEKDAY_TR[new Date(`${n.local_date}T00:00:00Z`).getUTCDay()] ?? '';
  const clock = n.local_time ? `, saat ${n.local_time}` : '';
  const tz = n.tz ? ` (${n.tz})` : '';
  return `${TURN_BLOCK_TITLES.now}: ${weekday} ${d} ${MONTH_SHORT_TR[(m ?? 1) - 1] ?? ''} ${y}${clock}${tz} · today = ${n.today} · yesterday = ${shiftDateString(n.today, -1)}`;
}

function refBlock(out: string[], heading: string, rows: readonly RefLine[]): void {
  out.push(heading);
  if (!rows.length) return void out.push('yok');
  for (const r of rows) out.push(`${r.ref} · ${r.line}${r.last_turn ? ' (son tur)' : ''}`);
}

/**
 * The TurnInput block, in a fixed order (§4.2): clock and day anchors, profile, write gates, today,
 * records, constraints, holds, commitments, drafts, active plans, reference hints, image, the last
 * turn's writes and the recent conversation (nearest the message). The ref blocks always appear
 * ("yok" when empty: "evet" with no hold is not a confirmation). Deterministic: same view → same
 * bytes (the eval replay key).
 */
export function renderTurnInputBlock(v: StageATurnView): string {
  const T = TURN_BLOCK_TITLES;
  const out: string[] = [nowLine(v.now)];
  out.push(`${T.profile}: ${v.profile.length ? v.profile.join(' · ') : 'bilgi yok'}`);
  const gates = [...tierGates(v.ed_tier), ...v.gates];
  if (gates.length) out.push(`${T.gates}: ${gates.join(' · ')}`);
  if (v.today.length) out.push(`${T.today}: ${v.today.join(' · ')}`);
  refBlock(out, `${BLOCK_TITLES.records} (son 7 gün; düzeltme/silme yalnız bu ref'lerle):`, v.records);
  refBlock(out, `${BLOCK_TITLES.constraints}:`, v.constraints);
  refBlock(out, `${BLOCK_TITLES.pending}:`, v.pending);
  refBlock(out, `${BLOCK_TITLES.commitments}:`, v.commitments);
  refBlock(out, `${BLOCK_TITLES.draft}:`, v.drafts);
  out.push(`${T.active_plan}: ${v.active_plans.length ? v.active_plans.join(' · ') : 'yok'}`);
  if (v.references.length) {
    out.push(`${BLOCK_TITLES.references} (yalnızca ipucu, kod dayatmaz):`);
    for (const c of v.references) out.push(`${c.key}: ${c.line}`);
  }
  if (v.image) out.push(`${T.image}: kullanıcı bir fotoğraf ekledi.`);
  if (v.last_turn_writes.length) out.push(`${T.last_turn} (koçun son cevabıyla kaydedilenler): ${v.last_turn_writes.join(', ')}`);
  const recent = v.history.slice(-STAGE_A_HISTORY_MESSAGES);
  if (recent.length) {
    out.push(`${T.history}:`);
    for (const h of recent) {
      const who = h.role === 'user' ? 'kullanıcı' : 'koç';
      out.push(`${who}: "${quoteLine(h.content, HISTORY_CHARS[h.role])}"`);
      for (const rc of h.receipts ?? []) out.push(`  ⟦${quoteLine(rc, 160)}⟧`);
    }
  }
  return out.join('\n');
}

// ─── effort, prefix, schema ──────────────────────────────────────────────────────────────────────

/**
 * §8.4 — ONE rule, from facts code knows for CERTAIN, never from keyword guesses: base `low` (never
 * `none`: that needs its own eval gate), `medium` for an image, an open plan draft, ANY tripwire fact
 * Stage A is handed ("tetik var" — a declaration cue such as "alerjim var" included: it is the
 * protective side, §7.4), or an ED tier ≥ watch ('unknown' = the read failed → fail closed, think
 * more).
 */
export function stageAEffort(v: Pick<StageATurnView, 'image' | 'drafts' | 'ed_tier'>, scan: TripwireScan): 'low' | 'medium' {
  return v.image || v.drafts.length > 0 || tripwireFacts(scan).length > 0 || v.ed_tier !== 'none' ? 'medium' : 'low';
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

// ─── the request ─────────────────────────────────────────────────────────────────────────────────

interface UserParts { block: string; facts: string; message: string }

function userParts(v: StageATurnView, scan: TripwireScan, message: string): UserParts {
  return { block: renderTurnInputBlock(v), facts: renderTripwireFacts(scan), message };
}

function joinUser(p: UserParts): string {
  return [p.block, p.facts, `${TURN_BLOCK_TITLES.message}:\n${p.message}`].filter((s) => s !== '').join('\n\n');
}

/** The user turn: TurnInput block · tripwire facts (only when there are any) · the message, verbatim and last. */
export function stageAUserContent(v: StageATurnView, scan: TripwireScan, message: string): string {
  return joinUser(userParts(v, scan, message));
}

/** The Stage A call — ai-decide's body; respond({model, effort, input:[system, …input], schema, maxTokens, cacheKey}). */
export interface StageARequest {
  model: string;
  effort: 'low' | 'medium';
  system: string;
  input: Array<{ role: 'user'; content: string }>;
  schema: StageASchema;
  cache_key: string;
  max_tokens: number;
}

/** Character sizes of the parts (the shadow logs them; §3.3 budget check). */
export interface StageASizes { prefix: number; turn_input: number; tripwires: number; message: number }

export interface StageAParams { view: StageATurnView; scan: TripwireScan; message: string; model: string }

/** The request and the sizes of its parts — one composition, so both always describe the same bytes. */
export function composeStageA(p: StageAParams): { request: StageARequest; sizes: StageASizes } {
  const system = stageASystemPrompt();
  const parts = userParts(p.view, p.scan, p.message);
  return {
    request: {
      model: p.model,
      effort: stageAEffort(p.view, p.scan),
      system,
      input: [{ role: 'user', content: joinUser(parts) }],
      schema: stageASchema(),
      cache_key: UNDERSTAND_CACHE_KEY,
      max_tokens: STAGE_A_MAX_OUTPUT_TOKENS,
    },
    sizes: { prefix: system.length, turn_input: parts.block.length, tripwires: parts.facts.length, message: p.message.length },
  };
}

export function buildStageARequest(p: StageAParams): StageARequest {
  return composeStageA(p).request;
}
