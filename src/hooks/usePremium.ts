/**
 * Premium feature gate hook
 * Spec 16: Free vs Premium features with trial support
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useProfileStore } from '@/stores/profile.store';
import { isActivePremium } from '@/lib/premium-gate';

export function usePremium() {
  const profile = useProfileStore(s => s.profile);
  const isPremium = profile?.premium ?? false;
  const premiumExpiresAt = (profile as Record<string, unknown>)?.premium_expires_at as string | null;

  // Check if premium is expired
  const isExpired = premiumExpiresAt ? new Date(premiumExpiresAt) < new Date() : false;
  const isActive = isActivePremium(profile as { premium?: boolean | null; premium_expires_at?: string | null } | null);

  // Trial state: trial_used flips to true the instant a trial STARTS (subscription.service),
  // so it can't mean "currently in trial". Derive trial from the ACTIVE timed-premium window
  // inside the first 7 days instead — this re-enables the trial countdown UI + 2-day reminder
  // that were permanently dead while keyed on trial_used.
  const createdAt = (profile as Record<string, unknown>)?.created_at as string | null;
  const daysSinceSignup = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;
  const isInTrial = isActive && premiumExpiresAt != null && daysSinceSignup < 7;
  const trialDaysLeft = isInTrial && premiumExpiresAt
    ? Math.max(0, Math.ceil((new Date(premiumExpiresAt).getTime() - Date.now()) / 86400000))
    : 0;

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
