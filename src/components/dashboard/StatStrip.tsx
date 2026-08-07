/**
 * Quick stat grid — 2x2, BÖLÜM BAŞINA CANLI RENKLİ YASTIK KARTLAR (görsel dil §0-A).
 *
 * Önceki hâli tek nötr kart içinde dört gri hücreydi — referans dile (Yazio/Duolingo)
 * ters. Şimdi her metrik KENDİ dolgulu pastel kartında: su mavi, adım kehribar,
 * uyku mor, kilo pembe. Sayı hâlâ orada ama ikinci planda; her kartın altında kısa
 * bir TEŞVİK satırı var ("Yarıyı geçtin!") — "az sayı, çok teşvik".
 *
 * Kartlar artık gerçek KART: PressableCard ile basışta %2 küçülme (MOTION.pressScale
 * kuralı — büyük yüzeyde soldurma değil küçülme). Değer değiştiğinde küçük bir
 * "pop" (su ekleyince sayı zıplar) — ilk render'da oynamaz.
 *
 * İz (progress track) rengi hem KART DOLGUSUNDAN hem TEMADAN bağımsız seçildi
 * (koyuda beyaz-alfa, açıkta siyah-alfa) — DEVIR §0-A'daki iki kez düşülen tuzak.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, WATER_INCREMENT, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, alpha } from '@/lib/design';
import { getButtonA11yProps } from '@/lib/accessibility';
import { PressableCard } from '@/components/ui/PressableCard';
import { useReduceMotion } from '@/hooks/useReduceMotion';

interface Props {
  waterLiters: number;
  waterTarget: number;
  steps: number | null;
  sleepHours: number | null;
  weightKg: number | null;
  // FIX (ux-pass2 #4d): bugün tartı yoksa '-' yerine son bilinen profil kilosu (soluk).
  lastKnownWeightKg?: number | null;
  onAddWater: () => void;
  // FIX (ux-ideas #9): uzun basış → miktar seçici (250/500/750 ml) + geri al.
  onWaterLongPress?: () => void;
  onWeightPress?: () => void;
  onSleepPress?: () => void;
  onStepsPress?: () => void;
}

interface StatCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
  sublabel?: string;
  progress?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  a11yHint?: string;
  actionChip?: string;
  valueMuted?: boolean;
  a11yLabel?: string;
}

// Plaka/çip ön planı: dört metrik renginin DÖRDÜNDE de beyazdan yüksek kontrast
// veren maskot mürekkebi (adversarial review: beyaz, kehribarda 1,8:1 ve gülde
// 2,97:1 ile WCAG 3:1 grafik eşiğinin altındaydı; mürekkep mavi 4,9 / kehribar
// ~8 / gül 5,3 / mor 3,7). Çip METİNDİR (11px): mavide 4,9:1 ile AA'yı da geçer.
const PLATE_INK = '#2A2140';

function StatCard({ icon, value, label, color, sublabel, progress, onPress, onLongPress, a11yHint, actionChip, valueMuted, a11yLabel }: StatCardProps) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();

  // Değer değişince küçük pop — su ekleyince sayının "aldım" demesi. İlk render'da
  // sessiz: prev ref ilk turda boş. (Soğuk açılışta StatStrip'in yerini iskelet
  // aldığından, monte olduğunda veriler zaten gelmiştir — pop gerçek değişimlere kalır.)
  const scale = useRef(new Animated.Value(1)).current;
  const prevValue = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevValue.current;
    prevValue.current = value;
    if (prev == null || prev === value || reduceMotion) return;
    scale.setValue(1);
    const seq = Animated.sequence([
      Animated.timing(scale, { toValue: 1.12, duration: 120, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]);
    seq.start();
    return () => seq.stop();
  }, [value, reduceMotion, scale]);

  // Ekran okuyucu teşvik satırını ve 'Son bilinen' bağlamını da DUYMALI — dış
  // düğmenin açık accessibilityLabel'ı çocuk metinleri bastırır (adversarial review).
  const fullA11yLabel = a11yLabel ?? `${label}, ${value}${sublabel ? `, ${sublabel}` : ''}`;
  const a11yProps = onPress
    ? getButtonA11yProps(fullA11yLabel, a11yHint ?? 'Eklemek için dokun')
    : { accessibilityRole: 'text' as const, accessibilityLabel: fullA11yLabel };

  // Dolgu: metrik renginin pasteli. İz: dolgudan VE temadan bağımsız (§0-A tuzağı).
  const cardBg = alpha(color, isDark ? 0.18 : 0.13);
  const track = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';

  const inner = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            backgroundColor: color,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: SPACING.sm,
          }}
        >
          <Ionicons name={icon} size={16} color={PLATE_INK} />
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.callout, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 }} numberOfLines={1}>
          {label}
        </Text>
        {actionChip ? (
          <View style={{
            marginLeft: 'auto', backgroundColor: color,
            borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3,
          }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.footnote, color: PLATE_INK, fontWeight: '700' }}>{actionChip}</Text>
          </View>
        ) : null}
      </View>
      {/* FIX (audit UI-TAB-03) numberOfLines={1} — değer tek satırda kalsın, taşmayı kırpsın */}
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ ...TYPE.title3, color: valueMuted ? colors.textMuted : colors.text, transform: [{ scale }] }}
      >
        {value}
      </Animated.Text>
      {sublabel ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
      {progress !== undefined && (
        <View style={{ height: 6, backgroundColor: track, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.sm }}>
          <View style={{ height: '100%', width: `${Math.min(100, progress * 100)}%`, backgroundColor: color, borderRadius: 3 }} />
        </View>
      )}
    </>
  );

  const cardStyle = {
    flex: 1,
    backgroundColor: cardBg,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  } as const;

  if (!onPress) {
    return <View {...a11yProps} style={cardStyle}>{inner}</View>;
  }
  return (
    <PressableCard onPress={onPress} onLongPress={onLongPress} {...a11yProps} style={cardStyle}>
      {inner}
    </PressableCard>
  );
}

