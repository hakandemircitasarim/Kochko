/**
 * adapter.test.ts — the writers for ops without an RPC, against an in-memory DB. Pinned: the same
 * tables/columns v1 writes (readers keep working), NO override defaults (intensity, MET guess,
 * kcal 0 invented), every write lands a ledger entry (undoable kinds as soft_delete /
 * restore_previous, the rest audit-only), the spine is written through syncConstraint and only for
 * the user's own present constraints, a preference never clears an allergy flag, and a correction
 * on an adapter op undoes the old record first and restores it if the new write fails.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { validateChannelItems } from '../../shared/write-registry/mod.ts';
import { SAMPLE_WRITES } from '../../shared/write-registry/samples.ts';
import { createAdapter, nextListValue } from './adapter.ts';
import type { AdapterRequest } from './commit.ts';
import { turnRefs, validationContext } from './input.ts';
import { NOW, USER } from './testing.ts';
import { fakeAdapterDb, fakeHelpers, seededTurnInput } from './turn-testing.ts';

const w = (op: string, over: Record<string, unknown> = {}) => ({ ...structuredClone(SAMPLE_WRITES[op]), ...over });

/** A validated verdict row for a write (the adapter only ever receives validated rows). */
async function req(item: Record<string, unknown>, message = '', over: Partial<AdapterRequest> = {}, part = 0): Promise<AdapterRequest> {
  const ti = await seededTurnInput();
  const refs = turnRefs(ti);
  const ctx = validationContext(ti, message, NOW, refs);
  const v = validateChannelItems('writes', [item], ctx)[part];
  assert(v.row, `expected a row for ${String(item.op)}: ${JSON.stringify(v.issues)}`);
  const token = typeof item.target === 'string' ? item.target : null;
  return {
    userId: USER, turnId: 'turn-1', today: ctx.today, op: v.op, row: v.row!, verdict: v, replaces: null,
    refRow: token ? refs.refMap.get(token) ?? null : null, ...over,
  };
}

const ledgerEntries = (db: ReturnType<typeof fakeAdapterDb>) =>
  db.calls.filter((c) => c.kind === 'rpc' && c.table === 'v2_ledger_append').flatMap((c) => (c.args?.p_entries as Record<string, unknown>[]) ?? []);

Deno.test('workout_log: workout + expanded sets, model numbers only (no MET guess, no intensity default), soft_delete ledger', async () => {
  const db = fakeAdapterDb();
  const a = createAdapter({ db, helpers: fakeHelpers() });
  const r = await req(w('workout_log', { intensity: null, calories_burned: null }));
  const out = await a.apply(r);
  assertEquals(out.ok, true);
  const wl = db.rows.workout_logs[0];
  assertEquals(wl.calories_burned, null, 'unknown burn stays unknown');
  assertEquals(wl.intensity, null, 'no enum default (§5.3)');
  assertEquals(wl.duration_min, 46, '45.5 → 46: the validator’s lossless SMALLINT fit');
  assertEquals(wl.logged_for_date, '2026-10-06');
  assertEquals(db.rows.strength_sets.length, 3, '3 sets × 8 reps → three rows');
  assertEquals(db.rows.strength_sets[2].set_number, 3);
  const [led] = ledgerEntries(db);
  assertEquals(led.undo_mode, 'soft_delete');
  assertEquals(led.table_name, 'workout_logs');
  assertEquals(led.row_id, wl.id);
  assertEquals(led.pipeline, 'v2');
  assertEquals(out.ref, 'x1', 'the ledger ref is the write handle');
});

