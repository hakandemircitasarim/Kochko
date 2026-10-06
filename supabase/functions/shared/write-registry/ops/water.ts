/**
 * water_log — final2#3 ("1 bardak" → +1 L) and diff#1/#2 (regex SET/ADD flips) made
 * unrepresentable (AI_MIMARI_V2 §4.4 (1)).
 *
 * The model says HOW MUCH in the user's unit and WHETHER it is an addition or the day's total;
 * code only multiplies by the unit table. There is no `liters` field to put a glass count into.
 */
import { f, op, rule } from '../dsl.ts';
import { requireWhen } from '../rules.ts';
import { LIQUID_UNIT_TR, mlPerUnit } from '../units.ts';
import { resolveDay, round2, trNum } from '../util.ts';

const WATER_UNITS = {
  ml: LIQUID_UNIT_TR.ml,
  litre: LIQUID_UNIT_TR.litre,
  bardak: LIQUID_UNIT_TR.bardak,
  su_bardagi: LIQUID_UNIT_TR.su_bardagi,
  cay_bardagi: LIQUID_UNIT_TR.cay_bardagi,
  kupa: LIQUID_UNIT_TR.kupa,
  sise_330: LIQUID_UNIT_TR.sise_330,
  sise_500: LIQUID_UNIT_TR.sise_500,
  sise_1500: LIQUID_UNIT_TR.sise_1500,
  other: LIQUID_UNIT_TR.other,
} as const;

/** One drink above this is unusual enough to ask (§5.1.6). */
export const WATER_SINGLE_ASK_L = 1.5;
/** Physical ceiling for one entry or a stated day total. */
export const WATER_HARD_MAX_L = 8;

export const water_log = op({
  type: 'water_log',
  channel: 'writes',
  envelope: 'water_log',
  title_tr: 'Su',
  when_tr: 'Yalnızca kullanıcının ŞİMDİ bildirdiği sade su.',
  not_when_tr: 'Çay, kahve, ayran, maden suyu meal_log’a gider. Soru ("3 litre içmeli miyim?"), hedef ve niyet kayıt değildir.',
  fields: {
    day: f.day(),
    as_stated: f.text({ max: 60, tr: 'kullanıcının ifadesi aynen ("1 bardak", "koca şişe")' }),
    quantity: f.num({ hard: [0, 50], tr: 'kullanıcının söylediği sayı, seçtiğin birimde' }),
    unit: f.enum(WATER_UNITS),
    other_ml_each: f.num({ nullable: true, hard: [1, 3000], unit: 'ml', tr: 'yalnız unit=other ise: bir biriminin ml tahminin' }),
    mode: f.enum({ add: 'bu içilen miktar toplama eklenir', set_day_total: 'kullanıcı GÜNÜN TOPLAMINI söyledi' }),
    replaces: f.ref(['d'], { nullable: true, targets: ['water'], tr: 'bu kayıt KAYITLAR’daki bir su yazmasının düzeltilmiş hâliyse onun d-ref’i' }),
  },
  derive: (a, ctx) => {
    const ml = mlPerUnit(a.unit, a.other_ml_each);
    return { date: resolveDay(a.day, ctx.today), liters: ml === null ? null : round2((a.quantity * ml) / 1000) };
  },
  derive_tr: 'litre = miktar × birimin ml değeri / 1000 (bardak 200 ml, çay bardağı 100 ml, kupa 250 ml).',
  writes: { rpc: 'w_water_apply', tables: ['daily_metrics', 'turn_writes'], undo: 'restore_previous' },
  invariants: ['atomic_increment'],
  examples_tr: [
    '"1 bardak su daha içtim" → quantity 1, unit bardak, mode add (kod +0,20 L hesaplar)',
    '"bugün toplam 2 litre içtim" → quantity 2, unit litre, mode set_day_total',
    '"yarım şişe" → quantity 0.5, unit sise_500',
  ],
}).rules({
  hard: [
    requireWhen('other_ml_eksik', 'unit=other iken other_ml_each boş olamaz', (a) => a.unit === 'other', (a) => a.other_ml_each, 'other_ml_each'),
    rule('litre_araligi', `bir kayıt 0–${WATER_HARD_MAX_L} L dışında olamaz`, (_a, d) =>
      d.liters !== null && (d.liters < 0 || d.liters > WATER_HARD_MAX_L) && `${trNum(d.liters, 2)} L fiziksel olarak mümkün değil`,
      { failure_class: 'out_of_range' }),
  ],
  ask: [
    rule('tek_seferde_cok', `tek seferde ${trNum(WATER_SINGLE_ASK_L, 1)} L üstü`, (a, d) =>
      a.mode === 'add' && d.liters !== null && d.liters > WATER_SINGLE_ASK_L && `tek seferde ${trNum(d.liters, 2)} L — birim doğru mu?`,
      { question_tr: 'Bu kadarını tek seferde mi içtin, yoksa günün toplamı mı?' }),
    rule('toplam_kayittan_az', 'günün toplamı olarak söylenen miktar zaten kayıtlı olandan az', (a, d, ctx) => {
      const logged = ctx.day_totals?.[d.date ?? '']?.water_liters ?? null;
      return a.mode === 'set_day_total' && d.liters !== null && logged !== null && d.liters < logged &&
        `günün toplamı ${trNum(d.liters, 2)} L dendi ama kayıtta zaten ${trNum(logged, 2)} L var`;
    }, { question_tr: 'Bu miktar günün toplamı mı, yoksa kayıtlıya ek mi?' }),
    rule('gunluk_toplam_cok', `ekleme sonrası günlük toplam ${WATER_HARD_MAX_L} L üstüne çıkıyor`, (a, d, ctx) => {
      const logged = ctx.day_totals?.[d.date ?? '']?.water_liters ?? 0;
      return a.mode === 'add' && d.liters !== null && logged + d.liters > WATER_HARD_MAX_L;
    }, { question_tr: 'Bugünkü su toplamın çok yüksek görünüyor; bu ekleme doğru mu?' }),
  ],
});
