/**
 * KOCHKO AI CHAT - Main Edge Function
 * Spec Sections: 5.1-5.33
 *
 * Flow:
 * 1. Auth + rate limit check
 * 2. Detect task mode from message
 * 3. Build 4-layer context
 * 4. Generate response (text or vision)
 * 5. Guardrail validation
 * 6. Extract + execute actions
 * 7. Extract Layer 2 updates (async)
 * 8. Store conversation
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion, buildVisionContent, TEMPERATURE, MODELS } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { buildFullContext, updateLayer2 } from '../shared/memory.ts';
import { sanitizeText, detectEmergency, checkAllergens, sanitizeUserInput } from '../shared/guardrails.ts';
import { validateMealParse } from '../shared/output-validator.ts';
import { checkRateLimit } from '../shared/rate-limit.ts';
import { BASE_SYSTEM_PROMPT } from './system-prompt.ts';
import { detectTaskMode, getModeInstructions } from './task-modes.ts';

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { message, image_base64 } = await req.json();

    if (!message?.trim() && !image_base64) {
      return respond({ error: 'message or image required' }, 400);
    }

    // Prompt injection detection (Spec 5.26)
    let injectionDetected = false;
    if (message) {
      const injection = sanitizeUserInput(message);
      injectionDetected = injection.injectionDetected;
      if (injectionDetected) {
        const rejectMsg = 'Ben Kochko, beslenme ve antrenman kocunum. Bu konuda sana yardimci olamam ama beslenme veya sporla ilgili sorun varsa konusalim.';
        await storeMessages(userId, message, rejectMsg);
        return respond({ message: rejectMsg, actions: [], task_mode: 'coaching' });
      }
    }

    // Rate limiting (Spec 16.4)
    const taskMode = message ? detectTaskMode(message, false) : 'coaching';
    const isRecordParse = taskMode === 'register';
    const rateLimit = await checkRateLimit(userId, isRecordParse);
    if (!rateLimit.allowed) {
      return respond({ error: rateLimit.message, rate_limited: true }, 429);
    }

    // Emergency detection (Spec 5.5)
    if (message) {
      const emergency = detectEmergency(message);
      if (emergency.isEmergency) {
        await storeMessages(userId, message, emergency.message);
        return respond({ message: emergency.message, actions: [], task_mode: 'emergency' });
      }
    }

    // Check onboarding status
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('onboarding_completed, gender')
      .eq('id', userId).single();
    const isOnboarding = !profile?.onboarding_completed;

    // Detect task mode (Spec 5.2)
    const taskMode = detectTaskMode(message ?? '', isOnboarding);

    // Build 4-layer context (Spec 5.1)
    const ctx = await buildFullContext(userId);

    // Assemble system prompt = base + mode instructions
    const modeInstructions = getModeInstructions(taskMode);
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${modeInstructions}\n\n--- KULLANICI HAKKINDA ---\n\n${ctx.layer1}\n\n--- AI OZETI ---\n\n${ctx.layer2}\n\n--- SON VERILER ---\n\n${ctx.layer3}`;

    // Build messages array
    const gptMessages: { role: string; content: string | unknown[] }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add chat history (Layer 4)
    for (const msg of ctx.layer4) {
      gptMessages.push({ role: msg.role, content: msg.content });
    }

    // Add current message
    if (image_base64) {
      gptMessages.push({
        role: 'user',
        content: buildVisionContent(message ?? 'Bu fotodaki yemekleri analiz et.', image_base64),
      });
    } else {
      gptMessages.push({ role: 'user', content: message });
    }

    // Call OpenAI (Spec 5.27: temperature by mode)
    const model = image_base64 ? MODELS.vision : MODELS.primary;
    const temperature = TEMPERATURE[taskMode] ?? 0.5;

    let assistantMessage = await chatCompletion<string>(
      gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[],
      { model, temperature, maxTokens: 2000 }
    );

    // Guardrail: sanitize medical language (Spec 12.3)
    const { clean } = sanitizeText(assistantMessage);
    assistantMessage = clean;

    // Extract actions
    const { cleanMessage, actions } = extractActions(assistantMessage);
    assistantMessage = cleanMessage;

    // Extract Layer 2 updates
    const { cleanMessage: finalMessage, layer2Updates } = extractLayer2Updates(assistantMessage);
    assistantMessage = finalMessage;

    // Execute actions
    const actionFeedback = await executeActions(userId, actions, profile?.gender);

    // Store messages with token count and model version (Spec 5.25)
    const tokenEstimate = Math.round((message?.length ?? 0) / 3.5) + Math.round(assistantMessage.length / 3.5);
    await storeMessages(userId, message ?? '[foto]', assistantMessage, taskMode, model, tokenEstimate, actions);

    // Async: update Layer 2 if needed
    if (layer2Updates) {
      processLayer2Updates(userId, layer2Updates).catch(() => {});
    }

    // Async: check onboarding completion
    if (isOnboarding && actions.some((a: { type: string }) => a.type === 'profile_update')) {
      checkOnboardingCompletion(userId).catch(() => {});
    }

    return respond({
      message: assistantMessage,
      actions: actions.map((a: { type: string }, i: number) => ({
        type: a.type,
        feedback: actionFeedback[i] ?? null,
      })),
      task_mode: taskMode,
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

// --- Helper Functions ---

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function extractActions(text: string): { cleanMessage: string; actions: Record<string, unknown>[] } {
  let actions: Record<string, unknown>[] = [];
  const match = text.match(/<actions>([\s\S]*?)<\/actions>/);
  if (match) {
    try { actions = JSON.parse(match[1]); } catch { /* ignore */ }
  }
  return { cleanMessage: text.replace(/<actions>[\s\S]*?<\/actions>/, '').trim(), actions };
}

