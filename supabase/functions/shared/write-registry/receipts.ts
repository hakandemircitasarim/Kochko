/**
 * write-registry/receipts.ts — Turkish receipt lines with diacritics (AI_MIMARI_V2 §4.1, §5.2).
 *
 * A receipt says what was REALLY stored: it is built from the verdict's `row` (args ⊕ derive),
 * never from what the model claimed, and only after the writer reported ok. The meal line keeps
 * the 'Öğün kaydedildi' prefix byte-identical (the client and the kcal net key on it). Enum ids
 * never leak to the user ("aktivite düzeyi: hareketsiz", not "sedentary"; mem#13, final2#15).
 */
import type { ActionReceipt } from '../contracts/turn-envelope.ts';
import type { RenderedRef, RenderedRefs } from './refs.ts';
import type { WriteVerdict } from './validate.ts';
import { findWireOp, getOp } from './registry.ts';
import { restatedSeverity } from './ops/constraints.ts';
import { PROFILE_FIELD_SPECS, profileFieldLabel } from './ops/profile.ts';
import {
  COMMITMENT_OUTCOMES, CONSTRAINT_KINDS, FOOD_PREFERENCE, GOAL_TYPES, PERIODIC_STATES, PLATEAU_STRATEGIES, SEVERITY, SLEEP_QUALITY,
  WORKOUT_TYPES,
} from './vocab.ts';
import { isRecord, shiftDay, trInt, trNum } from './util.ts';

/** Byte-identical to ai-chat MEAL_LOGGED_MARK (client + kcal-consistency net match this prefix). */
export const MEAL_LOGGED_MARK = 'Öğün kaydedildi';

export interface ReceiptCtx {
  today: string;
  refs?: RenderedRefs;
  /**
   * record_delete / record_restore_metric: the writer's reversed[] rows (w_record_delete). The undo
   * receipt is built from them — what was removed AND the value that is left — never from the
   * pre-turn summary alone (re-trial 2026-10-12: "Kayıt geri alındı: tartı: 88,0 kg" read as "88 is
   * there again" while the day had no weight left).
   */
  reversed?: readonly UndoRow[];
}

// ─── undo: the result, from the writer's reversed[] rows ──────────────────────────────────────────

/** One reversed[] row of w_record_delete (108/115), structurally: only what the receipt reads. */
export interface UndoRow {
  table?: unknown;
  row_id?: unknown;
  ref?: unknown;
  field_set?: unknown;
  before?: unknown;
  after?: unknown;
  /** 115: profiles.weight_kg re-derived from the latest weigh-in. */
  derived?: unknown;
}

/** A day metric an undo changed: the first value it touched → the value left (null = nothing left). */
export interface UndoMetricChange {
  field: 'weight_kg' | 'water_liters' | 'sleep_hours' | 'mood_score' | 'steps';
  before: number | null;
  after: number | null;
}

export interface UndoSummary {
  metrics: UndoMetricChange[];
  /** profiles.weight_kg after the undo, when the undo changed it (undefined = untouched). */
  profile_weight_after?: number | null;
  /** Something came BACK: a replaced record un-deleted, a metric value re-written (the correction's old value). */
  restored: boolean;
  /** Records the undo soft-deleted / brought back (meal, workout, supplement, event, lab rows). */
  records_removed: number;
  records_restored: number;
  /** Spine rows the undo switched off (a just-added constraint's ledger group). */
  constraints_removed: number;
}

const UNDO_METRICS: Readonly<Record<UndoMetricChange['field'], { label: string; unit: string; decimals: number }>> = {
  weight_kg: { label: 'tartı', unit: ' kg', decimals: 2 },
  water_liters: { label: 'su (gün toplamı)', unit: ' L', decimals: 2 },
  sleep_hours: { label: 'uyku', unit: ' saat', decimals: 1 },
  mood_score: { label: 'ruh hali', unit: '/5', decimals: 0 },
  steps: { label: 'adım', unit: '', decimals: 0 },
};
const RECORD_TABLES: ReadonlySet<string> = new Set(['meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values']);

