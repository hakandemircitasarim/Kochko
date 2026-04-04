/**
 * Challenge Mini Widget for Dashboard
 * Spec 13.5: Aktif challenge ilerleme göstergesi.
 */
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface ActiveChallenge {
  id: string;
  title: string;
  target: { duration_days?: number } | null;
  progress: { date: string; met: boolean }[] | null;
}

interface Props {
  challenges: ActiveChallenge[];
}

export function ChallengeWidget({ challenges }: Props) {
  if (challenges.length === 0) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/settings/challenges')}
      style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Aktif Challenge</Text>
      {challenges.map(ch => {
        const targetDays = (ch.target as { duration_days?: number })?.duration_days ?? 30;
        const completedDays = Array.isArray(ch.progress) ? ch.progress.filter(p => p.met).length : 0;
        const pct = targetDays > 0 ? Math.min(1, completedDays / targetDays) : 0;
        return (
          <View key={ch.id} style={{ marginBottom: challenges.length > 1 ? SPACING.sm : 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }} numberOfLines={1}>{ch.title}</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{completedDays}/{targetDays}</Text>
            </View>
            <View style={{ height: 4, backgroundColor: COLORS.surfaceLight, borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: pct >= 1 ? COLORS.success : COLORS.primary, borderRadius: 2 }} />
            </View>
          </View>
        );
      })}
    </TouchableOpacity>
  );
}
