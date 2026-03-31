/**
 * KOCHKO ACTION-SPECIFIC CONTEXT BUILDERS
 *
 * Instead of one generic buildContext() that fetches everything,
 * each builder fetches only what the retrieval plan specifies.
 *
 * Design: RetrievalPlan → focused SQL queries → compact context string
 */

import { supabaseAdmin } from './supabase-admin.ts';
import type {
  RetrievalPlan, Layer1Focus, Layer2Focus, Layer3DataType,
  ContextMeta, DataConfidence,
} from './retrieval-planner.ts';

// Approximate: 1 token ~ 3.5 Turkish characters
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ─── Public Interface ───

export interface BuiltContext {
  layer1: string;
  layer2: string;
  layer3: string;
  layer4: { role: string; content: string }[];
  contextMeta: ContextMeta;
  estimatedTokens: number;
}

/**
 * Build context according to retrieval plan.
 * This replaces the old buildFullContext() with plan-aware fetching.
 */
export async function buildContextFromPlan(userId: string, plan: RetrievalPlan): Promise<BuiltContext> {
  const [layer1, layer2, layer3, layer4] = await Promise.all([
    buildLayer1Scoped(userId, plan),
    buildLayer2Scoped(userId, plan),
    buildLayer3Scoped(userId, plan),
    buildLayer4Scoped(userId, plan),
  ]);

  // Refine context meta based on actual data
  const meta = refineContextMeta(plan.contextMeta, layer1, layer3);

  const totalTokens =
    estimateTokens(layer1) +
    estimateTokens(layer2) +
    estimateTokens(layer3) +
    layer4.reduce((s, m) => s + estimateTokens(m.content), 0);

  return { layer1, layer2, layer3, layer4, contextMeta: meta, estimatedTokens: totalTokens };
}

// ─── Layer 1: Scoped Profile ───

