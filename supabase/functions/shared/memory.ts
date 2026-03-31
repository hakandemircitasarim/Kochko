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
    supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
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
    .single();

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
  if (s.alcohol_pattern) parts.push(`Alkol kalibi: ${s.alcohol_pattern}`);
  if (s.caffeine_sleep_notes) parts.push(`Kafein-uyku: ${s.caffeine_sleep_notes}`);
  if (s.social_eating_notes) parts.push(`Sosyal yeme: ${s.social_eating_notes}`);
  if (s.recovery_pattern) parts.push(`Toparlanma: ${s.recovery_pattern}`);
  if (s.menstrual_notes) parts.push(`Regl notlari: ${s.menstrual_notes}`);
  if (s.weekly_budget_pattern) parts.push(`Haftalik butce kalibi: ${s.weekly_budget_pattern}`);
  if (s.supplement_notes) parts.push(`Supplement: ${s.supplement_notes}`);
  if (s.seasonal_notes) parts.push(`## DONEMSEL NOTLAR\n${s.seasonal_notes}`);

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

  // Token budget check - if too large, compress
  const maxTokens = Math.floor(TOKEN_BUDGET.TOTAL * TOKEN_BUDGET.LAYER3_PCT);
  if (estimateTokens(result) > maxTokens) {
    // Compress: remove old data, keep only 7 days and today
    result = result.slice(0, maxTokens * 3); // rough truncation
  }

  return result;
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
 */
export async function updateLayer2(
  userId: string,
  updates: Record<string, unknown>
): Promise<void> {
  // Check if summary exists
  const { data: existing } = await supabaseAdmin
    .from('ai_summary')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    await supabaseAdmin
      .from('ai_summary')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabaseAdmin
      .from('ai_summary')
      .insert({ user_id: userId, ...updates });
  }
}
