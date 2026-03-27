/**
 * Builds rich context for the AI coach from all available data sources.
 * This is what makes Kochko different - deep, persistent knowledge.
 */

import { supabaseAdmin } from '../shared/supabase-admin.ts';

export interface CoachContext {
  contextBlock: string;
  profile: Record<string, unknown> | null;
  insights: { category: string; insight: string }[];
  recentChat: { role: string; content: string }[];
  commitments: { commitment: string; follow_up_at: string; status: string }[];
  patterns: { pattern_type: string; description: string; intervention: string }[];
}

export async function buildContext(userId: string): Promise<CoachContext> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const hour = now.getHours();
  const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });

  // Parallel data fetch
  const [
    profileRes, insightsRes, chatRes, mealsRes, workoutsRes,
    metricsRes, goalRes, prefsRes, commitmentsRes, patternsRes,
    labRes, reportsRes, weekMetricsRes,
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
    supabaseAdmin.from('user_insights').select('category, insight')
      .eq('user_id', userId).eq('active', true)
      .order('updated_at', { ascending: false }).limit(40),
    supabaseAdmin.from('chat_messages').select('role, content')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
    supabaseAdmin.from('meal_logs').select('raw_input, meal_type, logged_at')
      .eq('user_id', userId).gte('logged_at', `${today}T00:00:00`).order('logged_at'),
    supabaseAdmin.from('workout_logs').select('raw_input, duration_min, logged_at')
      .eq('user_id', userId).gte('logged_at', `${today}T00:00:00`),
    supabaseAdmin.from('daily_metrics').select('*')
      .eq('user_id', userId).eq('date', today).single(),
    supabaseAdmin.from('goals').select('*')
      .eq('user_id', userId).eq('is_active', true).single(),
    supabaseAdmin.from('food_preferences').select('food_name, preference')
      .eq('user_id', userId),
    supabaseAdmin.from('user_commitments').select('commitment, follow_up_at, status')
      .eq('user_id', userId).eq('status', 'pending').order('follow_up_at').limit(5),
    supabaseAdmin.from('user_patterns').select('pattern_type, description, trigger_context, intervention')
      .eq('user_id', userId).eq('active', true).limit(10),
    supabaseAdmin.from('lab_values').select('parameter_name, value, unit, reference_min, reference_max, measured_at')
      .eq('user_id', userId).order('measured_at', { ascending: false }).limit(10),
    supabaseAdmin.from('daily_reports').select('date, compliance_score, deviation_reason')
      .eq('user_id', userId).order('date', { ascending: false }).limit(7),
    supabaseAdmin.from('daily_metrics').select('date, weight_kg, sleep_hours, water_liters, steps')
      .eq('user_id', userId).order('date', { ascending: false }).limit(14),
  ]);

  const profile = profileRes.data;
  const insights = (insightsRes.data ?? []) as { category: string; insight: string }[];
  const recentChat = ((chatRes.data ?? []) as { role: string; content: string }[]).reverse();
  const todayMeals = mealsRes.data ?? [];
  const todayWorkouts = workoutsRes.data ?? [];
  const todayMetrics = metricsRes.data;
  const goal = goalRes.data;
  const prefs = (prefsRes.data ?? []) as { food_name: string; preference: string }[];
  const commitments = (commitmentsRes.data ?? []) as { commitment: string; follow_up_at: string; status: string }[];
  const patterns = (patternsRes.data ?? []) as { pattern_type: string; description: string; trigger_context: string; intervention: string }[];
  const labValues = labRes.data ?? [];
  const recentReports = (reportsRes.data ?? []) as { date: string; compliance_score: number; deviation_reason: string | null }[];
  const recentMetrics = (weekMetricsRes.data ?? []) as { date: string; weight_kg: number | null; sleep_hours: number | null; water_liters: number; steps: number | null }[];

  // Calculations
  const age = profile?.birth_year ? now.getFullYear() - profile.birth_year : null;
  const neverFoods = prefs.filter(p => p.preference === 'never' || p.preference === 'dislike').map(p => p.food_name);
  const lovedFoods = prefs.filter(p => p.preference === 'love' || p.preference === 'like').map(p => p.food_name);

  // Group insights
  const insightsByCategory = insights.reduce<Record<string, string[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i.insight);
    return acc;
  }, {});

  // Weight trend
  const weights = recentMetrics.filter(m => m.weight_kg).map(m => ({ date: m.date, kg: m.weight_kg }));
  const currentWeight = weights.length > 0 ? weights[0]?.kg : profile?.weight_kg;

  // Recent compliance
  const avgCompliance = recentReports.length > 0
    ? Math.round(recentReports.reduce((s, r) => s + r.compliance_score, 0) / recentReports.length)
    : null;
  const recentDeviations = recentReports.filter(r => r.deviation_reason && r.deviation_reason !== 'yok').map(r => r.deviation_reason);

  // Lab alerts
  const labAlerts = (labValues as { parameter_name: string; value: number; unit: string; reference_min: number | null; reference_max: number | null }[])
    .filter(l => (l.reference_min !== null && l.value < l.reference_min) || (l.reference_max !== null && l.value > l.reference_max))
    .map(l => `${l.parameter_name}: ${l.value} ${l.unit} (ref: ${l.reference_min}-${l.reference_max})`);

  // Due commitments
  const dueCommitments = commitments.filter(c => c.follow_up_at && new Date(c.follow_up_at) <= now);

  // Onboarding mode detection
  const isOnboarding = profile && !profile.onboarding_completed;
  const missingFields: string[] = [];
  if (!profile?.height_cm) missingFields.push('boy');
  if (!profile?.weight_kg) missingFields.push('kilo');
  if (!profile?.birth_year) missingFields.push('yas/dogum yili');
  if (!profile?.gender) missingFields.push('cinsiyet');
  if (!goal) missingFields.push('hedef');

  // Build the context block
  const contextBlock = `
## ZAMAN
Simdi: ${dayName}, saat ${hour}:${now.getMinutes().toString().padStart(2, '0')}
Tarih: ${today}

${isOnboarding ? `## ONBOARDING MODU AKTIF
Kullanici YENI. Sohbet ile tani. Form doldurtma - sohbet et, soru sor, bilgi topla.
Eksik bilgiler: ${missingFields.join(', ') || 'temel bilgiler tamam'}
Her mesajda 1-2 soru sor, bombardiman yapma. Dogal bir sohbet akisi icinde bilgi topla.
Yeterli bilgi toplayinca (boy, kilo, yas, hedef) onboarding tamamlanmis sayilir.
Kullaniciyi tanidiktan sonra ilk plani olusturabilirsin.` : ''}

## KULLANICI PROFILI
${profile ? `Cinsiyet: ${profile.gender ?? '?'} | Yas: ${age ?? '?'} | Boy: ${profile.height_cm ?? '?'}cm | Kilo: ${currentWeight ?? '?'}kg` : 'Profil henuz olusturulmamis - sohbet ile tani!'}
${goal ? `Hedef: ${goal.target_weight_kg}kg | Oncelik: ${goal.priority} | Kalori: ${goal.daily_calorie_min}-${goal.daily_calorie_max} kcal | Protein: ${goal.daily_protein_min}g+` : 'Hedef: belirlenmemis'}

## SENI HAKKINDA BILDIGIN HER SEY
${Object.entries(insightsByCategory).map(([cat, items]) => `[${cat}]\n${items.map(i => `- ${i}`).join('\n')}`).join('\n\n') || 'Henuz fazla bilgi yok - sohbet ederek ogren!'}

## ASLA ONERME
${neverFoods.length > 0 ? neverFoods.join(', ') : 'Henuz belirtilmemis'}
${lovedFoods.length > 0 ? `Sevdikleri: ${lovedFoods.join(', ')}` : ''}

## BUGUNUN DURUMU
Ogunler: ${todayMeals.length > 0 ? todayMeals.map((m: { meal_type: string; raw_input: string }) => `[${m.meal_type}] ${m.raw_input}`).join(' | ') : 'HENUZ KAYIT YOK'}
Antrenman: ${todayWorkouts.length > 0 ? todayWorkouts.map((w: { raw_input: string; duration_min: number }) => `${w.raw_input} (${w.duration_min}dk)`).join(', ') : 'yok'}
Su: ${todayMetrics?.water_liters ?? 0}L | Tarti: ${todayMetrics?.weight_kg ? `${todayMetrics.weight_kg}kg` : '-'} | Uyku: ${todayMetrics?.sleep_hours ? `${todayMetrics.sleep_hours}sa` : '-'}

## SON 7 GUN
${recentReports.length > 0 ? `Ort. uyum: ${avgCompliance}/100 | Sapmalar: ${recentDeviations.join(', ') || 'yok'}` : 'Rapor yok'}
${weights.length > 1 ? `Kilo trendi: ${weights.map(w => `${w.date?.slice(5)}: ${w.kg}kg`).join(', ')}` : ''}

${labAlerts.length > 0 ? `## LAB UYARILARI (referans disi)\n${labAlerts.join('\n')}` : ''}

## TESPIT EDILEN KALIPLAR
${patterns.length > 0 ? patterns.map(p => `- [${p.pattern_type}] ${p.description} | Mudahale: ${p.intervention}`).join('\n') : 'Henuz kalip tespit edilmemis'}

## TAKIP EDILECEK TAAHHUTLER
${dueCommitments.length > 0 ? dueCommitments.map(c => `- TAKIP ET: "${c.commitment}"`).join('\n') : ''}
${commitments.filter(c => !dueCommitments.includes(c)).length > 0 ? commitments.filter(c => !dueCommitments.includes(c)).map(c => `- Bekleyen: "${c.commitment}" (${c.follow_up_at?.slice(0, 10)})`).join('\n') : ''}
`.trim();

  return {
    contextBlock,
    profile,
    insights,
    recentChat,
    commitments,
    patterns,
  };
}
