/**
 * Conflict Resolution Service
 * Spec 5.11: Çelişki yönetimi
 *
 * Handles contradictions between:
 * - Profile data vs logged behavior
 * - Old insights vs new information
 * - Goals vs actual patterns
 */

export type ConflictType =
  | 'allergen_violation'    // Profile says "gluten-free" but logged pasta
  | 'goal_behavior_mismatch' // Goal "1kg/week" but eating 2500 kcal/day
  | 'profile_contradiction' // Says "no alcohol" but logged beer
  | 'insight_outdated';      // Old insight contradicted by new behavior

export interface Conflict {
  type: ConflictType;
  description: string;
  oldValue: string;
  newValue: string;
  suggestedQuestion: string; // What AI should ask the user
}

/**
 * Detect allergen contradiction.
 * User has "gluten" in allergens but logged "makarna".
 */
export function detectAllergenConflict(
  allergens: string[],
  loggedFoodText: string
): Conflict | null {
  const lower = loggedFoodText.toLocaleLowerCase('tr');

  // Common allergen-food mappings
  const allergenFoods: Record<string, string[]> = {
    gluten: ['makarna', 'ekmek', 'borek', 'pasta', 'pizza', 'bulgur', 'un', 'simit', 'pogaca'],
    laktoz: ['sut', 'süt', 'peynir', 'yogurt', 'yoğurt', 'dondurma', 'krema'],
    fistik: ['fistik', 'fıstık', 'yer fistigi'],
    yumurta: ['yumurta', 'omlet', 'menemen'],
    kabuklu_deniz: ['karides', 'midye', 'istakoz', 'yengec'],
    balik: ['balik', 'balık', 'somon', 'levrek', 'hamsi', 'ton'],
    soya: ['soya', 'tofu', 'edamame'],
  };

  for (const allergen of allergens) {
    const allergenLower = allergen.toLocaleLowerCase('tr');
    const foods = allergenFoods[allergenLower] ?? [allergenLower];

    for (const food of foods) {
      if (lower.includes(food)) {
        return {
          type: 'allergen_violation',
          description: `"${allergen}" alerjenin var ama "${food}" iceren bir yemek girdin.`,
          oldValue: `Alerjen: ${allergen}`,
          newValue: `Yenen: ${loggedFoodText}`,
          suggestedQuestion: `${allergen} intoleransin degisti mi, yoksa bu bir istisna miydi?`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect goal-behavior mismatch.
 * E.g., goal is "lose weight" but consistently eating above TDEE.
 */
export function detectGoalBehaviorMismatch(
  goalType: string,
  avgCalories: number,
  tdee: number,
  weeks: number
): Conflict | null {
  if (weeks < 2) return null; // Need at least 2 weeks of data

  if (goalType === 'lose_weight' && avgCalories > tdee * 0.95) {
    return {
      type: 'goal_behavior_mismatch',
      description: `Kilo vermek istiyorsun ama son ${weeks} haftadir kalori alimin TDEE'nin uzerinde.`,
      oldValue: `Hedef: kilo ver (TDEE: ${tdee} kcal)`,
      newValue: `Ortalama tuketim: ${Math.round(avgCalories)} kcal/gun`,
      suggestedQuestion: 'Hedefini ayarlayalim mi yoksa beslenme planini sikilaştiralim mi?',
    };
  }

  if (goalType === 'gain_weight' && avgCalories < tdee * 1.05) {
    return {
      type: 'goal_behavior_mismatch',
      description: `Kilo almak istiyorsun ama kalori alimin yeterli degil.`,
      oldValue: `Hedef: kilo al (TDEE: ${tdee} kcal)`,
      newValue: `Ortalama tuketim: ${Math.round(avgCalories)} kcal/gun`,
      suggestedQuestion: 'Kalori hedefini artirmak mi yoksa hedefi degistirmek mi istiyorsun?',
    };
  }

  return null;
}

/**
 * Detect profile data contradiction.
 * E.g., profile says "never drinks alcohol" but logged beer.
 */
export function detectProfileContradiction(
  alcoholFrequency: string,
  loggedAlcohol: boolean
): Conflict | null {
  if (alcoholFrequency === 'never' && loggedAlcohol) {
    return {
      type: 'profile_contradiction',
      description: 'Profilinde "alkol kullanmiyorum" yazıyor ama alkol kaydi girdin.',
      oldValue: 'Alkol: hic',
      newValue: 'Alkol kaydi girildi',
      suggestedQuestion: 'Alkol tercihin degisti mi, yoksa bu bir istisna miydi? Profilini guncellememi ister misin?',
    };
  }

  return null;
}
