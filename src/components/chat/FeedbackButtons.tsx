/**
 * Feedback Buttons — Spec 5.7
 * "İşe yaradı" / "Bana göre değil" inline buttons.
 * On "not for me": optional reason input for better AI learning.
 */
import { useState } from 'react';
import { View, TouchableOpacity, Text, TextInput } from 'react-native';
import { submitFeedback, type ContextType, type FeedbackType } from '@/services/feedback.service';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  contextType: ContextType;
  contextId: string | null;
}

const REASONS = [
  { key: 'not_tasty', label: 'Tatmaz' },
  { key: 'too_complex', label: 'Cok karisik' },
  { key: 'too_expensive', label: 'Pahali' },
  { key: 'no_ingredients', label: 'Malzeme yok' },
  { key: 'not_relevant', label: 'Bana uygun degil' },
];

export function FeedbackButtons({ contextType, contextId }: Props) {
  const [submitted, setSubmitted] = useState<FeedbackType | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [customReason, setCustomReason] = useState('');

  const handleFeedback = async (fb: FeedbackType) => {
    if (fb === 'not_for_me') {
      setShowReasons(true);
      setSubmitted(fb);
      return;
    }
    setSubmitted(fb);
    if (contextId) await submitFeedback(contextType, contextId, fb);
  };

  const handleReason = async (reason: string) => {
    setShowReasons(false);
    if (contextId) await submitFeedback(contextType, contextId, 'not_for_me', reason);
  };

  if (submitted === 'helpful') {
    return (
      <View style={{ marginTop: SPACING.xs }}>
        <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>Tesekkurler, not edildi!</Text>
      </View>
    );
  }

  if (showReasons) {
    return (
      <View style={{ marginTop: SPACING.xs }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.xs }}>Neden uymadi? (opsiyonel)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xxs }}>
          {REASONS.map(r => (
            <TouchableOpacity key={r.key} onPress={() => handleReason(r.key)}
              style={{
                paddingVertical: 3, paddingHorizontal: SPACING.sm,
                borderRadius: RADIUS.xs, backgroundColor: COLORS.surfaceLight,
                borderWidth: 1, borderColor: COLORS.border,
              }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 10 }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => handleReason('other')}
            style={{
              paddingVertical: 3, paddingHorizontal: SPACING.sm,
              borderRadius: RADIUS.xs, backgroundColor: COLORS.surfaceLight,
              borderWidth: 1, borderColor: COLORS.border,
            }}>
            <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>Gecis</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.xs }}>
      <TouchableOpacity onPress={() => handleFeedback('helpful')}
        style={{
          paddingVertical: SPACING.xxs, paddingHorizontal: SPACING.sm,
          borderRadius: RADIUS.xs, backgroundColor: COLORS.success + '15',
          borderWidth: 1, borderColor: COLORS.success + '30',
        }}>
        <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>Ise yaradi</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => handleFeedback('not_for_me')}
        style={{
          paddingVertical: SPACING.xxs, paddingHorizontal: SPACING.sm,
          borderRadius: RADIUS.xs, backgroundColor: COLORS.surfaceLight,
          borderWidth: 1, borderColor: COLORS.border,
        }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Bana gore degil</Text>
      </TouchableOpacity>
    </View>
  );
}
