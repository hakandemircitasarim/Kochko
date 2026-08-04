/**
 * Phase Timeline Component
 * Spec 6.7: Çok fazlı hedef planlaması görsel zaman çizelgesi
 *
 * Mevcut faz konumunu, geçiş bölgelerini ve gelecek fazları gösterir.
 */
import { View, Text } from 'react-native';
import { SPACING, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { goalShortLabelTR } from '@/lib/labels';

interface Phase {
  id: string;
  label: string;
  goalType: string;
  targetWeeks: number;
  isActive: boolean;
  isCompleted: boolean;
}

interface PhaseTimelineProps {
  phases: Phase[];
  currentWeek: number; // overall week count
}

// FIX (audit phase-palette): tema-dışı Material tonlarını mevcut marka token'larına eşle.
// FIX (theme): modül seviyesinde renk DEĞERİ tutmak koyu paleti her temaya donduruyordu —
// tabloda artık token ADI var, renk render sırasında aktif temadan çözülüyor.
const GOAL_COLOR_TOKENS: Record<string, keyof ThemeColors> = {
  lose_weight: 'primary',
  gain_weight: 'success',
  gain_muscle: 'purple',
  maintain: 'warning',
  health: 'protein',
  conditioning: 'coral',
};

export function PhaseTimeline({ phases, currentWeek }: PhaseTimelineProps) {
  const { colors } = useTheme();
  if (phases.length === 0) return null;

  const totalWeeks = phases.reduce((s, p) => s + p.targetWeeks, 0);

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
    }}>
      <Text style={{ ...TYPE.headline, color: colors.text, marginBottom: SPACING.sm }}>
        Hedef fazları
      </Text>

      {/* Timeline bar — FIX (ux-polish): decorative; hidden from screen readers so phase names aren't
          read twice (bar + labels) and color-only active/completed state isn't announced here. The
          labels below carry the accessible names + spoken state. */}
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
        flexDirection: 'row',
        height: 32,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: colors.surfaceLight,
      }}>
        {phases.map((phase, i) => {
          const widthPct = (phase.targetWeeks / totalWeeks) * 100;
          const color = colors[GOAL_COLOR_TOKENS[phase.goalType] ?? 'textMuted'];

          return (
            <View key={phase.id} style={{
              width: `${widthPct}%`,
              backgroundColor: phase.isCompleted
                ? color + '40'
                : phase.isActive
                  ? color
                  : color + '20',
              justifyContent: 'center',
              alignItems: 'center',
              borderRightWidth: i < phases.length - 1 ? 1 : 0,
              borderRightColor: colors.background,
            }}>
              <Text
                // FIX (ux-pass5): TR etiketler eski 'Cut'/'Bulk'tan uzun — dar fazda 32px
                // barın dışına sarmasın.
                numberOfLines={1}
                style={{
                // FIX (audit accent-contrast): aktif faz metnini sabit beyaz yerine faz
                // rengine göre kontrast-güvenli seç (WCAG AA).
                color: phase.isActive ? (getContrastColor(color) === 'black' ? colors.background : '#fff') : colors.textSecondary,
                ...TYPE.footnote,
                fontWeight: phase.isActive ? '700' : '500',
              }}>
                {goalShortLabelTR(phase.goalType)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Phase labels below */}
      <View style={{ flexDirection: 'row', marginTop: SPACING.xs }}>
        {phases.map((phase) => {
          const widthPct = (phase.targetWeeks / totalWeeks) * 100;
          return (
            // FIX (audit UI-PLN-01): dar fazlarda serbest-metin etiketin komşu hücrelere
            // taşmaması için hücreyi clip'le.
            <View key={phase.id} style={{ width: `${widthPct}%`, alignItems: 'center', overflow: 'hidden' }}>
              <Text
                // FIX (audit UI-PLN-01): tek satır + ellipsis ve büyük sistem fontunda taşma artmasın.
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                // FIX (ux-polish): speak the phase's state (active/completed) — the bar conveyed it by
                // color only, which a screen reader couldn't announce.
                accessibilityLabel={`${phase.label ? goalShortLabelTR(phase.label) : `${phase.targetWeeks} hafta`}${phase.isActive ? ', şu anki faz' : phase.isCompleted ? ', tamamlandı' : ''}`}
                style={{
                  ...TYPE.footnote,
                  color: phase.isActive ? colors.text : colors.textMuted,
                  fontWeight: phase.isActive ? '600' : '400',
                }}
              >
                {/* FIX (ux-pass5): phase_label'sız hedeflerde servis çiğ goal_type düşürür
                    ('lose_weight' ekranda görünüyordu) — bilinen enum'ları insanileştir. */}
                {phase.label ? goalShortLabelTR(phase.label) : `${phase.targetWeeks} hafta`}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Current position indicator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginRight: SPACING.xs }} />
        <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>
          {/* FIX (audit phase-overflow): currentWeek totalWeeks'i aşarsa 'Hafta 20 / 16' yerine
              clamp + aşım ek metni göster. */}
          Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}{currentWeek > totalWeeks ? ` (+${currentWeek - totalWeeks} hafta)` : ''}
        </Text>
      </View>
    </View>
  );
}
