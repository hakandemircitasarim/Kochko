/**
 * input.test.ts — the plain TurnInput loader (AI_MIMARI_V2 §3.2 T3, §4.2) on an in-memory DB.
 *
 * Pinned: the RPC mirror contract (TURN_INPUT_KEYS in order), the one-wave read (every query is
 * issued before the first await), own-rows-only + window + soft-delete filtering, per-turn refs in
 * the registry grammar with "son tur", the Turkish rendering Stage A reads, fail-closed ED tier on a
 * failed safety read, and the supabase-js adapter's translation.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { TURN_INPUT_KEYS } from '../../shared/v2-db-types.ts';
import { parseRef, REF_KINDS } from '../../shared/write-registry/mod.ts';
import {
  dayLabelTr, edTierOf, fmtTr, loadTurnInput, PLAIN_TURN_INPUT_SCHEMA, renderTurnInput, supabaseTurnInputDb,
  turnInputKeyOrder, turnInputQueries, turnRefs, validationContext,
  type DbResult, type PgClientLike, type SelectQuery,
} from './input.ts';
import { fakeTurnInputDb, NOW, OTHER, seedTables, USER } from './testing.ts';

async function load(tables = seedTables(), fail: Record<string, string> = {}, clientTimezone: string | null = null, now = NOW) {
  const db = fakeTurnInputDb(tables, fail);
  const ti = await loadTurnInput(db, { userId: USER, now, clientTimezone });
  return { ti, db };
}

Deno.test('TurnInput mirrors the v2_turn_input RPC: every TURN_INPUT_KEYS key, in order', async () => {
  const { ti } = await load();
  assertEquals(turnInputKeyOrder(ti), [...TURN_INPUT_KEYS]);
  assertEquals(ti.schema, PLAIN_TURN_INPUT_SCHEMA);
  assertEquals(ti.ref_grammar, 'registry');
  // Ledger-only sections are honestly empty until migration 108 exists.
  assertEquals(ti.metric_writes, []);
  assertEquals(ti.recent_writes, []);
  assertEquals(ti.recently_undone, []);
  assertEquals(ti.references, []);
  assertEquals(JSON.parse(JSON.stringify(ti)).last_turn_refs, ti.last_turn_refs, 'serialisable as is (capture/replay)');
});

Deno.test('all reads leave in ONE wave, before the loader awaits anything', () => {
  const calls: SelectQuery[] = [];
  const db = { select: (q: SelectQuery) => { calls.push(q); return new Promise<DbResult>(() => { /* never settles */ }); } };
  void loadTurnInput(db, { userId: USER, now: NOW });
  assertEquals(calls.length, turnInputQueries(USER, NOW).length, 'every query issued synchronously');
  assert(calls.every((q) => q.filters.some((f) => f.op === 'eq' && f.value === USER)), 'every query is scoped to the user');
});

Deno.test('effective day from the user tz + day boundary; client_timezone wins like v1', async () => {
  const early = new Date('2026-10-07T02:00:00Z'); // 05:00 Istanbul, 22:00 (Oct 6) New York
  assertEquals((await load(seedTables(), {}, null, early)).ti.day, '2026-10-07');
  assertEquals((await load(seedTables(), {}, 'America/New_York', early)).ti.day, '2026-10-06');
  const { ti } = await load();
  assertEquals(ti.window, { from: '2026-10-01', to: '2026-10-07' });
  assertEquals(ti.local, { tz: 'Europe/Istanbul', date: '2026-10-07', time: '14:30', weekday_tr: 'Çarşamba' });
});

