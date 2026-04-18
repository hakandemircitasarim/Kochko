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
  const { data: profile } = await supabase
    .from('profiles').select('trial_used').eq('id', userId).maybeSingle();
  if (profile?.trial_used) return { started: false, reason: 'trial_already_used' };

  const { data: existing } = await supabase
    .from('subscriptions').select('id').eq('user_id', userId)
    .in('status', ['active', 'trial', 'grace_period']).limit(1).maybeSingle();
  if (existing) return { started: false, reason: 'already_active' };

  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const { error } = await supabase.from('subscriptions').insert({
    user_id: userId,
    tier: 'trial',
    status: 'active',
    provider: 'manual',
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  if (error) return { started: false, reason: error.message };

  await supabase.from('profiles').update({ trial_used: true }).eq('id', userId);
  return { started: true };
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
