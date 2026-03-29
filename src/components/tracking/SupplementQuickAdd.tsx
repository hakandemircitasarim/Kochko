/**
 * Supplement Quick Add — Spec 3.1
 * One-tap supplement logging with common presets.
 * Shows today's logged supplements below presets.
 */
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { logSupplement, getTodaySupplements, type SupplementLog } from '@/services/supplements.service';
import { COLORS, SPACING, FONT, RADIUS, TOUCH_TARGET } from '@/lib/constants';

const PRESETS = [
  { key: 'protein tozu', label: 'Protein', amount: '1 olcu', emoji: '💪' },
  { key: 'kreatin', label: 'Kreatin', amount: '5g', emoji: '⚡' },
  { key: 'omega-3', label: 'Omega-3', amount: '1 kapsul', emoji: '🐟' },
  { key: 'd vitamini', label: 'D Vit', amount: '1 tablet', emoji: '☀️' },
  { key: 'multivitamin', label: 'Multi', amount: '1 tablet', emoji: '💊' },
];

interface Props {
  onLogged?: () => void;
}

export function SupplementQuickAdd({ onLogged }: Props) {
  const [todayLogs, setTodayLogs] = useState<SupplementLog[]>([]);
  const [logging, setLogging] = useState<string | null>(null);

  useEffect(() => { getTodaySupplements().then(setTodayLogs); }, []);

  const handleLog = async (preset: typeof PRESETS[0]) => {
    setLogging(preset.key);
    const result = await logSupplement(preset.key, preset.amount);
    setLogging(null);
    setTodayLogs(await getTodaySupplements());
    onLogged?.();

    if (result.calories > 0) {
      Alert.alert('Kaydedildi', `${preset.label} — ${result.calories} kcal, ${result.protein_g}g protein eklendi.`);
    }
  };

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>
        Hizli Takviye
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: todayLogs.length > 0 ? SPACING.sm : 0 }}>
        {PRESETS.map(p => (
          <TouchableOpacity
            key={p.key}
            onPress={() => handleLog(p)}
            disabled={logging === p.key}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs,
              paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
              borderRadius: RADIUS.sm, backgroundColor: COLORS.surfaceLight,
              borderWidth: 1, borderColor: COLORS.border, minHeight: TOUCH_TARGET - 8,
              opacity: logging === p.key ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 14 }}>{p.emoji}</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {todayLogs.length > 0 && (
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.xs }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.xxs }}>
            Bugun alinan ({todayLogs.length}):
          </Text>
          {todayLogs.map((log, i) => (
            <View key={log.id ?? i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{log.supplement_name} {log.amount}</Text>
              {(log.calories ?? 0) > 0 && <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>{log.calories} kcal</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
