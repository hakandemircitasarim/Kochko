/**
 * Periodic states and calorie programs (map-writes #33, #34, #36–#39).
 *
 * Every band-moving program goes through applyTargetAdjust and the ONE gate
 * (assertTargetAllowed, §5.1.8): at ED tier ≥ amber — or when the tier could not be read — no
 * deficit is written. Maintenance is allowed at amber (it is not a deficit) but is always ASKed:
 * "hedefime ulaştım mı sence?" once switched a user to maintenance from a question.
 */
import { f, op, rule } from '../dsl.ts';
import { edGate } from '../rules.ts';
import { PERIODIC_STATES, PLATEAU_STRATEGIES } from '../vocab.ts';

export const periodic_state = op({
  type: 'periodic_state',
  channel: 'writes',
  envelope: 'periodic_state_update',
  title_tr: 'Dönemsel durum',
  when_tr: 'Geçici bir dönemin (ramazan, hastalık, sınav, seyahat, hamilelik…) bugün başlaması ya da bitmesi; yarın başlayacak dönem henüz yazılmaz.',
  not_when_tr: 'bakım, mini cut gibi kalori programları (target_change).',
  fields: {
    state: f.enum(PERIODIC_STATES, { tr: 'none = dönem bitti' }),
    end_date: f.date({ nullable: true, past_days: 0, future_days: 365 }),
    note: f.text({ nullable: true, max: 200 }),
  },
  writes: { rpc: 'w_periodic_state_apply', tables: ['profiles', 'challenges', 'ai_summary', 'turn_writes'], undo: 'restore_previous' },
  invariants: ['if_pause_for_incompatible_states', 'challenge_pause_resume'],
  tier: 'rare',
}).rules({
  ask: [
    rule('program_bitiyor', 'aktif bakım/mini cut programı varken dönem temizleme programı da bitirir', (a, _d, ctx) =>
      a.state === 'none' && (ctx.profile?.periodic_state === 'maintenance' || ctx.profile?.periodic_state === 'mini_cut'),
      { question_tr: 'Şu an bir kalori programındasın; onu da bitirmek istiyor musun?' }),
  ],
});

const PROGRAMS = {
  maintenance_start: 'bakım kalorisine geçiş',
  mini_cut: '2–4 hafta kısa açık',
  plateau_strategy: 'plato stratejisi',
  recovery: 'fazla yeme sonrası 2 gün hafif açık',
  mvd: 'bugün yalnız temel hedefler',
} as const;

const ENVELOPE_BY_PROGRAM: Record<keyof typeof PROGRAMS, string> = {
  maintenance_start: 'maintenance_start',
  mini_cut: 'mini_cut_start',
  plateau_strategy: 'plateau_strategy_apply',
  recovery: 'recovery_plan',
  mvd: 'mvd_activate',
};

export const target_change = op({
  type: 'target_change',
  channel: 'writes',
  envelope: (a) => ENVELOPE_BY_PROGRAM[a.program],
  title_tr: 'Kalori programı',
  when_tr: 'Açıkça istenen ya da kabul edilen kalori programı (bakım, mini cut, plato stratejisi, telafi, MVD günü); "hedefime ulaştım mı?" sorusu değil.',
  not_when_tr: '"hedefime ulaştım mı sence?" gibi soru.',
  fields: {
    program: f.enum(PROGRAMS, { explain: true }),
    strategy_id: f.enum(PLATEAU_STRATEGIES, { nullable: true, tr: 'yalnız plateau_strategy’de' }),
    weeks: f.num({ nullable: true, hard: [2, 4], decimals: 0, tr: 'yalnız mini_cut’ta (2–4)' }),
    excess_kcal: f.num({ unit: 'kcal', nullable: true, hard: [0, 10000], decimals: 0, tr: 'telafide fazlalık tahminin' }),
    reason: f.text({ max: 200 }),
  },
  writes: { fn: 'applyTargetAdjust', tables: ['daily_plans', 'profiles', 'user_commitments', 'turn_writes'], undo: 'restore_previous', hold_op: 'target_change' },
  invariants: ['assert_target_allowed', 'clinical_floor', 'forward_projection'],
  tier: 'rare',
}).rules({
  hard: [
    rule('strateji_eksik', 'plateau_strategy için strategy_id gerekli', (a) => a.program === 'plateau_strategy' && a.strategy_id === null,
      { repairable: true, failure_class: 'missing_field' }),
    rule('hafta_eksik', 'mini_cut için weeks gerekli', (a) => a.program === 'mini_cut' && a.weeks === null,
      { repairable: true, failure_class: 'missing_field' }),
    edGate((a) => a.program === 'mini_cut' || a.program === 'recovery' ||
      (a.program === 'plateau_strategy' && (a.strategy_id === 'tdee_recalc' || a.strategy_id === 'calorie_cycle')), 'kalori açığı yaratan program'),
  ],
  ask: [
    rule('bant_degisimi', 'günlük kalori bandını değiştiren program önce sorulur', (a) =>
      a.program === 'maintenance_start' || a.program === 'mini_cut' ||
      (a.program === 'plateau_strategy' && a.strategy_id !== 'training_change'),
      { question_tr: 'Bunu başlatırsam günlük kalori aralığın değişecek; başlatayım mı?' }),
  ],
});
