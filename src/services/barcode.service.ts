/**
 * Barcode Scanning Service
 * Spec 3.1, 19.3: Barkod okuma + Türk besin veritabanı stratejisi
 *
 * Priority order (Spec 3.3):
 * 1. User's past corrections (personal overrides)
 * 2. Barcode database match (most reliable)
 * 3. Venue memory
 * 4. AI estimate
 */

// For MVP: use OpenFoodFacts API (free, open source)
// Future: GS1 Turkey + Market APIs + community data

import { supabase } from '@/lib/supabase';

export interface BarcodeResult {
  found: boolean;
  product_name: string | null;
  brand: string | null;
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  serving_size_g: number | null;
  source: 'openfoodfacts' | 'community' | 'user_correction' | 'not_found';
  confidence: 'high' | 'medium' | 'low';
}

export interface UserCorrectionData {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion_g: number;
}

/**
 * Look up barcode - checks user corrections first, then OpenFoodFacts.
 * Spec 19.1: Barkod veri tabani eslesmesi
 */
export async function lookupBarcode(barcode: string, userId?: string): Promise<BarcodeResult> {
  // 1. Check user corrections first
  if (userId) {
    const correction = await getUserCorrection(userId, barcode);
    if (correction) {
      return {
        found: true,
        product_name: correction.name,
        brand: null,
        calories_per_100g: Math.round((correction.calories / correction.portion_g) * 100),
        protein_per_100g: Math.round(((correction.protein_g / correction.portion_g) * 100) * 10) / 10,
        carbs_per_100g: Math.round(((correction.carbs_g / correction.portion_g) * 100) * 10) / 10,
        fat_per_100g: Math.round(((correction.fat_g / correction.portion_g) * 100) * 10) / 10,
        serving_size_g: correction.portion_g,
        source: 'user_correction',
        confidence: 'high',
      };
    }
  }

  // 2. OpenFoodFacts API
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );

    if (!response.ok) {
      if (userId) await logUnfoundBarcode(userId, barcode);
      return notFound();
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      if (userId) await logUnfoundBarcode(userId, barcode);
      return notFound();
    }

    const p = data.product;
    const nutriments = p.nutriments ?? {};

    return {
      found: true,
      product_name: p.product_name_tr ?? p.product_name ?? null,
      brand: p.brands ?? null,
      calories_per_100g: nutriments['energy-kcal_100g'] ?? null,
      protein_per_100g: nutriments.proteins_100g ?? null,
      carbs_per_100g: nutriments.carbohydrates_100g ?? null,
      fat_per_100g: nutriments.fat_100g ?? null,
      serving_size_g: p.serving_quantity ? parseFloat(p.serving_quantity) : null,
      source: 'openfoodfacts',
      confidence: 'high',
    };
  } catch {
    return notFound();
  }
}

/**
 * Log an unfound barcode for future community contribution (Spec 19.3).
 */
export async function logUnfoundBarcode(userId: string, barcode: string): Promise<void> {
  try {
    await supabase.from('barcode_corrections').insert({
      user_id: userId,
      barcode,
      food_name: '_UNFOUND_',
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      portion_g: 0,
    });
  } catch {
    // Silent fail - logging is best-effort
  }
}

/**
 * Save a user's personal correction for a barcode product.
 * Next lookups will check this before the API.
 */
export async function saveUserCorrection(
  userId: string,
  barcode: string,
  correctedData: UserCorrectionData
): Promise<void> {
  // Upsert: delete old unfound/correction entries for this user+barcode, then insert
  await supabase
    .from('barcode_corrections')
    .delete()
    .eq('user_id', userId)
    .eq('barcode', barcode);

  await supabase.from('barcode_corrections').insert({
    user_id: userId,
    barcode,
    food_name: correctedData.name,
    calories: correctedData.calories,
    protein_g: correctedData.protein_g,
    carbs_g: correctedData.carbs_g,
    fat_g: correctedData.fat_g,
    portion_g: correctedData.portion_g,
  });
}

/**
 * Get user's correction for a barcode, if any.
 */
async function getUserCorrection(
  userId: string,
  barcode: string
): Promise<UserCorrectionData | null> {
  const { data } = await supabase
    .from('barcode_corrections')
    .select('food_name, calories, protein_g, carbs_g, fat_g, portion_g')
    .eq('user_id', userId)
    .eq('barcode', barcode)
    .neq('food_name', '_UNFOUND_')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    name: data.food_name,
    calories: Number(data.calories),
    protein_g: Number(data.protein_g),
    carbs_g: Number(data.carbs_g),
    fat_g: Number(data.fat_g),
    portion_g: Number(data.portion_g),
  };
}

function notFound(): BarcodeResult {
  return {
    found: false,
    product_name: null,
    brand: null,
    calories_per_100g: null,
    protein_per_100g: null,
    carbs_per_100g: null,
    fat_per_100g: null,
    serving_size_g: null,
    source: 'not_found',
    confidence: 'low',
  };
}

/**
 * Calculate nutrition for a given serving size.
 */
export function calculateServing(result: BarcodeResult, servingGrams: number): {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
} | null {
  if (!result.found || !result.calories_per_100g) return null;

  const factor = servingGrams / 100;
  return {
    calories: Math.round((result.calories_per_100g ?? 0) * factor),
    protein_g: Math.round(((result.protein_per_100g ?? 0) * factor) * 10) / 10,
    carbs_g: Math.round(((result.carbs_per_100g ?? 0) * factor) * 10) / 10,
    fat_g: Math.round(((result.fat_per_100g ?? 0) * factor) * 10) / 10,
  };
}
