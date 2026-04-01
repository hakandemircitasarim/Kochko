/**
 * Saved Recipes Service
 * Spec 7.7: Tarif kütüphanesi — search, scale, allergen check, substitution, favorites
 */
import { supabase } from '@/lib/supabase';

export interface SavedRecipe {
  id: string;
  user_id?: string;
  title: string;
  category: string | null;
  ingredients: RecipeIngredient[];
  instructions: string;
  total_calories: number | null;
  total_protein: number | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  servings: number;
  use_count?: number;
  is_favorite?: boolean;
  created_at: string;
}

export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export interface RecipeSearchFilters {
  category?: string;
  maxPrepTime?: number;
  maxCalories?: number;
  ingredientQuery?: string;
  onlyFavorites?: boolean;
}

// ─── CRUD ───

export async function getRecipes(category?: string): Promise<SavedRecipe[]> {
  let query = supabase.from('saved_recipes').select('*').order('created_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data } = await query;
  return (data ?? []) as SavedRecipe[];
}

export async function saveRecipe(recipe: Omit<SavedRecipe, 'id' | 'created_at'>): Promise<void> {
  await supabase.from('saved_recipes').insert(recipe);
}

export async function deleteRecipe(id: string): Promise<void> {
  await supabase.from('saved_recipes').delete().eq('id', id);
}

export async function updateRecipe(recipeId: string, updates: Partial<SavedRecipe>): Promise<void> {
  const { id, created_at, ...rest } = updates as Record<string, unknown>;
  await supabase.from('saved_recipes').update(rest).eq('id', recipeId);
}

// ─── Search & Filter ───

export async function searchRecipes(query: string, filters: RecipeSearchFilters = {}): Promise<SavedRecipe[]> {
  let dbQuery = supabase.from('saved_recipes').select('*').order('use_count', { ascending: false });

  if (filters.category) dbQuery = dbQuery.eq('category', filters.category);
  if (filters.maxPrepTime) dbQuery = dbQuery.lte('prep_time_min', filters.maxPrepTime);
  if (filters.maxCalories) dbQuery = dbQuery.lte('total_calories', filters.maxCalories);
  if (filters.onlyFavorites) dbQuery = dbQuery.eq('is_favorite', true);

  const { data } = await dbQuery;
  let recipes = (data ?? []) as SavedRecipe[];

  // Client-side text search (title + ingredients)
  if (query.trim()) {
    const q = query.toLowerCase();
    recipes = recipes.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(q))
    );
  }

  // Ingredient query filter
  if (filters.ingredientQuery) {
    const ingredients = filters.ingredientQuery.toLowerCase().split(',').map(s => s.trim());
    recipes = recipes.filter(r =>
      ingredients.every(ing => r.ingredients.some(ri => ri.name.toLowerCase().includes(ing)))
    );
  }

  return recipes;
}

/**
 * "Elimde sunlar var" modu — find recipes matching available ingredients.
 */
export async function getRecipesByIngredients(availableIngredients: string[]): Promise<{ recipe: SavedRecipe; matchPercent: number }[]> {
  const { data } = await supabase.from('saved_recipes').select('*');
  const recipes = (data ?? []) as SavedRecipe[];
  const available = availableIngredients.map(i => i.toLowerCase());

  return recipes
    .map(recipe => {
      const recipeIngredients = recipe.ingredients.map(i => i.name.toLowerCase());
      const matched = recipeIngredients.filter(ri => available.some(a => ri.includes(a) || a.includes(ri)));
      const matchPercent = recipeIngredients.length > 0
        ? Math.round((matched.length / recipeIngredients.length) * 100)
        : 0;
      return { recipe, matchPercent };
    })
    .filter(r => r.matchPercent >= 50) // At least 50% ingredient match
    .sort((a, b) => b.matchPercent - a.matchPercent);
}

// ─── Portion Scaling ───

