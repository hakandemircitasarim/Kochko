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

// Token budget allocation (Spec 5.1)
const TOKEN_BUDGET = {
  TOTAL: 130_000, // 65% of 200K context window
  LAYER1_PCT: 0.15, // ~19,500 tokens
  LAYER2_PCT: 0.10, // ~13,000 tokens
  LAYER3_PCT: 0.25, // ~32,500 tokens
  LAYER4_PCT: 0.35, // ~45,500 tokens (chat history + AI response room)
};

// Approximate: 1 token ≈ 3.5 Turkish characters
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export interface FullContext {
  systemPrompt: string;
  layer1: string; // structured profile
  layer2: string; // AI summary
  layer3: string; // recent data
  layer4: { role: string; content: string }[]; // chat history
  taskMode: string;
  estimatedTokens: number;
}

/**
 * Build Layer 1: Structured Profile (Spec 5.1)
 * Always included. Contains all profile fields as structured data.
 */
async function buildLayer1(userId: string): Promise<string> {
  const [profileRes, goalRes, prefsRes, healthRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('goals').select('*').eq('user_id', userId).eq('is_active', true).order('phase_order').limit(3),
    supabaseAdmin.from('food_preferences').select('food_name, preference, is_allergen, allergen_severity').eq('user_id', userId),
    supabaseAdmin.from('health_events').select('event_type, description, is_ongoing').eq('user_id', userId),
  ]);

  const p = profileRes.data;
  if (!p) return 'Profil henuz olusturulmamis.';

  const now = new Date();
  const age = p.birth_year ? now.getFullYear() - p.birth_year : null;
  const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });
  const hour = now.getHours();
  const minute = now.getMinutes().toString().padStart(2, '0');

  const goals = (goalRes.data ?? []) as { goal_type: string; target_weight_kg: number; priority: string; phase_label: string; weekly_rate: number }[];
  const prefs = (prefsRes.data ?? []) as { food_name: string; preference: string; is_allergen: boolean; allergen_severity: string | null }[];
  const health = (healthRes.data ?? []) as { event_type: string; description: string; is_ongoing: boolean }[];

  const neverFoods = prefs.filter(f => f.preference === 'never' || f.preference === 'dislike').map(f => f.food_name);
  const allergens = prefs.filter(f => f.is_allergen).map(f => `${f.food_name}${f.allergen_severity === 'severe' ? ' (CIDDI)' : ''}`);
  const lovedFoods = prefs.filter(f => f.preference === 'love' || f.preference === 'like').map(f => f.food_name);
  const ongoingHealth = health.filter(h => h.is_ongoing);

  const isOnboarding = !p.onboarding_completed;

  return `## ZAMAN
${dayName}, ${hour}:${minute} | ${now.toISOString().split('T')[0]}

## PROFIL
${isOnboarding ? '*** ONBOARDING MODU - Sohbetle bilgi topla, form doldurtma ***\n' : ''}Cinsiyet: ${p.gender ?? '?'} | Yas: ${age ?? '?'} | Boy: ${p.height_cm ?? '?'}cm | Kilo: ${p.weight_kg ?? '?'}kg
Aktivite: ${p.activity_level ?? '?'} | Ekipman: ${p.equipment_access ?? '?'} | Antrenman: ${p.training_style ?? '?'}
Yemek becerisi: ${p.cooking_skill ?? '?'} | Butce: ${p.budget_level ?? '?'} | Porsiyon dili: ${p.portion_language ?? 'household'}
Diyet modu: ${p.diet_mode ?? 'standard'}${p.if_active ? ` | IF: ${p.if_window} (${p.if_eating_start}-${p.if_eating_end})` : ''}
Koc tonu: ${p.coach_tone ?? 'balanced'}
${p.menstrual_tracking ? `Regl takibi aktif | Siklus: ${p.menstrual_cycle_length ?? '?'} gun` : ''}
${p.periodic_state ? `*** DONEMSEL DURUM: ${p.periodic_state} (${p.periodic_state_start} - ${p.periodic_state_end ?? '?'}) ***${(() => { if (p.periodic_state_end) { const days = Math.ceil((new Date(p.periodic_state_end).getTime() - new Date().getTime()) / (1000*60*60*24)); return days > 0 ? ` | ${days} gun kaldi` : ' | SURESI DOLDU'; } return ''; })()}` : ''}
${(() => { const m = new Date().getMonth() + 1; const s = m >= 3 && m <= 5 ? 'ilkbahar' : m >= 6 && m <= 8 ? 'yaz' : m >= 9 && m <= 11 ? 'sonbahar' : 'kis'; return `MEVSIM: ${s}`; })()}

## HEDEFLER
${goals.length > 0 ? goals.map(g => {
  const tw = g.target_weight_kg as number | null;
  const cw = p.weight_kg as number | null;
  const created = g.created_at as string;
  const weeksElapsed = Math.max(1, Math.round((Date.now() - new Date(created).getTime()) / (7*24*60*60*1000)));
  const targetWeeks = (g.target_weeks as number | null) ?? 12;
  const weeksLeft = Math.max(0, targetWeeks - weeksElapsed);
  const kgRemaining = tw && cw ? Math.abs(cw - tw) : null;
  const kgLost = tw && cw ? (g.goal_type === 'lose_weight' ? (p.weight_kg as number) - cw : cw - (p.weight_kg as number)) : null;
  const pct = tw && cw && kgRemaining !== null ? Math.min(100, Math.round(((Math.abs((p.weight_kg as number) - tw) - kgRemaining) / Math.abs((p.weight_kg as number) - tw)) * 100)) : null;
  return `${g.phase_label ?? g.goal_type}: ${tw ?? '?'}kg | ${g.priority} | ${g.weekly_rate ?? '?'}kg/hafta | ${weeksElapsed}/${targetWeeks} hafta | ${kgRemaining !== null ? kgRemaining.toFixed(1) + 'kg kaldi' : ''} | ${pct !== null ? '%' + pct : ''}`;
}).join('\n') : 'Hedef belirlenmemis'}

## KALORI
Antrenman gunu: ${p.calorie_range_training_min ?? '?'}-${p.calorie_range_training_max ?? '?'} kcal
Dinlenme gunu: ${p.calorie_range_rest_min ?? '?'}-${p.calorie_range_rest_max ?? '?'} kcal
Protein: ${p.protein_per_kg ?? '?'}g/kg (${p.weight_kg && p.protein_per_kg ? Math.round(p.weight_kg * p.protein_per_kg) : '?'}g)
Makro: P${p.macro_protein_pct}% K${p.macro_carb_pct}% Y${p.macro_fat_pct}%
Su: ${p.water_target_liters ?? '?'}L

## ASLA ONERME
${neverFoods.length > 0 ? neverFoods.join(', ') : 'Belirtilmemis'}
${allergens.length > 0 ? `ALERJENLER: ${allergens.join(', ')}` : ''}

## SEVDIKLERI
${lovedFoods.length > 0 ? lovedFoods.join(', ') : 'Belirtilmemis'}

${ongoingHealth.length > 0 ? `## SAGLIK GECMISI\n${ongoingHealth.map(h => `- [${h.event_type}] ${h.description}`).join('\n')}` : ''}
${isOnboarding ? `\nEKSIK BILGILER: ${[!p.height_cm && 'boy', !p.weight_kg && 'kilo', !p.birth_year && 'yas', !p.gender && 'cinsiyet', goals.length === 0 && 'hedef'].filter(Boolean).join(', ')}` : ''}`.trim();
}

/**
 * Build Layer 2: AI Summary (Spec 5.1)
 * The persistent memory. Always included.
 */
async function buildLayer2(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('ai_summary')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return 'Henuz AI ozeti olusturulmamis - kullaniciyi taniyarak ogren.';

  const s = data as Record<string, unknown>;
  const parts: string[] = [];

  if (s.general_summary) parts.push(`## GENEL OZET\n${s.general_summary}`);

  const patterns = s.behavioral_patterns as { type: string; description: string; intervention: string }[] | null;
  if (patterns && patterns.length > 0) {
    parts.push(`## KALIPLAR\n${patterns.map(p => `- [${p.type}] ${p.description} -> ${p.intervention}`).join('\n')}`);
  }

  if (s.coaching_notes) parts.push(`## KOCLUK NOTLARI\n${s.coaching_notes}`);

  // Spec 5.15: Learned meal times
  const learnedMealTimes = s.learned_meal_times as Record<string, string> | null;
  if (learnedMealTimes && Object.keys(learnedMealTimes).length > 0) {
    const timeLabels: Record<string, string> = { breakfast: 'kahvalti', lunch: 'ogle', dinner: 'aksam', snack: 'atistirma' };
    const formatted = Object.entries(learnedMealTimes)
      .map(([k, v]) => `${timeLabels[k] ?? k} ${v}`)
      .join(', ');
    parts.push(`## OGRENILEN OGUN SAATLERI\nOgrenilen ogun saatleri: ${formatted}`);
  }

  const portion = s.portion_calibration as Record<string, unknown> | null;
  if (portion && Object.keys(portion).length > 0) {
    const formatted = Object.entries(portion).map(([k, v]) => `${k}=${v}g`).join(', ');
    parts.push(`## PORSIYON HAFIZASI\nPORSIYON HAFIZASI: ${formatted}`);
  }

  const strength = s.strength_records as Record<string, { '1rm': number }> | null;
  if (strength && Object.keys(strength).length > 0) {
    parts.push(`## GUC KAYITLARI\n${Object.entries(strength).map(([k, v]) => `${k}: 1RM=${v['1rm']}kg`).join(', ')}`);
  }

  if (s.user_persona) parts.push(`Persona: ${s.user_persona}`);
  if (s.nutrition_literacy) parts.push(`Beslenme okuryazarligi: ${s.nutrition_literacy}`);
  if (s.learned_tone_preference) parts.push(`Ogrenilen ton: ${s.learned_tone_preference}`);
  // A1: Structured alcohol pattern
  const alcoholPattern = s.alcohol_pattern as { pattern: string; frequency: string; impact: string } | string | null;
  if (alcoholPattern) {
    if (typeof alcoholPattern === 'object') {
      parts.push(`Alkol kalibi: ${alcoholPattern.pattern} | Siklik: ${alcoholPattern.frequency} | Etki: ${alcoholPattern.impact}`);
    } else {
      parts.push(`Alkol kalibi: ${alcoholPattern}`);
    }
  }
  if (s.caffeine_sleep_notes) parts.push(`Kafein-uyku: ${s.caffeine_sleep_notes}`);
  // A2: Social eating notes (structured date-stamped)
  if (s.social_eating_notes) parts.push(`Sosyal yeme: ${s.social_eating_notes}`);
  if (s.recovery_pattern) parts.push(`Toparlanma: ${s.recovery_pattern}`);
  if (s.menstrual_notes) parts.push(`Regl notlari: ${s.menstrual_notes}`);
  if (s.weekly_budget_pattern) parts.push(`Haftalik butce kalibi: ${s.weekly_budget_pattern}`);
  if (s.supplement_notes) parts.push(`Supplement: ${s.supplement_notes}`);
  if (s.seasonal_notes) parts.push(`## DONEMSEL NOTLAR\n${s.seasonal_notes}`);

  // A3: Progressive disclosure — track introduced features
  const featuresIntroduced = s.features_introduced as string[] | null;
  if (featuresIntroduced && featuresIntroduced.length > 0) {
    parts.push(`## TANITILAN OZELLIKLER (bunlari tekrar tanitma)\n${featuresIntroduced.join(', ')}`);
  }

  const habits = s.habit_progress as { habit: string; status: string; streak: number }[] | null;
  if (habits && habits.length > 0) {
    parts.push(`## ALISKANLIKLAR\n${habits.map(h => `- ${h.habit}: ${h.status} (${h.streak} gun)`).join('\n')}`);
  }

  const microRisks = s.micro_nutrient_risks as { nutrient: string; risk_level: string }[] | null;
  if (microRisks && microRisks.length > 0) {
    parts.push(`## MIKRO BESIN RISKLERI\n${microRisks.map(r => `- ${r.nutrient}: ${r.risk_level}`).join('\n')}`);
  }

  return parts.join('\n\n') || 'AI ozeti bos.';
}

