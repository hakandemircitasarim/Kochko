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

  // FIX (audit UX-PRM-04): the old heuristic was `isActive && premiumExpiresAt != null &&
  // daysSinceSignup < 7`, which misclassified a PAID subscriber as a trialist — a monthly
  // payer also has premium_expires_at set, and if they subscribe within 7 days of signup
  // (common) daysSinceSignup<7 holds, so the screen showed "Deneme Süresi / Aboneliğe Geç"
  // to someone who already paid. We can't query the subscriptions.tier here (sync hook), but
  // we can use signals that ONLY a trial satisfies:
  //   1. trial_used must be true (it flips true the instant a trial starts; a never-trialed
  //      paid subscriber has trial_used=false), AND
  //   2. the remaining premium window is ≤ ~8 days. A trial's premium_expires_at is
  //      started_at + 7 days (migration 053); a paid monthly window is ~30d and yearly ~365d,
  //      so this also excludes a user who trialed earlier and has since upgraded to a paid tier.
  const trialUsed = (profile as Record<string, unknown>)?.trial_used === true;
  const TRIAL_WINDOW_DAYS = 8; // 7-day trial + 1-day buffer for clock skew
  const premiumDaysLeft = premiumExpiresAt
    ? (new Date(premiumExpiresAt).getTime() - Date.now()) / 86400000
    : Infinity;
  const isInTrial = isActive && premiumExpiresAt != null && trialUsed && premiumDaysLeft <= TRIAL_WINDOW_DAYS;
  const trialDaysLeft = isInTrial && premiumExpiresAt
    ? Math.max(0, Math.ceil((new Date(premiumExpiresAt).getTime() - Date.now()) / 86400000))
    : 0;

  const effectivePremium = isActive || isInTrial;

  const requirePremium = (action: () => void, featureName?: string) => {
    if (effectivePremium) {
      action();
      return;
    }
    // FIX (audit: accent sweep) restore Turkish diacritics in premium-upsell Alert.
    Alert.alert(
      'Premium Özellik',
      featureName
        ? `"${featureName}" Premium abonelik gerektirir.`
        : 'Bu özellik Premium abonelik gerektirir.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: "Premium'a Geç", onPress: () => router.push('/settings/premium' as never) },
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