export function scaleRecipe(recipe: SavedRecipe, targetServings: number): SavedRecipe {
  if (recipe.servings <= 0 || targetServings <= 0) return recipe;
  const factor = targetServings / recipe.servings;

  return {
    ...recipe,
    servings: targetServings,
    total_calories: recipe.total_calories ? Math.round(recipe.total_calories * factor) : null,
    total_protein: recipe.total_protein ? Math.round(recipe.total_protein * factor) : null,
    ingredients: recipe.ingredients.map(ing => ({
      ...ing,
      amount: scaleAmount(ing.amount, factor),
      calories: ing.calories ? Math.round(ing.calories * factor) : undefined,
      protein_g: ing.protein_g ? Math.round(ing.protein_g * factor * 10) / 10 : undefined,
      carbs_g: ing.carbs_g ? Math.round(ing.carbs_g * factor * 10) / 10 : undefined,
      fat_g: ing.fat_g ? Math.round(ing.fat_g * factor * 10) / 10 : undefined,
    })),
  };
}

function scaleAmount(amount: string, factor: number): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  const scaled = Math.round(num * factor * 10) / 10;
  // Keep the non-numeric part (e.g., "2 su bardagi" -> "4 su bardagi")
  const unit = amount.replace(/[\d.,]+/, '').trim();
  return unit ? `${scaled} ${unit}` : String(scaled);
}

// ─── Favorites ───

export async function toggleFavorite(recipeId: string, isFavorite: boolean): Promise<void> {
  await supabase.from('saved_recipes').update({ is_favorite: !isFavorite }).eq('id', recipeId);
}

export async function getFavorites(): Promise<SavedRecipe[]> {
  const { data } = await supabase.from('saved_recipes').select('*').eq('is_favorite', true).order('title');
  return (data ?? []) as SavedRecipe[];
}

// ─── Popular Recipes ───

export async function getPopularRecipes(limit = 10): Promise<SavedRecipe[]> {
  const { data } = await supabase.from('saved_recipes').select('*').order('use_count', { ascending: false }).limit(limit);
  return (data ?? []) as SavedRecipe[];
}

export async function incrementUseCount(recipeId: string): Promise<void> {
  const { data } = await supabase.from('saved_recipes').select('use_count').eq('id', recipeId).single();
  const current = (data?.use_count as number) ?? 0;
  await supabase.from('saved_recipes').update({ use_count: current + 1 }).eq('id', recipeId);
}

// ─── Allergen Check ───

export function checkRecipeAllergens(
  recipe: SavedRecipe,
  userAllergens: string[],
): { safe: boolean; warnings: string[] } {
  if (!userAllergens.length) return { safe: true, warnings: [] };

  const warnings: string[] = [];
  const allergenLower = userAllergens.map(a => a.toLowerCase());

  for (const ing of recipe.ingredients) {
    const ingLower = ing.name.toLowerCase();
    for (const allergen of allergenLower) {
      if (ingLower.includes(allergen)) {
        warnings.push(`"${ing.name}" alerjen listenizdeki "${allergen}" icerir.`);
      }
    }
  }

  return { safe: warnings.length === 0, warnings };
}

// ─── Ingredient Substitution ───

const SUBSTITUTIONS: Record<string, { replacement: string; note_tr: string }[]> = {
  'sut': [{ replacement: 'badem sutu', note_tr: 'Laktoz intoleransi icin' }, { replacement: 'yulaf sutu', note_tr: 'Vegan alternatif' }],
  'tereyagi': [{ replacement: 'zeytinyagi', note_tr: 'Daha saglikli yag' }, { replacement: 'hindistancevizi yagi', note_tr: 'Laktoz-free' }],
  'un': [{ replacement: 'badem unu', note_tr: 'Glutensiz' }, { replacement: 'nohut unu', note_tr: 'Yuksek protein' }],
  'seker': [{ replacement: 'stevia', note_tr: 'Sifir kalori' }, { replacement: 'bal', note_tr: 'Dogal tatlandirici' }],
  'peynir': [{ replacement: 'tofu', note_tr: 'Vegan alternatif' }, { replacement: 'avokado', note_tr: 'Saglikli yag' }],
  'makarna': [{ replacement: 'kabak makarna', note_tr: 'Dusuk kalori' }, { replacement: 'mercimek makarna', note_tr: 'Yuksek protein' }],
  'pirinc': [{ replacement: 'kinoa', note_tr: 'Yuksek protein' }, { replacement: 'bulgur', note_tr: 'Dusuk glisemik' }],
  'ekmek': [{ replacement: 'tam bugday ekmek', note_tr: 'Daha fazla lif' }, { replacement: 'pirinc patlagi', note_tr: 'Dusuk kalori' }],
  'krema': [{ replacement: 'yogurt', note_tr: 'Dusuk yag' }, { replacement: 'hindistancevizi kremasi', note_tr: 'Laktoz-free' }],
  'yumurta': [{ replacement: 'chia tohumu + su', note_tr: 'Vegan (1 yumurta = 1yk chia + 3yk su)' }, { replacement: 'muz', note_tr: 'Tatli tariflerde' }],
};

