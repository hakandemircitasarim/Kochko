/**
 * Chat Repair Service
 * Spec 5.32: Sohbet Onarım — yanlış anlama düzeltme, güven kontrolü, onarım geçmişi
 */
import { supabase } from '@/lib/supabase';

// ─── Repair Phrase Detection ───

const REPAIR_PHRASES = [
  'yanlis anladin', 'yanlış anladın', 'oyle demedim', 'öyle demedim',
  'hayir oyle degil', 'hayır öyle değil', 'yanlis', 'yanlış',
  'son kaydi sil', 'son kaydı sil', 'geri al', 'iptal et',
  'duzelt', 'düzelt', 'yanlis girdi', 'yanlış girdi',
  'onu demek istemedim', 'kastetmedim', 'yanlis anlasilma', 'yanlış anlaşılma',
];

const UNDO_PHRASES = [
  'son kaydi sil', 'son kaydı sil', 'geri al', 'iptal et',
  'son girisi sil', 'son girişi sil', 'son ogunu sil', 'son öğünü sil',
];

const CONFIRMATION_POSITIVE = ['evet', 'dogru', 'doğru', 'tamam', 'aynen', 'he', 'ehe'];
const CONFIRMATION_NEGATIVE = ['hayir', 'hayır', 'yanlis', 'yanlış', 'degil', 'değil', 'yok'];

export type RepairType = 'correction' | 'undo' | 'clarification' | 'confirmation_yes' | 'confirmation_no' | 'none';

export interface RepairDetection {
  type: RepairType;
  confidence: number;
  matchedPhrase: string | null;
}

/**
 * Detect if user message is a repair/correction attempt.
 * Should be called BEFORE task mode detection.
 */
export function detectRepairIntent(message: string): RepairDetection {
  const lower = message.toLocaleLowerCase('tr').trim();

  // Check undo phrases first (more specific)
  for (const phrase of UNDO_PHRASES) {
    if (lower.includes(phrase)) {
      return { type: 'undo', confidence: 0.95, matchedPhrase: phrase };
    }
  }

  // Check general repair phrases
  for (const phrase of REPAIR_PHRASES) {
    if (lower.includes(phrase)) {
      return { type: 'correction', confidence: 0.9, matchedPhrase: phrase };
    }
  }

  // Check if responding to a confirmation prompt
  // Short messages (< 5 words) that match confirmation patterns
  const wordCount = lower.split(/\s+/).length;
  if (wordCount <= 5) {
    for (const phrase of CONFIRMATION_POSITIVE) {
      if (lower === phrase || lower.startsWith(phrase + ' ')) {
        return { type: 'confirmation_yes', confidence: 0.8, matchedPhrase: phrase };
      }
    }
    for (const phrase of CONFIRMATION_NEGATIVE) {
      if (lower === phrase || lower.startsWith(phrase + ' ') || lower.includes(phrase)) {
        return { type: 'confirmation_no', confidence: 0.8, matchedPhrase: phrase };
      }
    }
  }

  return { type: 'none', confidence: 0, matchedPhrase: null };
}

// ─── Repair History ───

export interface RepairEvent {
  id?: string;
  repair_type: RepairType;
  original_input: string;
  corrected_input: string | null;
  food_item: string | null;
  created_at?: string;
}

/**
 * Store a repair event for learning.
 */
export async function storeRepairEvent(
  userId: string,
  event: Omit<RepairEvent, 'id' | 'created_at'>
): Promise<void> {
  await supabase.from('repair_history').insert({
    user_id: userId,
    repair_type: event.repair_type,
    original_input: event.original_input,
    corrected_input: event.corrected_input,
    food_item: event.food_item,
  });
}

/**
 * Get recent repair history for a user.
 * Used to inform AI about frequent corrections.
 */
export async function getRepairHistory(
  userId: string,
  limit = 10
): Promise<RepairEvent[]> {
  const { data } = await supabase
    .from('repair_history')
    .select('id, repair_type, original_input, corrected_input, food_item, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as RepairEvent[];
}

/**
 * Get correction count for analytics — how often user corrects AI.
 */
export async function getRepairStats(userId: string): Promise<{
  totalRepairs: number;
  recentRepairs: number;
  commonCorrections: { food: string; count: number }[];
}> {
  const { data: total } = await supabase
    .from('repair_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recent } = await supabase
    .from('repair_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo);

  // Get most commonly corrected food items
  const { data: corrections } = await supabase
    .from('repair_history')
    .select('food_item')
    .eq('user_id', userId)
    .not('food_item', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const foodCounts: Record<string, number> = {};
  for (const c of (corrections ?? []) as { food_item: string }[]) {
    foodCounts[c.food_item] = (foodCounts[c.food_item] ?? 0) + 1;
  }

  const commonCorrections = Object.entries(foodCounts)
    .map(([food, count]) => ({ food, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalRepairs: (total as unknown as { count: number })?.count ?? 0,
    recentRepairs: (recent as unknown as { count: number })?.count ?? 0,
    commonCorrections,
  };
}

// ─── Proactive Verification ───

/**
 * Determine if AI should proactively verify a parse.
 * Returns true when confidence is low or food has been frequently corrected.
 */
export function shouldProactivelyVerify(
  confidence: 'high' | 'medium' | 'low',
  foodItem: string | null,
  commonCorrections: { food: string; count: number }[]
): boolean {
  // Always verify low confidence
  if (confidence === 'low') return true;

  // Verify if this food has been corrected before
  if (foodItem) {
    const lowerFood = foodItem.toLocaleLowerCase('tr');
    const isFrequentlyWrong = commonCorrections.some(
      c => lowerFood.includes(c.food.toLocaleLowerCase('tr')) && c.count >= 2
    );
    if (isFrequentlyWrong) return true;
  }

  return false;
}

/**
 * Build a verification prompt for the AI.
 */
export function buildVerificationPrompt(
  parsedItems: { name: string; calories: number; protein_g: number }[]
): string {
  const itemList = parsedItems
    .map(i => `${i.name}: ${i.calories} kcal, ${i.protein_g}g protein`)
    .join('\n');

  return `Dogru anladiysam:\n${itemList}\n\nBu dogru mu?`;
}
