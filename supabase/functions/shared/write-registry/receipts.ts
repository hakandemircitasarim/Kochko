/**
 * write-registry/receipts.ts — Turkish receipt lines with diacritics (AI_MIMARI_V2 §4.1, §5.2).
 *
 * A receipt says what was REALLY stored: it is built from the verdict's `row` (args ⊕ derive),
 * never from what the model claimed, and only after the writer reported ok. The meal line keeps
 * the 'Öğün kaydedildi' prefix byte-identical (the client and the kcal net key on it). Enum ids
 * never leak to the user ("aktivite düzeyi: hareketsiz", not "sedentary"; mem#13, final2#15).
 */
import type { ActionReceipt } from '../contracts/turn-envelope.ts';
import type { RenderedRefs } from './refs.ts';
import type { WriteVerdict } from './validate.ts';
import { getOp } from './registry.ts';
import { PROFILE_FIELD_SPECS, profileFieldLabel } from './ops/profile.ts';
import {
  COMMITMENT_OUTCOMES, CONSTRAINT_KINDS, FOOD_PREFERENCE, GOAL_TYPES, PERIODIC_STATES, PLATEAU_STRATEGIES, SLEEP_QUALITY,
  WORKOUT_TYPES,
} from './vocab.ts';
import { shiftDay, trInt, trNum } from './util.ts';

/** Byte-identical to ai-chat MEAL_LOGGED_MARK (client + kcal-consistency net match this prefix). */
export const MEAL_LOGGED_MARK = 'Öğün kaydedildi';

