/**
 * Profil Sekmesi — flat dark design
 * Avatar, fiziksel bilgiler, hedefler, ayarlar, veri & gizlilik
 */
import { useState, useEffect, type ReactNode } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
import { supabase } from '@/lib/supabase';
import { InsightCard } from '@/components/profile/InsightCard';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Sağlıklı Yaşam', maintain: 'Koruma', conditioning: 'Kondisyon',
};

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<{ goal_type: string; target_weight_kg: number | null } | null>(null);
  const [allergens, setAllergens] = useState<string[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetchProfile(user.id);
    loadInsights().then((data) => { if (!cancelled) setSummary(data); });
    // #R2-L7: use the user's saved day boundary (not the service default of 4).
    supabase.from('profiles').select('day_boundary_hour').eq('id', user.id).single()
      .then(({ data }) => calculateStreak(user.id, (data?.day_boundary_hour as number | null) ?? 4))
      .then((s) => { if (!cancelled) setStreak(s); });
    supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1)
      .then(({ data }) => {
        if (!cancelled) {
          const row = (data as { goal_type: string; target_weight_kg: number | null }[] | null)?.[0] ?? null;
          setGoal(row);
        }
      });
    supabase.from('food_preferences').select('food_name').eq('user_id', user.id).eq('is_allergen', true)
      .then(({ data }) => {
        if (!cancelled) {
          const names = (data as { food_name: string }[] | null)?.map((r) => r.food_name) ?? [];
          setAllergens(names);
        }
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const displayName = (profile?.display_name as string) || user?.email?.split('@')[0] || 'Kullanıcı';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.xl, paddingTop: insets.top + 8, paddingBottom: 120 + insets.bottom }}>
      {/* FIX (audit: tab başlık tutarlılığı) — Profil sekmesinde de diğer
          sekmelerle aynı başlık deseni (FONT.xl2/700, insets.top+8) */}
      <Text
        accessibilityRole="header"
        style={{ fontSize: FONT.xl2, fontWeight: '700', color: colors.text, marginBottom: SPACING.lg }}
      >
        Profil
      </Text>

      {/* 5.1 User card */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.xxl, marginTop: Platform.OS === 'web' ? 16 : 20 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: colors.primary + '20',
          alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
        }}>
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '700' }}>{initials}</Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{displayName}</Text>
        {streak > 0 && (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
            {`${streak} gündür Kochko'da`}
          </Text>
        )}
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
      <MenuGroup colors={colors}>
        <MenuRow icon="flag-outline" color={colors.primary} label={goal ? `${GOAL_LABELS[goal.goal_type] ?? goal.goal_type}${goal.target_weight_kg ? ` - ${goal.target_weight_kg} kg` : ''}` : 'Hedef belirle'} onPress={() => router.push('/settings/goals')} colors={colors} />
        <MenuRow icon="barbell-outline" color={colors.purple} label="Güç hedefi" onPress={() => router.push('/settings/goals')} colors={colors} />
        <MenuRow icon="moon-outline" color={colors.purple} label="Uyku hedefi" onPress={() => router.push('/settings/goals')} colors={colors} last />
      </MenuGroup>

      {/* 5.5 Settings section */}
      <SectionTitle label="Ayarlar" colors={colors} />
      <MenuGroup colors={colors}>
        <MenuRow icon="notifications-outline" color={colors.carbs} label="Bildirim tercihleri" onPress={() => router.push('/settings/notifications')} colors={colors} />
        <MenuRow icon="chatbubble-outline" color={colors.primary} label="Koç iletişim tonu" value={{ balanced: 'Dengeli', strict: 'Sıkı', friendly: 'Arkadaşça', motivating: 'Motive edici' }[(profile?.coach_tone as string) ?? 'balanced'] ?? (profile?.coach_tone as string) ?? 'Dengeli'} onPress={() => router.push('/settings/coach-tone')} colors={colors} />
        <MenuRow icon="timer-outline" color={colors.purple} label="IF penceresi" value={profile?.if_eating_start ? `${profile.if_eating_start}-${profile.if_eating_end}` : 'Kapalı'} onPress={() => router.push('/settings/if-settings')} colors={colors} />
        <MenuRow icon="time-outline" color={colors.textSecondary} label="Gün dönümü" value={`${(profile?.day_boundary_hour as number) ?? 4}:00`} onPress={() => router.push('/settings/day-boundary')} colors={colors} />
        <MenuRow icon="restaurant-outline" color={colors.fat} label="Alerjenler" value={allergens.length ? allergens.join(', ') : 'Yok'} onPress={() => router.push('/settings/food-preferences')} colors={colors} />
        <MenuRow icon="calendar-outline" color={colors.pink} label="Dönemsel durum" value={(profile?.periodic_state as string) ?? 'Normal'} onPress={() => router.push('/settings/periodic-state')} colors={colors} />
        {/* FIX (audit: keşfedilemez IA) — Premium ve Hesap Güvenliği birinci-sınıf
            satırlar; 'Tüm ayarlar' Veri&gizlilik yerine semantik olarak doğru
            Ayarlar bölümünde, scroll gerektirmeden bulunabilir. */}
        <MenuRow icon="star-outline" color={colors.warning} label="Premium" onPress={() => router.push('/settings/premium')} colors={colors} />
        <MenuRow icon="shield-checkmark-outline" color={colors.primary} label="Hesap Güvenliği" onPress={() => router.push('/settings/account-security')} colors={colors} />
        <MenuRow icon="settings-outline" color={colors.textSecondary} label="Tüm ayarlar" onPress={() => router.push('/settings' as never)} colors={colors} last />
      </MenuGroup>

      {/* 5.6 Data & Privacy section */}
      <SectionTitle label="Veri & gizlilik" colors={colors} />
      <MenuGroup colors={colors}>
        <MenuRow icon="eye-outline" color={colors.purple} label="Kochko'nun Senin Hakkında Bildikleri" onPress={() => router.push('/settings/coach-memory')} colors={colors} />
        <MenuRow icon="download-outline" color={colors.primary} label="Verilerimi dışa aktar" onPress={() => router.push('/settings/health-export')} colors={colors} />
        <MenuRow icon="create-outline" color={colors.primary} label="Profil düzenle" onPress={() => router.push('/settings/edit-profile')} colors={colors} />
        {/* FIX (audit: tutarsız hesap-silme sürtünmesi) — profil sekmesindeki
            tek-tık Alert + requestAccountDeletion akışı kaldırıldı; tek
            paylaşılan, typed-confirm korumalı silme akışına (settings) yönlendir. */}
        <MenuRow icon="trash-outline" color={colors.error} label="Hesabı sil" onPress={() => router.push('/settings' as never)} colors={colors} last />
      </MenuGroup>

      {/* AI Summary */}
      {!!summary?.general_summary && (
        <InsightCard
          generalSummary={String(summary.general_summary ?? '')}
          patterns={(summary.behavioral_patterns as { type: string; description: string }[]) ?? []}
          portionCalibration={(summary.portion_calibration as Record<string, unknown>) ?? {}}
          coachingNotes={String(summary.coaching_notes ?? '')}
          onDeleteNote={async (note) => {
            if (!user?.id) return;
            try {
              await deleteAISummaryNote(user.id, 'general_summary', note);
            } catch {
              Alert.alert('Silinemedi', 'Not silinirken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            loadInsights().then(setSummary);
          }}
          onResetAll={async () => {
            if (!user?.id) return;
            try {
              await resetAISummary(user.id);
            } catch {
              Alert.alert('Sıfırlanamadı', 'Hafıza sıfırlanırken bir sorun oluştu. Lütfen tekrar dene.');
              return;
            }
            setSummary(null);
          }}
        />
      )}

      {/* Logout */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.xl }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Çıkış yap"
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

// FIX (audit profile-card-drift): menü grupları elle kopyalanan View yerine tek
// paylaşılan MenuGroup ile çiziliyor (settings/index.tsx deseniyle aynı). Eksik
// olan `overflow: 'hidden'` eklendi — yuvarlatılmış köşeler artık ilk/son satırın
// kenarlığını düzgün kırpıyor; gruplar arası boşluk (SPACING.xxl) korundu.
function MenuGroup({ children, colors }: { children: ReactNode; colors: any }) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.md,
      borderWidth: 0.5, borderColor: colors.border,
      overflow: 'hidden', marginBottom: SPACING.xxl,
    }}>
      {children}
    </View>
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
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
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