Deno.test('workout_log "dün squat yaptım" (no numbers): the workout alone — no invented 1 × 1 × 0 kg set (trial 2026-10-11)', async () => {
  const db = fakeAdapterDb();
  const item = w('workout_log', {
    raw: 'dün squat yaptım', duration_min: null, intensity: null, calories_burned: null, rpe: null, time_local: null,
    strength_sets: [{ exercise: 'squat', as_stated: 'squat', sets: null, reps: null, weight_kg: null }],
  });
  const r = await req(item, 'dün squat yaptım dizim ağrıyor');
  assertEquals(r.verdict.verdict, 'COMMIT', JSON.stringify(r.verdict.issues));
  const out = await createAdapter({ db, helpers: fakeHelpers() }).apply(r);
  assertEquals(out.ok, true);
  assertEquals(db.rows.workout_logs.length, 1);
  assertEquals(db.rows.strength_sets, undefined, 'no set rows for numbers the user never said');
  assertEquals((ledgerEntries(db)[0].meta as Record<string, unknown>).exercises_without_numbers, ['squat']);
});

Deno.test('workout_log: stated sets × reps without a weight → rows with weight NULL, never 0 kg', async () => {
  const db = fakeAdapterDb();
  const item = w('workout_log', { strength_sets: [{ exercise: 'push_up', as_stated: '3x12 şınav', sets: 3, reps: 12, weight_kg: null }] });
  await createAdapter({ db, helpers: fakeHelpers() }).apply(await req(item));
  assertEquals(db.rows.strength_sets.length, 3);
  assert(db.rows.strength_sets.every((s) => s.weight_kg === null && s.reps === 12));
});

Deno.test('supplement_log: macros when stated, column defaults when not; allergen tags ride in the ledger meta', async () => {
  const db = fakeAdapterDb();
  const a = createAdapter({ db, helpers: fakeHelpers() });
  await a.apply(await req(w('supplement_log')));
  assertEquals(db.rows.supplement_logs[0].calories, 120);
  assertEquals(db.rows.supplement_logs[0].amount, '1 ölçek');
  const db2 = fakeAdapterDb();
  await createAdapter({ db: db2, helpers: fakeHelpers() }).apply(await req(w('supplement_log', { name: 'kreatin', as_stated: '5 g', kcal: null, protein_g: null, carbs_g: null, fat_g: null, allergens: [] })));
  assert(!('calories' in db2.rows.supplement_logs[0]), 'no invented 0 kcal: the column keeps its own default');
  assertEquals((ledgerEntries(db)[0].meta as Record<string, unknown>).allergens, ['milk']);
});

Deno.test('profile_set: one column, canonical value, restore_previous ledger with before/after', async () => {
  const db = fakeAdapterDb({ profiles: [{ id: USER, water_target_liters: 2.5 }] });
  const a = createAdapter({ db, helpers: fakeHelpers() });
  const item = { op: 'profile_set', subject: 'self', changes: [{ field: 'water_target_liters', value: '12', unit: 'bardak', list_op: null, as_stated: 'günde 12 bardak' }] };
  const out = await a.apply(await req(item, 'su hedefim günde 12 bardak olsun'));
  assertEquals(out.ok, true);
  assertEquals(db.rows.profiles[0].water_target_liters, 2.4, '12 bardak → 2,4 L (derive: the one unit table)');
  const [led] = ledgerEntries(db);
  assertEquals(led.undo_mode, 'restore_previous');
  assertEquals(led.field_set, ['water_target_liters']);
  assertEquals(led.before, { water_target_liters: 2.5 });
  assertEquals(led.after, { water_target_liters: 2.4 });
});

Deno.test('profile_set list field: add/remove one item, never a joined-string overwrite', async () => {
  assertEquals(nextListValue('koşu, burpee', 'Plank', 'add'), 'koşu, burpee, Plank');
  assertEquals(nextListValue('koşu, burpee', 'Burpee', 'add'), 'koşu, burpee');
  assertEquals(nextListValue('koşu, burpee', 'koşu', 'remove'), 'burpee');
  assertEquals(nextListValue('koşu', 'koşu', 'remove'), null);
  const db = fakeAdapterDb({ profiles: [{ id: USER, disliked_exercises: 'koşu' }] });
  const item = { op: 'profile_set', subject: 'self', changes: [{ field: 'disliked_exercises', value: 'burpee', unit: null, list_op: 'add', as_stated: 'burpee sevmem' }] };
  await createAdapter({ db, helpers: fakeHelpers() }).apply(await req(item));
  assertEquals(db.rows.profiles[0].disliked_exercises, 'koşu, burpee');
});

