/**
 * KOCHKO AI EXTRACTOR — Checkpoint-based data extraction from chat history
 *
 * Runs as a cron job (daily for Tier 2, weekly for Tier 3).
 * Uses GPT-4o-mini to extract structured user data from conversation history.
 * Writes extracted data to profiles table and updates checkpoint.
 *
 * Trigger: Cron schedule or manual invocation
 * Input: { tier: 2 | 3, user_id?: string (optional, for single user) }
 * Output: { processed: number, extracted: number }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';
import { evolvePatternConfidence, inferTonePreference, refreshCorrectionMemory, detectSnackingHours, calibrateActivityMultiplier, analyzeLateMealSleep } from '../shared/memory.ts';
import { denyIfNotCron } from '../shared/cron-auth.ts';

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
// Same provider-config knob as shared/openai.ts — point at any OpenAI-compatible
// endpoint via the OPENAI_BASE_URL secret (defaults to OpenAI).
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
// FIX (audit AI-MDL-01): route the extractor's model through KOCHKO_MODEL_FAST so a backend
// swap (OPENAI_BASE_URL → OpenRouter/Azure/self-host) doesn't leave this cron pinned to the
// literal 'gpt-4o-mini' (a model name the gateway may not recognize → 404/400). Defaults to the
// previous literal on OpenAI.
const EXTRACTOR_MODEL = Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-4o-mini';

// FIX (audit AI-MDL-02): hard timeout on the extraction fetch. Without it a hung upstream
// (custom gateway stall) blocks the whole cron run until the edge wall-clock kills it. 45s is
// well above p99; on timeout we skip this user (the checkpoint is not advanced) so the next run
// retries cleanly instead of leaving an indefinite hang.
const EXTRACTOR_TIMEOUT_MS = 45_000;
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = EXTRACTOR_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const TIER2_FIELDS = [
  'occupation', 'work_start', 'work_end', 'sleep_time', 'wake_time', 'sleep_quality',
  'meal_count_preference', 'cooking_skill', 'budget_level', 'dietary_restriction',
  'eating_out_frequency', 'stress_level', 'stress_sources', 'motivation_source',
  'biggest_challenge', 'digestive_issues', 'hormone_conditions', 'activity_level',
  'training_experience', 'equipment_access',
];

const TIER3_FIELDS = [
  'previous_diets', 'exercise_history', 'preferred_exercises', 'disliked_exercises',
  'available_training_times', 'fastfood_frequency', 'skipped_meals', 'night_eating_habit',
  'emotional_eating', 'snacking_habit', 'caffeine_intake', 'meal_prep_time',
  'kitchen_equipment', 'household_cooking', 'household_diet_challenge',
];

// Enum-constrained profile columns: the model used to emit free Turkish text
// ("stress_level":"yüksek") which either sat silently in CHECK-less columns or
// 23514-failed the whole batch. Allowed values go INTO the prompt and a
// whitelist normalizes/drops on the way out.
const FIELD_ENUMS: Record<string, string[]> = {
  sleep_quality: ['good', 'ok', 'bad'],
  cooking_skill: ['none', 'basic', 'good'],
  budget_level: ['low', 'medium', 'high'],
  dietary_restriction: ['vegan', 'vegetarian', 'pescatarian', 'halal', 'kosher', 'gluten_free', 'lactose_free'],
  eating_out_frequency: ['never', 'rare', 'weekly', 'frequent'],
  fastfood_frequency: ['never', 'rare', 'weekly', 'frequent'],
  stress_level: ['low', 'moderate', 'high'],
  activity_level: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  training_experience: ['none', 'beginner', 'intermediate', 'advanced'],
  equipment_access: ['home', 'gym', 'both'],
  caffeine_intake: ['none', 'low', 'moderate', 'high'],
  meal_prep_time: ['short', 'medium', 'long'],
  household_cooking: ['self', 'partner', 'parent', 'shared'],
};

const TR_ENUM_ALIASES: Record<string, string[]> = {
  high: ['yüksek', 'yuksek', 'çok', 'cok'],
  moderate: ['orta', 'normal'],
  medium: ['orta', 'normal'],
  low: ['düşük', 'dusuk', 'az', 'hafif'],
  good: ['iyi'],
  bad: ['kötü', 'kotu'],
  ok: ['orta', 'idare eder'],
  home: ['ev', 'evde'],
  gym: ['salon', 'spor salonu'],
  lactose_free: ['laktoz intoleransı', 'laktoz intoleransi', 'laktozsuz'],
  gluten_free: ['glutensiz', 'çölyak', 'colyak'],
};

function normalizeEnumValue(field: string, value: unknown): unknown {
  const enums = FIELD_ENUMS[field];
  if (!enums || typeof value !== 'string') return value;
  const v = value.toLocaleLowerCase('tr').trim();
  if (enums.includes(v)) return v;
  for (const e of enums) {
    if ((TR_ENUM_ALIASES[e] ?? []).includes(v)) return e;
  }
  return null; // unmappable → drop the field rather than persist junk
}

// FIX (audit AI-EXT-03): non-enum typed columns. work_*/sleep_time/wake_time are
// Postgres TIME, meal_count_preference is SMALLINT. These have no FIELD_ENUMS
// entry, so a model emitting "sabah 9" or "3 öğün" reaches the UPDATE raw and
// 22P02-fails the WHOLE batch — and because the checkpoint never advances on
// error, that user's Tier-2 extraction sticks forever. Coerce/validate here and
// drop the single bad field instead, letting the rest of the batch persist.
const TIME_FIELDS = new Set(['work_start', 'work_end', 'sleep_time', 'wake_time']);

