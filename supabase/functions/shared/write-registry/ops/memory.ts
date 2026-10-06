/**
 * memory — typed replacement of the <layer2_update> prose tag (map-writes #42, §8.2.6).
 *
 * Written by the coach stage (Stage B `memory[]`, or the fused envelope), never by Stage A. One
 * bad key no longer fails the whole ai_summary merge: every entry is its own write. The person
 * note ("bu kişiyle nasıl konuşmalıyım") replaces the seven tone controllers; coach notes append
 * to the bounded dated log through appendCoachingNote (the only writer of that column).
 */
import { f, op, rule } from '../dsl.ts';

export const memory_note = op({
  type: 'memory_note',
  channel: 'memory',
  envelope: 'memory',
  title_tr: 'Hafıza notu',
  when_tr: 'Bu kişiyle ilgili ileride işe yarayacak kalıcı bir gözlem öğrendiysen.',
  not_when_tr: 'Kayıtlara giden bilgiler (öğün, kilo, alerji…) hafıza notu değildir; onlar kendi yazmalarıyla gider.',
  fields: {
    kind: f.enum({
      person_note: 'bu kişiyle nasıl konuşmalı (tek not; yenisi eskisinin yerine geçer)',
      coach_note: 'tarihli gözlem (eklenir)',
      pattern: 'tekrarlayan davranış kalıbı ve tetikleyicisi',
      portion_calibration: 'kişisel porsiyon ("benim tabağım" ≈ 300 g)',
      forget: 'kullanıcının unutmamı istediği bir not',
    }, { explain: true }),
    text: f.text({ max: 400 }),
    food: f.text({ nullable: true, max: 60, tr: 'yalnız portion_calibration' }),
    grams: f.num({ unit: 'g', nullable: true, hard: [1, 3000], decimals: 0, tr: 'yalnız portion_calibration' }),
    confidence: f.num({ hard: [0, 1] }),
  },
  capability_tr: 'Bu kişiyle ilgili kalıcı gözlemleri hafızana yazmak (memory[]).',
  writes: { fn: 'writeMemoryEntry', tables: ['ai_summary'], undo: 'none' },
  invariants: ['per_key_validation', 'bounded_append'],
}).rules({
  hard: [
    rule('porsiyon_eksik', 'portion_calibration için food ve grams gerekli', (a) =>
      a.kind === 'portion_calibration' && (a.food === null || a.grams === null), { repairable: true, failure_class: 'missing_field' }),
  ],
  flag: [rule('dusuk_guven_not', 'güveni 0,5 altında hafıza notu', (a) => a.confidence < 0.5)],
});
