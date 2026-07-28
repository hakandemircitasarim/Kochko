/**
 * Quick stat grid — 2x2 layout (su + adım / uyku + kilo)
 * Flat design, no gradients
 */
import React from 'react';
import { View, Text, TouchableOpacity, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';
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
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>{label}</Text>
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
      <Text numberOfLines={1} style={{ color: valueMuted ? colors.textMuted : color, fontSize: 16, fontWeight: '700' }}>{value}</Text>
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
export function StatStrip({ waterLiters, waterTarget, steps, sleepHours, weightKg, lastKnownWeightKg, onAddWater, onWaterLongPress, onWeightPress }: Props) {
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
          // FIX (final sweep): expo-sensors Pedometer is iOS-only. FIX (ux-audit major): the old
          // code hardcoded 'Yakında' on Android even when the user DID have step data (manually
          // logged / synced), so the cell was permanently dead on the platform we ship APKs for.
          // Show the real value whenever there is one (any platform); only fall back to the honest
          // muted 'Yakında' when Android genuinely has no step source yet.
          value={steps && steps > 0
            ? steps.toLocaleString('tr-TR')
            : Platform.OS === 'android' ? 'Yakında' : '-'}
          valueMuted={(!steps || steps <= 0) && Platform.OS === 'android'}
          a11yLabel={(!steps || steps <= 0) && Platform.OS === 'android' ? 'Adım sayımı yakında' : undefined}
          // Launch inventory: 'Yakında' used to be untappable — no way to learn WHAT is coming.
          {...((!steps || steps <= 0) && Platform.OS === 'android' ? {
            onPress: () => Alert.alert('Yakında', 'Adım sayımı Google Health Connect entegrasyonuyla çok yakında. Şimdilik adımlarını koça yazarak kaydedebilirsin.'),
            a11yHint: 'Ayrıntı için dokun',
          } : {})}
          label="Adım"
          color={METRIC_COLORS.steps}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <StatCard
          icon="moon"
          // FIX (audit UI-TAB-03) ham DB sayısını biçimlendir — diğer kartlarla tutarlı (DECIMAL(3,1) → 1 ondalık)
          // FIX (ux-pass5): TR ondalık virgül.
          value={sleepHours != null ? `${Number(sleepHours).toFixed(1).replace('.', ',')} sa` : '-'}
          label="Uyku"
          color={METRIC_COLORS.sleep}
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
