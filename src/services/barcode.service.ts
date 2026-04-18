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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// ─── Offline cache (Spec 19.3: "daha once taranan urunler offline da calisir") ───

const CACHE_PREFIX = '@kochko_barcode:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CachedBarcode {
  result: BarcodeResult;
  cachedAt: number;
}

async function readCache(barcode: string): Promise<BarcodeResult | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + barcode);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedBarcode;
    if (!entry?.cachedAt || Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(CACHE_PREFIX + barcode);
      return null;
    }
    return entry.result;
  } catch {
    return null;
  }
}

async function writeCache(barcode: string, result: BarcodeResult): Promise<void> {
  if (!result.found) return; // don't cache misses
  try {
    const entry: CachedBarcode = { result, cachedAt: Date.now() };
    await AsyncStorage.setItem(CACHE_PREFIX + barcode, JSON.stringify(entry));
  } catch {
    // best-effort
  }
}

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
  // 1. Check user corrections first (most authoritative, always online-preferred)
  if (userId) {
    const correction = await getUserCorrection(userId, barcode);
    if (correction) {
      const result: BarcodeResult = {
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
      // refresh cache for offline reuse
      await writeCache(barcode, result);
      return result;
    }
  }

  // 2. Community-verified barcode (Spec 19.3, 3+ contributors)
  const community = await getCommunityBarcode(barcode);
  if (community) {
    await writeCache(barcode, community);
    return community;
  }

  // 3. OpenFoodFacts API
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );

    if (!response.ok) {
      // API unavailable (network / rate limit): fall through to cache
      const cached = await readCache(barcode);
      if (cached) return cached;
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

    const result: BarcodeResult = {
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
    await writeCache(barcode, result);
    return result;
  } catch {
    // Network error (likely offline): try cache
    const cached = await readCache(barcode);
    if (cached) return cached;
    return notFound();
  }
}

/**
 * Clear the entire barcode offline cache. Used when user explicitly resets
 * or when storage pressure requires eviction. Kept exported for tests/settings.
 */
export async function clearBarcodeCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(k => k.startsWith(CACHE_PREFIX));
    await Promise.all(ours.map(k => AsyncStorage.removeItem(k)));
  } catch {
    // best-effort
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
 * Get community-aggregated barcode data if 3+ distinct users have contributed
 * (Spec 19.3). Uses median over all verified contributions.
 */
async function getCommunityBarcode(barcode: string): Promise<BarcodeResult | null> {
  try {
    const { data, error } = await supabase.rpc('get_community_barcode', { p_barcode: barcode });
    if (error || !data) return null;
    // RPC returns a row set; take the first row
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.found || !row.portion_g || Number(row.portion_g) <= 0) return null;

    const portion = Number(row.portion_g);
    return {
      found: true,
      product_name: (row.food_name as string) ?? null,
      brand: null,
      calories_per_100g: Math.round((Number(row.calories) / portion) * 100),
      protein_per_100g: Math.round(((Number(row.protein_g) / portion) * 100) * 10) / 10,
      carbs_per_100g: Math.round(((Number(row.carbs_g) / portion) * 100) * 10) / 10,
      fat_per_100g: Math.round(((Number(row.fat_g) / portion) * 100) * 10) / 10,
      serving_size_g: portion,
      source: 'community',
      confidence: 'high',
    };
  } catch {
    return null;
  }
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
