import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { COLORS } from '@/lib/constants';

export default function Index() {
  const { session, initialized } = useAuthStore();
  const { profile, fetch: fetchProfile } = useProfileStore();

  useEffect(() => {
    if (session?.user?.id) fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  if (!initialized) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>;
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  // Spec 15.1: Minimum data (height, weight, birth_year, gender) required before AI can work
  if (profile && !profile.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}
