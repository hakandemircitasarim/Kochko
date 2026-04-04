import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { ProfileCompletion } from '@/components/profile/ProfileCompletion';
import { InsightCard } from '@/components/profile/InsightCard';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Saglikli Yasam', maintain: 'Koruma', conditioning: 'Kondisyon',
};
const ACTIVITY_LABELS: Record<string, string> = { sedentary: 'Hareketsiz', light: 'Hafif', moderate: 'Orta', active: 'Aktif', very_active: 'Cok Aktif' };

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<{ goal_type: string; target_weight_kg: number | null } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchProfile(user.id);
    loadInsights().then(setSummary);
    calculateStreak(user.id).then(setStreak);
    supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1).maybeSingle()
      .then(({ data }) => { if (data) setGoal(data as typeof goal); });
  }, [user?.id]);

  const age = profile?.birth_year ? new Date().getFullYear() - (profile.birth_year as number) : null;
  const completionResult = useProfileStore.getState().getCompletion();

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Merhaba!</Text>
          <Text style={s.email}>{user?.email}</Text>
        </View>
        {streak > 0 && (
          <View style={s.streakBadge}>
            <Text style={s.streakNumber}>{streak}</Text>
            <Text style={s.streakLabel}>gun seri</Text>
          </View>
        )}
      </View>

      {/* Stats Row */}
      <View style={s.statsRow}>
        <StatBox label="Boy" value={profile?.height_cm ? `${profile.height_cm}` : '-'} unit="cm" />
        <StatBox label="Kilo" value={profile?.weight_kg ? `${profile.weight_kg}` : '-'} unit="kg" />
        <StatBox label="Yas" value={age ? `${age}` : '-'} unit="" />
        <StatBox label="Aktivite" value={ACTIVITY_LABELS[String(profile?.activity_level)] ?? '-'} unit="" small />
      </View>

      {/* Goal Card */}
      {goal && (
        <Card accent={COLORS.primary}>
          <View style={s.goalRow}>
            <View style={s.goalIcon}>
              <Ionicons name="flag" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.goalType}>{GOAL_LABELS[goal.goal_type] ?? goal.goal_type}</Text>
              {goal.target_weight_kg && (
                <Text style={s.goalTarget}>Hedef: {goal.target_weight_kg} kg</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => router.push('/settings/goals')} style={s.editBtn}>
              <Ionicons name="pencil" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* Profile Completion */}
      <ProfileCompletion
        percentage={completionResult?.percentage ?? 0}
        lowestCategory={completionResult?.lowestCategory ?? undefined}
        onPress={() => router.push('/settings/edit-profile')}
      />

      {/* Calorie Info */}
      {profile?.calorie_range_rest_min && (
        <Card title="Gunluk Hedefler">
          <View style={s.targetGrid}>
            <TargetItem icon="flame" label="Kalori" value={`${profile.calorie_range_rest_min}-${profile.calorie_range_rest_max}`} unit="kcal" color={COLORS.secondary} />
            <TargetItem icon="barbell" label="Protein" value={profile.protein_per_kg ? `${Math.round(Number(profile.weight_kg ?? 0) * Number(profile.protein_per_kg))}` : '-'} unit="g" color={COLORS.primary} />
            <TargetItem icon="water" label="Su" value={profile.water_target_liters ? `${profile.water_target_liters}` : '-'} unit="L" color={COLORS.accent} />
          </View>
        </Card>
      )}

      {/* AI Summary */}
      {summary?.general_summary && (
        <InsightCard
          generalSummary={String(summary.general_summary ?? '')}
          patterns={(summary.behavioral_patterns as { type: string; description: string }[]) ?? []}
          portionCalibration={(summary.portion_calibration as Record<string, unknown>) ?? {}}
          coachingNotes={String(summary.coaching_notes ?? '')}
          onDeleteNote={async (note) => {
            if (!user?.id) return;
            await deleteAISummaryNote(user.id, 'general_summary', note);
            loadInsights().then(setSummary);
          }}
          onResetAll={async () => {
            if (!user?.id) return;
            await resetAISummary(user.id);
            setSummary(null);
          }}
        />
      )}

      {/* Menu Items */}
      <View style={s.menu}>
        <MenuItem icon="create-outline" label="Profil Duzenle" onPress={() => router.push('/settings/edit-profile')} />
        <MenuItem icon="flag-outline" label="Hedef Ayarlari" onPress={() => router.push('/settings/goals')} />
        <MenuItem icon="restaurant-outline" label="Yemek Tercihleri" onPress={() => router.push('/settings/food-preferences')} />
        <MenuItem icon="timer-outline" label="IF Ayarlari" onPress={() => router.push('/settings/if-settings')} />
        <MenuItem icon="trophy-outline" label="Basarimlar" onPress={() => router.push('/settings/achievements')} />
        <MenuItem icon="settings-outline" label="Tum Ayarlar" onPress={() => router.push('/settings' as never)} />
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={s.logout}
        onPress={() => Alert.alert('Cikis', 'Emin misin?', [{ text: 'Iptal' }, { text: 'Cikis', style: 'destructive', onPress: signOut }])}
      >
        <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
        <Text style={s.logoutText}>Cikis Yap</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatBox({ label, value, unit, small }: { label: string; value: string; unit: string; small?: boolean }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, small && { fontSize: FONT.md }]}>{value}</Text>
      {unit ? <Text style={s.statUnit}>{unit}</Text> : null}
    </View>
  );
}

function TargetItem({ icon, label, value, unit, color }: { icon: string; label: string; value: string; unit: string; color: string }) {
  return (
    <View style={s.targetItem}>
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={color} />
      <Text style={s.targetLabel}>{label}</Text>
      <Text style={s.targetValue}>{value} <Text style={s.targetUnit}>{unit}</Text></Text>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.menuItem} onPress={onPress} activeOpacity={0.6}>
      <View style={s.menuLeft}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={COLORS.textSecondary} />
        <Text style={s.menuLabel}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl + 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  greeting: { fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  email: { fontSize: FONT.sm, color: COLORS.textMuted, marginTop: 2 },
  streakBadge: { backgroundColor: COLORS.secondary + '20', borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  streakNumber: { fontSize: FONT.xl, fontWeight: '800', color: COLORS.secondary },
  streakLabel: { fontSize: FONT.xs, color: COLORS.secondary, fontWeight: '600' },

  statsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  statBox: { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  statLabel: { fontSize: FONT.xs, color: COLORS.textMuted, marginBottom: 4 },
  statValue: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.text },
  statUnit: { fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 },

  goalRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  goalIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center' },
  goalType: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  goalTarget: { fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: 2 },
  editBtn: { padding: SPACING.sm },

  targetGrid: { flexDirection: 'row', gap: SPACING.md },
  targetItem: { flex: 1, alignItems: 'center', gap: 4 },
  targetLabel: { fontSize: FONT.xs, color: COLORS.textMuted },
  targetValue: { fontSize: FONT.lg, fontWeight: '700', color: COLORS.text },
  targetUnit: { fontSize: FONT.xs, fontWeight: '400', color: COLORS.textMuted },

  menu: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SPACING.lg },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  menuLabel: { fontSize: FONT.md, color: COLORS.text, fontWeight: '500' },

  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  logoutText: { fontSize: FONT.md, color: COLORS.error, fontWeight: '600' },
});
