/**
 * Plan chat composer — extended TextInput with quick-action chips above.
 * Built for the plan/diet and plan/workout screens, not general chat.
 *
 * Chips:
 *  - "Nasıl yaptın?"     → onAskReasoning  (AI emits <reasoning>)
 *  - "Alternatif gör"    → onRequestAlternative
 *  - "Baştan başla"      → onRegenerate
 *  - "Onayla ve kaydet"  → onApprove (disabled until hasViewedFullPlan)
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  onSend: (text: string) => void;
  onAskReasoning: () => void;
  onRequestAlternative: () => void;
  onRegenerate: () => void;
  onApprove: () => void;
  canApprove: boolean;
  approveHint?: string;
  disabled?: boolean;
  sending?: boolean;
}

const Chip = ({
  label,
  icon,
  color,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: disabled ? colors.surfaceLight : color + '18',
        borderRadius: RADIUS.full,
        paddingHorizontal: SPACING.sm + 2,
        paddingVertical: 6,
        opacity: disabled ? 0.5 : 1,
      }}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={12} color={disabled ? colors.textMuted : color} />
      <Text
        style={{
          color: disabled ? colors.textMuted : color,
          fontSize: 11,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export function PlanChatComposer({
  onSend,
  onAskReasoning,
  onRequestAlternative,
  onRegenerate,
  onApprove,
  canApprove,
  approveHint,
  disabled,
  sending,
}: Props) {
  const { colors } = useTheme();
  const [text, setText] = useState('');

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    Keyboard.dismiss();
  };

  return (
    <View
      style={{
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.xs,
        gap: SPACING.xs,
        borderTopWidth: 0.5,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      {/* Quick action chips */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip
          label="Nasıl yaptın?"
          icon="help-circle-outline"
          color="#6366F1"
          onPress={onAskReasoning}
          disabled={disabled || sending}
        />
        <Chip
          label="Alternatif gör"
          icon="git-branch-outline"
          color="#F59E0B"
          onPress={onRequestAlternative}
          disabled={disabled || sending}
        />
        <Chip
          label="Baştan başla"
          icon="refresh"
          color="#EC4899"
          onPress={onRegenerate}
          disabled={disabled || sending}
        />
        <Chip
          label="Onayla ve kaydet"
          icon="checkmark-circle"
          color="#22C55E"
          onPress={onApprove}
          disabled={disabled || sending || !canApprove}
        />
      </View>

      {approveHint && !canApprove ? (
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 10,
            fontStyle: 'italic',
            marginTop: -2,
          }}
        >
          {approveHint}
        </Text>
      ) : null}

      {/* Text input + send */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          backgroundColor: colors.card,
          borderRadius: RADIUS.lg,
          borderWidth: 0.5,
          borderColor: colors.border,
          paddingHorizontal: SPACING.md,
          paddingVertical: 6,
          gap: 6,
        }}
      >
        <TextInput
          style={{
            flex: 1,
            color: disabled ? colors.textMuted : colors.text,
            fontSize: 13,
            paddingVertical: 6,
            maxHeight: 120,
          }}
          placeholder={disabled ? 'Mesaj gönderilemez' : 'Plandaki bir şeyi değiştir...'}
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          editable={!disabled && !sending}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!text.trim() || disabled || sending}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor:
              !text.trim() || disabled || sending ? colors.surfaceLight : colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={sending ? 'hourglass-outline' : 'arrow-up'}
            size={16}
            color={!text.trim() || disabled || sending ? colors.textMuted : '#fff'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}