/**
 * Build Layer 3: Recent Data (Spec 5.1)
 * Last 7-14 days of logs, metrics, plans, reports.
 * Budgeted to %25 of total - if too large, compress to 7 days.
 */
async function buildLayer3(userId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const [mealsRes, workoutsRes, metricsRes, reportsRes, commitmentsRes, planRes, labRes] = await Promise.all([
    supabaseAdmin.from('meal_logs').select('raw_input, meal_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', fourteenDaysAgo).eq('is_deleted', false).order('logged_at'),
    supabaseAdmin.from('workout_logs').select('raw_input, duration_min, workout_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', fourteenDaysAgo).order('logged_at'),
    supabaseAdmin.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps, mood_score')
      .eq('user_id', userId).gte('date', fourteenDaysAgo).order('date'),
    supabaseAdmin.from('daily_reports').select('date, compliance_score, deviation_reason, tomorrow_action')
      .eq('user_id', userId).gte('date', fourteenDaysAgo).order('date'),
    supabaseAdmin.from('user_commitments').select('commitment, follow_up_at, status')
      .eq('user_id', userId).eq('status', 'pending').order('follow_up_at').limit(5),
    supabaseAdmin.from('daily_plans').select('date, calorie_target_min, calorie_target_max, focus_message, status')
      .eq('user_id', userId).eq('date', today).order('version', { ascending: false }).limit(1),
    supabaseAdmin.from('lab_values').select('parameter_name, value, unit, reference_min, reference_max, is_out_of_range')
      .eq('user_id', userId).eq('is_out_of_range', true).limit(5),
  ]);

  const meals = mealsRes.data ?? [];
  const workouts = workoutsRes.data ?? [];
  const metrics = (metricsRes.data ?? []) as { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; mood_score: number | null }[];
  const reports = (reportsRes.data ?? []) as { date: string; compliance_score: number; deviation_reason: string | null; tomorrow_action: string }[];
  const commitments = (commitmentsRes.data ?? []) as { commitment: string; follow_up_at: string; status: string }[];
  const todayPlan = planRes.data?.[0] as { calorie_target_min: number; calorie_target_max: number; focus_message: string; status: string } | undefined;
  const labAlerts = (labRes.data ?? []) as { parameter_name: string; value: number; unit: string }[];

  // Today's data
  const todayMeals = meals.filter((m: { logged_for_date: string }) => m.logged_for_date === today);
  const todayWorkouts = workouts.filter((w: { logged_for_date: string }) => w.logged_for_date === today);
  const todayMetrics = metrics.find(m => m.date === today);

  // Recent compliance
  const avgCompliance = reports.length > 0
    ? Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / reports.length)
    : null;

  // Weight trend
  const weights = metrics.filter(m => m.weight_kg).map(m => `${m.date.slice(5)}: ${m.weight_kg}kg`);

  // Due commitments
  const now = new Date();
  const dueCommitments = commitments.filter(c => new Date(c.follow_up_at) <= now);

  const parts: string[] = [];

  // Today
  parts.push(`## BUGUN (${today})`);
  if (todayPlan) {
    parts.push(`Plan: ${todayPlan.calorie_target_min}-${todayPlan.calorie_target_max} kcal | ${todayPlan.status} | "${todayPlan.focus_message}"`);
  }
  parts.push(`Ogunler: ${todayMeals.length > 0 ? todayMeals.map((m: { meal_type: string; raw_input: string }) => `[${m.meal_type}] ${m.raw_input}`).join(' | ') : 'KAYIT YOK'}`);
  parts.push(`Antrenman: ${todayWorkouts.length > 0 ? todayWorkouts.map((w: { raw_input: string }) => w.raw_input).join(', ') : 'yok'}`);
  parts.push(`Su: ${todayMetrics?.water_liters ?? 0}L | Tarti: ${todayMetrics?.weight_kg ?? '-'} | Uyku: ${todayMetrics?.sleep_hours ?? '-'}sa | Adim: ${todayMetrics?.steps ?? '-'} | Mood: ${todayMetrics?.mood_score ?? '-'}/5`);

  // Recent trend
  if (reports.length > 0) {
    parts.push(`\n## SON ${reports.length} GUN`);
    parts.push(`Ort. uyum: ${avgCompliance}/100`);
    const deviations = reports.filter(r => r.deviation_reason).map(r => r.deviation_reason);
    if (deviations.length > 0) parts.push(`Sapmalar: ${deviations.join(', ')}`);
  }

  if (weights.length > 1) {
    parts.push(`Kilo trendi: ${weights.join(', ')}`);
  }

  // Lab alerts
  if (labAlerts.length > 0) {
    parts.push(`\n## LAB UYARILARI\n${labAlerts.map(l => `${l.parameter_name}: ${l.value} ${l.unit}`).join('\n')}`);
  }

  // Commitments
  if (dueCommitments.length > 0) {
    parts.push(`\n## TAKIP ET\n${dueCommitments.map(c => `- "${c.commitment}"`).join('\n')}`);
  }
  const pendingCommitments = commitments.filter(c => !dueCommitments.includes(c));
  if (pendingCommitments.length > 0) {
    parts.push(`Bekleyen: ${pendingCommitments.map(c => `"${c.commitment}" (${c.follow_up_at.slice(0, 10)})`).join(', ')}`);
  }

  let result = parts.join('\n');

  // Token budget check - if too large, smart compress instead of truncation
  const maxTokens = Math.floor(TOKEN_BUDGET.TOTAL * TOKEN_BUDGET.LAYER3_PCT);
  if (estimateTokens(result) > maxTokens) {
    result = compressLayer3(parts, maxTokens);
  }

  return result;
}

