/**
 * Edge Function: Proactive AI Coach
 * Called by a scheduled cron job (e.g., every 4 hours).
 * Checks all active users and sends nudges when appropriate.
 *
 * Triggers:
 * - No meal log for 8+ hours during waking hours
 * - No activity for 2+ days
 * - Approaching night eating risk window
 * - Milestone achievements
 * - Deviation patterns detected
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const PROACTIVE_PROMPT = `Sen Kochko yasam tarzi kocusun. Kullanicinin durumunu degerlendirip,
gerekiyorsa kisa ve samimi bir mesaj uret.

Kurallar:
- Sadece GERCEKTEN gerekli oldugunda mesaj uret
- Spam yapma. Gunluk max 2-3 proaktif mesaj
- Samimi ama profesyonel ol
- Operasyonel ol: ne yapmasi gerektigini soyle
- Emoji kullanma

Mesaj gerekli degilse bos don: {"send": false}
Mesaj gerekli ise: {"send": true, "message": "mesaj", "trigger": "neden"}`;

serve(async (req: Request) => {
  try {
    // Get all active users (logged in within last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, gender, night_eating_risk, sweet_craving_risk, wake_time, sleep_time')
      .eq('onboarding_completed', true);

    if (!profiles?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let messagesCreated = 0;
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

    for (const profile of profiles) {
      const userId = (profile as { id: string }).id;

      // Check how many proactive messages we already sent today
      const { count: todayMsgCount } = await supabaseAdmin
        .from('coaching_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('message_type', 'micro')
        .gte('created_at', `${today}T00:00:00`);

      if ((todayMsgCount ?? 0) >= 3) continue; // Max 3 per day

      // Gather user state
      const [lastMealRes, lastChatRes, metricsRes, insightsRes] = await Promise.all([
        supabaseAdmin
          .from('meal_logs')
          .select('logged_at')
          .eq('user_id', userId)
          .order('logged_at', { ascending: false })
          .limit(1)
          .single(),
        supabaseAdmin
          .from('chat_messages')
          .select('created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
        supabaseAdmin
          .from('daily_metrics')
          .select('date, weight_kg')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(7),
        supabaseAdmin
          .from('user_insights')
          .select('category, insight')
          .eq('user_id', userId)
          .eq('active', true)
          .limit(10),
      ]);

      const lastMealTime = lastMealRes.data?.logged_at;
      const lastChatTime = lastChatRes.data?.created_at;
      const recentMetrics = metricsRes.data ?? [];
      const insights = insightsRes.data ?? [];

      // Calculate hours since last meal and last chat
      const hoursSinceLastMeal = lastMealTime
        ? (now.getTime() - new Date(lastMealTime).getTime()) / 3600000
        : 999;
      const hoursSinceLastChat = lastChatTime
        ? (now.getTime() - new Date(lastChatTime).getTime()) / 3600000
        : 999;

      // Check night eating risk window (21:00-23:00)
      const nightRisk = (profile as { night_eating_risk: boolean }).night_eating_risk
        && currentHour >= 21 && currentHour <= 23;

      // Build context for AI
      const context = `
Kullanici durumu:
- Son ogun: ${hoursSinceLastMeal < 999 ? `${Math.round(hoursSinceLastMeal)} saat once` : 'hic kayit yok'}
- Son konusma: ${hoursSinceLastChat < 999 ? `${Math.round(hoursSinceLastChat)} saat once` : 'hic konusmamis'}
- Saat: ${currentHour}:00
- Gece yeme riski: ${nightRisk ? 'AKTIF - risk saatindeyiz' : 'yok'}
- Bilinen bilgiler: ${insights.map((i: { category: string; insight: string }) => `[${i.category}] ${i.insight}`).join('; ') || 'yok'}
- Son 7 gun kilo: ${recentMetrics.map((m: { date: string; weight_kg: number | null }) => m.weight_kg ? `${m.date}: ${m.weight_kg}kg` : '').filter(Boolean).join(', ') || 'veri yok'}

Olasi tetikleyiciler:
${hoursSinceLastMeal > 8 && currentHour >= 9 && currentHour <= 22 ? '- UZUN SUREDIR OGUN KAYDI YOK' : ''}
${hoursSinceLastChat > 48 ? '- 2+ GUNDUR SESSIZ' : ''}
${nightRisk ? '- GECE YEME RISKI SAATI' : ''}

Gerekli ise mesaj uret, degilse {"send": false} don.`;

      interface ProactiveResult {
        send: boolean;
        message?: string;
        trigger?: string;
      }

      const result = await chatCompletion<ProactiveResult>(
        PROACTIVE_PROMPT,
        context,
        { temperature: 0.5, maxTokens: 300 }
      );

      if (result.send && result.message) {
        const { clean } = sanitizeText(result.message);

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: userId,
          message_type: 'micro',
          content: clean,
          trigger: result.trigger ?? 'proactive',
          read: false,
        });

        messagesCreated++;
      }
    }

    return new Response(
      JSON.stringify({ processed: profiles.length, messages_created: messagesCreated }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
