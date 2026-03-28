/**
 * Barcode Scanning Service
 * Spec 3.1, 19.3: Barkod okuma + Türk besin veritabanı stratejisi
 *
 * Priority order (Spec 3.3):
 * 1. Barcode database match (most reliable)
 * 2. User's past corrections
 * 3. Venue memory
 * 4. AI estimate
 */

// For MVP: use OpenFoodFacts API (free, open source)
// Future: GS1 Turkey + Market APIs + community data

export interface BarcodeResult {
  found: boolean;
  product_name: string | null;
  brand: string | null;
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  serving_size_g: number | null;
  source: 'openfoodfacts' | 'community' | 'not_found';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Look up barcode from OpenFoodFacts API.
 * Spec 19.1: Barkod veri tabanı eşleşmesi
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeResult> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );

    if (!response.ok) {
      return notFound();
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      // Barcode not found - log for future community contribution (Spec 19.3)
      // TODO: Store unfound barcode for community contribution flow
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
