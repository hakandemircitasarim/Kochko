/**
 * Profil Sekmesi — flat dark design
 * Avatar, fiziksel bilgiler, hedefler, ayarlar, veri & gizlilik
 */
import { useState, useCallback, type ReactNode } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { loadInsights } from '@/services/chat.service';
import { calculateStreak, nextStreakMilestone } from '@/services/achievements.service';
// FIX (audit raw-enum): map periodic_state enum ('busy_work'...) to Turkish labels.
import { PERIODIC_LABELS, type PeriodicState } from '@/services/periodic.service';
import { supabase } from '@/lib/supabase';
import { InsightCard } from '@/components/profile/InsightCard';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { goalLabelTR, coachToneLabelTR } from '@/lib/labels';
import { calculateProfileCompletion, CATEGORY_LABELS } from '@/lib/profile-completion';

import { FREE_LAUNCH } from '@/lib/premium-gate';
export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();
  const { isPremium, isInTrial, trialDaysLeft, requirePremium } = usePremium();
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<{ goal_type: string; target_weight_kg: number | null } | null>(null);
  // FIX (audit false-Yok): distinguish "fetch failed" from "no data" — a failed fetch must
  // never render a confident 'Yok' / 'Hedef belirle'.
  const [goalLoadError, setGoalLoadError] = useState(false);
  // allergens === null ⇒ fetch failed OR still loading (render 'Yüklenemedi'/'—',
  // never a confident 'Yok' before the data actually arrived — safety-critical row).
  const [allergens, setAllergens] = useState<string[] | null>(null);

  // FIX (ux-audit major): refetch on every tab focus, not just once per user id. The goal,
  // allergens, streak and coach-summary shown here are edited on OTHER settings screens — with a
  // mount-only effect a just-saved goal still read "Hedef belirle" on return, looking like the save
  // had failed. useFocusEffect re-pulls fresh data each time the Profil tab regains focus.
  useFocusEffect(useCallback(() => {
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
  }, [user?.id]));

  const nextBadge = nextStreakMilestone(streak);
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
      {/* FIX (ux-round2 #17): profile is where users instinctively look for a setting — give the
          header a search entry that opens the settings screen with its search box focused. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
        <Text accessibilityRole="header" style={{ ...TYPE.title2, color: colors.text }}>
          Profil
        </Text>
        <TouchableOpacity
          onPress={() => { haptics.tap(); router.push('/settings?focusSearch=1' as never); }}
          accessibilityRole="button"
          accessibilityLabel="Ayarlarda ara"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="search" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* 5.1 User card */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.xxl, marginTop: Platform.OS === 'web' ? 16 : 20 }}>
        {/* FIX (ux-round4 #14): avatar+name were inert despite the universal "tap to edit profile"
            expectation; make them a real button. Also surface the signed-in email — never shown on
            this tab before — so "am I on the right account?" is answerable at a glance. */}
        <TouchableOpacity
          onPress={() => { haptics.tap(); router.push('/settings/edit-profile'); }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Profili düzenle"
          style={{ alignItems: 'center' }}
        >
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: colors.primary + '20',
            alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
          }}>
            <Text style={{ ...TYPE.title2, color: colors.primary }}>{initials}</Text>
          </View>
          <Text style={{ ...TYPE.headline, color: colors.text }}>{displayName}</Text>
        </TouchableOpacity>
        {user?.email && (
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2, opacity: 0.7 }} numberOfLines={1}>{user.email}</Text>
        )}
        {memberDays != null && (
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4 }}>
            {memberDays === 0 ? "Bugün Kochko'ya katıldın" : `${memberDays} gündür Kochko'da`}
          </Text>
        )}
        {streak > 0 && <View style={{ marginTop: SPACING.sm }}><StreakBadge days={streak} /></View>}
        {/* FIX (ux-ideas #4): trial users saw no countdown anywhere they naturally look —
            surface the remaining days + a soft "Kalıcı yap" on the profile card. */}
        {isInTrial && (
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/settings/premium'); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Deneme ${trialDaysLeft} gün sonra bitiyor. Premium'a geçmek için dokun`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.sm,
              backgroundColor: colors.warning + '18', borderRadius: RADIUS.pill,
              paddingHorizontal: SPACING.md, paddingVertical: 4,
            }}
          >
            <Ionicons name="time-outline" size={13} color={colors.warning} />
            <Text style={{ ...TYPE.caption, color: colors.warning, fontWeight: '700' }}>Deneme • {trialDaysLeft} gün kaldı</Text>
            <Text style={{ ...TYPE.caption, color: colors.primary, fontWeight: '700', marginLeft: 4 }}>Kalıcı yap</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 5.2 Physical info — 3 column grid.
          FIX (audit duplicate-label): 'Mevcut / Hedef / Hedef' → third box is the goal TYPE,
          relabeled 'Amaç' so the two boxes are distinct.
          FIX (audit false-Yok): on goal fetch error render '—' instead of a confident '-'. */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xxl }}>
        {/* FIX (ux-polish): TR comma decimals to match every other weight surface (was "72.5 kg"). */}
        <InfoBox label="Mevcut" value={profile?.weight_kg ? String(profile.weight_kg).replace('.', ',') : '-'} unit="kg" colors={colors} />
        <InfoBox label="Hedef" value={goalLoadError ? '—' : goal?.target_weight_kg ? String(goal.target_weight_kg).replace('.', ',') : '-'} unit="kg" colors={colors} />
        <InfoBox label="Amaç" value={goalLoadError ? '—' : goal ? goalLabelTR(goal.goal_type) : '-'} unit="" colors={colors} small />
      </View>

      {/* FIX (ux-ideas #14): profile-completion nudge lives where edits actually happen. The
          donut was dashboard-only; here a gentle bar + the lowest-filled category + a one-tap
          route collects the data the coach needs for a good plan, without nagging. */}
      {profile && (() => {
        const comp = calculateProfileCompletion(profile as Record<string, unknown>);
        if (comp.percentage >= 100) return null;
        return (
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/settings/edit-profile'); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Profilin yüzde ${comp.percentage} tamamlandı.${comp.lowestCategory ? ` Sıradaki: ${CATEGORY_LABELS[comp.lowestCategory]}.` : ''} Düzenlemek için dokun`}
            style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, marginBottom: SPACING.xxl }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Ionicons name="person-circle-outline" size={16} color={colors.primary} />
                <Text style={{ ...TYPE.headline, color: colors.text }}>Profilin %{comp.percentage} tam</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
            <View style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${comp.percentage}%`, backgroundColor: colors.primary, borderRadius: 4 }} />
            </View>
            {comp.lowestCategory && (
              <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.sm }}>
                Sıradaki: {CATEGORY_LABELS[comp.lowestCategory]} ekle — koçun daha isabetli plan yapsın.
              </Text>
            )}
          </TouchableOpacity>
        );
      })()}

      {/* FIX (ux-ideas #16): "Sıradaki rozet" — a concrete target to chase, with progress. */}
      {nextBadge && (
        <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, marginBottom: SPACING.xxl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              <Ionicons name="ribbon-outline" size={16} color={colors.warning} />
              <Text style={{ ...TYPE.headline, color: colors.text }}>Sıradaki rozet</Text>
            </View>
            <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>{streak}/{nextBadge.target}</Text>
          </View>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginBottom: SPACING.sm }}>
            {nextBadge.label} · {nextBadge.remaining} gün kaldı
          </Text>
          <View style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${Math.round(nextBadge.progress * 100)}%`, backgroundColor: colors.warning, borderRadius: 4 }} />
          </View>
        </View>
      )}

      {/* 5.4 Goals section */}
      <SectionTitle label="Hedefler" colors={colors} />
      <MenuGroup colors={colors}>
        <MenuRow icon="flag-outline" color={colors.primary} label={goalLoadError ? 'Hedef yüklenemedi' : goal ? `${goalLabelTR(goal.goal_type)}${goal.target_weight_kg ? ` - ${goal.target_weight_kg} kg` : ''}` : 'Hedef belirle'} onPress={() => router.push('/settings/goals')} colors={colors} />
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
        <MenuRow icon="chatbubble-outline" color={colors.primary} label="Koç iletişim tonu" value={coachToneLabelTR((profile?.coach_tone as string) ?? 'balanced')} onPress={() => router.push('/settings/coach-tone')} colors={colors} />
        <MenuRow icon="timer-outline" color={colors.purple} label="IF penceresi" value={profile?.if_eating_start ? `${profile.if_eating_start}-${profile.if_eating_end}` : 'Kapalı'} onPress={() => router.push('/settings/if-settings')} colors={colors} />
        <MenuRow icon="time-outline" color={colors.textSecondary} label="Gün dönümü" value={`${(profile?.day_boundary_hour as number) ?? 4}:00`} onPress={() => router.push('/settings/day-boundary')} colors={colors} />
        {/* FIX (audit false-Yok, safety): fetch error ⇒ 'Yüklenemedi', never a confident 'Yok'. */}
        <MenuRow icon="restaurant-outline" color={colors.fat} label="Alerjenler" value={allergens === null ? '—' : allergens.length ? allergens.join(', ') : 'Yok'} onPress={() => router.push('/settings/food-preferences')} colors={colors} />
        {/* FIX (audit raw-enum): 'busy_work' vb. ham enum yerine Türkçe etiket.
            FIX (audit premium-parity): settings/index ile aynı premium rozet + kapı. */}
        <MenuRow icon="calendar-outline" color={colors.pink} label="Dönemsel durum" value={profile?.periodic_state ? PERIODIC_LABELS[profile.periodic_state as PeriodicState] ?? String(profile.periodic_state) : 'Normal'} premium={!isPremium} onPress={isPremium ? () => router.push('/settings/periodic-state') : () => requirePremium(() => router.push('/settings/periodic-state'), 'Dönemsel Durum')} colors={colors} />
        {/* FIX (ux-ideas #16): rozet/challenge vitrini — Ayarlar derinine gömülü kalmasın,
            profilden tek dokunuşla erişilsin. */}
        <MenuRow icon="ribbon-outline" color={colors.warning} label="Başarımlar" onPress={() => router.push('/settings/achievements')} colors={colors} />
        <MenuRow icon="trophy-outline" color={colors.warning} label="Challenge'lar" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/challenges') : () => requirePremium(() => router.push('/settings/challenges'), "Challenge'lar")} colors={colors} />
        {/* FIX (audit: keşfedilemez IA) — Premium ve Hesap Güvenliği birinci-sınıf
            satırlar; 'Tüm ayarlar' Veri&gizlilik yerine semantik olarak doğru
            Ayarlar bölümünde, scroll gerektirmeden bulunabilir. */}
        {/* FREE LAUNCH: paywall entry hidden while everything is free */}
        {!FREE_LAUNCH && <MenuRow icon="star-outline" color={colors.warning} label="Premium" onPress={() => router.push('/settings/premium')} colors={colors} />}
        <MenuRow icon="shield-checkmark-outline" color={colors.primary} label="Hesap güvenliği" onPress={() => router.push('/settings/account-security')} colors={colors} />
        <MenuRow icon="settings-outline" color={colors.textSecondary} label="Tüm ayarlar" onPress={() => router.push('/settings' as never)} colors={colors} last />
      </MenuGroup>

      {/* 5.6 Data & Privacy section */}
      <SectionTitle label="Veri & gizlilik" colors={colors} />
      <MenuGroup colors={colors}>
        {/* FIX (audit naming): tek kanonik özellik adı — 'Kochko Seni Nasıl Tanıyor'. */}
        <MenuRow icon="eye-outline" color={colors.purple} label="Kochko seni nasıl tanıyor" onPress={() => router.push('/settings/coach-memory')} colors={colors} />
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
        <Text style={{ ...TYPE.bodyStrong, color: colors.textMuted }}>Çıkış yap</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionTitle({ label, colors }: { label: string; colors: any }) {
  return (
    // FIX (ux-pass5): textTransform:'uppercase' locale bilmez — 'Veri & gizlilik' iOS/EN-locale
    // Android'de 'VERI & GIZLILIK' oluyordu. Metin tr-TR ile büyütülür, CSS transform kaldırıldı
    // (PlanOverviewCards #11e ile aynı desen).
    <Text style={{ ...TYPE.overline, color: colors.textMuted, marginBottom: SPACING.sm }}>
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
      <Text style={{ ...TYPE.caption, color: colors.textMuted, marginBottom: SPACING.xs }}>{label}</Text>
      <Text style={{ ...(small ? TYPE.caption : TYPE.title3), color: colors.text, fontWeight: '700' }}>{value}</Text>
      {unit ? <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>{unit}</Text> : null}
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
        {/* Settings rows are a long list the user SCANS, and each one is a tap target. At 13px the
            label was smaller than the app's own reading size, so the densest screen was also the
            hardest to read. TYPE.body is the reading step. */}
        <Text style={{ ...TYPE.body, color: label.includes('sil') ? colors.error : colors.text }}>{label}</Text>
      </View>
      {value && <Text style={{ ...TYPE.caption, color: colors.textMuted, marginRight: SPACING.sm }}>{value}</Text>}
      {premium && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginRight: SPACING.sm }}>
          <Ionicons name="lock-closed" size={11} color={colors.primary} />
          <Text style={{ ...TYPE.footnote, color: colors.primary, fontWeight: '600' }}>Premium</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