Deno.test('records: own rows only, inside the 7-day window, soft-deleted rows hidden, refs oldest first', async () => {
  const { ti } = await load();
  assertEquals(ti.meals.map((m) => [m.ref, m.id]), [['m1', 'ml-1'], ['m2', 'ml-2'], ['m3', 'ml-3']]);
  const json = JSON.stringify(ti);
  for (const hidden of ['başkasının öğünü', 'silinmiş', 'eylülden kalma öğün', OTHER]) assert(!json.includes(hidden), hidden);
  assertEquals(ti.meals[2].total_kcal, 520);
  assertEquals(ti.meals[2].items.map((i) => i.name), ['mercimek çorbası', 'pilav']);
  assertEquals(ti.meals[0].items[0].data_source, 'reference');
  assertEquals(ti.constraints.map((c) => [c.ref, c.subject]), [['c1', 'fıstık'], ['c2', 'sol_diz']], 'active only, by stated_at');
  assertEquals(ti.pending.map((p) => [p.ref, p.id, p.hold_class]), [['p1', 'pw-1', 'safety']], 'expired hold left out');
  assertEquals(ti.commitments.map((k) => k.ref), ['k1']);
  assertEquals(ti.plans.drafts.map((d) => [d.ref, d.revision_count]), [['dft1', 2]]);
  assertEquals(ti.plans.active.map((a) => a.plan_type), ['workout']);
  assertEquals(ti.workouts.map((w) => w.ref), ['w1']);
  assertEquals(ti.supplements.map((s) => s.ref), ['s1']);
  assertEquals(ti.life_events.map((e) => e.ref), ['e1']);
  assertEquals(ti.weights_recent, [{ day: '2026-09-01', kg: 72 }, { day: '2026-10-06', kg: 70.4 }]);
  assertEquals(ti.days.length, 7);
  assertEquals(ti.days[6], {
    day: '2026-10-07', meal_count: 2, kcal: 675, protein_g: 28, carbs_g: 96, fat_g: 22,
    water_liters: 1.6, sleep_hours: 7, sleep_quality: 'good', mood_score: null, steps: null, weight_kg: null,
  });
  assertEquals(ti.profile.gender, 'female');
  assert(!('secret_column_not_mirrored' in ti.profile), 'only the RPC profile keys are mirrored');
  assertEquals(ti.targets_today?.calorie_target_min, 1500);
  assertEquals(ti.portion_calibration, { pilav: '1 tabak ≈ 250 g' });
});

Deno.test('"son tur" = writes between the last user message and the coach answer', async () => {
  const { ti } = await load();
  assertEquals(ti.last_assistant?.created_at, '2026-10-07T09:58:20Z');
  assertEquals(ti.last_turn_action_types, ['meal_log', 'water_log']);
  assertEquals(ti.meals.map((m) => m.last_turn), [false, false, true]);
  // daily_metrics day refs: yesterday then today, one per non-empty field.
  assertEquals(ti.metric_days.map((d) => [d.ref, d.day, d.target, d.last_turn]), [
    ['d1', '2026-10-06', 'water', false], ['d2', '2026-10-06', 'mood', false], ['d3', '2026-10-06', 'steps', false],
    ['d4', '2026-10-06', 'weight', false], ['d5', '2026-10-07', 'water', true], ['d6', '2026-10-07', 'sleep', false],
  ]);
  assertEquals(ti.last_turn_refs, ['m3', 'd5']);
  assertEquals(ti.history.map((h) => h.role), ['user', 'assistant', 'user', 'assistant'], 'oldest first');
});

Deno.test('turnRefs: exactly the rendered set, registry grammar, targets the validator checks', async () => {
  const { ti } = await load();
  const { rendered, refMap } = turnRefs(ti);
  assertEquals(Object.keys(rendered).sort(), ['c1', 'c2', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'dft1', 'e1', 'k1', 'm1', 'm2', 'm3', 'p1', 's1', 'w1'].sort());
  for (const [tok, r] of Object.entries(rendered)) {
    assertEquals(parseRef(tok)?.kind, r.kind, tok);
    assert(r.kind in REF_KINDS);
  }
  assertEquals(rendered.d5, {
    kind: 'd', target: 'water', undone: false, later_write_on_same_field: false, op: 'water_log', day: '2026-10-07',
    last_turn: true, summary_tr: 'su: gün toplamı 1,60 L',
  });
  assertEquals(rendered.w1.target, 'workout');
  assertEquals(rendered.c1.constraint, { kind: 'allergen', subject: 'fıstık', severity: 'severe', body_parts: [] });
  assertEquals(rendered.p1.pending, { op: 'account_erase_request', expires_at: '2026-10-07T12:20:00Z', replies_since: 1 });
  assertEquals(refMap.get('m1'), { table: 'meal_logs', id: 'ml-1' });
  assertEquals(refMap.get('d5'), { table: 'daily_metrics', id: 'dm-7', field: 'water_liters' });
});

Deno.test('validationContext: today, totals, identity, last weigh-in in 14 days, ED tier', async () => {
  const { ti } = await load();
  const ctx = validationContext(ti, '1 bardak su daha içtim', NOW);
  assertEquals(ctx.today, '2026-10-07');
  assertEquals(ctx.now_iso, NOW.toISOString());
  assertEquals(ctx.user_message, '1 bardak su daha içtim');
  assertEquals(ctx.day_totals?.['2026-10-07'], { water_liters: 1.6, steps: null, sleep_hours: 7, weight_kg: null });
  assertEquals(ctx.profile, { birth_year: 1990, height_cm: 165, weight_kg: 70, gender: 'female', periodic_state: null });
  assertEquals(ctx.last_weight, { kg: 70.4, day: '2026-10-06' });
  assertEquals(ctx.goal, { goal_type: 'lose_weight', target_weight_kg: 62 });
  assertEquals(ctx.ed_tier, 'none');
  assertEquals(Object.keys(ctx.refs).length, 17);
});

