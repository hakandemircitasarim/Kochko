/**
 * record_ops — delete / correct / restore a record BY REF (AI_MIMARI_V2 §4.4 (3), §6).
 *
 * v1 guessed the target by recency and time window: "geri al" after a water log deleted the
 * dinner from 45 minutes earlier; "bunu nasıl düzeltebilirim?" deleted the last meal. Now the
 * model points at a short ref it was shown (`m12`, `d3`), and code checks that the ref was
 * rendered this turn, is not already undone, is within 7 days and has no later write on the
 * same field. A question can delete nothing: no record_op, no write.
 *
 * Suspicious past records (owner decision 2026-10-06): old wrong rows (the 1708 kcal nugget) are
 * not bulk-fixed. When the coach NOTICES one in KAYITLAR it proposes `update{basis:'suspicious'}`
 * with a reason — that is ASK by default ("bu kayıt yanlış görünüyor, düzelteyim mi?") and is
 * committed only after the user agrees (pending confirm). A user-stated correction commits
 * directly, but only when its evidence quote is really in the user's message.
 */
import { f, op, rule, MAX_BACK_DAYS, type ValidationContext } from '../dsl.ts';
import { DELETABLE_KINDS, PATCH_OPS_BY_TARGET } from '../refs.ts';
import { daysBetween, isVerbatimQuote } from '../util.ts';

function tooOld(ref: string, ctx: ValidationContext): boolean {
  const day = ctx.refs[ref]?.day;
  return typeof day === 'string' && daysBetween(day, ctx.today) > MAX_BACK_DAYS;
}

const tooOldRule = <A extends { ref: string }>() =>
  rule<A, Record<string, never>>('cok_eski_kayit', `${MAX_BACK_DAYS} günden eski kayıt sohbetten değiştirilemez`, (a, _d, ctx) => tooOld(a.ref, ctx), {
    failure_class: 'too_old',
  });

const laterWriteRule = <A extends { ref: string }>() =>
  rule<A, Record<string, never>>('sonraki_yazma_var', 'aynı alana daha sonra yazılmış; geri almak sonrakini ezer', (a, _d, ctx) =>
    ctx.refs[a.ref]?.later_write_on_same_field === true, { failure_class: 'conflict' });

export const record_delete = op({
  type: 'record_delete',
  op: 'delete',
  channel: 'record_ops',
  envelope: 'undo',
  title_tr: 'Kaydı geri al/sil',
  when_tr: 'Kullanıcı KAYITLAR’daki belirli bir kaydın geri alınmasını/silinmesini istiyorsa ("yok o yanlış, geri al" → az önceki su kaydının d-ref’i).',
  not_when_tr: '"Nasıl düzeltebilirim?" sorudur, hiçbir şey silinmez. Hangi kayıt olduğundan emin değilsen YAZMA, clarify{candidate_refs} ile sor. Kısıtlar constraint_retract, bekleyenler pending_ops, plan taslağı plan_action ile kapanır.',
  fields: {
    ref: f.ref(DELETABLE_KINDS),
    reason: f.text({ max: 120, tr: 'neden geri alındığı, kısaca' }),
  },
  capability_tr: 'Gösterilen belirli bir kaydı geri almak (yalnızca son 7 gün).',
  writes: { rpc: 'w_record_undo', tables: ['turn_writes'], undo: 'none' },
  invariants: ['soft_delete_only', 'group_side_effects_undone'],
  examples_tr: ['su kaydından sonra "yok o yanlış, geri al" → ref d3 (yalnız o su yazması)'],
}).rules({
  hard: [tooOldRule(), laterWriteRule()],
});

