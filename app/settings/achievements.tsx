import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { getAchievements, type Achievement } from '@/services/achievements.service';
import { shareMilestone } from '@/services/sharing.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const TYPE_ICONS: Record<string, string> = {
  first_kg: '*', five_kg: '**', half_goal: '***', goal_reached: '!!!!',
  streak_7: '7', streak_30: '30', streak_100: '100', pr: 'PR',
  maintenance_1m: 'M1', maintenance_3m: 'M3', maintenance_6m: 'M6',
};

export default function AchievementsScreen() {
  const [items, setItems] = useState<Achievement[]>([]);

  useEffect(() => { getAchievements().then(setItems); }, []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Basarimlar</Text>

      {items.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>Henuz basarim yok. Kayit girmeye devam et!</Text></Card>
      ) : (
        items.map(a => (
          <View key={a.id} style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.primary, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '800' }}>{TYPE_ICONS[a.achievement_type] ?? '+'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700' }}>{a.title}</Text>
              {a.description && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{a.description}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                  {new Date(a.achieved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
                {/* D17: Share button */}
                <TouchableOpacity
                  onPress={() => shareMilestone(a.title, a.description ?? '')}
                  style={{
                    paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8,
                    backgroundColor: COLORS.primary + '15', borderWidth: 1, borderColor: COLORS.primary + '40',
                  }}
                >
                  <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>Paylas</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
