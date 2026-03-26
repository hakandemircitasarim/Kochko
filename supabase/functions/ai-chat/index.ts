/**
 * Edge Function: Chat with the lifestyle coach.
 * This is the PRIMARY interaction point.
 *
 * Flow:
 * 1. Receive user message
 * 2. Build rich context (profile + insights + recent chat + today's data)
 * 3. Generate coach response via GPT
 * 4. Extract insights from the conversation (second AI call)
 * 5. Store both message and new insights
 * 6. Detect and execute actions (log meal, log workout, etc.)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const COACH_SYSTEM_PROMPT = `Sen Kochko, kişisel yaşam tarzı koçusun. Gerçek bir insan koç gibi davranırsın.

## Kimliğin
- Kullanıcıyla birebir ilgilenen, onu gerçekten tanıyan bir koçsun.
- Her detayını hatırlarsın - geçmişini, alışkanlıklarını, tetikleyicilerini, tercihlerini.
- Diyetisyen veya doktor DEĞİLSİN ama yaşam tarzı konusunda derin bilgin var.
- Türkçe konuşursun, samimi ama profesyonel bir dil kullanırsın.

## İletişim Tarzı
- İnsan gibi konuş. Robot gibi liste verme, sohbet et.
- Kullanıcıyı dinle, anla, sonra öner.
- Bazen soru sor - "Neden böyle hissediyorsun?", "Dün ne oldu?"
- Kısa ve öz ol ama soğuk olma.
- Emoji kullanma.
- Kullanıcıya "sen" diye hitap et.

## Yapabileceklerin
- Beslenme önerisi ve plan yapma
- Antrenman önerisi ve plan yapma
- Motivasyon ve davranış koçluğu
- Yemek analizi ("bunu yesem olur mu?")
- Günlük kayıt alma (yemek, spor, tartı, su, uyku)
- Hedef belirleme ve takip
- Farklı diyet tarzlarını değerlendirme (keto, IF, akdeniz, vegan vs.)
- Farklı spor branşlarını değerlendirme (crossfit, yoga, yüzme, koşu vs.)
- Lab değerlerini yorumlama (yaşam tarzı önerisi olarak)

## Kesin Kurallar
1. ASLA tıbbi teşhis, tanı veya tedavi önerisi yapma.
2. Riskli durumlarda "Bir sağlık profesyoneline danışmanı öneririm" de.
3. Kullanıcının sevmediği/yiyemediği şeyleri ASLA önerme.
4. Kadınlar için günlük min 1200 kcal, erkekler için 1400 kcal altına inme.
5. Haftalık 1 kg'dan fazla kayıp önerme (kilo vermek istiyorsa).

## Eylem Tespiti
Kullanıcının mesajında şunları tespit et ve yanıtında belirt:
- Yemek kaydı: "yedim", "içtim", "kahvaltıda", "öğlende" gibi ifadeler
- Spor kaydı: "yaptım", "koştum", "yürüdüm", "antrenman" gibi
- Tartı: "bugün X kilo", "tartıldım" gibi
- Su: "su içtim", "X bardak/litre" gibi
- Ruh hali: stres, yorgunluk, motivasyon düşüklüğü gibi

Mesajının sonuna, eğer bir eylem tespit ettiysen, şu JSON bloğunu ekle:
<actions>
[{"type": "meal_log", "raw": "tespit ettiğin yemek metni", "meal_type": "breakfast|lunch|dinner|snack"},
 {"type": "workout_log", "raw": "tespit ettiğin spor metni"},
 {"type": "weight_log", "value": sayı},
 {"type": "water_log", "liters": sayı},
 {"type": "mood_note", "note": "ruh hali notu"}]
</actions>
Eylem yoksa bu bloğu ekleme.`;

const INSIGHT_EXTRACTION_PROMPT = `Sen bir veri çıkarım motorusun. Kullanıcı ile koç arasındaki konuşmayı analiz et ve kullanıcı hakkında YENİ öğrenilen bilgileri çıkar.

Sadece SOMUT, KAYDA DEĞER çıkarımlar yap. Zaten bilinen veya önemsiz şeyleri yazma.

Her çıkarım için kategori belirle:
- physical: fiziksel özellikler, sağlık durumu
- dietary: beslenme tercihleri, alerjiler, intoleranslar
- behavioral: davranış kalıpları, tetikleyiciler, alışkanlıklar
- psychological: motivasyon, stres kaynakları, duygusal yeme
- lifestyle: iş, uyku düzeni, sosyal yaşam
- medical: tıbbi geçmiş, ameliyatlar, ilaçlar
- preference: genel tercihler, sevdiği/sevmediği şeyler
- goal: hedefler, öncelikler, istekler
- social: sosyal ortam etkileri, aile, arkadaşlar
- exercise: spor tercihleri, kapasitesi, sakatlıklar

SADECE JSON formatında yanıt ver:
{
  "insights": [
    {
      "category": "kategori",
      "insight": "çıkarım metni - kısa ve net",
      "confidence": 0.0-1.0
    }
  ],
  "updated_insights": [
    {
      "old_insight_text": "güncellenmesi gereken eski çıkarım",
      "new_insight": "güncellenmiş çıkarım",
      "category": "kategori"
    }
  ]
}

Hiçbir yeni çıkarım yoksa boş liste ver: {"insights": [], "updated_insights": []}`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { message } = await req.json();

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ error: 'message required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Build rich context
    const [
      profileRes,
      insightsRes,
      recentChatRes,
      todayMealsRes,
      todayMetricsRes,
      goalRes,
      prefsRes,
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin
        .from('user_insights')
        .select('category, insight')
        .eq('user_id', userId)
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('chat_messages')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('meal_logs')
        .select('raw_input, meal_type, logged_at')
        .eq('user_id', userId)
        .gte('logged_at', new Date().toISOString().split('T')[0] + 'T00:00:00')
        .order('logged_at'),
      supabaseAdmin
        .from('daily_metrics')
        .select('*')
        .eq('user_id', userId)
        .eq('date', new Date().toISOString().split('T')[0])
        .single(),
      supabaseAdmin
        .from('goals')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single(),
      supabaseAdmin
        .from('food_preferences')
        .select('food_name, preference')
        .eq('user_id', userId),
    ]);

    const profile = profileRes.data;
    const insights = insightsRes.data ?? [];
    const recentChat = (recentChatRes.data ?? []).reverse();
    const todayMeals = todayMealsRes.data ?? [];
    const todayMetrics = todayMetricsRes.data;
    const goal = goalRes.data;
    const prefs = prefsRes.data ?? [];

    // Build context string
    const age = profile?.birth_year
      ? new Date().getFullYear() - profile.birth_year
      : null;

    const neverFoods = prefs
      .filter((p: { preference: string }) => p.preference === 'never' || p.preference === 'dislike')
      .map((p: { food_name: string }) => p.food_name);

    const insightsByCategory = insights.reduce<Record<string, string[]>>(
      (acc, i: { category: string; insight: string }) => {
        if (!acc[i.category]) acc[i.category] = [];
        acc[i.category].push(i.insight);
        return acc;
      },
      {}
    );

    const contextBlock = `
## Kullanıcı Hakkında Bildiklerin
Profil: ${profile?.gender ?? '?'} cinsiyet, ${age ?? '?'} yaş, ${profile?.height_cm ?? '?'}cm boy, ${profile?.weight_kg ?? '?'}kg
Hedef: ${goal ? `${goal.target_weight_kg}kg, öncelik: ${goal.priority}` : 'belirlenmemiş'}
ASLA ÖNERMEYECEĞİN yiyecekler: ${neverFoods.join(', ') || 'yok'}

${Object.entries(insightsByCategory).map(([cat, items]) =>
  `### ${cat}\n${items.map(i => `- ${i}`).join('\n')}`
).join('\n\n')}

## Bugünkü Durum
Öğünler: ${todayMeals.map((m: { meal_type: string; raw_input: string }) => `[${m.meal_type}] ${m.raw_input}`).join(', ') || 'henüz kayıt yok'}
Su: ${todayMetrics?.water_liters ?? 0}L
Tartı: ${todayMetrics?.weight_kg ? `${todayMetrics.weight_kg}kg` : 'girilmemiş'}
`.trim();

    // 2. Build messages array for GPT
    const gptMessages: { role: string; content: string }[] = [
      { role: 'system', content: COACH_SYSTEM_PROMPT + '\n\n' + contextBlock },
    ];

    // Add recent chat history
    for (const msg of recentChat) {
      gptMessages.push({
        role: (msg as { role: string }).role,
        content: (msg as { content: string }).content,
      });
    }

    // Add current message
    gptMessages.push({ role: 'user', content: message });

    // 3. Generate coach response
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: gptMessages,
        temperature: 0.6,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const gptData = await response.json();
    let assistantMessage = gptData.choices[0]?.message?.content ?? '';

    // Sanitize
    const { clean } = sanitizeText(assistantMessage);
    assistantMessage = clean;

    // 4. Parse actions from response
    let actions: { type: string; [key: string]: unknown }[] = [];
    const actionsMatch = assistantMessage.match(/<actions>([\s\S]*?)<\/actions>/);
    if (actionsMatch) {
      try {
        actions = JSON.parse(actionsMatch[1]);
        // Remove actions block from visible message
        assistantMessage = assistantMessage.replace(/<actions>[\s\S]*?<\/actions>/, '').trim();
      } catch {
        // ignore parse errors
      }
    }

    // 5. Store messages
    await supabaseAdmin.from('chat_messages').insert([
      { user_id: userId, role: 'user', content: message },
      { user_id: userId, role: 'assistant', content: assistantMessage },
    ]);

    // 6. Execute actions
    const today = new Date().toISOString().split('T')[0];
    for (const action of actions) {
      switch (action.type) {
        case 'meal_log':
          await supabaseAdmin.from('meal_logs').insert({
            user_id: userId,
            raw_input: action.raw as string,
            meal_type: action.meal_type as string,
            logged_at: new Date().toISOString(),
            synced: true,
          });
          break;
        case 'workout_log':
          await supabaseAdmin.from('workout_logs').insert({
            user_id: userId,
            raw_input: action.raw as string,
            workout_type: '',
            duration_min: 0,
            intensity: 'moderate',
            calories_burned: 0,
            logged_at: new Date().toISOString(),
            synced: true,
          });
          break;
        case 'weight_log':
          await supabaseAdmin.from('daily_metrics').upsert({
            user_id: userId,
            date: today,
            weight_kg: action.value as number,
            water_liters: todayMetrics?.water_liters ?? 0,
            synced: true,
          }, { onConflict: 'user_id,date' });
          break;
        case 'water_log':
          await supabaseAdmin.from('daily_metrics').upsert({
            user_id: userId,
            date: today,
            water_liters: (todayMetrics?.water_liters ?? 0) + (action.liters as number),
            synced: true,
          }, { onConflict: 'user_id,date' });
          break;
      }
    }

    // 7. Extract insights (async, non-blocking for response)
    // Run insight extraction in background
    extractInsights(userId, message, assistantMessage, insights).catch(() => {});

    return new Response(
      JSON.stringify({
        message: assistantMessage,
        actions,
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

/**
 * Extracts new insights from the conversation using a second AI call.
 * Runs asynchronously - doesn't block the chat response.
 */