/* ── Teşvik satırları — deterministik, kısa, dürüst. Sayının yerine değil YANINA. ── */

function waterCheer(pct: number, hasTarget: boolean): string {
  if (!hasTarget) return 'Dokun, bir bardak ekle';
  if (pct >= 1) return 'Hedef tamam, süpersin!';
  if (pct >= 0.5) return 'Yarıyı geçtin!';
  if (pct > 0) return 'Güzel başladın';
  return 'İlk bardakla başla';
}

function stepsCheer(steps: number | null): string {
  if (!steps || steps <= 0) return 'Bugünü ekle';
  if (steps >= 10000) return 'Bugün uçmuşsun!';
  if (steps >= 6000) return 'Çok iyi gidiyorsun';
  return 'Her adım sayılır';
}

function sleepCheer(hours: number | null): string {
  if (hours == null) return 'Dün geceyi ekle';
  if (hours >= 7 && hours <= 9.5) return 'Dinlenmişsin, süper';
  if (hours < 6) return 'Bu gece biraz erken yat';
  if (hours < 7) return 'Fena değil — biraz daha iyi olur';
  return 'Bol bol dinlenmişsin';
}

// FIX (audit: ölü prop) sleepHours/weightKg artık imzada destructure edilip
// 2x2 grid'de render ediliyor (eskiden tanımlı ama hiç gösterilmiyordu).
export function StatStrip({ waterLiters, waterTarget, steps, sleepHours, weightKg, lastKnownWeightKg, onAddWater, onWaterLongPress, onWeightPress, onSleepPress, onStepsPress }: Props) {
  const waterPct = waterTarget > 0 ? waterLiters / waterTarget : 0;
  const noWeighInToday = weightKg == null && lastKnownWeightKg != null;

  return (
    <View style={{ paddingHorizontal: SPACING.xl, gap: SPACING.md }}>
      <View style={{ flexDirection: 'row', gap: SPACING.md }}>
        <StatCard
          icon="water"
          // FIX (ux-pass5): TR ondalık — toFixed her zaman '.' basar; koç/servis yüzeyleri
          // (plateau, goals, widget) ',' kullanıyor. Aynı ekranda '1.5L' / chat'te '1,5L' olmaz.
          value={waterTarget > 0 ? `${waterLiters.toFixed(1).replace('.', ',')} / ${waterTarget.toFixed(1).replace('.', ',')} L` : `${waterLiters.toFixed(1).replace('.', ',')} L`}
          label="Su"
          color={METRIC_COLORS.water}
          sublabel={waterCheer(waterPct, waterTarget > 0)}
          progress={waterTarget > 0 ? waterPct : undefined}
          onPress={onAddWater}
          onLongPress={onWaterLongPress}
          a11yHint={`Dokunuş ${Math.round(WATER_INCREMENT * 1000)} mililitre ekler, farklı miktar için basılı tut`}
          actionChip={`+${Math.round(WATER_INCREMENT * 1000)} ml`}
        />
        <StatCard
          icon="footsteps"
          // expo-sensors Pedometer'ın gün-toplamı okuması iOS'a özel; Android'de otomatik
          // ölçüm yok — dokunuş elle adım kaydına gider, veri geldiğinde gerçek sayı görünür.
          value={steps && steps > 0 ? steps.toLocaleString('tr-TR') : 'Ekle'}
          valueMuted={!steps || steps <= 0}
          label="Adım"
          color={METRIC_COLORS.steps}
          sublabel={stepsCheer(steps)}
          onPress={onStepsPress}
          a11yHint="Adım kaydı girmek için dokun"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.md }}>
        <StatCard
          icon="moon"
          // FIX (audit UI-TAB-03) ham DB sayısını biçimlendir (DECIMAL(3,1) → 1 ondalık)
          // FIX (ux-pass5): TR ondalık virgül.
          value={sleepHours != null ? `${Number(sleepHours).toFixed(1).replace('.', ',')} sa` : 'Ekle'}
          valueMuted={sleepHours == null}
          label="Uyku"
          color={METRIC_COLORS.sleep}
          sublabel={sleepCheer(sleepHours != null ? Number(sleepHours) : null)}
          onPress={onSleepPress}
          a11yHint="Uyku kaydı girmek için dokun"
        />
        <StatCard
          icon="scale"
          // FIX (ux-pass2 #4d): bugün tartı yoksa '-' yerine son bilinen kilo, soluk.
          // FIX (ux-pass5): TR ondalık virgül.
          value={weightKg != null
            ? `${Number(weightKg).toFixed(1).replace('.', ',')} kg`
            : noWeighInToday ? `${Number(lastKnownWeightKg).toFixed(1).replace('.', ',')} kg` : '-'}
          valueMuted={noWeighInToday}
          sublabel={weightKg != null ? 'Bugün tartıldın' : noWeighInToday ? 'Son bilinen' : 'Tartını ekle'}
          label="Kilo"
          color={METRIC_COLORS.weight}
          onPress={onWeightPress}
          a11yHint="Tartı kaydı girmek için dokun"
        />
      </View>
    </View>
  );
}
