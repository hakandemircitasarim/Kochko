/**
 * Goal Progress Widget - Modern design
 * Spec 6.3: Visual goal tracking on dashboard.
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';
import type { GoalProgress as GoalProgressData, PaceStatus } from '@/lib/goal-progress';

interface Props {
  progress: GoalProgressData;
  goalType: string;
  targetWeight: number | null;
  currentWeight: number | null;
  inMaintenance?: boolean;
  maintenanceMessage?: string;
  slim?: boolean;
}

const PACE_CONFIG: Record<PaceStatus, { label: string; color: string; icon: string }> = {
  ahead: { label: 'Hedefin Önünde', color: '#22C55E', icon: 'rocket' },
  on_track: { label: 'Yolunda', color: '#1D9E75', icon: 'checkmark-circle' },
  behind: { label: 'Biraz Geride', color: '#F59E0B', icon: 'alert-circle' },
  stalled: { label: 'Durmuş', color: '#EF4444', icon: 'pause-circle' },
};

const GOAL_TYPE_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Verme',
  gain_weight: 'Kilo Alma',
  gain_muscle: 'Kas Kazanma',
  health: 'Sağlıklı Yaşam',
  maintain: 'Kilo Koruma',
  conditioning: 'Kondisyon',
};

export function GoalProgressWidget({ progress, goalType, targetWeight, currentWeight, inMaintenance, maintenanceMessage, slim }: Props) {
  const { colors, isDark } = useTheme();
  const pace = PACE_CONFIG[progress.paceStatus];

  if (slim) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pace.color }} />
        <Text style={{ fontSize: FONT.sm, color: colors.text, fontWeight: '600' }}>
          {GOAL_TYPE_LABELS[goalType] ?? 'Hedef'}
        </Text>
        <View style={{ flex: 1, height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.min(100, progress.percentComplete)}%`, backgroundColor: pace.color, borderRadius: 3 }} />
        </View>
        <Text style={{ fontSize: FONT.sm, color: pace.color, fontWeight: '800' }}>%{progress.percentComplete}</Text>
      </View>
    );
  }

  if (inMaintenance) {
    return (
      <View style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xxl,
        padding: SPACING.md,
        ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#22C55E18', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="trophy" size={20} color="#22C55E" />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>Bakim Modu</Text>
          </View>
          <View style={{ backgroundColor: '#22C55E', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm + 2, paddingVertical: 3 }}>
            <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>Hedefe Ulasti</Text>
          </View>
        </View>
        {maintenanceMessage && (
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{maintenanceMessage}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.xxl,
      padding: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm + 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: pace.color + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={pace.icon as any} size={20} color={pace.color} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
            {GOAL_TYPE_LABELS[goalType] ?? 'Hedef'}
          </Text>
        </View>
        <View style={{ backgroundColor: pace.color + '18', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm + 2, paddingVertical: 3 }}>
          <Text style={{ color: pace.color, fontSize: FONT.xs, fontWeight: '700' }}>{pace.label}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{ height: 10, backgroundColor: colors.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${Math.min(100, progress.percentComplete)}%`, backgroundColor: pace.color, borderRadius: 5 }} />
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
          {currentWeight ?? '?'}kg \u2192 {targetWeight ?? '?'}kg ({progress.kgRemaining}kg kaldi)
        </Text>
        <Text style={{ color: pace.color, fontSize: FONT.xs, fontWeight: '700' }}>
          %{progress.percentComplete}
        </Text>
      </View>

      {progress.estimatedCompletionDate && (
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 4 }}>
          Tahmini: {formatDate(progress.estimatedCompletionDate)}
        </Text>
      )}
    </View>
  );
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const months = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
