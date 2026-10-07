/**
 * ai-chat/v2/testing.ts — test doubles for the v2 shadow pipeline (no network, no database).
 *
 *   fakeTurnInputDb  — an in-memory TurnInputDb with PostgREST-like filters, ordering, limits and the
 *                      two embeds the loader uses (meal_log_items, strength_sets)
 *   fakeResponses    — a fetch-shaped Transport answering like the OpenAI Responses API
 *   fakeSink         — a ShadowSink that records rows or fails like a missing-column PostgREST error
 *   seedTables       — a realistic user: meals (one "son tur"), water, a constraint, a hold, a draft…
 *
 * Imported only by *.test.ts files.
 */
import type { Transport } from '../../shared/openai.ts';
import type { DbFilter, DbResult, DbRow, SelectQuery, TurnInputDb } from './input.ts';
import type { ShadowSink } from './shadow.ts';

export const USER = '4750e6be-0000-4000-8000-000000000001';
export const OTHER = '4750e6be-0000-4000-8000-000000000002';
/** 2026-10-07 11:30 UTC = 14:30 in Istanbul (UTC+3): effective day 2026-10-07. */
export const NOW = new Date('2026-10-07T11:30:00Z');

function passes(row: DbRow, f: DbFilter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'eq': return v === f.value;
    case 'gte': return v !== null && v !== undefined && String(v) >= String(f.value);
    case 'lte': return v !== null && v !== undefined && String(v) <= String(f.value);
    case 'gt': return v !== null && v !== undefined && String(v) > String(f.value);
    case 'lt': return v !== null && v !== undefined && String(v) < String(f.value);
    case 'in': return f.values.includes(v as string | number);
    case 'is': return v === null || v === undefined;
  }
}

export interface FakeDb extends TurnInputDb {
  calls: SelectQuery[];
}

/** In-memory DB. `fail` makes a table answer with a PostgREST-style error. */
export function fakeTurnInputDb(tables: Record<string, DbRow[]>, fail: Record<string, string> = {}): FakeDb {
  const calls: SelectQuery[] = [];
  return {
    calls,
    select(q: SelectQuery): Promise<DbResult> {
      calls.push(q);
      if (fail[q.table]) return Promise.resolve({ data: null, error: { message: fail[q.table], code: '42703' } });
      let rows = (tables[q.table] ?? []).filter((r) => q.filters.every((f) => passes(r, f)));
      for (const o of [...(q.order ?? [])].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = String(a[o.column] ?? ''), y = String(b[o.column] ?? '');
          return (x < y ? -1 : x > y ? 1 : 0) * (o.ascending ? 1 : -1);
        });
      }
      if (q.limit !== undefined) rows = rows.slice(0, q.limit);
      const cols = q.columns.split(',').map((c) => c.trim());
      const star = cols.includes('*');
      const out = rows.map((r) => {
        const base: DbRow = star ? { ...r } : Object.fromEntries(cols.filter((c) => !c.includes('(')).map((c) => [c, r[c]]));
        if (cols.includes('meal_log_items(*)')) base.meal_log_items = (tables.meal_log_items ?? []).filter((i) => i.meal_log_id === r.id);
        if (cols.includes('strength_sets(*)')) base.strength_sets = (tables.strength_sets ?? []).filter((s) => s.workout_log_id === r.id);
        return base;
      });
      return Promise.resolve({ data: out, error: null });
    },
  };
}

