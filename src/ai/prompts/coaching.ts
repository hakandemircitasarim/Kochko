interface CoachingContext {
  trigger: string;
  currentCalories: number;
  currentProtein: number;
  calorieTarget: { min: number; max: number };
  proteinTarget: number;
  timeOfDay: string;
  mealsCount: number;
  waterLiters: number;
  waterTarget: number;
  lastSleepHours: number | null;
  nightEatingRisk: boolean;
  sweetCravingRisk: boolean;
  recentDeviationDays: number;
}

/**
 * Builds the prompt for micro-coaching messages.
 */
export function buildCoachingPrompt(ctx: CoachingContext): string {
  return `Kullanıcıya kısa bir koçluk mesajı üret.

## Tetikleyici: ${ctx.trigger}

## Mevcut Durum
- Saat: ${ctx.timeOfDay}
- Bugün yenen: ${ctx.currentCalories} kcal / hedef: ${ctx.calorieTarget.min}-${ctx.calorieTarget.max}
- Bugün protein: ${ctx.currentProtein}g / hedef: ${ctx.proteinTarget}g
- Öğün sayısı: ${ctx.mealsCount}
- Su: ${ctx.waterLiters}L / hedef: ${ctx.waterTarget}L
- Dünkü uyku: ${ctx.lastSleepHours !== null ? `${ctx.lastSleepHours} saat` : '?'}
- Gece yeme riski: ${ctx.nightEatingRisk ? 'VAR' : 'yok'}
- Tatlı krizi riski: ${ctx.sweetCravingRisk ? 'VAR' : 'yok'}
- Son ${ctx.recentDeviationDays} günde sapma var

Yanıtını SADECE aşağıdaki JSON formatında ver:

{
  "message": "1-2 cümle koçluk mesajı",
  "priority": "low" | "medium" | "high"
}

Kurallar:
- Direkt ve operasyonel ol.
- Ne yapması gerektiğini söyle.
- Abartılı motivasyon yok.
- Emoji yok.`;
}
