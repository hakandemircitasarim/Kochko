/**
 * Server-Side Chat Repair Handler
 * Spec 5.32: Sohbet Onarım — sunucu tarafı onarım mantığı
 *
 * Intercepts repair intents before normal AI processing.
 * Handles: undo, correction, proactive verification, confirmation responses.
 */

import { supabaseAdmin } from './supabase-admin.ts';

// ─── Types ───

export type RepairType = 'correction' | 'undo' | 'clarification' | 'confirmation_yes' | 'confirmation_no' | 'none';

export interface RepairDetection {
  type: RepairType;
  confidence: number;
  matchedPhrase: string | null;
}

export interface RepairResult {
  handled: boolean;
  response: string | null;
  undoneAction: string | null;
  shouldContinueNormal: boolean;
}

// ─── Repair Phrase Detection (Server-side mirror) ───

const REPAIR_PHRASES = [
  'yanlis anladin', 'yanlış anladın', 'oyle demedim', 'öyle demedim',
  'hayir oyle degil', 'hayır öyle değil',
  'son kaydi sil', 'son kaydı sil', 'geri al', 'iptal et',
  'duzelt', 'düzelt', 'yanlis girdi', 'yanlış girdi',
  'onu demek istemedim', 'kastetmedim',
];

const UNDO_PHRASES = [
  'son kaydi sil', 'son kaydı sil', 'geri al', 'iptal et',
  'son girisi sil', 'son girişi sil', 'son ogunu sil', 'son öğünü sil',
];

const CONFIRMATION_POSITIVE = ['evet', 'dogru', 'doğru', 'tamam', 'aynen', 'he', 'ehe'];
const CONFIRMATION_NEGATIVE = ['hayir', 'hayır', 'yanlis', 'yanlış', 'degil', 'değil', 'yok'];

