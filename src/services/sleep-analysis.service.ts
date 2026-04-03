/**
 * Sleep Analysis Service
 * Spec 2.1: Uyku takibi — kalite, borç, toparlanma indeksi
 *
 * Uyku saatleri + kalite + antrenman yoğunluğu → toparlanma indeksi
 * Kümülatif uyku borcu hesaplama
 * Antrenman yoğunluğu entegrasyonu
 */
import { supabase } from '@/lib/supabase';

// ─── Types ───

export interface SleepRecoveryIndex {
  index: number; // 0-1 scale
  label: 'excellent' | 'good' | 'fair' | 'poor';
  sleepHours: number;
  sleepQuality: string | null;
  trainingIntensity: number; // 0-1 normalized
  message: string;
}

export interface SleepDebt {
  totalDebtHours: number; // rolling 7-day deficit
  avgSleepHours: number;
  targetHours: number;
  isInDebt: boolean;
  message: string;
}

export interface SleepTrainingCorrelation {
  goodSleepPerformance: number | null; // avg compliance after good sleep
  badSleepPerformance: number | null; // avg compliance after bad sleep
  insight: string | null;
}

// ─── Sleep Recovery Index ───

const QUALITY_SCORES: Record<string, number> = {
  good: 1.0,
  ok: 0.6,
  bad: 0.3,
};

/**
 * Calculate Sleep Recovery Index.
 * Formula: (sleepHours/8)*0.6 + qualityScore*0.25 + (1-trainingIntensity)*0.15
 */
export function calculateSleepRecoveryIndex(
  sleepHours: number | null,
  sleepQuality: string | null,
  yesterdayTrainingIntensity: number // 0-1 scale (0=rest, 0.5=moderate, 1=high)
): SleepRecoveryIndex {
  const hours = sleepHours ?? 7;
  const quality = sleepQuality ? (QUALITY_SCORES[sleepQuality] ?? 0.6) : 0.6;
  const trainingFactor = Math.min(1, Math.max(0, yesterdayTrainingIntensity));

  const index = Math.min(1, Math.max(0,
    (hours / 8) * 0.6 +
    quality * 0.25 +
    (1 - trainingFactor) * 0.15
  ));

  let label: SleepRecoveryIndex['label'];
  let message: string;

  if (index >= 0.85) {
    label = 'excellent';
    message = 'Toparlanma mukemmel. Yogun antrenman icin hazirsin.';
  } else if (index >= 0.65) {
    label = 'good';
    message = 'Toparlanma iyi. Normal antrenman planina devam.';
  } else if (index >= 0.45) {
    label = 'fair';
    message = 'Toparlanma orta. Orta yogunlukta antrenman onerilir.';
  } else {
    label = 'poor';
    message = 'Toparlanma dusuk. Hafif aktivite veya dinlenme onerilir.';
  }

  return {
    index: Math.round(index * 100) / 100,
    label,
    sleepHours: hours,
    sleepQuality,
    trainingIntensity: trainingFactor,
    message,
  };
}

// ─── Sleep Debt ───

/**
 * Track cumulative sleep debt over rolling 7-day window.
 * Target: 7-8 hours/night.
 */