async function buildLayer1Scoped(userId: string, plan: RetrievalPlan): Promise<string> {
  if (plan.layer1 === 'minimal' && plan.layer1Focus.length <= 1) {
    return buildLayer1Minimal(userId);
  }

  // For 'focused' and 'full', fetch profile but filter output
  const [profileRes, goalRes, prefsRes, healthRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
    plan.layer1Focus.includes('nutrition') || plan.layer1Focus.includes('training') || plan.layer1 === 'full'
      ? supabaseAdmin.from('goals').select('*').eq('user_id', userId).eq('is_active', true).order('phase_order').limit(3)
      : Promise.resolve({ data: [] }),
    plan.layer1Focus.includes('nutrition') || plan.layer1 === 'full'
      ? supabaseAdmin.from('food_preferences').select('food_name, preference, is_allergen, allergen_severity').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
    plan.layer1Focus.includes('health') || plan.layer1 === 'full'
      ? supabaseAdmin.from('health_events').select('event_type, description, is_ongoing').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
  ]);

  const p = profileRes.data;
  if (!p) return 'Profil henuz olusturulmamis.';

  const now = new Date();
  const age = p.birth_year ? now.getFullYear() - p.birth_year : null;
  const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });
  const hour = now.getHours();
  const minute = now.getMinutes().toString().padStart(2, '0');
  const isOnboarding = !p.onboarding_completed;

  const parts: string[] = [];

  // Time context — always include
  parts.push(`## ZAMAN\n${dayName}, ${hour}:${minute} | ${now.toISOString().split('T')[0]}`);

  // Demographics — always include at minimum
  const demoLine = `Cinsiyet: ${p.gender ?? '?'} | Yas: ${age ?? '?'} | Boy: ${p.height_cm ?? '?'}cm | Kilo: ${p.weight_kg ?? '?'}kg`;
  parts.push(`## PROFIL\n${isOnboarding ? '*** ONBOARDING MODU ***\n' : ''}${demoLine}`);

  // Training details
  if (plan.layer1Focus.includes('training') || plan.layer1 === 'full') {
    parts.push(`Aktivite: ${p.activity_level ?? '?'} | Ekipman: ${p.equipment_access ?? '?'} | Antrenman: ${p.training_style ?? '?'}`);
  }

  // Nutrition details
  if (plan.layer1Focus.includes('nutrition') || plan.layer1 === 'full') {
    parts.push(`Yemek becerisi: ${p.cooking_skill ?? '?'} | Butce: ${p.budget_level ?? '?'} | Porsiyon dili: ${p.portion_language ?? 'household'}`);
    parts.push(`Diyet modu: ${p.diet_mode ?? 'standard'}${p.if_active ? ` | IF: ${p.if_window} (${p.if_eating_start}-${p.if_eating_end})` : ''}`);
    parts.push(`Koc tonu: ${p.coach_tone ?? 'balanced'}`);

    // Calorie targets
    parts.push(`\n## KALORI\nAntrenman gunu: ${p.calorie_range_training_min ?? '?'}-${p.calorie_range_training_max ?? '?'} kcal`);
    parts.push(`Dinlenme gunu: ${p.calorie_range_rest_min ?? '?'}-${p.calorie_range_rest_max ?? '?'} kcal`);
    parts.push(`Protein: ${p.protein_per_kg ?? '?'}g/kg (${p.weight_kg && p.protein_per_kg ? Math.round(p.weight_kg * p.protein_per_kg) : '?'}g)`);
    parts.push(`Su: ${p.water_target_liters ?? '?'}L`);

    // Food preferences
    const prefs = (prefsRes.data ?? []) as { food_name: string; preference: string; is_allergen: boolean; allergen_severity: string | null }[];
    const neverFoods = prefs.filter(f => f.preference === 'never' || f.preference === 'dislike').map(f => f.food_name);
    const allergens = prefs.filter(f => f.is_allergen).map(f => `${f.food_name}${f.allergen_severity === 'severe' ? ' (CIDDI)' : ''}`);
    const lovedFoods = prefs.filter(f => f.preference === 'love' || f.preference === 'like').map(f => f.food_name);

    if (neverFoods.length > 0 || allergens.length > 0) {
      parts.push(`\n## ASLA ONERME\n${neverFoods.join(', ')}${allergens.length > 0 ? `\nALERJENLER: ${allergens.join(', ')}` : ''}`);
    }
    if (lovedFoods.length > 0) {
      parts.push(`## SEVDIKLERI\n${lovedFoods.join(', ')}`);
    }
  }

  // Goals
  const goals = (goalRes.data ?? []) as Record<string, unknown>[];
  if (goals.length > 0) {
    parts.push(`\n## HEDEFLER\n${goals.map(g => {
      const tw = g.target_weight_kg as number | null;
      return `${g.phase_label ?? g.goal_type}: ${tw ?? '?'}kg | ${g.priority} | ${g.weekly_rate ?? '?'}kg/hafta`;
    }).join('\n')}`);
  }

  // Health
  if (plan.layer1Focus.includes('health') || plan.layer1 === 'full') {
    const health = (healthRes.data ?? []) as { event_type: string; description: string; is_ongoing: boolean }[];
    const ongoingHealth = health.filter(h => h.is_ongoing);
    if (ongoingHealth.length > 0) {
      parts.push(`\n## SAGLIK GECMISI\n${ongoingHealth.map(h => `- [${h.event_type}] ${h.description}`).join('\n')}`);
    }

    // Periodic state
    if (p.periodic_state) {
      parts.push(`\n*** DONEMSEL DURUM: ${p.periodic_state} (${p.periodic_state_start} - ${p.periodic_state_end ?? '?'}) ***`);
    }

    // Menstrual
    if (p.menstrual_tracking) {
      parts.push(`Regl takibi aktif | Siklus: ${p.menstrual_cycle_length ?? '?'} gun`);
    }
  }

  // Season
  const m = new Date().getMonth() + 1;
  const s = m >= 3 && m <= 5 ? 'ilkbahar' : m >= 6 && m <= 8 ? 'yaz' : m >= 9 && m <= 11 ? 'sonbahar' : 'kis';
  parts.push(`MEVSIM: ${s}`);

  // Onboarding missing fields
  if (isOnboarding) {
    const missing = [!p.height_cm && 'boy', !p.weight_kg && 'kilo', !p.birth_year && 'yas', !p.gender && 'cinsiyet', goals.length === 0 && 'hedef'].filter(Boolean);
    if (missing.length > 0) parts.push(`EKSIK BILGILER: ${missing.join(', ')}`);
  }

  return parts.join('\n').trim();
}

