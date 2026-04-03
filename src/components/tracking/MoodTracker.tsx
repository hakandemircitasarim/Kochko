/**
 * Quick Mood Tracker with optional stress note
 * Spec 3.1: Stres/ruh hali kaydı (1-5 skala + opsiyonel not)
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  currentScore: number | null;
  onSelect: (score: number, stressNote?: string) => void;
}

const MOODS = [
  { score: 1, label: 'Cok Kotu' },
  { score: 2, label: 'Kotu' },
  { score: 3, label: 'Normal' },
  { score: 4, label: 'Iyi' },
  { score: 5, label: 'Harika' },
];

export function MoodTracker({ currentScore, onSelect }: Props) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [selectedScore, setSelectedScore] = useState<number | null>(null);

  const handleSelect = (score: number) => {
    setSelectedScore(score);
    if (score <= 2) {
      // Low mood: show stress note option
      setShowNote(true);
    } else {
      onSelect(score);
    }
  };

  const handleSubmitWithNote = () => {
    if (selectedScore) {
      onSelect(selectedScore, note.trim() || undefined);
      setShowNote(false);
      setNote('');
    }
  };

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Nasil hissediyorsun?</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {MOODS.map(m => (
          <TouchableOpacity key={m.score} onPress={() => handleSelect(m.score)} style={{ alignItems: 'center', flex: 1 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: (currentScore === m.score || selectedScore === m.score) ? COLORS.primary : COLORS.surfaceLight,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: 1, borderColor: (currentScore === m.score || selectedScore === m.score) ? COLORS.primary : COLORS.border,
            }}>
              <Text style={{ color: (currentScore === m.score || selectedScore === m.score) ? '#fff' : COLORS.textMuted, fontSize: FONT.md, fontWeight: '700' }}>{m.score}</Text>
            </View>
            <Text style={{ color: (currentScore === m.score || selectedScore === m.score) ? COLORS.primary : COLORS.textMuted, fontSize: 9, marginTop: 2 }}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stress note input (T1.13) */}
      {showNote && (
        <View style={{ marginTop: SPACING.sm }}>
          <TextInput
            style={{
              backgroundColor: COLORS.inputBg, borderRadius: 8, padding: SPACING.sm,
              color: COLORS.text, fontSize: FONT.sm, borderWidth: 1, borderColor: COLORS.border,
            }}
            placeholder="Stres notu (opsiyonel)..."
            placeholderTextColor={COLORS.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={200}
          />
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
            <TouchableOpacity
              onPress={handleSubmitWithNote}
              style={{ flex: 1, backgroundColor: COLORS.primary, borderRadius: 8, padding: SPACING.sm, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (selectedScore) onSelect(selectedScore); setShowNote(false); setNote(''); }}
              style={{ flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 8, padding: SPACING.sm, alignItems: 'center' }}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Notsuz Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
