/**
 * KOCHKO 4-LAYER MEMORY ARCHITECTURE
 * Spec Section 5.1
 *
 * Katman 1: Sabit Profil (her zaman, %15 token bütçe)
 * Katman 2: AI Özeti (her zaman, %10 token bütçe)
 * Katman 3: Son 7-14 gün verileri (her zaman, %25 token bütçe)
 * Katman 4: Aktif sohbet mesajları (kalan ~%35)
 *
 * Total context budget: ~65% of model window
 */

import { supabaseAdmin } from './supabase-admin.ts';
import { getLocalParts } from './day-boundary.ts';
import { foodMatchKey } from './guardrails.ts'; // AI-behaviour #16: same TR-inflection key the rest of the app uses

/**
 * User's effective IANA timezone (active travel tz → home tz → null=UTC).
 * FIX (audit AI-MEM-02/HIGH): learned meal/snack hours were bucketed from the UTC
 * edge-runtime hour, so for any non-UTC user the "late meal (≥21:00)" correlation and
 * the snacking-hour nudge fired at the wrong local hour (offset by the UTC offset).
 */
async function getUserTz(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles').select('active_timezone, home_timezone').eq('id', userId).maybeSingle();
  return (data?.active_timezone as string | null) || (data?.home_timezone as string | null) || null;
}

// Token budget allocation (Spec 5.1)
const TOKEN_BUDGET = {
  TOTAL: 130_000, // 65% of 200K context window
  LAYER1_PCT: 0.15, // ~19,500 tokens
  LAYER2_PCT: 0.10, // ~13,000 tokens
  LAYER3_PCT: 0.25, // ~32,500 tokens
  LAYER4_PCT: 0.35, // ~45,500 tokens (chat history + AI response room)
};

// Approximate: 1 token ≈ 3.5 Turkish characters

// NOTE (#S3): consolidateSummary was removed — general_summary is now a DERIVED VIEW regenerated
// whole from canonical stores by composeGeneralSummary (shared/memory-mirror.ts); there is no
// append path left to consolidate.

/**
 * Update Layer 2 (AI Summary) after a conversation.
 * Called asynchronously - doesn't block chat response.
 *
 * Uses atomic Postgres merge function (migration 015) to avoid races
 * when multiple edge function invocations update the same user concurrently.
 */
export async function updateLayer2(
  userId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('ai_summary_merge', {
    p_user_id: userId,
    p_patch: updates,
  });
  if (error) {
    // Surface the failure with enough context to diagnose a dead write path:
    // which user, which Layer-2 keys, and the Postgres error code (e.g. 42804).
    console.error(
      `updateLayer2 merge failed (user=${userId}, keys=[${Object.keys(updates).join(',')}]):`,
      error.code ? `${error.code} ${error.message}` : error.message,
    );
  }
}

/**
 * Append new behavioral patterns atomically.
 * Safer than updateLayer2({ behavioral_patterns: [...] }) for concurrent writes.
 * Caps at 20 most recent entries.
 */
/**
 * AI-behaviour #16 — SELF-DISCOVERED CORRELATIONS.
 *
 * Every cross-time join in the app was hand-written for one specific pair (caffeine→sleep,
 * late-meal→sleep, Friday-alcohol→Saturday-dip), and `behavioral_patterns` — the "BİLİNEN KALIPLAR"
 * the coach recites — was populated ONLY by the LLM declaring things the user had already said out
 * loud. So the coach could never surface a join the user cannot see themselves, which is the entire
 * promised difference from a logging app.
 *
 * These two analyzers are pure data. They write ONE pattern line each through the existing
 * appendBehavioralPatterns, so they light up in BOTH the chat snapshot and the nudge context with no
 * new plumbing.
 */

/**
 * Replace any prior DERIVED pattern of the same `type` before appending a new one.
 * FIX (adversarial): ai_summary_append_patterns is a blind concat capped to the LAST 20 entries, and
 * these analyzers run weekly — so an unchanged insight was re-appended every week, and after a few
 * months the derived lines would EVICT the user-stated patterns the coach actually needs.
 */
