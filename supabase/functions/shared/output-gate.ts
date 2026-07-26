import { checkAllergens, extractInjuredBodyParts, findInjuryConflictsInText, scanReplyForAllergens, type AllergenSeverity } from './guardrails.ts';
import { getActiveConstraints } from './constraints.ts';
import { supabaseAdmin } from './supabase-admin.ts';

/**
 * THE OUTPUT GATE (plan v2, F1 · B4-lite / F2 · A2).
 *
 * Every surface that speaks to the user must pass the SAME deterministic safety scan. Today only
 * the chat reply does. `ai-proactive` imports exactly one thing from guardrails — `sanitizeText` —
 * so a push notification, the card on the dashboard and the nightly report prose were all written
 * by brains that cannot see the user's allergens or injuries. A phone buzzing at 08:00 with
 * "bugün fıstık ezmeli tost dene" to someone with a severe peanut allergy is the worst possible
 * shape of this bug: no conversation around it, no chance to object, straight to the lock screen.
 *
 * ROLE SPLIT (deliberate): this module is the SCANNER. It decides nothing about wording or
 * placement — it returns a verdict and, when the surface is not a conversation, the text to send
 * instead (or null to send nothing at all). Composition stays with the caller.
 */

export type GateSurface = 'chat' | 'push' | 'card' | 'report' | 'plan_note';

export interface GateVerdict {
  /** Safe to send as-is. */
  ok: boolean;
  /** What fired, for the ledger. */
  flags: ('allergen_blocked' | 'allergen_warned' | 'injury_warned')[];
  /** Allergen/movement names that matched. */
  matched: string[];
  /** For non-chat surfaces: the text to send instead, or null = SEND NOTHING. */
  replacement: string | null;
}

export interface UserSafetySnapshot {
  allergens: { name: string; severity: AllergenSeverity | null }[];
  injuredParts: string[];
  /**
   * FALSE when the constraint read failed. Critically, an empty snapshot with `loaded:false` is
   * NOT the same fact as "this user has no allergens" — without this flag the two are
   * indistinguishable and a transient DB blip would send an unscanned message to a lock screen.
   */
  loaded: boolean;
}

/**
 * Load the constraint snapshot once per user. Callers that speak to many users in one invocation
 * (the nudge cron) should cache this per user — it is two small indexed reads.
 */
export async function loadUserSafety(userId: string): Promise<UserSafetySnapshot> {
  try {
    const [prefsRes, spineAllergens, spineInjuries, injuryRows] = await Promise.all([
      supabaseAdmin.from('food_preferences').select('food_name, allergen_severity')
        .eq('user_id', userId).eq('is_allergen', true),
      getActiveConstraints(userId, ['allergen', 'intolerance']),
      getActiveConstraints(userId, ['injury']),
      supabaseAdmin.from('health_events').select('description')
        .eq('user_id', userId).eq('event_type', 'injury').eq('is_ongoing', true),
    ]);

    const rank = (s: string | null | undefined): number =>
      s === 'severe' ? 3 : s === 'moderate' ? 2 : s === 'mild' ? 1 : 0;
    const bySeverity = new Map<string, AllergenSeverity | null>();
    const note = (name: string | null | undefined, sev: string | null | undefined) => {
      const n = (name ?? '').trim();
      if (!n) return;
      const s: AllergenSeverity | null = sev === 'severe' || sev === 'moderate' || sev === 'mild' ? sev : null;
      if (!bySeverity.has(n) || rank(s) > rank(bySeverity.get(n))) bySeverity.set(n, s);
    };
    for (const r of (prefsRes.data ?? []) as { food_name: string; allergen_severity: string | null }[]) {
      note(r.food_name, r.allergen_severity);
    }
    for (const c of spineAllergens) note(c.subject, c.severity);

    const injured = new Set<string>(
      extractInjuredBodyParts(((injuryRows.data ?? []) as { description: string }[]).map((r) => r.description)),
    );
    for (const c of spineInjuries) for (const bp of (c.body_parts ?? [])) if (bp) injured.add(bp);

    return {
      allergens: [...bySeverity.entries()].map(([name, severity]) => ({ name, severity })),
      injuredParts: [...injured],
      loaded: true,
    };
  } catch (e) {
    console.error('[output-gate] constraint load failed:', (e as Error).message);
    return { allergens: [], injuredParts: [], loaded: false };
  }
}

/**
 * Scan a piece of user-facing text against the snapshot.
 *
 * Surface policy — the same violation has different consequences:
 *  · chat        → the caller redacts and replaces (it has a conversation to fall back on).
 *  · push/card   → SEND NOTHING. A notification cannot be argued with, and a safety notice on a
 *                  lock screen with no context is worse than silence.
 *  · report/plan → SEND NOTHING for the offending line; the caller regenerates or omits.
 */
export function gateUserText(
  text: string,
  safety: UserSafetySnapshot,
  surface: GateSurface,
): GateVerdict {
  const flags: GateVerdict['flags'] = [];
  const matched: string[] = [];
  if (!text || !text.trim()) return { ok: true, flags, matched, replacement: null };

  // The snapshot could not be read. On a conversational surface the chat path has its own scan and
  // the user can push back, so continue; on a push/card/report there is no conversation and no way
  // to object, so an unverifiable message is HELD. Safety degrades closed.
  if (!safety.loaded && surface !== 'chat') {
    return { ok: false, flags: [], matched: [], replacement: null };
  }

  if (safety.allergens.length > 0) {
    const scan = scanReplyForAllergens(text, safety.allergens);
    if (scan.violated) {
      matched.push(...scan.matched);
      flags.push(scan.worstSeverity === 'severe' ? 'allergen_blocked' : 'allergen_warned');
    }
  }
  if (safety.injuredParts.length > 0) {
    const conflicts = findInjuryConflictsInText(text, safety.injuredParts);
    if (conflicts.length > 0) {
      matched.push(...conflicts);
      flags.push('injury_warned');
    }
  }

  if (flags.length === 0) return { ok: true, flags, matched, replacement: null };
  // Non-chat surfaces never "warn and send anyway" — there is nowhere to have the conversation.
  const holdOutright = surface !== 'chat';
  return { ok: false, flags, matched, replacement: holdOutright ? null : text };
}

/** Convenience for callers that only need a yes/no before sending on a non-chat surface. */
export function isSafeToSend(text: string, safety: UserSafetySnapshot, surface: GateSurface): boolean {
  return gateUserText(text, safety, surface).ok;
}

/** Re-exported so callers do not reach past the gate for the allergen matcher. */
export { checkAllergens };
