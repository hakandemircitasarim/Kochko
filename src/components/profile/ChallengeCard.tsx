/**
 * ChallengeCard — challenge kartı (Duolingo "görev" kartı dili, §0-A).
 *
 * Eskiden düz Card + elle yazılmış 6px iz/dolgu + "3 / 14 gün tamamlandı" satırıydı: ilerleme
 * bir ölçüm gibi okunuyordu. Şimdi:
 *   - Solda madalyon: aktifken kehribar kupa (gövdeli), duraklatılmışken gri; tamamlanınca
 *     canlı kupa, bırakılınca gri silüet (rozet vitriniyle aynı BadgeMedal).
 *   - ProgressBar (kalın, parlak şerit) + kısa teşvik cümlesi; sayı ikinci planda.
 *   - Eylemler (çağırandan) gövdeli Button olarak altta.
 *
 * Yalnız sunum: ilerleme sayısı çağırandaki aynı formülle (met günleri / süre) hesaplanır.
 */
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import type { Challenge } from '@/services/challenges.service';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { BadgeMedal } from '@/components/profile/BadgeMedal';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

/** Kısa teşvik: "az sayı, çok teşvik" (kural 6). Uydurma veri yok — yalnız met/süre. */
function cheer(done: number, total: number, status: Challenge['status']): string {
  if (status === 'completed') return 'Tamamladın, tebrikler!';
  if (status === 'abandoned') return 'Bıraktın — istediğinde yeniden başlayabilirsin.';
  if (status === 'paused') return 'Mola verdin. Hazır olunca devam et.';
  const left = Math.max(0, total - done);
  if (done === 0) return 'İlk günü işaretle, seri başlasın!';
  if (left === 0) return 'Son çizgidesin!';
  if (done / total >= 0.5) return `Yarıyı geçtin — ${left} gün kaldı!`;
  return `Güzel gidiyor — ${left} gün kaldı.`;
}

interface Props {
  challenge: Challenge;
  /** Kartın altındaki gövdeli eylem butonları (Bugünü işaretle / Duraklat / Bırak). */
  actions?: ReactNode;
}

export function ChallengeCard({ challenge: c, actions }: Props) {
  const { colors, isDark } = useTheme();
  const edge = isDark ? colors.border : colors.progressTrack;
  const total = c.target?.duration_days || 1;
  const done = c.progress.filter(p => p.met).length;
  const lively = c.status === 'active' || c.status === 'completed';
  const statusLabel = c.status === 'paused' ? 'Duraklatıldı'
    : c.status === 'completed' ? 'Tamamlandı'
    : c.status === 'abandoned' ? 'Bırakıldı'
    : 'Aktif';

  return (
    <View
      style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: edge, padding: SPACING.lg, marginBottom: SPACING.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <BadgeMedal icon="trophy" family="streak" earned={lively} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.headline, color: colors.text, fontWeight: '700' }}>{c.title}</Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }}>
            {total} gün · {statusLabel}
          </Text>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${total} günün ${done} günü tamamlandı`}
        accessibilityValue={{ min: 0, max: total, now: done }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md }}
      >
        <ProgressBar
          progress={done / total}
          color={lively ? METRIC_COLORS.streak : colors.textMuted}
          height={12}
          style={{ flex: 1 }}
        />
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' }}>{done}/{total}</Text>
      </View>
      <Text style={{ ...TYPE.callout, color: colors.textSecondary, marginTop: SPACING.sm }}>{cheer(done, total, c.status)}</Text>
      {actions ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md }}>{actions}</View> : null}
    </View>
  );
}
