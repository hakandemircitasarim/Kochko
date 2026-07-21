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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

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
  solid,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  solid?: boolean;
}) => {
  const { colors } = useTheme();
  // Solid (filled) chips get the brand color as the fill with a contrast-safe
  // foreground; outline chips keep the subtle tinted background.
  const fg = disabled
    ? colors.textMuted
    : solid
      ? getContrastColor(color)
      : color;
  return (
    <TouchableOpacity
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: disabled
          ? colors.surfaceLight
          : solid
            ? color
            : color + '18',
        borderRadius: RADIUS.full,
        paddingHorizontal: SPACING.sm + 2,
        paddingVertical: 6,
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
      }}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={12} color={fg} />
      <Text
        style={{
          color: fg,
          fontSize: 11,
          fontWeight: solid ? '700' : '600',
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
    haptics.tap(); // FIX (ux-polish): every other send path taps; empty sends stay silent (after guard).
    onSend(trimmed);
    setText('');
    Keyboard.dismiss();
  };

  // "Baştan başla" discards the whole draft — confirm before firing.
  const handleRegenerate = () => {
    Alert.alert(
      'Baştan başla?',
      'Şu anki taslak silinecek ve plan yeniden oluşturulacak. Emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Baştan başla',
          style: 'destructive',
          onPress: () => {
            haptics.heavy();
            onRegenerate();
          },
        },
      ],
    );
  };

  const handleApprove = () => {
    haptics.success();
    onApprove();
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
      {/* Secondary / exploratory chips (non-committal actions) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip
          label="Nasıl yaptın?"
          icon="help-circle-outline"
          color={colors.purple}
          onPress={onAskReasoning}
          disabled={disabled || sending}
        />
        <Chip
          label="Alternatif gör"
          icon="git-branch-outline"
          color={colors.warning}
          onPress={onRequestAlternative}
          disabled={disabled || sending}
        />
        <Chip
          label="Baştan başla"
          icon="refresh"
          color={colors.pink}
          onPress={handleRegenerate}
          disabled={disabled || sending}
        />
      </View>

      {/* Primary commit action — own row, full-width solid, separated from the
          destructive "Baştan başla" so the two can't be confused/mis-tapped. */}
      <Chip
        label="Onayla ve kaydet"
        icon="checkmark-circle"
        color={colors.success}
        onPress={handleApprove}
        disabled={disabled || sending || !canApprove}
        solid
      />

      {approveHint && !canApprove ? (
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 11,
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
            // FIX (ux-pass5): raw 13 drifted from the main chat composer's 14 — same
            // "type to the coach" affordance, same size, via the FONT token.
            fontSize: FONT.md,
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
          accessibilityRole="button"
          accessibilityLabel="Mesajı gönder"
          accessibilityState={{ disabled: !text.trim() || !!disabled || !!sending, busy: !!sending }}
          // FIX (ux-pass5): 32x32 with no hitSlop was the app's only bare send target
          // (main chat's twin carries hitSlop 8) — 48x48 effective.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
            color={
              !text.trim() || disabled || sending
                ? colors.textMuted
                : getContrastColor(colors.primary)
            }
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}
