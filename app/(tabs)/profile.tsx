/**
 * Profil Sekmesi — Duolingo profil dili (§0-A / §0-B)
 * Halkalı avatar + isim + seri, canlı pastel ve gövdeli istatistik kutucukları,
 * sıradaki rozet (madalyon + ProgressBar), gruplu menüler (SettingsList), veri & gizlilik.
 */
import { useState, useCallback } from 'react';
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
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { SettingsGroup, SettingsRow, SettingsIcon } from '@/components/settings/SettingsList';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { BadgeMedal } from '@/components/profile/BadgeMedal';
import { deleteAISummaryNote, resetAISummary } from '@/services/privacy.service';
import { useTheme, METRIC_COLORS, type ThemeColors } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, mix } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { goalLabelTR, coachToneLabelTR } from '@/lib/labels';
import { calculateProfileCompletion, CATEGORY_LABELS } from '@/lib/profile-completion';

import { FREE_LAUNCH } from '@/lib/premium-gate';
import { formatDecimal } from '@/lib/units';
export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
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

  // Gövdeli kartların gri gövdesi (Button outline / ChoiceTile kuralı).
  const greyEdge = isDark ? colors.border : colors.progressTrack;
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
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
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
          activeOpacity={MOTION.pressOpacity}
          accessibilityRole="button"
          accessibilityLabel="Profili düzenle"
          style={{ alignItems: 'center' }}
        >
          {/* Duolingo avatarı: marka halkası (4px) + zemin renginde boşluk halkası + pastel yüz.
              Sağ altta küçük gövdeli kalem rozeti "dokun, düzenle" ipucunu taşır. 64px'lik
              soluk daire profilin en karakterli yeri olması gereken yerde sönük kalıyordu. */}
          <View style={{ marginBottom: SPACING.md }}>
            <View style={{
              width: 104, height: 104, borderRadius: 52, borderWidth: 4, borderColor: colors.primary,
              padding: 4, backgroundColor: colors.background,
            }}>
              <View style={{
                flex: 1, borderRadius: 999,
                backgroundColor: mix(colors.primary, colors.background, isDark ? 0.28 : 0.16),
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ ...TYPE.title1, color: colors.primary }}>{initials}</Text>
              </View>
            </View>
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{
                position: 'absolute', right: -2, bottom: 2, width: 32, height: 32, borderRadius: 16,
                backgroundColor: colors.card, borderWidth: 2, borderColor: isDark ? colors.border : colors.progressTrack,
                borderBottomWidth: 4, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="pencil" size={14} color={colors.primary} />
            </View>
          </View>
          <Text style={{ ...TYPE.title2, color: colors.text, textAlign: 'center' }}>{displayName}</Text>
        </TouchableOpacity>
        {user?.email && (
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>{user.email}</Text>
        )}
        {/* Katılım günü ve seri yan yana iki küçük hap: "kim olduğun" satırı. */}
        {(memberDays != null || streak > 0) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md, flexWrap: 'wrap', justifyContent: 'center' }}>
            {memberDays != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingVertical: SPACING.xs + 1, paddingHorizontal: SPACING.sm + 4, backgroundColor: mix(colors.primary, colors.background, isDark ? 0.2 : 0.1) }}>
                <Ionicons name="calendar" size={13} color={colors.primary} />
                <Text style={{ ...TYPE.caption, color: colors.primary, fontWeight: '700' }}>
                  {memberDays === 0 ? "Bugün Kochko'ya katıldın" : `${memberDays} gündür Kochko'da`}
                </Text>
              </View>
            )}
            {streak > 0 && <StreakBadge days={streak} />}
          </View>
        )}
        {/* FIX (ux-ideas #4): trial users saw no countdown anywhere they naturally look —
            surface the remaining days + a soft "Kalıcı yap" on the profile card. */}
        {isInTrial && (
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/settings/premium'); }}
            activeOpacity={MOTION.pressOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Deneme ${trialDaysLeft} gün sonra bitiyor. Premium'a geçmek için dokun`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.sm,
              // Kehribar dolgu + mürekkep (kural 7): kehribar METİN açık temada AA altındaydı.
              backgroundColor: METRIC_COLORS.streak, borderRadius: RADIUS.pill,
              paddingHorizontal: SPACING.md, paddingVertical: 4,
            }}
          >
            <Ionicons name="time-outline" size={13} color={PLATE_INK} />
            <Text style={{ ...TYPE.caption, color: PLATE_INK, fontWeight: '700' }}>Deneme • {trialDaysLeft} gün kaldı</Text>
            <Text style={{ ...TYPE.caption, color: PLATE_INK, fontWeight: '800', marginLeft: 4, textDecorationLine: 'underline' }}>Kalıcı yap</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 5.2 Physical info — 3 column grid.
          FIX (audit duplicate-label): 'Mevcut / Hedef / Hedef' → third box is the goal TYPE,
          relabeled 'Amaç' so the two boxes are distinct.
          FIX (audit false-Yok): on goal fetch error render '—' instead of a confident '-'. */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xxl }}>
        {/* FIX (ux-polish): TR comma decimals to match every other weight surface (was "72.5 kg"). */}
        {/* Kutucuklar StatStrip'in plaka diliyle: renkli ikon plakası + pastel opak yüz + koyu raf. */}
        <InfoBox icon="scale-outline" color={METRIC_COLORS.weight} label="Mevcut" value={profile?.weight_kg ? String(profile.weight_kg).replace('.', ',') : '-'} unit="kg" colors={colors} isDark={isDark} />
        <InfoBox icon="flag" color={METRIC_COLORS.calories} label="Hedef" value={goalLoadError ? '—' : goal?.target_weight_kg ? String(goal.target_weight_kg).replace('.', ',') : '-'} unit="kg" colors={colors} isDark={isDark} />
        <InfoBox icon="compass-outline" color={METRIC_COLORS.water} label="Amaç" value={goalLoadError ? '—' : goal ? goalLabelTR(goal.goal_type) : '-'} unit="" colors={colors} isDark={isDark} small />
      </View>

      {/* FIX (ux-ideas #14): profile-completion nudge lives where edits actually happen. The
          donut was dashboard-only; here a gentle bar + the lowest-filled category + a one-tap
          route collects the data the coach needs for a good plan, without nagging. */}
      {profile && (() => {
        const comp = calculateProfileCompletion(profile as Record<string, unknown>);
        if (comp.percentage >= 100) return null;
        return (
          // Dokunulabilir kart = gövdeli (§0-B kural 1): gri çerçeve + gri raf, basınca iner.
          <ShelfPressable
            onPress={() => { haptics.tap(); router.push('/settings/edit-profile'); }}
            accessibilityRole="button"
            accessibilityLabel={`Profilin yüzde ${comp.percentage} tamamlandı.${comp.lowestCategory ? ` Sıradaki: ${CATEGORY_LABELS[comp.lowestCategory]}.` : ''} Düzenlemek için dokun`}
            shelfColor={greyEdge}
            radius={RADIUS.lg}
            style={{ marginBottom: SPACING.lg }}
            faceStyle={{ backgroundColor: colors.card, borderWidth: 2, borderColor: greyEdge, padding: SPACING.lg }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md }}>
              <SettingsIcon icon="person" color={colors.primary} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...TYPE.headline, color: colors.text, fontWeight: '700' }}>Profilini tamamla</Text>
                <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>%{comp.percentage} tamam</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </View>
            <ProgressBar progress={comp.percentage / 100} color={colors.primary} height={12} />
            {comp.lowestCategory && (
              <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.sm }}>
                Sıradaki: {CATEGORY_LABELS[comp.lowestCategory]} ekle — koçun daha isabetli plan yapsın.
              </Text>
            )}
          </ShelfPressable>
        );
      })()}

      {/* FIX (ux-ideas #16): "Sıradaki rozet" — a concrete target to chase, with progress.
          Rozet vitriniyle aynı dil: kilitli (gri) seri madalyonu + kehribar ProgressBar;
          kart başarımlar vitrinine götürür (gövdeli). */}
      {nextBadge && (
        <ShelfPressable
          onPress={() => { haptics.tap(); router.push('/settings/achievements'); }}
          accessibilityRole="button"
          accessibilityLabel={`Sıradaki rozet: ${nextBadge.label}. ${nextBadge.remaining} gün kaldı. Başarımları görmek için dokun`}
          shelfColor={greyEdge}
          radius={RADIUS.lg}
          style={{ marginBottom: SPACING.xxl }}
          faceStyle={{ backgroundColor: colors.card, borderWidth: 2, borderColor: greyEdge, padding: SPACING.lg, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}
        >
          <BadgeMedal icon="flame" family="streak" earned={false} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...TYPE.overline, color: colors.textSecondary }}>{'Sıradaki rozet'.toLocaleUpperCase('tr-TR')}</Text>
            <Text style={{ ...TYPE.headline, color: colors.text, fontWeight: '700', marginTop: 2 }}>{nextBadge.label}</Text>
            <ProgressBar progress={nextBadge.progress} color={METRIC_COLORS.streak} height={12} style={{ marginTop: SPACING.sm }} />
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.xs }}>
              {nextBadge.remaining === 1 ? 'Yarın kazanıyorsun!' : `${nextBadge.remaining} gün kaldı — seriyi koru!`}
            </Text>
          </View>
        </ShelfPressable>
      )}

      {/* 5.4 Goals section */}
      <SectionHeader title="Hedefler" />
      <SettingsGroup style={{ marginBottom: SPACING.xl }}>
        <SettingsRow icon="flag-outline" color={colors.primary} label={goalLoadError ? 'Hedef yüklenemedi' : goal ? `${goalLabelTR(goal.goal_type)}${goal.target_weight_kg ? ` - ${formatDecimal(goal.target_weight_kg)} kg` : ''}` : 'Hedef belirle'} onPress={() => router.push('/settings/goals')} />
        {/* FIX (completeness audit): 'Güç hedefi' now routes to the real strength screen (was the
            weight-goal editor). 'Uyku hedefi' removed — no sleep-goal screen exists, so the row
            promised a feature the app doesn't have and dead-ended in the weight-goal form. */}
        {/* FIX (audit premium-parity): gate like settings/index — free users get the paywall
            prompt instead of a frame-flash then paywall replace inside the screen. */}
        <SettingsRow icon="barbell-outline" color={colors.purple} label="Güç hedefi" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/strength') : () => requirePremium(() => router.push('/settings/strength'), 'Güç Progresyon')} last />
      </SettingsGroup>

      {/* 5.5 Settings section */}
      <SectionHeader title="Ayarlar" />
      <SettingsGroup style={{ marginBottom: SPACING.xl }}>
        <SettingsRow icon="notifications-outline" color={colors.carbs} label="Bildirim tercihleri" onPress={() => router.push('/settings/notifications')} />
        <SettingsRow icon="chatbubble-outline" color={colors.primary} label="Koç iletişim tonu" value={coachToneLabelTR((profile?.coach_tone as string) ?? 'balanced')} onPress={() => router.push('/settings/coach-tone')} />
        <SettingsRow icon="timer-outline" color={colors.purple} label="IF penceresi" value={profile?.if_eating_start ? `${profile.if_eating_start}-${profile.if_eating_end}` : 'Kapalı'} onPress={() => router.push('/settings/if-settings')} />
        <SettingsRow icon="time-outline" color={colors.textSecondary} label="Gün dönümü" value={`${(profile?.day_boundary_hour as number) ?? 4}:00`} onPress={() => router.push('/settings/day-boundary')} />
        {/* FIX (audit false-Yok, safety): fetch error ⇒ 'Yüklenemedi', never a confident 'Yok'. */}
        <SettingsRow icon="restaurant-outline" color={colors.fat} label="Alerjenler" value={allergens === null ? '—' : allergens.length ? allergens.join(', ') : 'Yok'} onPress={() => router.push('/settings/food-preferences')} />
        {/* FIX (audit raw-enum): 'busy_work' vb. ham enum yerine Türkçe etiket.
            FIX (audit premium-parity): settings/index ile aynı premium rozet + kapı. */}
        <SettingsRow icon="calendar-outline" color={colors.pink} label="Dönemsel durum" value={profile?.periodic_state ? PERIODIC_LABELS[profile.periodic_state as PeriodicState] ?? String(profile.periodic_state) : 'Normal'} premium={!isPremium} onPress={isPremium ? () => router.push('/settings/periodic-state') : () => requirePremium(() => router.push('/settings/periodic-state'), 'Dönemsel Durum')} />
        {/* FIX (ux-ideas #16): rozet/challenge vitrini — Ayarlar derinine gömülü kalmasın,
            profilden tek dokunuşla erişilsin. */}
        <SettingsRow icon="ribbon-outline" color={colors.warning} label="Başarımlar" onPress={() => router.push('/settings/achievements')} />
        <SettingsRow icon="trophy-outline" color={colors.warning} label="Challenge'lar" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/challenges') : () => requirePremium(() => router.push('/settings/challenges'), "Challenge'lar")} />
        {/* FIX (audit: keşfedilemez IA) — Premium ve Hesap Güvenliği birinci-sınıf
            satırlar; 'Tüm ayarlar' Veri&gizlilik yerine semantik olarak doğru
            Ayarlar bölümünde, scroll gerektirmeden bulunabilir. */}
        {/* FREE LAUNCH: paywall entry hidden while everything is free */}
        {!FREE_LAUNCH && <SettingsRow icon="star-outline" color={colors.warning} label="Premium" onPress={() => router.push('/settings/premium')} />}
        <SettingsRow icon="shield-checkmark-outline" color={colors.primary} label="Hesap güvenliği" onPress={() => router.push('/settings/account-security')} />
        <SettingsRow icon="settings-outline" color={colors.textSecondary} label="Tüm ayarlar" onPress={() => router.push('/settings' as never)} last />
      </SettingsGroup>

      {/* 5.6 Data & Privacy section */}
      <SectionHeader title="Veri & gizlilik" />
      <SettingsGroup style={{ marginBottom: SPACING.xl }}>
        {/* FIX (audit naming): tek kanonik özellik adı — 'Kochko Seni Nasıl Tanıyor'. */}
        {/* Koçun kendi satırı — soyut göz ikonu yerine Koçko'nun yüzü (§0-A karakter). */}
        <SettingsRow icon="eye-outline" mascot color={colors.purple} label="Kochko seni nasıl tanıyor" onPress={() => router.push('/settings/coach-memory')} />
        <SettingsRow icon="download-outline" color={colors.primary} label="Verilerimi dışa aktar" onPress={() => router.push('/settings/health-export')} />
        <SettingsRow icon="create-outline" color={colors.primary} label="Profil düzenle" onPress={() => router.push('/settings/edit-profile')} />
        {/* FIX (audit: tutarsız hesap-silme sürtünmesi) — profil sekmesindeki
            tek-tık Alert + requestAccountDeletion akışı kaldırıldı; tek
            paylaşılan, typed-confirm korumalı silme akışına (settings) yönlendir.
            FIX (audit dead-drop): plain '/settings' 30 satırlık listenin TEPESİNE bırakıyordu;
            ?openDelete=1 typed-confirm silme modalını doğrudan açar. */}
        <SettingsRow icon="trash-outline" color={colors.error} label="Hesabı sil" danger onPress={() => router.push('/settings?openDelete=1' as never)} last />
      </SettingsGroup>

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
        activeOpacity={MOTION.pressOpacity}
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

