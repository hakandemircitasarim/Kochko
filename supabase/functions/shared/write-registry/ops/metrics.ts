/**
 * Daily metrics — weight, sleep, mood, steps (map-writes #7/#9/#10/#11).
 *
 * Each is a typed field on daily_metrics written through one atomic RPC that also journals the
 * previous value in turn_writes, so all four become undoable for the first time (§6.1). The
 * regex date mutators ("dün" → days_ago, sleep forced to today) are gone: the model sets `day`,
 * and the sleep convention (the day you WOKE UP) is documented here, not enforced by a regex.
 */
import { f, op, rule } from '../dsl.ts';
import { SLEEP_QUALITY } from '../vocab.ts';
import { resolveDay, trNum } from '../util.ts';

/** Weight jump vs the last 14 days that is asked about: > max(3 kg, 4 %) (§5.1.6). */
export function weightJumpTooBig(prevKg: number, nextKg: number): boolean {
  return Math.abs(nextKg - prevKg) > Math.max(3, prevKg * 0.04);
}
/** Materiality vs the stored profile weight: ≥ max(7 kg, 8 %) (§5.1.7). */
export function weightMaterial(storedKg: number, nextKg: number): boolean {
  return Math.abs(nextKg - storedKg) >= Math.max(7, storedKg * 0.08);
}

export const body_weight = op({
  type: 'body_weight',
  channel: 'writes',
  envelope: 'weight_log',
  title_tr: 'Tartı',
  when_tr: 'Kullanıcı bugün (ya da son 7 günde) tartıldığını ve sonucu bildiriyorsa.',
  not_when_tr: '"3 haftadır 82,5’ta takıldım, neden?" gibi bir soru ya da eski bir hatıra tartı kaydı değildir.',
  fields: {
    day: f.day(),
    kg: f.num({ unit: 'kg', hard: [20, 300], decimals: 2 }),
    as_stated: f.text({ max: 60, tr: 'kullanıcının ifadesi aynen ("82,5")' }),
    replaces: f.ref(['d'], { nullable: true, targets: ['weight'] }),
  },
  derive: (a, ctx) => ({ date: resolveDay(a.day, ctx.today) }),
  writes: { rpc: 'w_metric_apply', tables: ['daily_metrics', 'weight_history', 'profiles', 'belief_events', 'turn_writes'], undo: 'restore_previous' },
  invariants: ['tdee_recalc_if_today', 'weight_reminder_close'],
  examples_tr: ['"bu sabah 82,5 çıktım" → kg 82.5, day today'],
}).rules({
  ask: [
    rule('kilo_sicramasi', 'son 14 günün tartısından max(3 kg, %4) fazla fark', (a, _d, ctx) =>
      !!ctx.last_weight && weightJumpTooBig(ctx.last_weight.kg, a.kg) &&
      `son tartı ${trNum(ctx.last_weight.kg, 1)} kg, şimdi ${trNum(a.kg, 1)} kg`,
      { question_tr: 'Kısa sürede büyük bir değişim görünüyor; tartı sonucunu doğru mu yazdım?' }),
    rule('kayitli_kilodan_farkli', 'kayıtlı kilodan max(7 kg, %8) fazla fark (son 14 günde tartı yoksa)', (a, _d, ctx) =>
      !ctx.last_weight && typeof ctx.profile?.weight_kg === 'number' && weightMaterial(ctx.profile.weight_kg, a.kg) &&
      `kayıtlı ${trNum(ctx.profile.weight_kg, 1)} kg, şimdi ${trNum(a.kg, 1)} kg`,
      { question_tr: 'Kayıtlarımda farklı bir kilo var; bu yeni tartın mı?' }),
  ],
});

