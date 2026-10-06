/**
 * STRUCTURED SAFETY INVARIANTS — AI_MIMARI_V2 §7.1 (öneri değişmezi, tüketim denetimi, plan).
 *
 * The model is the food/exercise knowledge source: every suggested or logged food carries
 * `allergens[]` / `may_contain[]`, every exercise carries `loads[]` (body regions). Code only
 * intersects those TAGS with the user's safety spine:
 *
 *   (allergens ∪ may_contain ∪ dictionary hits on the item NAME) ∩ severe allergens = ∅
 *   (loads ∪ EXERCISE_BODY_PART_MAP hits on the exercise NAME)   ∩ injured regions  = ∅
 *
 * The dictionaries (guardrails.ALLERGEN_FOODS via checkAllergens, the exercise map via
 * filterExercisesByInjury) can only ADD a hit, never clear a tag — so everything today's
 * dictionary check blocks is still blocked (§7.4.2: the union is a superset). Known cost of that
 * guarantee: a name like "Yumurtasız pankek" still hits egg (one targeted regen, as today).
 *
 * Ids are matched leniently because the vocabulary (write-registry/vocab.ts) is being built in
 * parallel: Turkish legacy subjects ("fıstık", "deniz ürünleri"), English/EU-14 ids ("peanuts",
 * "tree_nuts", "crustaceans"), and `custom:<slug>` all compare through one concept matcher
 * (supplement-allergens.tagHitsAllergen). A vocab taxonomy can plug in through `expand`.
 *
 * Reads structured fields only — never the user's message, never prose. Pure, no I/O.
 */
import { checkAllergens, extractInjuredBodyParts, filterExercisesByInjury } from './guardrails.ts';
import { tagHitsAllergen } from './supplement-allergens.ts';

// ─── shared normalisation ────────────────────────────────────────────────────

function fold(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i')
    .replace(/\s+/g, ' ').trim();
}

/** EU-14 / English ids → the Turkish names the dictionary and the concept matcher know.
 * Categories map to categories, members to members ("walnut" → "ceviz", NOT to the nut
 * category), so a walnut allergy does not block almonds. Keys are folded. */
const EN_ALLERGEN_ALIAS: Record<string, string> = {
  gluten: 'gluten', 'cereals containing gluten': 'gluten', cereals: 'gluten', wheat: 'gluten', barley: 'gluten', rye: 'gluten',
  crustaceans: 'kabuklu', crustacean: 'kabuklu', shellfish: 'kabuklu',
  // The legacy "kabuklu" list already includes the molluscs users mean (midye, kalamar, istiridye).
  molluscs: 'kabuklu', mollusks: 'kabuklu', mollusc: 'kabuklu', mollusk: 'kabuklu',
  seafood: 'deniz ürünleri',
  shrimp: 'karides', prawn: 'karides', lobster: 'istakoz', crab: 'yengeç', mussel: 'midye', oyster: 'istiridye', squid: 'kalamar', octopus: 'ahtapot',
  eggs: 'yumurta', egg: 'yumurta',
  fish: 'balık',
  peanuts: 'fıstık', peanut: 'fıstık',
  soybeans: 'soya', soybean: 'soya', soy: 'soya',
  milk: 'süt', dairy: 'süt', lactose: 'laktoz',
  'tree nuts': 'fındık', 'tree nut': 'fındık', nuts: 'fındık',
  walnut: 'ceviz', walnuts: 'ceviz', almond: 'badem', almonds: 'badem', cashew: 'kaju', cashews: 'kaju',
  pistachio: 'antep fıstığı', pistachios: 'antep fıstığı', pecan: 'pekan', macadamia: 'makadamya', 'brazil nut': 'brezilya fıstığı',
  sesame: 'susam', celery: 'kereviz', mustard: 'hardal',
  sulphites: 'sülfit', sulfites: 'sülfit', sulphite: 'sülfit', sulfite: 'sülfit',
  lupin: 'acı bakla', lupine: 'acı bakla',
};

function normAllergen(x: string): string {
  let s = (x ?? '').trim().toLocaleLowerCase('tr');
  if (s.startsWith('custom:')) s = s.slice('custom:'.length);
  s = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return EN_ALLERGEN_ALIAS[fold(s)] ?? s;
}

function allergenTerms(x: string, expand?: (id: string) => readonly string[]): string[] {
  const out = new Set<string>([normAllergen(x)]);
  for (const e of expand?.(x) ?? []) out.add(normAllergen(e));
  return [...out].filter(Boolean);
}

// ─── allergens ───────────────────────────────────────────────────────────────

export interface ItemAllergenTags {
  /** Item name — scanned with the allergen dictionary (adds hits only). */
  name?: string | null;
  allergens?: readonly string[] | null;
  may_contain?: readonly string[] | null;
}

export interface AllergenHit {
  /** The user's allergen exactly as passed in. */
  allergen: string;
  /** Strongest evidence: the model's certain tag > its may_contain tag > the name dictionary. */
  via: 'allergens' | 'may_contain' | 'name';
  /** The item tag that hit (null for a name-dictionary hit). */
  tag: string | null;
}

