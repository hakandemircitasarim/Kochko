/**
 * workout_log (+ strength sets) and supplement_log (map-writes #6, #12).
 *
 * Fractional minutes/kcal used to fail the SMALLINT insert and lose the whole workout (22P02);
 * now they are rounded at the boundary and listed in `normalized[]`. Supplements carry the
 * model's kcal/macros (whey finally counts) and allergen tags (omega-3 → fish, final2#11).
 */
import { f, op, rule } from '../dsl.ts';
import { ALLERGENS, INTENSITY, WORKOUT_TYPES } from '../vocab.ts';
import { resolveDay } from '../util.ts';

/** Above this a workout is long enough to confirm (5 hours). */
export const WORKOUT_ASK_MIN = 300;
/** Burn faster than this per minute is implausible for a human. */
export const MAX_KCAL_PER_MIN = 20;

export const workout_log = op({
  type: 'workout_log',
  channel: 'writes',
  envelope: 'workout_log',
  title_tr: 'Antrenman',
  when_tr: 'Kullanıcı yaptığı bir egzersizi/sporu bildiriyorsa.',
  not_when_tr: 'Yalnız adım sayısı step_log’dur; plan, niyet ve "yarın koşacağım" kayıt değildir.',
  fields: {
    day: f.day(),
    raw: f.text({ max: 300, tr: 'kullanıcının sözleri, aynen' }),
    workout_type: f.enum(WORKOUT_TYPES),
    duration_min: f.num({ unit: 'dk', nullable: true, hard: [1, 1440], decimals: 0 }),
    intensity: f.enum(INTENSITY, { nullable: true }),
    calories_burned: f.num({ unit: 'kcal', nullable: true, hard: [0, 5000], decimals: 0, tr: 'SENİN yakım tahminin; bilmiyorsan null' }),
    rpe: f.num({ nullable: true, hard: [1, 10], decimals: 0, tr: 'algılanan zorluk 1–10, söylendiyse' }),
    time_local: f.text({ nullable: true, format: 'hhmm' }),
    strength_sets: f.list({ min: 0, max: 30 }, {
      exercise: f.text({ max: 60, tr: 'snake_case kanonik ad (bench_press, squat, deadlift…)' }),
      as_stated: f.text({ max: 60 }),
      sets: f.num({ hard: [1, 20], decimals: 0 }),
      reps: f.num({ hard: [1, 100], decimals: 0 }),
      weight_kg: f.num({ unit: 'kg', nullable: true, hard: [0, 500], decimals: 1 }),
    }),
    replaces: f.ref(['w'], { nullable: true }),
  },
  derive: (a, ctx) => ({ date: resolveDay(a.day, ctx.today) }),
  writes: { rpc: 'w_workout_apply', tables: ['workout_logs', 'strength_sets', 'achievements', 'daily_plans', 'turn_writes'], undo: 'soft_delete' },
  invariants: ['post_workout_budget_bump', 'pr_detection'],
  examples_tr: ['"45 dk koştum" → workout_type cardio, duration_min 45, calories_burned senin tahminin'],
}).rules({
  ask: [
    rule('cok_uzun', `${WORKOUT_ASK_MIN} dakikadan uzun antrenman`, (a) => (a.duration_min ?? 0) > WORKOUT_ASK_MIN,
      { question_tr: 'Antrenman süresini doğru anladım mı?' }),
  ],
  flag: [
    rule('yakim_yuksek', `dakikada ${MAX_KCAL_PER_MIN} kcal üstü yakım`, (a) =>
      a.calories_burned !== null && a.duration_min !== null && a.duration_min > 0 && a.calories_burned / a.duration_min > MAX_KCAL_PER_MIN),
  ],
});

export const supplement_log = op({
  type: 'supplement_log',
  channel: 'writes',
  envelope: 'supplement_log',
  title_tr: 'Takviye',
  when_tr: 'Kullanıcı ALDIĞI bir takviyeyi bildiriyorsa (kreatin, whey, omega-3, vitamin…). Alerjisiyle çakışsa bile kaydedilir.',
  not_when_tr: '"kreatin işe yarıyor mu?" sorudur; düzenli kullanım anlatısı memory notudur.',
  fields: {
    day: f.day(),
    name: f.text({ max: 80 }),
    as_stated: f.text({ max: 60, tr: 'miktar kullanıcının ifadesiyle ("1 ölçek", "5 g")' }),
    kcal: f.num({ unit: 'kcal', nullable: true, hard: [0, 2000], decimals: 0, tr: 'kalori içeriyorsa (whey, gainer) tahminin; yoksa null' }),
    protein_g: f.num({ unit: 'g', nullable: true, hard: [0, 200], decimals: 1 }),
    carbs_g: f.num({ unit: 'g', nullable: true, hard: [0, 400], decimals: 1 }),
    fat_g: f.num({ unit: 'g', nullable: true, hard: [0, 200], decimals: 1 }),
    allergens: f.enumList(ALLERGENS, { tr: 'kesin kaynak (balık yağı → fish, krill → crustacean, whey → milk)' }),
    may_contain: f.enumList(ALLERGENS, { tr: 'belirsiz kaynak (sade "omega 3" → fish, crustacean)' }),
    replaces: f.ref(['s'], { nullable: true }),
  },
  derive: (a, ctx) => ({ date: resolveDay(a.day, ctx.today) }),
  writes: { rpc: 'w_supplement_apply', tables: ['supplement_logs', 'ai_summary', 'turn_writes'], undo: 'soft_delete' },
  invariants: ['allergen_consumption_check', 'macro_totals'],
  examples_tr: ['"1 ölçek whey içtim" → kcal ~120, protein_g ~24, allergens [milk]'],
});
