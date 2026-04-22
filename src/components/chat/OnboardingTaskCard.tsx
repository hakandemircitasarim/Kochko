/**
 * Onboarding Task Card — compact card for Kochko session list
 * Tapping creates a new session and navigates with prefill
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import type { OnboardingTask } from '@/services/onboarding-tasks.service';

interface Props {
  task: OnboardingTask;
  onPress: (task: OnboardingTask) => void;
}

export function OnboardingTaskCard({ task, onPress }: Props) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      onPress={() => onPress(task)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}: ${task.description}`}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: task.color + '33',
        width: 220,
        gap: SPACING.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            backgroundColor: task.color + '22',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={task.icon as keyof typeof Ionicons.glyphMap} size={17} color={task.color} />
        </View>
        <View
          style={{
            marginLeft: 'auto',
            backgroundColor: task.color + '15',
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: task.color, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>
            BAŞLA
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
        {task.title}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 15 }} numberOfLines={2}>
        {task.description}
      </Text>
    </TouchableOpacity>
  );
}
