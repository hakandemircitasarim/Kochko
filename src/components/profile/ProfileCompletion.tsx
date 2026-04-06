/**
 * Profile Completion Bar - Theme-aware
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';
import { CATEGORY_LABELS, type ProfileCategory } from '@/lib/profile-completion';

interface Props { percentage: number; lowestCategory?: ProfileCategory; onPress?: () => void; }

export function ProfileCompletion({ percentage, lowestCategory, onPress }: Props) {
  const { colors, isDark } = useTheme();
  const color = percentage >= 80 ? colors.success : percentage >= 50 ? colors.primary : '#F59E0B';
  const messages: Record<number, string> = {
    0: 'Koçunla konuşarak profilini doldur!', 25: 'İyi başlangıç! Devam et.',
    50: 'Yarısına geldin. Detaylar koçunun seni daha iyi tanımasını sağlar.',
    75: 'Çok iyi! Neredeyse tamam.', 100: 'Profil tamamlandı.',
  };
  const nearestKey = Object.keys(messages).map(Number).filter(k => k <= percentage).pop() ?? 0;

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Wrapper {...wrapperProps as any} style={{
      backgroundColor: colors.card, borderRadius: RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person-circle" size={20} color={color} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>Profil</Text>
        </View>
        <Text style={{ color, fontSize: FONT.lg, fontWeight: '800' }}>%{percentage}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${percentage}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{messages[nearestKey]}</Text>
      {lowestCategory && percentage < 100 && (
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>Eksik: {CATEGORY_LABELS[lowestCategory]}</Text>
      )}
    </Wrapper>
  );
}
