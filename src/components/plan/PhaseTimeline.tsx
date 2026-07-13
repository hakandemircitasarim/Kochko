/**
 * Phase Timeline Component
 * Spec 6.7: Çok fazlı hedef planlaması görsel zaman çizelgesi
 *
 * Mevcut faz konumunu, geçiş bölgelerini ve gelecek fazları gösterir.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, MAX_FONT_SCALE } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

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
const GOAL_COLORS: Record<string, string> = {
  lose_weight: COLORS.primary,
  gain_weight: COLORS.success,
  gain_muscle: COLORS.purple,
  maintain: COLORS.warning,
  health: COLORS.protein,
  conditioning: COLORS.coral,
};

// FIX (ux-pass5, emulator): 'Cut'/'Bulk'/aksansız 'Bakim'/'Saglik' segmentleri TR arayüzde
// İngilizce jargon + bozuk Türkçe olarak görünüyordu.
const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Yağ Yakımı',
  gain_weight: 'Kilo Alma',
  gain_muscle: 'Kas',
  maintain: 'Koruma',
  health: 'Sağlık',
  conditioning: 'Kondisyon',
};

export function PhaseTimeline({ phases, currentWeek }: PhaseTimelineProps) {
  if (phases.length === 0) return null;

  const totalWeeks = phases.reduce((s, p) => s + p.targetWeeks, 0);

  return (
    <View style={{
      backgroundColor: COLORS.card,
      borderRadius: 12,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: COLORS.border,
    }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '700', marginBottom: SPACING.sm }}>
        Hedef Fazları
      </Text>

      {/* Timeline bar */}
      <View style={{
        flexDirection: 'row',
        height: 32,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: COLORS.surfaceLight,
      }}>
        {phases.map((phase, i) => {
          const widthPct = (phase.targetWeeks / totalWeeks) * 100;
          const color = GOAL_COLORS[phase.goalType] ?? COLORS.textMuted;

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
              borderRightColor: COLORS.background,
            }}>
              <Text
                // FIX (ux-pass5): TR etiketler eski 'Cut'/'Bulk'tan uzun — dar fazda 32px
                // barın dışına sarmasın.
                numberOfLines={1}
                style={{
                // FIX (audit accent-contrast): aktif faz metnini sabit beyaz yerine faz
                // rengine göre kontrast-güvenli seç (WCAG AA).
                color: phase.isActive ? (getContrastColor(color) === 'black' ? COLORS.background : '#fff') : COLORS.textSecondary,
                fontSize: FONT.xs,
                fontWeight: phase.isActive ? '700' : '500',
              }}>
                {GOAL_LABELS[phase.goalType] ?? phase.goalType}
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
                style={{
                  color: phase.isActive ? COLORS.text : COLORS.textMuted,
                  fontSize: 10,
                  fontWeight: phase.isActive ? '600' : '400',
                }}
              >
                {/* FIX (ux-pass5): phase_label'sız hedeflerde servis çiğ goal_type düşürür
                    ('lose_weight' ekranda görünüyordu) — bilinen enum'ları insanileştir. */}
                {GOAL_LABELS[phase.label] ?? phase.label ?? `${phase.targetWeeks} hafta`}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Current position indicator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginRight: SPACING.xs }} />
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          {/* FIX (audit phase-overflow): currentWeek totalWeeks'i aşarsa 'Hafta 20 / 16' yerine
              clamp + aşım ek metni göster. */}
          Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}{currentWeek > totalWeeks ? ` (+${currentWeek - totalWeeks} hafta)` : ''}
        </Text>
      </View>
    </View>
  );
}
