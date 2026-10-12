/**
 * input.test.ts — the plain TurnInput loader (AI_MIMARI_V2 §3.2 T3, §4.2) on an in-memory DB.
 *
 * Pinned: the RPC mirror contract (TURN_INPUT_KEYS in order), the one-wave read (every query is
 * issued before the first await), own-rows-only + window + soft-delete filtering, per-turn refs in
 * the registry grammar with "son tur", the Turkish lines of the Stage A view (rendered by the ONE
 * renderer, stage-a-request.ts), the ONE ValidationContext builder, fail-closed ED tier on a failed
 * safety read, and the supabase-js adapter's translation.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { TURN_INPUT_KEYS } from '../../shared/v2-db-types.ts';
import { parseRef, REF_KINDS, validateChannelItems } from '../../shared/write-registry/mod.ts';
import {
  buildValidationContext, canonicalConstraintSubject, constraintLine, constraintSummaryTr, dayLabelTr, edTierOf, fmtTr, loadTurnInput, PLAIN_TURN_INPUT_SCHEMA, profilePhrases, renderTurnInput,
  stageAView, supabaseTurnInputDb, TURN_INPUT_HISTORY_MESSAGES, turnInputKeyOrder, turnInputQueries, turnRefs, validationContext,
  type DbResult, type PgClientLike, type SelectQuery,
} from './input.ts';
import { COACH_HISTORY_MESSAGES } from './coach.ts';
import { renderTurnInputBlock, STAGE_A_HISTORY_MESSAGES } from './stage-a-request.ts';
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

Deno.test('history window: the loader reads at least what Stage B renders (coach.ts COACH_HISTORY_MESSAGES) — the coach sees its own last replies and does not repeat them', () => {
  const chat = turnInputQueries(USER, NOW).find((q) => q.table === 'chat_messages')!;
  assertEquals(chat.limit, TURN_INPUT_HISTORY_MESSAGES);
  assert(TURN_INPUT_HISTORY_MESSAGES >= COACH_HISTORY_MESSAGES, `loader ${TURN_INPUT_HISTORY_MESSAGES} < coach window ${COACH_HISTORY_MESSAGES}`);
  assert(TURN_INPUT_HISTORY_MESSAGES >= STAGE_A_HISTORY_MESSAGES);
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
    last_turn: true, summary_tr: 'su: gün toplamı 1,60 L', snapshot: { value: 1.6 },
  });
  assertEquals(rendered.w1.target, 'workout');
  // A legacy Turkish allergen subject carries the canonical id the model writes; the stored one rides along.
  assertEquals(rendered.c1.constraint, { kind: 'allergen', subject: 'peanut', severity: 'severe', body_parts: [], stored_subject: 'fıstık' });
  assertEquals(rendered.c1.user_summary_tr, 'fıstık alerjisi (ciddi)', 'a legacy row keeps the user\'s own word');
  assertEquals(constraintSummaryTr({ kind: 'allergen', subject: 'peanut', severity: null }), 'yer fıstığı alerjisi', 'an id becomes its Turkish label');
  assertEquals(constraintSummaryTr({ kind: 'medication', subject: 'levotiroksin', severity: 'mild' }), 'ilaç: levotiroksin (hafif)');
  assertEquals(constraintSummaryTr({ kind: 'dietary', subject: 'vegan', severity: null }), 'vegan beslenme kısıtı');
  assertEquals(rendered.c2.constraint, { kind: 'injury', subject: 'sol_diz', severity: null, body_parts: ['knee'] }, 'only allergen subjects have a vocabulary');
  assertEquals(rendered.c2.user_summary_tr, 'diz sakatlığı');
  // m#: the model reads the provenance tag; the user-facing summary and the snapshot do not carry it.
  assert(rendered.m1.summary_tr?.endsWith(']'), rendered.m1.summary_tr ?? '');
  assert(!rendered.m1.user_summary_tr?.includes('['), rendered.m1.user_summary_tr ?? '');
  assertEquals(rendered.m1.user_summary_tr, rendered.m1.summary_tr?.replace(/ \[[^\]]+\]$/u, ''));
  assertEquals(rendered.m1.snapshot?.total_kcal, ti.meals[0].total_kcal);
  assertEquals(rendered.m1.snapshot?.items?.length, ti.meals[0].items.length);
  assertEquals(rendered.p1.pending, { op: 'account_erase_request', expires_at: '2026-10-07T12:20:00Z', replies_since: 1 });
  assertEquals(refMap.get('m1'), { table: 'meal_logs', id: 'ml-1' });
  assertEquals(refMap.get('d5'), { table: 'daily_metrics', id: 'dm-7', field: 'water_liters' });
});

Deno.test('canonicalConstraintSubject: legacy Turkish allergen subjects read as the vocabulary id (the allergen invariant\'s own dictionary)', () => {
  assertEquals(canonicalConstraintSubject('allergen', 'fıstık'), 'peanut');
  assertEquals(canonicalConstraintSubject('allergen', 'yumurta'), 'egg');
  assertEquals(canonicalConstraintSubject('intolerance', 'süt'), 'milk');
  assertEquals(canonicalConstraintSubject('allergen', 'antep fıstığı'), 'pistachio');
  assertEquals(canonicalConstraintSubject('allergen', 'peanut'), 'peanut', 'an id stays an id');
  assertEquals(canonicalConstraintSubject('allergen', 'kabuklu'), 'kabuklu', 'two ids name it (crustacean, mollusc): kept as stored');
  assertEquals(canonicalConstraintSubject('intolerance', 'laktoz'), 'laktoz', 'no id names it: kept as stored');
  assertEquals(canonicalConstraintSubject('allergen', 'custom:çilek'), 'custom:çilek');
  assertEquals(canonicalConstraintSubject('injury', 'yumurta'), 'yumurta', 'only allergen/intolerance subjects have a vocabulary');
});

Deno.test('legacy spine row (v1 "fıstık", severe) through the loader: "yok" is redirected to a retract of THAT row, a retract is two-step, a restatement is not a new row', async () => {
  const { ti } = await load();
  const yok = 'fıstık alerjim yok aslında';
  const absent = validateChannelItems('writes', [{
    op: 'constraint_add', kind: 'allergen', subject_id: 'peanut', display_tr: 'fıstık', whose: 'self', polarity: 'does_not_have', severity: 'unknown',
    body_parts: [], event_date: null, note: null, evidence_quote: yok,
  }], validationContext(ti, yok, NOW))[0];
  assertEquals(absent.verdict, 'REJECT');
  assertEquals(absent.issues.map((i) => i.code), ['kaldirma_ref_ile'], 'never a "yok" coach note beside the active severe legacy row');
  const retract = validateChannelItems('writes', [{ op: 'constraint_retract', target: 'c1', evidence_quote: yok, note: null }], validationContext(ti, yok, NOW))[0];
  assertEquals(retract.verdict, 'ASK');
  assertEquals(retract.issues.map((i) => i.code), ['iki_adimli_kaldirma']);
  assertEquals(turnRefs(ti).refMap.get('c1'), { table: 'user_constraints', id: 'uc-1' }, 'the retract acts on the stored legacy row');
  const var_ = 'fıstık alerjim var';
  const again = validateChannelItems('writes', [{
    op: 'constraint_add', kind: 'allergen', subject_id: 'peanut', display_tr: 'fıstık', whose: 'self', polarity: 'has', severity: 'unknown',
    body_parts: [], event_date: null, note: null, evidence_quote: var_,
  }], validationContext(ti, var_, NOW))[0];
  assertEquals(again.row?.effect, 'already_active');
  assertEquals((again.row?.existing as Record<string, unknown>).subject, 'fıstık');
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
  // The recent conversation (oldest first) — the last assistant message is its last coach line.
  assertStringIncludes(r, 'SON KONUŞMA:\n');
  assertStringIncludes(r, '\nkoç: "Afiyet olsun! Öğle yemeğini kaydettim.');
  assert(r.trimEnd().endsWith('Akşam için protein ağırlıklı bir şey düşünür müsün?"'), 'the conversation sits nearest the message');
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
  assert(!r.includes('SON KONUŞMA'));
});

Deno.test('stageAView: data → lines only; the block is the shared renderer over it (image flag, tier gate, no ids)', async () => {
  const { ti } = await load();
  const v = stageAView(ti);
  assertEquals(renderTurnInput(ti), renderTurnInputBlock(v));
  assertEquals(v.now, { today: '2026-10-07', local_date: '2026-10-07', local_time: '14:30', tz: 'Europe/Istanbul' });
  assertEquals(v.gates, [], 'the ED-tier gate is the renderer\'s, not a line the loader writes');
  assertEquals(v.image, false);
  assertEquals(stageAView(ti, { image: true }).image, true);
  assertEquals(v.records.find((r) => r.ref === 'm3')?.last_turn, true);
  assertEquals(v.last_turn_writes, ['meal_log', 'water_log']);
  assertEquals(v.history.length, ti.history.length);
  assert(!JSON.stringify(v).includes('ml-1') && !JSON.stringify(v).includes(USER), 'no row ids, no user id');
});

Deno.test('profilePhrases / constraintLine: the shared wording (the eval words fixtures with the same helpers)', () => {
  assertEquals(profilePhrases({ gender: 'female', height_cm: 165, home_timezone: 'Europe/Istanbul' }, null), ['cinsiyet kadın', 'boy 165 cm']);
  assertEquals(
    profilePhrases({ weight_kg: 69.4, target_weight_kg: 70, digestive_issues: 'süt alerjisi', water_target_liters: null }, { goal_type: null, target_weight_kg: 70 }, { rest: true }),
    ['kilo 69,4 kg', 'hedef kilo 70,0', 'digestive_issues=süt alerjisi'],
  );
  assertEquals(constraintLine({ kind: 'allergen', subject: 'fıstık', severity: 'severe' }), 'alerji · fıstık · ciddi');
  assertEquals(constraintLine({ kind: 'allergen', subject: 'süt', severity: 'unknown', whose: 'self', active: false }), 'alerji · süt · şiddeti belirtilmemiş · PASİF (geri alındı)');
  assertEquals(constraintLine({ kind: 'allergen', subject: 'yumurta', severity: null, whose: 'other_person' }), 'alerji · yumurta · şiddeti belirtilmemiş · başkasının');
});

Deno.test('buildValidationContext: the ONE builder — typed identity, last weigh-in within 14 days, null goal, day totals', () => {
  const ctx = buildValidationContext({
    today: '2026-10-07', now_iso: '2026-10-07T11:30:00Z', message: 'm', refs: {},
    days: [{ day: '2026-10-07', water_liters: 1.6 }],
    profile: { birth_year: '1990', height_cm: 165, gender: 'female', unrelated: 'x' },
    goal: null,
    weights: [{ day: '2026-09-01', kg: 72 }, { day: '2026-10-06', kg: 70.4 }, { day: '2026-10-08', kg: 69 }, { day: '2026-10-05', kg: 0 }],
    ed_tier: 'amber',
  });
  assertEquals(ctx.day_totals, { '2026-10-07': { water_liters: 1.6, steps: null, sleep_hours: null, weight_kg: null } });
  assertEquals(ctx.profile, { birth_year: 1990, height_cm: 165, weight_kg: null, gender: 'female', periodic_state: null });
  assertEquals(ctx.last_weight, { kg: 70.4, day: '2026-10-06' }, 'a future or out-of-window weigh-in never counts');
  assertEquals(ctx.goal, null);
  assertEquals(ctx.ed_tier, 'amber');
  assertEquals(ctx.reference_rows, {});
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

// ─── re-trial 2026-10-12 (lane U): what only the ledger knows about the rendered records ───────────

const tw = (o: Record<string, unknown>) => ({
  user_id: USER, ref: null, op: 'meal_log', for_date: '2026-10-07', field_set: [], before: null, is_primary: true, reverses: null,
  undone_at: null, meta: {}, turn_id: 't-old', created_at: '2026-10-07T06:00:00Z', ...o,
});

function ledgerSeed() {
  const t = seedTables();
  t.turn_writes = [
    // Newest: a meal CORRECTION (the old meal's replaced delete + the new meal, one group) — m2.
    tw({ id: 'w-c2', seq: 21, op: 'meal_log', table_name: 'meal_logs', row_id: 'ml-2', field_set: [], group_id: 'g-corr', ref: 'm7', turn_id: 't-corr', created_at: '2026-10-07T07:00:00Z' }),
    tw({ id: 'w-c1', seq: 20, op: 'record_delete', table_name: 'meal_logs', row_id: 'ml-old-x', field_set: ['is_deleted', 'deleted_at'], group_id: 'g-corr', reverses: 'w-0', meta: { reason: 'replaced' }, turn_id: 't-corr', created_at: '2026-10-07T07:00:00Z' }),
    // Today's water add.
    tw({ id: 'w-w', seq: 12, op: 'water_log', table_name: 'daily_metrics', row_id: 'dm-7', field_set: ['water_liters'], group_id: 'g-water', ref: 'd4', created_at: '2026-10-07T06:30:00Z' }),
    // Yesterday's weigh-in, written by a CONFIRMED hold (the writer claimed it: meta.pending_id).
    tw({ id: 'w-y', seq: 5, op: 'body_weight', table_name: 'daily_metrics', row_id: 'dm-6', for_date: '2026-10-06', field_set: ['weight_kg'], group_id: 'g-y', ref: 'w1', meta: { pending_id: 'pw-old' }, created_at: '2026-10-06T08:00:00Z' }),
    // An undone write is never a candidate; another user's row is never read.
    tw({ id: 'w-u', seq: 30, op: 'step_log', table_name: 'daily_metrics', row_id: 'dm-6', field_set: ['steps'], group_id: 'g-u', undone_at: '2026-10-07T09:00:00Z' }),
    tw({ id: 'w-x', seq: 40, op: 'meal_log', table_name: 'meal_logs', row_id: 'ml-x', group_id: 'g-x', user_id: OTHER }),
  ];
  return t;
}

Deno.test('ledger facts on rendered refs: correction, confirmed through a hold, recent write rank (lane U)', async () => {
  const { ti } = await load(ledgerSeed());
  assertEquals(ti.ledger_recent?.map((w) => w.id), ['w-u', 'w-c2', 'w-c1', 'w-w', 'w-y'], 'own rows only, newest first');
  const r = turnRefs(ti).rendered;
  const water = ti.metric_days.find((d) => d.target === 'water' && d.day === '2026-10-07')!.ref;
  const weight = ti.metric_days.find((d) => d.target === 'weight')!.ref;
  const steps = ti.metric_days.find((d) => d.target === 'steps')!.ref;
  assertEquals([r.m2.correction, r.m2.recent_rank], [true, 1]);
  assertEquals([r[water].recent_rank, r[water].correction], [2, undefined]);
  assertEquals([r[weight].confirmed_hold, r[weight].recent_rank], [true, 3]);
  assertEquals(r[steps].recent_rank, undefined, 'an undone write is not a candidate');
  assertEquals(r.m3.recent_rank, undefined, 'no ledger row → no ledger fact');
  // A confirmed hold's result ref marks the write too (a held correction is closed after its writer ran).
  const t2 = ledgerSeed();
  (t2.turn_writes[3] as Record<string, unknown>).meta = {};
  t2.pending_writes.push({ id: 'pw-ok', user_id: USER, op: 'record_update', status: 'confirmed', resolved_at: '2026-10-06T08:00:01Z', result: { ok: true, ref: 'w1' } });
  const again = await load(t2);
  assertEquals(turnRefs(again.ti).rendered[weight].confirmed_hold, true);
  const t3 = ledgerSeed();
  (t3.turn_writes[3] as Record<string, unknown>).meta = {};
  assertEquals(turnRefs((await load(t3)).ti).rendered[weight].confirmed_hold, undefined, 'an ordinary write is not "confirmed through a hold"');
});

Deno.test('Stage A view: with nothing written last turn, the newest writes are marked so "geri al" can name them', async () => {
  const { ti } = await load(ledgerSeed());
  const block = renderTurnInput(ti);
  assertStringIncludes(block, '→ haşlanmış yumurta (2 adet) 155 kcal · toplam 155 kcal [model] (en son yazılan)');
  assertStringIncludes(block, 'tartı: 70,4 kg (sondan 3. yazılan)');
  // A last-turn record keeps its "(son tur)" and gets no recency mark on top.
  assert(!block.includes('(sondan 2. yazılan) (son tur)') && !block.includes('su: gün toplamı 1,60 L (sondan'), block);
  // Without ledger rows nothing changes (older producers, eval fixtures).
  assert(!renderTurnInput((await load()).ti).includes('yazılan)'));
});

Deno.test('a constraint added last turn is "(son tur)" in KISITLAR and the one c# record_delete may undo; a later write in another turn closes that door', async () => {
  const t = seedTables();
  t.user_constraints.push({ id: 'uc-new', user_id: USER, kind: 'allergen', subject: 'sesame', severity: null, body_parts: [], active: true, source: 'user_stated', stated_at: '2026-10-07T09:58:12Z' });
  t.turn_writes = [tw({ id: 'w-add', seq: 50, op: 'constraint_add', table_name: 'user_constraints', row_id: 'uc-new', for_date: null, field_set: ['active'], before: { active: false }, group_id: 'g-add', turn_id: 't-prev', created_at: '2026-10-07T09:58:12Z' })];
  const { ti } = await load(t);
  const c = ti.constraints.find((x) => x.id === 'uc-new')!.ref;
  const r = turnRefs(ti).rendered[c];
  assertEquals([r.undo_add, r.last_turn], [true, true]);
  assertStringIncludes(renderTurnInput(ti), `${c} · alerji · sesame · şiddeti belirtilmemiş (son tur)`);
  const del = [{ op: 'delete', ref: c, reason: 'geri al', evidence_quote: 'geri al', restore_replaced: false }];
  assertEquals(validateChannelItems('record_ops', del, validationContext(ti, 'geri al', NOW)).map((v) => v.verdict), ['ASK']);
  // A meal written in a LATER turn: the add is no longer the newest write turn → constraint_retract's job.
  t.turn_writes.unshift(tw({ id: 'w-meal', seq: 60, op: 'meal_log', table_name: 'meal_logs', row_id: 'ml-3', group_id: 'g-m', turn_id: 't-next', created_at: '2026-10-07T10:30:00Z' }));
  const later = await load(t);
  assertEquals(turnRefs(later.ti).rendered[c].undo_add, undefined);
  assertEquals(validateChannelItems('record_ops', del, validationContext(later.ti, 'geri al', NOW)).map((v) => v.verdict), ['REJECT']);
  // A restatement of an already-active row (before.active true) is not undone here either.
  t.turn_writes = [tw({ id: 'w-re', seq: 70, op: 'constraint_add', table_name: 'user_constraints', row_id: 'uc-new', for_date: null, field_set: ['active'], before: { active: true }, group_id: 'g-re', turn_id: 't-re' })];
  assertEquals(turnRefs((await load(t)).ti).rendered[c].undo_add, undefined);
});

Deno.test('the ledger reads are in the one wave, user-scoped and bounded', () => {
  const qs = turnInputQueries(USER, NOW);
  const ledger = qs.find((q) => q.section === 'ledger_recent')!;
  assertEquals([ledger.table, ledger.limit, ledger.order?.[0]], ['turn_writes', 80, { column: 'seq', ascending: false }]);
  const holds = qs.find((q) => q.section === 'holds_confirmed')!;
  assertEquals(holds.table, 'pending_writes');
  assert(holds.filters.some((f) => f.op === 'eq' && f.column === 'status' && f.value === 'confirmed'));
});
