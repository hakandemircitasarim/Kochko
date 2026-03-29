/**
 * Recipe Library Service — Spec 7.7
 * Full CRUD with ingredients, instructions, cooking time, difficulty,
 * macro totals, category filtering, and macro-based suggestions.
 */
import { supabase } from '@/lib/supabase';

export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
  calories?: number;
  protein_g?: number;
}

export interface SavedRecipe {
  id: string;
  name: string;
  category: string;
  ingredients: RecipeIngredient[];
  instructions: string;
  total_calories: number;
  total_protein: number;
  prep_time_min: number;
  cook_time_min: number;
  servings: number;
  tags: string[];
  source: string;
  use_count: number;
  created_at: string;
}

export async function getRecipes(category?: string): Promise<SavedRecipe[]> {
  let query = supabase.from('saved_recipes').select('*').order('use_count', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data } = await query;
  return (data ?? []) as SavedRecipe[];
}

export async function searchRecipes(searchText: string): Promise<SavedRecipe[]> {
  const { data } = await supabase
    .from('saved_recipes')
    .select('*')
    .or(`name.ilike.%${searchText}%,instructions.ilike.%${searchText}%`)
    .order('use_count', { ascending: false })
    .limit(20);
  return (data ?? []) as SavedRecipe[];
}

export async function saveRecipe(recipe: Omit<SavedRecipe, 'id' | 'use_count' | 'created_at'>): Promise<{ error: string | null }> {
  if (!recipe.name.trim()) return { error: 'Tarif adi gerekli.' };
  if (recipe.total_calories <= 0) return { error: 'Kalori sifirdan buyuk olmali.' };

  const { error } = await supabase.from('saved_recipes').insert({ ...recipe, use_count: 0 });
  return { error: error?.message ?? null };
}

export async function updateRecipe(id: string, updates: Partial<SavedRecipe>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('saved_recipes').update(updates).eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteRecipe(id: string): Promise<void> {
  await supabase.from('saved_recipes').delete().eq('id', id);
}

export async function useRecipe(id: string): Promise<void> {
  const { data } = await supabase.from('saved_recipes').select('use_count').eq('id', id).single();
  if (data) {
    await supabase.from('saved_recipes').update({ use_count: ((data.use_count as number) ?? 0) + 1 }).eq('id', id);
  }
}

/**
 * Get recipes that fit within remaining daily macros.
 */
export async function getRecipesForRemainingMacros(
  remainingCal: number,
  category?: string,
): Promise<SavedRecipe[]> {
  let query = supabase.from('saved_recipes').select('*')
    .lte('total_calories', remainingCal + 100)
    .order('use_count', { ascending: false })
    .limit(5);
  if (category) query = query.eq('category', category);
  const { data } = await query;
  return (data ?? []) as SavedRecipe[];
}

/**
 * Calculate macro totals from ingredient list.
 */
export function calcIngredientTotals(ingredients: RecipeIngredient[]): { calories: number; protein: number } {
  return ingredients.reduce(
    (t, i) => ({ calories: t.calories + (i.calories ?? 0), protein: t.protein + (i.protein_g ?? 0) }),
    { calories: 0, protein: 0 },
  );
}