async function buildLayer1Minimal(userId: string): Promise<string> {
  const { data: p } = await supabaseAdmin
    .from('profiles')
    .select('gender, birth_year, height_cm, weight_kg, coach_tone, onboarding_completed, display_name')
    .eq('id', userId)
    .single();

  if (!p) return 'Profil henuz olusturulmamis.';

  const now = new Date();
  const age = p.birth_year ? now.getFullYear() - p.birth_year : null;
  const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });
  const hour = now.getHours();
  const minute = now.getMinutes().toString().padStart(2, '0');

  return `${dayName}, ${hour}:${minute}\n${p.display_name ? `Ad: ${p.display_name} | ` : ''}Cinsiyet: ${p.gender ?? '?'} | Yas: ${age ?? '?'} | Kilo: ${p.weight_kg ?? '?'}kg | Ton: ${p.coach_tone ?? 'balanced'}`;
}

// ─── Layer 2: Scoped AI Summary ───

async function buildLayer2Scoped(userId: string, plan: RetrievalPlan): Promise<string> {
  if (plan.layer2 === 'none') return '';

  const { data } = await supabaseAdmin
    .from('ai_summary')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!data) return plan.layer2 === 'full' ? 'Henuz AI ozeti olusturulmamis - kullaniciyi taniyarak ogren.' : '';

  const s = data as Record<string, unknown>;
  const parts: string[] = [];
  const focuses = plan.layer2Focus;
  const isFull = plan.layer2 === 'full';

  // General summary — always if layer2 is not 'none'
  if (s.general_summary) {
    const summary = s.general_summary as string;
    parts.push(`## GENEL OZET\n${plan.layer2 === 'minimal' ? summary.substring(0, 500) : summary}`);
  }

  // Patterns
  if (isFull || focuses.includes('patterns')) {
    const patterns = s.behavioral_patterns as Record<string, unknown>[] | null;
    if (patterns && patterns.length > 0) {
      // Score-based filtering: prioritize high confidence, recent, high impact
      const scored = patterns.map(p => ({
        ...p,
        score: computePatternScore(p),
      })).sort((a, b) => b.score - a.score);

      // Take top patterns that fit
      const topPatterns = scored.filter(p => (p.status as string) !== 'resolved').slice(0, 10);
      if (topPatterns.length > 0) {
        parts.push(`## KALIPLAR\n${topPatterns.map(p => `- [${p.type}] ${p.description} -> ${p.intervention}${p.times_observed ? ` (${p.times_observed}x)` : ''}`).join('\n')}`);
      }
    }
  }

  // Persona
  if (isFull || focuses.includes('persona')) {
    if (s.user_persona) parts.push(`Persona: ${s.user_persona}`);
    if (s.learned_tone_preference) parts.push(`Ogrenilen ton: ${s.learned_tone_preference}`);
    if (s.nutrition_literacy) parts.push(`Beslenme okuryazarligi: ${s.nutrition_literacy}`);
  }

  // Preferences
  if (isFull || focuses.includes('preferences')) {
    const portion = s.portion_calibration as Record<string, unknown> | null;
    if (portion && Object.keys(portion).length > 0) {
      parts.push(`## PORSIYON HAFIZASI\n${Object.entries(portion).map(([k, v]) => `${k}=${v}g`).join(', ')}`);
    }
    if (s.coaching_notes) parts.push(`## KOCLUK NOTLARI\n${s.coaching_notes}`);
    if (s.alcohol_pattern) parts.push(`Alkol kalibi: ${s.alcohol_pattern}`);
    if (s.caffeine_sleep_notes) parts.push(`Kafein-uyku: ${s.caffeine_sleep_notes}`);
    if (s.social_eating_notes) parts.push(`Sosyal yeme: ${s.social_eating_notes}`);
    if (s.weekly_budget_pattern) parts.push(`Haftalik butce kalibi: ${s.weekly_budget_pattern}`);
  }

  // Strength
  if (isFull || focuses.includes('strength')) {
    const strength = s.strength_records as Record<string, { '1rm': number }> | null;
    if (strength && Object.keys(strength).length > 0) {
      parts.push(`## GUC KAYITLARI\n${Object.entries(strength).map(([k, v]) => `${k}: 1RM=${v['1rm']}kg`).join(', ')}`);
    }
  }

  // Habits
  if (isFull || focuses.includes('habits')) {
    const habits = s.habit_progress as { habit: string; status: string; streak: number }[] | null;
    if (habits && habits.length > 0) {
      parts.push(`## ALISKANLIKLAR\n${habits.map(h => `- ${h.habit}: ${h.status} (${h.streak} gun)`).join('\n')}`);
    }
  }

  // Full-only extras
  if (isFull) {
    if (s.recovery_pattern) parts.push(`Toparlanma: ${s.recovery_pattern}`);
    if (s.menstrual_notes) parts.push(`Regl notlari: ${s.menstrual_notes}`);
    if (s.supplement_notes) parts.push(`Supplement: ${s.supplement_notes}`);
    if (s.seasonal_notes) parts.push(`## DONEMSEL NOTLAR\n${s.seasonal_notes}`);

    const microRisks = s.micro_nutrient_risks as { nutrient: string; risk_level: string }[] | null;
    if (microRisks && microRisks.length > 0) {
      parts.push(`## MIKRO BESIN RISKLERI\n${microRisks.map(r => `- ${r.nutrient}: ${r.risk_level}`).join('\n')}`);
    }

    const learnedMealTimes = s.learned_meal_times as Record<string, string> | null;
    if (learnedMealTimes && Object.keys(learnedMealTimes).length > 0) {
      const timeLabels: Record<string, string> = { breakfast: 'kahvalti', lunch: 'ogle', dinner: 'aksam', snack: 'atistirma' };
      parts.push(`Ogun saatleri: ${Object.entries(learnedMealTimes).map(([k, v]) => `${timeLabels[k] ?? k} ${v}`).join(', ')}`);
    }
  }

  return parts.join('\n\n') || '';
}

