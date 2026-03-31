/**
 * Saved Recipes Service
 * Spec 7.7: Tarif kütüphanesi
 */
import { supabase } from '@/lib/supabase';

export interface SavedRecipe {
  id: string;
  title: string;
  category: string | null;
  ingredients: { name: string; amount: string; unit: string }[];
  instructions: string;
  total_calories: number | null;
  total_protein: number | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  servings: number;
  created_at: string;
}

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