export function suggestSubstitution(ingredientName: string): { replacement: string; note_tr: string }[] {
  const key = ingredientName.toLowerCase().trim();
  // Direct match
  if (SUBSTITUTIONS[key]) return SUBSTITUTIONS[key];
  // Partial match
  for (const [k, v] of Object.entries(SUBSTITUTIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return [];
}

// ─── Nutrition Breakdown ───

export function getRecipeNutritionBreakdown(recipe: SavedRecipe): {
  perServing: { calories: number; protein: number; carbs: number; fat: number };
  perIngredient: { name: string; calories: number; protein: number; carbs: number; fat: number }[];
} {
  const perIngredient = recipe.ingredients.map(ing => ({
    name: ing.name,
    calories: ing.calories ?? 0,
    protein: ing.protein_g ?? 0,
    carbs: ing.carbs_g ?? 0,
    fat: ing.fat_g ?? 0,
  }));

  const totalCal = perIngredient.reduce((s, i) => s + i.calories, 0);
  const totalPro = perIngredient.reduce((s, i) => s + i.protein, 0);
  const totalCarb = perIngredient.reduce((s, i) => s + i.carbs, 0);
  const totalFat = perIngredient.reduce((s, i) => s + i.fat, 0);
  const servings = recipe.servings || 1;

  return {
    perServing: {
      calories: Math.round(totalCal / servings),
      protein: Math.round(totalPro / servings),
      carbs: Math.round(totalCarb / servings),
      fat: Math.round(totalFat / servings),
    },
    perIngredient,
  };
}

// ─── Recipe Planning Integration (Phase 6) ───

/**
 * Get recipes suitable for weekly plan integration.
 * Returns favorites + most used recipes, formatted for AI plan prompt.
 */
export async function getRecipesForPlanning(
  userId: string,
  limit = 10
): Promise<{ title: string; calories: number; protein: number; category: string; prepTime: number }[]> {
  const { data: favorites } = await supabase
    .from('saved_recipes')
    .select('title, total_calories, total_protein, category, prep_time_min')
    .eq('user_id', userId)
    .eq('is_favorite', true)
    .order('use_count', { ascending: false })
    .limit(Math.ceil(limit / 2));

  const { data: popular } = await supabase
    .from('saved_recipes')
    .select('title, total_calories, total_protein, category, prep_time_min')
    .eq('user_id', userId)
    .order('use_count', { ascending: false })
    .limit(limit);

  // Merge and deduplicate
  const all = [...(favorites ?? []), ...(popular ?? [])];
  const seen = new Set<string>();
  const unique: typeof all = [];

  for (const r of all) {
    const key = (r.title as string).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique.slice(0, limit).map(r => ({
    title: r.title as string,
    calories: (r.total_calories as number) ?? 0,
    protein: (r.total_protein as number) ?? 0,
    category: (r.category as string) ?? 'dinner',
    prepTime: (r.prep_time_min as number) ?? 0,
  }));
}

/**
 * Format recipes for AI plan prompt inclusion.
 */
export function formatRecipesForPrompt(
  recipes: { title: string; calories: number; protein: number; category: string; prepTime: number }[]
): string {
  if (recipes.length === 0) return '';

  const lines = recipes.map(r =>
    `- ${r.title} (${r.calories}kcal, ${r.protein}g protein, ${r.category}, ${r.prepTime}dk)`
  );

  return `\nKULLANICININ KAYITLI TARIFLERI (mumkunse bunlari tercih et):\n${lines.join('\n')}`;
}
