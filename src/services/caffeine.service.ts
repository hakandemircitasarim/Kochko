/**
 * Caffeine-Sleep Correlation Tracking
 * Spec 5.34 (5.20 in summary): Kafein-uyku korelasyon takibi
 */
import { supabase } from '@/lib/supabase';

// Estimated caffeine content (mg) per common drink
const CAFFEINE_ESTIMATES: Record<string, number> = {
  kahve: 95,
  espresso: 63,
  turk_kahvesi: 50,
  filtre_kahve: 95,
  latte: 75,
  cappuccino: 75,
  americano: 95,
  cay: 40,
  yesil_cay: 30,
  siyah_cay: 50,
  enerji_icecegi: 80,
  red_bull: 80,
  cola: 35,
  monster: 160,
};

/**
 * Estimate caffeine from a meal log entry.
 * AI detects "kahve", "çay", "enerji içeceği" in raw_input.
 */
export function estimateCaffeine(rawInput: string): { totalMg: number; items: { name: string; mg: number }[] } {
  const lower = rawInput.toLocaleLowerCase('tr');
  const items: { name: string; mg: number }[] = [];

  for (const [drink, mg] of Object.entries(CAFFEINE_ESTIMATES)) {
    const normalized = drink.replace(/_/g, ' ');
    // Check for quantity (e.g., "2 kahve", "3 bardak cay")
    const qtyMatch = lower.match(new RegExp(`(\\d+)\\s*(?:bardak|fincan|kupa)?\\s*${normalized}`, 'i'));
    const simpleMatch = lower.includes(normalized);

    if (qtyMatch) {
      const qty = parseInt(qtyMatch[1]);
      items.push({ name: normalized, mg: mg * qty });
    } else if (simpleMatch) {
      items.push({ name: normalized, mg });
    }
  }

  return {
    totalMg: items.reduce((s, i) => s + i.mg, 0),
    items,
  };
}

/**
 * Analyze caffeine-sleep correlation over past 2 weeks.
 * Returns insight if late caffeine correlates with poor sleep.
 */
export async function analyzeCaffeineSleep(userId: string): Promise<{
  hasCorrelation: boolean;
  message: string;
  avgCaffeineLateDays: number;
  avgSleepOnLateCaffeine: number;
  avgSleepNoCaffeine: number;
} | null> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const [mealsRes, metricsRes] = await Promise.all([
    supabase.from('meal_logs').select('raw_input, logged_at, logged_for_date')
      .eq('user_id', userId).gte('logged_for_date', twoWeeksAgo).eq('is_deleted', false),
    supabase.from('daily_metrics').select('date, sleep_hours, sleep_quality')
      .eq('user_id', userId).gte('date', twoWeeksAgo),
  ]);

  const meals = (mealsRes.data ?? []) as { raw_input: string; logged_at: string; logged_for_date: string }[];
  const metrics = (metricsRes.data ?? []) as { date: string; sleep_hours: number | null }[];

  if (meals.length < 10 || metrics.length < 7) return null;

  // Find days with late caffeine (after 15:00)
  const lateCaffeineDates = new Set<string>();
  for (const meal of meals) {
    const hour = new Date(meal.logged_at).getHours();
    const { totalMg } = estimateCaffeine(meal.raw_input);
    if (totalMg > 0 && hour >= 15) {
      lateCaffeineDates.add(meal.logged_for_date);
    }
  }

  // Compare sleep on late-caffeine vs no-caffeine days
  const lateSleep: number[] = [];
  const noLateSleep: number[] = [];

  for (const m of metrics) {
    if (m.sleep_hours === null) continue;
    if (lateCaffeineDates.has(m.date)) {
      lateSleep.push(m.sleep_hours);
    } else {
      noLateSleep.push(m.sleep_hours);
    }
  }

  if (lateSleep.length < 3 || noLateSleep.length < 3) return null;

  const avgLate = lateSleep.reduce((s, v) => s + v, 0) / lateSleep.length;
  const avgNoLate = noLateSleep.reduce((s, v) => s + v, 0) / noLateSleep.length;
  const diff = avgNoLate - avgLate;

  if (diff >= 0.5) {
    return {
      hasCorrelation: true,
      message: `15:00'ten sonra kafein ictigin gunlerde ortalama ${avgLate.toFixed(1)} saat, icmedigin gunlerde ${avgNoLate.toFixed(1)} saat uyuyorsun. Farki: ${diff.toFixed(1)} saat.`,
      avgCaffeineLateDays: lateSleep.length,
      avgSleepOnLateCaffeine: Math.round(avgLate * 10) / 10,
      avgSleepNoCaffeine: Math.round(avgNoLate * 10) / 10,
    };
  }

  return {
    hasCorrelation: false,
    message: '',
    avgCaffeineLateDays: lateSleep.length,
    avgSleepOnLateCaffeine: Math.round(avgLate * 10) / 10,
    avgSleepNoCaffeine: Math.round(avgNoLate * 10) / 10,
  };
}

/**
 * Daily caffeine total alert.
 * Spec 5.34: 400mg/gün (4 fincan kahve) üstüne uyarı.
 */
export function checkDailyCaffeineLimit(totalMg: number): { exceeded: boolean; message: string } {
  if (totalMg > 400) {
    return {
      exceeded: true,
      message: `Bugun ${totalMg}mg kafein aldin (${Math.round(totalMg / 95)} fincan kahve esiti). 400mg siniri astin. Daha fazla su ic ve gec saatlerde kafein alma.`,
    };
  }
  return { exceeded: false, message: '' };
}
