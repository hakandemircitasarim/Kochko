import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { ProfileCompletion } from '@/components/profile/ProfileCompletion';
import { InsightCard } from '@/components/profile/InsightCard';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme, GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Sağlıklı Yaşam', maintain: 'Koruma', conditioning: 'Kondisyon',
};
const ACTIVITY_LABELS: Record<string, string> = { sedentary: 'Hareketsiz', light: 'Hafif', moderate: 'Orta', active: 'Aktif', very_active: 'Çok Aktif' };

export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
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
  const cardShadow = isDark ? {} : CARD_SHADOW;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + 20 }}
    >
      {/* Header */}
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.lg,
      }}>
        <View>
          <Text style={{
            fontSize: FONT.hero,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.5,
          }}>
            Merhaba!
          </Text>
          <Text style={{ fontSize: FONT.sm, color: colors.textMuted, marginTop: 2 }}>
            {user?.email}
          </Text>
        </View>
        {streak > 0 && <StreakBadge days={streak} />}
      </View>

      {/* Stats Row */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <StatBox icon="resize-outline" tintColor="#6C63FF" label="Boy" value={profile?.height_cm ? `${profile.height_cm}` : '-'} unit="cm" />
        <StatBox icon="scale-outline" tintColor="#EC4899" label="Kilo" value={profile?.weight_kg ? `${profile.weight_kg}` : '-'} unit="kg" />
        <StatBox icon="calendar-outline" tintColor="#F59E0B" label="Yas" value={age ? `${age}` : '-'} unit="" />
        <StatBox icon="walk-outline" tintColor="#22C55E" label="Aktivite" value={ACTIVITY_LABELS[String(profile?.activity_level)] ?? '-'} unit="" small />
      </View>

      {/* Goal Card */}
      {goal && (
        <Card accent={colors.primary}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <LinearGradient
              colors={GRADIENTS.primary}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="flag" size={20} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: FONT.md, fontWeight: '700', color: colors.text }}>
                {GOAL_LABELS[goal.goal_type] ?? goal.goal_type}
              </Text>
              {goal.target_weight_kg && (
                <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, marginTop: 2 }}>
                  Hedef: {goal.target_weight_kg} kg
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => router.push('/settings/goals')} style={{ padding: SPACING.sm }}>
              <Ionicons name="pencil" size={16} color={colors.textMuted} />
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
        <Card title="Günlük Hedefler">
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <TargetItem icon="flame" label="Kalori" value={`${profile.calorie_range_rest_min}-${profile.calorie_range_rest_max}`} unit="kcal" color={colors.secondary} />
            <TargetItem icon="barbell" label="Protein" value={profile.protein_per_kg ? `${Math.round(Number(profile.weight_kg ?? 0) * Number(profile.protein_per_kg))}` : '-'} unit="g" color={colors.primary} />
            <TargetItem icon="water" label="Su" value={profile.water_target_liters ? `${profile.water_target_liters}` : '-'} unit="L" color={colors.accent} />
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
      <View style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        marginBottom: SPACING.lg,
        ...cardShadow,
      }}>
        <MenuItem icon="create-outline" iconColor="#6C63FF" label="Profil Düzenle" onPress={() => router.push('/settings/edit-profile')} />
        <MenuItem icon="flag-outline" iconColor="#2F80ED" label="Hedef Ayarları" onPress={() => router.push('/settings/goals')} />
        <MenuItem icon="restaurant-outline" iconColor="#F97316" label="Yemek Tercihleri" onPress={() => router.push('/settings/food-preferences')} />
        <MenuItem icon="timer-outline" iconColor="#A855F7" label="IF Ayarları" onPress={() => router.push('/settings/if-settings')} />
        <MenuItem icon="eye-outline" iconColor="#A855F7" label="Koçun Hafızası" onPress={() => router.push('/settings/coach-memory')} />
        <MenuItem icon="trophy-outline" iconColor="#F59E0B" label="Başarımlar" onPress={() => router.push('/settings/achievements')} />
        <MenuItem icon="settings-outline" iconColor="#64748B" label="Tüm Ayarlar" onPress={() => router.push('/settings' as never)} last />
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACING.xs,
          paddingVertical: SPACING.md,
        }}
        activeOpacity={0.7}
        onPress={() => Alert.alert('Çıkış', 'Emin misin?', [{ text: 'Iptal' }, { text: 'Çıkış', style: 'destructive', onPress: signOut }])}
      >
        <Ionicons name="log-out-outline" size={16} color={colors.textMuted} />
        <Text style={{ fontSize: FONT.sm, color: colors.textMuted, fontWeight: '500' }}>Çıkış Yap</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatBox({ icon, tintColor, label, value, unit, small }: { icon: string; tintColor?: string; label: string; value: string; unit: string; small?: boolean }) {
  const { colors, isDark } = useTheme();
  const tint = tintColor || colors.textMuted;

  return (
    <View style={{
      flex: 1,
      backgroundColor: isDark ? colors.card : tint + '08',
      borderRadius: RADIUS.xl,
      padding: SPACING.sm + 2,
      alignItems: 'center',
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <Ionicons
        name={icon as keyof typeof Ionicons.glyphMap}
        size={16}
        color={tint}
        style={{ marginBottom: 2 }}
      />
      <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginBottom: 2 }}>{label}</Text>
      <Text style={{
        fontSize: small ? FONT.sm : FONT.xl,
        fontWeight: '800',
        color: colors.text,
      }}>
        {value}
      </Text>
      {unit ? <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, marginTop: 1 }}>{unit}</Text> : null}
    </View>
  );
}

function TargetItem({ icon, label, value, unit, color }: { icon: string; label: string; value: string; unit: string; color: string }) {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: color + '18',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={color} />
      </View>
      <Text style={{ fontSize: FONT.xs, color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: FONT.lg, fontWeight: '700', color: colors.text }}>
        {value} <Text style={{ fontSize: FONT.xs, fontWeight: '400', color: colors.textMuted }}>{unit}</Text>
      </Text>
    </View>
  );
}

function MenuItem({ icon, iconColor, label, onPress, last }: { icon: string; iconColor?: string; label: string; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  const tint = iconColor || colors.primary;

  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.md,
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: colors.divider,
      }}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <View style={{
          width: 34,
          height: 34,
          borderRadius: RADIUS.sm + 2,
          backgroundColor: tint + '15',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={tint} />
        </View>
        <Text style={{ fontSize: FONT.md, color: colors.text, fontWeight: '500' }}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
