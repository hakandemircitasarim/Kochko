/**
 * ai-chat/v2/adapter.ts — writers for registry ops that have no atomic RPC yet (AI_MIMARI_V2 §4.1
 * adapter.ts, §10 Faz 3: "adapter.ts üzerinden yazıcılar, override dalları kapalı").
 *
 * Each op writes the SAME tables v1 writes (so every v1 reader — dashboard, guardrails, reports —
 * keeps working during the mixed period) through the shared writers where they exist
 * (syncConstraint, appendCoachingNote, set_active_goal, erase-hold), and then lands its
 * turn_writes ledger row through v2_ledger_append (108). What it does NOT carry over from v1 are
 * the override branches: no enum defaults (intensity → moderate), no MET guess for an unknown burn,
 * no regex date parsing, no ±10-day silent dedupe, no foodMatchKey pruning. The row is the
 * verdict's row (args ⊕ derive), already validated.
 *
 * Ledger semantics: rows of soft-deletable tables (workout/supplement/life_event/lab) are
 * 'soft_delete' entries, so the ref-based undo engine (w_record_delete) can take them back; profile
 * columns are 'restore_previous' with before/after; tables the ledger does not cover (goals, the
 * spine, food prefs, commitments, recipes, memory) get an audit-only 'none' entry — visible in
 * turn_writes, honest about not being undoable by ref (spine removal has its own two-step op).
 *
 * The ledger append is a separate statement (best effort, like v1's): a write whose ledger row
 * failed is still a real write (receipt ok) and the failure is logged loudly.
 */
import type { Constraint, ConstraintKind } from '../../shared/constraints.ts';
import type { NoteSource } from '../../shared/coaching-notes.ts';
import { isIFCompatible, type PeriodicState } from '../../shared/periodic-config.ts';
import { type LedgerAppendEntry, type LedgerAppendOk, parseRpcReceipt, V2_RPC } from '../../shared/v2-db-types.ts';
import { PROFILE_FIELD_SPECS } from '../../shared/write-registry/mod.ts';
import type { AdapterOutcome, AdapterPort, AdapterRequest, EraseConfirmOutcome } from './commit.ts';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

// ─── ports ───────────────────────────────────────────────────────────────────────────────────────

export interface DbError {
  message: string;
  code?: string;
}

export type DbRows = { data: Record<string, unknown>[] | null; error: DbError | null };

/** The slice of supabase-js the adapter uses (live.ts implements it over supabaseAdmin). */
export interface AdapterDb {
  insert(table: string, rows: Record<string, unknown> | Record<string, unknown>[], returning?: string): Promise<DbRows>;
  update(table: string, patch: Record<string, unknown>, match: Record<string, unknown>, returning?: string): Promise<DbRows>;
  upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<{ error: DbError | null }>;
  selectOne(table: string, columns: string, match: Record<string, unknown>): Promise<{ data: Record<string, unknown> | null; error: DbError | null }>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbError | null }>;
}

/** The shared writers the adapter reuses (live defaults in live.ts; fakes in tests). */
export interface AdapterHelpers {
  syncConstraint(userId: string, c: Constraint): Promise<boolean>;
  appendCoachingNote(userId: string, source: NoteSource, text: string, dateStr?: string): Promise<{ ok: boolean }>;
  appendBehavioralPatterns(userId: string, patterns: Record<string, unknown>[]): Promise<void>;
  updateLayer2(userId: string, patch: Record<string, unknown>): Promise<void>;
  createEraseHold(userId: string, scope: 'memory' | 'account'): Promise<{ ok: boolean; id?: string }>;
  confirmEraseHold(userId: string): Promise<EraseConfirmOutcome>;
}

export interface AdapterDeps {
  db: AdapterDb;
  helpers: AdapterHelpers;
  now?: () => Date;
  log?: (line: string, data: Record<string, unknown>) => void;
}

// ─── outcomes ────────────────────────────────────────────────────────────────────────────────────

interface LedgerHandle {
  ref: string | null;
  write_id: string | null;
  /** An UNDOABLE entry (soft_delete / restore_previous / revert_delta) failed to land. */
  missing?: boolean;
}

const ok = (rows: number | null, ledger: LedgerHandle, note?: string | null): AdapterOutcome =>
  ({ ok: true, rows_affected: rows, failure_class: null, ref: ledger.ref, write_id: ledger.write_id, note_tr: note ?? null, ...(ledger.missing ? { ledger_missing: true } : {}) });
