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
 *
 * Deleting (re-trial 2026-10-12, final2): "ama ben düzeltmeyi geri al dedim, bu sabah 82 kiloydum"
 * deleted YESTERDAY's confirmed 81,6 kg weigh-in — record_delete had no evidence and no hold, so any
 * rendered ref Stage A guessed was committed. Now: a one-step undo is the last turn's own write of
 * today (the "vazgeçtim, geri al" case). Anything else — an older turn's record, another day's, or a
 * record the user had confirmed through a hold — is held with ONE code question naming the record
 * ("Dünkü 81,6 kg tartını silmemi istiyor musun?"). evidence_quote (the user's words asking for it)
 * is checked verbatim when given; a quote that is not in the message is asked the same way.
 * A constraint (c#) is undone here only when it is the user's newest write (a just-added allergy:
 * one safety confirmation, its whole ledger group); any older constraint stays constraint_retract's,
 * with its own two-step bar.
 *
 * Undo vs delete of a CORRECTION (pre-retrial #3 review): migration 115 made a ref delete of a record
 * that was itself a correction always bring back the record it replaced — so "aslında hiç yemedim,
 * sil" after "pardon tek dilimdi" revived the 2-slice meal. The two sentences differ only in meaning,
 * so the MODEL says which one it read (restore_replaced: "geri al / düzeltmeyi geri al" → true,
 * "sil / hiç olmadı / yanlış kayıt" → false) and code checks it: derive() keeps it only when the ref
 * really is a correction (RenderedRef.correction) — anywhere else it is meaningless and ignored — and
 * the writer revives the replaced record only on that derived true (115 p_opts.restore_replaced).
 */
import { f, op, rule, MAX_BACK_DAYS, type ValidationContext } from '../dsl.ts';
import { PATCH_OPS_BY_TARGET, type RenderedRef, UNDO_REF_KINDS } from '../refs.ts';
import { daysBetween, isVerbatimQuote, shiftDay, trInt, trNum } from '../util.ts';

function tooOld(ref: string, ctx: ValidationContext): boolean {
  const day = ctx.refs[ref]?.day;
  return typeof day === 'string' && daysBetween(day, ctx.today) > MAX_BACK_DAYS;
}

const tooOldRule = <A extends { ref: string }, D = Record<string, never>>() =>
  rule<A, D>('cok_eski_kayit', `${MAX_BACK_DAYS} günden eski kayıt sohbetten değiştirilemez`, (a, _d, ctx) => tooOld(a.ref, ctx), {
    failure_class: 'too_old',
  });

const laterWriteRule = <A extends { ref: string }, D = Record<string, never>>() =>
  rule<A, D>('sonraki_yazma_var', 'aynı alana daha sonra yazılmış; geri almak sonrakini ezer', (a, _d, ctx) =>
    ctx.refs[a.ref]?.later_write_on_same_field === true, { failure_class: 'conflict' });

// ─── record_delete: the code-owned question that names the record ─────────────────────────────────

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "Bugünkü" / "Dünkü" / "5 Eki tarihli"; '' when the record carries no day. */
function dayAdjTr(day: string | null | undefined, today: string): string {
  if (typeof day !== 'string' || day.length < 10) return '';
  if (day === today) return 'Bugünkü';
  if (day === shiftDay(today, -1)) return 'Dünkü';
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_TR[(m ?? 1) - 1] ?? ''} tarihli`;
}

/** "81,6" / "82" / "0,25" — Turkish comma, no trailing zeros (decimals ≥ 1, so a comma is always there to strip after). */
function shortNum(n: number, decimals = 2): string {
  return trNum(n, Math.max(1, decimals)).replace(/,?0+$/u, '');
}

const capFirst = (s: string) => (s ? s[0].toLocaleUpperCase('tr') + s.slice(1) : s);
const capLen = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const TARGET_TR: Readonly<Record<string, string>> = {
  weight: 'tartı', water: 'su', sleep: 'uyku', mood: 'ruh hali', steps: 'adım', meal: 'öğün', workout: 'antrenman',
  supplement: 'takviye', lab: 'tahlil', life_event: 'olay', food_pref: 'tercih',
};

/** What the record holds, worded for the user ("81,6 kg", "gün toplamı 1,4 L", the meal's summary). */
function valueTr(r: RenderedRef): string | null {
  const v = r.snapshot?.value;
  if (typeof v === 'number') {
    switch (r.target) {
      case 'weight': return `${shortNum(v)} kg`;
      case 'water': return `gün toplamı şu an ${shortNum(v)} L`;
      case 'sleep': return `${shortNum(v, 1)} saat`;
      case 'mood': return `${Math.round(v)}/5`;
      case 'steps': return `${trInt(v)} adım`;
    }
  }
  const s = r.user_summary_tr ?? r.summary_tr;
  return s ? capLen(s, 80) : null;
}

/** Said after a correction's delete question when the record it replaced stays deleted. */
export const REPLACED_STAYS_TR = 'Düzeltmeden önceki kayıt da geri gelmez.';

/**
 * The ONE question a held record_delete asks, naming the record: "Dünkü 81,6 kg tartını silmemi istiyor
 * musun?" — a correction says whether the record it replaced comes back (`restoresReplaced`, the op's
 * derived restores_replaced). Registry text (code-owned), from the rendered ref only.
 */
export function undoQuestionTr(r: RenderedRef | undefined, today: string, restoresReplaced = true): string {
  if (!r) return 'Bu kaydı silmemi istiyor musun?';
  const adj = dayAdjTr(r.day, today);
  const lead = (rest: string) => (adj ? `${adj} ${rest}` : capFirst(rest));
  const label = TARGET_TR[r.target] ?? 'kayıt';
  const value = valueTr(r);
  if (r.kind === 'c') {
    const s = r.user_summary_tr ?? r.summary_tr ?? 'kısıt';
    return `Az önce eklenen ${s} kaydını geri almamı istiyor musun? Güvenlik filtrelerin buna göre değişecek.`;
  }
  if (r.correction && restoresReplaced) {
    return `${lead(`${label} düzeltmesini${value ? ` (${value})` : ''}`)} geri almamı istiyor musun? Düzeltmeden önceki kayıt geri gelir.`;
  }
  const tail = r.correction ? ` ${REPLACED_STAYS_TR}` : '';
  // A water ref is the day's value; the undo takes back its latest write, not the whole day.
  if (r.target === 'water') return `${lead('son su kaydını')} geri almamı istiyor musun?${value ? ` (${value})` : ''}${tail}`;
  if (r.target === 'weight' && typeof r.snapshot?.value === 'number') return `${lead(`${shortNum(r.snapshot.value)} kg tartını`)} silmemi istiyor musun?${tail}`;
  return `${lead(`${label} kaydını${value ? ` (${value})` : ''}`)} silmemi istiyor musun?${tail}`;
}

/**
 * What the writer is told to do with a correction's replaced record. Only a CORRECTION ref can bring
 * one back (RenderedRef.correction); anywhere else the model's restore_replaced means nothing and is
 * ignored. record_restore_metric ("önceki değerine döndür") always means the value before the write —
 * for a correction that is the replaced record's value.
 */
export function restoresReplaced(ref: string, wanted: boolean, ctx: ValidationContext): boolean {
  return wanted && ctx.refs[ref]?.correction === true;
}

/** The one-step undo: the previous turn's own write, of today, that the user had not confirmed through a hold. */
function isLocalUndo(r: RenderedRef | undefined, today: string): boolean {
  return r?.last_turn === true && r.day === today && r.confirmed_hold !== true;
}

/**
 * re-trial 2026-10-12: a message about "bu sabah" deleted yesterday's confirmed weigh-in in one step.
 * Every op that takes a record back by ref (delete, restore_metric) asks first unless it is the local undo.
 */
interface UndoDerived {
  /** The writer brings the correction's replaced record back (restoresReplaced). */
  restores_replaced: boolean;
}

const remoteUndoRule = <A extends { ref: string }>() =>
  rule<A, UndoDerived>('uzak_kayit_silme', 'son turun bugünkü kendi yazması değilse (eski tur, başka gün ya da onayla yazılmış kayıt) silmeden önce sorulur', (a, _d, ctx) => {
    const r = ctx.refs[a.ref];
    if (!r || r.kind === 'c' || isLocalUndo(r, ctx.today)) return false;
    const why = r.confirmed_hold === true ? 'kullanıcının onayıyla yazılmış kayıt' : r.day !== ctx.today ? 'başka güne ait kayıt' : 'son turun yazması değil';
    return `${a.ref}: ${why}`;
  }, { question_tr: (a, d, ctx) => undoQuestionTr(ctx.refs[a.ref], ctx.today, d.restores_replaced) });

export const record_delete = op({
  type: 'record_delete',
  op: 'delete',
  channel: 'record_ops',
  envelope: 'undo',
  title_tr: 'Kaydı geri al/sil',
  when_tr: 'KAYITLAR’daki bir kaydı geri alma/silme isteği ("vazgeçtim, onu geri al" → son turdaki yazmanın ref’i).',
  not_when_tr: 'eski kısıt (constraint_retract; son turda eklenen kısıt burada), bekleyen (pending_ops), plan taslağı (plan_action).',
  fields: {
    ref: f.ref(UNDO_REF_KINDS),
    reason: f.text({ max: 120 }),
    evidence_quote: f.text({ nullable: true, max: 160 }),
    restore_replaced: f.bool({ tr: '"geri al / düzeltmeyi geri al" true; "sil / hiç olmadı / yanlış kayıt" false' }),
  },
  derive: (a, ctx): UndoDerived => ({ restores_replaced: restoresReplaced(a.ref, a.restore_replaced === true, ctx) }),
  capability_tr: 'Gösterilen belirli bir kaydı geri almak (yalnızca son 7 gün).',
  writes: { rpc: 'w_record_undo', tables: ['turn_writes'], undo: 'none', hold_op: 'record_delete' },
  invariants: ['soft_delete_only', 'group_side_effects_undone', 'remote_delete_asked', 'undo_restores_replaced_only_when_asked'],
}).rules({
  hard: [
    tooOldRule(),
    laterWriteRule(),
    // A constraint is a safety record: only the just-added one may be undone as its ledger group here;
    // every older one is removed with constraint_retract (evidence + its own two-step hold).
    rule('kisit_yalniz_son_ekleme', 'kısıt yalnız en son eklenmişse geri alınır; eski kısıt constraint_retract ile kaldırılır', (a, _d, ctx) => {
      const r = ctx.refs[a.ref];
      return r?.kind === 'c' && r.undo_add !== true && `${a.ref} en son eklenen kısıt değil; kısıt kaldırma constraint_retract ile yapılır`;
    }, { repairable: true, failure_class: 'not_deletable' }),
  ],
  ask: [
    remoteUndoRule(),
    // A sanctioned verbatim check (AI_MIMARI_V2 §5): a quote the model attributes to the user must be in
    // the message. null = no quote claimed — the one-step local undo still stands on its own.
    rule('silme_alintisi', 'evidence_quote verildiyse kullanıcının mesajında aynen geçmeli', (a, _d, ctx) =>
      isLocalUndo(ctx.refs[a.ref], ctx.today) && a.evidence_quote !== null && !isVerbatimQuote(a.evidence_quote, ctx.user_message),
    { question_tr: (a, d, ctx) => undoQuestionTr(ctx.refs[a.ref], ctx.today, d.restores_replaced), evidence: true }),
    // Undoing a just-added allergy/injury changes the safety filters: always one safety confirmation.
    rule('son_eklenen_kisit', 'en son eklenen kısıtın geri alınması her zaman bir güvenlik onayıyla yapılır', (a, _d, ctx) =>
      ctx.refs[a.ref]?.kind === 'c' && `${a.ref}: az önce eklenen kısıtın geri alınması`,
    { question_tr: (a, d, ctx) => undoQuestionTr(ctx.refs[a.ref], ctx.today, d.restores_replaced) }),
  ],
});

export const record_update = op({
  type: 'record_update',
  op: 'update',
  channel: 'record_ops',
  // The client badge follows the corrected record type; validate.ts takes it from the patch.
  envelope: 'undo',
  title_tr: 'Kaydı düzelt',
  when_tr: 'KAYITLAR’daki bir kaydın içeriği yanlışsa: kullanıcı düzeltiyorsa basis=user_correction; sen fark ettiysen (küçük bir öğüne binlerce kcal) basis=suspicious — kod önce kullanıcıya sordurur.',
  // SCHEMA v8 (budget for record_delete.restore_replaced): no not_when line — "a correction is not added
  // again as a new write (double count)" is already taught three times in the same cached prefix: the doc
  // header ("Kayıt düzeltmenin tek yolu record_ops update…"), understand rule 6 and the ref_ile_duzeltme few-shot.
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
  capability_tr: 'Yanlış bir kaydı düzeltmek; fark ettiğin şüpheli bir geçmiş kaydı (ör. küçük bir öğüne binlerce kcal) önce kullanıcıya sorarak.',
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
  when_tr: 'Bir günlük metriği bir yazmadan önceki değerine döndürme isteği.',
  fields: {
    ref: f.ref(['d']),
    reason: f.text({ max: 120 }),
  },
  // "Önceki değer" of a correction write is the value it replaced: the writer brings that one back.
  derive: (a, ctx): UndoDerived => ({ restores_replaced: restoresReplaced(a.ref, true, ctx) }),
  tier: 'rare',
  capability_tr: 'Bir günlük metriği belirli bir yazmadan önceki değerine döndürmek.',
  writes: { rpc: 'w_record_undo', tables: ['daily_metrics', 'turn_writes'], undo: 'none', hold_op: 'record_restore_metric' },
}).rules({
  hard: [tooOldRule(), laterWriteRule()],
  // The same bar as record_delete: it takes a write back through the same writer.
  ask: [remoteUndoRule()],
});
