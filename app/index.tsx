import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { COLORS } from '@/lib/constants';

export default function Index() {
  const { session, initialized } = useAuthStore();
  const { profile, fetch: fetchProfile, reactivateAccount } = useProfileStore();

  useEffect(() => {
    if (session?.user?.id) fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  // Reactivate soft-deleted accounts on re-login (30-day recovery window)
  useEffect(() => {
    const p = profile as Record<string, unknown> | null;
    if (p?.deleted_at && session?.user?.id) {
      reactivateAccount(session.user.id);
    }
  }, [(profile as Record<string, unknown> | null)?.deleted_at, session?.user?.id, reactivateAccount]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  // Spec 15: New users go to structured onboarding flow
  if (profile && !profile.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}
