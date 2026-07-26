import { supabaseAdmin } from './supabase-admin.ts';
import { deficitAllowed } from './safety-state.ts';
import { getCalorieFloor } from './clinical-rules.ts';
import { logBelief } from './belief-log.ts';

/**
 * TARGET ENGINE (plan v2, F3 · C3) — the ONE writer for calorie-band changes.
 *
 * WHY: "hedefi değiştiriyorum" was a sentence with SEVEN independent writers behind it (three
 * ai-chat action handlers, onboarding, TDEE recalc, ai-proactive's weight-trigger and its ramp),
 * each re-implementing its own slice of floor/safety/projection — and each missing a different
 * one. The two audit findings this module exists to close:
 *   · EYLEM-02: mini_cut/maintenance/plateau updated ONLY today's daily_plans row. The announced
 *     change evaporated the next morning and the dashboard sprang back to the old band for the
 *     rest of the plan week.
 *   · TUTARLILIK-03/ÖĞRENME-02 (root): band writes with no gate, no floor discipline, no ledger —
 *     targets moved silently and nothing recorded who moved them or why.
 *
 * CONTRACT:
 *   1. Every band change passes the ED gate when it LOWERS intake (deficit-tightening is refused
 *      while the durable safety state says no; raising toward maintenance is always allowed).
 *   2. Every band is clamped to the clinical floor (single owner: getCalorieFloor).
 *   3. The change projects onto daily_plans for TODAY AND EVERY LATER DAY of the plan window —
 *      never just today.
 *   4. Every change writes one belief_events row: who (source), what (old→new), why (reason).
 *
 * Existing call sites migrate INTO this; new writers are forbidden (arch-guard G10).
 */

export interface CalorieBand {
  restMin: number;
  restMax: number;
  trainingMin?: number | null;
  trainingMax?: number | null;
  weeklyBudget?: number | null;
}

export interface TargetAdjustInput {
  userId: string;
  band: CalorieBand;
  /** Who is asking — lands in the ledger so a surprising band is explainable from one row. */
  source: 'maintenance_start' | 'mini_cut_start' | 'plateau_strategy' | 'tdee_recalc' | 'onboarding' | 'proactive_recalc';
  /** Human 'why', Turkish — becomes the belief note. */
  reason: string;
  gender?: string | null;
  /** Effective date (user's day) — projection starts here. */
  today: string;
  /** Extra profile columns to write atomically with the band (flags like maintenance_mode). */
  profileExtras?: Record<string, unknown>;
}

export interface TargetAdjustResult {
  ok: boolean;
  /** False when the ED gate refused a tightening. */
  allowed: boolean;
  oldRestMin?: number | null;
  newRestMin?: number;
  newRestMax?: number;
  /** How many daily_plans rows were re-pointed (today + future). */
  projectedDays?: number;
  error?: string;
}

export async function applyTargetAdjust(input: TargetAdjustInput): Promise<TargetAdjustResult> {
  const { userId, band, source, reason, gender, today } = input;
  try {
    const { data: prof } = await supabaseAdmin
      .from('profiles').select('calorie_range_rest_min, calorie_range_rest_max, gender')
      .eq('id', userId).maybeSingle();
    const oldRestMin = (prof?.calorie_range_rest_min as number | null) ?? null;
    const g = gender ?? (prof?.gender as string | null);

    // 1. SAFETY GATE — only when the change TIGHTENS the deficit (lowers the band).
    const isTightening = oldRestMin != null && band.restMin < oldRestMin;
    if (isTightening) {
      const gate = await deficitAllowed(userId);
      if (!gate.allowed) {
        console.warn('[target-engine] tightening refused by SafetyState', { source, oldRestMin, wanted: band.restMin });
        return { ok: true, allowed: false, oldRestMin };
      }
    }

    // 2. CLINICAL FLOOR — one owner, applied to the BAND EDGE (not the midpoint).
    const floor = getCalorieFloor(g);
    const restMin = Math.max(floor, Math.round(band.restMin));
    const restMax = Math.max(restMin + 50, Math.round(band.restMax));

    // 3. ATOMIC PROFILE WRITE (band + caller's flags together).
    const patch: Record<string, unknown> = {
      calorie_range_rest_min: restMin,
      calorie_range_rest_max: restMax,
      updated_at: new Date().toISOString(),
      ...(band.trainingMin != null ? { calorie_range_training_min: Math.max(floor, Math.round(band.trainingMin)) } : {}),
      ...(band.trainingMax != null ? { calorie_range_training_max: Math.round(band.trainingMax) } : {}),
      ...(band.weeklyBudget != null ? { weekly_calorie_budget: Math.round(band.weeklyBudget) } : {}),
      ...(input.profileExtras ?? {}),
    };
    const { error: profErr } = await supabaseAdmin.from('profiles').update(patch).eq('id', userId);
    if (profErr) {
      console.error('[target-engine] profile write failed:', profErr.message);
      return { ok: false, allowed: true, error: profErr.message };
    }

    // 4. PROJECT FORWARD — today AND every later plan day (EYLEM-02: only-today made the change
    //    evaporate overnight while the plan week kept the stale band).
    const { data: touched, error: projErr } = await supabaseAdmin
      .from('daily_plans')
      .update({ calorie_target_min: restMin, calorie_target_max: restMax })
      .eq('user_id', userId).gte('date', today).select('id');
    if (projErr) console.error('[target-engine] projection failed:', projErr.message);

    // 5. LEDGER — who moved the number, from what, to what, why.
    await logBelief(userId, {
      belief_key: 'calorie_band', subject: source, operation: 'set',
      old_value: oldRestMin, new_value: restMin,
      note: reason,
    });

    return { ok: true, allowed: true, oldRestMin, newRestMin: restMin, newRestMax: restMax, projectedDays: touched?.length ?? 0 };
  } catch (e) {
    console.error('[target-engine] threw:', (e as Error).message);
    return { ok: false, allowed: true, error: (e as Error).message };
  }
}
