import type { Profile, Goal, FoodPreferenceEntry } from '@/types/database';

interface PlanContext {
  profile: Profile;
  goal: Goal | null;
  currentWeight: number | null;
  recentCalorieAvg: number | null;
  recentProteinAvg: number | null;
  recentStepsAvg: number | null;
  recentSleepAvg: number | null;
  recentComplianceAvg: number | null;
  lastWorkoutDaysAgo: number | null;
  foodPreferences: FoodPreferenceEntry[];
  healthEvents: string[];
  dayOfWeek: string;
}

/**
 * Builds the prompt for generating a daily plan.
 */
export function buildDailyPlanPrompt(ctx: PlanContext): string {
  const age = ctx.profile.birth_year
    ? new Date().getFullYear() - ctx.profile.birth_year
    : null;

  const neverFoods = ctx.foodPreferences
    .filter((f) => f.preference === 'never' || f.preference === 'dislike')
    .map((f) => f.food_name);

  const lovedFoods = ctx.foodPreferences
    .filter((f) => f.preference === 'love' || f.preference === 'like')
    .map((f) => f.food_name);

  return `Kullanıcı için bugünün planını oluştur.

## Kullanıcı Profili
- Cinsiyet: ${ctx.profile.gender ?? 'belirtilmemiş'}
- Yaş: ${age ?? 'belirtilmemiş'}
- Boy: ${ctx.profile.height_cm ?? '?'} cm
- Mevcut kilo: ${ctx.currentWeight ?? ctx.profile.weight_kg ?? '?'} kg
- Aktivite: ${ctx.profile.activity_level ?? 'belirtilmemiş'}
- Ekipman: ${ctx.profile.equipment_access ?? 'ev'}
- Yemek yapma becerisi: ${ctx.profile.cooking_skill ?? 'basit'}
- Bütçe: ${ctx.profile.budget_level ?? 'orta'}
- Kısıt modu: ${ctx.profile.restriction_mode ?? 'sustainable'}
- Gece yeme riski: ${ctx.profile.night_eating_risk ? 'EVET' : 'hayır'}
- Tatlı krizi riski: ${ctx.profile.sweet_craving_risk ? 'EVET' : 'hayır'}
- Önemli notlar: ${ctx.profile.important_notes ?? 'yok'}

## Hedef
${ctx.goal ? `- Hedef kilo: ${ctx.goal.target_weight_kg} kg
- Haftalık kayıp hedefi: ${ctx.goal.weekly_loss_rate} kg
- Kalori aralığı: ${ctx.goal.daily_calorie_min}-${ctx.goal.daily_calorie_max} kcal
- Protein alt sınır: ${ctx.goal.daily_protein_min}g
- Adım hedefi: ${ctx.goal.daily_steps_target}
- Su hedefi: ${ctx.goal.daily_water_target}L` : 'Hedef belirlenmemiş'}

## Sağlık Geçmişi
${ctx.healthEvents.length > 0 ? ctx.healthEvents.join('\n') : 'Yok'}

## Son 14 Gün Ortalamaları
- Kalori: ${ctx.recentCalorieAvg ?? '?'} kcal/gün
- Protein: ${ctx.recentProteinAvg ?? '?'} g/gün
- Adım: ${ctx.recentStepsAvg ?? '?'}/gün
- Uyku: ${ctx.recentSleepAvg ?? '?'} saat/gün
- Uyum puanı: ${ctx.recentComplianceAvg ?? '?'}/100
- Son antrenman: ${ctx.lastWorkoutDaysAgo !== null ? `${ctx.lastWorkoutDaysAgo} gün önce` : '?'}

## Yemek Tercihleri
- ASLA ÖNERME: ${neverFoods.length > 0 ? neverFoods.join(', ') : 'yok'}
- Sevdiği: ${lovedFoods.length > 0 ? lovedFoods.join(', ') : 'belirtilmemiş'}

## Bugün: ${ctx.dayOfWeek}

Yanıtını SADECE aşağıdaki JSON formatında ver:

{
  "calorie_target_min": sayı,
  "calorie_target_max": sayı,
  "protein_target_g": sayı,
  "focus_message": "bugünün tek kritik odağı - 1 cümle",
  "meal_suggestions": [
    {
      "meal_type": "breakfast" | "lunch" | "dinner",
      "options": [
        {
          "name": "yemek adı",
          "description": "kısa tarif veya içerik",
          "calories": sayı,
          "protein_g": sayı,
          "carbs_g": sayı,
          "fat_g": sayı
        }
      ]
    }
  ],
  "snack_strategy": "tatlı krizi / atıştırma yönetimi önerisi",
  "workout_plan": {
    "warmup": "ısınma açıklaması",
    "main": ["egzersiz 1", "egzersiz 2", ...],
    "cooldown": "soğuma açıklaması",
    "duration_min": sayı,
    "rpe": sayı (1-10),
    "heart_rate_zone": "düşük" | "orta" | "yüksek"
  }
}

Her öğün için 2-3 seçenek sun. Sevmediği yiyecekleri ASLA dahil etme.`;
}
