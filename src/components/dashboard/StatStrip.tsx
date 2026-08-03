/**
 * Quick stat grid — 2x2 layout (su + adım / uyku + kilo)
 * Flat design, no gradients
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { getButtonA11yProps } from '@/lib/accessibility';

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
  // FIX (ux-pass2 #4a): Kilo kartı Tartı Kaydı modalını açar (ölü modal canlandı).
  onWeightPress?: () => void;
  /** ux-defect pass: Uyku hücresi griddeki tek ÖLÜ hücreydi — dokununca uyku kaydına gider. */
  onSleepPress?: () => void;
  /** Adım hücresi Android'de "Yakında" Alert'inden ibaretti — artık elle adım kaydını açar. */
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
  // FIX (ux-pass2 #8b): görünür eylem rozeti (ör. '+250 ml') — dokunma eylemi
  // eskiden yalnız ekran okuyucuya görünürdü.
  actionChip?: string;
  valueMuted?: boolean;
  // FIX (final sweep): opt-out of the default "label, value" screen-reader text
  // (e.g. 'Adım sayımı yakında' instead of 'Adım, Yakında').
  a11yLabel?: string;
}

function StatCard({ icon, value, label, color, sublabel, progress, onPress, onLongPress, a11yHint, actionChip, valueMuted, a11yLabel }: StatCardProps) {
  const { colors } = useTheme();
  const Wrapper = onPress ? TouchableOpacity : View;
  const a11yProps = onPress
    ? getButtonA11yProps(a11yLabel ?? `${label}, ${value}`, a11yHint ?? 'Eklemek için dokun')
    : { accessibilityRole: 'text' as const, accessibilityLabel: a11yLabel ?? `${label}, ${value}` };

  return (
    <Wrapper
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
      {...(onPress && onLongPress ? { onLongPress } : {})}
      {...a11yProps}
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: color + '22',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: SPACING.xs,
          }}
        >
          <Ionicons name={icon} size={14} color={color} />
        </View>
        <Text style={{ ...TYPE.callout, color: colors.textSecondary }}>{label}</Text>
        {actionChip ? (
          <View style={{
            marginLeft: 'auto', backgroundColor: color + '22',
            borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2,
          }}>
            <Text style={{ color, fontSize: 10, fontWeight: '700' }}>{actionChip}</Text>
          </View>
        ) : null}
      </View>
      {/* FIX (audit UI-TAB-03) numberOfLines={1} — değer hücresi tek satırda kalsın, taşmayı kırpsın */}
      {/* Each of these cards exists to show ONE figure — litres of water, kilos, hours slept. At 16px
          that figure was the same weight as the label above it, so the card had no focal point and
          the grid read as an undifferentiated block of text on a device. TYPE.title3 gives each card
          something the eye lands on. numberOfLines={1} already guards the long-value case. */}
      <Text numberOfLines={1} style={{ ...TYPE.title3, color: valueMuted ? colors.textMuted : color }}>{value}</Text>
      {sublabel && <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{sublabel}</Text>}
      {progress !== undefined && (
        <View style={{ height: 4, backgroundColor: colors.progressTrack, borderRadius: 2, overflow: 'hidden', marginTop: SPACING.sm }}>
          <View style={{ height: '100%', width: `${Math.min(100, progress * 100)}%`, backgroundColor: color, borderRadius: 2 }} />
        </View>
      )}
    </Wrapper>
  );
}

// FIX (audit: ölü prop) sleepHours/weightKg artık imzada destructure edilip
// 2x2 grid'de render ediliyor (eskiden tanımlı ama hiç gösterilmiyordu).
export function StatStrip({ waterLiters, waterTarget, steps, sleepHours, weightKg, lastKnownWeightKg, onAddWater, onWaterLongPress, onWeightPress, onSleepPress, onStepsPress }: Props) {
  const waterPct = waterTarget > 0 ? waterLiters / waterTarget : 0;
  const noWeighInToday = weightKg == null && lastKnownWeightKg != null;

  return (
    <View style={{ paddingHorizontal: SPACING.xl, gap: SPACING.sm }}>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <StatCard
          icon="water"
          // FIX (ux-pass5): TR ondalık — toFixed her zaman '.' basar; koç/servis yüzeyleri
          // (plateau, goals, widget) ',' kullanıyor. Aynı ekranda '1.5L' / chat'te '1,5L' olmaz.
          value={waterTarget > 0 ? `${waterLiters.toFixed(1).replace('.', ',')} / ${waterTarget.toFixed(1).replace('.', ',')} L` : `${waterLiters.toFixed(1).replace('.', ',')} L`}
          label="Su"
          color={METRIC_COLORS.water}
          progress={waterTarget > 0 ? waterPct : undefined}
          onPress={onAddWater}
          onLongPress={onWaterLongPress}
          a11yHint="Su eklemek için dokun, farklı miktar için basılı tut"
          actionChip={`+${Math.round(WATER_INCREMENT * 1000)} ml`}
        />
        <StatCard
          icon="footsteps"
          // expo-sensors Pedometer'ın gün-toplamı okuması (getStepCountAsync) iOS'a özel, yani
          // Android'de otomatik ölçüm YOK. Bu hücre eskiden dokunulunca yalnızca "Yakında" diyen
          // bir Alert açıyordu — griddeki tek çıkmaz sokak. Artık komşularıyla (Su/Uyku/Kilo) aynı:
          // dokunuş elle adım kaydına gider, veri geldiğinde gerçek sayı görünür.
          value={steps && steps > 0 ? steps.toLocaleString('tr-TR') : 'Ekle'}
          valueMuted={!steps || steps <= 0}
          label="Adım"
          color={METRIC_COLORS.steps}
          onPress={onStepsPress}
          a11yHint="Adım kaydı girmek için dokun"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <StatCard
          icon="moon"
          // FIX (audit UI-TAB-03) ham DB sayısını biçimlendir — diğer kartlarla tutarlı (DECIMAL(3,1) → 1 ondalık)
          // FIX (ux-pass5): TR ondalık virgül.
          // ux-defect pass: veri yokken çıplak '-' + dokunulamaz tek hücreydi (komşuların hepsi
          // aksiyonlu). Boş durumda 'Ekle' daveti, her durumda uyku kaydına dokunuş.
          value={sleepHours != null ? `${Number(sleepHours).toFixed(1).replace('.', ',')} sa` : 'Ekle'}
          valueMuted={sleepHours == null}
          label="Uyku"
          color={METRIC_COLORS.sleep}
          onPress={onSleepPress}
          a11yHint="Uyku kaydı girmek için dokun"
        />
        <StatCard
          icon="scale"
          // FIX (audit UI-TAB-03) ham DB sayısını biçimlendir — diğer kartlarla tutarlı (DECIMAL(5,2) → 1 ondalık)
          // FIX (ux-pass2 #4d): bugün tartı yoksa '-' yerine son bilinen kilo, soluk + 'son bilinen' notuyla.
          // FIX (ux-pass5): TR ondalık virgül.
          value={weightKg != null
            ? `${Number(weightKg).toFixed(1).replace('.', ',')} kg`
            : noWeighInToday ? `${Number(lastKnownWeightKg).toFixed(1).replace('.', ',')} kg` : '-'}
          valueMuted={noWeighInToday}
          sublabel={noWeighInToday ? 'son bilinen' : undefined}
          label="Kilo"
          color={METRIC_COLORS.weight}
          onPress={onWeightPress}
          a11yHint="Tartı kaydı girmek için dokun"
        />
      </View>
    </View>
  );
}