/**
 * Smart Layer 3 compression.
 * Priority: today > yesterday > lab alerts > commitments > recent days > old days
 * Never truncates mid-JSON. Drops oldest complete sections first.
 */
function compressLayer3(parts: string[], maxTokens: number): string {
  // Categorize parts by priority
  const prioritized: { text: string; priority: number }[] = parts.map(part => {
    const lower = part.toLowerCase();
    if (lower.includes('bugun') || lower.includes('today')) return { text: part, priority: 10 };
    if (lower.includes('dun') || lower.includes('yesterday')) return { text: part, priority: 9 };
    if (lower.includes('lab') || lower.includes('uyari')) return { text: part, priority: 8 };
    if (lower.includes('takip') || lower.includes('commitment')) return { text: part, priority: 7 };
    if (lower.includes('plan') || lower.includes('rapor')) return { text: part, priority: 6 };
    return { text: part, priority: 3 }; // older data
  });

  // Sort by priority descending
  prioritized.sort((a, b) => b.priority - a.priority);

  // Add parts until budget is hit
  const kept: string[] = [];
  let currentTokens = 0;
  for (const item of prioritized) {
    const itemTokens = estimateTokens(item.text);
    if (currentTokens + itemTokens <= maxTokens) {
      kept.push(item.text);
      currentTokens += itemTokens;
    }
  }

  if (kept.length < parts.length) {
    kept.push(`\n[${parts.length - kept.length} eski bolum token butcesi icin cikarildi]`);
  }

  return kept.join('\n');
}