function extractLayer2Updates(text: string): { cleanMessage: string; layer2Updates: Record<string, unknown> | null } {
  let updates: Record<string, unknown> | null = null;
  const match = text.match(/<layer2_update>([\s\S]*?)<\/layer2_update>/);
  if (match) {
    try { updates = JSON.parse(match[1]); } catch { /* ignore */ }
  }
  return { cleanMessage: text.replace(/<layer2_update>[\s\S]*?<\/layer2_update>/, '').trim(), layer2Updates: updates };
}

async function storeMessages(userId: string, userMsg: string, assistantMsg: string, taskMode?: string, modelUsed?: string, tokenCount?: number, executedActions?: Record<string, unknown>[]) {
  // Get or create active session
  let { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (!session) {
    const { data: newSession } = await supabaseAdmin
      .from('chat_sessions')
      .insert({ user_id: userId, is_active: true })
      .select('id')
      .single();
    session = newSession;
  }

  await supabaseAdmin.from('chat_messages').insert([
    { user_id: userId, session_id: session?.id, role: 'user', content: userMsg, task_mode: taskMode },
    {
      user_id: userId, session_id: session?.id, role: 'assistant', content: assistantMsg,
      task_mode: taskMode, model_version: modelUsed ?? null,
      token_count: tokenCount ?? null,
      actions_executed: executedActions?.length ? executedActions.map(a => ({ type: a.type })) : null,
    },
  ]);

  // Auto-generate session title after 4 messages (Spec 5.18)
  const { count } = await supabaseAdmin
    .from('chat_messages').select('*', { count: 'exact', head: true })
    .eq('session_id', session?.id);
  if (count && count === 4 && session?.id) {
    const title = assistantMsg.substring(0, 60).replace(/\n/g, ' ');
    await supabaseAdmin.from('chat_sessions')
      .update({ title })
      .eq('id', session.id);
  }
}

async function executeActions(
  userId: string,
  actions: Record<string, unknown>[],
  gender: string | null
): Promise<(string | null)[]> {
  const today = new Date().toISOString().split('T')[0];
  const feedback: (string | null)[] = [];

  // Get existing water for today
  const { data: todayMetrics } = await supabaseAdmin
    .from('daily_metrics').select('water_liters').eq('user_id', userId).eq('date', today).single();
  const existingWater = todayMetrics?.water_liters ?? 0;

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'meal_log': {
          const items = action.items as { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[] | undefined;
          const { data: log } = await supabaseAdmin.from('meal_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            meal_type: action.meal_type as string ?? 'snack',
            input_method: 'ai_chat', logged_for_date: today, synced: true,
          }).select('id').single();

          if (log && items?.length) {
            await supabaseAdmin.from('meal_log_items').insert(
              items.map(i => ({
                meal_log_id: log.id, food_name: i.name, portion_text: i.portion,
                calories: Math.max(0, Math.round(i.calories)),
                protein_g: Math.max(0, i.protein_g), carbs_g: Math.max(0, i.carbs_g),
                fat_g: Math.max(0, i.fat_g), data_source: 'ai_estimate',
              }))
            );
          }
          feedback.push('Ogun kaydedildi');
          break;
        }
        case 'workout_log': {
          await supabaseAdmin.from('workout_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            workout_type: action.workout_type as string ?? 'mixed',
            duration_min: (action.duration_min as number) ?? 0,
            intensity: action.intensity as string ?? 'moderate',
            calories_burned: (action.calories_burned as number) ?? 0,
            logged_for_date: today, synced: true,
          });
          feedback.push('Antrenman kaydedildi');
          break;
        }
        case 'weight_log': {
          const w = action.value as number;
          if (w > 20 && w < 300) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, weight_kg: w, water_liters: existingWater, synced: true },
              { onConflict: 'user_id,date' }
            );
            await supabaseAdmin.from('profiles').update({ weight_kg: w, updated_at: new Date().toISOString() }).eq('id', userId);
            feedback.push('Tarti kaydedildi');
          }
          break;
        }
        case 'water_log': {
          const l = action.liters as number;
          if (l > 0) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, water_liters: existingWater + l, synced: true },
              { onConflict: 'user_id,date' }
            );
            feedback.push(`Su +${l}L`);
          }
          break;
        }
        case 'sleep_log': {
          const h = action.hours as number;
          if (h > 0 && h < 24) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, sleep_hours: h, sleep_quality: action.quality as string, water_liters: existingWater, synced: true },
              { onConflict: 'user_id,date' }
            );
            feedback.push('Uyku kaydedildi');
          }
          break;
        }
        case 'mood_log': {
          await supabaseAdmin.from('daily_metrics').upsert(
            { user_id: userId, date: today, mood_score: action.score as number, mood_note: action.note as string, water_liters: existingWater, synced: true },
            { onConflict: 'user_id,date' }
          );
          feedback.push('Ruh hali kaydedildi');
          break;
        }
        case 'supplement_log': {
          await supabaseAdmin.from('supplement_logs').insert({
            user_id: userId, supplement_name: action.name as string,
            amount: action.amount as string, logged_for_date: today,
          });
          feedback.push('Supplement kaydedildi');
          break;
        }
        case 'commitment': {
          const followUp = new Date();
          followUp.setDate(followUp.getDate() + ((action.follow_up_days as number) ?? 1));
          await supabaseAdmin.from('user_commitments').insert({
            user_id: userId, commitment: action.text as string,
            follow_up_at: followUp.toISOString(), status: 'pending',
          });
          feedback.push('Taahhut kaydedildi');
          break;
        }
        case 'profile_update': {
          const updates: Record<string, unknown> = {};
          if (action.height_cm) updates.height_cm = action.height_cm;
          if (action.weight_kg) updates.weight_kg = action.weight_kg;
          if (action.birth_year) updates.birth_year = action.birth_year;
          if (action.gender) updates.gender = action.gender;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabaseAdmin.from('profiles').update(updates).eq('id', userId);
            feedback.push('Profil guncellendi');
          }
          if (action.target_weight_kg) {
            await supabaseAdmin.from('goals').insert({
              user_id: userId, goal_type: (action.goal_type as string) ?? 'lose_weight',
              target_weight_kg: action.target_weight_kg as number,
              target_weeks: 12, priority: 'sustainable', restriction_mode: 'sustainable',
              weekly_rate: 0.5, is_active: true,
            });
            feedback.push('Hedef belirlendi');
          }
          break;
        }
        case 'undo_last': {
          // Spec 5.32: Undo last action - find and reverse most recent log
          const undoType = action.undo_type as string ?? 'meal';
          if (undoType === 'meal') {
            const { data: lastMeal } = await supabaseAdmin.from('meal_logs')
              .select('id').eq('user_id', userId).eq('is_deleted', false)
              .order('logged_at', { ascending: false }).limit(1).single();
            if (lastMeal) {
              await supabaseAdmin.from('meal_logs').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', lastMeal.id);
              feedback.push('Son ogun kaydi silindi');
            }
          } else if (undoType === 'workout') {
            const { data: lastWorkout } = await supabaseAdmin.from('workout_logs')
              .select('id').eq('user_id', userId)
              .order('logged_at', { ascending: false }).limit(1).single();
            if (lastWorkout) {
              await supabaseAdmin.from('workout_logs').delete().eq('id', lastWorkout.id);
              feedback.push('Son antrenman kaydi silindi');
            }
          } else if (undoType === 'supplement') {
            const { data: lastSupp } = await supabaseAdmin.from('supplement_logs')
              .select('id').eq('user_id', userId)
              .order('logged_at', { ascending: false }).limit(1).single();
            if (lastSupp) {
              await supabaseAdmin.from('supplement_logs').delete().eq('id', lastSupp.id);
              feedback.push('Son supplement kaydi silindi');
            }
          }
          break;
        }
        case 'venue_log': {
          await supabaseAdmin.from('user_venues').upsert({
            user_id: userId, venue_name: action.venue_name as string,
            learned_items: action.items,
          }, { onConflict: 'user_id,venue_name' });
          feedback.push('Mekan kaydedildi');
          break;
        }
        default:
          feedback.push(null);
      }
    } catch {
      feedback.push(null);
    }
  }

  return feedback;
}

