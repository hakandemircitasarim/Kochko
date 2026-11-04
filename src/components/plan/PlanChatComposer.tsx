/**
 * Plan chat composer — extended TextInput with quick-action chips above.
 * Built for the plan/diet and plan/workout screens, not general chat.
 *
 * Chips:
 *  - "Nasıl yaptın?"     → onAskReasoning  (AI emits <reasoning>)
 *  - "Alternatif gör"    → onRequestAlternative
 *  - "Baştan başla"      → onRegenerate
 *  - "Onayla ve kaydet"  → onApprove (disabled until hasViewedFullPlan)
 *
 * DUOLINGO DİLİ (2026-11-04): keşif çipleri gri gövdeli kelime kutucukları (renk yalnız
 * ikonda — üç renkli dolgu hap ekranda karnaval gibiydi), onay ekranın TEK dolu tuşu: gövdeli
 * Button (lg). Gönder düğmesi de gövdeli yuvarlak tuş.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Keyboard,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { Button } from '@/components/ui/Button';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
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
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) => {
  const { colors, isDark } = useTheme();
  // Gövdeli kelime kutucuğu: kart yüz + 2px gri çerçeve + gri raf (QuickSelectButtons ile aynı).
  const grey = isDark ? colors.border : colors.progressTrack;
  return (
    <ShelfPressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      // 36 görsel + hitSlop → ≥44 etkin (eski minHeight 44'ün yerine; gövde yüksekliği büyütmesin).
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      radius={RADIUS.pill}
      shelfColor={grey}
      style={{ opacity: disabled ? 0.5 : 1 }}
      faceStyle={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        minHeight: 36,
        paddingHorizontal: SPACING.md,
        backgroundColor: colors.card,
        borderWidth: 2,
        borderColor: grey,
      }}
    >
      <Ionicons name={icon} size={15} color={disabled ? colors.textMuted : color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: disabled ? colors.textMuted : colors.text, fontWeight: '700' }}>
        {label}
      </Text>
    </ShelfPressable>
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
  const { colors, isDark } = useTheme();
  const grey = isDark ? colors.border : colors.progressTrack;
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
        borderTopWidth: 2,
        borderTopColor: grey,
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
      <Button
        title="Onayla ve kaydet"
        size="lg"
        onPress={handleApprove}
        disabled={disabled || sending || !canApprove}
        accessibilityLabel="Onayla ve kaydet"
        icon={<Ionicons name="checkmark-circle" size={20} color={getContrastColor(colors.primary)} />}
      />

      {approveHint && !canApprove ? (
        <Text
          style={{
            ...TYPE.caption,
            color: colors.textMuted,
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
          borderWidth: 2,
          borderColor: grey,
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
            // "type to the coach" affordance, same size. 08-04: iki besteci de artik
            // TYPE.body'de (ChatThreadScreen ile ayni token).
            ...TYPE.body,
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
        <ShelfPressable
          onPress={handleSend}
          disabled={!text.trim() || disabled || sending}
          accessibilityRole="button"
          accessibilityLabel="Mesajı gönder"
          accessibilityState={{ disabled: !text.trim() || !!disabled || !!sending, busy: !!sending }}
          // FIX (ux-pass5): the app's only bare send target had no hitSlop — 48x48+ effective.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          radius={18}
          shelfColor={!text.trim() || disabled || sending ? grey : colors.primaryDark}
          faceStyle={{
            width: 36,
            height: 36,
            backgroundColor:
              !text.trim() || disabled || sending ? (isDark ? colors.surfaceLight : colors.background) : colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={sending ? 'hourglass-outline' : 'arrow-up'}
            size={18}
            color={
              !text.trim() || disabled || sending
                ? colors.textMuted
                : getContrastColor(colors.primary)
            }
          />
        </ShelfPressable>
      </View>
    </View>
  );
}