// Accept HH:MM or H:MM (optionally with :SS) and zero-pad to HH:MM:SS; anything
// else (free text like "sabah 9", "akşam") returns null and is dropped.
function coerceTimeValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] !== undefined ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

// meal_count_preference is SMALLINT; clamp the model's value to a sane 1-8 range.
// Returns null for non-numeric / out-of-range so the field is dropped.
function coerceMealCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 8) return null;
  return n;
}

const EXTRACTION_PROMPT = (fields: string[], messages: string) => `
Aşağıdaki sohbet mesajlarından kullanıcı hakkında şu bilgileri çıkars.
Sadece AÇIKÇA belirtilen bilgileri çıkars. Tahmin YAPMA.
Bilgi yoksa null döndür.

Çıkarsanacak alanlar (parantezdeki değer listesi varsa SADECE o değerlerden birini kullan):
${fields.map(f => `- ${f}${FIELD_ENUMS[f] ? ` (SADECE: ${FIELD_ENUMS[f].join('|')})` : ''}`).join('\n')}

Liste tipi alanlar (örn. kitchen_equipment) için DAİMA virgülle ayrılmış tek bir metin
döndür (örn. "air fryer, mikrodalga"); ASLA dizi (array) verme.

Saat alanları (work_start, work_end, sleep_time, wake_time) için DAİMA 24 saat
biçiminde "HH:MM" döndür (örn. "09:00", "23:30"); "sabah 9" gibi metin verme.
meal_count_preference için SADECE 1-8 arası bir tam sayı döndür (örn. 3); "3 öğün"
gibi metin verme.

Ek olarak "_summary_update" anahtarı döndür: bu sohbetten kullanıcı hakkında
öğrendiğin ÖNEMLİ ve KALICI şeyleri 1-2 cümleyle özetle (davranış kalıbı,
yaşam koşulu, tercih). Kayda değer yeni bilgi yoksa null.

Sohbet:
${messages}

JSON döndür (sadece non-null değerler):
`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const denied = denyIfNotCron(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const tier = (body.tier as number) ?? 2;
    const singleUserId = body.user_id as string | undefined;
    const fields = tier === 3 ? TIER3_FIELDS : TIER2_FIELDS;
    const checkpointKey = tier === 3 ? 'tier3_last' : 'tier2_last';

    // Get users to process
    let userIds: string[];
    if (singleUserId) {
      userIds = [singleUserId];
    } else {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('onboarding_completed', true)
        .limit(100);
      userIds = (profiles ?? []).map(p => p.id);
    }

    let totalProcessed = 0;
    let totalExtracted = 0;

    for (const userId of userIds) {
      // 1. Get checkpoint
      const { data: summary } = await supabaseAdmin
        .from('ai_summary')
        .select('extraction_checkpoint')
        .eq('user_id', userId)
        .maybeSingle();

      const checkpoint = (summary?.extraction_checkpoint as Record<string, string>) ?? {};
      const lastChecked = checkpoint[checkpointKey];

      // 2. Fetch messages since last checkpoint
      let query = supabaseAdmin
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (lastChecked) {
        query = query.gt('created_at', lastChecked);
      }

      const { data: messages } = await query;
      if (!messages || messages.length === 0) continue;

      totalProcessed++;

      // 3. Format messages for extraction
      const messagesText = messages
        .map(m => `[${m.role}]: ${(m.content as string).substring(0, 500)}`)
        .join('\n');

      // 4. Call the fast model for extraction (env-driven + timeout-wrapped)
      let openaiRes: Response;
      try {
        openaiRes = await fetchWithTimeout(`${OPENAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: EXTRACTOR_MODEL,
            temperature: 0.1,
            max_tokens: 1000,
            messages: [
              { role: 'system', content: 'Sen bir veri çıkarsama asistanısın. Sohbet metinlerinden yapılandırılmış veri çıkarsıyorsun. Sadece JSON döndür.' },
              { role: 'user', content: EXTRACTION_PROMPT(fields, messagesText) },
            ],
          }),
        });
      } catch (fetchErr) {
        // Timeout/abort or network error — skip this user without advancing the checkpoint
        // so the next cron run retries the same window.
        console.error(`[Extractor] OpenAI fetch failed for ${userId}:`, (fetchErr as Error).message);
        continue;
      }

      if (!openaiRes.ok) continue;

      const openaiData = await openaiRes.json() as { choices?: { message?: { content?: string } }[] };
      const content = openaiData.choices?.[0]?.message?.content ?? '{}';

      // 5. Parse extracted data
      let extracted: Record<string, unknown> = {};
      try {
        // Handle potential markdown code blocks
        const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        // FIX (audit AI-EXT-02/HIGH): the model can return literal `null` (the prompt invites
        // "sadece JSON" with all-null fields) or a non-object. JSON.parse accepts those, then
        // Object.entries(null) below threw OUTSIDE this try → crashed the ENTIRE cron batch and
        // skipped every remaining user. Coerce anything that isn't a plain object to {} so it
        // flows to the "no data extracted" branch and just advances the checkpoint.
        extracted = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        continue; // Skip if parse fails
      }

      // Remove null values
      const nonNull = Object.fromEntries(
        Object.entries(extracted).filter(([, v]) => v !== null && v !== undefined && v !== '')
      );

      if (Object.keys(nonNull).length === 0) {
        // No data extracted, just update checkpoint
        await updateCheckpoint(userId, checkpointKey, messages[messages.length - 1].created_at as string);
        continue;
      }

      totalExtracted++;

      // 6. Write to profile (enum-normalized; unmappable enum values dropped)
      const profileFields = fields.filter(f => TIER2_FIELDS.includes(f) || TIER3_FIELDS.includes(f));
      const profileUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(nonNull)) {
        if (!profileFields.includes(key)) continue;

        // FIX (audit AI-EXT-03): validate non-enum typed columns BEFORE the UPDATE so a
        // single malformed TIME / SMALLINT value can't 22P02 the whole batch (which would
        // block the checkpoint and freeze this user's extraction forever). Drop on failure.
        if (TIME_FIELDS.has(key)) {
          const t = coerceTimeValue(value);
          if (t === null) {
            console.warn(`[Extractor] dropped unparseable time ${key}=${value} for ${userId}`);
            continue;
          }
          profileUpdates[key] = t;
          continue;
        }
        if (key === 'meal_count_preference') {
          const n = coerceMealCount(value);
          if (n === null) {
            console.warn(`[Extractor] dropped invalid meal_count_preference=${value} for ${userId}`);
            continue;
          }
          profileUpdates[key] = n;
          continue;
        }

        const normalized = normalizeEnumValue(key, value);
        if (normalized === null) {
          console.warn(`[Extractor] dropped unmappable enum value ${key}=${value} for ${userId}`);
          continue;
        }
        // Free-text profile columns (kitchen_equipment, etc.) are TEXT, not arrays. The
        // LLM sometimes returns a JSON array; coerce to comma-separated text so it matches
        // the ai-chat contract and the column type (#R1-L3).
        profileUpdates[key] = Array.isArray(normalized)
          ? (normalized as unknown[]).filter(Boolean).join(', ')
          : normalized;
      }

      if (Object.keys(profileUpdates).length > 0) {
        profileUpdates.updated_at = new Date().toISOString();
        const { error: updateErr } = await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);
        if (updateErr) {
          // A single bad-typed / CHECK-violating field (e.g. activity_level:"orta")
          // fails the whole UPDATE. Do NOT advance the checkpoint, so this batch is
          // retried on the next run instead of being silently dropped forever.
          console.error(`[Extractor] Profile update failed for ${userId}, checkpoint not advanced:`, updateErr.message);
          continue;
        }
      }

      // 6b. L4→L2: merge the extraction call's summary line into ai_summary.
      // Previously the ONLY L2 writer was the model's inline <layer2_update>
      // (which it rarely emits), so general_summary went stale forever.
      const summaryUpdate = nonNull._summary_update;
      if (typeof summaryUpdate === 'string' && summaryUpdate.trim().length > 10) {
        try {
          const { data: curSummary } = await supabaseAdmin
            .from('ai_summary').select('general_summary').eq('user_id', userId).maybeSingle();
          const cur = (curSummary?.general_summary as string) ?? '';
          const dateTag = new Date().toISOString().split('T')[0];
          let next = `${cur}\n[${dateTag}] ${summaryUpdate.trim()}`.trim();
          // Keep the summary bounded: oldest lines fall off past ~3000 chars.
          if (next.length > 3000) next = next.slice(next.length - 3000);
          await supabaseAdmin.from('ai_summary').upsert(
            { user_id: userId, general_summary: next, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' },
          );
        } catch (e) {
          console.error(`[Extractor] summary merge failed for ${userId}:`, (e as Error).message);
        }
      }

      // 7. Update checkpoint
      await updateCheckpoint(userId, checkpointKey, messages[messages.length - 1].created_at as string);

      // 8. Evolve pattern confidence (daily, Tier 2 only)
      if (tier === 2) {
        await evolvePatternConfidence(userId).catch((err: Error) =>
          console.error(`[Extractor] Pattern confidence evolution failed for ${userId}:`, err.message)
        );
      }

      // 9. Infer tone preference from implicit signals (Spec 5.9, weekly Tier 3)
      if (tier === 3) {
        await inferTonePreference(userId).catch((err: Error) =>
          console.error(`[Extractor] Tone inference failed for ${userId}:`, err.message)
        );

        // 10. Refresh correction memory (Spec 5.32, weekly Tier 3)
        await refreshCorrectionMemory(userId).catch((err: Error) =>
          console.error(`[Extractor] Correction memory refresh failed for ${userId}:`, err.message)
        );

        // 11. Detect peak snacking hours for preemptive nudges (Spec 14.2)
        await detectSnackingHours(userId).catch((err: Error) =>
          console.error(`[Extractor] Snacking hours detection failed for ${userId}:`, err.message)
        );

        // 12. Calibrate declared vs observed activity level (Spec 2.4)
        await calibrateActivityMultiplier(userId).catch((err: Error) =>
          console.error(`[Extractor] Activity calibration failed for ${userId}:`, err.message)
        );

        // 13. Late-meal → sleep-quality correlation insight (Spec 14.2)
        await analyzeLateMealSleep(userId).catch((err: Error) =>
          console.error(`[Extractor] Late meal sleep analysis failed for ${userId}:`, err.message)
        );
      }
    }

    return new Response(JSON.stringify({
      processed: totalProcessed,
      extracted: totalExtracted,
      tier,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});

async function updateCheckpoint(userId: string, key: string, timestamp: string) {
  const { data: existing } = await supabaseAdmin
    .from('ai_summary')
    .select('extraction_checkpoint')
    .eq('user_id', userId)
    .maybeSingle();

  const checkpoint = (existing?.extraction_checkpoint as Record<string, string>) ?? {};
  checkpoint[key] = timestamp;

  if (existing) {
    await supabaseAdmin.from('ai_summary')
      .update({ extraction_checkpoint: checkpoint, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabaseAdmin.from('ai_summary')
      .insert({ user_id: userId, extraction_checkpoint: checkpoint });
  }
}