Deno.test('constraint_add self+has allergen → spine via syncConstraint (canonical id) + legacy allergen mirror, ONE undoable group (undo = deactivate)', async () => {
  const db = fakeAdapterDb();
  const h = fakeHelpers({ db });
  const out = await createAdapter({ db, helpers: h }).apply(await req(w('constraint_add'), 'Fındık alerjim var, ciddi.'));
  assertEquals(out.ok, true);
  assertEquals(out.ledger_missing, undefined);
  assertEquals(h.synced.length, 1);
  assertEquals(h.synced[0].c.kind, 'allergen');
  assertEquals(h.synced[0].c.subject, 'hazelnut');
  assertEquals(h.synced[0].c.severity, 'severe');
  const fp = db.rows.food_preferences[0];
  assertEquals(fp.food_name, 'fındık');
  assertEquals(fp.is_allergen, true);
  const [spine, mirror] = ledgerEntries(db);
  // Trial 2026-10-11: these were audit-only ('profiles', row_id null, undo none) — "geri al" could not
  // take back a wrongly added allergy. Now the spine row is named and its undo deactivates it.
  assertEquals(spine.table_name, 'user_constraints');
  assertEquals(spine.row_id, db.rows.user_constraints[0].id);
  assertEquals(spine.undo_mode, 'restore_previous');
  assertEquals([spine.field_set, spine.before, spine.after], [['active'], { active: false }, { active: true }], 'undo = deactivate, never a delete');
  assertEquals(spine.is_primary, true);
  assertEquals(mirror.table_name, 'food_preferences');
  assertEquals(mirror.row_id, fp.id);
  assertEquals(mirror.before, null, 'the mirror row was created by this write: undo removes it');
  assertEquals(mirror.group, spine.group, 'one logical write');
});

Deno.test('constraint_add re-activating a retracted row: undo restores exactly the prior state (inactive)', async () => {
  const db = fakeAdapterDb({ user_constraints: [{ id: 'uc-x', user_id: USER, kind: 'allergen', subject: 'hazelnut', severity: 'mild', active: false }] });
  await createAdapter({ db, helpers: fakeHelpers({ db }) }).apply(await req(w('constraint_add'), 'Fındık alerjim var, ciddi.'));
  const [spine] = ledgerEntries(db);
  assertEquals(spine.row_id, 'uc-x');
  assertEquals(spine.before, { active: false });
  assertEquals(db.rows.user_constraints.length, 1, 'the upsert reused the row');
});

Deno.test('constraint_add restating an ACTIVE legacy row ("fıstık" stored, model says peanut) → the stored row is confirmed, no second row', async () => {
  const db = fakeAdapterDb({ user_constraints: [{ id: 'uc-1', user_id: USER, kind: 'allergen', subject: 'fıstık', severity: 'severe', active: true }] });
  const h = fakeHelpers({ db });
  const item = { ...w('constraint_add'), subject_id: 'peanut', display_tr: 'fıstık', severity: 'unknown', evidence_quote: 'fıstık alerjim var' };
  const r = await req(item, 'fıstık alerjim var bu arada');
  assertEquals(r.row.effect, 'already_active');
  const out = await createAdapter({ db, helpers: h }).apply(r);
  assertEquals(out.ok, true);
  assertEquals(h.synced.length, 0, 'never a new spine row');
  assertEquals(db.rows.user_constraints.length, 1);
  assertEquals(db.rows.user_constraints[0].severity, 'severe', 'an unknown restatement never erases the stated severity');
  assertEquals(db.rows.user_constraints[0].source, 'confirmed');
  assertEquals(db.rows.food_preferences, undefined, 'no new legacy mirror either');
  const [led] = ledgerEntries(db);
  assertEquals([led.table_name, led.row_id, led.undo_mode], ['user_constraints', 'uc-1', 'none'], 'a confirmation adds no protection to undo');
});

