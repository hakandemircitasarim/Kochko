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

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

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

const EXTRACTION_PROMPT = (fields: string[], messages: string) => `
Aşağıdaki sohbet mesajlarından kullanıcı hakkında şu bilgileri çıkars.
Sadece AÇIKÇA belirtilen bilgileri çıkars. Tahmin YAPMA.
Bilgi yoksa null döndür.

Çıkarsanacak alanlar:
${fields.map(f => `- ${f}`).join('\n')}

Sohbet:
${messages}

JSON döndür (sadece non-null değerler):
`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

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

      // 4. Call GPT-4o-mini for extraction
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 1000,
          messages: [
            { role: 'system', content: 'Sen bir veri çıkarsama asistanısın. Sohbet metinlerinden yapılandırılmış veri çıkarsıyorsun. Sadece JSON döndür.' },
            { role: 'user', content: EXTRACTION_PROMPT(fields, messagesText) },
          ],
        }),
      });

      if (!openaiRes.ok) continue;

      const openaiData = await openaiRes.json() as { choices?: { message?: { content?: string } }[] };
      const content = openaiData.choices?.[0]?.message?.content ?? '{}';

      // 5. Parse extracted data
      let extracted: Record<string, unknown> = {};
      try {
        // Handle potential markdown code blocks
        const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        extracted = JSON.parse(jsonStr);
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

      // 6. Write to profile
      const profileFields = fields.filter(f => TIER2_FIELDS.includes(f) || TIER3_FIELDS.includes(f));
      const profileUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(nonNull)) {
        if (profileFields.includes(key)) {
          profileUpdates[key] = value;
        }
      }

      if (Object.keys(profileUpdates).length > 0) {
        profileUpdates.updated_at = new Date().toISOString();
        await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);
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