Deno.test('a failed section is empty and named; a failed SAFETY read is ED tier unknown (fail closed)', async () => {
  const { ti } = await load(seedTables(), { user_safety_state: 'permission denied', meal_logs: 'column x does not exist' });
  assertEquals(ti.load_errors.map((e) => e.section).sort(), ['meals', 'safety']);
  assertEquals(ti.meals, []);
  assertEquals(edTierOf(ti), 'unknown');
  assertEquals(validationContext(ti, 'x', NOW).ed_tier, 'unknown');
  assertStringIncludes(renderTurnInput(ti), 'YAZMA KAPILARI: kalori açığı ya da hedef düşürme KAPALI (güvenlik)');
  // A missing row (no failure) is simply 'none'.
  const t2 = seedTables();
  t2.user_safety_state = [];
  assertEquals(edTierOf((await load(t2)).ti), 'none');
});

Deno.test('a select that throws or rejects never breaks the loader', async () => {
  const db = {
    select(q: SelectQuery): Promise<DbResult> {
      if (q.table === 'goals') throw new Error('sync boom');
      if (q.table === 'profiles') return Promise.reject(new Error('async boom'));
      return Promise.resolve({ data: [], error: null });
    },
  };
  const ti = await loadTurnInput(db, { userId: USER, now: NOW });
  assertEquals(ti.load_errors.map((e) => e.section).sort(), ['goal', 'profile']);
  assertEquals(ti.day, '2026-10-07', 'no profile → UTC day, still a valid TurnInput');
});

Deno.test('renderTurnInput: §4.2 blocks with registry titles, refs, Turkish numbers, no ids', async () => {
  const { ti } = await load();
  const r = renderTurnInput(ti);
  assertStringIncludes(r, 'ŞİMDİ: Çarşamba 7 Eki 2026, saat 14:30 (Europe/Istanbul) · today = 2026-10-07 · yesterday = 2026-10-06');
  assertStringIncludes(r, 'PROFİL: cinsiyet kadın · doğum yılı 1990 · boy 165 cm · kilo 70,0 kg · su hedefi 2,5 L · hedef kilo vermek (hedef kilo 62,0)');
  assertStringIncludes(r, 'BUGÜN: 2 öğün 675 kcal · su 1,60 L · uyku 7,0 saat');
  assertStringIncludes(r, "KAYITLAR (son 7 gün; düzeltme/silme yalnız bu ref'lerle):");
  assertStringIncludes(r, 'm1 · Cum 2 Eki akşam · "6 tavuk nugget" → tavuk göğsü (6 adet ~900 g) 1.708 kcal · toplam 1.708 kcal [tablo]');
  assertStringIncludes(r, 'm3 · bugün öğle · "öğlen mercimek çorbası ve pilav" → mercimek çorbası (1 kase) 180 kcal; pilav (1 tabak) 340 kcal · toplam 520 kcal [model] (son tur)');
  assertStringIncludes(r, 'd5 · bugün su: gün toplamı 1,60 L (son tur)');
  assertStringIncludes(r, 'd1 · dün su: gün toplamı 2,00 L');
  assertStringIncludes(r, 'w1 · dün antrenman · "dün 30 dk koştum" → cardio 30 dk orta ~250 kcal · 2 set');
  assertStringIncludes(r, 's1 · bugün takviye · kreatin (5 g)');
  assertStringIncludes(r, 'e1 · olay · 2026-11-14 · kardeşimin düğünü (wedding)');
  assertStringIncludes(r, 'KISITLAR:\nc1 · alerji · fıstık · ciddi\nc2 · sakatlık · sol_diz · şiddeti belirtilmemiş · bölge: knee · not: "koşarken burktum"');
  assertStringIncludes(r, 'BEKLEYEN ONAYLAR:\np1 · account_erase_request · açıldı bugün 12:50 · bitiş bugün 15:20');
  assertStringIncludes(r, 'AÇIK SÖZLER:\nk1 · "akşam 8\'den sonra yemeyeceğim" · takip Per 8 Eki');
  assertStringIncludes(r, 'PLAN TASLAĞI:\ndft1 · beslenme taslağı · hafta 2026-10-05 · 2 revizyon');
  assertStringIncludes(r, 'AKTİF PLAN: antrenman (hafta 2026-09-28)');
  assertStringIncludes(r, 'SON TUR (koçun son cevabıyla kaydedilenler): meal_log, water_log');
  assertStringIncludes(r, 'SON ASİSTAN MESAJI: "Afiyet olsun! Öğle yemeğini kaydettim.');
  for (const id of [USER, 'ml-1', 'dm-7', 'uc-1', 'pw-1', 'wp-d']) assert(!r.includes(id), `no row id in the prompt: ${id}`);
  assertEquals(renderTurnInput(ti), r, 'deterministic');
  assert(!r.includes('YAZMA KAPILARI'), 'tier none → no gate line');
});

