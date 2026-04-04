/**
 * Predictive Analytics Service
 * Spec 5.14: Hafta sonu sapma tahmini, atıştırma saati, dönemsel risk
 */
import { supabase } from '@/lib/supabase';

export interface PredictiveAlert {
  type: 'weekend_risk' | 'snack_time' | 'motivation_drop' | 'alcohol_risk' | 'calorie_creep' | 'sleep_debt' | 'injury_risk' | 'compliance_fatigue';
  message: string;
  confidence: number;
  actionSuggestion: string;
}

/**
 * Analyze last 4+ weeks of data for predictive alerts.
 * Called on Thursday/Friday to warn about weekend patterns (Spec 5.14).
 */
export async function getWeekendRiskPrediction(userId: string): Promise<PredictiveAlert | null> {
  // Get last 4 weeks of daily reports
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('date, compliance_score, deviation_reason')
    .eq('user_id', userId)
    .gte('date', fourWeeksAgo)
    .order('date');

  if (!reports || reports.length < 14) return null; // Need 2+ weeks of data

  // Separate weekdays vs weekends
  const weekdayScores: number[] = [];
  const weekendScores: number[] = [];

  for (const r of reports as { date: string; compliance_score: number }[]) {
    const day = new Date(r.date).getDay();
    if (day === 0 || day === 6) {
      weekendScores.push(r.compliance_score);
    } else {
      weekdayScores.push(r.compliance_score);
    }
  }

  if (weekendScores.length < 4 || weekdayScores.length < 8) return null;

  const avgWeekday = weekdayScores.reduce((s, v) => s + v, 0) / weekdayScores.length;
  const avgWeekend = weekendScores.reduce((s, v) => s + v, 0) / weekendScores.length;
  const diff = avgWeekday - avgWeekend;

  // If weekend compliance is 15+ points lower than weekday → risk
  if (diff >= 15) {
    return {
      type: 'weekend_risk',
      message: `Son 4 haftada hafta sonu uyum puanin ortalama ${Math.round(diff)} puan dusuk. Hafta sonu icin plan yapalim mi?`,
      confidence: Math.min(0.95, diff / 30),
      actionSuggestion: 'Cuma gunu kocunla hafta sonu stratejisi konusun.',
    };
  }

  return null;
}

/**
 * Detect common snack times from meal log data.
 * Used for proactive "risk window" warnings (Spec 5.14).
 */
export async function detectSnackPatterns(userId: string): Promise<{
  riskHours: number[];
  message: string;
} | null> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const { data: snacks } = await supabase
    .from('meal_logs')
    .select('logged_at')
    .eq('user_id', userId)
    .eq('meal_type', 'snack')
    .eq('is_deleted', false)
    .gte('logged_for_date', twoWeeksAgo);

  if (!snacks || snacks.length < 5) return null;

  // Count snacks by hour
  const hourCounts: Record<number, number> = {};
  for (const s of snacks as { logged_at: string }[]) {
    const hour = new Date(s.logged_at).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  // Find peak hours (top 2)
  const sorted = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([h]) => parseInt(h));

  if (sorted.length === 0) return null;

  return {
    riskHours: sorted,
    message: `Atistirma riski en yuksek saatler: ${sorted.map(h => `${h}:00`).join(' ve ')}. Bu saatlerden once protein agirlikli bir sey ye.`,
  };
}

/**
 * Detect motivation drop signals (Spec 5.14).
 * Signals: streak break, reduced logging frequency, lower mood scores.
 */
