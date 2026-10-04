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
  /**
   * Measured baseline columns (tdee_calculated, protein_per_kg, water_target_liters) — facts about
   * the body, not a deficit decision. Written with the band when it is applied AND on their own
   * when the ED gate refuses it (mem#5). Never put band-dependent flags (maintenance_mode,
   * periodic_state, tdee_last_* retry stamps) here: those must stay put when the band does.
   */
  baselineExtras?: Record<string, unknown>;
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
        // mem#5: the gate refuses the BAND, not the measurement. Returning before any write also
        // dropped the caller's TDEE baseline, so an amber user's activity change left
        // tdee_calculated on the old multiplier while the card announced the new one.
        if (input.baselineExtras && Object.keys(input.baselineExtras).length > 0) {
          const { error: baseErr } = await supabaseAdmin.from('profiles')
            .update({ ...input.baselineExtras, updated_at: new Date().toISOString() }).eq('id', userId);
          if (baseErr) console.error('[target-engine] baseline write failed:', baseErr.message);
        }
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
      ...(input.baselineExtras ?? {}),
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

/**
 * mem#5 — the TDEE-recalc card announces only what was STORED. It used to print the freshly
 * computed band unconditionally, so when the ED gate held an amber/red user at the old, higher band
 * the card still told exactly that user about a LOWER calorie range nobody applied — and called an
 * activity change a "Rutin kontrol". `adj` null = maintenance path (ramp owns the band, ranges
 * deliberately untouched). Returns null when the band the user sees did not move (refused or failed
 * write): there is nothing true to announce, and number talk is what the ED state asks us to cut.
 */
export function tdeeRecalcCardText(o: {
  tdee: number;
  proteinG: number;
  waterL: number;
  currentWeight: number;
  lastWeight: number | null;
  /** What actually triggered the recalc when it wasn't the scale (e.g. 'Aktivite düzeyin güncellendi'). */
  trigger?: string;
  adj: TargetAdjustResult | null;
}): string | null {
  const kg = (n: number) => n.toFixed(1).replace('.', ',');
  const weightChanged = o.lastWeight != null && Math.abs(o.currentWeight - o.lastWeight) >= 0.1;
  const reason = o.trigger
    ?? (o.lastWeight == null
      ? 'İlk TDEE hesaplaman hazır'
      : weightChanged
        ? `Kilon ${kg(o.lastWeight)} → ${kg(o.currentWeight)} kg değişti`
        : 'Rutin kontrol: hedeflerini güncel kilona göre tazeledim');
  const tail = `protein ${o.proteinG} g, su ${o.waterL} L.`;
  if (o.adj === null) return `${reason}. Yeni TDEE ${o.tdee} kcal, ${tail} (Bakım dönemi: kalori aralığın korunuyor.)`;
  if (!o.adj.ok || !o.adj.allowed || o.adj.newRestMin == null || o.adj.newRestMax == null) return null;
  // The engine's numbers, not the caller's: it floors and widens the band before writing it.
  return `${reason}. Yeni TDEE ${o.tdee} kcal, dinlenme aralığı ${o.adj.newRestMin}–${o.adj.newRestMax} kcal, ${tail}`;
}