const fail = (failure_class: string): AdapterOutcome => ({ ok: false, rows_affected: 0, failure_class, ref: null, write_id: null });
const NO_LEDGER: LedgerHandle = { ref: null, write_id: null };

/**
 * Append ledger entries; never throws. The FIRST entry's ref/write_id is the write's handle. A failed
 * append of an undoable entry is reported back (`missing`) so the receipt and the coach say the write
 * cannot be undone from chat; an audit-only ('none') entry failing changes nothing the user can do.
 */
async function ledger(d: AdapterDeps, req: AdapterRequest, entries: LedgerAppendEntry[]): Promise<LedgerHandle> {
  if (entries.length === 0) return NO_LEDGER;
  const undoable = entries.some((e) => e.undo_mode !== 'none');
  const lost: LedgerHandle = undoable ? { ...NO_LEDGER, missing: true } : NO_LEDGER;
  try {
    const r = await d.db.rpc(V2_RPC.ledgerAppend, {
      p_user: req.userId, p_turn_id: req.turnId,
      p_entries: entries.map((e) => ({ pipeline: 'v2', ...e, meta: { source: 'v2_adapter', ...(e.meta ?? {}) } })),
    });
    const parsed = r.error
      ? { ok: false as const, failure_class: 'write_failed', detail: { error: r.error.message } }
      : parseRpcReceipt<LedgerAppendOk>(r.data, ['ledger_append']);
    if (!parsed.ok) {
      d.log?.('[v2_adapter] LEDGER APPEND FAILED (write stands, not undoable by ref)', { op: req.op, failure_class: parsed.failure_class, detail: parsed.detail });
      return lost;
    }
    const first = parsed.entries[0];
    return { ref: first?.ref ?? null, write_id: first?.write_id ?? null };
  } catch (e) {
    d.log?.('[v2_adapter] LEDGER APPEND THREW (write stands, not undoable by ref)', { op: req.op, error: errMsg(e) });
    return lost;
  }
}

const audit = (op: string, meta: Record<string, unknown>): LedgerAppendEntry =>
  ({ op, table_name: 'profiles', row_id: null, undo_mode: 'none', is_primary: false, meta });

function firstId(r: DbRows): string | null {
  const row = r.data?.[0];
  return row && typeof row.id === 'string' ? row.id : null;
}

/**
 * record_update on an adapter op: undo the old record first (by its persistent ref or write), then
 * write the new one. If the new write fails, the old one is restored — never a lost record, never
 * a double count.
 */
async function withReplacement(d: AdapterDeps, req: AdapterRequest, write: () => Promise<AdapterOutcome>): Promise<AdapterOutcome> {
  if (!req.replaces) return await write();
  const target = req.replaces.ref ? { ref: req.replaces.ref } : req.replaces.write_id ? { write_id: req.replaces.write_id } : null;
  if (!target) return fail('not_in_ledger');
  const del = await d.db.rpc(V2_RPC.recordDelete, {
    p_user: req.userId, p_turn_id: req.turnId, p_target: target, p_opts: { max_age_days: 7, pipeline: 'v2', reason: 'replaced' },
  });
  const delOk = !del.error && isRec(del.data) && del.data.ok === true;
  if (!delOk) {
    const cls = isRec(del.data) && typeof del.data.failure_class === 'string' ? del.data.failure_class : 'write_failed';
    return fail(cls);
  }
  const out = await write();
  if (!out.ok) {
    const back = await d.db.rpc(V2_RPC.recordRestore, {
      p_user: req.userId, p_turn_id: req.turnId, p_target: target, p_opts: { max_age_days: 7, pipeline: 'v2', reason: 'replacement_failed' },
    });
    if (back.error || !(isRec(back.data) && back.data.ok === true)) {
      d.log?.('[v2_adapter] REPLACEMENT FAILED AND OLD RECORD NOT RESTORED', { op: req.op, target });
    }
  }
  return out;
}

// ─── writers ─────────────────────────────────────────────────────────────────────────────────────

