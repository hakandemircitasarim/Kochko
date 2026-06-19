import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

export default function Index() {
  const { session, initialized } = useAuthStore();
  const { profile, fetchError, fetch: fetchProfile, reactivateAccount } = useProfileStore();

  useEffect(() => {
    if (session?.user?.id) fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  // Reactivate soft-deleted accounts on re-login (30-day recovery window).
  // Checks BOTH columns: the profile-tab deletion path sets only
  // deletion_requested_at (deleted_at stays null), and gating on deleted_at
  // alone meant a returning user was still hard-deleted by the day-30 cron.
  useEffect(() => {
    const p = profile as Record<string, unknown> | null;
    if ((p?.deleted_at || p?.deletion_requested_at) && session?.user?.id) {
      reactivateAccount(session.user.id);
    }
  }, [
    (profile as Record<string, unknown> | null)?.deleted_at,
    (profile as Record<string, unknown> | null)?.deletion_requested_at,
    session?.user?.id,
    reactivateAccount,
  ]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
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
            style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl }}
          >
            <Text style={{ color: '#fff', fontSize: FONT.md, fontWeight: '600' }}>Tekrar dene</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Spec 15: New users go to structured onboarding flow
  if (!profile.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}
