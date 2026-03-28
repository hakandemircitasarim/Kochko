/**
 * AI Feedback Service
 * Spec Section 5.8: Kullanıcı geri bildirimi
 * "İşe yaradı" / "Bana göre değil" butonları
 */
import { supabase } from '@/lib/supabase';

export type FeedbackType = 'helpful' | 'not_for_me';
export type ContextType = 'meal_suggestion' | 'workout_plan' | 'coaching_message' | 'recipe';

export async function submitFeedback(
  contextType: ContextType,
  contextId: string | null,
  feedback: FeedbackType
): Promise<void> {
  await supabase.from('ai_feedback').insert({
    context_type: contextType,
    context_id: contextId,
    feedback,
  });
}