/**
 * Compute a priority score for a behavioral pattern.
 * Higher score = more likely to be included in context.
 */
function computePatternScore(p: Record<string, unknown>): number {
  let score = 0;

  // Confidence (0-1)
  const confidence = (p.confidence as number) ?? 0.5;
  score += confidence * 30;

  // Impact
  const impact = p.impact as string;
  if (impact === 'high') score += 25;
  else if (impact === 'medium') score += 15;
  else score += 5;

  // Recurrence
  const timesObserved = (p.times_observed as number) ?? 1;
  score += Math.min(timesObserved * 3, 20);

  // Recency (days since last_occurred)
  const lastOccurred = p.last_occurred as string;
  if (lastOccurred) {
    const daysSince = Math.floor((Date.now() - new Date(lastOccurred).getTime()) / 86400000);
    score -= Math.min(daysSince * 0.5, 25); // staleness penalty
  }

  // Status
  if (p.status === 'resolved') score -= 50;
  if (p.status === 'recurring') score += 10;

  return score;
}

// ─── Layer 3: Scoped Recent Data ───

async function buildLayer3Scoped(userId: string, plan: RetrievalPlan): Promise<string> {
  const { daysBack, scope, detailLevel } = plan.layer3;

  if (daysBack === 0 || scope.length === 0) return '';

  const today = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  // Parallel fetch only what's needed
  const queries: Record<string, Promise<{ data: unknown[] | null }>> = {};

  if (scope.includes('meals')) {
    queries.meals = supabaseAdmin.from('meal_logs')
      .select('raw_input, meal_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', startDate).eq('is_deleted', false)
      .order('logged_at');
  }
  if (scope.includes('workouts')) {
    queries.workouts = supabaseAdmin.from('workout_logs')
      .select('raw_input, duration_min, workout_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', startDate)
      .order('logged_at');
  }
  if (scope.includes('metrics')) {
    queries.metrics = supabaseAdmin.from('daily_metrics')
      .select('date, weight_kg, water_liters, sleep_hours, steps, mood_score')
      .eq('user_id', userId).gte('date', startDate)
      .order('date');
  }
  if (scope.includes('reports')) {
    queries.reports = supabaseAdmin.from('daily_reports')
      .select('date, compliance_score, deviation_reason, tomorrow_action')
      .eq('user_id', userId).gte('date', startDate)
      .order('date');
  }
  if (scope.includes('commitments')) {
    queries.commitments = supabaseAdmin.from('user_commitments')
      .select('commitment, follow_up_at, status')
      .eq('user_id', userId).eq('status', 'pending')
      .order('follow_up_at').limit(5);
  }
  if (scope.includes('labAlerts')) {
    queries.labAlerts = supabaseAdmin.from('lab_values')
      .select('parameter_name, value, unit, is_out_of_range')
      .eq('user_id', userId).eq('is_out_of_range', true).limit(5);
  }

  const results = await Promise.all(
    Object.entries(queries).map(async ([key, promise]) => [key, (await promise).data ?? []] as const)
  );
  const data: Record<string, unknown[]> = Object.fromEntries(results);

  // Build context based on detail level
  return formatLayer3(data, today, detailLevel, daysBack);
}