Deno.test('constraint_add restating a stored row WITH a new severity → that row takes it (undoable), still no second row', async () => {
  const db = fakeAdapterDb({ user_constraints: [{ id: 'uc-2', user_id: USER, kind: 'injury', subject: 'sol_diz', severity: null, body_parts: ['knee'], active: true }] });
  const h = fakeHelpers({ db });
  const item = { op: 'constraint_add', kind: 'injury', subject_id: 'sol_diz', display_tr: 'sol diz', whose: 'self', polarity: 'has', severity: 'moderate', body_parts: ['knee'], event_date: null, note: null, evidence_quote: 'dizim orta derecede ağrıyor' };
  const r = await req(item, 'dizim orta derecede ağrıyor');
  assertEquals(r.row.effect, 'activate', 'a severity change is a protective change (the safety salvage keeps it)');
  const out = await createAdapter({ db, helpers: h }).apply(r);
  assertEquals(out.ok, true);
  assertEquals(h.synced.length, 0);
  assertEquals(db.rows.health_events, undefined, 'no duplicate health_events mirror');
  assertEquals(db.rows.user_constraints[0].severity, 'moderate');
  const [led] = ledgerEntries(db);
  assertEquals([led.table_name, led.row_id, led.undo_mode, led.before, led.after], ['user_constraints', 'uc-2', 'restore_previous', { severity: null }, { severity: 'moderate' }]);
});

Deno.test('constraint_add restatement whose stored row vanished since the turn loaded → written as new (protection never drops)', async () => {
  const db = fakeAdapterDb();
  const h = fakeHelpers({ db });
  const item = { ...w('constraint_add'), subject_id: 'peanut', display_tr: 'fıstık', severity: 'unknown', evidence_quote: 'fıstık alerjim var' };
  const r = await req(item, 'fıstık alerjim var');
  assertEquals(r.row.effect, 'already_active');
  const out = await createAdapter({ db, helpers: h }).apply(r);
  assertEquals(out.ok, true);
  assertEquals(h.synced.map((s) => s.c.subject), ['peanut']);
  assertEquals(out.note_tr, 'kayıt yeniden yazıldı');
});

Deno.test('constraint_add unknown severity → spine severity NULL (= severe in every filter); someone else\'s → coach note only', async () => {
  const h = fakeHelpers();
  await createAdapter({ db: fakeAdapterDb(), helpers: h }).apply(await req(w('constraint_add', { severity: 'unknown' }), 'Fındık alerjim var, ciddi.'));
  assertEquals(h.synced[0].c.severity, null);
  const h2 = fakeHelpers();
  const db2 = fakeAdapterDb();
  await createAdapter({ db: db2, helpers: h2 }).apply(await req(w('constraint_add', { whose: 'other_person', evidence_quote: 'kızımın fındık alerjisi var' }), 'kızımın fındık alerjisi var'));
  assertEquals(h2.synced.length, 0, 'never on the user’s spine');
  assertEquals(h2.notes.length, 1);
  assertEquals(db2.rows.food_preferences, undefined);
});

Deno.test('constraint_add injury → spine with body parts + the health_events mirror v1 guards read, both in the undoable group', async () => {
  const db = fakeAdapterDb();
  const h = fakeHelpers({ db });
  const item = { op: 'constraint_add', kind: 'injury', subject_id: 'left_knee', display_tr: 'sol diz', whose: 'self', polarity: 'has', severity: 'moderate', body_parts: ['knee'], event_date: null, note: 'koşarken burktum', evidence_quote: 'dizimi burktum' };
  await createAdapter({ db, helpers: h }).apply(await req(item, 'koşarken dizimi burktum'));
  assertEquals(h.synced[0].c.body_parts, ['knee']);
  assertEquals(db.rows.health_events[0].event_type, 'injury');
  assertEquals(db.rows.health_events[0].is_ongoing, true);
  const [spine, he] = ledgerEntries(db);
  assertEquals([spine.table_name, spine.undo_mode, spine.before], ['user_constraints', 'restore_previous', { active: false }]);
  // Trial 2026-10-11: the health_events mirror had no ledger row at all.
  assertEquals([he.table_name, he.row_id, he.undo_mode, he.before, he.after], ['health_events', db.rows.health_events[0].id, 'restore_previous', null, { is_ongoing: true }]);
  assertEquals(he.group, spine.group);
});

