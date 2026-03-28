import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';

/**
 * Convenience hook that fetches profile when user is available.
 */
export function useProfile() {
  const user = useAuthStore(s => s.user);
  const { profile, loading, fetch: fetchProfile } = useProfileStore();

  useEffect(() => {
    if (user?.id && !profile) fetchProfile(user.id);
  }, [user?.id, profile, fetchProfile]);

  return { profile, loading, userId: user?.id ?? null };
}
