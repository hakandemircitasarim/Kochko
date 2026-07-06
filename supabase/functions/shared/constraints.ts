/**
 * user_constraints — the SAFETY SPINE (target-architecture L1).
 *
 * The single typed store the guardrail layer reads, so a safety check never greps free text.
 * These helpers keep it in sync from the chat handlers (allergy/injury/dietary declarations +
 * their retractions) and expose a typed read for guardrails. Canonical subjects only.
 */
import { supabaseAdmin } from './supabase-admin.ts';
import { extractInjuredBodyParts } from './guardrails.ts';

export type ConstraintKind = 'allergen' | 'intolerance' | 'injury' | 'surgery' | 'condition' | 'medication' | 'dietary';

export interface Constraint {
  kind: ConstraintKind;
  subject: string;
  severity?: 'mild' | 'moderate' | 'severe' | null;
  body_parts?: string[];
  source?: 'user_stated' | 'onboarding' | 'imported' | 'inferred' | 'confirmed';
  note?: string;
}

/** Upsert an active constraint (idempotent on user_id+kind+subject). */
export async function syncConstraint(userId: string, c: Constraint): Promise<void> {
  const subject = (c.subject ?? '').trim().toLocaleLowerCase('tr');
  if (!subject) return;
  // #arch step 1 (epistemics): stamp confidence + confirmed_at from provenance. What the user
  // states/confirms is trusted and marked confirmed now; imported/inferred beliefs are lower
  // confidence and NOT confirmed until the user affirms them. Confidence NEVER gates safety — the
  // guardrails act on every active constraint regardless; this only shapes conversation.
  const now = new Date().toISOString();
  const source = c.source ?? 'user_stated';
  const confirmed = source === 'user_stated' || source === 'confirmed';
  try {
    await supabaseAdmin.from('user_constraints').upsert({
      user_id: userId, kind: c.kind, subject,
      severity: c.severity ?? null,
      body_parts: c.body_parts ?? [],
      active: true,
      source,
      confidence: confirmed ? 1.0 : (source === 'onboarding' ? 0.9 : 0.6),
      confirmed_at: confirmed ? now : null,
      note: (c.note ?? '').slice(0, 280),
      stated_at: now,
      updated_at: now,
    }, { onConflict: 'user_id,kind,subject' });
  } catch (e) { console.warn('[constraints] sync failed', c.kind, subject, (e as Error).message); }
}

/** Mark a constraint the user has just affirmed as confirmed (confidence 1.0, confirmed_at now). */
export async function confirmConstraint(userId: string, kind: ConstraintKind, subject: string): Promise<void> {
  try {
    await supabaseAdmin.from('user_constraints')
      .update({ confidence: 1.0, confirmed_at: new Date().toISOString(), source: 'confirmed', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', kind).eq('subject', subject.trim().toLocaleLowerCase('tr')).eq('active', true);
  } catch (e) { console.warn('[constraints] confirm failed', (e as Error).message); }
}

/** Retract: mark matching constraints inactive (allergy geçti, injury iyileşti, kısıtlama bitti). */
export async function deactivateConstraints(userId: string, kind: ConstraintKind, opts?: { subject?: string; bodyPart?: string }): Promise<number> {
  try {
    let q = supabaseAdmin.from('user_constraints').update({ active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', kind).eq('active', true);
    if (opts?.subject) q = q.eq('subject', opts.subject.trim().toLocaleLowerCase('tr'));
    if (opts?.bodyPart) q = q.contains('body_parts', [opts.bodyPart]);
    const { data } = await q.select('id');
    return (data ?? []).length;
  } catch (e) { console.warn('[constraints] deactivate failed', (e as Error).message); return 0; }
}

/** For an injury described in free text, sync typed constraints for each extracted body part. */
export async function syncInjuryFromText(userId: string, description: string, eventType: 'injury' | 'surgery' | 'condition' | 'medication' = 'injury'): Promise<void> {
  const parts = extractInjuredBodyParts([description]);
  if (parts.length === 0) {
    await syncConstraint(userId, { kind: eventType, subject: eventType, note: description, body_parts: [] });
    return;
  }
  for (const p of parts) {
    await syncConstraint(userId, { kind: eventType, subject: p, body_parts: [p], note: description });
  }
}

/** Resolve a healed injury: deactivate constraints covering any of the healed body parts. */
export async function resolveInjuryConstraints(userId: string, bodyParts: string[]): Promise<number> {
  let total = 0;
  for (const p of bodyParts) total += await deactivateConstraints(userId, 'injury', { bodyPart: p });
  return total;
}

/** Typed read for guardrails: all active constraints of the given kinds. */
export async function getActiveConstraints(userId: string, kinds?: ConstraintKind[]): Promise<Array<{ kind: ConstraintKind; subject: string; severity: string | null; body_parts: string[] }>> {
  try {
    let q = supabaseAdmin.from('user_constraints').select('kind, subject, severity, body_parts').eq('user_id', userId).eq('active', true);
    if (kinds && kinds.length) q = q.in('kind', kinds);
    const { data } = await q;
    return (data ?? []) as Array<{ kind: ConstraintKind; subject: string; severity: string | null; body_parts: string[] }>;
  } catch { return []; }
}
