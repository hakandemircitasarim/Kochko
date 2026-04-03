/**
 * Goal Progress Widget
 * Spec 6.3: Visual goal tracking on dashboard.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import type { GoalProgress as GoalProgressData, PaceStatus } from '@/lib/goal-progress';

interface Props {
  progress: GoalProgressData;
  goalType: string;
  targetWeight: number | null;
  currentWeight: number | null;
  inMaintenance?: boolean;
  maintenanceMessage?: string;
}

const PACE_BADGE: Record<PaceStatus, { label: string; color: string }> = {
  ahead: { label: 'Hedefin Onunde', color: COLORS.success },
  on_track: { label: 'Yolunda', color: COLORS.primary },
  behind: { label: 'Biraz Geride', color: COLORS.warning },
  stalled: { label: 'Durmus', color: COLORS.error },
};

const GOAL_TYPE_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Verme',
  gain_weight: 'Kilo Alma',
  gain_muscle: 'Kas Kazanma',
  health: 'Saglikli Yasam',
  maintain: 'Kilo Koruma',
  conditioning: 'Kondisyon',
};

export function GoalProgressWidget({ progress, goalType, targetWeight, currentWeight, inMaintenance, maintenanceMessage }: Props) {
  const pace = PACE_BADGE[progress.paceStatus];

  // Maintenance mode display
  if (inMaintenance) {
    return (
      <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>Bakim Modu</Text>
          <View style={{ backgroundColor: COLORS.success, borderRadius: 8, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>Hedefe Ulasti</Text>
          </View>
        </View>
        {maintenanceMessage && (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{maintenanceMessage}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>
          {GOAL_TYPE_LABELS[goalType] ?? 'Hedef'}
        </Text>
        <View style={{ backgroundColor: pace.color, borderRadius: 8, paddingHorizontal: SPACING.sm, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>{pace.label}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${progress.percentComplete}%`, backgroundColor: pace.color, borderRadius: 5 }} />
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
          {currentWeight ?? '?'}kg → {targetWeight ?? '?'}kg
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
          %{progress.percentComplete}
        </Text>
      </View>

      {/* Detail row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          {progress.kgRemaining}kg kaldi
        </Text>
        {progress.estimatedCompletionDate && (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
            Tahmini: {formatDate(progress.estimatedCompletionDate)}
          </Text>
        )}
      </View>
    </View>
  );
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const months = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
