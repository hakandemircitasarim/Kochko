/**
 * IF (Intermittent Fasting) Timer Widget
 * Spec 2.1: IF penceresi dashboard göstergesi.
 * Shows eating window status, countdown to open/close.
 */
import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  eatingStart: string; // "12:00"
  eatingEnd: string;   // "20:00"
}

export function IFTimerWidget({ eatingStart, eatingEnd }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = eatingStart.split(':').map(Number);
  const [endH, endM] = eatingEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const isWindowOpen = currentMinutes >= startMinutes && currentMinutes < endMinutes;

  // Calculate time remaining
  let minutesRemaining: number;
  let nextEventLabel: string;
  if (isWindowOpen) {
    minutesRemaining = endMinutes - currentMinutes;
    nextEventLabel = 'Pencere kapanisina';
  } else if (currentMinutes < startMinutes) {
    minutesRemaining = startMinutes - currentMinutes;
    nextEventLabel = 'Pencere acilisina';
  } else {
    // After window close, calculate until next day's start
    minutesRemaining = (24 * 60 - currentMinutes) + startMinutes;
    nextEventLabel = 'Pencere acilisina';
  }

  const hoursLeft = Math.floor(minutesRemaining / 60);
  const minsLeft = minutesRemaining % 60;

  // Progress calculation
  const windowDuration = endMinutes - startMinutes;
  const fastDuration = 24 * 60 - windowDuration;
  const totalMinutes = isWindowOpen ? windowDuration : fastDuration;
  const elapsed = isWindowOpen
    ? currentMinutes - startMinutes
    : currentMinutes >= endMinutes
      ? currentMinutes - endMinutes
      : (24 * 60 - endMinutes) + currentMinutes;
  const progress = totalMinutes > 0 ? Math.min(1, elapsed / totalMinutes) : 0;

  return (
    <View style={{
      backgroundColor: isWindowOpen ? COLORS.success + '15' : COLORS.warning + '15',
      borderRadius: 12, padding: SPACING.md,
      borderWidth: 1, borderColor: isWindowOpen ? COLORS.success + '40' : COLORS.warning + '40',
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isWindowOpen ? COLORS.success : COLORS.warning }} />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>
            {isWindowOpen ? 'Yeme Penceresi Acik' : 'Oruc Donemi'}
          </Text>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
          {eatingStart} - {eatingEnd}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{
          height: '100%', width: `${progress * 100}%`,
          backgroundColor: isWindowOpen ? COLORS.success : COLORS.warning,
          borderRadius: 3,
        }} />
      </View>

      {/* Countdown */}
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, textAlign: 'center' }}>
        {nextEventLabel}: <Text style={{ fontWeight: '700' }}>{hoursLeft}sa {minsLeft}dk</Text>
      </Text>
    </View>
  );
}
