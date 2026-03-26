/**
 * Edge Function: Parse meal text using OpenAI.
 * Input: { raw_input: string, meal_log_id: string }
 * Output: { items: [...], confidence, notes }
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';

const SYSTEM_PROMPT = `Sen bir besin analiz motorusun. Türk mutfağını iyi bilirsin.
Kullanıcı serbest metin olarak ne yediğini yazar, sen bunu yapılandırılmış veriye çevirirsin.
Yanıtını SADECE JSON formatında ver. Başka hiçbir şey yazma.`;

interface ParsedItem {
  food_name: string;
  portion_text: string;
  portion_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface ParseResult {
  items: ParsedItem[];
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { raw_input, meal_log_id } = await req.json();

    if (!raw_input || !meal_log_id) {
      return new Response(
        JSON.stringify({ error: 'raw_input and meal_log_id required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userPrompt = `Kullanıcı girişi: "${raw_input}"

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "items": [
    {
      "food_name": "yiyecek adı",
      "portion_text": "porsiyon",
      "portion_grams": tahmini gram,
      "calories": kalori,
      "protein_g": protein,
      "carbs_g": karbonhidrat,
      "fat_g": yağ
    }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "opsiyonel not"
}`;

    const result = await chatCompletion<ParseResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.2 }
    );

    // Validate: no negative values
    for (const item of result.items) {
      item.calories = Math.max(0, Math.round(item.calories));
      item.protein_g = Math.max(0, Math.round(item.protein_g * 10) / 10);
      item.carbs_g = Math.max(0, Math.round(item.carbs_g * 10) / 10);
      item.fat_g = Math.max(0, Math.round(item.fat_g * 10) / 10);
    }

    // Store parsed items in database
    if (result.items.length > 0) {
      const rows = result.items.map((item) => ({
        meal_log_id,
        food_name: item.food_name,
        portion_text: item.portion_text,
        portion_grams: item.portion_grams,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        user_corrected: false,
      }));

      await supabaseAdmin.from('meal_log_items').insert(rows);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
