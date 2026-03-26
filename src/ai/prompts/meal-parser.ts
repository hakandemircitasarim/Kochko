/**
 * Prompt template for parsing free-text meal entries
 * into structured nutritional data.
 */
export function buildMealParsePrompt(rawInput: string): string {
  return `Kullanıcı aşağıdaki öğün kaydını girdi. Bu metni analiz et ve yapılandırılmış veriye çevir.

Kullanıcı girişi: "${rawInput}"

Yanıtını SADECE aşağıdaki JSON formatında ver, başka hiçbir şey yazma:

{
  "items": [
    {
      "food_name": "yiyecek adı",
      "portion_text": "kullanıcının yazdığı porsiyon",
      "portion_grams": tahmini gram (sayı),
      "calories": tahmini kalori (sayı),
      "protein_g": tahmini protein gram (sayı, 1 ondalık),
      "carbs_g": tahmini karbonhidrat gram (sayı, 1 ondalık),
      "fat_g": tahmini yağ gram (sayı, 1 ondalık)
    }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "belirsiz noktalar varsa kısa not (opsiyonel)"
}

Kurallar:
- Türk mutfağını iyi bil. Porsiyon tahminlerinde Türkiye standartlarını kullan.
- "1 dilim ekmek" = ~30g, "1 yumurta" = ~60g, "1 porsiyon pilav" = ~150g pişmiş gibi.
- Belirsiz porsiyon varsa orta porsiyon varsay.
- Kalori ve makro değerlerini en yakın tahminle ver.
- confidence: porsiyon belirsizse "low", net ise "high".`;
}
