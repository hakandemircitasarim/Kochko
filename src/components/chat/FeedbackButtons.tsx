/**
 * Inline feedback buttons - Theme-aware
 * Spec 5.8
 */
import { useState } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { submitFeedback, type ContextType, type FeedbackType } from '@/services/feedback.service';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

interface Props {
  contextType: ContextType;
  contextId: string | null;
}

export function FeedbackButtons({ contextType, contextId }: Props) {
  const { colors } = useTheme();
  const [submitted, setSubmitted] = useState<FeedbackType | null>(null);
  const [failed, setFailed] = useState(false);

  const handleFeedback = async (fb: FeedbackType) => {
    haptics.tap();
    setFailed(false);
    // optimistic — commit immediately, roll back if the network call throws
    setSubmitted(fb);
    try {
      await submitFeedback(contextType, contextId, fb);
      haptics.success();
    } catch {
      // revert the optimistic state so the thumbs reappear for a retry
      setSubmitted(null);
      setFailed(true);
      haptics.error();
    }
  };

  if (submitted) {
    return (
      // FIX (ux-round3 #19): the confirmation replaces the buttons (focus was on a now-unmounted
      // node), so a screen reader never announces it. Mark it a polite live region.
      <Text accessible accessibilityLiveRegion="polite" style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.xs }}>
        {submitted === 'helpful' ? 'Teşekkürler!' : 'Not edildi, gelecekte daha iyi olacak.'}
      </Text>
    );
  }

  return (
    <View style={{ marginTop: SPACING.sm }}>
      <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
        <TouchableOpacity
          onPress={() => handleFeedback('helpful')}
          accessibilityRole="button"
          accessibilityLabel="Bu öneri işe yaradı"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <Text style={{ ...TYPE.caption, color: colors.success, fontWeight: '700' }}>İşe yaradı</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleFeedback('not_for_me')}
          accessibilityRole="button"
          accessibilityLabel="Bu öneri bana göre değil"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <Text style={{ ...TYPE.caption, color: colors.textMuted, fontWeight: '600' }}>Bana göre değil</Text>
        </TouchableOpacity>
      </View>
      {failed && (
        <Text accessible accessibilityLiveRegion="polite" style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.xs }}>
          Kaydedilemedi, tekrar dene.
        </Text>
      )}
    </View>
  );
}
