import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAchievements, type Achievement } from '@/services/achievements.service';
import { shareMilestone } from '@/services/sharing.service';
import { shareMilestoneCard, type MilestoneCardData } from '@/services/share-card.service';
import { Card } from '@/components/ui/Card';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

// ux-sweep (AC-02): '*', '!!!!', 'M1' yer tutucuları GERÇEK ikonlara çevrildi.
const TYPE_ICONS: Record<string, string> = {
  first_kg: 'trending-down-outline', five_kg: 'trending-down', half_goal: 'flag-outline', goal_reached: 'trophy',
  streak_7: 'flame-outline', streak_30: 'flame', streak_100: 'bonfire', pr: 'barbell',
  maintenance_1m: 'shield-checkmark-outline', maintenance_3m: 'shield-checkmark', maintenance_6m: 'shield',
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  // ux-sweep (AC-01): servis error'u yutuyor — ağ hatası 'hiç başarımın yok' olarak okunuyordu.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setLoadError(false);
    getAchievements()
      .then(res => { setItems(res); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [reloadKey]);

  if (loading) {
    // FIX (ux-ideas #28): skeleton loader instead of a bare centered spinner — no "frozen" feel,
    // no layout jump when content lands, and visual parity with dashboard/reports/coach-memory.
    return <View style={{ flex: 1, backgroundColor: colors.background }}><SkeletonScreen cards={4} /></View>;
  }

  if (loadError) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Card><LoadErrorState embedded title="Başarımlar yüklenemedi" onRetry={() => { setLoading(true); setReloadKey(k => k + 1); }} /></Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {items.length === 0 ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: colors.primary, ...TYPE.title3 }}>★</Text>
            </View>
            <Text style={{ color: colors.text, ...TYPE.headline, textAlign: 'center' }}>Henüz başarımın yok</Text>
            <Text style={{ color: colors.textSecondary, ...TYPE.body, textAlign: 'center' }}>Kilo, antrenman ve seri kayıtların biriktikçe başarımların burada görünecek. Kayıt girmeye devam et!</Text>
          </View>
        </Card>
      ) : (
        items.map(a => (
          <View key={a.id} style={{ backgroundColor: colors.card, borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            {/* FIX (ux-polish): decorative placeholder glyph — hide from screen readers so TalkBack
                doesn't read the raw characters before each title (the title already names it). */}
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name={(TYPE_ICONS[a.achievement_type] ?? 'ribbon-outline') as never} size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, ...TYPE.headline }}>{a.title}</Text>
              {a.description && <Text style={{ color: colors.textSecondary, ...TYPE.body, marginTop: 2 }}>{a.description}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: colors.textMuted, ...TYPE.caption }}>
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
                    backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '40',
                  }}
                >
                  <Text style={{ color: colors.primary, ...TYPE.caption, fontWeight: '600' }}>Paylaş</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
