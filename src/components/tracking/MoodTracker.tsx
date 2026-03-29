/**
 * Mood Tracker — Spec 3.1: Stres/ruh hali kaydı (1-5 skala)
 * Shows emoji-based mood selection with color feedback.
 * Displays yesterday's mood for comparison (trend indicator).
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, TOUCH_TARGET } from '@/lib/constants';

interface Props {
  currentScore: number | null;
  yesterdayScore?: number | null;
  onSelect: (score: number) => void;
}

const MOODS = [
  { score: 1, emoji: '😞', label: 'Cok Kotu', color: '#F44336' },
  { score: 2, emoji: '😕', label: 'Kotu', color: '#FF9800' },
  { score: 3, emoji: '😐', label: 'Normal', color: '#FFC107' },
  { score: 4, emoji: '🙂', label: 'Iyi', color: '#8BC34A' },
  { score: 5, emoji: '😄', label: 'Harika', color: '#4CAF50' },
];

export function MoodTracker({ currentScore, yesterdayScore, onSelect }: Props) {
  const trend = currentScore && yesterdayScore
    ? currentScore > yesterdayScore ? 'up' : currentScore < yesterdayScore ? 'down' : 'same'
    : null;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Nasil hissediyorsun?</Text>
        {trend && (
          <Text style={{ color: trend === 'up' ? COLORS.success : trend === 'down' ? COLORS.error : COLORS.textMuted, fontSize: FONT.xs }}>
            {trend === 'up' ? '↑ Dune gore iyi' : trend === 'down' ? '↓ Dune gore dusuk' : '= Ayni'}
          </Text>
        )}
      </View>

      {/* Mood buttons */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {MOODS.map(m => {
          const isSelected = currentScore === m.score;
          return (
            <TouchableOpacity
              key={m.score}
              onPress={() => onSelect(m.score)}
              style={{ alignItems: 'center', flex: 1 }}
              accessibilityLabel={`Mood ${m.score}: ${m.label}`}
              accessibilityRole="button"
            >
              <View style={{
                width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: TOUCH_TARGET / 2,
                backgroundColor: isSelected ? m.color + '30' : COLORS.surfaceLight,
                justifyContent: 'center', alignItems: 'center',
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? m.color : COLORS.border,
              }}>
                <Text style={{ fontSize: 20 }}>{m.emoji}</Text>
              </View>
              <Text style={{
                color: isSelected ? m.color : COLORS.textMuted,
                fontSize: 9, marginTop: SPACING.xxs, fontWeight: isSelected ? '600' : '400',
              }}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected feedback */}
      {currentScore && (
        <View style={{ marginTop: SPACING.sm, alignItems: 'center' }}>
          <Text style={{ color: MOODS[currentScore - 1].color, fontSize: FONT.xs, fontWeight: '500' }}>
            {MOODS[currentScore - 1].label} — kaydedildi
          </Text>
        </View>
      )}
    </View>
  );
}