/** A user with one week of history; m-order and "son tur" are deterministic. */
export function seedTables(): Record<string, DbRow[]> {
  return {
    profiles: [{
      id: USER, gender: 'female', birth_year: 1990, height_cm: 165, weight_kg: 70, home_timezone: 'Europe/Istanbul',
      active_timezone: null, day_boundary_hour: 4, water_target_liters: 2.5, onboarding_completed: true, premium: true,
      secret_column_not_mirrored: 'x',
    }],
    goals: [{ id: 'g1', user_id: USER, goal_type: 'lose_weight', target_weight_kg: 62, is_active: true, created_at: '2026-09-01T10:00:00Z' }],
    user_safety_state: [{ user_id: USER, ed_tier: 'none', ed_signal_count: 0, ed_last_signal_at: null, ed_escalated_at: null, overtraining_tier: 'none', updated_at: '2026-10-01T00:00:00Z' }],
    daily_plans: [{ user_id: USER, date: '2026-10-07', plan_type: 'rest', calorie_target_min: 1500, calorie_target_max: 1700, protein_target_g: 110, carbs_target_g: 150, fat_target_g: 55, water_target_liters: 2.5, status: 'active', version: 2 }],
    user_constraints: [
      { id: 'uc-2', user_id: USER, kind: 'injury', subject: 'sol_diz', severity: null, body_parts: ['knee'], active: true, source: 'user_stated', note: 'koşarken burktum', stated_at: '2026-10-03T08:00:00Z', confidence: 1, confirmed_at: null },
      { id: 'uc-1', user_id: USER, kind: 'allergen', subject: 'fıstık', severity: 'severe', body_parts: [], active: true, source: 'user_stated', note: null, stated_at: '2026-09-20T08:00:00Z', confidence: 1, confirmed_at: null },
      { id: 'uc-old', user_id: USER, kind: 'allergen', subject: 'süt', severity: 'mild', body_parts: [], active: false, source: 'user_stated', note: null, stated_at: '2026-09-01T08:00:00Z' },
    ],
    meal_logs: [
      { id: 'ml-3', user_id: USER, raw_input: 'öğlen mercimek çorbası ve pilav', meal_type: 'lunch', input_method: 'ai_chat', confidence: 'medium', logged_at: '2026-10-07T09:58:10Z', logged_for_date: '2026-10-07', is_deleted: false },
      { id: 'ml-1', user_id: USER, raw_input: '6 tavuk nugget', meal_type: 'dinner', input_method: 'ai_chat', confidence: 'medium', logged_at: '2026-10-02T17:00:00Z', logged_for_date: '2026-10-02', is_deleted: false },
      { id: 'ml-2', user_id: USER, raw_input: 'kahvaltı yumurta', meal_type: 'breakfast', input_method: 'ai_chat', confidence: 'high', logged_at: '2026-10-07T05:00:00Z', logged_for_date: '2026-10-07', is_deleted: false },
      { id: 'ml-del', user_id: USER, raw_input: 'silinmiş', meal_type: 'snack', logged_at: '2026-10-06T10:00:00Z', logged_for_date: '2026-10-06', is_deleted: true },
      { id: 'ml-old', user_id: USER, raw_input: 'eylülden kalma öğün', meal_type: 'snack', logged_at: '2026-09-20T10:00:00Z', logged_for_date: '2026-09-20', is_deleted: false },
      { id: 'ml-x', user_id: OTHER, raw_input: 'başkasının öğünü', meal_type: 'lunch', logged_at: '2026-10-07T09:00:00Z', logged_for_date: '2026-10-07', is_deleted: false },
    ],
    meal_log_items: [
      { id: 'i1', meal_log_id: 'ml-1', food_name: 'tavuk göğsü', portion_text: '6 adet', portion_grams: 900, calories: 1708, protein_g: 280, carbs_g: 0, fat_g: 32, data_source: 'reference' },
      { id: 'i2', meal_log_id: 'ml-2', food_name: 'haşlanmış yumurta', portion_text: '2 adet', portion_grams: null, calories: 155, protein_g: 13, carbs_g: 1, fat_g: 11, data_source: 'ai_estimate' },
      { id: 'i3', meal_log_id: 'ml-3', food_name: 'mercimek çorbası', portion_text: '1 kase', portion_grams: null, calories: 180, protein_g: 9, carbs_g: 25, fat_g: 5, data_source: 'ai_estimate' },
      { id: 'i4', meal_log_id: 'ml-3', food_name: 'pilav', portion_text: '1 tabak', portion_grams: null, calories: 340, protein_g: 6, carbs_g: 70, fat_g: 6, data_source: 'ai_estimate' },
    ],
    daily_metrics: [
      { id: 'dm-7', user_id: USER, date: '2026-10-07', water_liters: 1.6, sleep_hours: 7, sleep_quality: 'good', steps: null, mood_score: null, weight_kg: null },
      { id: 'dm-6', user_id: USER, date: '2026-10-06', water_liters: 2.0, sleep_hours: null, steps: 8000, mood_score: 4, weight_kg: 70.4 },
    ],
    workout_logs: [{ id: 'wl-1', user_id: USER, raw_input: 'dün 30 dk koştum', workout_type: 'cardio', duration_min: 30, intensity: 'moderate', calories_burned: 250, logged_at: '2026-10-06T16:00:00Z', logged_for_date: '2026-10-06', is_deleted: false }],
    strength_sets: [
      { id: 'ss1', workout_log_id: 'wl-1', exercise_name: 'squat', is_deleted: false },
      { id: 'ss2', workout_log_id: 'wl-1', exercise_name: 'squat', is_deleted: true },
      { id: 'ss3', workout_log_id: 'wl-1', exercise_name: 'squat' },
    ],
    supplement_logs: [{ id: 'sl-1', user_id: USER, supplement_name: 'kreatin', amount: '5 g', calories: 0, protein_g: 0, logged_at: '2026-10-07T06:00:00Z', logged_for_date: '2026-10-07' }],
    lab_values: [],
    life_events: [{ id: 'le-1', user_id: USER, title: 'kardeşimin düğünü', event_type: 'wedding', event_date: '2026-11-14', note: null, is_active: true }],
    weight_history: [
      { user_id: USER, recorded_at: '2026-10-06', weight_kg: 70.4 },
      { user_id: USER, recorded_at: '2026-09-01', weight_kg: 72 },
    ],
    pending_writes: [
      { id: 'pw-1', user_id: USER, op: 'account_erase_request', payload: { scope: 'memory' }, status: 'pending', created_at: '2026-10-07T09:50:00Z', expires_at: '2026-10-07T12:20:00Z' },
      { id: 'pw-exp', user_id: USER, op: 'account_erase_request', payload: {}, status: 'pending', created_at: '2026-10-05T09:00:00Z', expires_at: '2026-10-05T09:30:00Z' },
    ],
    user_commitments: [{ id: 'uk-1', user_id: USER, commitment: "akşam 8'den sonra yemeyeceğim", follow_up_at: '2026-10-08T17:00:00Z', status: 'pending', resolved_at: null, created_at: '2026-10-06T19:00:00Z' }],
    weekly_plans: [
      { id: 'wp-d', user_id: USER, plan_type: 'diet', status: 'draft', week_start: '2026-10-05', generated_at: '2026-10-06T10:00:00Z', approved_at: null, revision_count: 2 },
      { id: 'wp-a', user_id: USER, plan_type: 'workout', status: 'active', week_start: '2026-09-28', generated_at: '2026-09-27T10:00:00Z', approved_at: '2026-09-27T11:00:00Z', revision_count: 0 },
    ],
    chat_messages: [
      { user_id: USER, role: 'user', content: 'öğlen mercimek çorbası ve pilav yedim', created_at: '2026-10-07T09:58:00Z', actions_executed: null },
      { user_id: USER, role: 'assistant', content: 'Afiyet olsun! Öğle yemeğini kaydettim. Akşam için protein ağırlıklı bir şey düşünür müsün?', created_at: '2026-10-07T09:58:20Z', actions_executed: [{ type: 'meal_log' }, { type: 'water_log' }] },
      { user_id: USER, role: 'assistant', content: 'eski cevap', created_at: '2026-10-06T19:00:00Z', actions_executed: null },
      { user_id: USER, role: 'user', content: 'eski soru', created_at: '2026-10-06T18:59:00Z', actions_executed: null },
    ],
    chat_sessions: [{ user_id: USER, is_active: true, active_intent: null }],
    ai_summary: [{ user_id: USER, portion_calibration: { pilav: '1 tabak ≈ 250 g' } }],
  };
}

