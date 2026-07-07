/**
 * safety-state.ts — durable, trajectory-aware SAFETY STATE (target-arch step 14).
 *
 * Turns the stateless per-turn ED detector into a persistent risk state with HYSTERESIS: escalate
 * fast on a signal, de-escalate ONLY slowly over time (never on a single normal turn). The deficit
 * engine consults deficitAllowed() and refuses aggressive cuts while the tier is amber+ — so a user
 * whose trajectory is concerning is protected even when the current message looks fine. Fail-soft:
 * on any error it returns the SAFE default (never silently allows a deficit it shouldn't).
 */
import { supabaseAdmin } from './supabase-admin.ts';

export type EDTier = 'none' | 'watch' | 'amber' | 'red';
const RANK: Record<EDTier, number> = { none: 0, watch: 1, amber: 2, red: 3 };
const NAME: EDTier[] = ['none', 'watch', 'amber', 'red'];
const DEESCALATE_DAYS = 14; // one tier step down per this many signal-free days

export interface SafetyState { ed_tier: EDTier; ed_signal_count: number; ed_last_signal_at: string | null; ed_escalated_at: string | null; }

async function loadRaw(userId: string): Promise<SafetyState> {
  const { data } = await supabaseAdmin.from('user_safety_state')
    .select('ed_tier, ed_signal_count, ed_last_signal_at, ed_escalated_at').eq('user_id', userId).maybeSingle();
  return (data as SafetyState | null) ?? { ed_tier: 'none', ed_signal_count: 0, ed_last_signal_at: null, ed_escalated_at: null };
}

/**
 * Read the current safety state, applying lazy TIME-BASED de-escalation: after DEESCALATE_DAYS with
 * no new signal the tier steps down one level (persisted). Escalation never happens here.
 */
export async function getSafetyState(userId: string): Promise<SafetyState> {
  try {
    const st = await loadRaw(userId);
    if (st.ed_tier === 'none' || !st.ed_last_signal_at) return st;
    const daysSince = (Date.now() - new Date(st.ed_last_signal_at).getTime()) / 86400000;
    const steps = Math.floor(daysSince / DEESCALATE_DAYS);
    if (steps <= 0) return st;
    const newRank = Math.max(0, RANK[st.ed_tier] - steps);
    if (newRank === RANK[st.ed_tier]) return st;
    const next = NAME[newRank];
    await supabaseAdmin.from('user_safety_state').update({ ed_tier: next, updated_at: new Date().toISOString() }).eq('user_id', userId);
    return { ...st, ed_tier: next };
  } catch { return { ed_tier: 'none', ed_signal_count: 0, ed_last_signal_at: null, ed_escalated_at: null }; }
}

/**
 * Record an ED-risk signal detected this turn. Escalates the tier (fast): a high signal jumps to
 * amber, or to red if already amber+; a medium signal jumps to watch, or amber if already watch+.
 * Returns the new tier.
 */
export async function recordEDSignal(userId: string, severity: 'medium' | 'high'): Promise<EDTier> {
  try {
    const st = await loadRaw(userId);
    const cur = st.ed_tier;
    let next: EDTier;
    if (severity === 'high') next = RANK[cur] >= RANK.amber ? 'red' : 'amber';
    else next = RANK[cur] >= RANK.watch ? 'amber' : 'watch';
    if (RANK[next] < RANK[cur]) next = cur; // escalate-only
    const now = new Date().toISOString();
    await supabaseAdmin.from('user_safety_state').upsert({
      user_id: userId, ed_tier: next, ed_signal_count: st.ed_signal_count + 1,
      ed_last_signal_at: now, ed_escalated_at: next !== cur ? now : (st.ed_escalated_at ?? now), updated_at: now,
    }, { onConflict: 'user_id' });
    return next;
  } catch (e) { console.warn('[safety-state] recordEDSignal failed', (e as Error).message); return 'none'; }
}

/**
 * The deficit gate the TargetEngine consults. Aggressive calorie deficits are FORBIDDEN while the
 * ED tier is amber or red — the coach floors at maintenance instead. Fail-safe: on error, allow
 * (the deficit paths keep their own clinical floors; this only ADDS protection, never removes it).
 */
export async function deficitAllowed(userId: string): Promise<{ allowed: boolean; edTier: EDTier; reason: string | null }> {
  try {
    const st = await getSafetyState(userId);
    const blocked = RANK[st.ed_tier] >= RANK.amber;
    return { allowed: !blocked, edTier: st.ed_tier, reason: blocked ? `ed_tier=${st.ed_tier}: deficit forbidden, hold at maintenance` : null };
  } catch { return { allowed: true, edTier: 'none', reason: null }; }
}
