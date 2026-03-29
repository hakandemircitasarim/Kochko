/**
 * Achievements Screen — Spec 13.1-13.4
 * Shows: streaks, milestones, personal records, maintenance achievements.
 * Tap to share via shareMilestone().
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { getAchievements, calculateStreak, type Achievement } from '@/services/achievements.service';
import { shareMilestone } from '@/services/sharing.service';
import { useAuthStore } from '@/stores/auth.store';
import { Card, EmptyState } from '@/components/ui/Card';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  first_kg: { icon: '⭐', color: '#FFD700', label: 'Ilk Kilo' },
  five_kg: { icon: '🏅', color: '#FFD700', label: '5 Kilo' },
  half_goal: { icon: '🎯', color: COLORS.primary, label: 'Yarisina Geldin' },
  goal_reached: { icon: '🏆', color: '#FFD700', label: 'Hedefe Ulastin!' },
  streak_7: { icon: '🔥', color: COLORS.warning, label: '7 Gun Seri' },
  streak_30: { icon: '🔥', color: COLORS.error, label: '30 Gun Seri' },
  streak_100: { icon: '💎', color: COLORS.primary, label: '100 Gun Seri' },
  pr: { icon: '💪', color: COLORS.success, label: 'Kisisel Rekor' },
  maintenance_1m: { icon: '🛡️', color: COLORS.success, label: '1 Ay Bakimda' },
  maintenance_3m: { icon: '🛡️', color: '#FFD700', label: '3 Ay Bakimda' },
  maintenance_6m: { icon: '🏅', color: '#FFD700', label: '6 Ay Bakimda' },
};

export default function AchievementsScreen() {
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<Achievement[]>([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [data, s] = await Promise.all([
      getAchievements(),
      user?.id ? calculateStreak(user.id) : 0,
    ]);
    setItems(data);
    setStreak(s);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const grouped = {
    milestones: items.filter(a => ['first_kg', 'five_kg', 'half_goal', 'goal_reached'].includes(a.achievement_type)),
    streaks: items.filter(a => a.achievement_type.startsWith('streak_')),
    records: items.filter(a => a.achievement_type === 'pr'),
    maintenance: items.filter(a => a.achievement_type.startsWith('maintenance_')),
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.primary} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Basarimlar</Text>
        <StreakBadge days={streak} />
      </View>

      {/* Summary */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        <StatCard value={`${items.length}`} label="Toplam" />
        <StatCard value={`${streak}`} label="Seri" />
        <StatCard value={`${grouped.records.length}`} label="Rekor" />
      </View>

      {items.length === 0 ? (
        <Card>
          <EmptyState message="Henuz basarim yok. Kayit girmeye devam et — ilk basarimin yakin!" />
        </Card>
      ) : (
        <>
          {/* Milestones */}
          {grouped.milestones.length > 0 && (
            <>
              <SectionTitle title="Kilometre Taslari" />
              {grouped.milestones.map(a => <AchievementRow key={a.id} achievement={a} />)}
            </>
          )}

          {/* Streaks */}
          {grouped.streaks.length > 0 && (
            <>
              <SectionTitle title="Seri Basarimlari" />
              {grouped.streaks.map(a => <AchievementRow key={a.id} achievement={a} />)}
            </>
          )}

          {/* Personal Records */}
          {grouped.records.length > 0 && (
            <>
              <SectionTitle title="Kisisel Rekorlar" />
              {grouped.records.map(a => <AchievementRow key={a.id} achievement={a} />)}
            </>
          )}

          {/* Maintenance */}
          {grouped.maintenance.length > 0 && (
            <>
              <SectionTitle title="Bakim Basarimlari" />
              {grouped.maintenance.map(a => <AchievementRow key={a.id} achievement={a} />)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function AchievementRow({ achievement: a }: { achievement: Achievement }) {
  const config = TYPE_CONFIG[a.achievement_type] ?? { icon: '⭐', color: COLORS.primary, label: a.achievement_type };

  return (
    <TouchableOpacity
      onPress={() => shareMilestone(a.title, a.description ?? '')}
      style={{
        backgroundColor: COLORS.card, borderRadius: RADIUS.md,
        padding: SPACING.md, marginBottom: SPACING.sm,
        borderWidth: 1, borderColor: config.color + '40',
        flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
      }}
    >
      <View style={{
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: config.color + '20',
        justifyContent: 'center', alignItems: 'center',
      }}>
        <Text style={{ fontSize: 22 }}>{config.icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700' }}>{a.title}</Text>
        {a.description && (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{a.description}</Text>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
            {new Date(a.achieved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs }}>Paylas →</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: SPACING.md, marginBottom: SPACING.sm }}>
      {title}
    </Text>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
