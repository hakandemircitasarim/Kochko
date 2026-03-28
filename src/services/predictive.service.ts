/**
 * Predictive Analytics Service
 * Spec 5.14: Hafta sonu sapma tahmini, atıştırma saati, dönemsel risk
 */
import { supabase } from '@/lib/supabase';

export interface PredictiveAlert {
  type: 'weekend_risk' | 'snack_time' | 'motivation_drop' | 'alcohol_risk';
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