export interface AllergenHitOptions {
  /** Vocabulary hook: aliases/parents of an id (e.g. 'hazelnut' → ['tree_nuts']). */
  expand?: (id: string) => readonly string[];
  /** Union the name dictionary (default true; turn off only for tag-only unit checks). */
  nameDictionary?: boolean;
}

/**
 * §7.1 allergen invariant for ONE item. Returns one hit per user allergen that the item touches;
 * an empty array means the invariant holds. Pass the SEVERE set (severeAllergenSubjects) for the
 * suggestion/plan invariant, or the whole spine for the consumption check.
 * A bare string array is read as the item's certain `allergens` tags.
 */
export function allergenTagsHit(
  itemTags: ItemAllergenTags | readonly string[],
  userSevereAllergens: readonly string[],
  opts: AllergenHitOptions = {},
): AllergenHit[] {
  const item: ItemAllergenTags = Array.isArray(itemTags) ? { allergens: itemTags as readonly string[] } : itemTags as ItemAllergenTags;
  const sources: { tag: string; via: 'allergens' | 'may_contain' }[] = [
    ...(item.allergens ?? []).filter((t): t is string => typeof t === 'string' && !!t.trim()).map((tag) => ({ tag, via: 'allergens' as const })),
    ...(item.may_contain ?? []).filter((t): t is string => typeof t === 'string' && !!t.trim()).map((tag) => ({ tag, via: 'may_contain' as const })),
  ];
  const name = (item.name ?? '').trim();
  const useName = opts.nameDictionary !== false && name.length > 0;
  const hits: AllergenHit[] = [];
  for (const allergen of userSevereAllergens) {
    if (typeof allergen !== 'string' || !allergen.trim()) continue;
    const uTerms = allergenTerms(allergen, opts.expand);
    let hit: AllergenHit | null = null;
    for (const s of sources) {
      const tTerms = allergenTerms(s.tag, opts.expand);
      const touches = tTerms.some((a) => uTerms.some((b) => fold(a) === fold(b) || tagHitsAllergen(a, b)));
      if (touches) { hit = { allergen, via: s.via, tag: s.tag }; break; } // sources are ordered certain-first
    }
    if (!hit && useName && uTerms.some((u) => !checkAllergens(name, [u]).passed)) hit = { allergen, via: 'name', tag: null };
    if (hit) hits.push(hit);
  }
  return hits;
}

// ─── injuries ────────────────────────────────────────────────────────────────

/** Body-region keys the exercise dictionary speaks (guardrails INJURY_KEYWORDS / EXERCISE_BODY_PART_MAP). */
const REGION_KEYS = new Set(['knee', 'back', 'shoulder', 'ankle', 'wrist', 'elbow', 'hip', 'neck', 'hamstring', 'quad', 'groin']);

/** Plural/sub-region spellings → the dictionary key. Sub-regions roll UP (fail-safe: an injured
 * "back" is hit by a "lower_back" load, and two back sub-regions hit each other). */
const REGION_ALIAS: Record<string, string> = {
  knees: 'knee', shoulders: 'shoulder', ankles: 'ankle', wrists: 'wrist', elbows: 'elbow', hips: 'hip',
  hamstrings: 'hamstring', quads: 'quad', quadriceps: 'quad',
  lower_back: 'back', upper_back: 'back', lumbar: 'back', spine: 'back',
};

function regionTerms(x: string, expand?: (region: string) => readonly string[]): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const k = fold(raw ?? '').replace(/[\s-]+/g, '_');
    if (!k) return;
    out.add(REGION_ALIAS[k] ?? k);
    // Turkish labels ("diz", "sol omuz", "bel") → dictionary keys.
    if (!REGION_KEYS.has(REGION_ALIAS[k] ?? k)) for (const p of extractInjuredBodyParts([raw])) out.add(p);
  };
  add(x);
  for (const e of expand?.(x) ?? []) add(e);
  return [...out];
}

export interface ExerciseLoads {
  /** Exercise name — scanned with the exercise→body-part dictionary (adds hits only). */
  name?: string | null;
  loads?: readonly string[] | null;
}

export interface InjuryHit {
  /** The user's injured region exactly as passed in. */
  region: string;
  via: 'loads' | 'name';
  /** The exercise load that hit (null for a name-dictionary hit). */
  load: string | null;
}

export interface InjuryHitOptions {
  /** Vocabulary hook: aliases/parents of a region id. */
  expand?: (region: string) => readonly string[];
  nameDictionary?: boolean;
}

/**
 * §7.1 injury invariant for ONE exercise. One hit per injured region the exercise loads; empty
 * means the invariant holds. A bare string array is read as the exercise's `loads`.
 */
