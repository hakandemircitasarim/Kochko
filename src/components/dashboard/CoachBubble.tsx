/**
 * CoachBubble — Koçko maskotu + konuşma balonu (görsel dil §0-A: "karakter").
 *
 * Koçun tek notu artık soyut bir aksan çizgisi değil, KARAKTERİN ağzından çıkan
 * bir balon. line null geldiğinde (ve allowFallback açıkken) saat dilimine göre
 * SICAK ama METRİK İDDİASIZ bir cümle söylenir — deriveCoachLine'ın "sayı tekrar
 * etme" ilkesi bozulmaz: fallback'ler hiçbir ölçüme atıf yapmaz, yalnız eşlik eder.
 * allowFallback=false (ekranda ayrıca bir bildirim-yuvası kartı varken ya da o
 * yuvanın verileri henüz çözülmemişken) balon yalnız gerçek içerikle çizilir —
 * maskot aynı anda iki farklı şey söylemesin, fallback belirip geri sökülmesin
 * (adversarial review: fetch yarışı yerleşim sıçraması yaratıyordu).
 *
 * Balon ve kuyruk AYNI dolguda, kenarlıksız: kuyruk 45° döndürülmüş bir kare
 * olduğu için kenarlık dikişi güzel kapatılamıyor — dolgu farkı derinliği taşır
 * (açıkta beyaz kart + hafif gölge, koyuda surfaceLight).
 *
 * Basış geri bildirimi PressableCard kuralına uyar: bu kart boyutlu bir yüzey,
 * soldurma değil %2 küçülme (adversarial review bulgusu).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, elevation } from '@/lib/design';
import { KochkoMascot, type MascotMood } from '@/components/mascot/KochkoMascot';
import { PressableCard } from '@/components/ui/PressableCard';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/** Saat dilimine göre teşvik cümlesi — deterministik, metrik iddiasız. */
export function coachFallbackLine(hour: number): string {
  if (hour < 6) return 'Geç saat! Ben buradayım ama dinlenmek de antrenmanın parçası.';
  if (hour < 11) return 'Yeni bir gün! Küçük bir adım bile bugünü kazanılmış yapar.';
  if (hour < 14) return 'Gün ortasındayız — ritmini koru, ben hep yanındayım.';
  if (hour < 18) return 'Öğleden sonra da güçlü devam! Takıldığın yerde bana yaz.';
  if (hour < 22) return 'Akşam geldi — günü birlikte güzelce kapatalım mı?';
  return 'Bugün için teşekkürler. Şimdi güzel bir uykuyu hak ettin!';
}

/** Saat dilimine göre maskot ruh hâli. */
export function moodForHour(hour: number): MascotMood {
  return hour < 6 || hour >= 22 ? 'sleepy' : 'happy';
}

interface Props {
  /** Koçun gerçek notu; null → allowFallback'e göre ya fallback ya hiç. */
  line: string | null;
  /** Bildirim yuvası dolu ya da henüz çözülmemişken false geç. */
  allowFallback: boolean;
  mood?: MascotMood;
  onPress?: () => void;
}

export function CoachBubble({ line, allowFallback, mood, onPress }: Props) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  // Sekme odak dışıyken idle animasyonlar dursun (adversarial review: monte kalan
  // tab ekranında bob+blink süresiz çalışıyordu — koddaki tek süresiz döngüydü).
  const isFocused = useIsFocused();
  const hour = new Date().getHours();
  const text = line ?? (allowFallback ? coachFallbackLine(hour) : null);
  const resolvedMood = mood ?? moodForHour(hour);

  // Balon pop-in: yalnız metin GERÇEKTEN değişince (prev-ref kıyası) — deps'e bağlı
  // her koşuşta değil. reduceMotion ref'ten okunur ki bayrak sonradan kapanınca
  // metin değişmeden replay olmasın (adversarial review bulgusu).
  const pop = useRef(new Animated.Value(0)).current;
  const prevText = useRef<string | null>(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  useEffect(() => {
    if (!text) { prevText.current = null; return; }
    const changed = prevText.current !== text;
    prevText.current = text;
    if (!changed) return;
    if (reduceMotionRef.current) { pop.setValue(1); return; }
    pop.setValue(0);
    const t = Animated.spring(pop, { toValue: 1, ...MOTION.spring, useNativeDriver: true });
    t.start();
    return () => t.stop();
  }, [text, pop]);

  if (!text) return null;

  const bubbleBg = isDark ? colors.surfaceLight : colors.card;

  return (
    <PressableCard
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`Koçun notu: ${text}`}
      accessibilityHint={onPress ? 'Koçla konuşmak için dokun' : undefined}
      style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: SPACING.lg }}
    >
      <KochkoMascot size={64} mood={resolvedMood} animated={isFocused} />
      <Animated.View
        style={{
          flex: 1,
          marginLeft: SPACING.md,
          opacity: pop,
          transform: [
            { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        }}
      >
        <View
          style={{
            backgroundColor: bubbleBg,
            // Canlı yüzeylerin yarıçap merdiveni constants.RADIUS — aynı ekranda
            // ikinci bir merdiven (design.RADII) açmıyoruz (adversarial review).
            borderRadius: RADIUS.md,
            paddingVertical: SPACING.md,
            paddingHorizontal: SPACING.lg,
            ...elevation(1, isDark),
          }}
        >
          <Text style={{ ...TYPE.body, color: colors.text }}>{text}</Text>
        </View>
        {/* Kuyruk: balonla aynı dolguda 45° kare — maskota doğru bakar. */}
        <View
          style={{
            position: 'absolute',
            left: -5,
            bottom: 16,
            width: 12,
            height: 12,
            backgroundColor: bubbleBg,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </Animated.View>
    </PressableCard>
  );
}
