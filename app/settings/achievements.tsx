import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAchievements, type Achievement } from '@/services/achievements.service';
import { shareMilestone } from '@/services/sharing.service';
import { shareMilestoneCard, type MilestoneCardData } from '@/services/share-card.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

const TYPE_ICONS: Record<string, string> = {
  first_kg: '*', five_kg: '**', half_goal: '***', goal_reached: '!!!!',
  streak_7: '7', streak_30: '30', streak_100: '100', pr: 'PR',
  maintenance_1m: 'M1', maintenance_3m: 'M3', maintenance_6m: 'M6',
};

// P1#8: map an achievement to a shareable 1080x1920 card (share-card.service).
function achievementToCard(a: Achievement): MilestoneCardData {
  const t = a.achievement_type;
  const sub = a.description ?? undefined;
  if (t.startsWith('streak_')) {
    return { title: a.title, subtitle: sub, value: `${t.replace('streak_', '')} gün`, theme: 'streak' };
  }
  if (t === 'first_kg' || t === 'five_kg' || t === 'half_goal' || t === 'goal_reached') {
    return { title: a.title, subtitle: sub, theme: 'success' };
  }
  return { title: a.title, subtitle: sub, theme: 'milestone' };
}

export default function AchievementsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getAchievements().then(setItems).finally(() => setLoading(false)); }, []);

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {items.length === 0 ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '800' }}>★</Text>
            </View>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>Henüz başarımın yok</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>Kilo, antrenman ve seri kayıtların biriktikçe burada rozetlerin görünecek. Kayıt girmeye devam et!</Text>
          </View>
        </Card>
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
                  onPress={async () => { haptics.tap(); const ok = await shareMilestoneCard(achievementToCard(a)); if (!ok) shareMilestone(a.title, a.description ?? ''); }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.title} başarımını paylaş`}
                  style={{
                    paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: 8,
                    backgroundColor: COLORS.primary + '15', borderWidth: 1, borderColor: COLORS.primary + '40',
                  }}
                >
                  <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>Paylaş</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