async function replaceDerivedPattern(userId: string, type: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from('ai_summary').select('behavioral_patterns').eq('user_id', userId).maybeSingle();
    const existing = Array.isArray(data?.behavioral_patterns) ? (data!.behavioral_patterns as Record<string, unknown>[]) : [];
    const kept = existing.filter((p) => !(p && p.source === 'derived' && p.type === type));
    const prior = existing.find((p) => p && p.source === 'derived' && p.type === type);
    const times = Number(prior?.times_observed);
    const merged = { ...entry, times_observed: Number.isFinite(times) ? times + 1 : 1 };
    await updateLayer2(userId, { behavioral_patterns: [...kept, merged].slice(-20) });
  } catch (e) {
    console.error('[replaceDerivedPattern]', type, (e as Error).message);
  }
}

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** "Pazartesi akşamları 4 haftadır kayıt yok." — one weekday consistently below the rest. */
export async function detectDayOfWeekDrift(userId: string): Promise<void> {
  try {
    const since = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabaseAdmin.from('daily_reports')
      .select('date, compliance_score').eq('user_id', userId).gte('date', since);
    const rows = (data ?? []) as { date: string; compliance_score: number | null }[];
    if (rows.length < 14) return;
    const buckets: number[][] = Array.from({ length: 7 }, () => []);
    for (const r of rows) {
      const s = Number(r.compliance_score);
      if (!Number.isFinite(s)) continue;
      const d = new Date(`${r.date}T12:00:00Z`).getUTCDay();
      buckets[d].push(s);
    }
    const means = buckets.map(b => (b.length ? b.reduce((a, c) => a + c, 0) / b.length : null));
    let worstIdx = -1, worstVal = Infinity;
    for (let i = 0; i < 7; i++) {
      if (means[i] == null || buckets[i].length < 3) continue;
      if (means[i]! < worstVal) { worstVal = means[i]!; worstIdx = i; }
    }
    if (worstIdx < 0) return;
    const others = means.map((m, i) => (i === worstIdx ? null : m)).filter((m): m is number => m != null);
    if (others.length < 3) return;
    const otherMean = others.reduce((a, c) => a + c, 0) / others.length;
    if (otherMean - worstVal < 15) return; // not a real, actionable gap
    await replaceDerivedPattern(userId, 'weekday_drift', {
      type: 'weekday_drift',
      // FIX (adversarial): every reader in the repo reads `description` — writing `pattern` rendered
      // "- [weekday_drift] undefined -> undefined" into the KALIPLAR prompt block and showed a blank
      // row in Koç Hafızası whose delete filter could never match it.
      description: `${TR_DAYS[worstIdx]} günleri uyum belirgin düşük (ort. %${Math.round(worstVal)} — diğer günler %${Math.round(otherMean)})`,
      intervention: `${TR_DAYS[worstIdx]} için önceden tek bir küçük plan kur`,
      status: 'active',
      confidence: 0.8,
      source: 'derived',
      last_occurred: new Date().toISOString().slice(0, 10),
      times_observed: 1,
      detected_at: new Date().toISOString(),
    });
  } catch (e) { console.error('[detectDayOfWeekDrift]', (e as Error).message); }
}

