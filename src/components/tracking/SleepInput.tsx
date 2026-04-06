/**
 * Sleep Input - Modern card design with purple accent
 * Spec 3.1: Yatis/kalkis saati + kalite
 */
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props {
  currentHours: number | null;
  currentSleepTime?: string | null;
  currentWakeTime?: string | null;
  onSave: (hours: number, quality: 'good' | 'ok' | 'bad', sleepTime?: string, wakeTime?: string) => void;
  compact?: boolean;
}

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function calculateDuration(sleepTime: string, wakeTime: string): number | null {
  const sleep = parseTime(sleepTime);
  const wake = parseTime(wakeTime);
  if (!sleep || !wake) return null;
  let sleepMinutes = sleep.hour * 60 + sleep.minute;
  let wakeMinutes = wake.hour * 60 + wake.minute;
  if (wakeMinutes <= sleepMinutes) wakeMinutes += 24 * 60;
  const durationHours = Math.round(((wakeMinutes - sleepMinutes) / 60) * 10) / 10;
  if (durationHours < 0.5 || durationHours > 18) return null;
  return durationHours;
}

const QUALITY_OPTIONS = [
  { key: 'good' as const, label: 'İyi', emoji: '\uD83D\uDE34', color: '#22C55E' },
  { key: 'ok' as const, label: 'Orta', emoji: '\uD83D\uDE36', color: '#F59E0B' },
  { key: 'bad' as const, label: 'Kötü', emoji: '\uD83D\uDE29', color: '#EF4444' },
];

export function SleepInput({ currentHours, currentSleepTime, currentWakeTime, onSave, compact }: Props) {
  const { colors, isDark } = useTheme();
  const [sleepTime, setSleepTime] = useState(currentSleepTime ?? '');
  const [wakeTime, setWakeTime] = useState(currentWakeTime ?? '');
  const [hours, setHours] = useState(currentHours ? String(currentHours) : '');
  const [quality, setQuality] = useState<'good' | 'ok' | 'bad'>('ok');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (sleepTime && wakeTime) {
      const duration = calculateDuration(sleepTime, wakeTime);
      if (duration !== null) setHours(String(duration));
    }
  }, [sleepTime, wakeTime]);

  const handleSave = () => {
    const h = parseFloat(hours);
    if (h > 0 && h < 24) {
      onSave(h, quality, sleepTime || undefined, wakeTime || undefined);
      setExpanded(false);
    }
  };

  if (compact && !expanded) {
    return (
      <TouchableOpacity
        onPress={() => setExpanded(true)}
        activeOpacity={0.7}
        style={{
          flex: 1, backgroundColor: colors.card, borderRadius: RADIUS.md,
          padding: SPACING.sm + 2, alignItems: 'center',
          borderWidth: 0.5, borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>Uyku</Text>
        <View style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: METRIC_COLORS.sleep + '20',
          alignItems: 'center', justifyContent: 'center', marginBottom: 4,
        }}>
          <Ionicons name="moon" size={20} color={METRIC_COLORS.sleep} />
        </View>
        <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: currentHours ? METRIC_COLORS.sleep : colors.textMuted }}>
          {currentHours ? `${currentHours}h` : '-'}
        </Text>
      </TouchableOpacity>
    );
  }

  if (!expanded) {
    return (
      <TouchableOpacity
        onPress={() => setExpanded(true)}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.card,
          borderRadius: RADIUS.md,
          padding: SPACING.md,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderWidth: 0.5, borderColor: colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{
            width: 44, height: 44, borderRadius: 14,
            backgroundColor: METRIC_COLORS.sleep + '20',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="moon" size={22} color={METRIC_COLORS.sleep} />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>Uyku</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              {currentHours ? `${currentHours} saat kaydedildi` : 'Kaydetmek için dokun'}
            </Text>
          </View>
        </View>
        {currentHours ? (
          <Text style={{ color: METRIC_COLORS.sleep, fontSize: FONT.xl, fontWeight: '800' }}>{currentHours}h</Text>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 0.5, borderColor: colors.border,
    }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          backgroundColor: METRIC_COLORS.sleep + '20',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="moon" size={22} color={METRIC_COLORS.sleep} />
        </View>
        <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '700' }}>Uyku Kaydı</Text>
      </View>

      {/* Time inputs */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xs }}>
        <View style={{ flex: 1 }}>
          <Input label="Yatış" value={sleepTime} onChangeText={setSleepTime} placeholder="23:00" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label="Kalkış" value={wakeTime} onChangeText={setWakeTime} placeholder="07:00" keyboardType="numbers-and-punctuation" />
        </View>
      </View>

      <Input label="Toplam süre (saat)" value={hours} onChangeText={setHours} keyboardType="decimal-pad" placeholder="7.5" />
      {sleepTime && wakeTime && calculateDuration(sleepTime, wakeTime) !== null && (
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: -SPACING.sm, marginBottom: SPACING.sm }}>
          Otomatik hesaplandı
        </Text>
      )}

      {/* Quality selector */}
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.sm }}>Kalite</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {QUALITY_OPTIONS.map(q => {
          const isSelected = quality === q.key;
          return (
            <TouchableOpacity
              key={q.key}
              onPress={() => setQuality(q.key)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                paddingVertical: SPACING.sm,
                borderRadius: RADIUS.md,
                alignItems: 'center',
                backgroundColor: isSelected ? q.color + '18' : colors.surfaceLight,
                borderWidth: isSelected ? 1.5 : 0,
                borderColor: isSelected ? q.color : 'transparent',
              }}
            >
              <Text style={{ fontSize: 20, marginBottom: 2 }}>{q.emoji}</Text>
              <Text style={{
                color: isSelected ? q.color : colors.textSecondary,
                fontSize: FONT.sm,
                fontWeight: isSelected ? '700' : '500',
              }}>
                {q.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <Button title="Kaydet" size="sm" onPress={handleSave} style={{ flex: 1 }} />
        <Button title="İptal" size="sm" variant="ghost" onPress={() => setExpanded(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
