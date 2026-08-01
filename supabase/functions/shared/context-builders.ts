/**
 * KOCHKO ACTION-SPECIFIC CONTEXT BUILDERS
 *
 * Instead of one generic buildContext() that fetches everything,
 * each builder fetches only what the retrieval plan specifies.
 *
 * Design: RetrievalPlan → focused SQL queries → compact context string
 */

import { supabaseAdmin } from './supabase-admin.ts';
import { getLocalParts, getEffectiveDateForUser, shiftDateString } from './day-boundary.ts';
import type {
  RetrievalPlan, Layer1Focus, Layer2Focus, Layer3DataType,
  ContextMeta, DataConfidence,
} from './retrieval-planner.ts';
import { isActivePattern } from './patterns.ts';

// (estimateTokens is declared once below, near LAYER4_TOKEN_BUDGET, to avoid a duplicate.)

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
export async function buildContextFromPlan(
  userId: string,
  plan: RetrievalPlan,
  sessionId?: string,
  // FIX (audit AI-CTX-01): the caller (ai-chat) computes the user's day-boundary-aware
  // effectiveToday and keys every WRITE (logged_for_date / daily_metrics.date) to it.
  // Thread it in so the read-side "today"/"dün"/per-day filters agree with the write-side
  // date. Optional: when omitted, buildLayer3Scoped derives it from the profile's tz +
  // day_boundary_hour (still effective-day arithmetic, never raw server UTC).
  effectiveToday?: string,
): Promise<BuiltContext> {
  const [layer1, layer2, layer3raw, layer4] = await Promise.all([
    buildLayer1Scoped(userId, plan),
    buildLayer2Scoped(userId, plan),
    buildLayer3Scoped(userId, plan, effectiveToday),
    buildLayer4Scoped(userId, plan, sessionId),
  ]);

  // FIX (audit AI-CTX-03): cap total Layer 1-3 size. Only Layer 4 was budget-trimmed
  // before; Layers 1-3 had no ceiling. Trim the oldest Layer-3 detail first when the
  // static layers blow past the budget (rare on 128k models, but bounds cost/latency).
  const layer3 = trimLayer3ToBudget(layer1, layer2, layer3raw);

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
    supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle(),
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
  // FIX (audit AI-CTX-02/HIGH): the edge runtime is UTC, so getHours()/toISOString()/
  // toLocaleDateString emitted UTC time+date — the coach reasoned about the wrong hour and
  // wrong "today" (off by the user's UTC offset). Use the user's timezone (active travel tz
  // → home tz) for wall-clock time and the day-boundary-aware effective date for "today".
  const tz = (p.active_timezone as string | null) || (p.home_timezone as string | null) || null;
  const local = getLocalParts(tz, now);
  const effectiveDate = getEffectiveDateForUser(tz, p.day_boundary_hour as number | null, now);
  const age = p.birth_year ? local.year - p.birth_year : null;
  const dayName = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${effectiveDate}T12:00:00Z`));
  const hour = local.hour;
  const minute = local.minute.toString().padStart(2, '0');
  const isOnboarding = !p.onboarding_completed;

  const parts: string[] = [];

  // Time context — always include (user-local wall-clock + day-boundary effective date)
  parts.push(`## ZAMAN\n${dayName}, ${hour}:${minute} | ${effectiveDate}`);

  // Demographics — always include at minimum
  const wAge = await weightAgeSuffix(userId);
  const demoLine = `Cinsiyet: ${p.gender ?? '?'} | Yas: ${age ?? '?'} | Boy: ${p.height_cm ?? '?'}cm | Kilo: ${p.weight_kg ?? '?'}kg${wAge}`;
  parts.push(`## PROFIL\n${isOnboarding ? '*** ONBOARDING MODU ***\n' : ''}${demoLine}`);

  // Durable safety facts from the canonical spine — ALWAYS present (not gated on layer1Focus),
  // so the coach recalls a surgery/allergy/chronic condition on every turn, not just health turns.
  const persistentHealth = await buildPersistentHealthBlock(userId);
  if (persistentHealth) parts.push(persistentHealth);

  // Schedule & lifestyle — always include if available
  const scheduleItems: string[] = [];
  if (p.occupation) scheduleItems.push(`Meslek: ${p.occupation}`);
  if (p.work_start && p.work_end) scheduleItems.push(`Calisma: ${p.work_start}-${p.work_end}`);
  if (p.sleep_time && p.wake_time) scheduleItems.push(`Uyku: ${p.sleep_time}-${p.wake_time}`);
  if (p.sleep_quality) scheduleItems.push(`Uyku kalitesi: ${p.sleep_quality}`);
  if (p.stress_level) scheduleItems.push(`Stres: ${p.stress_level}${p.stress_sources ? ` (${p.stress_sources})` : ''}`);
  if (scheduleItems.length > 0) parts.push(`\n## GUNLUK RUTIN\n${scheduleItems.join('\n')}`);

  // Motivation & challenges
  const motivItems: string[] = [];
  if (p.motivation_source) motivItems.push(`Motivasyon: ${p.motivation_source}`);
  if (p.biggest_challenge) motivItems.push(`En buyuk zorluk: ${p.biggest_challenge}`);
  if (p.previous_diets) motivItems.push(`Gecmis diyetler: ${p.previous_diets}`);
  if (motivItems.length > 0) parts.push(`\n## MOTIVASYON\n${motivItems.join('\n')}`);

  // Training details
  if (plan.layer1Focus.includes('training') || plan.layer1 === 'full') {
    const trainItems = [`Aktivite: ${p.activity_level ?? '?'} | Ekipman: ${p.equipment_access ?? '?'} | Antrenman: ${p.training_style ?? '?'}`];
    if (p.training_experience) trainItems.push(`Deneyim: ${p.training_experience}`);
    if (p.exercise_history) trainItems.push(`Spor gecmisi: ${p.exercise_history}`);
    if (p.preferred_exercises) trainItems.push(`Tercih ettigi: ${p.preferred_exercises}`);
    if (p.disliked_exercises) trainItems.push(`Sevmedigi: ${p.disliked_exercises}`);
    if (p.available_training_times) trainItems.push(`Antrenman saatleri: ${p.available_training_times}`);
    parts.push(`\n## ANTRENMAN\n${trainItems.join('\n')}`);
  }

  // Nutrition details
  if (plan.layer1Focus.includes('nutrition') || plan.layer1 === 'full') {
    const nutItems = [`Yemek becerisi: ${p.cooking_skill ?? '?'} | Butce: ${p.budget_level ?? '?'} | Porsiyon dili: ${p.portion_language ?? 'household'}`];
    nutItems.push(`Diyet modu: ${p.diet_mode ?? 'standard'}${p.dietary_restriction ? ` | Kisitlama: ${p.dietary_restriction}` : ''}${p.if_active ? ` | IF: ${p.if_window} (${p.if_eating_start}-${p.if_eating_end})` : ''}`);
    nutItems.push(`Koc tonu: ${p.coach_tone ?? 'balanced'}`);
    if (p.meal_count_preference) nutItems.push(`Ogun sayisi: ${p.meal_count_preference}`);
    if (p.eating_out_frequency) nutItems.push(`Disarida yeme: ${p.eating_out_frequency}`);
    if (p.fastfood_frequency) nutItems.push(`Fast food: ${p.fastfood_frequency}`);
    if (p.skipped_meals) nutItems.push(`Atlanan ogunler: ${p.skipped_meals}`);
    if (p.night_eating_habit) nutItems.push(`Gece yeme: ${p.night_eating_habit}`);
    if (p.emotional_eating) nutItems.push(`Duygusal yeme: ${p.emotional_eating}`);
    if (p.snacking_habit) nutItems.push(`Atistirma: ${p.snacking_habit}`);
    if (p.caffeine_intake) nutItems.push(`Kafein: ${p.caffeine_intake}`);
    parts.push(nutItems.join('\n'));

    // Kitchen & logistics
    const kitchenItems: string[] = [];
    if (p.meal_prep_time) kitchenItems.push(`Hazirlama suresi: ${p.meal_prep_time}`);
    if (p.kitchen_equipment) kitchenItems.push(`Ekipman: ${p.kitchen_equipment}`);
    if (p.household_cooking) kitchenItems.push(`Kim pisiriyor: ${p.household_cooking}`);
    if (p.household_diet_challenge) kitchenItems.push(`Ev zorluklari: ${p.household_diet_challenge}`);
    if (p.meal_prep_active) kitchenItems.push(`Meal prep: ${p.meal_prep_days?.join(', ') ?? 'aktif'}`);
    if (kitchenItems.length > 0) parts.push(`\n## MUTFAK\n${kitchenItems.join('\n')}`);

    // Calorie targets
    parts.push(`\n## KALORI\nAntrenman gunu: ${p.calorie_range_training_min ?? '?'}-${p.calorie_range_training_max ?? '?'} kcal`);
    parts.push(`Dinlenme gunu: ${p.calorie_range_rest_min ?? '?'}-${p.calorie_range_rest_max ?? '?'} kcal`);
    parts.push(`Protein: ${p.protein_per_kg ?? '?'}g/kg (${p.weight_kg && p.protein_per_kg ? Math.round(p.weight_kg * p.protein_per_kg) : '?'}g)`);
    parts.push(`Su: ${p.water_target_liters ?? '?'}L${p.step_target ? ` | Adim hedefi: ${p.step_target}` : ''}`);

    // Food preferences
    const prefs = (prefsRes.data ?? []) as { food_name: string; preference: string; is_allergen: boolean; allergen_severity: string | null }[];
    const neverFoods = prefs.filter(f => f.preference === 'never' || f.preference === 'dislike').map(f => f.food_name);
    // #memory: also fold in profiles.disliked_foods — the JSONB set onboarding writes (mig 031).
    // It was WRITE-ONLY: never surfaced to the coach, so onboarding-declared dislikes were
    // silently ignored by every plan. Dedup against food_preferences dislikes already listed.
    const seenNever = new Set(neverFoods.map(f => f.toLocaleLowerCase('tr')));
    for (const it of ((p.disliked_foods as { item?: string }[] | null) ?? [])) {
      const item = it?.item?.trim();
      if (item && !seenNever.has(item.toLocaleLowerCase('tr'))) { neverFoods.push(item); seenNever.add(item.toLocaleLowerCase('tr')); }
    }
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
    if (health.length > 0) {
      const ongoing = health.filter(h => h.is_ongoing);
      const past = health.filter(h => !h.is_ongoing);
      const healthParts: string[] = [];
      if (ongoing.length > 0) healthParts.push(`Aktif:\n${ongoing.map(h => `- [${h.event_type}] ${h.description}`).join('\n')}`);
      if (past.length > 0) healthParts.push(`Gecmis:\n${past.map(h => `- [${h.event_type}] ${h.description}`).join('\n')}`);
      parts.push(`\n## SAGLIK GECMISI\n${healthParts.join('\n')}`);
    }

    // Health fields from profile
    const healthProfile: string[] = [];
    if (p.digestive_issues) healthProfile.push(`Sindirim: ${p.digestive_issues}`);
    if (p.hormone_conditions) healthProfile.push(`Hormon: ${p.hormone_conditions}`);
    if (healthProfile.length > 0) parts.push(healthProfile.join('\n'));

    // Body composition if available. hip_cm was write-only (collected, never surfaced) —
    // include it + the waist-to-hip ratio (a real fat-distribution / progress signal).
    const bodyItems: string[] = [];
    if (p.body_fat_pct) bodyItems.push(`Yag orani: %${p.body_fat_pct}`);
    if (p.waist_cm) bodyItems.push(`Bel: ${p.waist_cm}cm`);
    if (p.hip_cm) bodyItems.push(`Kalca: ${p.hip_cm}cm`);
    if (p.waist_cm && p.hip_cm) bodyItems.push(`Bel/Kalca oran: ${((p.waist_cm as number) / (p.hip_cm as number)).toFixed(2)}`);
    if (bodyItems.length > 0) parts.push(`\n## VUCUT OLCULERI\n${bodyItems.join(' | ')}`);

    // Periodic state — translate the internal token to a human label so the AI's
    // Layer-1 context doesn't carry a raw 'maintenance'/'mini_cut' enum (#R5-7).
    if (p.periodic_state) {
      const PS_LABELS: Record<string, string> = {
        ramadan: 'Ramazan', holiday: 'Tatil', illness: 'Hastalık', busy_work: 'Yoğun İş Dönemi',
        exam: 'Sınav Dönemi', pregnancy: 'Hamilelik', breastfeeding: 'Emzirme', injury: 'Sakatlık',
        travel: 'Seyahat', custom: 'Özel Durum', maintenance: 'Bakım Dönemi', mini_cut: 'Mini Kesim',
      };
      const psLabel = PS_LABELS[p.periodic_state as string] ?? p.periodic_state;
      parts.push(`\n*** DONEMSEL DURUM: ${psLabel} (${p.periodic_state_start} - ${p.periodic_state_end ?? '?'}) ***`);
    }

    // Menstrual + Cycle Phase
    if (p.menstrual_tracking) {
      let cycleInfo = `Regl takibi aktif | Siklus: ${p.menstrual_cycle_length ?? '?'} gun`;
      if (p.menstrual_last_period_start && p.menstrual_cycle_length
          && new Date(p.menstrual_last_period_start as string).getTime() <= Date.now()) {
        // Guard future/invalid date -> no negative day-of-cycle / bogus phase (#R2-M1).
        const cycleLen = p.menstrual_cycle_length as number;
        const lastStart = p.menstrual_last_period_start as string;
        const daysSince = Math.floor((Date.now() - new Date(lastStart).getTime()) / 86400000);
        const dayOfCycle = (daysSince % cycleLen) + 1;
        const ovDay = Math.round(cycleLen / 2);
        let phase = 'follicular';
        if (dayOfCycle <= 5) phase = 'menstrual';
        else if (dayOfCycle <= ovDay - 2) phase = 'follicular';
        else if (dayOfCycle <= ovDay + 1) phase = 'ovulation';
        else phase = 'luteal';
        cycleInfo += ` | Faz: ${phase} (gun ${dayOfCycle})`;
        if (phase === 'luteal') cycleInfo += ' | Kalori: +150kcal, Su: +0.2L, Tarti artisi normal (su tutulumu)';
        if (phase === 'menstrual') cycleInfo += ' | Max antrenman: hafif';
      }
      parts.push(cycleInfo);
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
  // Remaining profile TOPICS so "profilimi doldurmaya devam edelim" gets the ACTUAL next topic
  // instead of a blank "hangi alanda?" (audit: general-chat awareness gap). Runs regardless of
  // onboarding_completed since the topic cards outlive the 5-field quick onboarding.
  {
    const { data: sum } = await supabaseAdmin.from('ai_summary').select('onboarding_tasks_completed').eq('user_id', userId).maybeSingle();
    const done = new Set((sum?.onboarding_tasks_completed as string[] | null) ?? []);
    // FIX (audit MEDIUM): onboarding_tasks_completed is written ONLY on a coach-validated close, so a
    // topic completed via DATA (a goal row, a profile field) reads as "pending" and the coach nags
    // about done topics. Fold in the same real-data signals the gates use, from p/goals already in hand.
    if (goals.length > 0) done.add('set_goal');
    if (p.occupation || p.work_start || p.activity_level) done.add('daily_routine'); // mig 095: activity_level no longer defaults
    if (p.eating_out_frequency || p.fastfood_frequency || p.snacking_habit) done.add('eating_habits');
    if (p.kitchen_equipment || p.meal_prep_time || (p.cooking_skill && p.cooking_skill !== 'basic') || (p.budget_level && p.budget_level !== 'medium')) done.add('kitchen_logistics');
    if (p.training_experience || p.exercise_history || p.preferred_exercises || p.available_training_times) done.add('exercise_history');
    if (p.sleep_time || p.sleep_quality) done.add('sleep_patterns');
    if (p.stress_level || p.motivation_source || p.stress_sources || p.biggest_challenge) done.add('stress_motivation');
    if (p.household_cooking || p.household_diet_challenge) done.add('home_environment');
    if (p.previous_diets) done.add('weight_history');
    const ALL_TOPICS: [string, string][] = [
      ['set_goal', 'Hedef belirleme'], ['daily_routine', 'Günlük rutin'], ['eating_habits', 'Beslenme alışkanlıkları'],
      ['allergies', 'Alerji ve hassasiyetler'], ['kitchen_logistics', 'Mutfak imkanları'], ['exercise_history', 'Spor geçmişi'],
      ['health_history', 'Sağlık geçmişi'], ['weight_history', 'Kilo geçmişi'], ['lab_values', 'Kan tahlilleri'],
      ['sleep_patterns', 'Uyku düzeni'], ['stress_motivation', 'Stres ve motivasyon'], ['home_environment', 'Ev ve çevre'],
    ];
    const pending = ALL_TOPICS.filter(([k]) => !done.has(k)).map(([, t]) => t);
    if (pending.length > 0) {
      parts.push(`KALAN PROFIL KONULARI (kullanici "profilimi doldur / devam edelim" derse "hangi alan?" DIYE SORMA — SIRADAKI konuyu sen oner ve baslat): ${pending.slice(0, 6).join(', ')}`);
    }
  }

  return parts.join('\n').trim();
}

async function buildLayer1Minimal(userId: string): Promise<string> {
  const { data: p } = await supabaseAdmin
    .from('profiles')
    .select('gender, birth_year, height_cm, weight_kg, coach_tone, onboarding_completed, display_name, active_timezone, home_timezone, day_boundary_hour')
    .eq('id', userId)
    .maybeSingle();

  if (!p) return 'Profil henuz olusturulmamis.';

  const now = new Date();
  // FIX (audit AI-CTX-02/HIGH): user-local wall-clock + day-boundary effective date, not UTC.
  const tz = (p.active_timezone as string | null) || (p.home_timezone as string | null) || null;
  const local = getLocalParts(tz, now);
  const effectiveDate = getEffectiveDateForUser(tz, p.day_boundary_hour as number | null, now);
  const age = p.birth_year ? local.year - p.birth_year : null;
  const dayName = new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${effectiveDate}T12:00:00Z`));
  const hour = local.hour;
  const minute = local.minute.toString().padStart(2, '0');

  const health = await buildPersistentHealthBlock(userId);
  return `${dayName}, ${hour}:${minute}\n${p.display_name ? `Ad: ${p.display_name} | ` : ''}Cinsiyet: ${p.gender ?? '?'} | Yas: ${age ?? '?'} | Kilo: ${p.weight_kg ?? '?'}kg | Ton: ${p.coach_tone ?? 'balanced'}${health ? `\n${health}` : ''}`;
}

/**
 * The durable safety/identity facts (surgery, chronic condition, ongoing injury, allergy,
 * intolerance) that must reach the coach on EVERY turn — not only when the message is classified
 * 'health'. Reads the canonical typed spine (user_constraints), which is deduped on write, so the
 * coach never forgets e.g. a gastric surgery on a "ne yiyeyim?" turn. Empty string when none.
 */
/**
 * F4/D3 (lite) — the AGE of the weight. Layer-1 presented a possibly-months-old weigh-in as "the
 * user's weight", the coach asserted it confidently ("şu an 79.5 kilosun") and computed goal
 * distance from it. Ageing NEVER relaxes enforcement (that rule lives in §8); it only changes how
 * the number may be SPOKEN: stale → say the age and ask, don't assert.
 */
async function weightAgeSuffix(userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('daily_metrics').select('date').eq('user_id', userId)
      .not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1);
    const last = data?.[0]?.date as string | undefined;
    if (!last) return ' (tartı kaydı yok — profil beyanı)';
    const days = Math.floor((Date.now() - Date.parse(`${last}T00:00:00Z`)) / 86400000);
    if (days <= 14) return '';
    if (days <= 30) return ` (son tartı ${days} gün önce)`;
    return ` (son tartı ${days} gün önce — güncel olmayabilir; İDDİA ETME, uygun bir anda tartılmayı öner)`;
  } catch { return ''; }
}

async function buildPersistentHealthBlock(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('user_constraints')
    .select('kind, subject, note, severity, source, confirmed_at, stated_at, created_at')
    .eq('user_id', userId).eq('active', true)
    .in('kind', ['surgery', 'condition', 'injury', 'allergen', 'intolerance']);
  const rows = (data ?? []) as Array<{
    kind: string; subject: string; note: string | null; severity: string | null;
    source: string | null; confirmed_at: string | null; stated_at: string | null; created_at: string | null;
  }>;
  if (!rows.length) return '';
  const LABEL: Record<string, string> = {
    surgery: 'Ameliyat', condition: 'Kronik durum', injury: 'Sakatlik', allergen: 'Alerji', intolerance: 'Intolerans',
  };
  // D3 (plan v2, HAFIZA-05/07 + TUTARLILIK-08): provenance + ageing SHAPE THE SPEECH ONLY.
  // Enforcement is untouched — guardrails read getActiveConstraints() and act on every active row
  // regardless of source or age. Two speech rules:
  //   1. inferred/imported + never confirmed → the coach must not present it as established fact.
  //      (User confirming lifts the tag via the existing constraint_confirm → confirmConstraint path.)
  //   2. injury/condition silent for 60+ days → ONE natural reconfirm question, because a healed
  //      knee otherwise haunts every workout plan forever ("neden bana hep kolay hareket veriyor").
  //      Allergen/surgery/intolerance NEVER age — a fıstık allergy does not expire by silence.
  const dayMs = 86400000;
  const ageDays = (r: { confirmed_at: string | null; stated_at: string | null; created_at: string | null }) => {
    const anchor = r.confirmed_at ?? r.stated_at ?? r.created_at;
    if (!anchor) return 0;
    const t = Date.parse(anchor);
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / dayMs) : 0;
  };
  const isUnconfirmed = (r: { source: string | null; confirmed_at: string | null }) =>
    !r.confirmed_at && (r.source === 'inferred' || r.source === 'imported');
  const lines = rows.map((r) =>
    `- ${LABEL[r.kind] ?? r.kind}: ${((r.note || r.subject) ?? '').slice(0, 100)}${r.severity ? ` (${r.severity})` : ''}${isUnconfirmed(r) ? ' [ÇIKARIM — doğrulanmadı]' : ''}`);
  const notes: string[] = [];
  if (rows.some(isUnconfirmed)) {
    notes.push('[ÇIKARIM] etiketli kayıtları kesin gerçek gibi SUNMA ("biliyorum ki..." deme); uygun bir anda tek doğal soruyla doğrula. Doğrulanana kadar güvenlik açısından yine de geçerli say.');
  }
  const stale = rows.filter((r) => (r.kind === 'injury' || r.kind === 'condition') && ageDays(r) > 60);
  if (stale.length) {
    const names = stale.slice(0, 3).map((r) => (r.note || r.subject).slice(0, 40)).join('; ');
    notes.push(`Şu kayıt(lar) 60+ gündür güncellenmedi: ${names}. Uygun bir anda TEK doğal soruyla hâlâ geçerli mi diye sor (her turda değil, bir kez). Cevap gelene kadar geçerli say. Alerji ve ameliyat asla eskimez — onları sorgulama.`);
  }
  return `## KALICI SAGLIK (her zaman dikkate al, unutma)\n${lines.join('\n')}${notes.length ? '\n' + notes.map((n) => `(${n})`).join('\n') : ''}`;
}

// ─── Layer 2: Scoped AI Summary ───

async function buildLayer2Scoped(userId: string, plan: RetrievalPlan): Promise<string> {
  if (plan.layer2 === 'none') return '';

  const { data } = await supabaseAdmin
    .from('ai_summary')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

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
      const scored = patterns.map((p): Record<string, unknown> & { score: number } => ({
        ...p,
        score: computePatternScore(p),
      })).sort((a, b) => b.score - a.score);

      // Take top patterns that fit — exclude resolved AND stale (60+ days silent; Spec 5.7)
      const topPatterns = scored
        .filter(isActivePattern)   // F2/A12: one owner for 'still actionable', shared by all 4 readers
        .slice(0, 10);
      if (topPatterns.length > 0) {
        parts.push(`## KALIPLAR\n${topPatterns.map(p => `- [${p.type}] ${p.description} -> ${p.intervention}${p.times_observed ? ` (${p.times_observed}x)` : ''}`).join('\n')}`);
      }
    }
  }

  // Persona — always include if available (drives tone/style)
  if (isFull || focuses.includes('persona') || s.user_persona) {
    if (s.user_persona) parts.push(`Persona: ${s.user_persona}`);
    if (s.learned_tone_preference) parts.push(`Ogrenilen ton: ${s.learned_tone_preference}`);
    if (s.nutrition_literacy) parts.push(`Beslenme okuryazarligi: ${s.nutrition_literacy}`);
  }

  // Preferences
  if (isFull || focuses.includes('preferences')) {
    const portion = s.portion_calibration as Record<string, unknown> | null;
    if (portion && Object.keys(portion).length > 0) {
      // Split confirmed (3+ user corrections) from tentative estimates
      const confirmed: string[] = [];
      const tentative: string[] = [];
      for (const [food, raw] of Object.entries(portion)) {
        let grams: number;
        let isConfirmed = false;
        if (typeof raw === 'number') {
          grams = raw;
        } else if (raw && typeof raw === 'object') {
          const r = raw as { grams?: number; confirmed?: boolean; count?: number };
          grams = r.grams ?? 0;
          isConfirmed = r.confirmed === true || (r.count ?? 0) >= 3;
        } else {
          continue;
        }
        const label = `${food}=${grams}g`;
        if (isConfirmed) confirmed.push(label); else tentative.push(label);
      }
      const lines: string[] = [];
      if (confirmed.length > 0) {
        lines.push(`## PORSIYON HAFIZASI (KESIN — user 3+ kez onayladi, MUTLAKA kullan)\n${confirmed.join(', ')}`);
      }
      if (tentative.length > 0) {
        lines.push(`## PORSIYON HAFIZASI (tahmini)\n${tentative.join(', ')}`);
      }
      if (lines.length > 0) parts.push(lines.join('\n\n'));
    }
    if (s.coaching_notes) parts.push(`## KOCLUK NOTLARI\n${s.coaching_notes}`);
    if (s.alcohol_pattern) {
      // A legacy writer may have serialized {pattern,frequency,impact} as JSON into
      // this TEXT column — parse it back to a readable line instead of dumping raw
      // JSON into the prompt (#R2-13), matching memory.ts.
      const raw = (s.alcohol_pattern as string).trim();
      let line = s.alcohol_pattern as string;
      if (raw.startsWith('{')) {
        try {
          const p = JSON.parse(raw) as { pattern?: string; frequency?: string; impact?: string };
          if (p && (p.pattern || p.frequency || p.impact)) {
            line = [p.pattern, p.frequency && `Siklik: ${p.frequency}`, p.impact && `Etki: ${p.impact}`].filter(Boolean).join(' | ');
          }
        } catch { /* not JSON, use raw */ }
      }
      parts.push(`Alkol kalibi: ${line}`);
    }
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
    const habits = s.habit_progress as { habit?: string; name?: string; key?: string; status: string; streak: number }[] | null;
    if (habits && habits.length > 0) {
      // FIX (adversarial): this printed the STORED monotonic streak — which habits.ts documents as a
      // lie (it survived multi-week absences) — while the derived "## ALISKANLIK DURUMU" block in the
      // SAME system prompt showed the real one, so the coach congratulated a dead streak at random.
      // Names + status only here; the derived block owns every number.
      parts.push(`## ALISKANLIKLAR\n${habits.map(h => `- ${h.habit ?? h.name ?? h.key}: ${h.status}`).join('\n')}`);
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

async function buildLayer3Scoped(userId: string, plan: RetrievalPlan, effectiveToday?: string): Promise<string> {
  const { daysBack, scope, detailLevel } = plan.layer3;

  if (daysBack === 0 || scope.length === 0) return '';

  // FIX (audit AI-CTX-01): anchor the reference day on the user's day-boundary-aware
  // effective day, NOT raw server UTC. The write-side keys logged_for_date / daily_metrics.date
  // to this same effective day; using UTC here made a freshly-logged meal (effective = UTC-yesterday
  // for late-night / negative-offset users) fall outside the read filters, so the coach claimed
  // nothing was logged today. Prefer the caller-supplied value; else derive it from the profile.
  let today = effectiveToday;
  if (!today) {
    const { data: p } = await supabaseAdmin
      .from('profiles')
      .select('active_timezone, home_timezone, day_boundary_hour')
      .eq('id', userId)
      .maybeSingle();
    const tz = (p?.active_timezone as string | null) || (p?.home_timezone as string | null) || null;
    today = getEffectiveDateForUser(tz, p?.day_boundary_hour as number | null);
  }
  // daysBack counts from "today" inclusive (today + the prior daysBack-1 days).
  const startDate = shiftDateString(today, -(daysBack - 1));

  // FIX (audit AI-CTX-03): cap meals/workouts to what formatLayer3 actually renders
  // (today + dün + günler 2-7 = 8 distinct days). Full-detail plans (daysBack=14) used to
  // fetch every meal in the window, then formatLayer3 silently discarded day 8+. Bound the
  // rows so we don't fetch-and-drop. ~12 meals/day * 8 days ≈ 96; round to a safe ceiling.
  const renderedDays = Math.min(daysBack, 8);
  const MEALS_LIMIT = renderedDays * 12;
  const WORKOUTS_LIMIT = renderedDays * 4;

  // Parallel fetch only what's needed
  const queries: Record<string, PromiseLike<{ data: unknown[] | null }>> = {};

  if (scope.includes('meals')) {
    // Order DESC so .limit() keeps the most-recent rows (today/dün) when the cap bites;
    // formatLayer3 re-groups by date so intra-day join order is cosmetic.
    queries.meals = supabaseAdmin.from('meal_logs')
      .select('raw_input, meal_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', startDate).eq('is_deleted', false)
      .order('logged_at', { ascending: false }).limit(MEALS_LIMIT);
  }
  if (scope.includes('workouts')) {
    queries.workouts = supabaseAdmin.from('workout_logs')
      .select('raw_input, duration_min, workout_type, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', startDate)
      .order('logged_at', { ascending: false }).limit(WORKOUTS_LIMIT);
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
    // F3/C2 (+ALGI-08): 'followed_up' means "the cron ASKED", not "it is over" — filtering it out
    // made every commitment the morning nudge touched vanish from the coach's sight before the
    // user ever answered. Open = not yet RESOLVED; the outcome column is what closes it now.
    queries.commitments = supabaseAdmin.from('user_commitments')
      .select('id, commitment, follow_up_at, status')
      .eq('user_id', userId).in('status', ['pending', 'followed_up']).is('resolved_at', null)
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
  // FIX (audit AI-CTX-01): effective-day arithmetic anchored on `today` (which is now the
  // user's day-boundary-aware effective day), not raw server UTC.
  const yesterday = shiftDateString(today, -1);
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
      // Show per-day summaries for days 2-7 — WITH meal names. Count-only
      // lines ("06-08: 1 ogun") made the model answer "hangi yemekleri
      // kaydettim?" with "kayıt yapmamışsın" even though records existed.
      for (let d = 2; d < Math.min(daysBack, 8); d++) {
        const date = shiftDateString(today, -d); // FIX (audit AI-CTX-01): effective-day anchored
        const dayMeals = meals.filter(m => m.logged_for_date === date);
        const dayWorkouts = workouts.filter(w => w.logged_for_date === date);
        const dayReport = reports.find(r => r.date === date);

        if (dayMeals.length > 0 || dayWorkouts.length > 0 || dayReport) {
          const mealNames = dayMeals.map(m => (m.raw_input ?? '').slice(0, 40)).filter(Boolean).join('; ');
          const lineParts = [`${date.slice(5)}: ${dayMeals.length} ogun${mealNames ? ` (${mealNames})` : ''}`];
          if (dayWorkouts.length > 0) lineParts.push(`${dayWorkouts.length} antrenman`);
          if (dayReport) lineParts.push(`uyum: ${dayReport.compliance_score}/100${dayReport.deviation_reason ? ` (${dayReport.deviation_reason})` : ''}`);
          parts.push(lineParts.join(' | '));
        }
      }
      parts.push('NOT: "N ogun" satiri o gun gercekten kayit OLDUGU anlamina gelir — "kayit yok" deme.');

      // Days 8+ — weekly reference only
      if (daysBack > 7 && reports.length > 0) {
        // FIX (audit AI-CTX-01): bucket by effective-day distance from `today`, not server UTC.
        const todayMs = new Date(`${today}T00:00:00Z`).getTime();
        const olderReports = reports.filter(r => {
          const dayDiff = Math.floor((todayMs - new Date(`${r.date}T00:00:00Z`).getTime()) / 86400000);
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

    // AI-behaviour #7: the app already writes "yarin icin tek en etkili aksiyon" into
    // daily_reports.tomorrow_action every night, SELECTs it into Layer 3 and then never renders it —
    // so the coach was blind to its own prescription the next morning and could never close the loop.
    // Surface the most recent real one at ANY detail level.
    const lastAction = [...reports].reverse().find(r => typeof r.tomorrow_action === 'string' && r.tomorrow_action.trim() && r.tomorrow_action.trim() !== '-');
    if (lastAction) {
      parts.push(`\n## DUNKU AKSIYON (senin verdigin tek adim — bugun BUNU sor/takip et, yenisini vermeden once)\n${lastAction.date.slice(5)}: ${lastAction.tomorrow_action.trim()}`);
    }
  }

  // Weight trend
  const weights = metrics.filter(m => m.weight_kg).map(m => `${m.date.slice(5)}: ${m.weight_kg}kg`);
  if (weights.length > 1) {
    parts.push(`\nKilo trendi: ${weights.join(', ')}`);
  }

  // Lab values → dietary impact
  if (labAlerts.length > 0) {
    const labLines = labAlerts.map((l: { parameter_name: string; value: number; unit: string }) => {
      const name = l.parameter_name?.toLowerCase() ?? '';
      let impact = '';
      if (name.includes('kolesterol') || name.includes('cholesterol') || name.includes('ldl')) impact = ' → Doymus yag azalt, lif artir';
      else if (name.includes('glukoz') || name.includes('glucose') || name.includes('seker') || name.includes('hba1c')) impact = ' → Karbonhidrat zamanlamasini ayarla, dusuk GI yiyecekler';
      else if (name.includes('demir') || name.includes('iron') || name.includes('ferritin')) impact = ' → Demir zengin yiyecekler ogle yemegine, C vitamini ile birlikte';
      else if (name.includes('d vitamini') || name.includes('vitamin d') || name.includes('25-oh')) impact = ' → D vitamini takviyesi oner';
      else if (name.includes('b12')) impact = ' → B12 kaynaklari: et, yumurta, sut urunleri vurgula';
      else if (name.includes('trigliserit') || name.includes('triglyceride')) impact = ' → Basit seker ve alkol azalt';
      else if (name.includes('hemoglobin') || name.includes('hgb')) impact = ' → Demir + C vitamini kombinasyonu';
      else if (name.includes('tsh') || name.includes('tiroid') || name.includes('thyroid')) impact = ' → Iyot kaynaklari, selenyum';
      return `- ${l.parameter_name}: ${l.value} ${l.unit}${impact}`;
    });
    parts.push(`\n## KAN TAHLILI → DIYET ETKISI\n${labLines.join('\n')}`);
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

// Rough token budget for Layer 4 history. Leaves headroom for the rest of the
// system prompt (layers 1-3 + mode instructions + user message + response).
// Assumes a 128k context model with ~8k reserved for history; conservative.
// Tek baglam omurgasi (retrieval-planner CONVERSATIONAL_FLOOR): her tur en az son 30
// mesaji gorur. 6000 token o tabanin ~yarisinda kesiyordu — planner 30 mesaj istese bile
// bütçe 12-15'te kırpıyor, yani "kulaktan kulakga" etkisi burada geri geliyordu.
// 24k, 128k+ pencereli modellerde statik katmanlarla birlikte rahat sigar.
const LAYER4_TOKEN_BUDGET = 24000;
const CHARS_PER_TOKEN = 3.5;

// FIX (audit AI-CTX-03): ceiling for the static layers (1+2+3). gpt-4o has a 128k
// window so this almost never bites; it bounds cost/latency on pathological histories.
// Generous relative to LAYER4_TOKEN_BUDGET so normal turns are untouched.
const STATIC_LAYERS_TOKEN_BUDGET = 20000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * FIX (audit AI-CTX-03): total-budget guard for Layers 1-3. Only Layer 4 was trimmed
 * before. When layer1+layer2+layer3 blow past STATIC_LAYERS_TOKEN_BUDGET, drop the
 * OLDEST Layer-3 content first by truncating at the "## DUN"/older-days boundary —
 * the BUGUN block (today's data, the write-side-relevant rows) is always preserved.
 */
function trimLayer3ToBudget(layer1: string, layer2: string, layer3: string): string {
  const total = estimateTokens(layer1) + estimateTokens(layer2) + estimateTokens(layer3);
  if (total <= STATIC_LAYERS_TOKEN_BUDGET) return layer3;

  // formatLayer3 always emits the "## BUGUN" block first, then prefixes every older
  // section ("## DUN", per-day lines, trends, labs, commitments) with a leading "\n".
  // Cut at the first such boundary after BUGUN to keep today intact, drop the rest.
  const dunIdx = layer3.indexOf('\n## DUN');
  const cutIdx = dunIdx >= 0 ? dunIdx : layer3.indexOf('\n\n');
  if (cutIdx <= 0) return layer3; // nothing safe to drop (only BUGUN present)

  return `${layer3.slice(0, cutIdx)}\n[Eski gun detaylari baglam butcesi icin kirpildi.]`;
}

async function buildLayer4Scoped(userId: string, plan: RetrievalPlan, sessionId?: string): Promise<{ role: string; content: string }[]> {
  const limit = plan.layer4MaxMessages;
  if (limit === 0) return [];

  let query = supabaseAdmin
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (sessionId) {
    query = query.eq('session_id', sessionId);
  }

  const { data } = await query;

  if (!data || data.length === 0) return [];

  // Drop messages from newest-first so the most recent turns survive when the
  // session is long. Without this, long sessions overflow the model's context
  // window and the API returns 400. Messages trimmed here still live in the
  // database; Layer 2 (ai_summary) preserves anything durable about the user.
  const newestFirst = data as { role: string; content: string }[];
  const kept: { role: string; content: string }[] = [];
  let usedTokens = 0;
  for (const msg of newestFirst) {
    const cost = estimateTokens(msg.content ?? '');
    if (usedTokens + cost > LAYER4_TOKEN_BUDGET && kept.length > 0) break;
    kept.push(msg);
    usedTokens += cost;
  }

  const trimmed = kept.length < newestFirst.length;
  const ordered = kept.reverse();
  if (trimmed) {
    ordered.unshift({
      role: 'system',
      content: `[Bu oturumun onceki ${newestFirst.length - kept.length} mesaji baglam butcesi icin kirpildi. Uzun vadeli bilgiler Katman 2 ozetinde tutuluyor.]`,
    });
  }
  return ordered;
}

// ─── Context Meta Refinement ───

function refineContextMeta(initial: ContextMeta, layer1: string, layer3: string): ContextMeta {
  const meta = { ...initial };

  // Check data completeness
  const missing: string[] = [];
  if (layer1.includes('Profil henuz')) missing.push('profile');
  if (layer3.includes('KAYIT YOK')) missing.push('today_meals');

  // Count days with data (rough estimate from layer3 content)
  const dateMatches = layer3.match(/\d{2}-\d{2}/g);
  meta.daysWithCompleteData = dateMatches ? new Set(dateMatches).size : 0;

  // D5 (plan v2, DÜRÜSTLÜK-04): confidence from EVIDENCE, not from layer3 char LENGTH.
  // The old proxy called any 200+ char blob 'high' — a profile full of '?' placeholders plus one
  // logged meal cleared the bar, and the coach spoke with full certainty over unknowns.
  // Real signals instead:
  //   · distinct DAYS actually present in layer3 (dates render as MM-DD),
  //   · unknown profile fields — layer1 renders every missing value as a literal '?' in value
  //     position (': ?', '?-?' bands, '(?g)'), never in prose, so counting those IS the field count.
  const unknownFields = (layer1.match(/: \?|-\?|\(\?/g) ?? []).length;
  if (unknownFields >= 3 && !missing.includes('profile')) missing.push('profile_fields');
  meta.missingDataTypes = missing;

  if (missing.length === 0 && meta.daysWithCompleteData >= 3) {
    meta.confidenceLevel = 'high';
  } else if (missing.length > 1 || meta.daysWithCompleteData === 0 || unknownFields >= 5) {
    meta.confidenceLevel = 'low';
  } else {
    meta.confidenceLevel = 'medium';
  }

  return meta;
}
