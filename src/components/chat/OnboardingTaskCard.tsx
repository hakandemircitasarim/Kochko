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
      activeOpacity={0.7}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        padding: SPACING.lg,
        borderWidth: 0.5,
        borderColor: colors.border,
        width: 200,
        gap: SPACING.sm,
      }}
    >
      <View style={{
        width: 36, height: 36, borderRadius: RADIUS.sm,
        backgroundColor: task.color + '18',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={task.icon as any} size={18} color={task.color} />
      </View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
        {task.title}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={2}>
        {task.description}
      </Text>
    </TouchableOpacity>
  );
}