async function workoutLog(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const insert: Record<string, unknown> = {
    user_id: req.userId, raw_input: str(r.raw) ?? '', workout_type: r.workout_type, intensity: r.intensity ?? null,
    calories_burned: num(r.calories_burned), rpe: num(r.rpe), logged_for_date: r.date, synced: true,
  };
  // duration_min is NOT NULL with a DB default; an unknown duration leaves the column to it.
  if (num(r.duration_min) !== null) insert.duration_min = r.duration_min;
  const ins = await d.db.insert('workout_logs', insert, 'id');
  const id = firstId(ins);
  if (ins.error || !id) {
    d.log?.('[v2_adapter] workout insert failed', { error: ins.error?.message ?? 'no row' });
    return fail('write_failed');
  }
  let note: string | null = null;
  const sets = Array.isArray(r.strength_sets) ? r.strength_sets.filter(isRec) : [];
  if (sets.length > 0) {
    const rows: Record<string, unknown>[] = [];
    for (const s of sets) {
      const count = Math.max(1, Math.round(num(s.sets) ?? 1));
      for (let n = 1; n <= count; n++) {
        rows.push({ workout_log_id: id, exercise_name: str(s.exercise) ?? 'egzersiz', set_number: n, reps: s.reps, weight_kg: num(s.weight_kg) ?? 0 });
      }
    }
    const setIns = await d.db.insert('strength_sets', rows);
    if (setIns.error) {
      d.log?.('[v2_adapter] strength_sets insert failed', { error: setIns.error.message });
      note = 'set ayrıntılarını kaydedemedim';
    }
  }
  const lg = await ledger(d, req, [{
    op: 'workout_log', table_name: 'workout_logs', row_id: id, for_date: String(r.date), undo_mode: 'soft_delete', group: 'w', is_primary: true,
    meta: { as_stated: str(r.raw), sets: sets.length },
  }]);
  return ok(1, lg, note);
}

async function supplementLog(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const insert: Record<string, unknown> = {
    user_id: req.userId, supplement_name: r.name, amount: str(r.as_stated), logged_for_date: r.date,
  };
  // A supplement without calories keeps the column's own default (0 = no energy), never a guess.
  for (const [col, key] of [['calories', 'kcal'], ['protein_g', 'protein_g'], ['carbs_g', 'carbs_g'], ['fat_g', 'fat_g']] as const) {
    if (num(r[key]) !== null) insert[col] = r[key];
  }
  const ins = await d.db.insert('supplement_logs', insert, 'id');
  const id = firstId(ins);
  if (ins.error || !id) {
    d.log?.('[v2_adapter] supplement insert failed', { error: ins.error?.message ?? 'no row' });
    return fail('write_failed');
  }
  const lg = await ledger(d, req, [{
    op: 'supplement_log', table_name: 'supplement_logs', row_id: id, for_date: String(r.date), undo_mode: 'soft_delete', group: 's', is_primary: true,
    meta: { as_stated: str(r.as_stated), allergens: r.allergens ?? [], may_contain: r.may_contain ?? [] },
  }]);
  return ok(1, lg);
}

/** Text list columns (kitchen_equipment, preferred/disliked_exercises): add/remove/set one item. */
export function nextListValue(current: unknown, item: string, op: 'add' | 'remove' | 'set'): string | null {
  if (op === 'set') return item;
  const items = (typeof current === 'string' ? current.split(',') : []).map((s) => s.trim()).filter(Boolean);
  const key = item.trim().toLocaleLowerCase('tr');
  const has = items.some((s) => s.toLocaleLowerCase('tr') === key);
  if (op === 'add') return has ? items.join(', ') : [...items, item.trim()].join(', ');
  const kept = items.filter((s) => s.toLocaleLowerCase('tr') !== key);
  return kept.length ? kept.join(', ') : null;
}