function formatLayer3(
  data: Record<string, unknown[]>,
  today: string,
  detailLevel: string,
  daysBack: number
): string {
  const parts: string[] = [];
  const meals = (data.meals ?? []) as { raw_input: string; meal_type: string; logged_for_date: string }[];
  const workouts = (data.workouts ?? []) as { raw_input: string; duration_min: number; workout_type: string; logged_for_date: string }[];
  const metrics = (data.metrics ?? []) as { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; mood_score: number | null }[];
  const reports = (data.reports ?? []) as { date: string; compliance_score: number; deviation_reason: string | null; tomorrow_action: string }[];
  const commitments = (data.commitments ?? []) as { commitment: string; follow_up_at: string; status: string }[];
  const labAlerts = (data.labAlerts ?? []) as { parameter_name: string; value: number; unit: string }[];

  // Today — always full detail
  const todayMeals = meals.filter(m => m.logged_for_date === today);
  const todayWorkouts = workouts.filter(w => w.logged_for_date === today);
  const todayMetrics = metrics.find(m => m.date === today);

  parts.push(`## BUGUN (${today})`);
  if (todayMeals.length > 0) {
    parts.push(`Ogunler: ${todayMeals.map(m => `[${m.meal_type}] ${m.raw_input}`).join(' | ')}`);
  } else {
    parts.push('Ogunler: KAYIT YOK');
  }
  if (todayWorkouts.length > 0) {
    parts.push(`Antrenman: ${todayWorkouts.map(w => w.raw_input).join(', ')}`);
  }
  if (todayMetrics) {
    parts.push(`Su: ${todayMetrics.water_liters ?? 0}L | Tarti: ${todayMetrics.weight_kg ?? '-'} | Uyku: ${todayMetrics.sleep_hours ?? '-'}sa | Adim: ${todayMetrics.steps ?? '-'} | Mood: ${todayMetrics.mood_score ?? '-'}/5`);
  }

  // Yesterday — medium detail
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (daysBack >= 2) {
    const yMeals = meals.filter(m => m.logged_for_date === yesterday);
    const yWorkouts = workouts.filter(w => w.logged_for_date === yesterday);
    const yMetrics = metrics.find(m => m.date === yesterday);

    if (yMeals.length > 0 || yWorkouts.length > 0 || yMetrics) {
      parts.push(`\n## DUN (${yesterday})`);
      if (detailLevel === 'full') {
        if (yMeals.length > 0) parts.push(`Ogunler: ${yMeals.map(m => `[${m.meal_type}] ${m.raw_input}`).join(' | ')}`);
        if (yWorkouts.length > 0) parts.push(`Antrenman: ${yWorkouts.map(w => w.raw_input).join(', ')}`);
      } else {
        // Summary: just counts
        parts.push(`${yMeals.length} ogun${yWorkouts.length > 0 ? ` | ${yWorkouts.length} antrenman` : ''}`);
      }
      if (yMetrics) {
        parts.push(`Tarti: ${yMetrics.weight_kg ?? '-'} | Uyku: ${yMetrics.sleep_hours ?? '-'}sa`);
      }
    }
  }

  // Older days — summary or reference
  if (daysBack >= 3) {
    if (detailLevel === 'full') {
      // Show per-day summaries for days 2-7
      for (let d = 2; d < Math.min(daysBack, 8); d++) {
        const date = new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
        const dayMeals = meals.filter(m => m.logged_for_date === date);
        const dayWorkouts = workouts.filter(w => w.logged_for_date === date);
        const dayReport = reports.find(r => r.date === date);

        if (dayMeals.length > 0 || dayWorkouts.length > 0 || dayReport) {
          const lineParts = [`${date.slice(5)}: ${dayMeals.length} ogun`];
          if (dayWorkouts.length > 0) lineParts.push(`${dayWorkouts.length} antrenman`);
          if (dayReport) lineParts.push(`uyum: ${dayReport.compliance_score}/100${dayReport.deviation_reason ? ` (${dayReport.deviation_reason})` : ''}`);
          parts.push(lineParts.join(' | '));
        }
      }

      // Days 8+ — weekly reference only
      if (daysBack > 7 && reports.length > 0) {
        const olderReports = reports.filter(r => {
          const dayDiff = Math.floor((Date.now() - new Date(r.date).getTime()) / 86400000);
          return dayDiff >= 7;
        });
        if (olderReports.length > 0) {
          const avgCompliance = Math.round(olderReports.reduce((s, r) => s + r.compliance_score, 0) / olderReports.length);
          parts.push(`\nEski gunler (${olderReports.length} gun): ort. uyum ${avgCompliance}/100`);
        }
      }
    } else if (detailLevel === 'summary') {
      // Aggregate summary for all days
      if (reports.length > 0) {
        const avgCompliance = Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / reports.length);
        const deviations = reports.filter(r => r.deviation_reason).map(r => r.deviation_reason);
        parts.push(`\n## SON ${reports.length} GUN\nOrt. uyum: ${avgCompliance}/100`);
        if (deviations.length > 0) parts.push(`Sapmalar: ${deviations.slice(0, 3).join(', ')}`);
      }
    }
    // 'reference' detail → only today shown above
  }

  // Weight trend
  const weights = metrics.filter(m => m.weight_kg).map(m => `${m.date.slice(5)}: ${m.weight_kg}kg`);
  if (weights.length > 1) {
    parts.push(`\nKilo trendi: ${weights.join(', ')}`);
  }

  // Lab alerts
  if (labAlerts.length > 0) {
    parts.push(`\n## LAB UYARILARI\n${labAlerts.map(l => `${l.parameter_name}: ${l.value} ${l.unit}`).join('\n')}`);
  }

  // Commitments
  if (commitments.length > 0) {
    const now = new Date();
    const due = commitments.filter(c => new Date(c.follow_up_at) <= now);
    if (due.length > 0) {
      parts.push(`\n## TAKIP ET\n${due.map(c => `- "${c.commitment}"`).join('\n')}`);
    }
  }

  return parts.join('\n');
}

