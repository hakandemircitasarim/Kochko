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

// NOTE: undo commands ('geri al', 'iptal et', 'son kaydı sil', ...) are NOT
// listed here. They mean UNDO, not "re-parse" — and they are handled by the
// gated UNDO_PHRASES branch. Listing them here would (a) be redundant and
// (b) re-introduce the mid-sentence misfire ('geri almak', 'iptal ettim')
// that the (now word-boundary-gated) undo branch was just fixed to avoid.
const REPAIR_PHRASES = [
  'yanlis anladin', 'yanlış anladın', 'oyle demedim', 'öyle demedim',
  'hayir oyle degil', 'hayır öyle değil',
  'duzelt', 'düzelt', 'yanlis girdi', 'yanlış girdi',
  'onu demek istemedim', 'kastetmedim',
];

const UNDO_PHRASES = [
  'son kaydi sil', 'son kaydı sil', 'geri al', 'iptal et',
  'son girisi sil', 'son girişi sil', 'son ogunu sil', 'son öğünü sil',
];

// FIX (audit AI-EXT-05): map type-specific undo phrases to the log type they mean, so
// handleUndo deletes what the user actually asked for. Generic phrases ('geri al',
// 'iptal et', 'son kaydı sil', 'son girişi sil') map to null = newest-across-types.
export type UndoTargetType = 'meal' | 'workout' | 'supplement';
const UNDO_PHRASE_TYPE: Record<string, UndoTargetType> = {
  'son ogunu sil': 'meal',
  'son öğünü sil': 'meal',
};
export function undoTypeForPhrase(phrase: string | null | undefined): UndoTargetType | null {
  if (!phrase) return null;
  return UNDO_PHRASE_TYPE[phrase] ?? null;
}

const CONFIRMATION_POSITIVE = ['evet', 'dogru', 'doğru', 'tamam', 'aynen', 'he', 'ehe'];
const CONFIRMATION_NEGATIVE = ['hayir', 'hayır', 'yanlis', 'yanlış', 'degil', 'değil', 'yok'];