export const record_update = op({
  type: 'record_update',
  op: 'update',
  channel: 'record_ops',
  // The client badge follows the corrected record type; validate.ts takes it from the patch.
  envelope: 'undo',
  title_tr: 'Kaydı düzelt',
  when_tr: 'KAYITLAR’daki bir kaydın sayıları/içeriği yanlışsa: kullanıcı düzeltiyorsa basis=user_correction; sen fark ettiysen (ör. 6 nugget için 1708 kcal) basis=suspicious — o zaman kod sorar, onaysız değiştirmez.',
  not_when_tr: 'Yeni bir öğün ekleme değildir (çift sayım olur). Emin değilsen clarify.',
  fields: {
    ref: f.ref(['m', 'd', 'w', 's', 't', 'e', 'l', 'f']),
    basis: f.enum({
      user_correction: 'kullanıcı bu mesajda düzeltmeyi verdi',
      suspicious: 'kayıt yanlış görünüyor; kullanıcıya sorulacak',
    }),
    reason: f.text({ max: 160, tr: 'neyin yanlış olduğu ("6 nugget için 1708 kcal çok yüksek")' }),
    evidence_quote: f.text({ nullable: true, max: 160, tr: 'user_correction ise kullanıcının mesajından AYNEN alıntı; suspicious ise null' }),
    patch: f.write({ tr: 'kaydın düzeltilmiş TAM hâli, aynı kayıt türünün şekliyle' }),
  },
  hold_tr: 'basis=suspicious her zaman bekletilir (p-ref) ve koç bir kez sorar; kullanıcı onaylarsa pending_ops confirm.',
  capability_tr: 'Yanlış bir kaydı düzeltmek; fark ettiğin şüpheli bir geçmiş kaydı (ör. 6 nugget için 1708 kcal) önce kullanıcıya sorarak.',
  writes: { rpc: 'w_record_supersede', tables: ['turn_writes'], undo: 'restore_previous', hold_op: 'record_update' },
  invariants: ['supersede_in_one_transaction', 'no_double_count'],
  examples_tr: [
    '"perşembe akşamki nugget 1700 olmuş, 6 küçük nuggetti 100 gram falan" → ref m12, basis user_correction, patch meal_log (düzeltilmiş kalemler)',
    'KAYITLAR’da "6 tavuk nugget → 900 g 1708 kcal" görürsen → ref m12, basis suspicious, reason, patch (makul hâli)',
  ],
}).rules({
  hard: [
    tooOldRule(),
    rule('yama_turu', 'patch, ref’in kayıt türüyle aynı op olmalı (m → meal_log, d su → water_log…)', (a, _d, ctx) => {
      const r = ctx.refs[a.ref];
      if (!r) return false;
      const allowed = r.op ? [r.op] : PATCH_OPS_BY_TARGET[r.target] ?? [];
      return !allowed.includes(String(a.patch.op)) && `${a.ref} için ${allowed.join('/') || 'düzeltme yok'} beklenir, ${String(a.patch.op)} geldi`;
    }, { repairable: true, failure_class: 'invalid_value', path: 'patch.op' }),
    rule('yama_replaces', 'patch.replaces boş ya da aynı ref olmalı', (a) =>
      a.patch.replaces !== undefined && a.patch.replaces !== null && a.patch.replaces !== a.ref,
      { repairable: true, failure_class: 'invalid_ref', path: 'patch.replaces' }),
  ],
  ask: [
    rule('supheli_kayit', 'fark ettiğin şüpheli kayıt kullanıcı onaylamadan değiştirilmez', (a) =>
      a.basis === 'suspicious' && `şüpheli kayıt (${a.ref}): ${a.reason}`,
      { question_tr: 'Bu kayıt yanlış görünüyor, düzelteyim mi?' }),
    rule('duzeltme_teyidi', 'kullanıcı düzeltmesinin alıntısı mesajda aynen yok', (a, _d, ctx) =>
      a.basis === 'user_correction' && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
      { question_tr: 'Bu kaydı böyle düzeltmemi istiyor musun?' }),
  ],
});

export const record_restore_metric = op({
  type: 'record_restore_metric',
  op: 'restore_metric',
  channel: 'record_ops',
  envelope: 'undo',
  title_tr: 'Metriği önceki değerine döndür',
  when_tr: 'Kullanıcı bir günlük metriğin (su, uyku, adım, tartı, ruh hali) belirli bir yazmadan önceki değerine dönmesini istiyorsa.',
  fields: {
    ref: f.ref(['d']),
    reason: f.text({ max: 120 }),
  },
  capability_tr: 'Bir günlük metriği belirli bir yazmadan önceki değerine döndürmek.',
  writes: { rpc: 'w_record_undo', tables: ['daily_metrics', 'turn_writes'], undo: 'none' },
}).rules({
  hard: [tooOldRule(), laterWriteRule()],
});
