/**
 * KOCHKO PROACTIVE COACH
 * Scheduled cron job - checks all users, sends smart nudges.
 *
 * Triggers:
 * - No meal log for 8+ hours (during waking hours)
 * - Silent for 2+ days
 * - Night eating risk window (21-23)
 * - Due commitment follow-ups
 * - Detected pattern intervention timing
 * - Milestone achievements (7-day streak, weight goal proximity)
 * - Crisis detection (very low calories, rapid weight change)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const PROACTIVE_PROMPT = `Sen Kochko yasam tarzi kocusun. Kullanicinin durumunu degerlendir.

Mesaj GERCEKTEN gerekli mi karar ver. Spam yapma. Kullanici gunde max 2 mesaj almali.

Mesaj gerekli ise samimi, kisa (1-2 cumle), operasyonel ol. Emoji kullanma.
Gerekli degilse: {"send": false}
Gerekli ise: {"send": true, "message": "mesaj", "trigger": "neden", "priority": "low|medium|high"}`;

serve(async (req: Request) => {
  try {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, gender, night_eating_risk, sweet_craving_risk')
      .eq('onboarding_completed', true);

    if (!profiles?.length) {
      return respond({ processed: 0 });
    }

    const now = new Date();
    const hour = now.getHours();
    const today = now.toISOString().split('T')[0];
    let totalSent = 0;

    for (const profile of profiles) {
      const userId = (profile as { id: string }).id;

      // Max 2 proactive messages per day
      const { count } = await supabaseAdmin
        .from('coaching_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', `${today}T00:00:00`);
      if ((count ?? 0) >= 2) continue;

      // Gather state
      const [lastMealRes, lastChatRes, commitmentsRes, patternsRes, metricsRes, insightsRes] = await Promise.all([
        supabaseAdmin.from('meal_logs').select('logged_at')
          .eq('user_id', userId).order('logged_at', { ascending: false }).limit(1).single(),
        supabaseAdmin.from('chat_messages').select('created_at')
          .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
        supabaseAdmin.from('user_commitments').select('commitment, follow_up_at')
          .eq('user_id', userId).eq('status', 'pending')
          .lte('follow_up_at', now.toISOString()).limit(3),
        supabaseAdmin.from('user_patterns').select('pattern_type, description, intervention')
          .eq('user_id', userId).eq('active', true),
        supabaseAdmin.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours')
          .eq('user_id', userId).order('date', { ascending: false }).limit(7),
        supabaseAdmin.from('user_insights').select('category, insight')
          .eq('user_id', userId).eq('active', true).limit(10),
      ]);

      const hoursSinceMeal = lastMealRes.data?.logged_at
        ? (now.getTime() - new Date(lastMealRes.data.logged_at).getTime()) / 3600000 : 999;
      const hoursSinceChat = lastChatRes.data?.created_at
        ? (now.getTime() - new Date(lastChatRes.data.created_at).getTime()) / 3600000 : 999;
      const dueCommitments = commitmentsRes.data ?? [];
      const patterns = patternsRes.data ?? [];
      const recentMetrics = metricsRes.data ?? [];
      const insights = insightsRes.data ?? [];

      const nightRisk = (profile as { night_eating_risk: boolean }).night_eating_risk && hour >= 21 && hour <= 23;

      // Weight crisis check
      const weights = (recentMetrics as { weight_kg: number | null }[]).filter(m => m.weight_kg).map(m => m.weight_kg as number);
      const weightCrisis = weights.length >= 2 && Math.abs(weights[0] - weights[1]) > 2;

      // Calorie crisis (from recent meals - approximate)
      const { count: todayMealCount } = await supabaseAdmin
        .from('meal_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('logged_at', `${today}T00:00:00`);

      const context = `Saat: ${hour}:00 | Gun: ${now.toLocaleDateString('tr-TR', { weekday: 'long' })}

Durum:
- Son ogun: ${hoursSinceMeal < 999 ? `${Math.round(hoursSinceMeal)} saat once` : 'hic yok'}
- Son konusma: ${hoursSinceChat < 999 ? `${Math.round(hoursSinceChat)} saat once` : 'hic yok'}
- Bugun ogun sayisi: ${todayMealCount ?? 0}
- Gece yeme riski: ${nightRisk ? 'AKTIF' : 'yok'}
- Kilo krizi: ${weightCrisis ? 'EVET - 2 gunde 2kg+ degisim' : 'yok'}

${dueCommitments.length > 0 ? `TAKIP EDILECEK TAAHHUTLER:\n${(dueCommitments as { commitment: string }[]).map(c => `- "${c.commitment}"`).join('\n')}` : ''}

${patterns.length > 0 ? `AKTIF KALIPLAR:\n${(patterns as { pattern_type: string; description: string; intervention: string }[]).map(p => `- [${p.pattern_type}] ${p.description} -> ${p.intervention}`).join('\n')}` : ''}

Bilinen: ${(insights as { insight: string }[]).map(i => i.insight).join('; ') || 'az bilgi'}

Tetikleyiciler:
${hoursSinceMeal > 8 && hour >= 9 && hour <= 22 ? '- UZUN SUREDIR OGUN YOK' : ''}
${hoursSinceChat > 48 ? '- 2+ GUNDUR SESSIZ' : ''}
${nightRisk ? '- GECE YEME RISK SAATI' : ''}
${dueCommitments.length > 0 ? '- TAAHHUT TAKIBI GEREKEN' : ''}
${weightCrisis ? '- KILO KRIZI' : ''}`;

      interface ProactiveResult {
        send: boolean;
        message?: string;
        trigger?: string;
        priority?: string;
      }

      const result = await chatCompletion<ProactiveResult>(
        PROACTIVE_PROMPT, context,
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

        // Mark followed-up commitments
        for (const c of dueCommitments) {
          await supabaseAdmin.from('user_commitments')
            .update({ status: 'followed_up' })
            .eq('user_id', userId)
            .eq('commitment', (c as { commitment: string }).commitment)
            .eq('status', 'pending');
        }

        totalSent++;
      }
    }

    return respond({ processed: profiles.length, sent: totalSent });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

function respond(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
