/**
 * Inline feedback buttons - Theme-aware
 * Spec 5.8
 */
import { useState } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { submitFeedback, type ContextType, type FeedbackType } from '@/services/feedback.service';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  contextType: ContextType;
  contextId: string | null;
}

export function FeedbackButtons({ contextType, contextId }: Props) {
  const { colors } = useTheme();
  const [submitted, setSubmitted] = useState<FeedbackType | null>(null);

  const handleFeedback = async (fb: FeedbackType) => {
    setSubmitted(fb);
    await submitFeedback(contextType, contextId, fb);
  };

  if (submitted) {
    return (
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>
        {submitted === 'helpful' ? 'Teşekkürler!' : 'Not edildi, gelecekte daha iyi olacak.'}
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm }}>
      <TouchableOpacity
        onPress={() => handleFeedback('helpful')}
        accessibilityRole="button"
        accessibilityLabel="Bu öneri işe yaradı"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 5,
          paddingHorizontal: SPACING.sm + 2,
          borderRadius: RADIUS.full,
          backgroundColor: colors.success + '15',
          borderWidth: 0.5,
          borderColor: colors.success + '33',
        }}
      >
        <Ionicons name="thumbs-up" size={12} color={colors.success} />
        <Text style={{ color: colors.success, fontSize: FONT.xs, fontWeight: '700' }}>İşe yaradı</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleFeedback('not_for_me')}
        accessibilityRole="button"
        accessibilityLabel="Bu öneri bana göre değil"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 5,
          paddingHorizontal: SPACING.sm + 2,
          borderRadius: RADIUS.full,
          backgroundColor: colors.surfaceLight,
          borderWidth: 0.5,
          borderColor: colors.border,
        }}
      >
        <Ionicons name="thumbs-down-outline" size={12} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '600' }}>Bana göre değil</Text>
      </TouchableOpacity>
    </View>
  );
}