async function profileSet(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const field = str(r.field);
  const spec = field ? PROFILE_FIELD_SPECS[field] : undefined;
  if (!field || !spec) return fail('invalid_value');
  const cur = await d.db.selectOne('profiles', field, { id: req.userId });
  if (cur.error) {
    d.log?.('[v2_adapter] profile read failed', { field, error: cur.error.message });
    return fail('write_failed');
  }
  const before = cur.data ? cur.data[field] ?? null : null;
  let next: unknown = r.value ?? null;
  if (spec.type === 'list' && typeof next === 'string') {
    const op = r.list_op === 'add' || r.list_op === 'remove' || r.list_op === 'set' ? r.list_op : 'set';
    next = nextListValue(before, next, op);
  }
  const now = (d.now ?? (() => new Date()))().toISOString();
  const up = await d.db.update('profiles', { [field]: next, updated_at: now }, { id: req.userId }, 'id');
  if (up.error) {
    d.log?.('[v2_adapter] profile update failed', { field, error: up.error.message });
    return fail(up.error.code === '23514' || up.error.code === '22P02' ? 'invalid_value' : 'write_failed');
  }
  if (!up.data || up.data.length === 0) return fail('row_missing');
  const lg = await ledger(d, req, [{
    op: 'profile_set', table_name: 'profiles', row_id: req.userId, field_set: [field], before: { [field]: before }, after: { [field]: next },
    undo_mode: 'restore_previous', group: 'p', is_primary: true, meta: { field, as_stated: str((Array.isArray(r.changes) && isRec(r.changes[0]) ? r.changes[0] : {}).as_stated) },
  }]);
  return ok(1, lg);
}

async function goalSet(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const goal = {
    goal_type: r.goal_type, target_weight_kg: num(r.target_weight_kg), target_weeks: num(r.weeks),
    start_weight_kg: num(r.start_weight_kg), weekly_rate: num(r.weekly_rate_kg),
  };
  const res = await d.db.rpc('set_active_goal', { p_user: req.userId, p_goal: goal });
  if (res.error) {
    d.log?.('[v2_adapter] set_active_goal failed', { error: res.error.message });
    return fail('write_failed');
  }
  let note: string | null = null;
  const reason = str(r.reason);
  if (reason) {
    const up = await d.db.update('goals', { reason: reason.slice(0, 300) }, { user_id: req.userId, is_active: true });
    if (up.error) note = 'hedef gerekçesini kaydedemedim';
  }
  const lg = await ledger(d, req, [audit('goal_set', { goal, as_stated: str(r.as_stated) })]);
  return ok(1, lg, note);
}

const SEVERITY_DB: Record<string, 'mild' | 'moderate' | 'severe' | null> = { mild: 'mild', moderate: 'moderate', severe: 'severe', unknown: null };
const HEALTH_EVENT_KINDS: ReadonlySet<string> = new Set(['injury', 'surgery', 'condition', 'medication']);

async function constraintAdd(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const kind = String(r.kind) as ConstraintKind;
  const name = str(r.display_tr) ?? String(r.subject_id);
  if (r.effect === 'coach_note' || r.effect === 'record_absence') {
    // Someone else's constraint, or a stated absence: a coach note — never the user's safety spine.
    const text = r.effect === 'coach_note' ? `Başkası için (${kind}): ${name}${str(r.note) ? ` — ${r.note}` : ''}` : `Kullanıcıda yok (${kind}): ${name}`;
    const n = await d.helpers.appendCoachingNote(req.userId, 'chat', text, req.today);
    if (!n.ok) return fail('write_failed');
    const lg = await ledger(d, req, [audit('constraint_add', { effect: r.effect, kind, subject: r.subject_id })]);
    return ok(1, lg);
  }
  const severity = SEVERITY_DB[String(r.severity)] ?? null;
  const body = Array.isArray(r.body_parts) ? r.body_parts.filter((x): x is string => typeof x === 'string') : [];
  const synced = await d.helpers.syncConstraint(req.userId, {
    kind, subject: String(r.subject_id), severity, body_parts: body, source: 'user_stated', note: str(r.note) ?? name,
  });
  if (!synced) return fail('write_failed');
  let note: string | null = null;
  // v1 readers (guardrails, plan scans) still union the legacy stores — keep them protected too.
  if (kind === 'allergen' || kind === 'intolerance') {
    const fp = await d.db.upsert('food_preferences', {
      user_id: req.userId, food_name: name.toLocaleLowerCase('tr'), preference: 'never', is_allergen: true, allergen_severity: severity ?? 'severe',
    }, 'user_id,food_name');
    if (fp.error) {
      d.log?.('[v2_adapter] legacy allergen mirror failed (spine row stands)', { error: fp.error.message });
      note = 'eski uyumluluk kaydı yazılamadı';
    }
  } else if (kind === 'dietary') {
    const up = await d.db.update('profiles', { dietary_restriction: String(r.subject_id) }, { id: req.userId });
    if (up.error) d.log?.('[v2_adapter] dietary mirror failed (spine row stands)', { error: up.error.message });
  } else if (HEALTH_EVENT_KINDS.has(kind)) {
    const he = await d.db.insert('health_events', {
      user_id: req.userId, event_type: kind, description: str(r.note) ?? name, event_date: str(r.event_date), is_ongoing: true,
    });
    if (he.error) d.log?.('[v2_adapter] health_events mirror failed (spine row stands)', { error: he.error.message });
  }
  const lg = await ledger(d, req, [audit('constraint_add', { kind, subject: r.subject_id, severity: r.severity, body_parts: body })]);
  return ok(1, lg, note);
}

