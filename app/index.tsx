import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useEffect } from 'react';
import { COLORS } from '@/lib/constants';

export default function Index() {
  const { session, initialized } = useAuthStore();
  const { profile, fetchProfile } = useProfileStore();

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfile(session.user.id);
    }
  }, [session?.user?.id, fetchProfile]);

  if (!initialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (profile && !profile.onboarding_completed) {
    // Conversation-based onboarding - coach introduces itself via chat
    return <Redirect href="/(tabs)/chat" />;
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
