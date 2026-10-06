/**
 * pending_ops — answers to a held write (ASK) and the commitment loop (AI_MIMARI_V2 §5.2, §6).
 *
 * A hold (`p#`) is confirmed only in a LATER turn, by the model reading a clear yes: the
 * question must have been shown (replies_since ≥ 1) and the hold must not have expired. A KVKK
 * erase is stricter (erase-hold.ts): only the turn right after the question (replies_since = 1).
 * Code never reads "evet" itself — it checks the model's op, the ref and the timing.
 */
import { f, op, rule } from '../dsl.ts';
import { COMMITMENT_OUTCOMES } from '../vocab.ts';
import { shiftDay } from '../util.ts';

/** pending_writes.op of the KVKK erase hold (shared/erase-hold.ts ERASE_OP; pinned by a test). */
export const ERASE_HOLD_OP = 'account_erase_request';

export const pending_confirm = op({
  type: 'pending_confirm',
  op: 'confirm',
  channel: 'pending_ops',
  envelope: 'pending_confirm',
  title_tr: 'Bekleyeni onayla',
  when_tr: 'BEKLEYEN ONAYLAR’da p-ref’i olan bir yazmayı kullanıcı bu mesajda AÇIKÇA onaylıyorsa.',
  not_when_tr: 'Tereddüt, soru, "hayır" ya da başka konu onay değildir. Değiştirerek onaylıyorsa discard + writes’ta yeni hâli.',
  fields: { ref: f.ref(['p']) },
  writes: { fn: 'commitHeldWrite', tables: ['pending_writes', 'turn_writes'], undo: 'none' },
  invariants: ['runs_the_held_write_through_its_own_op'],
}).rules({
  hard: [
    rule('bekletme_suresi_doldu', 'süresi dolmuş bekletme onaylanamaz', (a, _d, ctx) => {
      const p = ctx.refs[a.ref]?.pending;
      return !!p && Date.parse(p.expires_at) <= Date.parse(ctx.now_iso);
    }, { failure_class: 'expired' }),
    rule('soru_gorulmedi', 'soru henüz sorulmadı; aynı turda onay olmaz', (a, _d, ctx) =>
      (ctx.refs[a.ref]?.pending?.replies_since ?? 0) < 1, { failure_class: 'same_turn' }),
    rule('sonraki_tur_degil', 'hesap/hafıza silme onayı yalnızca sorudan hemen sonraki turda geçerli', (a, _d, ctx) => {
      const p = ctx.refs[a.ref]?.pending;
      return !!p && p.op === ERASE_HOLD_OP && p.replies_since > 1;
    }, { failure_class: 'not_next_turn' }),
  ],
});

export const pending_discard = op({
  type: 'pending_discard',
  op: 'discard',
  channel: 'pending_ops',
  envelope: 'pending_discard',
  title_tr: 'Bekleyenden vazgeç',
  when_tr: 'Kullanıcı bekleyen bir yazmayı istemediğini söylüyorsa ("hayır, kalsın").',
  fields: { ref: f.ref(['p']) },
  writes: { fn: 'discardHeldWrite', tables: ['pending_writes'], undo: 'none' },
});

export const commitment_add = op({
  type: 'commitment_add',
  op: 'add',
  channel: 'commitment_ops',
  envelope: 'commitment',
  title_tr: 'Söz/taahhüt',
  when_tr: 'Kullanıcı somut, takip edilebilir bir söz veriyorsa ("yarından itibaren akşam 8’den sonra yemeyeceğim").',
  not_when_tr: 'Genel istekler ("daha sağlıklı olmak istiyorum") söz değildir.',
  fields: {
    text: f.text({ max: 200, tr: 'sözün kısa, net hâli' }),
    follow_up_days: f.num({ unit: 'gün', hard: [0, 30], decimals: 0, tr: 'kaç gün sonra sorulsun' }),
  },
  derive: (a, ctx) => ({ follow_up_date: shiftDay(ctx.today, Math.round(a.follow_up_days)) }),
  derive_tr: 'takip tarihi = bugün + follow_up_days (kullanıcının yerel günü).',
  writes: { rpc: 'w_commitment_apply', tables: ['user_commitments', 'turn_writes'], undo: 'soft_delete' },
});

export const commitment_resolve = op({
  type: 'commitment_resolve',
  op: 'resolve',
  channel: 'commitment_ops',
  envelope: 'commitment',
  title_tr: 'Söz sonucu',
  when_tr: 'Kullanıcı AÇIK SÖZLER’deki bir sözün sonucunu söylüyorsa ("dün akşam 8’den sonra yemedim").',
  not_when_tr: '"yaptım/olmadı" kelimesi başka bir konudaysa söz kapatılmaz.',
  fields: {
    ref: f.ref(['k']),
    outcome: f.enum(COMMITMENT_OUTCOMES),
    note: f.text({ nullable: true, max: 200 }),
  },
  writes: { rpc: 'w_commitment_apply', tables: ['user_commitments', 'turn_writes'], undo: 'restore_previous' },
});