export const sleep_log = op({
  type: 'sleep_log',
  channel: 'writes',
  envelope: 'sleep_log',
  title_tr: 'Uyku',
  when_tr: 'Kullanıcı uyuduğu süreyi bildiriyorsa. day = UYANDIĞI gün ("dün gece 7 saat uyudum" → today).',
  not_when_tr: '"7-8 saat uyumam lazım mı?" gibi soru ya da hedef kayıt değildir.',
  fields: {
    day: f.day({ tr: 'uyanılan gün' }),
    hours: f.num({ unit: 'saat', hard: [0.5, 24], plausible: [2, 14], decimals: 1, tr: 'aralık söylenirse ortası ("6-7" → 6.5)' }),
    quality: f.enum(SLEEP_QUALITY, { nullable: true }),
    bed_time: f.text({ nullable: true, format: 'hhmm', tr: 'yattığı saat' }),
    wake_time: f.text({ nullable: true, format: 'hhmm', tr: 'kalktığı saat' }),
    as_stated: f.text({ max: 60 }),
    replaces: f.ref(['d'], { nullable: true, targets: ['sleep'] }),
  },
  derive: (a, ctx) => ({ date: resolveDay(a.day, ctx.today) }),
  writes: { rpc: 'w_metric_apply', tables: ['daily_metrics', 'turn_writes'], undo: 'restore_previous' },
  examples_tr: ['"dün gece 6-7 saat uyudum, kötüydü" → hours 6.5, quality bad, day today'],
});

const MOOD_SCALES = { five: '1–5 ölçeği', ten: '1–10 ölçeği' } as const;

export const mood_log = op({
  type: 'mood_log',
  channel: 'writes',
  envelope: 'mood_log',
  title_tr: 'Ruh hali',
  when_tr: 'Kullanıcı ruh halini puanlıyor ya da açıkça tarif ediyorsa.',
  fields: {
    day: f.day(),
    value: f.num({ hard: [1, 10], tr: 'kullanıcının puanı, söylediği ölçekte' }),
    scale: f.enum(MOOD_SCALES),
    note: f.text({ nullable: true, max: 280 }),
    as_stated: f.text({ max: 60 }),
    replaces: f.ref(['d'], { nullable: true, targets: ['mood'] }),
  },
  derive: (a, ctx) => ({
    date: resolveDay(a.day, ctx.today),
    score: a.scale === 'ten' ? Math.max(1, Math.round(a.value / 2)) : Math.round(a.value),
  }),
  derive_tr: 'puan 1–5’e çevrilir: 1–10 ölçeğinde değer/2 yuvarlanır (8/10 → 4); kırpma yok.',
  writes: { rpc: 'w_metric_apply', tables: ['daily_metrics', 'turn_writes'], undo: 'restore_previous' },
  examples_tr: ['"bugün 8/10 hissediyorum" → value 8, scale ten (kod 4/5 saklar)'],
}).rules({
  hard: [
    rule('olcek_disi', '1–5 ölçeğinde değer 5’i aşamaz', (a) => a.scale === 'five' && a.value > 5, {
      repairable: true, failure_class: 'out_of_range', path: 'value',
    }),
  ],
});

export const step_log = op({
  type: 'step_log',
  channel: 'writes',
  envelope: 'step_log',
  title_tr: 'Adım',
  when_tr: 'Kullanıcı attığı adım sayısını bildiriyorsa. Süre verilmedikçe antrenman değildir.',
  not_when_tr: '"günde 10 bin adım hedefim var" hedeftir (profile_set step_target), kayıt değildir.',
  fields: {
    day: f.day(),
    steps: f.num({ hard: [0, 100000], plausible: [100, 60000], decimals: 0 }),
    as_stated: f.text({ max: 60 }),
    replaces: f.ref(['d'], { nullable: true, targets: ['steps'] }),
  },
  derive: (a, ctx) => ({ date: resolveDay(a.day, ctx.today) }),
  writes: { rpc: 'w_metric_apply', tables: ['daily_metrics', 'turn_writes'], undo: 'restore_previous' },
  examples_tr: ['"bugün 12 bin adım attım" → steps 12000'],
});
