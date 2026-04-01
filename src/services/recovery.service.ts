/**
 * Quick Recovery Service
 * Spec 6.3: "Bugün çok yedim" dediğinde
 *
 * YARGILAMAZ. Empati kurar, normalize eder.
 * Haftalık bütçe perspektifinden değerlendirir.
 * Mini kurtarma planı sunar.
 */
import { supabase } from '@/lib/supabase';
import { calculateWeeklyBudget, getWeeklyStatus } from '@/lib/weekly-budget';

export interface RecoveryAssessment {
  todayExcess: number; // kcal over daily target
  weeklyRemaining: number; // kcal remaining in weekly budget
  weeklyMarginPercent: number; // % of weekly budget remaining
  daysLeftInWeek: number;
  severity: 'mild' | 'moderate' | 'significant';
  isWeekSalvageable: boolean;
}

export interface RecoveryPlan {
  assessment: RecoveryAssessment;
  empathyMessage: string;
  miniPlan: RecoveryAction[];
  tomorrowStrategy: string;
  weeklyPerspective: string;
}

export interface RecoveryAction {
  title: string;
  description: string;
  priority: number;
}

// ─── Empathy Messages ───

const EMPATHY_MESSAGES = [
  'Herkesin boyle gunleri olur. Bir gun her seyi belirlemez.',
  'Rahat ol, bu senin yolculugunu bozmaz. Haftalik bakinca kucuk bir sapma.',
  'Olur boyle gunler. Onemli olan yarin devam etmen.',
  'Kendini kotru hissetmene gerek yok. Plan bozuldu ama hafta bitmedi.',
  'Bu kadar uzerine dusme. Bir gun fazla yemek uzun vadede hicbir sey degistirmez.',
];

// ─── Core Functions ───

/**
 * Assess the current recovery situation.
 */
export async function assessRecovery(
  userId: string,
  todayCalories: number,
  dailyTarget: number,
  weeklyBudget: { totalBudget: number; consumed: number; remaining: number; daysLeft: number } | null
): Promise<RecoveryAssessment> {
  const excess = Math.max(0, todayCalories - dailyTarget);

  const weeklyRemaining = weeklyBudget?.remaining ?? 0;
  const weeklyTotal = weeklyBudget?.totalBudget ?? dailyTarget * 7;
  const weeklyMarginPercent = weeklyTotal > 0 ? Math.round((weeklyRemaining / weeklyTotal) * 100) : 0;
  const daysLeft = weeklyBudget?.daysLeft ?? 0;

  let severity: 'mild' | 'moderate' | 'significant' = 'mild';
  if (excess > 800) severity = 'significant';
  else if (excess > 400) severity = 'moderate';

  return {
    todayExcess: excess,
    weeklyRemaining,
    weeklyMarginPercent,
    daysLeftInWeek: daysLeft,
    severity,
    isWeekSalvageable: weeklyRemaining > 0 || excess < 500,
  };
}

/**
 * Generate a recovery plan based on assessment.
 */
export function generateRecoveryPlan(assessment: RecoveryAssessment): RecoveryPlan {
  const empathyMessage = EMPATHY_MESSAGES[Math.floor(Math.random() * EMPATHY_MESSAGES.length)];

  // Mini plan for rest of day
  const miniPlan: RecoveryAction[] = [];

  miniPlan.push({
    title: 'Su ic',
    description: 'Simdiden yatana kadar en az 0.5L su ic',
    priority: 1,
  });

  if (assessment.severity !== 'significant') {
    miniPlan.push({
      title: 'Hafif aksam yemegi',
      description: 'Protein agirlikli, dusuk kalorili bir ogun (tavuk salata, yogurt gibi)',
      priority: 2,
    });
  } else {
    miniPlan.push({
      title: 'Atistirma yapma',
      description: 'Bugun icin yeterli yedin. Su ve cay ile idare et.',
      priority: 2,
    });
  }

  miniPlan.push({
    title: 'Erken yat',
    description: 'Iyi bir uyku yarin icin en iyi baslangic',
    priority: 3,
  });

  // Tomorrow strategy
  let tomorrowStrategy: string;
  if (assessment.isWeekSalvageable && assessment.daysLeftInWeek > 0) {
    const dailyReduction = Math.round(assessment.todayExcess / assessment.daysLeftInWeek);
    tomorrowStrategy = `Yarin ve sonraki ${assessment.daysLeftInWeek - 1} gun, gunluk hedefinden ${dailyReduction} kcal daha az yersen hafta dengelenir.`;
  } else {
    tomorrowStrategy = 'Yarin normal planina don. Bir gunku sapma buyuk resmi degistirmez.';
  }

  // Weekly perspective
  let weeklyPerspective: string;
  if (assessment.weeklyRemaining > 0) {
    weeklyPerspective = `Bugun ${assessment.todayExcess} kcal fazla yedin ama haftalik butcende hala ${assessment.weeklyRemaining} kcal marjin var. Rahat ol.`;
  } else {
    weeklyPerspective = `Haftalik butce doldu ama bu dunya degil. Yarin temiz bir sayfa ac.`;
  }

  return {
    assessment,
    empathyMessage,
    miniPlan,
    tomorrowStrategy,
    weeklyPerspective,
  };
}

/**
 * Schedule a recovery follow-up for the next day.
 */
export async function scheduleRecoveryFollowup(userId: string): Promise<void> {
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(9, 0, 0, 0); // 09:00 next day

  await supabase.from('user_commitments').insert({
    user_id: userId,
    commitment: 'Kurtarma takibi — dun fazla yedin, bugun nasil gidiyor?',
    follow_up_at: tomorrow.toISOString(),
    status: 'pending',
  });
}

/**
 * Get recovery history — how often user triggers recovery mode.
 */
export async function getRecoveryHistory(userId: string, daysBack = 30): Promise<{
  recoveryCount: number;
  lastRecoveryDate: string | null;
  averageExcess: number;
}> {
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString();
  const { data } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('task_mode', 'recovery')
    .gte('created_at', startDate);

  const messages = (data ?? []) as { created_at: string }[];

  return {
    recoveryCount: messages.length,
    lastRecoveryDate: messages.length > 0 ? messages[0].created_at : null,
    averageExcess: 0, // Would need daily report data for accurate calculation
  };
}

/**
 * Build recovery context for AI system prompt.
 */
export function buildRecoveryContext(assessment: RecoveryAssessment): string {
  return `KURTARMA MODU AKTIF
Bugunun fazlasi: ${assessment.todayExcess} kcal
Haftalik kalan: ${assessment.weeklyRemaining} kcal
Hafta kurtarilabilir: ${assessment.isWeekSalvageable ? 'EVET' : 'HAYIR'}
Ciddiyet: ${assessment.severity}

KURALLAR:
1. YARGILAMA. Empati kur, normalize et.
2. Haftalik perspektif ver.
3. Gunun kalan kismina mini kurtarma plani sun.
4. "Bugun bozuldu ama hafta bitmedi" mesajini AKTIF ver.
5. Yarin ve obur gun icin dengeleme stratejisi oner.
6. ASLA "neden boyle yaptin" deme.
7. ASLA katı diyet onerme.`;
}
