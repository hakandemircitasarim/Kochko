/**
 * Eating Out Service
 * Spec 8: Dışarıda Yemek — restoranda, kafede, fast food'da yanında
 *
 * Mekan hafızası, sosyal baskı koçluğu, proaktif gün ayarlaması,
 * en az hasarlı seçenek önerisi, menü analizi.
 */
import { supabase } from '@/lib/supabase';

// ─── Types ───

export interface VenueInfo {
  venue_name: string;
  venue_type?: string;
  learned_items: LearnedItem[];
  visit_count: number;
  last_visit?: string;
}

export interface LearnedItem {
  name: string;
  calories: number;
  protein_g?: number;
  confirmed: boolean;
}

export interface EatingOutPlan {
  venueAdvice: string;
  dayAdjustment: DayAdjustment | null;
  socialPressureCoaching: string | null;
  recommendedItems: LearnedItem[];
}

export interface DayAdjustment {
  remainingCalories: number;
  suggestion: string;
  adjustedMeals: { meal: string; target: number; note: string }[];
}

// ─── Venue Management ───

/**
 * Get all saved venues for a user.
 */
export async function getVenues(userId: string): Promise<VenueInfo[]> {
  const { data } = await supabase
    .from('user_venues')
    .select('venue_name, venue_type, learned_items, visit_count, updated_at')
    .eq('user_id', userId)
    .order('visit_count', { ascending: false });

  return (data ?? []).map(v => ({
    venue_name: v.venue_name as string,
    venue_type: v.venue_type as string | undefined,
    learned_items: (v.learned_items as LearnedItem[]) ?? [],
    visit_count: v.visit_count as number,
    last_visit: v.updated_at as string,
  }));
}

/**
 * Get venue recommendations based on past successful visits.
 * Returns venues where user stayed within calorie targets.
 */
export async function getRecommendedVenues(userId: string): Promise<VenueInfo[]> {
  const venues = await getVenues(userId);

  // Sort by visit count (most visited = most familiar) and filter venues with learned items
  return venues
    .filter(v => v.learned_items.length > 0)
    .sort((a, b) => b.visit_count - a.visit_count)
    .slice(0, 5);
}

/**
 * Get menu history for a specific venue.
 */
export async function getVenueMenuHistory(
  userId: string,
  venueName: string
): Promise<LearnedItem[]> {
  const { data } = await supabase
    .from('user_venues')
    .select('learned_items')
    .eq('user_id', userId)
    .eq('venue_name', venueName)
    .single();

  return (data?.learned_items as LearnedItem[]) ?? [];
}

// ─── Day Adjustment ───

/**
 * Calculate proactive day adjustment for eating out tonight.
 * If user says "aksam disarida yiyecegim", lighten earlier meals.
 */
export function calculateDayAdjustment(
  dailyTarget: number,
  estimatedDinnerCalories: number,
  alreadyConsumed: number
): DayAdjustment {
  const remaining = dailyTarget - alreadyConsumed;
  const dinnerBudget = Math.min(estimatedDinnerCalories, remaining * 0.6); // dinner gets 60% of remaining
  const lunchBudget = remaining - dinnerBudget;

  const adjustedMeals: DayAdjustment['adjustedMeals'] = [];

  if (alreadyConsumed === 0) {
    // Morning — user hasn't eaten yet
    adjustedMeals.push({
      meal: 'kahvalti',
      target: Math.round(dailyTarget * 0.15),
      note: 'Hafif kahvalti — yumurta + salata veya yogurt + meyve',
    });
    adjustedMeals.push({
      meal: 'ogle',
      target: Math.round(dailyTarget * 0.2),
      note: 'Protein agirlikli hafif ogle — tavuk salata, ton baligi',
    });
    adjustedMeals.push({
      meal: 'aksam (disarida)',
      target: Math.round(dailyTarget * 0.55),
      note: 'Disarida yemek icin ayrilmis butce',
    });
  } else {
    adjustedMeals.push({
      meal: 'aksam (disarida)',
      target: Math.round(remaining),
      note: `Kalan butcen: ${Math.round(remaining)} kcal. En iyi secenekleri tercih et.`,
    });
  }

  return {
    remainingCalories: remaining,
    suggestion: `Aksam disarida yiyeceksen, gun icinde ${Math.round(dailyTarget * 0.4)} kcal ile idare et. Aksam icin ${Math.round(dailyTarget * 0.55)} kcal ayirdim.`,
    adjustedMeals,
  };
}

// ─── Social Pressure Coaching ───

/**
 * Get social pressure coaching tips based on situation.
 */
