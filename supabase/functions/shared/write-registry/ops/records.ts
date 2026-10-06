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
  when_tr: 'KAYITLAR’daki belirli bir kaydı geri alma/silme isteği ("yok o yanlış, geri al" → az önceki su yazmasının d-ref’i).',
  not_when_tr: 'kısıt (constraint_retract), bekleyen (pending_ops), plan taslağı (plan_action).',
  fields: {
    ref: f.ref(DELETABLE_KINDS),
    reason: f.text({ max: 120 }),
  },
  capability_tr: 'Gösterilen belirli bir kaydı geri almak (yalnızca son 7 gün).',
  writes: { rpc: 'w_record_undo', tables: ['turn_writes'], undo: 'none' },
  invariants: ['soft_delete_only', 'group_side_effects_undone'],
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
  when_tr: 'KAYITLAR’daki bir kaydın içeriği yanlışsa: kullanıcı düzeltiyorsa basis=user_correction; sen fark ettiysen (6 nugget için 1708 kcal) basis=suspicious — kod önce kullanıcıya sordurur.',
  not_when_tr: 'aynı kaydı yeni yazma olarak eklemek (çift sayım).',
  fields: {
    ref: f.ref(['m', 'd', 'w', 's', 't', 'e', 'l', 'f']),
    basis: f.enum({
      user_correction: 'kullanıcı bu mesajda düzeltmeyi verdi',
      suspicious: 'kayıt yanlış görünüyor; kullanıcıya sorulacak',
    }),
    reason: f.text({ max: 160 }),
    evidence_quote: f.text({ nullable: true, max: 160, tr: 'suspicious ise null' }),
    patch: f.write({ tr: 'kaydın düzeltilmiş TAM hâli, ref’in kayıt türündeki op ile' }),
  },
  hold_tr: 'suspicious bekletilir, koç bir kez sorar; reddedilen şüphe yeniden önerilmez.',
  capability_tr: 'Yanlış bir kaydı düzeltmek; fark ettiğin şüpheli bir geçmiş kaydı (ör. 6 nugget için 1708 kcal) önce kullanıcıya sorarak.',
  writes: { rpc: 'w_record_supersede', tables: ['turn_writes'], undo: 'restore_previous', hold_op: 'record_update' },
  invariants: ['supersede_in_one_transaction', 'no_double_count'],
}).rules({
  hard: [
    tooOldRule(),
    // §4.4(3): noLaterWriteOnSameField holds for every record_op — superseding a record whose field
    // was written again later would overwrite the newer value.
    laterWriteRule(),
    rule('supheli_zaten_soruldu', 'bu kayıt için şüphe bir kez soruldu ve onaylanmadı; yeniden sorulmaz', (a, _d, ctx) =>
      a.basis === 'suspicious' && ctx.refs[a.ref]?.suspicion_declined === true,
      { failure_class: 'already_asked' }),
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
    // A sanctioned verbatim check (AI_MIMARI_V2 §5): a correction the model attributes to the user
    // must be in the user's words this turn; otherwise it is asked, never committed on its own.
    rule('duzeltme_teyidi', 'kullanıcı düzeltmesinin alıntısı mesajda aynen yok', (a, _d, ctx) =>
      a.basis === 'user_correction' && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
      { question_tr: 'Bu kaydı böyle düzeltmemi istiyor musun?', evidence: true }),
  ],
});

export const record_restore_metric = op({
  type: 'record_restore_metric',
  op: 'restore_metric',
  channel: 'record_ops',
  envelope: 'undo',
  title_tr: 'Metriği önceki değerine döndür',
  when_tr: 'Bir günlük metriği belirli bir yazmadan önceki değerine döndürme isteği.',
  fields: {
    ref: f.ref(['d']),
    reason: f.text({ max: 120 }),
  },
  tier: 'rare',
  capability_tr: 'Bir günlük metriği belirli bir yazmadan önceki değerine döndürmek.',
  writes: { rpc: 'w_record_undo', tables: ['daily_metrics', 'turn_writes'], undo: 'none' },
}).rules({
  hard: [tooOldRule(), laterWriteRule()],
});