export async function trackSleepDebt(userId: string, targetHours = 7.5): Promise<SleepDebt> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_metrics')
    .select('sleep_hours')
    .eq('user_id', userId)
    .gte('date', sevenDaysAgo)
    .not('sleep_hours', 'is', null)
    .order('date');

  const sleepData = (data ?? []) as { sleep_hours: number }[];

  if (sleepData.length === 0) {
    return {
      totalDebtHours: 0,
      avgSleepHours: 0,
      targetHours,
      isInDebt: false,
      message: 'Uyku verisi yok.',
    };
  }

  const totalSleep = sleepData.reduce((s, d) => s + d.sleep_hours, 0);
  const avgSleep = totalSleep / sleepData.length;
  const totalDebt = Math.max(0, (targetHours * sleepData.length) - totalSleep);
  const isInDebt = totalDebt > 3; // 3+ hours debt is significant

  let message: string;
  if (totalDebt <= 1) {
    message = 'Uyku borcun yok, harika!';
  } else if (totalDebt <= 3) {
    message = `${totalDebt.toFixed(1)} saat uyku borcun var. Bu hafta erken yatmaya calis.`;
  } else if (totalDebt <= 7) {
    message = `${totalDebt.toFixed(1)} saat uyku borcun birikti. Yogun antrenman onerilmez.`;
  } else {
    message = `${totalDebt.toFixed(1)} saat ciddi uyku borcu. Oncelik uyku olmali.`;
  }

  return {
    totalDebtHours: Math.round(totalDebt * 10) / 10,
    avgSleepHours: Math.round(avgSleep * 10) / 10,
    targetHours,
    isInDebt,
    message,
  };
}

// ─── Sleep-Training Correlation ───

/**
 * Analyze correlation between sleep quality and next-day compliance.
 */
export async function getSleepTrainingCorrelation(userId: string): Promise<SleepTrainingCorrelation> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const { data: metrics } = await supabase
    .from('daily_metrics')
    .select('date, sleep_quality')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo)
    .not('sleep_quality', 'is', null);

  const { data: reports } = await supabase
    .from('daily_reports')
    .select('date, compliance_score')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo);

  if (!metrics || !reports || metrics.length < 7 || reports.length < 7) {
    return { goodSleepPerformance: null, badSleepPerformance: null, insight: null };
  }

  const reportMap = new Map((reports as { date: string; compliance_score: number }[]).map(r => [r.date, r.compliance_score]));

  let goodSleepScores: number[] = [];
  let badSleepScores: number[] = [];

  for (const m of metrics as { date: string; sleep_quality: string }[]) {
    // Get next day's compliance
    const nextDay = new Date(new Date(m.date).getTime() + 86400000).toISOString().split('T')[0];
    const nextScore = reportMap.get(nextDay);
    if (nextScore === undefined) continue;

    if (m.sleep_quality === 'good') goodSleepScores.push(nextScore);
    else if (m.sleep_quality === 'bad') badSleepScores.push(nextScore);
  }

  const goodAvg = goodSleepScores.length > 0
    ? Math.round(goodSleepScores.reduce((s, v) => s + v, 0) / goodSleepScores.length)
    : null;
  const badAvg = badSleepScores.length > 0
    ? Math.round(badSleepScores.reduce((s, v) => s + v, 0) / badSleepScores.length)
    : null;

  let insight: string | null = null;
  if (goodAvg !== null && badAvg !== null && goodAvg - badAvg > 10) {
    insight = `Iyi uyudugunda ertesi gun uyumun %${goodAvg}, kotu uyudugunda %${badAvg}. Uyku kaliten performansini dogrudan etkiliyor.`;
  }

  return { goodSleepPerformance: goodAvg, badSleepPerformance: badAvg, insight };
}

/**
 * Should training intensity be reduced based on sleep?
 */
export function shouldReduceTraining(
  sleepHours: number | null,
  sleepQuality: string | null,
  sleepDebt: SleepDebt
): { reduce: boolean; maxIntensity: 'high' | 'moderate' | 'low'; reason: string | null } {
  const hours = sleepHours ?? 7;

  if (hours < 5 || sleepDebt.totalDebtHours > 7) {
    return { reduce: true, maxIntensity: 'low', reason: 'Ciddi uyku borcu — sadece hafif aktivite.' };
  }

  if (hours < 6 || sleepQuality === 'bad') {
    return { reduce: true, maxIntensity: 'moderate', reason: 'Uyku eksikligi — yogun antrenman onerilmez.' };
  }

  if (sleepDebt.totalDebtHours > 4) {
    return { reduce: true, maxIntensity: 'moderate', reason: 'Birikimli uyku borcu — orta yogunluk onerilir.' };
  }

  return { reduce: false, maxIntensity: 'high', reason: null };
}
