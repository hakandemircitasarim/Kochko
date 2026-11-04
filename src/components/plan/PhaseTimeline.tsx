/**
 * Phase Timeline Component
 * Spec 6.7: Çok fazlı hedef planlaması görsel zaman çizelgesi
 *
 * Mevcut faz konumunu, geçiş bölgelerini ve gelecek fazları gösterir.
 *
 * DUOLINGO YOL HARİTASI (2026-11-04): eskiden 32px'lik oransal bir şeritti; aktif faz tek
 * dolu hücre, tamamlanan ile gelecek arasındaki fark yalnız alfa tonuydu (0x40 vs 0x20) — göz
 * ayırt edemiyordu. Şimdi her faz bir DÜĞÜM: tamamlanan = dolu renk + tik, şimdiki = büyük
 * dolu düğüm + halka + "ŞİMDİ" balonu (girişte bir kez yaylanır, reduce-motion'da durur),
 * gelecek = gri düğüm + kilit. Düğümler arası yol: geçilen kısım marka renginde, kalanı gri.
 * Oransal süre bilgisi kaybolmasın diye her düğümün altında "N hf" ve en altta haftalık
 * ProgressBar var. Düğümler dokunulamaz: alt kalınlık hacim için, basınca inmez.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { goalShortLabelTR } from '@/lib/labels';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ProgressBar } from '@/components/ui/ProgressBar';

interface Phase {
  id: string;
  label: string;
  goalType: string;
  targetWeeks: number;
  isActive: boolean;
  isCompleted: boolean;
}

interface PhaseTimelineProps {
  phases: Phase[];
  currentWeek: number; // overall week count
}

// FIX (audit phase-palette): tema-dışı Material tonlarını mevcut marka token'larına eşle.
// FIX (theme): modül seviyesinde renk DEĞERİ tutmak koyu paleti her temaya donduruyordu —
// tabloda artık token ADI var, renk render sırasında aktif temadan çözülüyor.
const GOAL_COLOR_TOKENS: Record<string, keyof ThemeColors> = {
  lose_weight: 'primary',
  gain_weight: 'success',
  gain_muscle: 'purple',
  maintain: 'warning',
  health: 'protein',
  conditioning: 'coral',
};

const GOAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  lose_weight: 'flame',
  gain_weight: 'trending-up',
  gain_muscle: 'barbell',
  maintain: 'shield-checkmark',
  health: 'heart',
  conditioning: 'pulse',
};

const NODE = 48;
const NODE_ACTIVE = 58;
const DEPTH = 4;

export function PhaseTimeline({ phases, currentWeek }: PhaseTimelineProps) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(reduceMotion ? 1 : 0.7)).current;

  // Şimdiki düğüm sayfaya bir kez yaylanarak oturur (mount-only, native driver).
  useEffect(() => {
    if (reduceMotion) { pop.setValue(1); return; }
    const a = Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduceMotion, pop]);

  if (phases.length === 0) return null;

  const totalWeeks = phases.reduce((s, p) => s + p.targetWeeks, 0);
  const grey = isDark ? colors.border : colors.progressTrack;
  // Gelecek düğümün yüzü: kartın üstünde ayrışan opak gri (iz kuralı §0-A — yüzeye göre).
  const futureFace = isDark ? colors.surfaceLight : colors.background;
  // Tüm düğüm merkezleri tek yatay çizgide: alan alttan hizalı; şimdiki düğümün merkezin
  // altında kalan payı (yarıçap + halka + kalınlık) diğerlerine marginBottom ile eşitleniyor.
  const AREA_H = NODE_ACTIVE + 8 + DEPTH + 20;
  const belowActive = NODE_ACTIVE / 2 + 4 + DEPTH;
  const lineY = AREA_H - belowActive;

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.lg,
      borderWidth: 2,
      borderColor: grey,
    }}>
      <Text style={{ ...TYPE.headline, color: colors.text, marginBottom: SPACING.md }}>
        Hedef Fazları
      </Text>

      <View style={{ flexDirection: 'row' }}>
        {phases.map((phase, i) => {
          const color = colors[GOAL_COLOR_TOKENS[phase.goalType] ?? 'textMuted'];
          const fg = getContrastColor(color);
          const size = phase.isActive ? NODE_ACTIVE : NODE;
          const state = phase.isCompleted ? 'done' : phase.isActive ? 'now' : 'next';
          // Yol: bir düğümden SAĞA çıkan çizgi, bu faz bitmişse "geçilmiş" (marka), değilse gri.
          // Sola giren çizgi önceki fazın durumunu taşır.
          const leftTraveled = i > 0 && phases[i - 1].isCompleted;
          const rightTraveled = phase.isCompleted;
          const label = phase.label ? goalShortLabelTR(phase.label) : `${phase.targetWeeks} hafta`;
          return (
            <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
              {/* Görsel düğüm + yol: dekoratif — ekran okuyucu durumu alttaki etiketten duyar. */}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ width: '100%', height: AREA_H, alignItems: 'center', justifyContent: 'flex-end' }}
              >
                {i > 0 ? (
                  <View style={{ position: 'absolute', left: 0, right: '50%', top: lineY - 3, height: 6, backgroundColor: leftTraveled ? colors.primary : grey }} />
                ) : null}
                {i < phases.length - 1 ? (
                  <View style={{ position: 'absolute', left: '50%', right: 0, top: lineY - 3, height: 6, backgroundColor: rightTraveled ? colors.primary : grey }} />
                ) : null}

                <Animated.View style={{ alignItems: 'center', marginBottom: state === 'now' ? 0 : belowActive - (NODE / 2 + DEPTH), transform: [{ scale: state === 'now' ? pop : 1 }] }}>
                  {state === 'now' ? (
                    <View style={{ backgroundColor: color, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 1, marginBottom: 4 }}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.overline, fontSize: 10, color: fg }}>ŞİMDİ</Text>
                    </View>
                  ) : null}
                  {/* Halka (yalnız şimdiki): düğümün etrafında rengin açık tonu. */}
                  <View style={{
                    padding: state === 'now' ? 4 : 0,
                    borderRadius: 999,
                    backgroundColor: state === 'now' ? mix(color, colors.card, 0.25) : 'transparent',
                  }}>
                    {/* Alt kalınlık (coin hissi): koyu ton bir katman, yüz onun üstünde. */}
                    <View style={{
                      width: size, height: size + DEPTH, borderRadius: size / 2,
                      backgroundColor: state === 'next' ? grey : mix(color, '#000000', 0.75),
                    }}>
                      <View style={{
                        width: size, height: size, borderRadius: size / 2,
                        backgroundColor: state === 'next' ? futureFace : color,
                        borderWidth: state === 'next' ? 2 : 0,
                        borderColor: grey,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Ionicons
                          name={state === 'done' ? 'checkmark' : state === 'now' ? (GOAL_ICONS[phase.goalType] ?? 'flag') : 'lock-closed'}
                          size={state === 'done' ? 26 : state === 'now' ? 26 : 18}
                          color={state === 'next' ? colors.textMuted : fg}
                        />
                      </View>
                    </View>
                  </View>
                </Animated.View>
              </View>

              <Text
                // FIX (audit UI-PLN-01): büyük sistem fontunda taşma artmasın. 5 fazlı hedefte düğüm
                // sütunu ~70dp — "Yağ Ya…" kırpılıyordu; iki satır + ortalı, sonra ellipsis.
                numberOfLines={2}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                // FIX (ux-polish): speak the phase's state (active/completed) — the path conveys it by
                // color/icon only, which a screen reader couldn't announce.
                accessibilityLabel={`${label}${phase.isActive ? ', şu anki faz' : phase.isCompleted ? ', tamamlandı' : ''}`}
                style={{
                  // 5+ fazda sütun dar: bir adım küçük, yoksa uzun ad kelime ortasından bölünüyor.
                  ...(phases.length >= 5 ? TYPE.footnote : TYPE.caption),
                  marginTop: SPACING.xs,
                  paddingHorizontal: 2,
                  textAlign: 'center',
                  color: phase.isActive ? colors.text : colors.textSecondary,
                  fontWeight: phase.isActive ? '800' : '600',
                }}
              >
                {/* FIX (ux-pass5): phase_label'sız hedeflerde servis çiğ goal_type düşürür
                    ('lose_weight' ekranda görünüyordu) — bilinen enum'ları insanileştir. */}
                {label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.footnote, color: colors.textMuted }}>
                {phase.targetWeeks} hf
              </Text>
            </View>
          );
        })}
      </View>

      {/* Current position — haftalık ilerleme çubuğu (oransal süre bilgisinin yeni evi). */}
      <View style={{ marginTop: SPACING.md }}>
        <ProgressBar progress={totalWeeks > 0 ? Math.min(currentWeek, totalWeeks) / totalWeeks : 0} color={colors.primary} height={10} trackColor={isDark ? colors.border : undefined} />
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.xs }}>
          {/* FIX (audit phase-overflow): currentWeek totalWeeks'i aşarsa 'Hafta 20 / 16' yerine
              clamp + aşım ek metni göster. */}
          Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}{currentWeek > totalWeeks ? ` (+${currentWeek - totalWeeks} hafta)` : ''}
        </Text>
      </View>
    </View>
  );
}