Deno.test('renderTurnInput: an empty user still gets every block, with "yok"', async () => {
  const ti = (await load({ profiles: [{ id: USER, home_timezone: 'Europe/Istanbul' }] })).ti;
  const r = renderTurnInput(ti);
  for (const block of ['KAYITLAR (son 7 gün', 'KISITLAR:\nyok', 'BEKLEYEN ONAYLAR:\nyok', 'AÇIK SÖZLER:\nyok', 'PLAN TASLAĞI:\nyok', 'AKTİF PLAN: yok']) {
    assertStringIncludes(r, block);
  }
  assertStringIncludes(r, "ref'lerle):\nyok");
  assert(!r.includes('SON ASİSTAN MESAJI'));
});

Deno.test('fmtTr and dayLabelTr', () => {
  assertEquals(fmtTr(1708), '1.708');
  assertEquals(fmtTr(1234567), '1.234.567');
  assertEquals(fmtTr(1.6, 2), '1,60');
  assertEquals(fmtTr(-2.5, 1), '-2,5');
  assertEquals(fmtTr(999), '999');
  assertEquals(dayLabelTr('2026-10-07', '2026-10-07'), 'bugün');
  assertEquals(dayLabelTr('2026-10-06', '2026-10-07'), 'dün');
  assertEquals(dayLabelTr('2026-10-02', '2026-10-07'), 'Cum 2 Eki');
});

Deno.test('supabaseTurnInputDb translates the query and sends it on select(), not on await', async () => {
  const log: string[] = [];
  const builder = {
    select(c: string) { log.push(`select(${c})`); return builder; },
    eq(c: string, v: unknown) { log.push(`eq(${c},${v})`); return builder; },
    gte(c: string, v: unknown) { log.push(`gte(${c},${v})`); return builder; },
    lte(c: string, v: unknown) { log.push(`lte(${c},${v})`); return builder; },
    gt(c: string, v: unknown) { log.push(`gt(${c},${v})`); return builder; },
    lt(c: string, v: unknown) { log.push(`lt(${c},${v})`); return builder; },
    in(c: string, v: readonly unknown[]) { log.push(`in(${c},${v.join('|')})`); return builder; },
    is(c: string, v: null) { log.push(`is(${c},${v})`); return builder; },
    order(c: string, o: { ascending: boolean }) { log.push(`order(${c},${o.ascending})`); return builder; },
    limit(n: number) { log.push(`limit(${n})`); return builder; },
    then<A, B>(ok: (v: { data: unknown; error: null }) => A, _bad?: (e: unknown) => B) {
      log.push('SENT');
      return Promise.resolve(ok({ data: [{ id: 1 }], error: null }));
    },
  };
  const client: PgClientLike = { from: (t: string) => { log.push(`from(${t})`); return builder; } };
  const db = supabaseTurnInputDb(client);
  const p = db.select({
    section: 's', table: 'meal_logs', columns: '*', limit: 5,
    filters: [{ op: 'eq', column: 'user_id', value: USER }, { op: 'in', column: 'role', values: ['a', 'b'] }, { op: 'is', column: 'resolved_at', value: null }, { op: 'gte', column: 'd', value: '2026-10-01' }],
    order: [{ column: 'logged_at', ascending: false }],
  });
  assertEquals(log, [
    'from(meal_logs)', 'select(*)', `eq(user_id,${USER})`, 'in(role,a|b)', 'is(resolved_at,null)', 'gte(d,2026-10-01)',
    'order(logged_at,false)', 'limit(5)', 'SENT',
  ]);
  assertEquals(await p, { data: [{ id: 1 }], error: null });
});
