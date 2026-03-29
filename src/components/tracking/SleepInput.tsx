/**
 * Sleep Input — Spec 3.1
 * Expandable card for logging sleep hours and quality.
 * Shows: current value, quality emoji, recommendation based on hours.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT, RADIUS, TOUCH_TARGET } from '@/lib/constants';

interface Props {
  currentHours: number | null;
  currentQuality?: string | null;
  onSave: (hours: number, quality: 'good' | 'ok' | 'bad') => void;
}

const QUALITY_OPTIONS = [
  { value: 'good' as const, label: 'Iyi', emoji: '😊', color: COLORS.success },
  { value: 'ok' as const, label: 'Orta', emoji: '😐', color: COLORS.warning },
  { value: 'bad' as const, label: 'Kotu', emoji: '😴', color: COLORS.error },
];

function getSleepMessage(hours: number): { message: string; color: string } {
  if (hours >= 7 && hours <= 9) return { message: 'Ideal uyku suresi', color: COLORS.success };
  if (hours >= 6) return { message: 'Biraz kisa ama idare eder', color: COLORS.warning };
  if (hours < 6) return { message: 'Cok az — metabolizma ve kilo verme etkilenir', color: COLORS.error };
  if (hours > 9) return { message: 'Cok uzun — kaliteye dikkat et', color: COLORS.warning };
  return { message: '', color: COLORS.textMuted };
}

export function SleepInput({ currentHours, currentQuality, onSave }: Props) {
  const [hours, setHours] = useState(currentHours ? String(currentHours) : '');
  const [quality, setQuality] = useState<'good' | 'ok' | 'bad'>((currentQuality as 'good' | 'ok' | 'bad') ?? 'ok');
  const [expanded, setExpanded] = useState(false);

  const handleSave = () => {
    const h = parseFloat(hours);
    if (h > 0 && h < 24) {
      onSave(h, quality);
      setExpanded(false);
    }
  };

  const currentEmoji = currentQuality ? QUALITY_OPTIONS.find(q => q.value === currentQuality)?.emoji ?? '' : '';

  // Collapsed view
  if (!expanded) {
    return (
      <TouchableOpacity onPress={() => setExpanded(true)}
        style={{
          backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md,
          borderWidth: 1, borderColor: COLORS.border,
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          minHeight: TOUCH_TARGET,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <Text style={{ fontSize: 18 }}>😴</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Uyku</Text>
        </View>
        {currentHours ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700' }}>{currentHours} sa</Text>
            {currentEmoji ? <Text style={{ fontSize: 16 }}>{currentEmoji}</Text> : null}
          </View>
        ) : (
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
        )}
      </TouchableOpacity>
    );
  }

  // Expanded form
  const parsedH = parseFloat(hours);
  const sleepMsg = parsedH > 0 ? getSleepMessage(parsedH) : null;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.borderFocus }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm }}>
        <Text style={{ fontSize: 18 }}>😴</Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>Uyku Kaydi</Text>
      </View>

      <Input
        label="Kac saat uyudun?"
        value={hours}
        onChangeText={setHours}
        keyboardType="decimal-pad"
        placeholder="7.5"
        suffix="saat"
      />

      {/* Sleep quality feedback */}
      {sleepMsg && (
        <Text style={{ color: sleepMsg.color, fontSize: FONT.xs, marginBottom: SPACING.sm }}>{sleepMsg.message}</Text>
      )}

      {/* Quality selection */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xs }}>Uyku kalitesi</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {QUALITY_OPTIONS.map(q => (
          <TouchableOpacity key={q.value} onPress={() => setQuality(q.value)}
            style={{
              flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm,
              alignItems: 'center', minHeight: TOUCH_TARGET,
              justifyContent: 'center',
              borderWidth: quality === q.value ? 2 : 1,
              borderColor: quality === q.value ? q.color : COLORS.border,
              backgroundColor: quality === q.value ? q.color + '15' : 'transparent',
            }}>
            <Text style={{ fontSize: 20, marginBottom: 2 }}>{q.emoji}</Text>
            <Text style={{ color: quality === q.value ? q.color : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: quality === q.value ? '700' : '400' }}>
              {q.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <Button title="Kaydet" size="sm" onPress={handleSave} style={{ flex: 1 }} />
        <Button title="Iptal" size="sm" variant="ghost" onPress={() => setExpanded(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
