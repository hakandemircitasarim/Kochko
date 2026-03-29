/**
 * Inline feedback buttons for AI messages.
 * Spec 5.8: "İşe yaradı" / "Bana göre değil"
 */
import { useState } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { submitFeedback, type ContextType, type FeedbackType } from '@/services/feedback.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  contextType: ContextType;
  contextId: string | null;
}

export function FeedbackButtons({ contextType, contextId }: Props) {
  const [submitted, setSubmitted] = useState<FeedbackType | null>(null);

  const handleFeedback = async (fb: FeedbackType) => {
    setSubmitted(fb);
    if (contextId) await submitFeedback(contextType, contextId, fb);
  };

  if (submitted) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>
        {submitted === 'helpful' ? 'Tesekkurler!' : 'Not edildi, gelecekte daha iyi olacak.'}
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
      <TouchableOpacity
        onPress={() => handleFeedback('helpful')}
        style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1, borderColor: COLORS.success }}
      >
        <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>Ise yaradi</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleFeedback('not_for_me')}
        style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8, borderWidth: 1, borderColor: COLORS.textMuted }}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Bana gore degil</Text>
      </TouchableOpacity>
    </View>
  );
}