Deno.test('constraint_add dietary → profiles.dietary_restriction mirror with its previous value in the group', async () => {
  const db = fakeAdapterDb({ profiles: [{ id: USER, dietary_restriction: null }] });
  const item = { op: 'constraint_add', kind: 'dietary', subject_id: 'vegan', display_tr: 'vegan', whose: 'self', polarity: 'has', severity: 'unknown', body_parts: [], event_date: null, note: null, evidence_quote: 'veganım' };
  await createAdapter({ db, helpers: fakeHelpers({ db }) }).apply(await req(item, 'veganım'));
  assertEquals(db.rows.profiles[0].dietary_restriction, 'vegan');
  const entries = ledgerEntries(db);
  assertEquals(entries.map((e) => e.table_name), ['user_constraints', 'profiles']);
  assertEquals([entries[1].before, entries[1].after], [{ dietary_restriction: null }, { dietary_restriction: 'vegan' }]);
});

Deno.test('constraint_retract by row id: deactivated (never deleted), legacy allergen flag lowered, undoable group (undo re-activates)', async () => {
  const db = fakeAdapterDb({
    user_constraints: [{ id: 'uc-1', user_id: USER, kind: 'allergen', subject: 'fıstık', active: true }],
    food_preferences: [{ id: 'fp1', user_id: USER, food_name: 'fıstık', preference: 'never', is_allergen: true }],
  });
  // (a severe allergen's removal is held by the validator; the adapter only ever sees the confirmed
  // write, so the request is built from a non-held retract and pointed at the allergen row)
  const msg = 'dizim tamamen iyileşti';
  const r = await req({ op: 'constraint_retract', target: 'c2', evidence_quote: msg, note: null }, msg, { refRow: { table: 'user_constraints', id: 'uc-1' } });
  const out = await createAdapter({ db, helpers: fakeHelpers() }).apply(r);
  assertEquals(out.ok, true);
  assertEquals(db.rows.user_constraints[0].active, false);
  assertEquals(db.rows.food_preferences[0].is_allergen, false);
  assertEquals(db.rows.food_preferences.length, 1, 'nothing is hard-deleted');
  const [spine, fp] = ledgerEntries(db);
  assertEquals([spine.table_name, spine.row_id, spine.undo_mode, spine.before, spine.after], ['user_constraints', 'uc-1', 'restore_previous', { active: true }, { active: false }]);
  assertEquals([fp.table_name, fp.row_id, fp.before, fp.after], ['food_preferences', 'fp1', { is_allergen: true }, { is_allergen: false }]);
});

Deno.test('food_pref: a taste preference never clears an allergy flag', async () => {
  const db = fakeAdapterDb({ food_preferences: [{ id: 'fp1', user_id: USER, food_name: 'brokoli', preference: 'never', is_allergen: true, allergen_severity: 'severe' }] });
  const out = await createAdapter({ db, helpers: fakeHelpers() }).apply(await req(w('food_pref')));
  assertEquals(out.ok, true);
  assertEquals(db.rows.food_preferences[0].preference, 'dislike');
  assertEquals(db.rows.food_preferences[0].is_allergen, true);
  assertEquals(out.note_tr, 'alerji kaydın aynen duruyor');
});