/**
 * Build Layer 4: Active Chat History
 * Recent conversation messages, limited by token budget.
 */
async function buildLayer4(userId: string): Promise<{ role: string; content: string }[]> {
  const { data } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return [];

  const messages = (data as { role: string; content: string }[]).reverse();

  // Token budget for Layer 4
  const maxTokens = Math.floor(TOKEN_BUDGET.TOTAL * TOKEN_BUDGET.LAYER4_PCT);
  let totalTokens = 0;
  const trimmed: { role: string; content: string }[] = [];

  // Add from most recent, stop when budget exceeded
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(messages[i].content);
    if (totalTokens + msgTokens > maxTokens) break;
    trimmed.unshift(messages[i]);
    totalTokens += msgTokens;
  }

  return trimmed;
}

/**
 * Assemble all 4 layers into a complete context.
 */
export async function buildFullContext(userId: string): Promise<FullContext> {
  const [layer1, layer2, layer3, layer4] = await Promise.all([
    buildLayer1(userId),
    buildLayer2(userId),
    buildLayer3(userId),
    buildLayer4(userId),
  ]);

  const totalTokens =
    estimateTokens(layer1) +
    estimateTokens(layer2) +
    estimateTokens(layer3) +
    layer4.reduce((s, m) => s + estimateTokens(m.content), 0);

  return {
    systemPrompt: '', // caller sets this based on task mode
    layer1,
    layer2,
    layer3,
    layer4,
    taskMode: 'coaching', // default
    estimatedTokens: totalTokens,
  };
}

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
    console.error('updateLayer2 merge failed:', error.message);
  }
}

