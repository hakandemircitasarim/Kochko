/**
 * Recovery Input Component
 * Spec 3.1: Toparlanma/recovery kaydı - kas ağrısı ve toparlanma hissi.
 * Only shown for users with strength/mixed training style.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  muscleSoreness: number | null;
  recoveryScore: number | null;
  onSave: (soreness: number, recovery: number) => void;
}

const SORENESS_LEVELS = [
  { value: 1, label: 'Yok', dbValue: 'none' as const },
  { value: 2, label: 'Hafif', dbValue: 'light' as const },
  { value: 3, label: 'Orta', dbValue: 'moderate' as const },
  { value: 4, label: 'Siddetli', dbValue: 'severe' as const },
];

export type MuscleSorenessText = 'none' | 'light' | 'moderate' | 'severe';

/** Map numeric soreness to DB text value */
export function sorenessToDb(value: number): MuscleSorenessText {
  return SORENESS_LEVELS.find(s => s.value === value)?.dbValue ?? 'none';
}

/** Map DB text value to numeric soreness */
export function sorenessFromDb(dbValue: string): number {
  return SORENESS_LEVELS.find(s => s.dbValue === dbValue)?.value ?? 1;
}

const RECOVERY_LEVELS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
];

export function RecoveryInput({ muscleSoreness, recoveryScore, onSave }: Props) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Toparlanma</Text>

      {/* Muscle Soreness */}
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: 4 }}>Kas agrisi</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        {SORENESS_LEVELS.map(s => (
          <TouchableOpacity key={s.value} onPress={() => onSave(s.value, recoveryScore ?? 3)}
            style={{ alignItems: 'center', flex: 1 }}>
            <View style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: muscleSoreness === s.value ? COLORS.warning : COLORS.surfaceLight,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ color: muscleSoreness === s.value ? '#fff' : COLORS.textMuted, fontSize: FONT.xs, fontWeight: '700' }}>{s.value}</Text>
            </View>
            <Text style={{ color: COLORS.textMuted, fontSize: 8, marginTop: 2 }}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recovery Score */}
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: 4 }}>Genel toparlanma</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {RECOVERY_LEVELS.map(r => (
          <TouchableOpacity key={r.value} onPress={() => onSave(muscleSoreness ?? 1, r.value)}
            style={{ alignItems: 'center', flex: 1 }}>
            <View style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: recoveryScore === r.value ? COLORS.success : COLORS.surfaceLight,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ color: recoveryScore === r.value ? '#fff' : COLORS.textMuted, fontSize: FONT.xs, fontWeight: '700' }}>{r.label}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
