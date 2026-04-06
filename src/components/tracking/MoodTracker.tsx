/**
 * Mood Tracker - Modern emoji-based design
 * Spec 3.1: Stres/ruh hali kaydı (1-5 skala + opsiyonel not)
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Props {
  currentScore: number | null;
  onSelect: (score: number, stressNote?: string) => void;
  compact?: boolean;
}

const MOODS = [
  { score: 1, emoji: '\uD83D\uDE2B', label: 'Çok Kötü', color: '#EF4444' },
  { score: 2, emoji: '\uD83D\uDE1F', label: 'Kötü', color: '#F97316' },
  { score: 3, emoji: '\uD83D\uDE10', label: 'Normal', color: '#F59E0B' },
  { score: 4, emoji: '\uD83D\uDE0A', label: 'İyi', color: '#22C55E' },
  { score: 5, emoji: '\uD83E\uDD29', label: 'Harika', color: '#6C63FF' },
];

export function MoodTracker({ currentScore, onSelect, compact }: Props) {
  const { colors, isDark } = useTheme();
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [selectedScore, setSelectedScore] = useState<number | null>(null);

  const handleSelect = (score: number) => {
    setSelectedScore(score);
    if (score <= 2) {
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

  if (compact) {
    const compactMoods = MOODS.filter(m => [1, 3, 5].includes(m.score));
    return (
      <View style={{
        flex: 1, backgroundColor: colors.card, borderRadius: RADIUS.xxl, padding: SPACING.sm + 2,
        ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
      }}>
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, textAlign: 'center' }}>Ruh Hali</Text>
        {currentScore ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 36 }}>{MOODS.find(m => m.score === currentScore)?.emoji ?? '😐'}</Text>
            <Text style={{ fontSize: FONT.xs, color: MOODS.find(m => m.score === currentScore)?.color ?? colors.textMuted, fontWeight: '600', marginTop: 2 }}>
              {MOODS.find(m => m.score === currentScore)?.label}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm }}>
            {compactMoods.map(m => (
              <TouchableOpacity key={m.score} onPress={() => handleSelect(m.score)} style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 26 }}>{m.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.xxl,
      padding: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.sm + 2 }}>
        Nasıl hissediyorsun?
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.xs }}>
        {MOODS.map(m => {
          const isSelected = currentScore === m.score || selectedScore === m.score;
          return (
            <TouchableOpacity
              key={m.score}
              onPress={() => handleSelect(m.score)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: SPACING.sm,
                borderRadius: RADIUS.lg,
                backgroundColor: isSelected ? m.color + '18' : 'transparent',
                borderWidth: isSelected ? 1.5 : 0,
                borderColor: isSelected ? m.color : 'transparent',
              }}
            >
              <Text style={{ fontSize: isSelected ? 32 : 26, marginBottom: 4 }}>{m.emoji}</Text>
              <Text style={{
                fontSize: 9,
                fontWeight: isSelected ? '700' : '500',
                color: isSelected ? m.color : colors.textMuted,
              }}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Stress note input */}
      {showNote && (
        <View style={{ marginTop: SPACING.sm + 2 }}>
          <TextInput
            style={{
              backgroundColor: colors.inputBg,
              borderRadius: RADIUS.md,
              padding: SPACING.sm + 2,
              color: colors.text,
              fontSize: FONT.sm,
              borderWidth: 1,
              borderColor: colors.border,
              minHeight: 60,
            }}
            placeholder="Stres notu (opsiyonel)..."
            placeholderTextColor={colors.textMuted}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={200}
          />
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
            <TouchableOpacity
              onPress={handleSubmitWithNote}
              style={{ flex: 1, backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm + 2, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Kaydet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (selectedScore) onSelect(selectedScore); setShowNote(false); setNote(''); }}
              style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, paddingVertical: SPACING.sm + 2, alignItems: 'center' }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Notsuz Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