export function injuryLoadHit(
  exerciseLoads: ExerciseLoads | readonly string[],
  injuredRegions: readonly string[],
  opts: InjuryHitOptions = {},
): InjuryHit[] {
  const ex: ExerciseLoads = Array.isArray(exerciseLoads) ? { loads: exerciseLoads as readonly string[] } : exerciseLoads as ExerciseLoads;
  const loads = (ex.loads ?? []).filter((l): l is string => typeof l === 'string' && !!l.trim());
  const name = (ex.name ?? '').trim();
  const useName = opts.nameDictionary !== false && name.length > 0;
  const regions = injuredRegions.filter((r): r is string => typeof r === 'string' && !!r.trim());
  const regionKeys = regions.map((r) => ({ region: r, terms: regionTerms(r, opts.expand) }));

  // Dictionary on the NAME: which dictionary regions does this exercise load (∩ the injured ones)?
  let nameParts: string[] = [];
  if (useName && regions.length > 0) {
    const all = [...new Set(regionKeys.flatMap((r) => r.terms))];
    nameParts = filterExercisesByInjury([name], all).excluded[0]?.bodyParts ?? [];
  }

  const hits: InjuryHit[] = [];
  for (const { region, terms } of regionKeys) {
    let hit: InjuryHit | null = null;
    for (const load of loads) {
      const lTerms = regionTerms(load, opts.expand);
      if (lTerms.some((t) => terms.includes(t))) { hit = { region, via: 'loads', load }; break; }
    }
    if (!hit && nameParts.some((p) => terms.includes(p))) hit = { region, via: 'name', load: null };
    if (hit) hits.push(hit);
  }
  return hits;
}

// ─── spine → the sets the invariants run against ─────────────────────────────

/** A user_constraints row (v1 shape or v2 constraint_add shape), as loaded. */
export interface SpineRow {
  kind?: string | null;
  subject?: string | null;
  /** Legacy food_preferences rows carry the allergen in `name`. */
  name?: string | null;
  severity?: string | null;
  body_parts?: readonly string[] | null;
  whose?: string | null;
  polarity?: string | null;
  active?: boolean | null;
}

const ownActive = (r: SpineRow): boolean =>
  r.active !== false && r.whose !== 'other_person' && r.polarity !== 'does_not_have';

/**
 * The set the suggestion/plan invariant runs against. §7.1: severity=unknown counts as SEVERE in
 * every filter until clarified — and a missing severity (legacy rows) is unknown, not mild.
 */
export function severeAllergenSubjects(rows: readonly SpineRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.kind && r.kind !== 'allergen' && r.kind !== 'intolerance') continue;
    if (!ownActive(r)) continue;
    if (r.severity === 'mild' || r.severity === 'moderate') continue;
    const s = (r.subject ?? r.name ?? '').trim();
    if (s) out.add(s);
  }
  return [...out];
}

/** Injured regions from active injury/surgery rows (body_parts, else the subject itself). */
export function injuredRegionsFromSpine(rows: readonly SpineRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.kind !== 'injury' && r.kind !== 'surgery') continue;
    if (!ownActive(r)) continue;
    const parts = (r.body_parts ?? []).filter((p) => typeof p === 'string' && p.trim());
    if (parts.length > 0) for (const p of parts) out.add(p.trim());
    else if (r.subject && r.subject.trim() && r.subject !== r.kind) out.add(r.subject.trim());
  }
  return [...out];
}

// ─── one call for Stage B's suggested_foods / suggested_exercises (T7) ───────

export interface SuggestionViolation {
  kind: 'food' | 'exercise';
  name: string;
  allergens: AllergenHit[];
  injuries: InjuryHit[];
}

/**
 * T7 "öneri etiketleri ∩ ciddi alerjen/sakat bölge = ∅" over a whole reply's suggestion lists.
 * Empty = the reply may go out; otherwise the caller runs ONE regen naming these items.
 */
export function checkSuggestionInvariants(
  suggestions: { foods?: readonly (ItemAllergenTags & { name?: string | null })[] | null; exercises?: readonly ExerciseLoads[] | null },
  safety: { severeAllergens: readonly string[]; injuredRegions: readonly string[] },
  opts: { allergenExpand?: (id: string) => readonly string[]; regionExpand?: (region: string) => readonly string[] } = {},
): SuggestionViolation[] {
  const out: SuggestionViolation[] = [];
  if (safety.severeAllergens.length > 0) {
    for (const f of suggestions.foods ?? []) {
      const a = allergenTagsHit(f, safety.severeAllergens, { expand: opts.allergenExpand });
      if (a.length > 0) out.push({ kind: 'food', name: (f.name ?? '').trim(), allergens: a, injuries: [] });
    }
  }
  if (safety.injuredRegions.length > 0) {
    for (const e of suggestions.exercises ?? []) {
      const i = injuryLoadHit(e, safety.injuredRegions, { expand: opts.regionExpand });
      if (i.length > 0) out.push({ kind: 'exercise', name: (e.name ?? '').trim(), allergens: [], injuries: i });
    }
  }
  return out;
}
