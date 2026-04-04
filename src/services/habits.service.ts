/**
 * Habit Stacking Service
 * Spec 5.35: Alışkanlık bazlı koçluk
 *
 * First week: single habit target (e.g., log breakfast daily).
 * After 80%+ compliance for 2 weeks: stack next habit.
 * Habits are linked to existing behaviors (anchoring).
 */
import { supabase } from '@/lib/supabase';

export interface Habit {
  id: string;
  name: string;
  description: string;
  anchor: string | null;    // "Her kahvalti kaydından sonra" etc.
  status: 'active' | 'mastered' | 'stacked';
  streak: number;
  startedAt: string;
  masteredAt: string | null;
  weekly_compliance?: number; // A4: Son 14 gundeki tamamlanma orani (0-100)
  completion_log?: string[];  // A4: Tamamlanan gunlerin tarih listesi
}

// Progressive habit sequence
const HABIT_SEQUENCE = [
  { name: 'Gunluk ogun kaydi', description: 'Her gun en az 1 ogun kaydet', anchor: null },
  { name: 'Su takibi', description: 'Her gun su hedefine ulas', anchor: 'Her ogun kaydından sonra su ekle' },
  { name: 'Tarti kaydi', description: 'Haftada en az 3 gun tartıl', anchor: 'Her sabah kalktığında tartıl' },
  { name: 'Protein hedefi', description: 'Her gun protein hedefini tuttursun', anchor: 'Her ogun planlarken proteini kontrol et' },
  { name: 'Uyku kaydi', description: 'Her gun uyku kaydı gir', anchor: 'Her sabah kalktığında uyku gir' },
  { name: 'Antrenman rutini', description: 'Haftada en az 3 gun antrenman yap', anchor: 'Her antrenman gunu sabah plani kontrol et' },
];

/**
 * Get user's current habit stack from AI summary.
 * Habits are stored in ai_summary.habit_progress
 */
export async function getHabitStack(userId: string): Promise<Habit[]> {
  const { data } = await supabase
    .from('ai_summary')
    .select('habit_progress')
    .eq('user_id', userId)
    .single();

  if (!data?.habit_progress) return [];
  return (data.habit_progress as Habit[]) ?? [];
}

/**
 * A4: Calculate weekly_compliance for a habit.
 * Looks at the last 14 days of completion_log and returns (completed_days / 14) * 100.
 */
export function calculateWeeklyCompliance(habit: Habit): number {
  if (!habit.completion_log || habit.completion_log.length === 0) return 0;

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const cutoff = fourteenDaysAgo.toISOString().split('T')[0];

  const recentDays = habit.completion_log.filter(dateStr => dateStr >= cutoff);
  // Deduplicate days (in case of multiple entries per day)
  const uniqueDays = new Set(recentDays);

  return Math.round((uniqueDays.size / 14) * 100);
}

/**
 * A4: Update weekly_compliance for all habits in the stack.
 */
export function updateComplianceForAll(habits: Habit[]): Habit[] {
  return habits.map(h => ({
    ...h,
    weekly_compliance: calculateWeeklyCompliance(h),
  }));
}

/**
 * Determine next habit to introduce.
 * A4: Uses weekly_compliance (80%+ over 14 days) instead of streak to decide mastery.
 */
export function getNextHabit(currentHabits: Habit[]): { habit: typeof HABIT_SEQUENCE[0]; message: string } | null {
  const masteredCount = currentHabits.filter(h => h.status === 'mastered' || h.status === 'stacked').length;

  if (masteredCount >= HABIT_SEQUENCE.length) return null;

  // Check if current active habit has reached mastery via compliance
  const active = currentHabits.find(h => h.status === 'active');
  if (active) {
    const compliance = active.weekly_compliance ?? calculateWeeklyCompliance(active);
    // Need 80%+ compliance over 14-day window to progress
    if (compliance < 80) return null;
  }

  const nextIndex = masteredCount;
  if (nextIndex >= HABIT_SEQUENCE.length) return null;

  const next = HABIT_SEQUENCE[nextIndex];
  const prevName = masteredCount > 0 ? HABIT_SEQUENCE[masteredCount - 1].name : null;

  return {
    habit: next,
    message: prevName
      ? `"${prevName}" aliskanligini oturtmussin (%80+ uyum), simdi "${next.name}" ekliyoruz. ${next.anchor ?? ''}`
      : `Ilk aliskanlik hedefin: "${next.name}". ${next.description}.`,
  };
}

// ─── Chat Integration (Phase 7) ───

/**
 * Get current habit stack formatted for system prompt inclusion.
 */
export function getChatIntegrationPrompt(habits: Habit[]): string {
  const active = habits.filter(h => h.status === 'active');
  const mastered = habits.filter(h => h.status === 'mastered');

  if (active.length === 0 && mastered.length === 0) return '';

  const parts: string[] = ['## ALISKANLIK DURUMU'];

  if (active.length > 0) {
    parts.push(`Aktif: ${active.map(h => `"${h.name}" (${h.streak} gun seri, %${h.weekly_compliance ?? 0} uyum)`).join(', ')}`);
  }
  if (mastered.length > 0) {
    parts.push(`Oturtulmus: ${mastered.map(h => h.name).join(', ')}`);
  }

  // If active habit streak is about to reach 14 days, note it
  const almostMastered = active.find(h => h.streak >= 12 && h.streak < 14);
  if (almostMastered) {
    parts.push(`"${almostMastered.name}" 2 gun sonra oturtulmus sayilacak!`);
  }

  return parts.join('\n');
}

/**
 * Check if a chat message contains habit-relevant behavior.
 * Returns habit update if applicable.
 */
export function checkHabitFromChat(
  message: string,
  activeHabits: Habit[]
): { habitName: string; increment: boolean } | null {
  const lower = message.toLocaleLowerCase('tr');

  for (const habit of activeHabits) {
    const habitLower = habit.name.toLocaleLowerCase('tr');

    // Check if message relates to habit completion
    if (habitLower.includes('kahvalti') && /kahvalt|sabah.*(yedim|ictim)/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('su') && /su.*(ictim|içtim)|bardak.*su|litre/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('kayit') && /yedim|ictim|antrenman|kaydet/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('protein') && /protein.*yedim|tavuk|yumurta|yogurt/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
  }

  return null;
}
