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
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
      <TouchableOpacity
        onPress={() => handleFeedback('helpful')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.success + '12' }}
      >
        <Ionicons name="thumbs-up-outline" size={14} color={colors.success} />
        <Text style={{ color: colors.success, fontSize: FONT.xs, fontWeight: '600' }}>İşe yaradı</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleFeedback('not_for_me')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight }}
      >
        <Ionicons name="thumbs-down-outline" size={14} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>Bana göre değil</Text>
      </TouchableOpacity>
    </View>
  );
}
