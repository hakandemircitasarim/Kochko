/**
 * Başarımlar — Duolingo rozet vitrini (sunum: components/profile/AchievementShowcase).
 * Bu ekran yalnız veri yükleme / hata / iskelet ve paylaşım eşlemesini tutar.
 */
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { useState, useEffect } from 'react';
import { View, ScrollView } from 'react-native';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAchievements, type Achievement } from '@/services/achievements.service';
import { shareMilestone } from '@/services/sharing.service';
import { shareMilestoneCard, type MilestoneCardData } from '@/services/share-card.service';
import { Card } from '@/components/ui/Card';
import { SPACING } from '@/lib/constants';
import { AchievementShowcase } from '@/components/profile/AchievementShowcase';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

// ux-sweep (AC-02): rozet ikonları artık components/profile/BadgeMedal BADGE_CATALOG'da
// (kazanılmamış rozetlerin silüeti de aynı katalogdan çiziliyor).

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

      {/* Duolingo rozet vitrini: kahraman kart + kazanılanlar (canlı, gövdeli) + sıradakiler
          (gri silüet). Boş durum da vitrinin kendisi — kilitli rozetler neyin peşinden
          koşulacağını gösterir (eski "★ Henüz başarımın yok" kartının yerine). */}
      <AchievementShowcase
        items={items}
        onShare={async (a) => { haptics.tap(); const ok = await shareMilestoneCard(achievementToCard(a)); if (!ok) shareMilestone(a.title, a.description ?? ''); }}
      />
    </ScrollView>
  );
}
