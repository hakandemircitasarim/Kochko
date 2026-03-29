/**
 * AI Feedback Service — Spec 5.7
 * Collects user feedback on AI suggestions: "ise yaradi" / "bana gore degil".
 * Feeds into Katman 2 for coaching style adjustment.
 */
import { supabase } from '@/lib/supabase';

export type FeedbackType = 'helpful' | 'not_for_me';
export type ContextType = 'meal_suggestion' | 'workout_plan' | 'coaching_message' | 'recipe';

/**
 * Submit feedback on an AI suggestion/message.
 * Spec 5.7: "İşe yaradı" tıklaması AI o öneri türünün ağırlığını artırır.
 */
export async function submitFeedback(
  contextType: ContextType,
  contextId: string,
  feedback: FeedbackType,
  reason?: string,
): Promise<void> {
  await supabase.from('ai_feedback').insert({
    context_type: contextType,
    context_id: contextId,
    feedback,
    reason: reason ?? null,
  });
}

/**
 * Get feedback stats for a specific context type.
 * Used by AI to adjust recommendation weights.
 */
export async function getFeedbackStats(contextType: ContextType): Promise<{
  helpful: number;
  notForMe: number;
  topReasons: string[];
}> {
  const { data } = await supabase
    .from('ai_feedback')
    .select('feedback, reason')
    .eq('context_type', contextType);

  const items = (data ?? []) as { feedback: string; reason: string | null }[];
  const helpful = items.filter(i => i.feedback === 'helpful').length;
  const notForMe = items.filter(i => i.feedback === 'not_for_me').length;

  // Extract top reasons for "not_for_me"
  const reasons = items.filter(i => i.reason).map(i => i.reason as string);
  const reasonCounts = new Map<string, number>();
  for (const r of reasons) {
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);

  return { helpful, notForMe, topReasons };
}

/**
 * Check if user already gave feedback for a specific context.
 */
export async function hasFeedback(contextId: string): Promise<boolean> {
  const { count } = await supabase
    .from('ai_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('context_id', contextId);
  return (count ?? 0) > 0;
}