// Sabit plaka mürekkebi — StatStrip PLATE_INK ile aynı (kehribar/gül dolgu üstünde ≥3,7:1).
const PLATE_INK = '#2A2140';

// FIX (audit profile-card-drift): MenuGroup/MenuRow/SectionTitle kopyaları kaldırıldı —
// profil ve Ayarlar merkezi artık tek SettingsList (components/settings) + SectionHeader
// tanımından çiziliyor (a11y etiketi, premium hapı ve haptik aynen taşındı).

/**
 * İstatistik kutucuğu — StatStrip'in plaka diliyle (§0-A "bölüm başına canlı kart"):
 * renkli dairesel ikon plakası (mürekkep ikon) + pastel OPAK yüz + aynı rengin koyusu raf.
 * Dokunulabilir değil; raf "gövde" hissi için (yüz rafa inmez).
 */
function InfoBox({ icon, color, label, value, unit, colors, isDark, small }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; label: string; value: string; unit: string;
  colors: ThemeColors; isDark: boolean; small?: boolean;
}) {
  const face = mix(color, colors.background, isDark ? 0.18 : 0.13);
  const shelf = mix(color, colors.background, isDark ? 0.42 : 0.34);
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
      style={{ flex: 1, paddingBottom: MOTION.shelf }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: MOTION.shelf, bottom: 0, borderRadius: RADIUS.lg, backgroundColor: shelf }} />
      <View style={{ flexGrow: 1, backgroundColor: face, borderRadius: RADIUS.lg, paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, alignItems: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xs }}>
          <Ionicons name={icon} size={16} color={PLATE_INK} />
        </View>
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, fontWeight: '600' }}>{label}</Text>
        <Text numberOfLines={small ? 2 : 1} adjustsFontSizeToFit style={{ ...(small ? TYPE.bodyStrong : TYPE.title3), color: colors.text, fontWeight: '800', textAlign: 'center', marginTop: 2 }}>{value}</Text>
        {unit ? <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>{unit}</Text> : null}
      </View>
    </View>
  );
}
