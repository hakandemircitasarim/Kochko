/**
 * plan-compact.ts — let the model WRITE a diet plan compactly, store it in the full schema.
 *
 * WHY (measured 2026-10-04): a 7-day diet snapshot was ~4,200 output tokens and took 34–50 s to
 * generate — output-bound, ~125 tokens/s. About half of those tokens were the same keys repeated
 * on every item ("name", "grams", "kcal", "protein", "carbs", "fat") plus per-meal totals the
 * server recomputes anyway. The model now writes each item as a positional row
 * [name, grams, kcal, protein, carbs, fat] and omits totals; this module expands that back into the
 * exact object shape the client, the projection and "Bunu yedim" already read. Object items still
 * pass through untouched, so an older-format reply (or a JSON-mode regen) keeps working.
 */

type Rec = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function expandItem(it: unknown): Rec | null {
  if (Array.isArray(it)) {
    const [name, grams, kcal, protein, carbs, fat] = it;
    if (typeof name !== 'string' || !name.trim()) return null;
    return {
      name: name.trim(),
      grams: num(grams) || null,
      kcal: num(kcal),
      protein: num(protein),
      carbs: num(carbs),
      fat: num(fat),
    };
  }
  return it && typeof it === 'object' ? (it as Rec) : null;
}

/** Expand compact item rows in place and fill missing meal totals from the items. */
export function expandCompactDietSnapshot(snap: Rec | null): Rec | null {
  if (!snap || typeof snap !== 'object') return snap;
  const days = Array.isArray(snap.days) ? snap.days as Rec[] : [];
  for (const day of days) {
    const meals = Array.isArray(day?.meals) ? day.meals as Rec[] : [];
    for (const meal of meals) {
      if (!meal || typeof meal !== 'object') continue;
      const items = (Array.isArray(meal.items) ? meal.items : []).map(expandItem).filter((x): x is Rec => x !== null);
      meal.items = items;
      const sum = (k: string) => Math.round(items.reduce((s, i) => s + num(i[k]), 0));
      if (items.length > 0) {
        if (meal.total_kcal == null) meal.total_kcal = sum('kcal');
        if (meal.total_protein == null) meal.total_protein = sum('protein');
        if (meal.total_carbs == null) meal.total_carbs = sum('carbs');
        if (meal.total_fat == null) meal.total_fat = sum('fat');
      }
    }
  }
  return snap;
}