Deno.test('lab_value without a number: value column 0 (NOT NULL) but NO reference range, status in notes', async () => {
  const db = fakeAdapterDb();
  const item = { op: 'lab_value', measured_at: '2026-10-01', items: [{ parameter: 'd_vitamini', value: null, unit: null, status: 'low', reference_min: 30, reference_max: 100, reference_source: 'typical', note: null }] };
  await createAdapter({ db, helpers: fakeHelpers() }).apply(await req(item));
  const row = db.rows.lab_values[0];
  assertEquals(row.value, 0);
  assertEquals(row.reference_min, null, 'is_out_of_range cannot invent a verdict from the placeholder');
  assertEquals(row.notes, 'durum: düşük');
  assertEquals(ledgerEntries(db)[0].undo_mode, 'soft_delete');
});

Deno.test('life_event, goal and commitment writers', async () => {
  const db = fakeAdapterDb({ user_commitments: [{ id: 'uk-1', user_id: USER, commitment: 'x', status: 'pending' }] });
  const a = createAdapter({ db, helpers: fakeHelpers() });
  assertEquals((await a.apply(await req(w('life_event')))).ok, true);
  assertEquals(db.rows.life_events[0].event_date, '2026-11-15');
  assertEquals((await a.apply(await req(w('goal_set', { target_weight_kg: 65, as_stated: '3 ayda 65 kilo' })))).ok, true);
  const goalRpc = db.calls.find((c) => c.kind === 'rpc' && c.table === 'set_active_goal');
  assertEquals((goalRpc?.args?.p_goal as Record<string, unknown>).target_weeks, 13);
  assertEquals(db.rows.goals, undefined, 'set_active_goal owns the goals table (one active goal, atomic)');
  const base = await req(w('life_event'));
  const resolve = await a.apply({ ...base, op: 'commitment_resolve', row: { ref: 'k1', outcome: 'kept', note: null }, refRow: { table: 'user_commitments', id: 'uk-1' } });
  assertEquals(resolve.ok, true);
  assertEquals(db.rows.user_commitments[0].outcome, 'kept');
  assertEquals(db.rows.user_commitments[0].status, 'completed');
  const missing = await a.apply({ ...base, op: 'commitment_resolve', row: { outcome: 'missed' }, refRow: null });
  assertEquals(missing.failure_class, 'unknown_ref');
});

Deno.test('a failed insert is ok:false write_failed; a failed LEDGER append still reports the write (logged loud)', async () => {
  const failing = fakeAdapterDb({}, { fail: { life_events: 'check violation' } });
  const out = await createAdapter({ db: failing, helpers: fakeHelpers() }).apply(await req(w('life_event')));
  assertEquals(out, { ok: false, rows_affected: 0, failure_class: 'write_failed', ref: null, write_id: null });
  const logs: string[] = [];
  const noLedger = fakeAdapterDb({}, { rpc: (name) => (name === 'v2_ledger_append' ? { data: { ok: false, op: 'ledger_append', failure_class: 'invalid_value', detail: {} }, error: null } : undefined) });
  const out2 = await createAdapter({ db: noLedger, helpers: fakeHelpers(), log: (l) => logs.push(l) }).apply(await req(w('life_event')));
  assertEquals(out2.ok, true);
  assertEquals(out2.ref, null);
  assert(logs.some((l) => l.includes('LEDGER APPEND FAILED')));
  assertEquals(out2.ledger_missing, true, 'an undoable write without its ledger row is reported, never a silent ok');
});

Deno.test('a failed AUDIT-only ledger append (goal, prefs…) is not reported as an undo loss; the spine group is (114 not applied)', async () => {
  const boom = () => fakeAdapterDb({}, { rpc: (name) => (name === 'v2_ledger_append' ? { data: null, error: { message: 'boom' } } : undefined) });
  const out = await createAdapter({ db: boom(), helpers: fakeHelpers() }).apply(await req(w('food_pref')));
  assertEquals(out.ok, true);
  assertEquals(out.ledger_missing, undefined, 'audit-only entries were never undoable by ref');
  const ok = await createAdapter({ db: fakeAdapterDb(), helpers: fakeHelpers() }).apply(await req(w('workout_log')));
  assertEquals(ok.ledger_missing, undefined, 'a landed ledger row carries no flag');
  // The spine add IS undoable now: a lost ledger row (e.g. migration 114 missing) is said, never a silent ok.
  const db = boom();
  const spine = await createAdapter({ db, helpers: fakeHelpers({ db }) }).apply(await req(w('constraint_add'), 'Fındık alerjim var, ciddi.'));
  assertEquals(spine.ok, true);
  assertEquals(spine.ledger_missing, true);
});

