/**
 * Premium feature gate hook
 * Spec 16: Free vs Premium features with trial support
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useProfileStore } from '@/stores/profile.store';

export function usePremium() {
  const profile = useProfileStore(s => s.profile);
  const isPremium = profile?.premium ?? false;
  const premiumExpiresAt = (profile as Record<string, unknown>)?.premium_expires_at as string | null;
  const trialUsed = (profile as Record<string, unknown>)?.trial_used as boolean ?? false;

  // Check if premium is expired
  const isExpired = premiumExpiresAt ? new Date(premiumExpiresAt) < new Date() : false;
  const isActive = isPremium && !isExpired;

  // Check if in trial period
  const createdAt = (profile as Record<string, unknown>)?.created_at as string | null;
  const daysSinceSignup = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
  const isInTrial = !trialUsed && daysSinceSignup <= 7;
  const trialDaysLeft = isInTrial ? 7 - daysSinceSignup : 0;

  const effectivePremium = isActive || isInTrial;

  const requirePremium = (action: () => void, featureName?: string) => {
    if (effectivePremium) {
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
        { text: "Premium'a Gec", onPress: () => router.push('/settings/premium' as never) },
      ]
    );
  };

  return {
    isPremium: effectivePremium,
    isActive,
    isInTrial,
    trialDaysLeft,
    isExpired,
    requirePremium,
  };
}

/**
 * Get restriction flags when user downgrades from premium.
 * Used by UI components to gate features.
 */
export function getDowngradeRestrictions(isPremium: boolean): {
  readOnlyPlans: boolean;
  noPhotoLog: boolean;
  noVoiceLog: boolean;
  noWeeklyMenu: boolean;
  limitedAI: boolean;
} {
  if (isPremium) {
    return {
      readOnlyPlans: false,
      noPhotoLog: false,
      noVoiceLog: false,
      noWeeklyMenu: false,
      limitedAI: false,
    };
  }

  return {
    readOnlyPlans: true,
    noPhotoLog: true,
    noVoiceLog: true,
    noWeeklyMenu: true,
    limitedAI: true,
  };
}
