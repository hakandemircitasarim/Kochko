/**
 * AI Feedback Service
 * Spec Section 5.8: Kullanıcı geri bildirimi
 * "İşe yaradı" / "Bana göre değil" butonları
 */
import { supabase } from '@/lib/supabase';

export type FeedbackType = 'helpful' | 'not_for_me';
export type ContextType = 'meal_suggestion' | 'workout_plan' | 'coaching_message' | 'recipe';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitFeedback(
  contextType: ContextType,
  contextId: string | null,
  feedback: FeedbackType
): Promise<void> {
  // ai_feedback.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id):
  // without user_id every insert was rejected and the feedback was lost.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  // context_id is a uuid column; coerce any non-uuid value to null (else 22P02).
  const safeContextId = contextId && UUID_RE.test(contextId) ? contextId : null;
  const { error } = await supabase.from('ai_feedback').insert({
    user_id: user.id,
    context_type: contextType,
    context_id: safeContextId,
    feedback,
  });
  if (error) console.error('[submitFeedback] insert failed:', error.message);
}