export async function detectMotivationDrop(userId: string): Promise<PredictiveAlert | null> {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  // Compare last week's log count vs previous week
  const [lastWeek, prevWeek] = await Promise.all([
    supabase.from('meal_logs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('logged_for_date', oneWeekAgo).eq('is_deleted', false),
    supabase.from('meal_logs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('logged_for_date', twoWeeksAgo).lt('logged_for_date', oneWeekAgo).eq('is_deleted', false),
  ]);

  const lastCount = lastWeek.count ?? 0;
  const prevCount = prevWeek.count ?? 0;

  // If logging dropped by 40%+
  if (prevCount > 5 && lastCount < prevCount * 0.6) {
    return {
      type: 'motivation_drop',
      message: `Gecen hafta ${prevCount} kayit girdin, bu hafta sadece ${lastCount}. Motivasyonun dusuyor olabilir.`,
      confidence: 0.7,
      actionSuggestion: 'Kocunla konusarak yeniden basla. Kucuk hedeflerle ilerle.',
    };
  }

  return null;
}

/**
 * Detect alcohol-related deviation patterns (Spec 5.14).
 * If user tends to overeat after drinking on Fridays, warn on Friday.
 */
export async function detectAlcoholRisk(userId: string): Promise<PredictiveAlert | null> {
  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('date, deviation_reason, compliance_score')
    .eq('user_id', userId)
    .gte('date', fourWeeksAgo);

  if (!reports || reports.length < 10) return null;

  let alcoholDeviations = 0;
  let weekendDays = 0;

  for (const r of reports as { date: string; deviation_reason: string | null; compliance_score: number }[]) {
    const day = new Date(r.date).getDay();
    if (day === 5 || day === 6) {
      weekendDays++;
      if (r.deviation_reason?.includes('alkol') || r.deviation_reason?.includes('alcohol')) {
        alcoholDeviations++;
      }
    }
  }

  if (weekendDays >= 4 && alcoholDeviations >= 2) {
    return {
      type: 'alcohol_risk',
      message: `Son 4 haftada ${alcoholDeviations} hafta sonu alkol kaynakli sapma tespit ettim. Bu hafta sonu icin strateji konusalim mi?`,
      confidence: alcoholDeviations / weekendDays,
      actionSuggestion: 'Cuma gunu once dusuk kalorili gunluk plan hazirla, alkol tamponlu butce olustur.',
    };
  }

  return null;
}

// ─── NEW PREDICTIONS (Deepening Phase 4) ───

export async function detectCalorieCreep(userId: string, weeks: number = 4): Promise<PredictiveAlert | null> {
  const fromDate = new Date(Date.now() - weeks * 7 * 86400000).toISOString().split('T')[0];
  const { data: reports } = await supabase.from('daily_reports').select('date, calorie_actual')
    .eq('user_id', userId).gte('date', fromDate).order('date');
  if (!reports || reports.length < 14) return null;

  const weeklyAvg: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = reports.slice(w * 7, Math.min((w + 1) * 7, reports.length));
    if (slice.length === 0) continue;
    weeklyAvg.push(slice.reduce((s, r) => s + (r.calorie_actual as number), 0) / slice.length);
  }
  if (weeklyAvg.length < 3) return null;

  let consecutiveUp = 0;
  for (let i = 1; i < weeklyAvg.length; i++) {
    if (((weeklyAvg[i] - weeklyAvg[i - 1]) / weeklyAvg[i - 1]) * 100 > 5) consecutiveUp++;
    else consecutiveUp = 0;
  }

  if (consecutiveUp >= 2) {
    return {
      type: 'calorie_creep',
      message: `Son ${consecutiveUp + 1} haftada kalorin kademeli artiyor (${Math.round(weeklyAvg[0])} → ${Math.round(weeklyAvg[weeklyAvg.length - 1])} kcal/gun).`,
      confidence: Math.min(1, consecutiveUp / 3),
      actionSuggestion: 'Porsiyon olcumlerini kontrol et. Hazir gida artmis olabilir.',
    };
  }
  return null;
}

export async function detectSleepDebt(userId: string, days: number = 14): Promise<PredictiveAlert | null> {
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { data: metrics } = await supabase.from('daily_metrics').select('sleep_hours')
    .eq('user_id', userId).gte('date', fromDate).not('sleep_hours', 'is', null);
  if (!metrics || metrics.length < 7) return null;

  const TARGET = 7.5;
  let debt = 0;
  for (const m of metrics as { sleep_hours: number }[]) {
    const deficit = TARGET - m.sleep_hours;
    if (deficit > 0) debt += deficit;
  }

  if (debt > 10) {
    const avg = (metrics.reduce((s, m) => s + (m.sleep_hours as number), 0) / metrics.length).toFixed(1);
    return {
      type: 'sleep_debt',
      message: `Son ${days} gunde ${debt.toFixed(1)}sa uyku borcun var (ort. ${avg}sa/gece).`,
      confidence: Math.min(1, debt / 15),
      actionSuggestion: 'Bu hafta her gece 30dk erken yat. Kafein 14:00 sonrasi sinirla.',
    };
  }
  return null;
}

export async function detectInjuryRisk(userId: string): Promise<PredictiveAlert | null> {
  const fiveWeeksAgo = new Date(Date.now() - 35 * 86400000).toISOString().split('T')[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: workouts } = await supabase.from('workout_logs').select('duration_min, logged_for_date')
    .eq('user_id', userId).gte('logged_for_date', fiveWeeksAgo);
  if (!workouts || workouts.length < 8) return null;

  const thisWeek = (workouts as { duration_min: number; logged_for_date: string }[]).filter(w => w.logged_for_date >= oneWeekAgo);
  const prevWeeks = (workouts as { duration_min: number; logged_for_date: string }[]).filter(w => w.logged_for_date < oneWeekAgo);
  const thisVol = thisWeek.reduce((s, w) => s + w.duration_min, 0);
  const prevAvg = prevWeeks.length > 0 ? prevWeeks.reduce((s, w) => s + w.duration_min, 0) / 4 : 0;

  if (prevAvg > 0 && thisVol > prevAvg * 1.3) {
    const spike = Math.round(((thisVol - prevAvg) / prevAvg) * 100);
    return {
      type: 'injury_risk',
      message: `Bu hafta antrenman hacmin %${spike} artti. Sakatlanma riski yuksek.`,
      confidence: Math.min(1, spike / 50),
      actionSuggestion: 'Yogunlugu kademeli artir (%10/hafta kurali).',
    };
  }
  return null;
}

export async function detectComplianceFatigue(userId: string, weeks: number = 4): Promise<PredictiveAlert | null> {
  const fromDate = new Date(Date.now() - weeks * 7 * 86400000).toISOString().split('T')[0];
  const { data: reports } = await supabase.from('daily_reports').select('date, compliance_score')
    .eq('user_id', userId).gte('date', fromDate).order('date');
  if (!reports || reports.length < 21) return null;

  const weeklyAvg: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const slice = reports.slice(w * 7, Math.min((w + 1) * 7, reports.length));
    if (slice.length < 3) continue;
    weeklyAvg.push(slice.reduce((s, r) => s + (r.compliance_score as number), 0) / slice.length);
  }
  if (weeklyAvg.length < 3) return null;

  let declines = 0;
  for (let i = 1; i < weeklyAvg.length; i++) {
    if (weeklyAvg[i - 1] - weeklyAvg[i] >= 5) declines++;
    else declines = 0;
  }

  if (declines >= 2) {
    return {
      type: 'compliance_fatigue',
      message: `Uyum puanin ${declines + 1} haftadir dusuyor. Tukenme belirtisi olabilir.`,
      confidence: Math.min(1, declines / 4),
      actionSuggestion: 'Hedefleri hafiflet, 1 hafta esnek mod dene.',
    };
  }
  return null;
}

export function getConfidenceLevel(dataPoints: number): 'low' | 'medium' | 'high' {
  if (dataPoints < 7) return 'low';
  if (dataPoints < 14) return 'medium';
  return 'high';
}

export async function getMultiFactorRisk(userId: string): Promise<{
  overallRisk: 'low' | 'medium' | 'high';
  factors: string[];
}> {
  const results = await Promise.all([
    getWeekendRiskPrediction(userId),
    detectMotivationDrop(userId),
    detectAlcoholRisk(userId),
    detectCalorieCreep(userId),
    detectSleepDebt(userId),
    detectInjuryRisk(userId),
    detectComplianceFatigue(userId),
  ]);

  const alerts = results.filter((r): r is PredictiveAlert => r !== null);
  const factors = alerts.map(a => a.type);

  const overallRisk: 'low' | 'medium' | 'high' =
    alerts.length >= 3 || alerts.some(a => a.confidence > 0.8) ? 'high'
    : alerts.length >= 1 ? 'medium' : 'low';

  return { overallRisk, factors };
}