export interface ReceiptCtx {
  today: string;
  refs?: RenderedRefs;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** "82,5" / "175" / "0,25": up to 2 decimals, Turkish comma, no trailing zeros. */
export function trShort(n: number): string {
  return trNum(n, 2).replace(/,?0+$/, '');
}

/** Turkish-aware first-letter capital ("ilaç" → "İlaç"). */
function capitalize(s: string): string {
  return s ? s[0].toLocaleUpperCase('tr') + s.slice(1) : s;
}

function label(map: Readonly<Record<string, string>>, id: unknown): string {
  return typeof id === 'string' && map[id] ? map[id].split(' (')[0] : String(id);
}

function dayNote(date: unknown, ctx?: ReceiptCtx): string {
  if (!ctx || typeof date !== 'string' || date === ctx.today) return '';
  return date === shiftDay(ctx.today, -1) ? ' (dün)' : ` (${date})`;
}

function refSummary(ref: unknown, ctx?: ReceiptCtx): string {
  const r = typeof ref === 'string' ? ctx?.refs?.[ref] : undefined;
  return r?.summary_tr ?? String(ref);
}

function profileValueText(row: Row): string {
  const field = String(row.field);
  const spec = PROFILE_FIELD_SPECS[field];
  const v = row.value;
  if (v === null) return 'temizlendi';
  if (spec?.type === 'list') {
    const op = row.list_op;
    return op === 'add' ? `+${String(v)}` : op === 'remove' ? `−${String(v)}` : String(v);
  }
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  if (spec?.values && typeof v === 'string') return label(spec.values, v);
  if (typeof v === 'number') {
    if (field === 'water_target_liters') return `${trShort(v)} L`;
    if (field === 'step_target') return trInt(v);
    if (spec?.units?.[0] === 'cm') return `${trShort(v)} cm`;
    if (spec?.units?.[0] === 'percent') return `%${trShort(v)}`;
    if (field === 'menstrual_cycle_length') return `${v} gün`;
    return field === 'birth_year' ? String(v) : trShort(v);
  }
  return String(v);
}

const PROGRAM_LINES: Record<string, (row: Row) => string> = {
  maintenance_start: () => 'Bakım moduna geçildi',
  mini_cut: (row) => `Mini cut başladı: ${num(row.weeks) ?? '?'} hafta`,
  plateau_strategy: (row) => `Plato stratejisi uygulandı: ${label(PLATEAU_STRATEGIES, row.strategy_id)}`,
  recovery: () => 'Telafi planı kuruldu',
  mvd: () => 'MVD günü: bugün yalnızca temel hedefler',
};

/** One success line per op type, from the stored row. null = silent success. */
const BUILDERS: Record<string, (row: Row, v: WriteVerdict, ctx?: ReceiptCtx) => string | null> = {
  meal_log: (row, _v, ctx) => {
    const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
    if (items.length === 0) return MEAL_LOGGED_MARK;
    const detail = items.slice(0, 6).map((it) => {
      const est = it.data_source === 'ai_estimate' ? '~' : '';
      const portion = str(it.as_stated) ? ` (${it.as_stated})` : '';
      return `${String(it.name)}${portion} ${est}${num(it.kcal) ?? 0} kcal`;
    }).join(' · ');
    const more = items.length > 6 ? ` (+${items.length - 6} kalem)` : '';
    const total = num(row.total_kcal) ?? items.reduce((s, it) => s + (num(it.kcal) ?? 0), 0);
    return `${MEAL_LOGGED_MARK} — ${detail}${more} · toplam ${total} kcal${dayNote(row.date, ctx)}`;
  },
  water_log: (row, _v, ctx) => {
    const l = num(row.liters) ?? 0;
    return row.mode === 'set_day_total'
      ? `Su: günün toplamı ${trNum(l, 2)} L${dayNote(row.date, ctx)}`
      : `Su: +${trNum(l, 2)} L${dayNote(row.date, ctx)}`;
  },
  body_weight: (row, _v, ctx) => `Tartı kaydedildi: ${trShort(num(row.kg) ?? 0)} kg${dayNote(row.date, ctx)}`,
  sleep_log: (row, _v, ctx) =>
    `Uyku kaydedildi: ${trShort(num(row.hours) ?? 0)} saat${row.quality ? ` (${label(SLEEP_QUALITY, row.quality)})` : ''}${dayNote(row.date, ctx)}`,
  mood_log: (row, _v, ctx) => `Ruh hali kaydedildi: ${num(row.score) ?? '?'}/5${dayNote(row.date, ctx)}`,
  step_log: (row, _v, ctx) => `${trInt(num(row.steps) ?? 0)} adım kaydedildi${dayNote(row.date, ctx)}`,
  workout_log: (row, _v, ctx) => {
    const dur = num(row.duration_min);
    const burn = num(row.calories_burned);
    return `Antrenman kaydedildi: ${label(WORKOUT_TYPES, row.workout_type)}${dur ? `, ${dur} dk` : ''}${burn ? ` (~${burn} kcal yakım)` : ''}${dayNote(row.date, ctx)}`;
  },
  supplement_log: (row, _v, ctx) =>
    `Takviye kaydedildi: ${String(row.name)}${str(row.as_stated) ? ` (${row.as_stated})` : ''}${dayNote(row.date, ctx)}`,
  profile_set: (row) => {
    const change = Array.isArray(row.changes) ? (row.changes as Row[])[0] : undefined;
    const merged = { ...(change ?? {}), value: row.value, field: row.field ?? change?.field, list_op: row.list_op };
    return `Profil güncellendi: ${profileFieldLabel(String(merged.field))} ${profileValueText(merged)}`;
  },
  goal_set: (row) => {
    const target = num(row.target_weight_kg);
    const weeks = num(row.weeks);
    return `Hedef: ${label(GOAL_TYPES, row.goal_type)}${target !== null ? ` → ${trShort(target)} kg` : ''}${weeks !== null ? ` (${weeks} hafta)` : ''}`;
  },
  constraint_add: (row) => {
    const name = str(row.display_tr) ?? String(row.subject_id);
    if (row.effect === 'coach_note') return `Not aldım: ${name} (başkası için; senin kısıtlarına eklenmedi)`;
    if (row.effect === 'record_absence') return `Not edildi: ${name} yok`;
    const sev = row.severity === 'unknown' ? ' (şiddeti bilinmiyor — ciddi sayılıyor)' : row.severity === 'severe' ? ' (ciddi)' : '';
    return `${capitalize(label(CONSTRAINT_KINDS, row.kind))} kaydedildi: ${name}${sev}`;
  },
  // The rendered summary is Turkish ("diz sakatlığı"); the spine subject is an id ("knee").
  constraint_retract: (row, _v, ctx) => `Kaldırıldı: ${refSummary(row.target, ctx)}`,
  constraint_confirm: (row, _v, ctx) => `Doğrulandı: ${refSummary(row.target, ctx)}`,
  food_pref: (row) => row.effect === 'coach_note'
    ? `Not aldım: ${String(row.food)} (başkasının tercihi)`
    : `Tercih kaydedildi: ${String(row.food)} — ${label(FOOD_PREFERENCE, row.preference)}`,
  life_event: (row) => `Aklımda: ${String(row.title)} (${String(row.event_date)})`,
  lab_value: (row) => `${Array.isArray(row.items) ? row.items.length : 0} tahlil değeri kaydedildi`,
  recipe_save: (row) => `Tarif kaydedildi: ${String(row.title)}`,
  periodic_state: (row) => row.state === 'none'
    ? 'Dönemsel durum kapatıldı'
    : `Dönem: ${label(PERIODIC_STATES, row.state)}${str(row.end_date) ? ` (bitiş ${row.end_date})` : ''}`,
  target_change: (row) => (PROGRAM_LINES[String(row.program)] ?? (() => 'Kalori programı güncellendi'))(row),
  data_erase_request: () => null,
  record_delete: (row, _v, ctx) => `Kayıt geri alındı: ${refSummary(row.ref, ctx)}`,
  record_update: (row, _v, ctx) => `Kayıt düzeltildi: ${refSummary(row.ref, ctx)}`,
  record_restore_metric: (row, _v, ctx) => `Önceki değere dönüldü: ${refSummary(row.ref, ctx)}`,
  pending_confirm: () => 'Onaylandı',
  pending_discard: () => 'Vazgeçildi',
  commitment_add: (row) => `Söz kaydedildi: ${String(row.text)} (takip ${String(row.follow_up_date)})`,
  commitment_resolve: (row) => `Söz kapandı: ${label(COMMITMENT_OUTCOMES, row.outcome)}`,
  memory_note: () => null,
};

/** Op types that have a receipt builder (registry.test.ts: every registry op must). */
export const RECEIPT_OPS: readonly string[] = Object.keys(BUILDERS);

function titleOf(v: WriteVerdict): string {
  return getOp(v.op)?.title_tr ?? v.op;
}

/** The success line for a COMMIT/FLAG verdict (null for silent ops and no-ops). */
export function receiptLine(v: WriteVerdict, ctx?: ReceiptCtx): string | null {
  if (!v.row || v.noop || (v.verdict !== 'COMMIT' && v.verdict !== 'FLAG')) return null;
  const b = BUILDERS[v.op];
  return b ? b(v.row, v, ctx) : `${titleOf(v)} kaydedildi`;
}

/** ASK: what is waiting and why (Stage B fact; the coach asks in its own words). */
export function holdLine(v: WriteVerdict): string {
  const why = v.issues.find((i) => i.level === 'ask')?.tr;
  return `Onayını bekliyor (${titleOf(v)})${why ? `: ${why}` : ''}`;
}

/** REJECT: not stored, and why. */
export function rejectLine(v: WriteVerdict): string {
  const why = v.issues.find((i) => i.level === 'hard')?.tr;
  return `Kaydedilmedi (${titleOf(v)})${why ? `: ${why}` : ''}`;
}

/** A writer reported failure for a COMMIT/FLAG verdict. */
export function writeFailedLine(v: WriteVerdict): string {
  return `${titleOf(v)} kaydedilemedi`;
}

/**
 * Typed receipt for the envelope (TurnEnvelope.receipts). `ok` comes from the WRITER, never from
 * the verdict alone. ASK and no-ops have no receipt (no badge: nothing was written yet).
 */
export function toActionReceipt(
  v: WriteVerdict,
  commit: { ok: boolean; rows_affected: number | null; failure_class?: string | null } | null,
  ctx?: ReceiptCtx,
): ActionReceipt | null {
  if (v.verdict === 'ASK' || v.noop) return null;
  if (v.verdict === 'REJECT') {
    const h = v.issues.find((i) => i.level === 'hard');
    return { action_type: v.envelope, ok: false, rows_affected: 0, user_line: rejectLine(v), failure_class: h?.failure_class ?? 'invalid_value' };
  }
  if (!commit || !commit.ok) {
    return { action_type: v.envelope, ok: false, rows_affected: commit?.rows_affected ?? 0, user_line: writeFailedLine(v), failure_class: commit?.failure_class ?? 'write_failed' };
  }
  return { action_type: v.envelope, ok: true, rows_affected: commit.rows_affected, user_line: receiptLine(v, ctx), failure_class: null };
}

/** One "BU TURDA OLANLAR" line for Stage B (§3.2 T6): the fact, with the reason when not stored. */
export function turnFactLine(v: WriteVerdict, ctx?: ReceiptCtx): string {
  if (v.noop) return `YAZILMADI (${titleOf(v)}): ${v.noop}`;
  switch (v.verdict) {
    case 'COMMIT':
      return `KAYDEDİLDİ: ${receiptLine(v, ctx) ?? titleOf(v)}`;
    case 'FLAG':
      return `KAYDEDİLDİ (şüpheli): ${receiptLine(v, ctx) ?? titleOf(v)} — ${v.issues.filter((i) => i.level === 'flag').map((i) => i.tr).join('; ')}`;
    case 'ASK':
      return `BEKLETİLDİ: ${holdLine(v)}${v.question_tr ? ` → sorulacak: ${v.question_tr}` : ''}`;
    case 'REJECT':
      return `REDDEDİLDİ: ${rejectLine(v)}`;
  }
}
