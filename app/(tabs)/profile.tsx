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
import { usePremium } from '@/hooks/usePremium';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak } from '@/services/achievements.service';
// FIX (audit raw-enum): map periodic_state enum ('busy_work'...) to Turkish labels.
import { PERIODIC_LABELS, type PeriodicState } from '@/services/periodic.service';
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
  const { isPremium, requirePremium } = usePremium();
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<{ goal_type: string; target_weight_kg: number | null } | null>(null);
  // FIX (audit false-Yok): distinguish "fetch failed" from "no data" — a failed fetch must
  // never render a confident 'Yok' / 'Hedef belirle'.
  const [goalLoadError, setGoalLoadError] = useState(false);
  // allergens === null ⇒ fetch failed OR still loading (render 'Yüklenemedi'/'—',
  // never a confident 'Yok' before the data actually arrived — safety-critical row).
  const [allergens, setAllergens] = useState<string[] | null>(null);

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
      .then(({ data, error }) => {
        if (cancelled) return;
        // FIX (audit false-Yok): a fetch error previously fell through to the same UI as
        // "no active goal" — surface it as an error state instead.
        if (error) { setGoalLoadError(true); setGoal(null); return; }
        setGoalLoadError(false);
        const row = (data as { goal_type: string; target_weight_kg: number | null }[] | null)?.[0] ?? null;
        setGoal(row);
      });
    supabase.from('food_preferences').select('food_name').eq('user_id', user.id).eq('is_allergen', true)
      .then(({ data, error }) => {
        if (cancelled) return;
        // FIX (audit false-Yok, safety): on error NEVER show 'Alerjenler: Yok' — a user with a
        // real allergy would read that as "the app knows I have none".
        if (error) { setAllergens(null); return; }
        const names = (data as { food_name: string }[] | null)?.map((r) => r.food_name) ?? [];
        setAllergens(names);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const displayName = (profile?.display_name as string) || user?.email?.split('@')[0] || 'Kullanıcı';
  // FIX (ux-pass5): toUpperCase i→I bozuyordu ('irem'→'IR'); tr-TR ile i→İ ('İR').
  const initials = displayName.slice(0, 2).toLocaleUpperCase('tr-TR');

  // FIX (audit tenure): "X gündür Kochko'da" previously showed the LOG STREAK (1 gün for a
  // 32-day-old account). Tenure = whole days since profiles.created_at.
  const memberDays = profile?.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.created_at as string).getTime()) / 86400000))
    : null;

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
        {memberDays != null && (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
            {memberDays === 0 ? "Bugün Kochko'ya katıldın" : `${memberDays} gündür Kochko'da`}
          </Text>
        )}
        {streak > 0 && <View style={{ marginTop: SPACING.sm }}><StreakBadge days={streak} /></View>}
      </View>

      {/* 5.2 Physical info — 3 column grid.
          FIX (audit duplicate-label): 'Mevcut / Hedef / Hedef' → third box is the goal TYPE,
          relabeled 'Amaç' so the two boxes are distinct.
          FIX (audit false-Yok): on goal fetch error render '—' instead of a confident '-'. */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xxl }}>
        <InfoBox label="Mevcut" value={profile?.weight_kg ? `${profile.weight_kg}` : '-'} unit="kg" colors={colors} />
        <InfoBox label="Hedef" value={goalLoadError ? '—' : goal?.target_weight_kg ? `${goal.target_weight_kg}` : '-'} unit="kg" colors={colors} />
        <InfoBox label="Amaç" value={goalLoadError ? '—' : goal ? GOAL_LABELS[goal.goal_type] ?? goal.goal_type : '-'} unit="" colors={colors} small />
      </View>

      {/* 5.4 Goals section */}
      <SectionTitle label="Hedefler" colors={colors} />
      <MenuGroup colors={colors}>
        <MenuRow icon="flag-outline" color={colors.primary} label={goalLoadError ? 'Hedef yüklenemedi' : goal ? `${GOAL_LABELS[goal.goal_type] ?? goal.goal_type}${goal.target_weight_kg ? ` - ${goal.target_weight_kg} kg` : ''}` : 'Hedef belirle'} onPress={() => router.push('/settings/goals')} colors={colors} />
        {/* FIX (completeness audit): 'Güç hedefi' now routes to the real strength screen (was the
            weight-goal editor). 'Uyku hedefi' removed — no sleep-goal screen exists, so the row
            promised a feature the app doesn't have and dead-ended in the weight-goal form. */}
        {/* FIX (audit premium-parity): gate like settings/index — free users get the paywall
            prompt instead of a frame-flash then paywall replace inside the screen. */}
        <MenuRow icon="barbell-outline" color={colors.purple} label="Güç hedefi" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/strength') : () => requirePremium(() => router.push('/settings/strength'), 'Güç Progresyon')} colors={colors} last />
      </MenuGroup>

      {/* 5.5 Settings section */}
      <SectionTitle label="Ayarlar" colors={colors} />
      <MenuGroup colors={colors}>
        <MenuRow icon="notifications-outline" color={colors.carbs} label="Bildirim tercihleri" onPress={() => router.push('/settings/notifications')} colors={colors} />
        <MenuRow icon="chatbubble-outline" color={colors.primary} label="Koç iletişim tonu" value={{ balanced: 'Dengeli', strict: 'Sıkı', friendly: 'Arkadaşça', motivating: 'Motive edici' }[(profile?.coach_tone as string) ?? 'balanced'] ?? (profile?.coach_tone as string) ?? 'Dengeli'} onPress={() => router.push('/settings/coach-tone')} colors={colors} />
        <MenuRow icon="timer-outline" color={colors.purple} label="IF penceresi" value={profile?.if_eating_start ? `${profile.if_eating_start}-${profile.if_eating_end}` : 'Kapalı'} onPress={() => router.push('/settings/if-settings')} colors={colors} />
        <MenuRow icon="time-outline" color={colors.textSecondary} label="Gün dönümü" value={`${(profile?.day_boundary_hour as number) ?? 4}:00`} onPress={() => router.push('/settings/day-boundary')} colors={colors} />
        {/* FIX (audit false-Yok, safety): fetch error ⇒ 'Yüklenemedi', never a confident 'Yok'. */}
        <MenuRow icon="restaurant-outline" color={colors.fat} label="Alerjenler" value={allergens === null ? '—' : allergens.length ? allergens.join(', ') : 'Yok'} onPress={() => router.push('/settings/food-preferences')} colors={colors} />
        {/* FIX (audit raw-enum): 'busy_work' vb. ham enum yerine Türkçe etiket.
            FIX (audit premium-parity): settings/index ile aynı premium rozet + kapı. */}
        <MenuRow icon="calendar-outline" color={colors.pink} label="Dönemsel durum" value={profile?.periodic_state ? PERIODIC_LABELS[profile.periodic_state as PeriodicState] ?? String(profile.periodic_state) : 'Normal'} premium={!isPremium} onPress={isPremium ? () => router.push('/settings/periodic-state') : () => requirePremium(() => router.push('/settings/periodic-state'), 'Dönemsel Durum')} colors={colors} />
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
        {/* FIX (audit naming): tek kanonik özellik adı — 'Kochko Seni Nasıl Tanıyor'. */}
        <MenuRow icon="eye-outline" color={colors.purple} label="Kochko Seni Nasıl Tanıyor" onPress={() => router.push('/settings/coach-memory')} colors={colors} />
        <MenuRow icon="download-outline" color={colors.primary} label="Verilerimi dışa aktar" onPress={() => router.push('/settings/health-export')} colors={colors} />
        <MenuRow icon="create-outline" color={colors.primary} label="Profil düzenle" onPress={() => router.push('/settings/edit-profile')} colors={colors} />
        {/* FIX (audit: tutarsız hesap-silme sürtünmesi) — profil sekmesindeki
            tek-tık Alert + requestAccountDeletion akışı kaldırıldı; tek
            paylaşılan, typed-confirm korumalı silme akışına (settings) yönlendir.
            FIX (audit dead-drop): plain '/settings' 30 satırlık listenin TEPESİNE bırakıyordu;
            ?openDelete=1 typed-confirm silme modalını doğrudan açar. */}
        <MenuRow icon="trash-outline" color={colors.error} label="Hesabı sil" onPress={() => router.push('/settings?openDelete=1' as never)} colors={colors} last />
      </MenuGroup>

      {/* AI Summary */}
      {!!summary?.general_summary && (
        <InsightCard
          generalSummary={String(summary.general_summary ?? '')}
          patterns={(summary.behavioral_patterns as { type: string; description: string }[]) ?? []}
          portionCalibration={(summary.portion_calibration as Record<string, unknown>) ?? {}}
          coachingNotes={String(summary.coaching_notes ?? '')}
          onDeleteNote={async () => {
            // #S3: general_summary is a DERIVED view — deleting the paragraph would be untruthful
            // (it regenerates from canonical stores on the next fact turn). Route the user to the
            // source facts, where deletion is real and permanent.
            Alert.alert(
              'Bu özet otomatik derleniyor',
              'Genel özet; profilin, hedefin ve sağlık kayıtlarından otomatik oluşturulur. Bir bilgiyi kalıcı silmek için "Kochko Seni Nasıl Tanıyor" ekranından ilgili kaydı sil — özet kendini günceller.',
              [{ text: 'Tamam' }, { text: 'Ekranı aç', onPress: () => router.push('/settings/coach-memory' as never) }],
            );
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
    // FIX (ux-pass5): textTransform:'uppercase' locale bilmez — 'Veri & gizlilik' iOS/EN-locale
    // Android'de 'VERI & GIZLILIK' oluyordu. Metin tr-TR ile büyütülür, CSS transform kaldırıldı
    // (PlanOverviewCards #11e ile aynı desen).
    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
      {label.toLocaleUpperCase('tr-TR')}
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

// FIX (audit premium-parity): `premium` prop renders the same lock+Premium pill the settings
// index rows use, so gated rows are recognizable BEFORE the tap instead of frame-flashing.
function MenuRow({ icon, color, label, value, onPress, colors, last, premium }: {
  icon: string; color: string; label: string; value?: string;
  onPress: () => void; colors: any; last?: boolean; premium?: boolean;
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
      accessibilityLabel={premium ? `${label}, Premium özellik` : value ? `${label}, ${value}` : label}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 }}>
        <Ionicons name={icon as any} size={18} color={color} />
        <Text style={{ color: label.includes('sil') ? colors.error : colors.text, fontSize: 13, fontWeight: '400' }}>{label}</Text>
      </View>
      {value && <Text style={{ color: colors.textMuted, fontSize: 12, marginRight: SPACING.sm }}>{value}</Text>}
      {premium && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginRight: SPACING.sm }}>
          <Ionicons name="lock-closed" size={11} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '600' }}>Premium</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