/** "Pizza yediğin 5 günün 5'inde hedefi aştın." — a specific food that reliably derails the day. */
export async function detectDerailFoods(userId: string): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const [logsRes, reportsRes] = await Promise.all([
      supabaseAdmin.from('meal_logs').select('id, logged_for_date').eq('user_id', userId).eq('is_deleted', false).gte('logged_for_date', since).order('logged_for_date', { ascending: false }).limit(400),
      supabaseAdmin.from('daily_reports').select('date, calorie_actual').eq('user_id', userId).gte('date', since),
    ]);
    const logs = (logsRes.data ?? []) as { id: string; logged_for_date: string }[];
    const reports = (reportsRes.data ?? []) as { date: string; calorie_actual: number | null }[];
    if (logs.length < 20 || reports.length < 10) return;
    // The day's own target band comes from daily_plans; use the median actual as a cheap baseline so
    // this needs no extra join — a "derail" is a day well above this person's own norm.
    const actuals = reports.map(r => Number(r.calorie_actual)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (actuals.length < 10) return;
    const median = actuals[Math.floor(actuals.length / 2)];
    const overBy = median * 1.2;
    const overDays = new Set(reports.filter(r => Number(r.calorie_actual) > overBy).map(r => r.date));
    if (overDays.size < 3) return;

    const { data: items } = await supabaseAdmin.from('meal_log_items')
      .select('food_name, meal_log_id').in('meal_log_id', logs.slice(0, 200).map(l => l.id)).limit(1200);
    const dateOf = new Map(logs.map(l => [l.id, l.logged_for_date]));
    const perFood = new Map<string, { days: Set<string>; over: Set<string> }>();
    for (const it of (items ?? []) as { food_name: string | null; meal_log_id: string }[]) {
      const key = foodMatchKey(it.food_name ?? '');
      if (key.length < 3) continue;
      const day = dateOf.get(it.meal_log_id);
      if (!day) continue;
      const e = perFood.get(key) ?? { days: new Set<string>(), over: new Set<string>() };
      e.days.add(day);
      if (overDays.has(day)) e.over.add(day);
      perFood.set(key, e);
    }
    for (const [food, e] of perFood) {
      if (e.days.size < 4) continue;
      const ratio = e.over.size / e.days.size;
      if (ratio < 0.7) continue;
      await replaceDerivedPattern(userId, 'derail_food', {
        type: 'derail_food',
        description: `"${food}" yediği ${e.days.size} günün ${e.over.size}'inde günlük kalorisi kendi ortalamasının %20+ üstüne çıkıyor`,
        intervention: `"${food}" olan günlerde yanındakini (içecek/ekmek/sos) küçült`,
        status: 'active',
        confidence: 0.75,
        source: 'derived',
        last_occurred: new Date().toISOString().slice(0, 10),
        times_observed: 1,
        detected_at: new Date().toISOString(),
      });
      break; // one insight per run — this is a conversation opener, not a report
    }
  } catch (e) { console.error('[detectDerailFoods]', (e as Error).message); }
}

export async function appendBehavioralPatterns(
  userId: string,
  newPatterns: Record<string, unknown>[]
): Promise<void> {
  if (!newPatterns || newPatterns.length === 0) return;
  const { error } = await supabaseAdmin.rpc('ai_summary_append_patterns', {
    p_user_id: userId,
    p_new_patterns: newPatterns,
  });
  if (error) {
    console.error('appendBehavioralPatterns failed:', error.message);
  }
}

// ─── Repair History Queries ───

/**
 * Get repair event count for a user (used for analytics).
 */
