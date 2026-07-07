/**
 * belief-log.ts — append-only, bitemporal BELIEF LOG (target-arch step 11).
 *
 * Every change to a durable belief about the user is APPENDED here with provenance and both times:
 * record-time (created_at = when we learned it) and valid-time (effective_from = when it is true).
 * Nothing is mutated or deleted — this is the history the memory spine and repair propagation stand
 * on. Fail-soft: a logging failure must never break the turn.
 */
import { supabaseAdmin } from './supabase-admin.ts';

export type BeliefOp = 'set' | 'retract' | 'correct' | 'confirm';

export interface BeliefEvent {
  belief_key: string;                 // 'dietary_restriction' | 'allergen' | 'dislike' | 'goal' | 'injury' | 'weight' | …
  subject?: string | null;            // the specific belief: 'vegan', 'süt', 'brokoli', 'knee'
  operation: BeliefOp;
  old_value?: unknown;
  new_value?: unknown;
  source?: 'user_stated' | 'onboarding' | 'imported' | 'inferred' | 'confirmed';
  temporal_scope?: 'prospective' | 'retroactive';
  effective_from?: string | null;     // 'YYYY-MM-DD' valid-time; null = now
  note?: string;
}

/** Append one belief event. Never throws. */
export async function logBelief(userId: string, b: BeliefEvent): Promise<void> {
  try {
    await supabaseAdmin.from('belief_events').insert({
      user_id: userId,
      belief_key: b.belief_key,
      subject: (b.subject ?? null),
      operation: b.operation,
      old_value: b.old_value ?? null,
      new_value: b.new_value ?? null,
      source: b.source ?? 'user_stated',
      temporal_scope: b.temporal_scope ?? 'prospective',
      effective_from: b.effective_from ?? null,
      note: (b.note ?? '').slice(0, 500),
    });
  } catch (e) { console.warn('[belief-log] append failed', b.belief_key, (e as Error).message); }
}

/** Read a user's belief history (most recent first), optionally for one belief_key. */
export async function getBeliefHistory(userId: string, beliefKey?: string, limit = 20): Promise<Array<Record<string, unknown>>> {
  try {
    let q = supabaseAdmin.from('belief_events')
      .select('belief_key, subject, operation, old_value, new_value, source, temporal_scope, effective_from, note, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (beliefKey) q = q.eq('belief_key', beliefKey);
    const { data } = await q;
    return (data ?? []) as Array<Record<string, unknown>>;
  } catch { return []; }
}
