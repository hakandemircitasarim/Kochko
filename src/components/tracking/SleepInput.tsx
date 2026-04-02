/**
 * Sleep Input with Time Pickers
 * Spec 3.1: Yatis/kalkis saati + kalite
 * U4: Yatis saati ve kalkis saati girisi, toplam sure otomatik hesaplama
 */
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  currentHours: number | null;
  currentSleepTime?: string | null; // "HH:MM" format
  currentWakeTime?: string | null;  // "HH:MM" format
  onSave: (hours: number, quality: 'good' | 'ok' | 'bad', sleepTime?: string, wakeTime?: string) => void;
}

/**
 * Parse "HH:MM" string into { hour, minute }.
 */
function parseTime(timeStr: string): { hour: number; minute: number } | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Calculate sleep duration in hours from sleep_time and wake_time.
 * Handles overnight sleep (e.g., 23:00 -> 07:00 = 8 hours).
 */
function calculateDuration(sleepTime: string, wakeTime: string): number | null {
  const sleep = parseTime(sleepTime);
  const wake = parseTime(wakeTime);
  if (!sleep || !wake) return null;

  let sleepMinutes = sleep.hour * 60 + sleep.minute;
  let wakeMinutes = wake.hour * 60 + wake.minute;

  // If wake is earlier than sleep, it crossed midnight
  if (wakeMinutes <= sleepMinutes) {
    wakeMinutes += 24 * 60;
  }

  const durationMinutes = wakeMinutes - sleepMinutes;
  const durationHours = Math.round((durationMinutes / 60) * 10) / 10;

  // Sanity check: sleep duration should be between 0.5 and 18 hours
  if (durationHours < 0.5 || durationHours > 18) return null;
  return durationHours;
}

export function SleepInput({ currentHours, currentSleepTime, currentWakeTime, onSave }: Props) {
  const [sleepTime, setSleepTime] = useState(currentSleepTime ?? '');
  const [wakeTime, setWakeTime] = useState(currentWakeTime ?? '');
  const [hours, setHours] = useState(currentHours ? String(currentHours) : '');
  const [quality, setQuality] = useState<'good' | 'ok' | 'bad'>('ok');
  const [expanded, setExpanded] = useState(false);

  // U4: Auto-calculate duration when sleep_time or wake_time changes
  useEffect(() => {
    if (sleepTime && wakeTime) {
      const duration = calculateDuration(sleepTime, wakeTime);
      if (duration !== null) {
        setHours(String(duration));
      }
    }
  }, [sleepTime, wakeTime]);

  const handleSave = () => {
    const h = parseFloat(hours);
    if (h > 0 && h < 24) {
      onSave(
        h,
        quality,
        sleepTime || undefined,
        wakeTime || undefined,
      );
      setExpanded(false);
    }
  };

  if (!expanded) {
    return (
      <TouchableOpacity onPress={() => setExpanded(true)}
        style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Uyku</Text>
        <Text style={{ color: currentHours ? COLORS.text : COLORS.textMuted, fontSize: FONT.md, fontWeight: '600' }}>
          {currentHours ? `${currentHours} saat` : 'Kaydet'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* U4: Sleep time and wake time inputs */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Yatis saati"
            value={sleepTime}
            onChangeText={setSleepTime}
            placeholder="23:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Kalkis saati"
            value={wakeTime}
            onChangeText={setWakeTime}
            placeholder="07:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>

      {/* Duration - auto-calculated or manual entry */}
      <Input
        label="Toplam sure (saat)"
        value={hours}
        onChangeText={setHours}
        keyboardType="decimal-pad"
        placeholder="7.5"
      />
      {sleepTime && wakeTime && calculateDuration(sleepTime, wakeTime) !== null && (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: -4, marginBottom: SPACING.sm }}>
          Otomatik hesaplandi
        </Text>
      )}

      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xs }}>Kalite</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {(['good', 'ok', 'bad'] as const).map(q => (
          <TouchableOpacity key={q} onPress={() => setQuality(q)}
            style={{ flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center', borderWidth: 1,
              borderColor: quality === q ? COLORS.primary : COLORS.border,
              backgroundColor: quality === q ? COLORS.primary : 'transparent' }}>
            <Text style={{ color: quality === q ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>
              {q === 'good' ? 'Iyi' : q === 'ok' ? 'Orta' : 'Kotu'}
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