async function processLayer2Updates(userId: string, updates: Record<string, unknown>) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('ai_summary').select('general_summary, behavioral_patterns, portion_calibration, strength_records, coaching_notes')
      .eq('user_id', userId).single();

    const changes: Record<string, unknown> = {};

    if (updates.general_summary_append) {
      const current = (existing?.general_summary as string) ?? '';
      changes.general_summary = current + '\n' + updates.general_summary_append;
    }

    if (updates.new_pattern) {
      const patterns = (existing?.behavioral_patterns as unknown[]) ?? [];
      patterns.push({ ...(updates.new_pattern as Record<string, unknown>), detected_at: new Date().toISOString() });
      changes.behavioral_patterns = patterns;
    }

    if (updates.portion_update) {
      const pu = updates.portion_update as { food: string; user_portion_grams: number };
      const cal = (existing?.portion_calibration as Record<string, unknown>) ?? {};
      cal[pu.food] = pu.user_portion_grams;
      changes.portion_calibration = cal;
    }

    if (updates.strength_update) {
      const su = updates.strength_update as { exercise: string; weight_kg: number; reps: number };
      const records = (existing?.strength_records as Record<string, unknown>) ?? {};
      records[su.exercise] = { last_weight: su.weight_kg, last_reps: su.reps };
      changes.strength_records = records;
    }

    if (updates.coaching_note) {
      const current = (existing?.coaching_notes as string) ?? '';
      changes.coaching_notes = current + '\n' + updates.coaching_note;
    }

    if (Object.keys(changes).length > 0) {
      await updateLayer2(userId, changes);
    }
  } catch { /* non-critical */ }
}

async function checkOnboardingCompletion(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('height_cm, weight_kg, birth_year, gender, onboarding_completed')
    .eq('id', userId).single();

  if (data && !data.onboarding_completed && data.height_cm && data.weight_kg && data.birth_year && data.gender) {
    await supabaseAdmin.from('profiles')
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq('id', userId);
  }
}