/**
 * Append new behavioral patterns atomically.
 * Safer than updateLayer2({ behavioral_patterns: [...] }) for concurrent writes.
 * Caps at 20 most recent entries.
 */
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
  await supabaseAdmin.from('repair_history').insert({
    user_id: userId,
    repair_type: repairType,
    original_text: originalInput,
    corrected_text: correctedInput,
    food_name: foodItem,
  });
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

    await supabaseAdmin
      .from('ai_summary')
      .update({ behavioral_patterns: activePatterns, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
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
    const h = new Date(m.logged_at).getHours() + new Date(m.logged_at).getMinutes() / 60;
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

  const note = `Gec yemek (21:00+) → uyku kalitesi gozleminde ortalama ${avgLate.toFixed(1)}sa vs erken yemek gunlerinde ${avgEarly.toFixed(1)}sa (fark ${diff.toFixed(1)}sa).`;
  await updateLayer2(userId, { caffeine_sleep_notes: note }).catch(() => {});
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
    trigger: 'activity_level_recalibrated',
    priority: 'low',
    message: `Profilinde aktivite: ${declared}, son 4 haftaya bakınca: ${observedLevel} (${Math.round(avgSteps)} adim/gun, ${workoutsPerWeek.toFixed(1)} seans/hafta). Aktivite seviyeni ${observedLevel} yapayim mi? Kalori hedefin bu degisime gore guncellenir.`,
  }).catch(() => {});
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
    const hour = new Date(s.logged_at).getHours();
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
  }).catch(() => {});
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
 * Tone values: 'concise' | 'conversational' | 'supportive' | 'analytical' | 'balanced'
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

  // Derive tone
  let tone: 'concise' | 'conversational' | 'supportive' | 'analytical' | 'balanced' = 'balanced';
  if (correctionRate > 0.1) {
    tone = 'analytical'; // user catches errors → wants precision
  } else if (avgLen <= 20) {
    tone = 'concise'; // terse user wants terse responses
  } else if (avgLen > 80 && emojiRate > 0.1) {
    tone = 'supportive'; // long messages with emoji → wants warmth
  } else if (questionRate > 0.2) {
    tone = 'analytical'; // asks lots of why → wants data/reasoning
  } else if (avgLen > 80) {
    tone = 'conversational'; // long messages without emoji → wants dialogue
  }

  // Persist via atomic merge helper
  await updateLayer2(userId, { learned_tone_preference: tone });
}
