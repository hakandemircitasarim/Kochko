/**
 * Return Flow Service
 * Spec 10: Geri Dönüş Akışı — arayi actiysan yargilamaz
 *
 * 3 gün sessizlik → hafif bildirim
 * 7 gün → kişisel bildirim
 * Geri döndüğünde → "Hoş geldin" tonu
 * İlk 3 gün plan hafifletilir
 * 6+ ay aradan sonra → mini re-onboarding
 */
import { supabase } from '@/lib/supabase';

// ─── Types ───

export type ReturnLevel = 'active' | 'short_break' | 'medium_break' | 'long_break' | 'very_long_break';

export interface ReturnStatus {
  level: ReturnLevel;
  daysSinceLastActivity: number;
  lastActivityDate: string | null;
  welcomeMessage: string;
  planLightening: number; // percentage to reduce targets (0, 20, 30)
  needsReOnboarding: boolean;
}

// ─── Core Functions ───

/**
 * Detect return level based on days since last activity.
 */
export async function detectReturnLevel(userId: string): Promise<ReturnStatus> {
  const { data: lastMessage } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastMessage) {
    return {
      level: 'active',
      daysSinceLastActivity: 0,
      lastActivityDate: null,
      welcomeMessage: '',
      planLightening: 0,
      needsReOnboarding: false,
    };
  }

  const lastDate = new Date(lastMessage.created_at as string);
  const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);

  if (daysSince <= 2) {
    return {
      level: 'active',
      daysSinceLastActivity: daysSince,
      lastActivityDate: lastMessage.created_at as string,
      welcomeMessage: '',
      planLightening: 0,
      needsReOnboarding: false,
    };
  }

  if (daysSince <= 7) {
    return {
      level: 'short_break',
      daysSinceLastActivity: daysSince,
      lastActivityDate: lastMessage.created_at as string,
      welcomeMessage: 'Hos geldin! Seni ozledim. Nereden devam edelim?',
      planLightening: 0,
      needsReOnboarding: false,
    };
  }

  if (daysSince <= 30) {
    return {
      level: 'medium_break',
      daysSinceLastActivity: daysSince,
      lastActivityDate: lastMessage.created_at as string,
      welcomeMessage: `${daysSince} gundur gorusmuyorduk. Hos geldin! Ilk 3 gun hafif bir planla baslayalim, yavasyavas eski ritme doneriz.`,
      planLightening: 20,
      needsReOnboarding: false,
    };
  }

  if (daysSince <= 180) {
    return {
      level: 'long_break',
      daysSinceLastActivity: daysSince,
      lastActivityDate: lastMessage.created_at as string,
      welcomeMessage: `Uzun bir aradan sonra tekrar buradasin — harika! Hedeflerini ve durumunu guncelleyelim, sonra sana yeni bir plan yaparim.`,
      planLightening: 30,
      needsReOnboarding: false,
    };
  }

  // 6+ months
  return {
    level: 'very_long_break',
    daysSinceLastActivity: daysSince,
    lastActivityDate: lastMessage.created_at as string,
    welcomeMessage: 'Tekrar hosgeldin! Cok sey degismis olabilir. Seni yeniden taniyalim — kilo, hedef ve yasam tarzin guncellenmis olabilir.',
    planLightening: 30,
    needsReOnboarding: true,
  };
}

/**
 * Generate welcome-back content with past achievements reference.
 */
export async function generateWelcomeBack(userId: string, status: ReturnStatus): Promise<string> {
  if (status.level === 'active') return '';

  // Fetch past achievements for motivation
  const { data: streakData } = await supabase
    .from('daily_reports')
    .select('compliance_score')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(30);

  const reports = (streakData ?? []) as { compliance_score: number }[];
  const goodDays = reports.filter(r => r.compliance_score >= 70).length;

  let achievementRef = '';
  if (goodDays > 0 && reports.length > 0) {
    achievementRef = `\n\nDaha once ${goodDays}/${reports.length} gun hedeflerini tutturmusstun. O gucun hala sende.`;
  }

  return status.welcomeMessage + achievementRef;
}

/**
 * Lighten plan targets for return users.
 * Reduces calorie target and workout intensity for first 3 days.
 */
export function lightenPlanForReturn(
  originalCalorieMin: number,
  originalCalorieMax: number,
  lighteningPercent: number
): { adjustedMin: number; adjustedMax: number; note: string } {
  if (lighteningPercent === 0) {
    return { adjustedMin: originalCalorieMin, adjustedMax: originalCalorieMax, note: '' };
  }

  const factor = 1 + (lighteningPercent / 100); // e.g., 1.20 for 20% lighter (higher range = easier)
  const floor = 1200; // minimum

  return {
    adjustedMin: Math.max(floor, Math.round(originalCalorieMin * factor)),
    adjustedMax: Math.round(originalCalorieMax * factor),
    note: `Ilk 3 gun plan %${lighteningPercent} hafifletildi. Yavasyavas eski ritme donecegiz.`,
  };
}

/**
 * Check if user needs mini re-onboarding (6+ month gap).
 * Returns fields that should be re-verified.
 */
export function getReOnboardingQuestions(): string[] {
  return [
    'Mevcut kilonuz nedir?',
    'Hedefiniz degisti mi?',
    'Yasam tarzinizda buyuk bir degisiklik oldu mu? (is, evlilik, hamilelik vs.)',
    'Antrenman durumunuz nedir? (aktif/pasif/yeni basliyor)',
    'Herhangi bir saglik sorununuz var mi?',
  ];
}

/**
 * Build return flow context for AI system prompt.
 */
export function buildReturnFlowContext(status: ReturnStatus): string {
  if (status.level === 'active') return '';

  const parts: string[] = [
    `## GERI DONUS MODU`,
    `Son aktivite: ${status.daysSinceLastActivity} gun once`,
    `Seviye: ${status.level}`,
  ];

  if (status.planLightening > 0) {
    parts.push(`Plan hafifletme: %${status.planLightening} — ilk 3 gun hedefler dusuruldu`);
  }

  parts.push(`\nKURALLAR:`);
  parts.push(`1. YARGILAMA. "Neredesin?" deme.`);
  parts.push(`2. Sicak ve samimi "hosgeldin" tonu kullan.`);
  parts.push(`3. Gecmis basarilarina referans ver.`);
  parts.push(`4. Streak sifirlanmis olsa bile yeni baslangic tonu.`);
  parts.push(`5. Ilk 3 gun plan hafifletildi — bunu belirt.`);

  if (status.needsReOnboarding) {
    parts.push(`6. MINI RE-ONBOARDING gerekli: kilo, hedef, yasam tarzi guncellemesi sor.`);
  }

  return parts.join('\n');
}