async function constraintTarget(d: AdapterDeps, req: AdapterRequest): Promise<{ id: string; kind: string; subject: string } | null> {
  if (!req.refRow || req.refRow.table !== 'user_constraints') return null;
  const row = await d.db.selectOne('user_constraints', 'id, kind, subject, active', { id: req.refRow.id, user_id: req.userId });
  if (row.error || !row.data) return null;
  return { id: String(row.data.id), kind: String(row.data.kind), subject: String(row.data.subject) };
}

async function constraintRetract(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const c = await constraintTarget(d, req);
  if (!c) return fail('unknown_ref');
  const now = (d.now ?? (() => new Date()))().toISOString();
  const up = await d.db.update('user_constraints', { active: false, updated_at: now }, { id: c.id, user_id: req.userId }, 'id');
  if (up.error || !up.data?.length) return fail(up.error ? 'write_failed' : 'already_undone');
  if (c.kind === 'allergen' || c.kind === 'intolerance') {
    const fp = await d.db.update('food_preferences', { is_allergen: false }, { user_id: req.userId, food_name: c.subject.toLocaleLowerCase('tr'), is_allergen: true });
    if (fp.error) d.log?.('[v2_adapter] legacy allergen unmirror failed', { error: fp.error.message });
  } else if (c.kind === 'dietary') {
    const pf = await d.db.update('profiles', { dietary_restriction: null }, { id: req.userId, dietary_restriction: c.subject });
    if (pf.error) d.log?.('[v2_adapter] dietary unmirror failed', { error: pf.error.message });
  }
  const lg = await ledger(d, req, [audit('constraint_retract', { constraint_id: c.id, kind: c.kind, subject: c.subject })]);
  return ok(1, lg);
}

async function constraintConfirm(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const c = await constraintTarget(d, req);
  if (!c) return fail('unknown_ref');
  const now = (d.now ?? (() => new Date()))().toISOString();
  const up = await d.db.update('user_constraints', { confidence: 1, confirmed_at: now, source: 'confirmed', updated_at: now }, { id: c.id, user_id: req.userId }, 'id');
  if (up.error) return fail('write_failed');
  const lg = await ledger(d, req, [audit('constraint_confirm', { constraint_id: c.id })]);
  return ok(up.data?.length ?? 0, lg);
}

async function foodPref(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const food = String(r.food).trim();
  if (r.effect === 'coach_note') {
    const n = await d.helpers.appendCoachingNote(req.userId, 'chat', `Başkasının tercihi: ${food} — ${String(r.preference)}`, req.today);
    if (!n.ok) return fail('write_failed');
    return ok(1, await ledger(d, req, [audit('food_pref', { effect: 'coach_note', food })]));
  }
  const key = food.toLocaleLowerCase('tr');
  // A preference never clears an allergy flag (safety > taste): keep is_allergen as stored.
  const cur = await d.db.selectOne('food_preferences', 'is_allergen, allergen_severity', { user_id: req.userId, food_name: key });
  const allergen = cur.data?.is_allergen === true;
  const row: Record<string, unknown> = { user_id: req.userId, food_name: key, preference: r.preference, is_allergen: allergen };
  if (allergen) row.allergen_severity = cur.data?.allergen_severity ?? 'severe';
  const up = await d.db.upsert('food_preferences', row, 'user_id,food_name');
  if (up.error) return fail('write_failed');
  return ok(1, await ledger(d, req, [audit('food_pref', { food: key, preference: r.preference, kept_allergen: allergen })]), allergen ? 'alerji kaydın aynen duruyor' : null);
}

