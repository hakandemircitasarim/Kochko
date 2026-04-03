/**
 * Phase Timeline Component
 * Spec 6.7: Çok fazlı hedef planlaması görsel zaman çizelgesi
 *
 * Mevcut faz konumunu, geçiş bölgelerini ve gelecek fazları gösterir.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

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

const GOAL_COLORS: Record<string, string> = {
  lose_weight: COLORS.primary,
  gain_weight: COLORS.success,
  gain_muscle: '#8B5CF6',
  maintain: COLORS.warning,
  health: '#06B6D4',
  conditioning: '#F97316',
};

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Cut',
  gain_weight: 'Bulk',
  gain_muscle: 'Kas',
  maintain: 'Bakim',
  health: 'Saglik',
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
        Hedef Fazlari
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
              <Text style={{
                color: phase.isActive ? '#fff' : COLORS.textSecondary,
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
            <View key={phase.id} style={{ width: `${widthPct}%`, alignItems: 'center' }}>
              <Text style={{
                color: phase.isActive ? COLORS.text : COLORS.textMuted,
                fontSize: 10,
                fontWeight: phase.isActive ? '600' : '400',
              }}>
                {phase.label ?? `${phase.targetWeeks}h`}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Current position indicator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginRight: SPACING.xs }} />
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          Hafta {currentWeek} / {totalWeeks}
        </Text>
      </View>
    </View>
  );
}
