/**
 * Canonical Turkish label maps — the SINGLE source of truth for enum → TR
 * display text on the client. These maps used to be copy-pasted per screen
 * and had drifted (the same enum rendered differently on different screens);
 * every client surface now reads from here.
 *
 * Server (supabase/functions) keeps its own copies deliberately — out of scope.
 */
import type { GoalType, MealType, Gender, ActivityLevel } from '@/types/database';

// Key order matters: option chips are built via Object.keys() (goals settings,
// onboarding) — keep the historical selector order (health BEFORE maintain).
export const GOAL_LABELS_TR: Record<GoalType, string> = {
  lose_weight: 'Kilo Ver',
  gain_weight: 'Kilo Al',
  gain_muscle: 'Kas Kazan',
  health: 'Sağlık',
  maintain: 'Koruma',
  conditioning: 'Kondisyon',
};

/** Kısa faz-segmenti varyantı — PhaseTimeline'ın dar bar dilimleri için bilinçli kısa. */
export const GOAL_LABELS_SHORT_TR: Record<GoalType, string> = {
  lose_weight: 'Yağ Yakımı',
  gain_weight: 'Kilo Alma',
  gain_muscle: 'Kas',
  health: 'Sağlık',
  maintain: 'Koruma',
  conditioning: 'Kondisyon',
};

/** Mastar varyantı — "Hedefin ne?" cevapları ve cümle içi kullanım
 *  (onboarding seçenekleri, koç-hafıza "Hedef: …" hücreleri). */
export const GOAL_LABELS_INFINITIVE_TR: Record<GoalType, string> = {
  lose_weight: 'Kilo Vermek',
  gain_weight: 'Kilo Almak',
  gain_muscle: 'Kas Kazanmak',
  health: 'Sağlıklı Yaşamak',
  maintain: 'Kilomu Korumak',
  conditioning: 'Kondisyon',
};

export const MEAL_TYPE_LABELS_TR: Record<MealType, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Atıştırma',
};

export const GENDER_LABELS_TR: Record<Gender, string> = {
  male: 'Erkek',
  female: 'Kadın',
  other: 'Diğer',
};

export const ACTIVITY_LEVEL_LABELS_TR: Record<ActivityLevel, string> = {
  sedentary: 'Hareketsiz',
  light: 'Hafif Hareketli',
  moderate: 'Orta',
  active: 'Aktif',
  very_active: 'Çok Aktif',
};

/** {value,label} seçenek dizisi türet — onboarding/edit-profile ChipSelect'leri
 *  aynı sırayla aynı seçenekleri sunsun diye tek noktadan. */
export const toOptions = <K extends string>(map: Record<K, string>): { value: K; label: string }[] =>
  (Object.keys(map) as K[]).map(value => ({ value, label: map[value] }));

// ─── Lookup helpers — unknown/legacy keys fall back to the raw key ───────────
// Object.hasOwn şart (review fix): anahtarlar serbest metinden gelebilir
// (goals.phase_label, AI-yazımı ai_summary anahtarları) — 'constructor' gibi bir
// prototip özelliği düz köşeli-parantez erişiminde truthy bir Function döndürür
// ve <Text> içinde render edilince React crash'ler.
const lookup = (map: Record<string, string>, key: string | null | undefined): string => {
  if (key && Object.hasOwn(map, key)) return map[key];
  if (__DEV__ && key && key.trim() !== '') {
    // Sunucu tarafında enum genişler/yeniden adlanırsa TR-only üründe çiğ İngilizce
    // token sızar — emülatörde İLK açılışta duyulsun, prod'da sessiz-güvenli kalsın.
    console.warn(`[labels] bilinmeyen anahtar: "${key}"`);
  }
  return key || '';
};

export const goalLabelTR = (key: string | null | undefined): string =>
  lookup(GOAL_LABELS_TR, key);

export const goalShortLabelTR = (key: string | null | undefined): string =>
  lookup(GOAL_LABELS_SHORT_TR, key);

export const goalInfinitiveLabelTR = (key: string | null | undefined): string =>
  lookup(GOAL_LABELS_INFINITIVE_TR, key);

export const mealTypeLabelTR = (key: string | null | undefined): string =>
  lookup(MEAL_TYPE_LABELS_TR, key);

export const genderLabelTR = (key: string | null | undefined): string =>
  lookup(GENDER_LABELS_TR, key);

export const activityLevelLabelTR = (key: string | null | undefined): string =>
  lookup(ACTIVITY_LEVEL_LABELS_TR, key);