Deno.test('correction on an adapter op: undo the old record first; a failed new write restores it', async () => {
  const db = fakeAdapterDb();
  const a = createAdapter({ db, helpers: fakeHelpers() });
  const ok = await a.apply({ ...(await req(w('life_event'))), replaces: { ref: 'e1', write_id: null } });
  assertEquals(ok.ok, true);
  assertEquals(db.calls[0].table, 'w_record_delete');
  assertEquals((db.calls[0].args as Record<string, unknown>).p_target, { ref: 'e1' });

  const bad = fakeAdapterDb({}, { fail: { life_events: 'boom' } });
  const out = await createAdapter({ db: bad, helpers: fakeHelpers() }).apply({ ...(await req(w('life_event'))), replaces: { ref: 'e1', write_id: null } });
  assertEquals(out.ok, false);
  assertEquals(bad.calls.filter((c) => c.kind === 'rpc').map((c) => c.table), ['w_record_delete', 'w_record_restore'], 'never a lost record');

  const blocked = fakeAdapterDb({}, { rpc: (name) => (name === 'w_record_delete' ? { data: { ok: false, op: 'record_delete', failure_class: 'later_write', detail: {} }, error: null } : undefined) });
  const out3 = await createAdapter({ db: blocked, helpers: fakeHelpers() }).apply({ ...(await req(w('life_event'))), replaces: { ref: 'e1', write_id: null } });
  assertEquals(out3.failure_class, 'later_write');
  assertEquals(blocked.rows.life_events, undefined, 'no new record when the old one could not be undone (no double count)');
});

Deno.test('memory notes (Stage B memory[]): coach note / pattern / portion calibration; forget is not faked', async () => {
  const db = fakeAdapterDb({ ai_summary: [{ user_id: USER, portion_calibration: { pilav: '1 tabak ≈ 250 g' } }] });
  const h = fakeHelpers();
  const a = createAdapter({ db, helpers: h });
  const base = await req(w('life_event'));
  const mk = (row: Record<string, unknown>) => ({ ...base, op: 'memory_note', row });
  assertEquals((await a.apply(mk({ kind: 'coach_note', text: 'Akşamları tatlı krizi yaşıyor.', confidence: 0.8 }))).ok, true);
  assertEquals(h.notes, ['Akşamları tatlı krizi yaşıyor.']);
  await a.apply(mk({ kind: 'pattern', text: 'cuma akşamı alkol', confidence: 0.6 }));
  assertEquals(h.patterns[0].pattern, 'cuma akşamı alkol');
  await a.apply(mk({ kind: 'portion_calibration', text: 'benim tabağım', food: 'makarna', grams: 300, confidence: 0.7 }));
  assertEquals((h.layer2[0].portion_calibration as Record<string, unknown>).makarna, 'benim tabağım ≈ 300 g');
  assertEquals((h.layer2[0].portion_calibration as Record<string, unknown>).pilav, '1 tabak ≈ 250 g', 'merged, never overwritten');
  assertEquals((await a.apply(mk({ kind: 'forget', text: 'x', confidence: 1 }))).failure_class, 'not_supported');
});

Deno.test('unknown op → not_supported (never a silent ok)', async () => {
  const out = await createAdapter({ db: fakeAdapterDb(), helpers: fakeHelpers() }).apply({ ...(await req(w('life_event'))), op: 'target_change' });
  assertEquals(out.failure_class, 'not_supported');
});