export interface FakeCall {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** A Responses-API-shaped transport. Each reply is a function of the call. */
export function fakeResponses(reply: (call: FakeCall) => Response | Promise<Response>): { transport: Transport; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const transport: Transport = async (url, init) => {
    const call = { url, body: JSON.parse(String(init.body)) as Record<string, unknown>, headers: new Headers(init.headers) };
    calls.push(call);
    return await reply(call);
  };
  return { transport, calls };
}

/** A completed Responses body whose output text is `value` (JSON-encoded). */
export function responsesBody(value: unknown, usage = { input_tokens: 9000, output_tokens: 180, cached: 8000, reasoning: 90 }): Response {
  return new Response(JSON.stringify({
    id: 'resp_test', model: 'gpt-5.6-terra-2026-08-01', status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: {
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens,
      input_tokens_details: { cached_tokens: usage.cached }, output_tokens_details: { reasoning_tokens: usage.reasoning },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A refusal Responses body. */
export function refusalBody(text: string): Response {
  return new Response(JSON.stringify({
    id: 'resp_refusal', model: 'gpt-5.6-terra', status: 'completed',
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: text }] }],
    usage: { input_tokens: 9000, output_tokens: 10, total_tokens: 9010 },
  }), { status: 200 });
}

export interface FakeSink extends ShadowSink {
  rows: Record<string, unknown>[];
  attempts: number;
}

/** Records inserted rows; `mode: 'no_columns'` answers like PostgREST without migration 111. */
export function fakeSink(mode: 'ok' | 'no_columns' | 'error' = 'ok'): FakeSink {
  const rows: Record<string, unknown>[] = [];
  const sink: FakeSink = {
    rows,
    attempts: 0,
    insert(row) {
      sink.attempts++;
      if (mode === 'no_columns') {
        return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'decision' column of 'ai_turn_log' in the schema cache" } });
      }
      if (mode === 'error') return Promise.resolve({ error: { code: '23514', message: 'new row violates check constraint' } });
      rows.push(row);
      return Promise.resolve({ error: null });
    },
  };
  return sink;
}
