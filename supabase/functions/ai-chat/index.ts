/**
 * KOCHKO AI CHAT - Main Edge Function
 * The primary interaction point. Everything flows through here.
 *
 * Flow:
 * 1. Authenticate user
 * 2. Build rich context (profile + insights + history + patterns + commitments + labs + metrics)
 * 3. Generate coach response (text or vision)
 * 4. Extract and execute actions (meals, workouts, weight, water, sleep, commitments)
 * 5. Extract insights + patterns + commitments (async, non-blocking)
 * 6. Store conversation
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';
import { COACH_SYSTEM_PROMPT } from './system-prompt.ts';
import { INSIGHT_EXTRACTION_PROMPT } from './insight-prompt.ts';
import { buildContext } from './context-builder.ts';
import { extractActions, executeActions } from './action-handler.ts';

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { message, image_base64 } = await req.json();

    if (!message?.trim() && !image_base64) {
      return new Response(
        JSON.stringify({ error: 'message or image required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Build rich context
    const ctx = await buildContext(userId);

    // 2. Build GPT messages
    const gptMessages: unknown[] = [
      { role: 'system', content: COACH_SYSTEM_PROMPT + '\n\n' + ctx.contextBlock },
    ];

    // Add recent chat history
    for (const msg of ctx.recentChat) {
      gptMessages.push({ role: msg.role, content: msg.content });
    }

    // Add current message (text or vision)
    if (image_base64) {
      const userContent: unknown[] = [];
      if (message?.trim()) {
        userContent.push({ type: 'text', text: message });
      }
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${image_base64}`, detail: 'high' },
      });
      gptMessages.push({ role: 'user', content: userContent });
    } else {
      gptMessages.push({ role: 'user', content: message });
    }

    // 3. Generate response
    const modelToUse = image_base64 ? 'gpt-4o' : 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: gptMessages,
        temperature: 0.6,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const gptData = await response.json();
    let assistantMessage = gptData.choices[0]?.message?.content ?? '';

    // 4. Sanitize
    const { clean } = sanitizeText(assistantMessage);
    assistantMessage = clean;

    // 5. Extract and execute actions
    const { cleanMessage, actions } = extractActions(assistantMessage);
    assistantMessage = cleanMessage;

    const existingWater = await getExistingWater(userId);
    const executedActions = await executeActions(userId, actions, existingWater);

    // 6. Store conversation
    await supabaseAdmin.from('chat_messages').insert([
      { user_id: userId, role: 'user', content: message ?? '[photo]' },
      { user_id: userId, role: 'assistant', content: assistantMessage },
    ]);

    // 7. Extract insights (async - don't block response)
    extractInsightsAsync(userId, message ?? '[photo]', assistantMessage, ctx.insights).catch(() => {});

    return new Response(
      JSON.stringify({
        message: assistantMessage,
        actions: actions.map((a, i) => ({ ...a, feedback: executedActions[i] ?? null })),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

async function getExistingWater(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabaseAdmin.from('daily_metrics')
    .select('water_liters').eq('user_id', userId).eq('date', today).single();
  return data?.water_liters ?? 0;
}

/**
 * Async insight extraction - runs after response is sent.
 */
async function extractInsightsAsync(
  userId: string,
  userMessage: string,
  assistantMessage: string,
  existingInsights: { category: string; insight: string }[],
) {
  const existingList = existingInsights.map(i => `[${i.category}] ${i.insight}`).join('\n');

  const prompt = `Mevcut bilinen cikarimlar:\n${existingList || 'Henuz yok'}\n\nSon konusma:\nKullanici: ${userMessage}\nKoc: ${assistantMessage}`;

  interface ExtractionResult {
    insights: { category: string; insight: string; confidence: number }[];
    updated_insights: { old_insight_text: string; new_insight: string; category: string }[];
    commitments: { text: string; follow_up_days: number }[];
    patterns_detected: { type: string; description: string; trigger: string; intervention: string }[];
  }

  try {
    const result = await chatCompletion<ExtractionResult>(
      INSIGHT_EXTRACTION_PROMPT,
      prompt,
      { temperature: 0.2, maxTokens: 1500 }
    );

    // New insights
    if (result.insights.length > 0) {
      await supabaseAdmin.from('user_insights').insert(
        result.insights.map(i => ({
          user_id: userId, category: i.category, insight: i.insight,
          confidence: i.confidence, source: 'chat', active: true,
        }))
      );
    }

    // Updated insights
    for (const update of result.updated_insights) {
      await supabaseAdmin.from('user_insights')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('active', true)
        .ilike('insight', `%${update.old_insight_text.substring(0, 50)}%`);

      await supabaseAdmin.from('user_insights').insert({
        user_id: userId, category: update.category, insight: update.new_insight,
        confidence: 0.85, source: 'chat', active: true,
      });
    }

    // Commitments
    for (const c of result.commitments) {
      const followUp = new Date();
      followUp.setDate(followUp.getDate() + (c.follow_up_days ?? 1));
      await supabaseAdmin.from('user_commitments').insert({
        user_id: userId, commitment: c.text,
        follow_up_at: followUp.toISOString(), status: 'pending',
      });
    }

    // Patterns
    for (const p of result.patterns_detected) {
      await supabaseAdmin.from('user_patterns').upsert({
        user_id: userId, pattern_type: p.type, description: p.description,
        trigger_context: p.trigger, intervention: p.intervention,
        confidence: 0.70, active: true, detected_at: new Date().toISOString(),
      }, { onConflict: 'user_id,pattern_type' } as never);
    }
  } catch {
    // Non-critical - don't fail
  }
}
