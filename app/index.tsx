import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

export default function Index() {
  const { session, initialized, signOut } = useAuthStore();
  const { profile, fetchError, fetch: fetchProfile, reactivateAccount } = useProfileStore();
  // FIX (audit DB-PRV-05): true while the user is canceling a pending deletion, so the
  // reactivation spinner shows instead of the confirmation screen re-appearing mid-write.
  const [reactivating, setReactivating] = useState(false);

  useEffect(() => {
    if (session?.user?.id) fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          accessibilityLabel="Yükleniyor"
        />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  // Wait for the authed user's profile to resolve before routing — otherwise a new
  // user whose profile hasn't loaded yet falls through to /(tabs) and SKIPS the
  // onboarding gate (#R5-5), and an onboarded user would flash the onboarding
  // screen. Spin until the profile is present (mig 044 guarantees a row exists, so
  // a successful fetch always returns one).
  if (!profile) {
    // If the fetch FAILED (transient/network) there's no prior profile to fall back
    // on at cold start — offer a retry instead of spinning forever (#R7-2).
    if (fetchError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, textAlign: 'center', marginBottom: SPACING.lg }}>
            Profilin yüklenemedi. İnternet bağlantını kontrol et.
          </Text>
          <TouchableOpacity
            onPress={() => { if (session?.user?.id) fetchProfile(session.user.id); }}
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.md, fontWeight: '600' }}>Tekrar dene</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          accessibilityLabel="Profilin yükleniyor"
        />
      </View>
    );
  }

  // FIX (audit DB-PRV-05): a re-login no longer SILENTLY reactivates a profile that is
  // pending deletion. Strict KVKK/GDPR practice is to confirm intent before reversing a
  // documented deletion request — a user logging in only to take an export should not have
  // their request quietly canceled. Detect the pending state (BOTH columns: the profile-tab
  // path sets deletion_requested_at, the settings path sets both) and ask explicitly; only
  // an explicit "cancel deletion" choice calls reactivateAccount(). "Keep deleting" signs out
  // so the day-30 cron proceeds as scheduled.
  const pendingProfile = profile as Record<string, unknown>;
  const deletionRequestedRaw =
    (pendingProfile.deletion_requested_at as string | null | undefined) ??
    (pendingProfile.deleted_at as string | null | undefined);
  if (deletionRequestedRaw && !reactivating) {
    const requestedAt = new Date(deletionRequestedRaw);
    const completesAt = new Date(requestedAt.getTime());
    completesAt.setDate(completesAt.getDate() + 30); // 30-day grace window (Spec 1.4)
    const fmt = (d: Date) =>
      isNaN(d.getTime()) ? '' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    const requestedStr = fmt(requestedAt);
    const completesStr = fmt(completesAt);

    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center', marginBottom: SPACING.lg }}>
          Hesap silme talebi bekliyor
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, lineHeight: 22, textAlign: 'center', marginBottom: SPACING.xxl }}>
          {requestedStr
            ? `${requestedStr} tarihinde hesabını silmek istedin. Talep ${completesStr} tarihinde tamamlanacak ve tüm verilerin kalıcı olarak silinecek.`
            : `Hesabın silinmek üzere işaretli. Talep tamamlandığında tüm verilerin kalıcı olarak silinecek.`}
        </Text>
        <TouchableOpacity
          onPress={() => {
            if (!session?.user?.id) return;
            setReactivating(true);
            reactivateAccount(session.user.id);
          }}
          accessibilityRole="button"
          accessibilityLabel="Silmeyi iptal et"
          style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center', alignSelf: 'stretch', alignItems: 'center', marginBottom: SPACING.md }}
        >
          <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.md, fontWeight: '600' }}>Silmeyi iptal et</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { signOut(); }}
          accessibilityRole="button"
          accessibilityLabel="Silmeye devam et"
          style={{ borderColor: COLORS.error, borderWidth: 1, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center', alignSelf: 'stretch', alignItems: 'center' }}
        >
          <Text style={{ color: COLORS.error, fontSize: FONT.md, fontWeight: '600' }}>Silmeye devam et</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Spec 15: New users go to structured onboarding flow
  if (!profile.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}
