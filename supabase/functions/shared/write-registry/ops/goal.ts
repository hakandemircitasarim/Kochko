/**
 * goal_set — ONE goal write (map-writes #24 + #40).
 *
 * v1 had two writers with two vocabularies on one table: profile_update's English goal_type with
 * a silent 12-week default ("3 ayda 5 kilo" → 12 weeks), and goal_suggestion's Turkish keys that
 * rejected the English ones. Now: canonical ids, the timeframe the user actually said, the atomic
 * set_active_goal RPC, and a hold when the goal would move the calorie band.
 * Micro-goals (water/steps) are profile_set targets, not goals.
 */
import { f, op, rule, type ValidationContext } from '../dsl.ts';
import { edGate } from '../rules.ts';
import { getMaxRateKgPerWeek } from '../../clinical-rules.ts';
import { GOAL_TYPES } from '../vocab.ts';
import { daysBetween, round2, trNum } from '../util.ts';

interface GoalArgs {
  goal_type: keyof typeof GOAL_TYPES;
  target_weight_kg: number | null;
  target_weeks: number | null;
  target_date: string | null;
}

function weeksOf(a: GoalArgs, ctx: ValidationContext): number | null {
  if (a.target_weeks !== null) return a.target_weeks;
  if (a.target_date !== null) return Math.max(1, Math.ceil(daysBetween(ctx.today, a.target_date) / 7));
  return null;
}

/** A goal that asks for a (bigger) deficit — closed at ED tier ≥ amber (§7.1 assertTargetAllowed). */
function tightens(a: GoalArgs, ctx: ValidationContext): boolean {
  if (a.goal_type !== 'lose_weight') return false;
  const cur = ctx.goal ?? null;
  if (cur?.goal_type !== 'lose_weight') return true;
  return a.target_weight_kg !== null && (cur.target_weight_kg === null || a.target_weight_kg < cur.target_weight_kg);
}

export const goal_set = op({
  type: 'goal_set',
  channel: 'writes',
  envelope: 'goal_suggestion',
  title_tr: 'Hedef',
  when_tr: 'Kullanıcı kendi ana hedefini koyuyor ya da değiştiriyorsa ("3 ayda 5 kilo vermek istiyorum").',
  not_when_tr: '"Hedefime ulaştım mı sence?" sorudur. Su/adım hedefi profile_set’tir. Varsayım ("versem ne olur") kayıt değildir.',
  fields: {
    goal_type: f.enum(GOAL_TYPES),
    target_weight_kg: f.num({ unit: 'kg', nullable: true, hard: [30, 300], decimals: 1 }),
    target_weeks: f.num({ unit: 'hafta', nullable: true, hard: [1, 104], decimals: 0, tr: 'süre hafta olarak söylendiyse ("3 ay" → 13)' }),
    target_date: f.date({ nullable: true, past_days: 0, future_days: 730, tr: 'belirli bir tarih söylendiyse YYYY-MM-DD' }),
    reason: f.text({ nullable: true, max: 300, tr: 'bu hedefin sebebi ("3 ay sonra düğün")' }),
    as_stated: f.text({ max: 160 }),
  },
  derive: (a, ctx) => {
    const weeks = weeksOf(a, ctx);
    const start = ctx.profile?.weight_kg ?? null;
    const rate = weeks !== null && a.target_weight_kg !== null && typeof start === 'number'
      ? round2(Math.abs(start - a.target_weight_kg) / weeks) : null;
    return { weeks, weekly_rate_kg: rate, start_weight_kg: start };
  },
  derive_tr: 'hafta = target_weeks ya da bugünden target_date’e; haftalık hız = |şimdiki kilo − hedef| / hafta.',
  writes: { rpc: 'set_active_goal', tables: ['goals', 'profiles', 'belief_events', 'turn_writes'], undo: 'supersede', hold_op: 'goal_set' },
  invariants: ['assert_target_allowed', 'tdee_recalc', 'band_refresh'],
  examples_tr: ['"3 ayda 75 kiloya inmek istiyorum" → goal_type lose_weight, target_weight_kg 75, target_weeks 13'],
}).rules({
  hard: [
    rule('iki_sure', 'target_weeks ve target_date ikisi birden dolu olamaz', (a) => a.target_weeks !== null && a.target_date !== null,
      { repairable: true, failure_class: 'invalid_value' }),
    edGate((a, ctx) => tightens(a, ctx), 'kilo verme hedefi sıkılaştırması'),
  ],
  ask: [
    rule('hedef_yonu_celiski', 'hedef kilo, hedef tipiyle ters yönde', (a, d) => {
      if (a.target_weight_kg === null || d.start_weight_kg === null) return false;
      const up = a.target_weight_kg > d.start_weight_kg;
      return ((a.goal_type === 'lose_weight' && up) || (a.goal_type === 'gain_weight' && !up)) &&
        `şimdiki ${trNum(d.start_weight_kg, 1)} kg, hedef ${trNum(a.target_weight_kg, 1)} kg ama hedef tipi "${GOAL_TYPES[a.goal_type]}"`;
    }, { question_tr: 'Hedef kilon ile hedef yönün çelişiyor gibi; tam olarak ne istiyorsun?' }),
    rule('hiz_yuksek', 'haftalık hız klinik üst sınırı aşıyor', (a, d) =>
      d.weekly_rate_kg !== null && d.weekly_rate_kg > getMaxRateKgPerWeek(a.goal_type) &&
      `haftada ${trNum(d.weekly_rate_kg, 2)} kg — güvenli üst sınır ${trNum(getMaxRateKgPerWeek(a.goal_type), 1)} kg`,
      { question_tr: 'Bu süre bu hedef için çok kısa; süreyi uzatalım mı?' }),
    rule('hedef_degisiyor', 'aktif hedefin tipi değişiyor (kalori bandı oynar)', (a, _d, ctx) =>
      !!ctx.goal?.goal_type && ctx.goal.goal_type !== a.goal_type,
      { question_tr: 'Ana hedefini değiştirmek istediğinden emin misin? Günlük kalori aralığın da değişecek.' }),
  ],
});
