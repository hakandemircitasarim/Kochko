/**
 * Quick Mood Tracker
 * Spec 3.1: Stres/ruh hali kaydı (1-5 skala)
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  currentScore: number | null;
  onSelect: (score: number) => void;
}

const MOODS = [
  { score: 1, label: 'Cok Kotu' },
  { score: 2, label: 'Kotu' },
  { score: 3, label: 'Normal' },
  { score: 4, label: 'Iyi' },
  { score: 5, label: 'Harika' },
];

export function MoodTracker({ currentScore, onSelect }: Props) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Nasil hissediyorsun?</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {MOODS.map(m => (
          <TouchableOpacity key={m.score} onPress={() => onSelect(m.score)} style={{ alignItems: 'center', flex: 1 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: currentScore === m.score ? COLORS.primary : COLORS.surfaceLight,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: 1, borderColor: currentScore === m.score ? COLORS.primary : COLORS.border,
            }}>
              <Text style={{ color: currentScore === m.score ? '#fff' : COLORS.textMuted, fontSize: FONT.md, fontWeight: '700' }}>{m.score}</Text>
            </View>
            <Text style={{ color: currentScore === m.score ? COLORS.primary : COLORS.textMuted, fontSize: 9, marginTop: 2 }}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