export function detectRepairIntent(message: string): RepairDetection {
  const lower = message.toLocaleLowerCase('tr').trim();
  const wordCount = lower.split(/\s+/).length;

  // Match a phrase only as a standalone whitespace-delimited token sequence,
  // so 'geri al' / 'iptal et' don't fire inside ordinary verbs like
  // 'geri almak' / 'iptal ettim'. Padding the message lets the phrase match
  // at the start or end of the utterance too.
  const padded = ` ${lower} `;
  const containsPhrase = (phrase: string) => padded.includes(` ${phrase} `);

  // Undo is DESTRUCTIVE (soft-deletes the last meal / hard-deletes the last
  // workout|supplement), so gate it like confirmations: short message + a
  // word-boundary match. This prevents a user merely talking ABOUT regaining
  // weight/muscle or cancelling something from wiping their latest log.
  if (wordCount <= 5) {
    for (const phrase of UNDO_PHRASES) {
      if (containsPhrase(phrase)) {
        return { type: 'undo', confidence: 0.95, matchedPhrase: phrase };
      }
    }
  }

  for (const phrase of REPAIR_PHRASES) {
    if (lower.includes(phrase)) {
      return { type: 'correction', confidence: 0.9, matchedPhrase: phrase };
    }
  }

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
 *
 * FIX (audit AI-EXT-05): `intendedType` constrains the candidate set to what the user
 * actually asked to undo. Type-specific phrases ('son öğünü sil') pass 'meal' so a meal
 * undo after a workout log no longer hard-deletes the (unrecoverable) workout. Generic
 * phrases ('geri al' / 'iptal et') pass null → newest-across-types fallback (unchanged).
 */
export async function handleUndo(userId: string, intendedType: UndoTargetType | null = null): Promise<RepairResult> {
  // Only query the log types relevant to the user's intent. When intendedType is null
  // (generic undo) we consider all three and pick the newest.
  const wantMeal = intendedType === null || intendedType === 'meal';
  const wantWorkout = intendedType === null || intendedType === 'workout';
  const wantSupplement = intendedType === null || intendedType === 'supplement';

  // Try undoing the most recent meal log
  const { data: lastMeal, error: lastMealErr } = wantMeal ? await supabaseAdmin
    .from('meal_logs')
    .select('id, raw_input, meal_type, logged_at')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle() : { data: null, error: null };
  if (lastMealErr) console.error('[handleUndo] meal_logs fetch failed', lastMealErr);

  const { data: lastWorkout, error: lastWorkoutErr } = wantWorkout ? await supabaseAdmin
    .from('workout_logs')
    .select('id, raw_input, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle() : { data: null, error: null };
  if (lastWorkoutErr) console.error('[handleUndo] workout_logs fetch failed', lastWorkoutErr);

  const { data: lastSupplement, error: lastSupplementErr } = wantSupplement ? await supabaseAdmin
    .from('supplement_logs')
    .select('id, supplement_name, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(1)
    .maybeSingle() : { data: null, error: null };
  if (lastSupplementErr) console.error('[handleUndo] supplement_logs fetch failed', lastSupplementErr);

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
    // Intent-specific "nothing found" wording when the user named a type.
    const typeLabel = intendedType === 'meal' ? 'öğün' : intendedType === 'workout' ? 'antrenman' : intendedType === 'supplement' ? 'takviye' : null;
    return {
      handled: true,
      // FIX (final sweep): aksansız → proper Turkish (matches the accented success string below).
      response: typeLabel ? `Geri alınacak bir ${typeLabel} kaydı bulunamadı.` : 'Geri alınacak bir kayıt bulunamadı.',
      undoneAction: null,
      shouldContinueNormal: false,
    };
  }

  // Sort by most recent
  candidates.sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
  const target = candidates[0];

  // Soft delete based on type
  let mutationError: unknown = null;
  switch (target.type) {
    case 'meal': {
      const { error } = await supabaseAdmin
        .from('meal_logs')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', target.id);
      mutationError = error;
      break;
    }
    case 'workout': {
      const { error } = await supabaseAdmin
        .from('workout_logs')
        .delete()
        .eq('id', target.id);
      mutationError = error;
      break;
    }
    case 'supplement': {
      const { error } = await supabaseAdmin
        .from('supplement_logs')
        .delete()
        .eq('id', target.id);
      mutationError = error;
      break;
    }
  }

  // If the destructive mutation failed, do not claim success.
  if (mutationError) {
    console.error('[handleUndo] undo failed', mutationError);
    return {
      handled: true,
      response: 'Kaydı geri alırken bir sorun oluştu, tekrar dener misin?',
      undoneAction: null,
      shouldContinueNormal: false,
    };
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
export interface RevertedWrite {
  type: UndoTargetType;
  label: string;
}

/**
 * Koçun BİR ÖNCEKİ turunda yazdığı kaydı bul ve geri al.
 *
 * Neden gerekti: `buildCorrectionContext` modele "Eski yanlis kaydi otomatik sil
 * (is_deleted=true)" diyordu, oysa system-prompt modele hiçbir kaydı silemeyeceğini
 * söylüyor ve kod tarafında da correction dalında TEK BİR yazım bile geri alınmıyordu.
 * Sonuç: kullanıcı "yanlış anladın" deyince koç "düzeltiyorum" diyordu ama yanlış öğün
 * panoda ve günün toplamında aynen duruyordu. Sözü tutan taraf yoktu; artık var.
 *
 * Hedefi nasıl buluyoruz (yeni kolon/migration gerektirmeden): son ASİSTAN mesajının
 * zamanı bir çıpa. Turun yazımları o mesaj KAYDEDİLMEDEN hemen önce yapılır, yani
 * [çıpa − 3 dk, çıpa + 30 sn] penceresine düşerler. O pencerede yazılmış en yeni
 * öğün/antrenman/takviye kaydı = "koçun az önce yazdığı şey".
 *
 * Hiçbir şey bulunamazsa null döner ve HİÇBİR ŞEY SİLİNMEZ — düzeltme kaydı olmayan
 * bir yanlış anlama da olabilir ("yanlış anladın, ben 35 yaşındayım"). Tahmin ederek
 * doğru bir öğünü silmektense hiçbir şey silmemek doğrudur.
 */
export async function revertLastTurnWrite(
  userId: string,
  sessionId?: string | null,
): Promise<RevertedWrite | null> {
  let anchorQuery = supabaseAdmin
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1);
  if (sessionId) anchorQuery = anchorQuery.eq('session_id', sessionId);

  const { data: anchorRows, error: anchorErr } = await anchorQuery;
  if (anchorErr) { console.error('[revertLastTurnWrite] anchor fetch failed', anchorErr); return null; }
  const anchorAt = (anchorRows as { created_at: string }[] | null)?.[0]?.created_at;
  if (!anchorAt) return null;

  const anchorMs = new Date(anchorAt).getTime();
  if (!Number.isFinite(anchorMs)) return null;
  // Bayat çıpa koruması: koçun EN SON turu günler öncesindeyse o kaydı "az önce yazdım"
  // sayıp silmek yanlış olur.
  if (Date.now() - anchorMs > 24 * 60 * 60 * 1000) return null;

  const from = new Date(anchorMs - 3 * 60 * 1000).toISOString();
  const to = new Date(anchorMs + 30 * 1000).toISOString();

  const [mealRes, workoutRes, supplementRes] = await Promise.all([
    supabaseAdmin.from('meal_logs')
      .select('id, raw_input, meal_type, logged_at')
      .eq('user_id', userId).eq('is_deleted', false)
      .gte('logged_at', from).lte('logged_at', to)
      .order('logged_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('workout_logs')
      .select('id, raw_input, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', from).lte('logged_at', to)
      .order('logged_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('supplement_logs')
      .select('id, supplement_name, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', from).lte('logged_at', to)
      .order('logged_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  type Cand = { id: string; logged_at: string; type: UndoTargetType; label: string };
  const candidates: Cand[] = [];
  const meal = mealRes.data as { id: string; raw_input: string; meal_type: string; logged_at: string } | null;
  if (meal) candidates.push({ id: meal.id, logged_at: meal.logged_at, type: 'meal', label: `${meal.meal_type}: ${meal.raw_input}` });
  const workout = workoutRes.data as { id: string; raw_input: string; logged_at: string } | null;
  if (workout) candidates.push({ id: workout.id, logged_at: workout.logged_at, type: 'workout', label: workout.raw_input });
  const supp = supplementRes.data as { id: string; supplement_name: string; logged_at: string } | null;
  if (supp) candidates.push({ id: supp.id, logged_at: supp.logged_at, type: 'supplement', label: supp.supplement_name });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
  const target = candidates[0];

  // Öğün SOFT delete (geri getirilebilir); diğer ikisinin soft-delete kolonu yok.
  let mutationError: unknown = null;
  if (target.type === 'meal') {
    const { error } = await supabaseAdmin.from('meal_logs')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', target.id);
    mutationError = error;
  } else {
    const { error } = await supabaseAdmin
      .from(target.type === 'workout' ? 'workout_logs' : 'supplement_logs')
      .delete().eq('id', target.id);
    mutationError = error;
  }

  // Silme başarısızsa "geri aldım" DEME — bu fonksiyonun tüm varlık sebebi tutulamayan
  // sözü ortadan kaldırmaktı; burada yalan söylersek aynı kusuru yeniden üretiriz.
  if (mutationError) {
    console.error('[revertLastTurnWrite] revert failed', mutationError);
    return null;
  }

  // Düzeltmeler de artık repair_history'ye düşüyor — "sık düzeltilen yiyecek" hafızası
  // (getRepairContext) eskiden yalnız undo'lardan besleniyordu, yani neredeyse hiç.
  await storeRepairEvent(userId, {
    repair_type: 'correction',
    original_input: target.label,
    corrected_input: null,
    food_item: target.type === 'meal' ? target.label : null,
  });

  return { type: target.type, label: target.label };
}

/**
 * "yanlış anladın" turunda modele verilecek bağlam. `reverted`, revertLastTurnWrite'ın
 * GERÇEKTEN yaptığı iştir — burada artık yalnızca olan biteni anlatıyoruz, yapılmayan
 * bir şeyi modelden talep etmiyoruz.
 */
export function buildCorrectionContext(reverted: RevertedWrite | null): string {
  const typeLabel = reverted?.type === 'meal' ? 'ogun' : reverted?.type === 'workout' ? 'antrenman' : 'takviye';
  if (reverted) {
    return `KULLANICI SON ANLADIGINI DUZELTIYOR.
Sunu ZATEN GERI ALDIM (sistem yapti, sen bir sey silmedin): ${typeLabel} — "${reverted.label}"
1. Once kisaca bunu geri aldigini SOYLE (ornek: "${reverted.label} kaydini geri aldim").
2. Kullanicinin duzeltmesi net degilse TEK bir soru sor.
3. Net ise DUZELTILMIS halini yeniden kaydet (normal aksiyonlarla).
4. Ayni kaydi tekrar silmeye calisma — geri alma islemi bitti.`;
  }
  return `KULLANICI SON ANLADIGINI DUZELTIYOR.
Geri alinacak TAZE bir kayit BULAMADIM — son turda kalici bir kayit yazilmamis olabilir,
ya da kullanici bir kaydi degil bir BILGIYI duzeltiyor (yas, alerji, hedef gibi).
1. Hicbir kaydi "sildim" DEME — silinmedi.
2. Neyi yanlis anladigini TEK bir soruyla netlestir.
3. Duzeltilmis bilgiyi normal akista kaydet.`;
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
  // Map camelCase/snake_case field names to the actual migration-010 schema
  await supabaseAdmin.from('repair_history').insert({
    user_id: userId,
    repair_type: event.repair_type,
    original_text: event.original_input,
    corrected_text: event.corrected_input,
    food_name: event.food_item,
  });
}

// ─── Repair History for Context ───

/**
 * Get repair statistics to include in AI context.
 * Helps AI know which foods it frequently gets wrong.
 */
export async function getRepairContext(userId: string): Promise<string> {
  // Last 30 days window keeps memory fresh without dragging old one-offs
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: repairs } = await supabaseAdmin
    .from('repair_history')
    .select('food_name, repair_type, original_text, corrected_text, created_at')
    .eq('user_id', userId)
    .gte('created_at', monthAgo)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!repairs || repairs.length === 0) return '';

  type RepairRow = { food_name: string | null; repair_type: string; original_text: string | null; corrected_text: string | null };
  const rows = repairs as RepairRow[];

  const foodCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.food_name) {
      const key = r.food_name.toLocaleLowerCase('tr').trim();
      foodCounts[key] = (foodCounts[key] ?? 0) + 1;
    }
  }

  const frequent = Object.entries(foodCounts)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (frequent.length === 0) return '';

  return `## DUZELTME GECMISI (son 30 gun)\nBu yiyecekleri user sik duzeltmis — tahminlerini ona gore ayarla: ${frequent.map(([food, count]) => `${food} (${count}x)`).join(', ')}\nBu yiyecekler icin daha cok soru sor veya onceki duzeltme degerlerini kullan.`;
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
// FIX (audit AI-SYS-03): emit VALID JSON in the <layer2_update> block — matching
// system-prompt.ts:311-313 and the extractLayer2Updates JSON.parse in ai-chat
// index.ts:2471-2477. The old form (literal `user_persona: [tespit edilen persona]`)
// is not JSON, so JSON.parse threw and the persona update was silently dropped.
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

Tespit ettiginde mesajin SONUNA su blogu ekle (gecerli JSON, ekstractor JSON.parse eder):
<layer2_update>{"user_persona": "disiplinli|motivasyon_bagimlisi|minimalist|veri_odakli|sosyal_yiyici|stres_yiyici"}</layer2_update>`;
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
      // FIX (AI-behaviour #4): the old exemplar literally prescribed a banned cliché ("Harika
      // gidiyorsun!"), teaching the exact filler voice the SES section forbids. Motivation must be
      // SPECIFIC — name the thing that went well, don't cheer generically.
      motivational: 'Motive edici ol ama SPESIFIK ol: neyin iyi gittigini ADIYLA soyle ("uc gun ust uste kayit girdin"). Genel tezahurat ("harika gidiyorsun", "bravo") YASAK.',
      strict: 'Net ve dogrudan ol. Gereksiz ovgu yapma. Hedeflere odaklan.',
      balanced: 'Dengeli bir ton kullan: hem destekleyici hem net, asiriya kacma.',
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
  // #R3: the Layer-2 ai_summary row is built asynchronously (merge/cron), so a fully
  // onboarded user often has none yet — the old early-return then claimed "I don't know
  // you" despite a complete structured profile. Always load + prepend the structured
  // baseline (profile, active goal, ongoing health events).
  const [{ data: summary }, { data: profile }, { data: goalRows }, { data: ongoing }] = await Promise.all([
    supabaseAdmin.from('ai_summary').select('*').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('profiles').select('weight_kg, height_cm, birth_year, gender, activity_level').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('goals').select('goal_type, target_weight_kg').eq('user_id', userId).eq('is_active', true).limit(1),
    supabaseAdmin.from('health_events').select('description').eq('user_id', userId).eq('is_ongoing', true).limit(5),
  ]);

  const parts: string[] = ['Seni su sekilde taniyorum:\n'];
  if (profile) {
    const p = profile as Record<string, unknown>;
    const bits: string[] = [];
    if (p.birth_year) bits.push(`${new Date().getFullYear() - (p.birth_year as number)} yas`);
    if (p.gender) bits.push(p.gender === 'male' ? 'erkek' : p.gender === 'female' ? 'kadin' : String(p.gender));
    if (p.height_cm) bits.push(`boy ${p.height_cm} cm`);
    if (p.weight_kg) bits.push(`${p.weight_kg} kg`);
    if (p.activity_level) bits.push(`aktivite: ${p.activity_level}`);
    if (bits.length) parts.push(`**Profil:** ${bits.join(', ')}`);
  }
  const g = (goalRows as Record<string, unknown>[] | null)?.[0];
  if (g?.goal_type) parts.push(`**Hedef:** ${g.goal_type}${g.target_weight_kg ? ` (hedef ${g.target_weight_kg} kg)` : ''}`);
  const inj = (ongoing as { description: string }[] | null) ?? [];
  if (inj.length > 0) parts.push(`**Saglik/sakatlik:** ${inj.map(x => x.description).join('; ')}`);

  if (!summary) {
    if (parts.length === 1) return 'Henuz seni tanimiyorum — konustukca ogrenecegim!';
    parts.push('\n(Konustukca seni daha iyi taniyacagim.)');
    return parts.join('\n');
  }

  const s = summary as Record<string, unknown>;

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

  const habits = s.habit_progress as { habit: string; status: string; streak: number }[] | null;
  if (habits && habits.length > 0) {
    parts.push(`\n**Aliskanlik takibi:**`);
    for (const h of habits) {
      parts.push(`- ${h.habit}: ${h.status}`); // adversarial: stored streak is stale — derived block owns the number
    }
  }

  const strength = s.strength_records as Record<string, { last_weight: number; last_reps: number }> | null;
  if (strength && Object.keys(strength).length > 0) {
    parts.push(`\n**Guc kayitlari:** ${Object.entries(strength).map(([k, v]) => `${k}: ${v.last_weight}kg x${v.last_reps}`).join(', ')}`);
  }

  parts.push('\n_Yanlis ogrendigim bir sey varsa soyle, hemen duzelteyim._');

  return parts.join('\n');
}

// Pattern confidence evolution lives in shared/memory.ts (single source of truth).
// Re-exported here for backward compat if any call site still references it.
export { evolvePatternConfidence } from './memory.ts';
