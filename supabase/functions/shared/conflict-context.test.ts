import { assert, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { supabaseAdmin } from './supabase-admin.ts';
import { getConflictContext } from './service-contexts.ts';

// ─────────────────────────────────────────────────────────────────────────────
// getConflictContext — the allergen line never claims consumption from the raw message
// (AI_MIMARI_V2 Faz 0 #9 · final2#10 · mem#2). The "girdin / iyi misin" reaction check runs in
// ai-chat on meal items that actually persisted; this prompt note is a neutral mention only.
// ─────────────────────────────────────────────────────────────────────────────

type Rows = (table: string, filters: Record<string, unknown>) => unknown[];

/** Minimal chainable stand-in for supabaseAdmin.from(): every builder call returns the chain,
 *  awaiting it yields `rows(table, filters)`, maybeSingle() yields null. No network. */
async function withStubbedDb<T>(rows: Rows, fn: () => Promise<T>): Promise<T> {
  const client = supabaseAdmin as unknown as { from: unknown };
  const realFrom = client.from;
  client.from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self, gte: self, lte: self, order: self, limit: self,
      eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
      in: (k: string, v: unknown) => { filters[k] = v; return chain; },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(table, filters), error: null }).then(res, rej),
    });
    return chain;
  };
  try { return await fn(); } finally { client.from = realFrom; }
}

const allergenOnly = (food: string): Rows => (table, filters) =>
  table === 'food_preferences' && filters.is_allergen === true
    ? [{ food_name: food, allergen_severity: 'severe' }]
    : [];

Deno.test('final2#10: a fish-restaurant QUESTION gets a neutral mention note, never "iceren yemek girdin"', async () => {
  const out = await withStubbedDb(allergenOnly('deniz ürünleri'), () =>
    getConflictContext('u1', 'yarın akşam iş yemeği var, bi balık restoranına gidiyoruz galiba. nasıl idare edeyim?'));
  assertStringIncludes(out, 'ALERJEN ANILDI');
  assert(!out.includes('ALERJEN CELISKISI'), 'no contradiction label from a word match');
  assert(!/iceren yemek girdin/.test(out), 'no consumption claim');
  assert(!/Intoleransin degisti mi/.test(out), 'no nudge to question the allergy');
});

Deno.test('mem#2: an allergy RETRACTION does not read as eating the allergen', async () => {
  const out = await withStubbedDb(allergenOnly('yumurta'), () =>
    getConflictContext('u1', 'yumurta alerjim geçti bu arada, alerji testinde temiz çıktı'));
  assert(!/iceren yemek girdin/.test(out), 'no consumption claim on a retraction');
  assert(!out.includes('ALERJEN CELISKISI'));
});

Deno.test('Faz 0 #9: no allergen word in the message → no allergen line at all', async () => {
  const out = await withStubbedDb(allergenOnly('yumurta'), () =>
    getConflictContext('u1', 'bugün 40 dakika yürüdüm'));
  assert(!out.includes('ALERJEN'), out);
});