export async function getRepairCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('repair_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

/**
 * Store a repair event.
 */
export async function storeRepairEvent(
  userId: string,
  repairType: string,
  originalInput: string,
  correctedInput: string | null,
  foodItem: string | null
): Promise<void> {
  const { error } = await supabaseAdmin.from('repair_history').insert({
    user_id: userId,
    repair_type: repairType,
    original_text: originalInput,
    corrected_text: correctedInput,
    food_name: foodItem,
  });
  if (error) console.error('storeRepairEvent failed:', error.message);
}

// ─── Pattern Confidence Evolution ───

/**
 * Evolve pattern confidence scores.
 * - Patterns not seen for 14+ days: confidence decays by 0.05
 * - Patterns with 4+ observations: boosted to 0.8+
 * - Very low confidence candidates (<0.15): marked resolved
 */
export async function evolvePatternConfidence(userId: string): Promise<void> {
  const { data: summary } = await supabaseAdmin
    .from('ai_summary')
    .select('behavioral_patterns')
    .eq('user_id', userId)
    .maybeSingle();

  if (!summary) return;

  const patterns = (summary.behavioral_patterns as Record<string, unknown>[] | null) ?? [];
  if (patterns.length === 0) return;

  const now = Date.now();
  let changed = false;

  for (const pattern of patterns) {
    const confidence = (pattern.confidence as number) ?? 0.5;
    const lastOccurred = pattern.last_occurred as string | null;
    const timesObserved = (pattern.times_observed as number) ?? 1;

    // Decay + stale flagging based on days since last observation
    if (lastOccurred) {
      const daysSince = Math.floor((now - new Date(lastOccurred).getTime()) / 86400000);
      // Soft decay: 14+ days silent
      if (daysSince > 14 && confidence > 0.2) {
        pattern.confidence = Math.max(0.1, confidence - 0.05);
        changed = true;
      }
      // Stale flag: 60+ days silent → AI stops using in context (Spec 5.7)
      if (daysSince > 60 && (pattern.status as string) !== 'stale') {
        pattern.status = 'stale';
        changed = true;
      }
    }

    // Boost: 4+ observations
    if (timesObserved >= 4 && confidence < 0.8) {
      pattern.confidence = Math.min(0.95, confidence + 0.1);
      changed = true;
    }

    // Clean up: very low confidence candidates
    if (confidence < 0.15 && (pattern.status as string) === 'candidate') {
      pattern.status = 'resolved';
      changed = true;
    }
  }

  if (changed) {
    const activePatterns = patterns.filter(p => {
      if (p.status !== 'resolved') return true;
      const lastOcc = p.last_occurred as string | null;
      if (!lastOcc) return false;
      return (now - new Date(lastOcc).getTime()) < 30 * 86400000;
    });

    // FIX (audit AI/HIGH): route the write-back through the locked atomic merge
    // (ai_summary_merge, mig 015 — FOR UPDATE) instead of a raw .update() that
    // bypasses the row lock. ai-chat's processLayer2Updates writes behavioral_patterns
    // through the same merge RPC, so unifying on it serializes these concurrent writers
    // and removes the lock-bypass that let last-writer-win torn writes through. Semantics
    // are preserved: ai_summary_merge replaces the array key (COALESCE replace) exactly
    // as the old .update() did. (The read-modify-write of existing entries still needs a
    // dedicated locked RPC for full atomicity — out of scope here, no new DB object.)
    await updateLayer2(userId, { behavioral_patterns: activePatterns });
  }
}

/**
 * Late-meal → sleep-quality correlation (Spec 14.2).
 *
 * Last 4 weeks: match each day's latest meal_log.logged_at hour against
 * that night's sleep_quality. If "late" (≥21:00) meal days show worse sleep
 * than early-meal days (≥0.5h or "bad" vs "good" skew), surface an insight.
 */
export async function analyzeLateMealSleep(userId: string): Promise<void> {
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
  const tz = await getUserTz(userId); // FIX (audit AI-MEM-02): local hour, not UTC

  const [mealsRes, metricsRes] = await Promise.all([
    supabaseAdmin.from('meal_logs').select('logged_at, logged_for_date')
      .eq('user_id', userId).eq('is_deleted', false).gte('logged_for_date', fourWeeksAgo),
    supabaseAdmin.from('daily_metrics').select('date, sleep_hours, sleep_quality')
      .eq('user_id', userId).gte('date', fourWeeksAgo),
  ]);

  const meals = (mealsRes.data ?? []) as { logged_at: string; logged_for_date: string }[];
  const metrics = (metricsRes.data ?? []) as { date: string; sleep_hours: number | null; sleep_quality: string | null }[];
  if (meals.length < 14 || metrics.length < 10) return;

  // Latest meal per date
  const latestByDate: Record<string, number> = {};
  for (const m of meals) {
    const lp = getLocalParts(tz, new Date(m.logged_at));
    const h = lp.hour + lp.minute / 60;
    if (!latestByDate[m.logged_for_date] || latestByDate[m.logged_for_date] < h) {
      latestByDate[m.logged_for_date] = h;
    }
  }

  const lateGroup: { hours: number; quality: string | null }[] = [];
  const earlyGroup: { hours: number; quality: string | null }[] = [];
  for (const m of metrics) {
    if (m.sleep_hours === null) continue;
    const lastMealHour = latestByDate[m.date];
    if (lastMealHour === undefined) continue;
    (lastMealHour >= 21 ? lateGroup : earlyGroup).push({ hours: m.sleep_hours, quality: m.sleep_quality });
  }

  if (lateGroup.length < 3 || earlyGroup.length < 3) return;

  const avg = (arr: { hours: number }[]) => arr.reduce((s, v) => s + v.hours, 0) / arr.length;
  const avgLate = avg(lateGroup);
  const avgEarly = avg(earlyGroup);
  const diff = avgEarly - avgLate;

  if (diff < 0.5) return; // no meaningful correlation

  // FIX (audit AI-MEM-03): caffeine_sleep_notes is a shared scalar/TEXT column —
  // the chat path APPENDS real caffeine notes to it (ai-chat/index.ts:4334-4336).
  // A bare updateLayer2({ caffeine_sleep_notes }) goes through ai_summary_merge's
  // COALESCE-replace and would OVERWRITE every accumulated caffeine note with this
  // single late-meal sentence on each weekly extractor run. Mirror the chat path:
  // read the existing value, strip only our own prior "[date] Gec yemek-uyku:" line
  // (so we don't stack one per week — same de-dup approach as line 795), date-stamp
  // and self-label the insight, then append. Real caffeine notes are preserved.
  const dateStr = new Date().toISOString().split('T')[0];
  const note = `[${dateStr}] Gec yemek-uyku: gec yemek (21:00+) gunlerinde uyku ortalama ${avgLate.toFixed(1)}sa vs erken yemek gunlerinde ${avgEarly.toFixed(1)}sa (fark ${diff.toFixed(1)}sa).`;
  const { data: existing } = await supabaseAdmin
    .from('ai_summary').select('caffeine_sleep_notes').eq('user_id', userId).maybeSingle();
  const prior = (existing?.caffeine_sleep_notes as string) ?? '';
  const cleaned = prior
    .split('\n')
    .filter(line => !line.includes('Gec yemek-uyku:'))
    .join('\n')
    .trim();
  const merged = cleaned ? `${cleaned}\n${note}` : note;
  await updateLayer2(userId, { caffeine_sleep_notes: merged }).then(() => {}, () => {});
}

/**
 * Calibrate declared activity_level against observed behavior (Spec 2.4, 14.1).
 *
 * Looks at last 4 weeks: average daily steps + workout sessions/week.
 * Maps observed activity to one of 5 tiers (sedentary/light/moderate/active/very_active)
 * and compares to profile.activity_level. If mismatch ≥ 2 tiers, proposes a correction.
 * Writes a coaching_message if adjustment is warranted.
 */
export async function calibrateActivityMultiplier(userId: string): Promise<void> {
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];

  const [profileRes, metricsRes, workoutsRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('activity_level').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('daily_metrics').select('steps').eq('user_id', userId).gte('date', fourWeeksAgo).not('steps', 'is', null),
    supabaseAdmin.from('workout_logs').select('duration_min, intensity, logged_for_date').eq('user_id', userId).gte('logged_for_date', fourWeeksAgo),
  ]);

  const declared = (profileRes.data?.activity_level as string | null) ?? 'moderate';
  const steps = (metricsRes.data ?? []) as { steps: number }[];
  const workouts = (workoutsRes.data ?? []) as { duration_min: number; intensity: string }[];

  if (steps.length < 14 && workouts.length < 4) return; // insufficient observed data

  // Average daily steps
  const avgSteps = steps.length > 0
    ? steps.reduce((s, m) => s + (m.steps ?? 0), 0) / steps.length
    : 0;

  // Workout frequency: sessions per week in last 4 weeks
  const workoutsPerWeek = workouts.length / 4;

  // Infer observed tier from the two signals.
  // Step thresholds: <3k sedentary, 3-6k light, 6-9k moderate, 9-12k active, >12k very_active.
  // Workout frequency: 0 sedentary, 1-2 light, 3 moderate, 4-5 active, 6+ very_active.
  const tierOrder = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
  const stepTier = avgSteps < 3000 ? 0 : avgSteps < 6000 ? 1 : avgSteps < 9000 ? 2 : avgSteps < 12000 ? 3 : 4;
  const workoutTier = workoutsPerWeek < 1 ? 0 : workoutsPerWeek < 3 ? 1 : workoutsPerWeek < 4 ? 2 : workoutsPerWeek < 6 ? 3 : 4;
  const observedTier = Math.round((stepTier + workoutTier) / 2);
  const observedLevel = tierOrder[observedTier];
  const declaredTier = tierOrder.indexOf(declared as typeof tierOrder[number]);

  if (declaredTier < 0) return;
  if (Math.abs(observedTier - declaredTier) < 2) return; // within ±1 tier is fine

  // Mismatch ≥2 tiers — propose
  await supabaseAdmin.from('coaching_messages').insert({
    user_id: userId,
    trigger_type: 'activity_level_recalibrated',
    priority: 'low',
    content: `Profilinde aktivite: ${declared}, son 4 haftaya bakınca: ${observedLevel} (${Math.round(avgSteps)} adim/gun, ${workoutsPerWeek.toFixed(1)} seans/hafta). Aktivite seviyeni ${observedLevel} yapayim mi? Kalori hedefin bu degisime gore guncellenir.`,
  }).then(() => {}, () => {});
}