async function extractInsights(
  userId: string,
  userMessage: string,
  assistantMessage: string,
  existingInsights: { category: string; insight: string }[],
) {
  const existingList = existingInsights
    .map((i) => `[${i.category}] ${i.insight}`)
    .join('\n');

  const prompt = `Mevcut bilinen çıkarımlar:
${existingList || 'Henüz yok'}

Son konuşma:
Kullanıcı: ${userMessage}
Koç: ${assistantMessage}

Bu konuşmadan YENİ veya GÜNCELLENMESİ GEREKEN çıkarımları çıkar.`;

  interface InsightResult {
    insights: { category: string; insight: string; confidence: number }[];
    updated_insights: { old_insight_text: string; new_insight: string; category: string }[];
  }

  try {
    const result = await chatCompletion<InsightResult>(
      INSIGHT_EXTRACTION_PROMPT,
      prompt,
      { temperature: 0.2, maxTokens: 1000 }
    );

    // Store new insights
    if (result.insights.length > 0) {
      const rows = result.insights.map((i) => ({
        user_id: userId,
        category: i.category,
        insight: i.insight,
        confidence: i.confidence,
        source: 'chat',
        active: true,
      }));
      await supabaseAdmin.from('user_insights').insert(rows);
    }

    // Update existing insights
    for (const update of result.updated_insights) {
      // Deactivate old
      await supabaseAdmin
        .from('user_insights')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('active', true)
        .ilike('insight', `%${update.old_insight_text.substring(0, 50)}%`);

      // Insert updated
      await supabaseAdmin.from('user_insights').insert({
        user_id: userId,
        category: update.category,
        insight: update.new_insight,
        confidence: 0.85,
        source: 'chat',
        active: true,
      });
    }
  } catch {
    // Insight extraction is non-critical - don't fail the chat
  }
}
