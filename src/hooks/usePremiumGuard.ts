import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useProfileStore } from '@/stores/profile.store';

/**
 * Hook for gating premium features.
 * Returns a function that checks premium status before executing an action.
 * If not premium, shows paywall prompt.
 */
export function usePremiumGuard() {
  const profile = useProfileStore((s) => s.profile);

  const requirePremium = (action: () => void) => {
    if (profile?.premium) {
      action();
      return;
    }

    Alert.alert(
      'Premium Özellik',
      'Bu özellik Premium abonelik gerektirir.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: "Premium'a Geç", onPress: () => router.push('/settings/premium') },
      ]
    );
  };

  return { isPremium: profile?.premium ?? false, requirePremium };
}
