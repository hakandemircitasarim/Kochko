/**
 * Subscription Service (Spec 19.0)
 *
 * Wraps RevenueCat + local `subscriptions` table reads. Keeps a single
 * source of truth: server-side `subscriptions` table updated by RevenueCat
 * webhooks. Client reads here for gating UI and offers purchase flow.
 *
 * Native RevenueCat SDK is not yet wired — calls are stubbed behind feature
 * flag. All server logic still works via webhook (manual row insert ok).
 */
import { supabase } from '@/lib/supabase';

// FIX (audit UX-PRM-08): single source of truth for "is the native IAP purchase path live?".
// While the RevenueCat SDK is not wired, initiatePurchase/restorePurchases can only fail, so the
// paywall must NOT advertise live $9.99/$79.99 pricing or a Subscribe/Restore button that always
// dead-ends — that is an App Store / Play review blocker. The premium screen reads this flag to
// hide the pricing + Subscribe + Restore affordances and surface the 7-day free trial CTA instead.
// Flip to true (and wire @revenuecat/purchases-react-native) when the native build ships IAP.
export const PURCHASE_ENABLED = false;

export type SubscriptionTier = 'free' | 'trial' | 'monthly' | 'yearly' | 'lifetime';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'grace_period' | 'paused';

export interface Subscription {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  provider: string | null;
  product_id: string | null;
  started_at: string;
  renewed_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
}

/**
 * Get the current user's active subscription (if any).
 */
export async function getActiveSubscription(): Promise<Subscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .in('status', ['active', 'trial', 'grace_period'])
    .order('expires_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as Subscription | null);
}

/**
 * Derive premium state from subscription row.
 * Kept consistent with server trigger sync_profile_premium().
 */
export function isPremiumActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (!['active', 'grace_period'].includes(sub.status)) return false;
  if (sub.tier === 'free') return false;
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) return false;
  return true;
}

/**
 * Start a 7-day trial for a new user. Idempotent — if trial already used, no-op.
 * Writes row with tier='trial', status='active', expires_at = +7d.
 * RevenueCat integration later will override provider + receipt.
 */
export async function startTrialIfEligible(userId: string): Promise<{ started: boolean; reason?: string }> {
  // FIX (audit DB/HIGH — trial self-grant): direct subscriptions INSERT is no longer permitted
  // (migration 053 dropped the subscriptions_ins policy that didn't check trial_used). Trial
  // creation now goes through the SECURITY DEFINER RPC start_trial_if_eligible, which locks the
  // profile row, verifies trial_used + no active sub, then inserts the trial row AND flips
  // trial_used in ONE transaction — race-free and not bypassable via raw PostgREST.
  const { data, error } = await supabase.rpc('start_trial_if_eligible', { uid: userId });
  if (error) return { started: false, reason: error.message };
  const res = (data ?? {}) as { started?: boolean; reason?: string };
  return { started: !!res.started, reason: res.reason };
}

/**
 * Days remaining on trial or paid subscription. null if no subscription or no expiry.
 */
export function daysRemaining(sub: Subscription | null): number | null {
  if (!sub?.expires_at) return null;
  const ms = new Date(sub.expires_at).getTime() - Date.now();
  if (ms < 0) return 0;
  return Math.ceil(ms / 86400000);
}

/**
 * Initiate purchase via native SDK (RevenueCat). Not wired yet — returns a
 * clear error so the paywall can show "coming soon" or fall back to web checkout.
 */
export async function initiatePurchase(_productId: 'monthly' | 'yearly'): Promise<{ ok: boolean; error?: string }> {
  // TODO: wire @revenuecat/purchases-react-native once native build is rebuilt
  return { ok: false, error: 'native_sdk_not_wired' };
}

/**
 * Restore purchases via native SDK. Stub for now.
 */
export async function restorePurchases(): Promise<{ ok: boolean; error?: string }> {
  // TODO: wire RevenueCat.restorePurchases()
  return { ok: false, error: 'native_sdk_not_wired' };
}