const fieldVal = (o: unknown, f: string): number | null | undefined => {
  if (!isRecord(o) || !(f in o)) return undefined;
  const v = o[f];
  if (v === null) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const fieldsOf = (r: UndoRow): string[] => (Array.isArray(r.field_set) ? r.field_set.filter((x): x is string => typeof x === 'string') : []);

/** What an undo changed, from the writer's reversed[] rows (pure; rows in the order the writer reversed them). */
export function summarizeUndo(rows: readonly UndoRow[] | null | undefined): UndoSummary {
  const out: UndoSummary = { metrics: [], restored: false, records_removed: 0, records_restored: 0, constraints_removed: 0 };
  const byKey = new Map<string, UndoMetricChange>();
  for (const r of rows ?? []) {
    const table = typeof r.table === 'string' ? r.table : '';
    const fs = fieldsOf(r);
    if (table === 'daily_metrics') {
      for (const f of fs) {
        if (!(f in UNDO_METRICS)) continue;
        const b = fieldVal(r.before, f);
        const a = fieldVal(r.after, f);
        if (a === undefined) continue;
        const key = `${String(r.row_id)}:${f}`;
        const cur = byKey.get(key);
        if (cur) cur.after = a;
        else {
          const m: UndoMetricChange = { field: f as UndoMetricChange['field'], before: b ?? null, after: a };
          byKey.set(key, m);
          out.metrics.push(m);
        }
        if ((b === null || b === undefined) && a !== null) out.restored = true;
      }
    } else if (table === 'profiles' && fs.includes('weight_kg')) {
      const a = fieldVal(r.after, 'weight_kg');
      if (a !== undefined) out.profile_weight_after = a;
    } else if (table === 'weight_history') {
      if (r.before === null && isRecord(r.after)) out.restored = true;
    } else if (table === 'user_constraints' && fs.includes('active')) {
      if (isRecord(r.after) && r.after.active === false && isRecord(r.before) && r.before.active === true) out.constraints_removed++;
    } else if (RECORD_TABLES.has(table) && fs.includes('is_deleted') && isRecord(r.after)) {
      if (r.after.is_deleted === true) out.records_removed++;
      else if (r.after.is_deleted === false) {
        out.records_restored++;
        out.restored = true;
      }
    }
  }
  // A value that came back to where it was (88 → null → 88) is no change worth stating.
  out.metrics = out.metrics.filter((m) => m.before !== m.after);
  return out;
}

function metricNum(field: UndoMetricChange['field'], n: number): string {
  const spec = UNDO_METRICS[field];
  return spec.decimals === 0 ? trInt(n) : trShort(n);
}

/** "tartı 88 → 82 kg" / "tartı 88 kg kaldırıldı; bugün için tartı kaydı kalmadı" / "tartı 82 kg geri geldi". */
export function undoChangeTr(m: UndoMetricChange, day: string | null | undefined, today: string): string {
  const s = UNDO_METRICS[m.field];
  if (m.before !== null && m.after !== null) return `${s.label} ${metricNum(m.field, m.before)} → ${metricNum(m.field, m.after)}${s.unit}`;
  if (m.before !== null) {
    const when = !day || day === today ? 'bugün' : day === shiftDay(today, -1) ? 'dün' : day;
    return `${s.label} ${metricNum(m.field, m.before)}${s.unit} kaldırıldı; ${when} için ${s.label.split(' (')[0]} kaydı kalmadı`;
  }
  return `${s.label} ${metricNum(m.field, m.after!)}${s.unit} geri geldi`;
}

/**
 * The undo receipt: what was removed and what is left. With metric changes the numbers say both
 * ("Kayıt geri alındı — tartı 88 → 82 kg"); a record undo quotes the record and says what came back.
 */
function undoLine(prefix: string, row: Row, ctx?: ReceiptCtx): string {
  const r = refOf(row.ref, ctx);
  const s = summarizeUndo(ctx?.reversed);
  const parts = s.metrics.map((m) => undoChangeTr(m, r?.day, ctx?.today ?? ''));
  const shownWeight = s.metrics.find((m) => m.field === 'weight_kg')?.after;
  if (s.profile_weight_after !== undefined && s.profile_weight_after !== null && s.profile_weight_after !== shownWeight) {
    parts.push(`profildeki kilo ${trShort(s.profile_weight_after)} kg`);
  }
  if (s.records_restored > 0) parts.push('düzeltmeden önceki kayıt geri geldi');
  if (s.constraints_removed > 0) parts.push('artık kısıtlarında yok');
  if (s.metrics.length > 0) return `${prefix} — ${parts.join(' · ')}`;
  return `${prefix}: ${refSummary(row.ref, ctx)}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
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

function refOf(ref: unknown, ctx?: ReceiptCtx): RenderedRef | undefined {
  return typeof ref === 'string' ? ctx?.refs?.[ref] : undefined;
}

/** The record as the USER may read it: never the model-facing provenance tag ("[model]"). */
function refSummary(ref: unknown, ctx?: ReceiptCtx): string {
  const r = refOf(ref, ctx);
  return r?.user_summary_tr ?? r?.summary_tr ?? String(ref);
}

/**
 * "X (plain)" — but a display name that already carries its owner in parentheses ("yumurta
 * (kızının)") gets the note INSIDE them: one pair, never "yumurta (kızının) (başkası için; …)".
 */
function ownerNote(name: string, note: string, plain: string): string {
  const m = /^(.*\S)\s*\(([^()]+)\)$/u.exec(name.trim());
  return m ? `${m[1]} (${m[2]}; ${note})` : `${name} (${plain})`;
}

// ─── corrections: the receipt shows the STORED new record, old → new ─────────────────────────────

const CORRECTED = 'Kayıt düzeltildi';
const foldKey = (s: string) => s.trim().toLocaleLowerCase('tr');

/** One meal item as stored: "lahmacun (tek dilim) ~250 kcal" (~ = model estimate). */
function mealItemText(it: Row): string {
  const est = it.data_source === 'ai_estimate' ? '~' : '';
  const portion = str(it.as_stated) ? ` (${it.as_stated})` : '';
  return `${String(it.name)}${portion} ${est}${num(it.kcal) ?? 0} kcal`;
}

function mealTotal(row: Row): number {
  const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
  return num(row.total_kcal) ?? items.reduce((s, it) => s + (num(it.kcal) ?? 0), 0);
}

/**
 * Item-level differences between the record as shown (snapshot) and the stored patch, matched by
 * name: "lahmacun 2 dilim → tek dilim (500 → ~250 kcal)", "ayran (1 bardak) ~90 kcal (yeni)",
 * "pilav çıkarıldı". Unchanged items are left out; [] = no item changed (day / meal type only).
 */
function mealDiff(before: NonNullable<RenderedRef['snapshot']>['items'], items: Row[]): string[] {
  const old = [...(before ?? [])];
  const used = new Set<number>();
  const out: string[] = [];
  for (const it of items) {
    const name = String(it.name);
    const i = old.findIndex((o, k) => !used.has(k) && foldKey(o.name) === foldKey(name));
    if (i < 0) { out.push(`${mealItemText(it)} (yeni)`); continue; }
    used.add(i);
    const o = old[i];
    const est = it.data_source === 'ai_estimate' ? '~' : '';
    const kcal = num(it.kcal) ?? 0;
    const portion = str(it.as_stated);
    const portionChanged = portion !== null && foldKey(portion) !== foldKey(o.portion ?? '');
    const kcalChanged = kcal !== o.kcal;
    if (!portionChanged && !kcalChanged) continue;
    const p = portionChanged ? ` ${o.portion ? `${o.portion} → ` : ''}${portion}` : '';
    const k = kcalChanged ? (portionChanged ? ` (${trShort(o.kcal)} → ${est}${kcal} kcal)` : ` ${trShort(o.kcal)} → ${est}${kcal} kcal`) : '';
    out.push(`${name}${p}${k}`);
  }
  old.forEach((o, k) => { if (!used.has(k)) out.push(`${o.name} çıkarıldı`); });
  return out;
}

function mealCorrection(patch: Row, ref: RenderedRef | undefined, ctx?: ReceiptCtx): string {
  const items = Array.isArray(patch.items) ? (patch.items as Row[]) : [];
  const total = mealTotal(patch);
  const snap = ref?.snapshot ?? null;
  let parts = snap?.items ? mealDiff(snap.items, items) : [];
  if (parts.length === 0) parts = items.slice(0, 6).map(mealItemText);
  if (parts.length > 6) parts = [...parts.slice(0, 6), `+${parts.length - 6} değişiklik`];
  const oldTotal = snap?.total_kcal;
  const totalText = oldTotal !== undefined && oldTotal !== total ? `toplam ${trShort(oldTotal)} → ${total} kcal` : `toplam ${total} kcal`;
  // Without a snapshot (a fixture ref) the old record is quoted as it was shown, so old → new stays visible.
  const shown = ref?.user_summary_tr ?? ref?.summary_tr ?? null;
  const was = !snap && shown ? `; önceki kayıt: ${shown}` : '';
  return `${CORRECTED} — ${[...parts, totalText].join(' · ')}${dayNote(patch.date, ctx)}${was}`;
}

/** A day metric corrected to a comparable value: "tartı 78,2 → 81,6 kg". null = not comparable. */
function metricCorrection(op: string, patch: Row, old: number | undefined): string | null {
  if (old === undefined) return null;
  switch (op) {
    case 'body_weight': return num(patch.kg) !== null ? `tartı ${trShort(old)} → ${trShort(num(patch.kg)!)} kg` : null;
    case 'sleep_log': return num(patch.hours) !== null ? `uyku ${trShort(old)} → ${trShort(num(patch.hours)!)} saat` : null;
    case 'mood_log': return num(patch.score) !== null ? `ruh hali ${trShort(old)}/5 → ${num(patch.score)}/5` : null;
    case 'step_log': return num(patch.steps) !== null ? `adım ${trInt(old)} → ${trInt(num(patch.steps)!)}` : null;
    case 'water_log':
      // An 'add' correction replaces one drink, not the day total the ref shows: not comparable.
      return patch.mode === 'set_day_total' && num(patch.liters) !== null ? `su günün toplamı ${trNum(old, 2)} → ${trNum(num(patch.liters)!, 2)} L` : null;
    default: return null;
  }
}

/**
 * record_update: built from the VALIDATED PATCH (row.patch — what the writer stored), never from the
 * pre-turn summary of the record (trial 2026-10-11: the line quoted the old "2 dilim · 590 kcal", and
 * the coach, reading it as the fact, told the user the correction had not happened).
 */
function correctionLine(row: Row, v: WriteVerdict, ctx?: ReceiptCtx): string {
  const ref = refOf(row.ref, ctx);
  const patch = isRecord(row.patch) ? row.patch : null;
  const wire = isRecord(v.args.patch) && typeof v.args.patch.op === 'string' ? v.args.patch.op : null;
  const op = wire ? findWireOp('writes', wire)?.type ?? null : null;
  if (!patch || !op) return `${CORRECTED}: ${refSummary(row.ref, ctx)}`;
  if (op === 'meal_log') return mealCorrection(patch, ref, ctx);
  const metric = metricCorrection(op, patch, ref?.snapshot?.value);
  if (metric) return `${CORRECTED} — ${metric}${dayNote(patch.date, ctx)}`;
  const inner = BUILDERS[op]?.(patch, v, ctx);
  const now = inner ? inner.replace(' kaydedildi', '') : getOp(op)?.title_tr ?? op;
  return `${CORRECTED} — ${now}${ref ? `; önceki kayıt: ${refSummary(row.ref, ctx)}` : ''}`;
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
    const detail = items.slice(0, 6).map(mealItemText).join(' · ');
    const more = items.length > 6 ? ` (+${items.length - 6} kalem)` : '';
    return `${MEAL_LOGGED_MARK} — ${detail}${more} · toplam ${mealTotal(row)} kcal${dayNote(row.date, ctx)}`;
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
    if (row.effect === 'coach_note') return `Not aldım: ${ownerNote(name, 'senin kısıtlarına eklenmedi', 'başkası için; senin kısıtlarına eklenmedi')}`;
    if (row.effect === 'record_absence') return `Not edildi: ${name} yok`;
    const kind = capitalize(label(CONSTRAINT_KINDS, row.kind));
    if (isRecord(row.existing)) {
      // A restatement of a stored row: confirmed or updated in place, never duplicated — say which.
      const changed = restatedSeverity(row);
      if (changed) return `${kind} güncellendi: ${name} (şiddet: ${label(SEVERITY, changed)})`;
      if (row.effect === 'already_active') return `${kind} zaten kayıtlı: ${name}${row.existing.severity === 'severe' ? ' (ciddi)' : ''}`;
    }
    const sev = row.severity === 'unknown' ? ' (şiddeti bilinmiyor — ciddi sayılıyor)' : row.severity === 'severe' ? ' (ciddi)' : '';
    return `${kind} kaydedildi: ${name}${sev}`;
  },
  // The rendered summary is Turkish ("diz sakatlığı"); the spine subject is an id ("knee").
  constraint_retract: (row, _v, ctx) => `Kaldırıldı: ${refSummary(row.target, ctx)}`,
  constraint_confirm: (row, _v, ctx) => `Doğrulandı: ${refSummary(row.target, ctx)}`,
  food_pref: (row) => row.effect === 'coach_note'
    ? `Not aldım: ${ownerNote(String(row.food), 'senin tercihlerine eklenmedi', 'başkasının tercihi')}`
    : `Tercih kaydedildi: ${String(row.food)} — ${label(FOOD_PREFERENCE, row.preference)}`,
  life_event: (row) => `Aklımda: ${String(row.title)} (${String(row.event_date)})`,
  lab_value: (row) => `${Array.isArray(row.items) ? row.items.length : 0} tahlil değeri kaydedildi`,
  recipe_save: (row) => `Tarif kaydedildi: ${String(row.title)}`,
  periodic_state: (row) => row.state === 'none'
    ? 'Dönemsel durum kapatıldı'
    : `Dönem: ${label(PERIODIC_STATES, row.state)}${str(row.end_date) ? ` (bitiş ${row.end_date})` : ''}`,
  target_change: (row) => (PROGRAM_LINES[String(row.program)] ?? (() => 'Kalori programı güncellendi'))(row),
  data_erase_request: () => null,
  record_delete: (row, _v, ctx) => undoLine('Kayıt geri alındı', row, ctx),
  record_update: (row, v, ctx) => correctionLine(row, v, ctx),
  record_restore_metric: (row, _v, ctx) => undoLine('Önceki değere dönüldü', row, ctx),
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