export function detectRepairIntent(message: string): RepairDetection {
  const lower = message.toLocaleLowerCase('tr').trim();

  for (const phrase of UNDO_PHRASES) {
    if (lower.includes(phrase)) {
      return { type: 'undo', confidence: 0.95, matchedPhrase: phrase };
    }
  }

  for (const phrase of REPAIR_PHRASES) {
    if (lower.includes(phrase)) {
      return { type: 'correction', confidence: 0.9, matchedPhrase: phrase };
    }
  }

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

// ─── Undo Handler ───

/**
 * Undo the last action for a user.
 * Supports: meal_log, workout_log, supplement_log.
 */
export async function handleUndo(userId: string): Promise<RepairResult> {
  // Try undoing the most recent meal log
  const { data: lastMeal } = await supabaseAdmin
    .from('meal_logs')
    .select('id, raw_input, meal_type, logged_at')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastWorkout } = await supabaseAdmin
    .from('workout_logs')
    .select('id, raw_input, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastSupplement } = await supabaseAdmin
    .from('supplement_logs')
    .select('id, supplement_name, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Find the most recent one
  type LogEntry = { id: string; logged_at: string; type: string; label: string };
  const candidates: LogEntry[] = [];

  if (lastMeal) {
    candidates.push({
      id: lastMeal.id as string,
      logged_at: lastMeal.logged_at as string,
      type: 'meal',
      label: `${lastMeal.meal_type}: ${lastMeal.raw_input}`,
    });
  }
  if (lastWorkout) {
    candidates.push({
      id: lastWorkout.id as string,
      logged_at: lastWorkout.logged_at as string,
      type: 'workout',
      label: lastWorkout.raw_input as string,
    });
  }
  if (lastSupplement) {
    candidates.push({
      id: lastSupplement.id as string,
      logged_at: lastSupplement.logged_at as string,
      type: 'supplement',
      label: lastSupplement.supplement_name as string,
    });
  }

  if (candidates.length === 0) {
    return {
      handled: true,
      response: 'Geri alinacak bir kayit bulunamadi.',
      undoneAction: null,
      shouldContinueNormal: false,
    };
  }

  // Sort by most recent
  candidates.sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
  const target = candidates[0];

  // Soft delete based on type
  switch (target.type) {
    case 'meal':
      await supabaseAdmin
        .from('meal_logs')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', target.id);
      break;
    case 'workout':
      await supabaseAdmin
        .from('workout_logs')
        .delete()
        .eq('id', target.id);
      break;
    case 'supplement':
      await supabaseAdmin
        .from('supplement_logs')
        .delete()
        .eq('id', target.id);
      break;
  }

  // Store repair event
  await storeRepairEvent(userId, {
    repair_type: 'undo',
    original_input: target.label,
    corrected_input: null,
    food_item: target.type === 'meal' ? target.label : null,
  });

  return {
    handled: true,
    response: `"${target.label}" kaydı geri alındı.`,
    undoneAction: target.type,
    shouldContinueNormal: false,
  };
}

// ─── Correction Handler ───

/**
 * When user says "yanlış anladın", build context for AI to re-parse.
 * Returns instructions to prepend to the system prompt.
 */
export function buildCorrectionContext(userId: string): string {
  return `KULLANICI SON PARSE'I DUZELTMEK ISTIYOR.
Onceki anladığın YANLIS olabilir.
1. Kullaniciya "Ne duzeltmemi istersin?" diye sor
2. Yeni bilgiyi al ve DUZELTILMIS parse yap
3. Duzeltmeyi asla sessizce yapma — her zaman "Anladim, su sekilde duzeltiyorum: ..." de
4. Eski yanlis kaydi otomatik sil (is_deleted=true)`;
}

// ─── Repair Event Storage ───

async function storeRepairEvent(
  userId: string,
  event: {
    repair_type: string;
    original_input: string;
    corrected_input: string | null;
    food_item: string | null;
  }
): Promise<void> {
  await supabaseAdmin.from('repair_history').insert({
    user_id: userId,
    ...event,
  });
}

// ─── Repair History for Context ───

/**
 * Get repair statistics to include in AI context.
 * Helps AI know which foods it frequently gets wrong.
 */
export async function getRepairContext(userId: string): Promise<string> {
  const { data: repairs } = await supabaseAdmin
    .from('repair_history')
    .select('food_item, repair_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!repairs || repairs.length === 0) return '';

  const foodCounts: Record<string, number> = {};
  for (const r of repairs as { food_item: string | null }[]) {
    if (r.food_item) {
      foodCounts[r.food_item] = (foodCounts[r.food_item] ?? 0) + 1;
    }
  }

  const frequent = Object.entries(foodCounts)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (frequent.length === 0) return '';

  return `## DUZELTME GECMISI\nSik duzeltilen yiyecekler (dikkatli ol): ${frequent.map(([food, count]) => `${food} (${count}x)`).join(', ')}`;
}

// ─── Persona Detection ───

/**
 * Check if user has enough messages for persona detection.
 * Returns message count for the user.
 */
export async function getMessageCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user');

  return count ?? 0;
}

/**
 * Check if persona should be detected (100+ messages, no persona yet).
 */
export async function shouldDetectPersona(userId: string): Promise<boolean> {
  const [messageCount, { data: summary }] = await Promise.all([
    getMessageCount(userId),
    supabaseAdmin
      .from('ai_summary')
      .select('user_persona')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  // Detect persona at 100, 250, and 500 messages (re-evaluate periodically)
  const thresholds = [100, 250, 500];
  const hasNoPersona = !summary?.user_persona;
  const atThreshold = thresholds.some(t => messageCount >= t && messageCount < t + 10);

  return hasNoPersona || atThreshold;
}

/**
 * Build persona detection instruction for the AI.
 */
export function buildPersonaDetectionPrompt(messageCount: number): string {
  return `
PERSONA TESPITI GEREKLI (${messageCount}+ mesaj).
Kullanicinin davranis kaliplarina bakarak asagidakilerden birini sec:
- disiplinli: Hafta ici kurallara uyar, düzenli kayıt girer
- motivasyon_bagimlisi: Basari ve ovgu ile motive olur, zorlandiginda birakir
- minimalist: Kisa ve oz bilgi ister, detay istemez
- veri_odakli: Grafikler ve rakamlar ister, analitik dusunur
- sosyal_yiyici: Disarida yemek ve sosyal etkinlikler etkiler
- stres_yiyici: Stres ve duygusal tetikleyicilerle fazla yer

<layer2_update>
user_persona: [tespit edilen persona]
</layer2_update> blogu ile kaydet.`;
}

// ─── Tone Adjustment ───

/**
 * Build tone adjustment context based on learned preference and feedback.
 */
export async function getToneContext(userId: string): Promise<string> {
  const { data: summary } = await supabaseAdmin
    .from('ai_summary')
    .select('learned_tone_preference, user_persona')
    .eq('user_id', userId)
    .maybeSingle();

  if (!summary) return '';

  const tone = summary.learned_tone_preference as string | null;
  const persona = summary.user_persona as string | null;

  const parts: string[] = [];

  if (tone) {
    const toneInstructions: Record<string, string> = {
      empathetic: 'Empatik ve destekleyici ol. Basarisizliklari normalize et. "Olur boyle seyler" tonu.',
      data_driven: 'Veri ve rakamlarla konus. Grafikler ve yuzdelikler kullan. Duygusal dil minimize.',
      motivational: 'Motive edici ve enerjik ol. Basarilari kutla. "Harika gidiyorsun!" tonu.',
      strict: 'Net ve dogrudan ol. Gereksiz ovgu yapma. Hedeflere odaklan.',
    };
    parts.push(`TON TERCIHI: ${toneInstructions[tone] ?? tone}`);
  }

  if (persona) {
    const personaHints: Record<string, string> = {
      disiplinli: 'Bu kullanici disiplinli — net bilgi ver, gereksiz motivasyon atla.',
      motivasyon_bagimlisi: 'Bu kullanici motivasyona ihtiyac duyuyor — kucuk basarilari kutla.',
      minimalist: 'Bu kullanici kisa yanit istiyor — gereksiz detay verme.',
      veri_odakli: 'Bu kullanici veri seviyor — rakamlar, yuzdelikler, trendler kullan.',
      sosyal_yiyici: 'Bu kullanici sosyal ortamlarda zorlanir — disarida yemek stratejileri onemli.',
      stres_yiyici: 'Bu kullanici stresle yer — stres tetikleyicilerini izle, alternatif bas etme onerileri sun.',
    };
    parts.push(personaHints[persona] ?? '');
  }

  return parts.filter(Boolean).join('\n');
}

// ─── "What Do You Know About Me" Handler ───

/**
 * Build a comprehensive summary of what AI has learned about the user.
 * Triggered when user asks "benim hakkimda ne biliyorsun" or similar.
 */
export async function buildKnowledgeSummary(userId: string): Promise<string> {
  const { data: summary } = await supabaseAdmin
    .from('ai_summary')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!summary) return 'Henuz seni tanimiyorum — konustukca ogrenecegim!';

  const s = summary as Record<string, unknown>;
  const parts: string[] = ['Seni su sekilde taniyorum:\n'];

  if (s.general_summary) parts.push(`**Genel:** ${s.general_summary}`);
  if (s.user_persona) parts.push(`**Tip:** ${s.user_persona}`);
  if (s.learned_tone_preference) parts.push(`**Tercih ettigin iletisim:** ${s.learned_tone_preference}`);
  if (s.nutrition_literacy) parts.push(`**Beslenme bilgi seviyesi:** ${s.nutrition_literacy}`);

  const patterns = s.behavioral_patterns as Record<string, unknown>[] | null;
  if (patterns && patterns.length > 0) {
    const active = patterns.filter(p => p.status !== 'resolved');
    if (active.length > 0) {
      parts.push(`\n**Fark ettigim kaliplar:**`);
      for (const p of active.slice(0, 5)) {
        parts.push(`- ${p.description}`);
      }
    }
  }

  const portion = s.portion_calibration as Record<string, unknown> | null;
  if (portion && Object.keys(portion).length > 0) {
    parts.push(`\n**Porsiyon hafizam:** ${Object.entries(portion).map(([k, v]) => `senin "${k}" = ${v}g`).join(', ')}`);
  }

  const learnedMealTimes = s.learned_meal_times as Record<string, string> | null;
  if (learnedMealTimes && Object.keys(learnedMealTimes).length > 0) {
    const labels: Record<string, string> = { breakfast: 'kahvalti', lunch: 'ogle', dinner: 'aksam' };
    parts.push(`**Ogun saatlerin:** ${Object.entries(learnedMealTimes).map(([k, v]) => `${labels[k] ?? k} ~${v}`).join(', ')}`);
  }

  if (s.alcohol_pattern) parts.push(`**Alkol kalibi:** ${s.alcohol_pattern}`);
  if (s.caffeine_sleep_notes) parts.push(`**Kafein-uyku:** ${s.caffeine_sleep_notes}`);
  if (s.social_eating_notes) parts.push(`**Sosyal yeme:** ${s.social_eating_notes}`);
  if (s.recovery_pattern) parts.push(`**Toparlanma:** ${s.recovery_pattern}`);

  parts.push('\n_Yanlis ogrendigim bir sey varsa soyle, hemen duzelteyim._');

  return parts.join('\n');
}

// ─── Pattern Confidence Evolution ───

/**
 * Evolve pattern confidence scores over time.
 * Called periodically (e.g., weekly) to decay stale patterns and boost confirmed ones.
 */
export async function evolvePatternConfidence(userId: string): Promise<void> {
  const { data: summary } = await supabaseAdmin
    .from('ai_summary')
    .select('behavioral_patterns')
    .eq('user_id', userId)
    .maybeSingle();

  if (!summary) return;

  const patterns = (summary.behavioral_patterns as Record<string, unknown>[] | null) ?? [];
  if (patterns.length === 0) return;

  const now = Date.now();
  let changed = false;

  for (const pattern of patterns) {
    const confidence = (pattern.confidence as number) ?? 0.5;
    const lastOccurred = pattern.last_occurred as string | null;
    const timesObserved = (pattern.times_observed as number) ?? 1;

    if (lastOccurred) {
      const daysSince = Math.floor((now - new Date(lastOccurred).getTime()) / 86400000);

      // Decay: if not observed for 14+ days, reduce confidence
      if (daysSince > 14 && confidence > 0.2) {
        pattern.confidence = Math.max(0.1, confidence - 0.05);
        changed = true;
      }
    }

    // Boost: patterns with 4+ observations get boosted
    if (timesObserved >= 4 && confidence < 0.8) {
      pattern.confidence = Math.min(0.95, confidence + 0.1);
      changed = true;
    }

    // Remove very low confidence patterns (< 0.15) that are old
    if (confidence < 0.15 && (pattern.status as string) === 'candidate') {
      pattern.status = 'resolved';
      changed = true;
    }
  }

  if (changed) {
    // Filter out resolved patterns older than 30 days
    const activePatterns = patterns.filter(p => {
      if (p.status !== 'resolved') return true;
      const lastOcc = p.last_occurred as string | null;
      if (!lastOcc) return false;
      return (now - new Date(lastOcc).getTime()) < 30 * 86400000;
    });

    await supabaseAdmin
      .from('ai_summary')
      .update({ behavioral_patterns: activePatterns, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
}
