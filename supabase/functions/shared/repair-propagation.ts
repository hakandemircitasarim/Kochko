/**
 * repair-propagation.ts — "correct once, propagate everywhere" (target-arch step 12).
 *
 * When a durable belief changes (a new dietary restriction, allergen, or dislike), the user's
 * ALREADY-GENERATED active diet plan may now violate it — the classic "I told it I'm vegetarian but
 * it suggested chicken next week" gap. This scans the active plan against the new belief and, if it
 * conflicts, marks the plan STALE (weekly_plans.stale_reason) so the coach surfaces it and the next
 * generation honours the belief. The invalidation is logged as its own belief_event (provenance).
 *
 * Deliberately CONSERVATIVE + fail-soft: it never deletes or regenerates inline (that belongs to the
 * owning plan engine, off the chat turn) — it only flags. A failure never breaks the turn.
 */
import { supabaseAdmin } from './supabase-admin.ts';
import { checkAllergens, DIETARY_FORBIDDEN, foodMatchKey } from './guardrails.ts';
import { logBelief } from './belief-log.ts';

/** Recursively collect every food-name-ish string from a weekly plan_data blob. */
function collectFoodText(planData: unknown): string {
  const parts: string[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || depth > 8) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o === 'object') {
      const r = o as Record<string, unknown>;
      for (const k of ['name', 'food_name', 'title', 'description', 'meal']) {
        if (typeof r[k] === 'string') parts.push(r[k] as string);
      }
      for (const v of Object.values(r)) if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(planData, 0);
  return parts.join(' \n ');
}

export interface BeliefChange { beliefKey: 'dietary_restriction' | 'allergen' | 'dislike' | string; subject?: string | null; }

/**
 * If the active diet plan violates the changed belief, mark it stale + log the repair. Returns the
 * outcome so the caller can surface it ("planında X vardı ama artık Y — güncelleyelim mi?").
 */
export async function repairPlansAfterBeliefChange(userId: string, change: BeliefChange): Promise<{ stale: boolean; reason?: string; violations?: string[] }> {
  const foodRelevant = change.beliefKey === 'dietary_restriction' || change.beliefKey === 'allergen' || change.beliefKey === 'dislike';
  if (!foodRelevant) return { stale: false };
  const subj = (change.subject ?? '').trim().toLocaleLowerCase('tr');
  if (!subj) return { stale: false };

  try {
    const { data: plan } = await supabaseAdmin.from('weekly_plans')
      .select('id, plan_data, stale_reason')
      .eq('user_id', userId).eq('status', 'active').eq('plan_type', 'diet')
      .order('generated_at', { ascending: false }).limit(1).maybeSingle();
    if (!plan?.plan_data) return { stale: false };

    const foodText = collectFoodText(plan.plan_data).toLocaleLowerCase('tr');
    if (!foodText) return { stale: false };

    const violations = new Set<string>();
    if (change.beliefKey === 'allergen') {
      // reuse the allergen category→member expansion + boundary logic
      const scan = checkAllergens(foodText, [subj]);
      if (!scan.passed) for (const v of scan.violations) violations.add(v);
    } else if (change.beliefKey === 'dietary_restriction') {
      const forbidden = DIETARY_FORBIDDEN[subj] ?? [];
      for (const f of forbidden) {
        try { if (new RegExp('(^|[^a-zçğıöşü])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zçğıöşü])').test(foodText)) violations.add(f); } catch { /* skip */ }
      }
    } else if (change.beliefKey === 'dislike') {
      const key = foodMatchKey(subj);
      const toks = new Set(foodText.split(/[^a-zçğıöşü]+/).filter((w) => w.length >= 3).map(foodMatchKey));
      if (key.length >= 3 && toks.has(key)) violations.add(subj);
    }

    if (violations.size === 0) return { stale: false };

    const list = [...violations].slice(0, 6);
    const reason = `belief_change:${change.beliefKey}:${subj} — plan içeriği çelişiyor (${list.join(', ')})`;
    await supabaseAdmin.from('weekly_plans').update({ stale_reason: reason }).eq('id', plan.id);
    await logBelief(userId, {
      belief_key: 'plan_repair', subject: change.beliefKey, operation: 'set',
      new_value: { plan_id: plan.id, violations: list }, source: 'inferred', note: reason,
    });
    return { stale: true, reason, violations: list };
  } catch (e) {
    console.warn('[repair-propagation] failed', (e as Error).message);
    return { stale: false };
  }
}
