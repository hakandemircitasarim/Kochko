/**
 * SettingsList — Profil sekmesi ve Ayarlar merkezinin ortak gruplu listesi (Duolingo dili, §0-A).
 *
 * Neden ayrı dosya: profile.tsx ve settings/index.tsx aynı MenuGroup/Row'u ikişer kopya
 * taşıyordu (0.5px kıl çizgi, RADIUS.md, 18px çıplak ikon). Duolingo'nun ayar listesi ise
 * "kutu kutu" değil tek bir yastık grup: kalın (2px) gri kenar, satır başında renkli ikon
 * kutucuğu, kalın satır etiketi. İki ekran tek tanımdan beslensin ki birbirinden kaymasın.
 *
 *   SettingsGroup — 2px gri kenarlı, RADIUS.lg kart; satırları kırpar (overflow hidden).
 *                   Kenar Button/ChoiceTile'ın gri gövdesiyle aynı ton (açıkta progressTrack,
 *                   koyuda border): `border` açık temada #F5F7FA zeminde neredeyse görünmüyor.
 *   SettingsIcon  — 36px pastel ikon kutucuğu. Pastel ton OPAK (`mix`): grup yüzeyinin
 *                   üstünde yarı saydam ton koyu temada çamurlaşıyordu.
 *   SettingsRow   — TouchableOpacity satır (satırlar gövdesiz kalır, §0-B kural 2) + chevron.
 *
 * Satırın a11y sözleşmesi eskisiyle birebir: role=button, etiket "X, Premium özellik" /
 * "X, değer" / "X". Dokunuşta haptics.tap() burada (iki ekran da öyle yapıyordu).
 */
import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, MOTION, mix } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';

type IconName = keyof typeof Ionicons.glyphMap;

/** Gri gövde tonu — Button outline / ChoiceTile ile aynı kural. */
export function useGreyEdge() {
  const { colors, isDark } = useTheme();
  return isDark ? colors.border : colors.progressTrack;
}

export function SettingsGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const edge = useGreyEdge();
  return (
    <View
      style={[
        { backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: edge, overflow: 'hidden' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Pastel ikon kutucuğu. `mascot` → ikon yerine mini Koçko (koçun kendisiyle ilgili satırlar). */
export function SettingsIcon({ icon, color, mascot, size = 36 }: { icon: IconName; color: string; mascot?: boolean; size?: number }) {
  const { colors, isDark } = useTheme();
  // Koyu temada ton biraz daha yüksek: 0.14'te #1A1A24 üstünde renk seçilmiyordu.
  const face = mix(color, colors.card, isDark ? 0.24 : 0.14);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: face, alignItems: 'center', justifyContent: 'center' }}
    >
      {mascot ? <KochkoMascot size={Math.round(size * 0.78)} /> : <Ionicons name={icon} size={Math.round(size * 0.53)} color={color} />}
    </View>
  );
}

/** Premium kilit hapı — kilitli satırlar dokunulmadan önce tanınsın. */
export function PremiumPill() {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginRight: SPACING.sm }}>
      <Ionicons name="lock-closed" size={11} color={colors.primary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.footnote, color: colors.primary, fontWeight: '700' }}>Premium</Text>
    </View>
  );
}

interface RowProps {
  icon: IconName;
  color: string;
  label: string;
  onPress: () => void;
  value?: string;
  premium?: boolean;
  last?: boolean;
  /** Yıkıcı satır (Hesabı sil): etiket errorText (küçük kırmızı metin AA kuralı). */
  danger?: boolean;
  mascot?: boolean;
}

export function SettingsRow({ icon, color, label, onPress, value, premium, last, danger, mascot }: RowProps) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
        paddingVertical: SPACING.md - 2, paddingHorizontal: SPACING.md,
        minHeight: 60,
        // İç ayraç bilerek kenardan sessiz (§DEPTH: grup sınırı güçlü, iç ayraç sessiz).
        borderBottomWidth: last ? 0 : 2, borderBottomColor: isDark ? colors.divider : colors.surfaceLight,
      }}
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={MOTION.pressOpacity}
      accessibilityRole="button"
      accessibilityLabel={premium ? `${label}, Premium özellik` : value ? `${label}, ${value}` : label}
    >
      <SettingsIcon icon={icon} color={color} mascot={mascot} />
      {/* Ayar satırları taranan uzun bir liste; etiket okuma basamağında (TYPE.body) ama
          Duolingo gibi yarı-kalın: ikon kutucuğunun yanında ince metin sönük kalıyordu. */}
      <Text style={{ ...TYPE.body, fontWeight: '600', color: danger ? colors.errorText : colors.text, flex: 1, flexShrink: 1 }}>{label}</Text>
      {premium && <PremiumPill />}
      {/* Değer kilitli satırda gizli (Premium hapı yer kaplıyor, değer zaten açılamıyor). */}
      {!premium && value ? (
        <Text numberOfLines={1} style={{ ...TYPE.caption, color: colors.textMuted, maxWidth: 140 }}>{value}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
