interface ReportContext {
  date: string;
  calorieTarget: { min: number; max: number };
  proteinTarget: number;
  calorieActual: number;
  proteinActual: number;
  mealsLogged: { type: string; raw: string; calories: number }[];
  workoutsLogged: { raw: string; duration: number }[];
  waterLiters: number;
  waterTarget: number;
  sleepHours: number | null;
  stepsActual: number | null;
  stepsTarget: number;
  weightToday: number | null;
  moodNote: string | null;
}

/**
 * Builds the prompt for generating an end-of-day report.
 */
export function buildDailyReportPrompt(ctx: ReportContext): string {
  const mealsList = ctx.mealsLogged
    .map((m) => `- [${m.type}] ${m.raw} (${m.calories} kcal)`)
    .join('\n');

  const workoutList = ctx.workoutsLogged
    .map((w) => `- ${w.raw} (${w.duration} dk)`)
    .join('\n');

  return `Kullanıcının bugünkü performansını değerlendir ve gün sonu raporu oluştur.

## Bugünün Hedefleri
- Kalori aralığı: ${ctx.calorieTarget.min}-${ctx.calorieTarget.max} kcal
- Protein alt sınır: ${ctx.proteinTarget}g
- Su hedefi: ${ctx.waterTarget}L
- Adım hedefi: ${ctx.stepsTarget}

## Bugünün Verileri
- Toplam kalori: ${ctx.calorieActual} kcal
- Toplam protein: ${ctx.proteinActual}g
- Su: ${ctx.waterLiters}L
- Uyku: ${ctx.sleepHours !== null ? `${ctx.sleepHours} saat` : 'girilmemiş'}
- Adım: ${ctx.stepsActual ?? 'girilmemiş'}
- Tartı: ${ctx.weightToday !== null ? `${ctx.weightToday} kg` : 'girilmemiş'}
- Not: ${ctx.moodNote ?? 'yok'}

## Öğünler
${mealsList || 'Kayıt yok'}

## Antrenmanlar
${workoutList || 'Kayıt yok'}

Yanıtını SADECE aşağıdaki JSON formatında ver:

{
  "compliance_score": 0-100 arası sayı,
  "calorie_target_met": boolean,
  "protein_target_met": boolean,
  "workout_completed": boolean,
  "sleep_impact": "uyku etkisi hakkında kısa yorum veya null",
  "water_impact": "su tüketimi hakkında kısa yorum veya null",
  "deviation_reason": "sapma varsa nedeni (stres/açlık yönetimi/dışarıda yemek/plansız atıştırma/yok)",
  "tomorrow_action": "yarın için en yüksek etkili tek aksiyon - 1 cümle",
  "full_report": "2-3 cümlelik gün değerlendirmesi. Net, direkt, operasyonel."
}

Uyum puanı hesaplama:
- Kalori hedef aralığında: +30 puan
- Protein hedefe ulaştı: +20 puan
- Antrenman yapıldı: +20 puan
- Su hedefine ulaştı: +10 puan
- Uyku 7+ saat: +10 puan
- Adım hedefine ulaştı: +10 puan
Eksikleri orantılı düş.`;
}
