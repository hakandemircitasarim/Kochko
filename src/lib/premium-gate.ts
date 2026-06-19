/**
 * Premium Feature Gate (Spec 19.0)
 *
 * Single source of truth for which features require premium and how
 * client code should check access. UI layer uses `useFeatureAccess(key)`
 * hook or `checkFeature(key)` function to conditionally render/execute.
 *
 * Server-side checks stay in ai-chat / guardrails; this file is the
 * client-side gate that prevents the user from even attempting a gated
 * action when their tier doesn't allow it.
 */
import { useProfileStore } from '@/stores/profile.store';

/**
 * Feature keys: exhaustive list of gated capabilities.
 * New features must be added here so gating is opt-in rather than opt-out.
 */
export type FeatureKey =
  // Free tier (always accessible once signed in)
  | 'basic_logging'
  | 'barcode_scanning'
  | 'basic_reports'
  | 'profile_management'
  | 'step_counter'
  // Premium-gated
  | 'unlimited_ai_chat'
  | 'daily_plan_generation'
  | 'advanced_reports'
  | 'photo_logging'
  | 'voice_input'
  | 'weekly_menu_planning'
  | 'recipe_library'
  | 'simulation_mode'
  | 'recovery_mode'
  | 'plateau_management'
  | 'maintenance_mode'
  | 'strength_progression'
  | 'challenge_module'
  | 'predictive_analytics'
  | 'portion_calibration'
  | 'multi_phase_goals'
  | 'proactive_notifications'
  | 'periodic_state_tuning'
  | 'progress_photo_tracking'
  | 'weekly_budget_tracking'
  | 'health_pro_export';

const FREE_TIER_FEATURES = new Set<FeatureKey>([
  'basic_logging',
  'barcode_scanning',
  'basic_reports',
  'profile_management',
  'step_counter',
]);

/**
 * Single client-side definition of "premium is active right now".
 * Mirrors the server gate (ai-chat/index.ts: premium === true && (!expires || expires > now)).
 * profiles.premium can stay true for ~1-2 days past premium_expires_at because the
 * nightly expiry cron only flips subscriptions older than the 1-day grace — so every
 * gate MUST also honor premium_expires_at, not just the boolean.
 */
export function isActivePremium(
  profile: { premium?: boolean | null; premium_expires_at?: string | null } | null | undefined,
): boolean {
  if (!profile?.premium) return false;
  const exp = profile.premium_expires_at;
  return !exp || new Date(exp) > new Date();
}

export interface FeatureAccess {
  allowed: boolean;
  reason: 'free_tier_allowed' | 'premium_active' | 'trial_active' | 'needs_premium' | 'trial_expired';
  tier: 'free' | 'trial' | 'premium';
  expiresAt: string | null;
}

/**
 * Check current user's access to a given feature.
 * Reads profile from the store — caller is responsible for ensuring profile is loaded.
 */
export function checkFeature(key: FeatureKey): FeatureAccess {
  const profile = useProfileStore.getState().profile as { premium?: boolean; premium_expires_at?: string | null } | null;
  const expiresAt = (profile?.premium_expires_at as string | null) ?? null;
  // Active premium honors expiry — an expired premium (premium=true but past expires_at,
  // during the cron grace window) must NOT be granted gated features.
  const active = isActivePremium(profile);
  const trialActive = active && expiresAt !== null; // timed active premium == trial or paid

  if (FREE_TIER_FEATURES.has(key)) {
    return { allowed: true, reason: 'free_tier_allowed', tier: trialActive ? 'trial' : (active ? 'premium' : 'free'), expiresAt };
  }

  if (active) {
    return {
      allowed: true,
      reason: trialActive ? 'trial_active' : 'premium_active',
      tier: trialActive ? 'trial' : 'premium',
      expiresAt,
    };
  }

  // Not active (never premium, or premium expired) → show upsell
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return { allowed: false, reason: 'trial_expired', tier: 'free', expiresAt };
  }

  return { allowed: false, reason: 'needs_premium', tier: 'free', expiresAt };
}

/**
 * React hook wrapper. Re-renders when profile changes.
 */
import { useProfileStore as _useProfileStore } from '@/stores/profile.store';
import { useMemo } from 'react';

export function useFeatureAccess(key: FeatureKey): FeatureAccess {
  const profile = _useProfileStore(s => s.profile);
  return useMemo(() => {
    // We read store inside checkFeature so hook gives stable ref per profile change
    void profile; // dependency tracking
    return checkFeature(key);
  }, [profile, key]);
}

/**
 * Convenience: require premium before running a callback. If not premium,
 * returns false and caller should show the paywall.
 */
export function requirePremium(key: FeatureKey): boolean {
  return checkFeature(key).allowed;
}

/**
 * Plan approval gate (MASTER_PLAN §4.7, Phase 6).
 *
 * Free tier: 1 lifetime approved diet plan + 1 lifetime approved workout plan.
 * Additional approvals require premium. Draft creation/regeneration is free;
 * only the moment a draft becomes active (plans_used_free incremented server-side)
 * consumes a quota slot.
 *
 * Returns { allowed, reason } — caller shows paywall when allowed=false.
 */
export interface PlanApprovalGate {
  allowed: boolean;
  reason: 'free_tier_available' | 'premium_active' | 'free_quota_used';
  usedCount: number;
  freeLimit: 1;
}

export function canApprovePlan(planType: 'diet' | 'workout'): PlanApprovalGate {
  const profile = useProfileStore.getState().profile as
    | { premium?: boolean; premium_expires_at?: string | null; plans_used_free?: { diet?: number; workout?: number } | null }
    | null;
  // Honor premium_expires_at so the client gate matches the server plan-cap gate
  // (ai-chat/index.ts:991) — otherwise an expired-premium user would be shown an
  // approval the server then rejects with free_quota_used (approve-then-bounce).
  const isPremium = isActivePremium(profile);
  const used = profile?.plans_used_free?.[planType] ?? 0;

  if (isPremium) {
    return { allowed: true, reason: 'premium_active', usedCount: used, freeLimit: 1 };
  }

  if (used < 1) {
    return { allowed: true, reason: 'free_tier_available', usedCount: used, freeLimit: 1 };
  }

  return { allowed: false, reason: 'free_quota_used', usedCount: used, freeLimit: 1 };
}
