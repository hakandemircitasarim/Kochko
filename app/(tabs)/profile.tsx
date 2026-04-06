/**
 * Profil Sekmesi — flat dark design
 * Avatar, fiziksel bilgiler, hedefler, ayarlar, veri & gizlilik
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';
import { InsightCard } from '@/components/profile/InsightCard';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Sağlıklı Yaşam', maintain: 'Koruma', conditioning: 'Kondisyon',
};

export default function ProfileScreen() {
  const { colors } = useTheme();
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

  const displayName = (profile?.display_name as string) || user?.email?.split('@')[0] || 'Kullanıcı';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 120 }}>
      {/* 5.1 User card */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.xxl, marginTop: Platform.OS === 'web' ? 16 : 40 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: colors.primary + '20',
          alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
        }}>
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '700' }}>{initials}</Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{displayName}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
          {streak > 0 ? `${streak} gündür Kochko'da` : ''}
        </Text>
        {streak > 0 && <View style={{ marginTop: SPACING.sm }}><StreakBadge days={streak} /></View>}
      </View>

      {/* 5.2 Physical info — 3 column grid */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xxl }}>
        <InfoBox label="Mevcut" value={profile?.weight_kg ? `${profile.weight_kg}` : '-'} unit="kg" colors={colors} />
        <InfoBox label="Hedef" value={goal?.target_weight_kg ? `${goal.target_weight_kg}` : '-'} unit="kg" colors={colors} />
        <InfoBox label="Hedef" value={goal ? GOAL_LABELS[goal.goal_type] ?? goal.goal_type : '-'} unit="" colors={colors} small />
      </View>

      {/* 5.4 Goals section */}
      <SectionTitle label="Hedefler" colors={colors} />
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.xxl }}>
        <MenuRow icon="flag-outline" color={colors.primary} label={goal ? `${GOAL_LABELS[goal.goal_type] ?? goal.goal_type}${goal.target_weight_kg ? ` - ${goal.target_weight_kg} kg` : ''}` : 'Hedef belirle'} onPress={() => router.push('/settings/goals')} colors={colors} />
        <MenuRow icon="barbell-outline" color={colors.purple} label="Güç hedefi" onPress={() => router.push('/settings/goals')} colors={colors} />
        <MenuRow icon="moon-outline" color={colors.purple} label="Uyku hedefi" onPress={() => router.push('/settings/goals')} colors={colors} last />
      </View>

      {/* 5.5 Settings section */}
      <SectionTitle label="Ayarlar" colors={colors} />
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.xxl }}>
        <MenuRow icon="notifications-outline" color={colors.carbs} label="Bildirim tercihleri" onPress={() => router.push('/settings/notifications')} colors={colors} />
        <MenuRow icon="chatbubble-outline" color={colors.primary} label="Koç iletişim tonu" value={{ balanced: 'Dengeli', strict: 'Sıkı', friendly: 'Arkadaşça', motivating: 'Motive edici' }[(profile?.coach_tone as string) ?? 'balanced'] ?? (profile?.coach_tone as string) ?? 'Dengeli'} onPress={() => router.push('/settings/coach-tone')} colors={colors} />
        <MenuRow icon="timer-outline" color={colors.purple} label="IF penceresi" value={profile?.if_eating_start ? `${profile.if_eating_start}-${profile.if_eating_end}` : 'Kapalı'} onPress={() => router.push('/settings/if-settings')} colors={colors} />
        <MenuRow icon="time-outline" color={colors.textSecondary} label="Gün sınırı" value={`${(profile?.day_boundary_hour as number) ?? 4}:00`} onPress={() => router.push('/settings/day-boundary')} colors={colors} />
        <MenuRow icon="restaurant-outline" color={colors.fat} label="Alerjenler" value={(profile?.food_allergies as string) || 'Yok'} onPress={() => router.push('/settings/food-preferences')} colors={colors} />
        <MenuRow icon="calendar-outline" color={colors.pink} label="Dönemsel durum" value={(profile?.periodic_state as string) ?? 'Normal'} onPress={() => router.push('/settings/periodic-state')} colors={colors} last />
      </View>

      {/* 5.6 Data & Privacy section */}
      <SectionTitle label="Veri & gizlilik" colors={colors} />
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.xxl }}>
        <MenuRow icon="eye-outline" color={colors.purple} label="AI hakkımda ne biliyor?" onPress={() => router.push('/settings/coach-memory')} colors={colors} />
        <MenuRow icon="download-outline" color={colors.primary} label="Verilerimi dışa aktar" onPress={() => router.push('/settings/export-data')} colors={colors} />
        <MenuRow icon="create-outline" color={colors.primary} label="Profil düzenle" onPress={() => router.push('/settings/edit-profile')} colors={colors} />
        <MenuRow icon="settings-outline" color={colors.textSecondary} label="Tüm ayarlar" onPress={() => router.push('/settings' as never)} colors={colors} />
        <MenuRow icon="trash-outline" color={colors.error} label="Hesabı sil" onPress={() => Alert.alert('Hesap Silme', 'Bu işlem geri alınamaz. Emin misin?', [
          { text: 'İptal' },
          { text: 'Sil', style: 'destructive', onPress: () => {} },
        ])} colors={colors} last />
      </View>

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

      {/* Logout */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.xl }}
        activeOpacity={0.7}
        onPress={() => Alert.alert('Çıkış', 'Emin misin?', [{ text: 'İptal' }, { text: 'Çıkış', style: 'destructive', onPress: signOut }])}
      >
        <Ionicons name="log-out-outline" size={16} color={colors.textMuted} />
        <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '500' }}>Çıkış Yap</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionTitle({ label, colors }: { label: string; colors: any }) {
  return (
    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
      {label}
    </Text>
  );
}

function InfoBox({ label, value, unit, colors, small }: { label: string; value: string; unit: string; colors: any; small?: boolean }) {
  return (
    <View style={{
      flex: 1, backgroundColor: colors.cardElevated, borderRadius: RADIUS.md,
      padding: SPACING.lg, alignItems: 'center',
    }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: SPACING.xs }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: small ? 13 : 20, fontWeight: '700' }}>{value}</Text>
      {unit ? <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{unit}</Text> : null}
    </View>
  );
}

function MenuRow({ icon, color, label, value, onPress, colors, last }: {
  icon: string; color: string; label: string; value?: string;
  onPress: () => void; colors: any; last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: SPACING.lg,
        borderBottomWidth: last ? 0 : 0.5, borderBottomColor: colors.border,
      }}
      onPress={onPress} activeOpacity={0.6}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 }}>
        <Ionicons name={icon as any} size={18} color={color} />
        <Text style={{ color: label.includes('sil') ? colors.error : colors.text, fontSize: 13, fontWeight: '400' }}>{label}</Text>
      </View>
      {value && <Text style={{ color: colors.textMuted, fontSize: 12, marginRight: SPACING.sm }}>{value}</Text>}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