// ─── Layer 4: Scoped Chat History ───

async function buildLayer4Scoped(userId: string, plan: RetrievalPlan): Promise<{ role: string; content: string }[]> {
  const limit = plan.layer4MaxMessages;
  if (limit === 0) return [];

  const { data } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) return [];
  return (data as { role: string; content: string }[]).reverse();
}

// ─── Context Meta Refinement ───

function refineContextMeta(initial: ContextMeta, layer1: string, layer3: string): ContextMeta {
  const meta = { ...initial };

  // Check data completeness
  const missing: string[] = [];
  if (layer1.includes('Profil henuz')) missing.push('profile');
  if (layer3.includes('KAYIT YOK')) missing.push('today_meals');
  meta.missingDataTypes = missing;

  // Estimate confidence from available data
  if (missing.length === 0 && layer3.length > 200) {
    meta.confidenceLevel = 'high';
  } else if (missing.length > 1 || layer3.length < 50) {
    meta.confidenceLevel = 'low';
  } else {
    meta.confidenceLevel = 'medium';
  }

  // Count days with data (rough estimate from layer3 content)
  const dateMatches = layer3.match(/\d{2}-\d{2}/g);
  meta.daysWithCompleteData = dateMatches ? new Set(dateMatches).size : 0;

  return meta;
}
