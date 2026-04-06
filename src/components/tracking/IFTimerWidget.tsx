/**
 * IF (Intermittent Fasting) Timer Widget - Modern design
 * Spec 2.1: IF penceresi dashboard göstergesi.
 */
import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Props {
  eatingStart: string;
  eatingEnd: string;
}

export function IFTimerWidget({ eatingStart, eatingEnd }: Props) {
  const { colors, isDark } = useTheme();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = eatingStart.split(':').map(Number);
  const [endH, endM] = eatingEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const isWindowOpen = currentMinutes >= startMinutes && currentMinutes < endMinutes;

  let minutesRemaining: number;
  let nextEventLabel: string;
  if (isWindowOpen) {
    minutesRemaining = endMinutes - currentMinutes;
    nextEventLabel = 'Pencere kapanışına';
  } else if (currentMinutes < startMinutes) {
    minutesRemaining = startMinutes - currentMinutes;
    nextEventLabel = 'Pencere açılışına';
  } else {
    minutesRemaining = (24 * 60 - currentMinutes) + startMinutes;
    nextEventLabel = 'Pencere açılışına';
  }

  const hoursLeft = Math.floor(minutesRemaining / 60);
  const minsLeft = minutesRemaining % 60;

  const windowDuration = endMinutes - startMinutes;
  const fastDuration = 24 * 60 - windowDuration;
  const totalMinutes = isWindowOpen ? windowDuration : fastDuration;
  const elapsed = isWindowOpen
    ? currentMinutes - startMinutes
    : currentMinutes >= endMinutes
      ? currentMinutes - endMinutes
      : (24 * 60 - endMinutes) + currentMinutes;
  const progress = totalMinutes > 0 ? Math.min(1, elapsed / totalMinutes) : 0;

  const statusColor = isWindowOpen ? colors.success : '#F59E0B';
  const statusIcon = isWindowOpen ? 'restaurant' : 'timer';

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.xxl,
      padding: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm + 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: statusColor + '18',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name={statusIcon as any} size={20} color={statusColor} />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
              {isWindowOpen ? 'Yeme Penceresi' : 'Oruç Dönemi'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              {eatingStart} - {eatingEnd}
            </Text>
          </View>
        </View>
        <View style={{
          backgroundColor: statusColor + '18',
          borderRadius: RADIUS.full,
          paddingHorizontal: SPACING.sm + 2,
          paddingVertical: 3,
        }}>
          <Text style={{ color: statusColor, fontSize: FONT.xs, fontWeight: '700' }}>
            {isWindowOpen ? 'Açık' : 'Kapalı'}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{
        height: 8,
        backgroundColor: colors.surfaceLight,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: SPACING.sm,
      }}>
        <View style={{
          height: '100%',
          width: `${progress * 100}%`,
          backgroundColor: statusColor,
          borderRadius: 4,
        }} />
      </View>

      {/* Countdown */}
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>
        {nextEventLabel}: <Text style={{ fontWeight: '800', color: colors.text }}>{hoursLeft}sa {minsLeft}dk</Text>
      </Text>
    </View>
  );
}
