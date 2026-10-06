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
  when_tr: 'Kullanıcı hayatında geçici bir dönemin başladığını/bittiğini söylüyorsa (ramazan, hastalık, sınav, seyahat, hamilelik…).',
  not_when_tr: 'Bakım, mini cut gibi kalori programları target_change’dir.',
  fields: {
    state: f.enum(PERIODIC_STATES),
    end_date: f.date({ nullable: true, past_days: 0, future_days: 365, tr: 'biliniyorsa bitiş tarihi' }),
    note: f.text({ nullable: true, max: 200 }),
  },
  writes: { rpc: 'w_periodic_state_apply', tables: ['profiles', 'challenges', 'ai_summary', 'turn_writes'], undo: 'restore_previous' },
  invariants: ['if_pause_for_incompatible_states', 'challenge_pause_resume'],
}).rules({
  ask: [
    rule('program_bitiyor', 'aktif bakım/mini cut programı varken dönem temizleme programı da bitirir', (a, _d, ctx) =>
      a.state === 'none' && (ctx.profile?.periodic_state === 'maintenance' || ctx.profile?.periodic_state === 'mini_cut'),
      { question_tr: 'Şu an bir kalori programındasın; onu da bitirmek istiyor musun?' }),
  ],
});

const PROGRAMS = {
  maintenance_start: 'bakıma geçiş (kilo koruma kalorisi)',
  mini_cut: 'mini cut (2–4 hafta kısa açık)',
  plateau_strategy: 'plato stratejisi',
  recovery: 'fazla yeme sonrası telafi (2 gün hafif açık)',
  mvd: 'minimum uygulanabilir gün (bugün sadece temel hedefler)',
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
  when_tr: 'Kullanıcı açıkça bir program istiyor ya da kabul ediyorsa (bakıma geç, mini cut, plato stratejisi, telafi, MVD günü).',
  not_when_tr: '"Hedefime ulaştım mı sence?" gibi soru program başlatmaz.',
  fields: {
    program: f.enum(PROGRAMS),
    strategy_id: f.enum(PLATEAU_STRATEGIES, { nullable: true, tr: 'yalnız plateau_strategy’de' }),
    weeks: f.num({ nullable: true, hard: [2, 4], decimals: 0, tr: 'yalnız mini_cut’ta (2–4)' }),
    excess_kcal: f.num({ unit: 'kcal', nullable: true, hard: [0, 10000], decimals: 0, tr: 'telafide fazlalık tahminin; kod canlı toplamlarla karşılaştırır' }),
    reason: f.text({ max: 200 }),
  },
  writes: { fn: 'applyTargetAdjust', tables: ['daily_plans', 'profiles', 'user_commitments', 'turn_writes'], undo: 'restore_previous', hold_op: 'target_change' },
  invariants: ['assert_target_allowed', 'clinical_floor', 'forward_projection'],
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