async function lifeEvent(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const ins = await d.db.insert('life_events', {
    user_id: req.userId, title: r.title, event_type: r.event_type, event_date: r.event_date, note: str(r.note),
  }, 'id');
  const id = firstId(ins);
  if (ins.error || !id) return fail('write_failed');
  const lg = await ledger(d, req, [{ op: 'life_event', table_name: 'life_events', row_id: id, for_date: String(r.event_date), undo_mode: 'soft_delete', group: 'e', is_primary: true }]);
  return ok(1, lg);
}

/**
 * lab_values.value is NOT NULL (002): a qualitative finding ("D vitaminim düşük") is stored with
 * value 0, NO reference range (so the generated is_out_of_range cannot invent a verdict) and the
 * model's status + note in `notes`. The schema gap is listed for a later migration.
 */
async function labValue(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const items = Array.isArray(r.items) ? r.items.filter(isRec) : [];
  const measured = str(r.measured_at) ?? req.today;
  const STATUS_TR: Record<string, string> = { low: 'düşük', normal: 'normal', high: 'yüksek', unknown: 'belirtilmedi' };
  const rows = items.map((it) => {
    const value = num(it.value);
    const status = STATUS_TR[String(it.status)] ?? String(it.status);
    const notes = [value === null || it.status !== 'unknown' ? `durum: ${status}` : null, str(it.note)].filter(Boolean).join(' — ') || null;
    return {
      user_id: req.userId, parameter_name: it.parameter, value: value ?? 0, unit: str(it.unit) ?? '',
      reference_min: value === null ? null : num(it.reference_min), reference_max: value === null ? null : num(it.reference_max),
      measured_at: measured, notes,
    };
  });
  if (rows.length === 0) return fail('invalid_value');
  const ins = await d.db.insert('lab_values', rows, 'id');
  if (ins.error || !ins.data?.length) return fail('write_failed');
  const entries: LedgerAppendEntry[] = ins.data
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => id !== null)
    .map((id, i) => ({ op: 'lab_value', table_name: 'lab_values' as const, row_id: id, for_date: measured, undo_mode: 'soft_delete' as const, group: 'l', is_primary: i === 0 }));
  return ok(ins.data.length, await ledger(d, req, entries));
}

async function recipeSave(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const insert: Record<string, unknown> = {
    user_id: req.userId, title: r.title, category: r.category,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [], instructions: str(r.instructions) ?? '',
  };
  for (const [col, key] of [['total_calories', 'kcal'], ['total_protein', 'protein_g'], ['prep_time_min', 'prep_time_min'], ['servings', 'servings']] as const) {
    if (num(r[key]) !== null) insert[col] = r[key];
  }
  const ins = await d.db.insert('saved_recipes', insert, 'id');
  if (ins.error || !firstId(ins)) return fail('write_failed');
  return ok(1, await ledger(d, req, [audit('recipe_save', { recipe_id: firstId(ins) })]));
}

async function periodicState(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const cols = ['periodic_state', 'periodic_state_start', 'periodic_state_end', 'if_active'];
  const cur = await d.db.selectOne('profiles', cols.join(', '), { id: req.userId });
  if (cur.error) return fail('write_failed');
  const clearing = r.state === 'none';
  const patch: Record<string, unknown> = clearing
    ? { periodic_state: null, periodic_state_start: null, periodic_state_end: null }
    : { periodic_state: r.state, periodic_state_start: req.today, periodic_state_end: str(r.end_date) };
  if (!clearing && !isIFCompatible(String(r.state) as PeriodicState)) patch.if_active = false;
  const fields = Object.keys(patch);
  const before: Record<string, unknown> = {};
  for (const f of fields) before[f] = cur.data ? cur.data[f] ?? null : null;
  const now = (d.now ?? (() => new Date()))().toISOString();
  const up = await d.db.update('profiles', { ...patch, updated_at: now }, { id: req.userId }, 'id');
  if (up.error || !up.data?.length) return fail(up.error ? 'write_failed' : 'row_missing');
  const lg = await ledger(d, req, [{
    op: 'periodic_state', table_name: 'profiles', row_id: req.userId, field_set: fields, before, after: patch, undo_mode: 'restore_previous', group: 'ps', is_primary: true,
  }]);
  return ok(1, lg);
}