/**
 * Detect peak snacking hours (Spec 14.2).
 *
 * Scans last 4 weeks of meal_logs where meal_type='snack' and finds the top
 * 1-2 hours when snacking is most frequent. Writes to ai_summary so
 * ai-proactive can schedule a preemptive nudge just before that hour.
 */
export async function detectSnackingHours(userId: string): Promise<void> {
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString();
  const tz = await getUserTz(userId); // FIX (audit AI-MEM-02): local hour, not UTC

  const { data: snacks } = await supabaseAdmin
    .from('meal_logs')
    .select('logged_at')
    .eq('user_id', userId)
    .eq('meal_type', 'snack')
    .eq('is_deleted', false)
    .gte('logged_at', fourWeeksAgo);

  if (!snacks || snacks.length < 5) return; // too little data

  const hourCounts: Record<number, number> = {};
  for (const s of snacks as { logged_at: string }[]) {
    const hour = getLocalParts(tz, new Date(s.logged_at)).hour;
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  const top = Object.entries(hourCounts)
    .map(([h, c]) => ({ hour: Number(h), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .filter(x => x.count >= 3); // at least 3 events per hour

  if (top.length === 0) return;

  await updateLayer2(userId, {
    snacking_hours: top.map(t => t.hour),
  }).then(() => {}, () => {});
}

/**
 * Weekly correction retraining (Spec 5.32).
 *
 * Aggregates last 14 days of repair_history and extracts top-10 frequently-
 * corrected foods, writing a durable summary to `ai_summary.coaching_notes`.
 * This way the AI sees a compact "frequently wrong foods" context each turn
 * without having to re-query repair_history every time.
 */
export async function refreshCorrectionMemory(userId: string): Promise<void> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: repairs } = await supabaseAdmin
    .from('repair_history')
    .select('food_name, repair_type, corrected_text')
    .eq('user_id', userId)
    .gte('created_at', twoWeeksAgo)
    .not('food_name', 'is', null);

  if (!repairs || repairs.length === 0) return;

  const counts: Record<string, number> = {};
  const sampleCorrection: Record<string, string> = {};
  for (const r of repairs as { food_name: string; corrected_text: string | null }[]) {
    const key = r.food_name.toLocaleLowerCase('tr').trim();
    counts[key] = (counts[key] ?? 0) + 1;
    if (!sampleCorrection[key] && r.corrected_text) {
      sampleCorrection[key] = r.corrected_text;
    }
  }

  const top = Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  if (top.length === 0) return;

  const dateStr = new Date().toISOString().split('T')[0];
  const lines = top.map(([food, count]) => {
    const hint = sampleCorrection[food] ? ` (ornek duzeltme: "${sampleCorrection[food].substring(0, 60)}")` : '';
    return `${food}: ${count} duzeltme${hint}`;
  });
  const note = `[${dateStr}] Haftalik duzeltme ozeti — sik yanlis parse edilen yiyecekler:\n${lines.join('\n')}`;

  // Read existing notes, prepend this week's (keep last ~3 weeks of summaries)
  const { data: existing } = await supabaseAdmin
    .from('ai_summary').select('coaching_notes').eq('user_id', userId).maybeSingle();
  const prior = (existing?.coaching_notes as string) ?? '';
  // Drop prior "Haftalik duzeltme ozeti" lines so we don't stack duplicates
  const cleaned = prior
    .split('\n')
    .filter(line => !line.startsWith('[') || !line.includes('Haftalik duzeltme ozeti'))
    .join('\n')
    .trim();
  const merged = cleaned ? `${note}\n\n${cleaned}` : note;

  await updateLayer2(userId, { coaching_notes: merged });
}

/**
 * Infer user's preferred communication tone from implicit signals (Spec 5.9).
 *
 * Looks at last 14 days of chat_messages and derives a tone preference based on:
 *  - Avg user message length (short ≤ 20 chars → concise; long > 80 → conversational)
 *  - Correction rate (> 10% of messages repair intents → precise/cautious tone)
 *  - Emoji usage (frequent → warm/supportive; none → analytical)
 *  - Question rate (often asks "why?" → analytical)
 *
 * Updates ai_summary.learned_tone_preference. Called by ai-extractor tier 3 (weekly).
 * FIX (audit AI/HIGH): use the CANONICAL tone vocabulary shared with the model
 * (ai-chat/system-prompt.ts) and the reader (repair-handler toneInstructions) so the inferred
 * tone always maps to a real instruction. Previously this wrote a SEPARATE vocabulary
 * (concise/conversational/supportive/analytical) the reader had no instruction for, so the
 * tone directive silently degraded to a bare word.
 * Tone values: 'empathetic' | 'data_driven' | 'motivational' | 'strict' | 'balanced'
 */
export async function inferTonePreference(userId: string): Promise<void> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: msgs } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content, task_mode, created_at')
    .eq('user_id', userId)
    .gte('created_at', twoWeeksAgo)
    .order('created_at');

  if (!msgs || msgs.length < 20) return; // too little data to infer

  const userMsgs = msgs.filter((m: { role: string }) => m.role === 'user') as { content: string; task_mode: string | null }[];
  if (userMsgs.length < 10) return;

  // Signal 1: average message length (characters)
  const avgLen = userMsgs.reduce((s, m) => s + (m.content?.length ?? 0), 0) / userMsgs.length;

  // Signal 2: correction rate (repair or confirmation_no intents)
  const correctionPhrases = /yanlis anlad|yanlış anlad|duzelt|düzelt|hayir|hayır yanlis|hayır yanlış|son kaydi sil|son kaydı sil|geri al/i;
  const corrections = userMsgs.filter(m => correctionPhrases.test(m.content ?? '')).length;
  const correctionRate = corrections / userMsgs.length;

  // Signal 3: emoji usage (unicode emoji ranges roughly)
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const emojiCount = userMsgs.filter(m => emojiRe.test(m.content ?? '')).length;
  const emojiRate = emojiCount / userMsgs.length;

  // Signal 4: question rate ('neden', 'niye', '?')
  const questionRe = /neden|niye|niçin|\?/i;
  const questionCount = userMsgs.filter(m => questionRe.test(m.content ?? '')).length;
  const questionRate = questionCount / userMsgs.length;

  // Derive tone — CANONICAL vocabulary (shared with system-prompt + repair-handler).
  let tone: 'empathetic' | 'data_driven' | 'motivational' | 'strict' | 'balanced' = 'balanced';
  if (correctionRate > 0.1) {
    tone = 'data_driven'; // user catches errors → wants precision/data
  } else if (avgLen <= 20) {
    tone = 'strict'; // terse user wants terse, direct responses
  } else if (avgLen > 80 && emojiRate > 0.1) {
    tone = 'empathetic'; // long messages with emoji → wants warmth
  } else if (questionRate > 0.2) {
    tone = 'data_driven'; // asks lots of why → wants data/reasoning
  } else if (avgLen > 80) {
    tone = 'motivational'; // long engaged messages → wants energetic dialogue
  }

  // Persist via atomic merge helper
  await updateLayer2(userId, { learned_tone_preference: tone });
}
