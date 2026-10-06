/**
 * data_erase_request — KVKK memory/account erase, hold-only (AI_MIMARI_V2 §5.2, Faz 0 #5).
 *
 * "kalori hesabını sil" once scheduled the ACCOUNT for deletion. The model reads the intent and
 * the scope; this op writes NOTHING but a pending_writes hold, and the coach asks one question.
 * Only pending_ops.confirm{p#} in the very next turn runs shared/erase-hold.ts (tombstone for
 * memory, the Settings path for the account — the ai_summary row is never deleted).
 */
import { f, op, rule } from '../dsl.ts';
import { evidenceIsVerbatim } from '../rules.ts';
import { ERASE_HOLD_OP } from './pending.ts';

export const data_erase_request = op({
  type: 'data_erase_request',
  channel: 'writes',
  envelope: 'data_erase_request',
  title_tr: 'Veri silme talebi (KVKK)',
  when_tr: 'AÇIKÇA hesabın ve tüm verilerin ya da yalnız koç hafızasının silinmesi isteği.',
  not_when_tr: '"kalori hesabını sil" (hesaplama), "nasıl silerim?" (soru), tek kayıt (record_ops); kapsam belirsizse clarify.',
  fields: {
    scope: f.enum({ memory: 'yalnızca koçun hafızası (notlar, çıkarımlar, özetler)', account: 'hesap ve tüm veriler' }),
    evidence_quote: f.text({ max: 160 }),
  },
  hold_tr: 'her zaman bekletilir; yalnız HEMEN SONRAKİ turdaki açık evetle (pending_ops confirm) yapılır.',
  capability_tr: 'Hafızanın ya da hesabın silinmesi talebini almak; silme yalnızca kullanıcı bir sonraki mesajında açıkça onaylarsa yapılır.',
  writes: { fn: 'createEraseHold', tables: ['pending_writes'], undo: 'none', hold_op: ERASE_HOLD_OP },
  invariants: ['memory_erase_is_tombstone', 'account_erase_via_settings_path'],
}).rules({
  hard: [evidenceIsVerbatim('alinti_dogrulanamadi', 'evidence_quote kullanıcının mesajında aynen geçmeli', { repairable: true, failure_class: 'evidence' })],
  ask: [
    rule('kvkk_onay', 'silme hiçbir zaman tek adımda yapılmaz: bekletilir, sonraki turda onay istenir', () => true,
      { question_tr: 'Bunu kalıcı olarak silmemi onaylıyor musun?' }),
  ],
});