async function commitmentAdd(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const ins = await d.db.insert('user_commitments', {
    user_id: req.userId, commitment: r.text, follow_up_at: `${String(r.follow_up_date)}T09:00:00Z`, status: 'pending',
  }, 'id');
  if (ins.error || !firstId(ins)) return fail('write_failed');
  return ok(1, await ledger(d, req, [audit('commitment_add', { commitment_id: firstId(ins), follow_up_date: r.follow_up_date })]));
}

async function commitmentResolve(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  if (!req.refRow || req.refRow.table !== 'user_commitments') return fail('unknown_ref');
  const r = req.row;
  const now = (d.now ?? (() => new Date()))().toISOString();
  const status = r.outcome === 'missed' ? 'abandoned' : 'completed';
  const up = await d.db.update('user_commitments', { resolved_at: now, outcome: r.outcome, status }, { id: req.refRow.id, user_id: req.userId }, 'id');
  if (up.error) return fail('write_failed');
  if (!up.data?.length) return fail('row_missing');
  return ok(1, await ledger(d, req, [audit('commitment_resolve', { commitment_id: req.refRow.id, outcome: r.outcome })]));
}

/** memory[] from the coach stage (Stage B). Silent: no receipt line, no badge. */
async function memoryNote(d: AdapterDeps, req: AdapterRequest): Promise<AdapterOutcome> {
  const r = req.row;
  const text = String(r.text ?? '').trim();
  switch (r.kind) {
    case 'person_note':
    case 'coach_note': {
      const n = await d.helpers.appendCoachingNote(req.userId, 'chat', r.kind === 'person_note' ? `Kişi notu: ${text}` : text, req.today);
      return n.ok ? ok(1, await ledger(d, req, [audit('memory_note', { kind: r.kind })])) : fail('write_failed');
    }
    case 'pattern':
      await d.helpers.appendBehavioralPatterns(req.userId, [{ pattern: text, confidence: num(r.confidence) ?? 0.5, source: 'v2_coach', detected_at: (d.now ?? (() => new Date()))().toISOString() }]);
      return ok(1, await ledger(d, req, [audit('memory_note', { kind: r.kind })]));
    case 'portion_calibration': {
      const food = str(r.food);
      const grams = num(r.grams);
      if (!food || grams === null) return fail('invalid_value');
      const cur = await d.db.selectOne('ai_summary', 'portion_calibration', { user_id: req.userId });
      const map = isRec(cur.data?.portion_calibration) ? { ...cur.data.portion_calibration } : {};
      map[food] = `${text || food} ≈ ${grams} g`;
      await d.helpers.updateLayer2(req.userId, { portion_calibration: map });
      return ok(1, await ledger(d, req, [audit('memory_note', { kind: r.kind, food })]));
    }
    default:
      // 'forget' needs a typed per-note store to remove from; until then it is logged, not faked.
      d.log?.('[v2_adapter] memory kind not supported yet', { kind: r.kind });
      return fail('not_supported');
  }
}

const WRITERS: Readonly<Record<string, (d: AdapterDeps, req: AdapterRequest) => Promise<AdapterOutcome>>> = {
  workout_log: workoutLog,
  supplement_log: supplementLog,
  profile_set: profileSet,
  goal_set: goalSet,
  constraint_add: constraintAdd,
  constraint_retract: constraintRetract,
  constraint_confirm: constraintConfirm,
  food_pref: foodPref,
  life_event: lifeEvent,
  lab_value: labValue,
  recipe_save: recipeSave,
  periodic_state: periodicState,
  commitment_add: commitmentAdd,
  commitment_resolve: commitmentResolve,
  memory_note: memoryNote,
};

export const ADAPTER_WRITER_OPS: readonly string[] = Object.keys(WRITERS);

/** The adapter port commit.ts calls. Never throws: a thrown writer is a write_failed outcome. */
export function createAdapter(d: AdapterDeps): AdapterPort {
  return {
    async apply(req) {
      const w = WRITERS[req.op];
      if (!w) return fail('not_supported');
      try {
        return await withReplacement(d, req, () => w(d, req));
      } catch (e) {
        d.log?.('[v2_adapter] writer threw', { op: req.op, error: errMsg(e) });
        return fail('write_failed');
      }
    },
    createEraseHold: (userId, scope) => d.helpers.createEraseHold(userId, scope),
    confirmEraseHold: (userId) => d.helpers.confirmEraseHold(userId),
  };
}
