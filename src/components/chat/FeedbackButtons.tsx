/**
 * Inline feedback buttons - Theme-aware
 * Spec 5.8
 *
 * 2026-11-04: iki hap artık sohbetin gövdeli küçük çipi (ChatChip sm) — basınca rafa iner,
 * solmaz. "İşe yaradı" ikonunu olumlu tonda taşır; etiketler/a11y ve iyimser akış aynı.
 */
import { useState } from 'react';
import { View, Text } from 'react-native';
import { submitFeedback, type ContextType, type FeedbackType } from '@/services/feedback.service';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { ChatChip } from '@/components/chat/ChatChip';

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
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <ChatChip
          size="sm"
          haptic={false}
          icon="thumbs-up"
          iconColor={colors.success}
          label="İşe yaradı"
          accessibilityLabel="Bu öneri işe yaradı"
          onPress={() => handleFeedback('helpful')}
        />
        <ChatChip
          size="sm"
          haptic={false}
          icon="thumbs-down-outline"
          iconColor={colors.textMuted}
          label="Bana göre değil"
          accessibilityLabel="Bu öneri bana göre değil"
          onPress={() => handleFeedback('not_for_me')}
        />
      </View>
      {failed && (
        <Text accessible accessibilityLiveRegion="polite" style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.xs }}>
          Kaydedilemedi, tekrar dene.
        </Text>
      )}
    </View>
  );
}
