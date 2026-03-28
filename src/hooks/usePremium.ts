/**
 * Premium feature gate hook
 * Spec 16: Free vs Premium features
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useProfileStore } from '@/stores/profile.store';

export function usePremium() {
  const profile = useProfileStore(s => s.profile);
  const isPremium = profile?.premium ?? false;

  const requirePremium = (action: () => void, featureName?: string) => {
    if (isPremium) {
      action();
      return;
    }
    Alert.alert(
      'Premium Ozellik',
      featureName
        ? `"${featureName}" Premium abonelik gerektirir.`
        : 'Bu ozellik Premium abonelik gerektirir.',
      [
        { text: 'Iptal', style: 'cancel' },
        { text: "Premium'a Gec", onPress: () => router.push('/settings' as never) },
      ]
    );
  };

  return { isPremium, requirePremium };
}