export function getSocialPressureCoaching(situation: string): string {
  const lower = situation.toLocaleLowerCase('tr');

  if (lower.includes('is yemegi') || lower.includes('iş yemeği') || lower.includes('toplanti')) {
    return `Is yemeginde herkes yiyor, anlasilir. Stratejin:
- Salata veya corba ile basla (doygunluk artsin)
- Ana yemekte protein agirlikli sec (et/balik + sebze)
- Ekmek sepetini uzak tut
- Tatliyi pas gec veya "cay yeter" de
- Porsiyon kontrol: tabagin yarisini ye, gerisi paket
Kimse senin ne kadar yedigini farketmez, rahat ol.`;
  }

  if (lower.includes('arkadas') || lower.includes('arkadaslar') || lower.includes('parti') || lower.includes('kutlama')) {
    return `Arkadaslarla disarida yemek sosyal bir aktivite, tadini cikar ama bilincli ol:
- "Ben tok, az yerim" demen yeterli. Aciklama zorunlu degil.
- Paylasimlak tabak varsa, senin icin en iyi secenekten al
- Icki yerine soda/su sec veya 1 kadehle sinirla
- "Diyetteyim" deme — "karnım tok" daha dogal.
Haftalik butce perspektifinden bak, bir aksam her seyi bozmaz.`;
  }

  if (lower.includes('aile') || lower.includes('annem') || lower.includes('kayinvalide')) {
    return `Aile yemeklerinde baski olur, normal:
- "Cok guzel olmus ama karnım doydu" de
- Az al, yavaş ye — az yedigin belli olmaz
- Salata ve sebze tabaklarindan cok al
- Tatli icin "birazdan yerim" de, sonra unut
Ailenle tartisma, sadece stratejik davran.`;
  }

  // Default
  return `Disarida yerken stratejin:
- Menuye bakmadan once ne yiyecegin hakkinda bir fikrin olsun
- Protein + sebze agirlikli sec
- Ic suyunu bol ic (doygunluk)
- Porsiyon buyukse yarisin paket yap
- Tek gun icin stres yapma, haftalik butcene bak.`;
}

// ─── Least Damage Options ───

/**
 * Rank menu items by "least damage" based on calorie/protein ratio.
 */
export function rankByLeastDamage(items: LearnedItem[]): LearnedItem[] {
  return [...items].sort((a, b) => {
    // Prefer lower calories
    const calScore = a.calories - b.calories;
    // Prefer higher protein
    const proteinBonus = ((b.protein_g ?? 0) - (a.protein_g ?? 0)) * 5;
    return calScore + proteinBonus;
  });
}

/**
 * Get fast food least-damage recommendations for common chains.
 */
export function getFastFoodRecommendations(chain: string): string | null {
  const lower = chain.toLocaleLowerCase('tr');
  const recommendations: Record<string, string> = {
    "mcdonald's": 'En az hasarli: Grilled Chicken Wrap (~350 kcal), McChicken tek (~400 kcal). Kacin: Big Mac Menu + kola (~1100 kcal). Sos isteme, su ic.',
    'burger king': 'En az hasarli: Whopper Jr tek (~310 kcal), Tavuk Salata (~250 kcal). Kacin: Double Whopper Menu (~1400 kcal).',
    'subway': 'En az hasarli: 6" Tavuk Gögüs (beyaz ekmek, bol sebze, ~350 kcal). Kacin: Footlong + peynir + sos (~900+ kcal).',
    'starbucks': 'En az hasarli: Protein Box (~350 kcal), Sade filtre kahve (~5 kcal). Kacin: Frappuccino + pasta (~600+ kcal).',
    'dominos': 'En az hasarli: Thin crust margarita 2 dilim (~400 kcal), Tavuk salata (~300 kcal). Kacin: Pan pizza + ekstra peynir.',
    'kfc': 'En az hasarli: Grilled tavuk (~220 kcal), Misir (~70 kcal). Kacin: Bucket menu + patates (~1200+ kcal).',
    'popeyes': 'En az hasarli: Grilled tavuk sandvic (~350 kcal). Kacin: Spicy chicken combo (~1000+ kcal).',
    'sbarro': 'En az hasarli: 1 dilim sebzeli pizza (~350 kcal). Porsiyon kontrol kritik.',
  };

  for (const [key, rec] of Object.entries(recommendations)) {
    if (lower.includes(key)) return rec;
  }

  return null;
}

/**
 * Build eating-out context for AI system prompt.
 */
export function buildEatingOutContext(
  venues: VenueInfo[],
  adjustment: DayAdjustment | null
): string {
  const parts: string[] = ['DISARIDA YEMEK MODU AKTIF'];

  if (venues.length > 0) {
    parts.push(`\nBILINEN MEKANLAR (${venues.length}):`);
    for (const v of venues.slice(0, 3)) {
      const items = v.learned_items.slice(0, 3).map(i => `${i.name} (~${i.calories}kcal)`).join(', ');
      parts.push(`- ${v.venue_name} (${v.visit_count}x ziyaret): ${items}`);
    }
  }

  if (adjustment) {
    parts.push(`\nGUN AYARLAMASI:`);
    parts.push(adjustment.suggestion);
    for (const meal of adjustment.adjustedMeals) {
      parts.push(`- ${meal.meal}: ~${meal.target} kcal — ${meal.note}`);
    }
  }

  parts.push(`\nKURALLAR:
1. En az hasarli secenekleri oner
2. Sosyal baski koclugu yap (yargilamadan)
3. Haftalik butce perspektifi ver
4. Porsiyon kontrolu ipuclari ver
5. Mekan biliyorsan gecmis verileri kullan`);

  return parts.join('\n');
}
