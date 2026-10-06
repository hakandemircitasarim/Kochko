/**
 * meal_log — nugget / lahmacun / çimdik (AI_MIMARI_V2 §4.4 (2); final2#4/#5/#8/#12).
 *
 * The MODEL's per-item numbers are what gets stored. The food table is a list of hints the model
 * may pick (`reference_key`); only then does code do grams × per-100 g arithmetic, and the model's
 * own kcal stays in `model_kcal`. resolveFood never chooses, no cooking multiplier, no kcal
 * recompute, no name-dedupe: "6 tavuk nugget" = the model's ~300 kcal, "2 çimdik tuz" = 0,7 g.
 */
import { f, op, rule, type ValidationContext } from '../dsl.ts';
import { ALLERGENS, MEAL_TYPES } from '../vocab.ts';
import { resolveDay, roundTo, trNum } from '../util.ts';

/** One meal above this many kcal is asked about (§5.1.6). */
export const MEAL_TOTAL_ASK_KCAL = 2500;
/** Pure fat is ~9 kcal/g; above this the item's numbers cannot both be right (§5.1.6). */
export const MAX_KCAL_PER_G = 9.5;
/** Macro/kcal disagreement tolerance (alcohol counted at 7 kcal/g). */
export const MACRO_TOLERANCE = 0.25;
/** Below this absolute gap a macro mismatch is noise (a black coffee, a pinch of salt). */
export const MACRO_TOLERANCE_MIN_KCAL = 40;
/** Model kcal vs the reference it picked: beyond this the pick is probably the wrong food. */
export const REF_DIVERGENCE = 0.35;
export const LOW_CONFIDENCE = 0.5;

const itemFields = {
  name: f.text({ max: 80, tr: 'yiyeceğin adı ("tavuk nugget", "tuz")' }),
  as_stated: f.text({ max: 60, tr: 'miktar kullanıcının ifadesiyle: "6 adet", "2 çimdik", "yarım tabak". Kod ayrıştırmaz, aynen saklar.' }),
  grams: f.num({ unit: 'g', nullable: true, hard: [0, 3000], decimals: 1, tr: 'SENİN gram tahminin; gerçekten bilinmiyorsa null' }),
  kcal: f.num({ unit: 'kcal', hard: [0, 5000], decimals: 0, tr: 'SENİN kcal tahminin (pişirme dahil)' }),
  protein_g: f.num({ unit: 'g', hard: [0, 400], decimals: 1 }),
  carbs_g: f.num({ unit: 'g', hard: [0, 800], decimals: 1 }),
  fat_g: f.num({ unit: 'g', hard: [0, 400], decimals: 1 }),
  alcohol_g: f.num({ unit: 'g', hard: [0, 300], decimals: 1, tr: 'saf alkol gramı (bira, şarap, rakı); yoksa 0' }),
  caffeine_mg: f.num({ unit: 'mg', hard: [0, 1500], decimals: 0, tr: 'kafein (kahve, çay, kola, enerji içeceği); yoksa 0' }),
  preparation: f.text({ nullable: true, max: 40, tr: 'bu kalemin pişirme biçimi (kızartma, ızgara…); bilinmiyorsa null' }),
  allergens: f.enumList(ALLERGENS, { tr: 'kalemin KESİN alerjen kaynakları' }),
  may_contain: f.enumList(ALLERGENS, { tr: 'kaynağı belirsiz OLASI alerjenler' }),
  reference_key: f.text({ nullable: true, tr: 'YALNIZCA REFERANS ADAYLARI’ndan ve gerçekten aynı yiyecekse; değilse null' }),
  confidence: f.num({ hard: [0, 1], tr: 'tahmin güvenin 0–1' }),
} as const;

interface ItemNumbers { kcal: number; protein_g: number; carbs_g: number; fat_g: number; alcohol_g: number }

/** What the stored item numbers will be: the model's, or grams × the reference the model picked. */
function storedNumbers(it: ItemNumbers & { grams: number | null; reference_key: string | null }, ctx: ValidationContext): {
  data_source: 'reference' | 'ai_estimate';
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  model_kcal?: number;
} {
  const ref = it.reference_key ? ctx.reference_rows?.[it.reference_key] : undefined;
  if (!ref || it.grams === null) {
    return { data_source: 'ai_estimate', kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g };
  }
  const k = it.grams / 100;
  const per = (v: number | null | undefined, fallback: number) => (typeof v === 'number' ? roundTo(k * v, 1) : fallback);
  return {
    data_source: 'reference',
    kcal: Math.round(k * ref.kcal_per_100g),
    protein_g: per(ref.protein_per_100g, it.protein_g),
    carbs_g: per(ref.carbs_per_100g, it.carbs_g),
    fat_g: per(ref.fat_per_100g, it.fat_g),
    model_kcal: it.kcal,
  };
}

function macroKcal(it: ItemNumbers): number {
  return 4 * it.protein_g + 4 * it.carbs_g + 9 * it.fat_g + 7 * it.alcohol_g;
}

export const meal_log = op({
  type: 'meal_log',
  channel: 'writes',
  envelope: 'meal_log',
  title_tr: 'Öğün',
  when_tr: 'Kullanıcı ŞİMDİ yediğini/içtiğini (sade su hariç) bildiriyorsa.',
  not_when_tr: 'Soru, plan, simülasyon ("yesem?") ve KAYITLAR’da zaten olan öğün kayıt değildir. Zaten kayıtlıyı anlatıyorsa status=restatement.',
  fields: {
    day: f.day(),
    meal_type: f.enum(MEAL_TYPES),
    time_local: f.text({ nullable: true, format: 'hhmm', tr: 'yendiği saat 24s HH:MM; bilinmiyorsa null' }),
    raw: f.text({ max: 300, tr: 'kullanıcının bu öğünü anlatan sözleri, aynen' }),
    status: f.enum({ new: 'yeni yenen', restatement: 'zaten kayıtlı öğünü anlatıyor — yazılmaz' }),
    venue: f.text({ nullable: true, max: 80, tr: 'dışarıda yendiyse mekân adı; öğünle birlikte geri alınır' }),
    replaces: f.ref(['m'], { nullable: true, tr: 'bu öğün KAYITLAR’daki bir öğünün düzeltilmiş hâliyse onun m-ref’i' }),
    items: f.list({ min: 1, max: 20 }, itemFields),
  },
  derive: (a, ctx) => {
    const items = a.items.map((it) => storedNumbers(it, ctx));
    return {
      date: resolveDay(a.day, ctx.today),
      items,
      total_kcal: items.reduce((s, it) => s + it.kcal, 0),
      caffeine_mg: a.items.reduce((s, it) => s + it.caffeine_mg, 0),
      alcohol_g: roundTo(a.items.reduce((s, it) => s + it.alcohol_g, 0), 1),
    };
  },
  derive_tr: 'reference_key seçtiysen kalemin kcal/makrosu = gram × referans/100 (senin kcal’ın model_kcal’da saklanır); seçmediysen SENİN sayıların aynen. Toplam kcal, kafein ve alkol toplanır.',
  noop: (a) => a.status === 'restatement' && 'zaten kayıtlı öğünü anlatıyor (restatement) — yazılmadı',
  writes: { rpc: 'w_meal_apply', tables: ['meal_logs', 'meal_log_items', 'user_venues', 'turn_writes'], undo: 'soft_delete' },
  invariants: ['allergen_consumption_check', 'budget_refresh', 'caffeine_from_items', 'meal_time_learning'],
  examples_tr: [
    '"6 tavuk nugget yedim" → name "tavuk nugget", as_stated "6 adet", grams ~110, kcal ~320; tavuk göğsü adayı SEÇİLMEZ',
    '"yumurtaya 2 çimdik tuz attım" → name "tuz", as_stated "2 çimdik", grams 0.7, kcal 0 — reddedilmez',
    '"2 dilim lahmacun" → 2 bütün lahmacun (~260 g) ya da emin değilsen clarify',
  ],
}).rules({
  hard: [
    rule('referans_listede_yok', 'reference_key yalnızca bu turdaki REFERANS ADAYLARI’ndan olabilir', (a, _d, ctx) => {
      const bad = a.items.filter((it) => it.reference_key !== null && !ctx.reference_rows?.[it.reference_key]);
      return bad.length > 0 && `listede olmayan referans: ${bad.map((it) => it.reference_key).join(', ')}`;
    }, { repairable: true, failure_class: 'invalid_ref' }),
    rule('referans_gramsiz', 'reference_key seçtiysen grams boş olamaz', (a) =>
      a.items.some((it) => it.reference_key !== null && it.grams === null), { repairable: true, failure_class: 'missing_field' }),
  ],
  ask: [
    rule('ogun_cok_yuksek', `tek öğün ${MEAL_TOTAL_ASK_KCAL} kcal üstü`, (_a, d) =>
      d.total_kcal > MEAL_TOTAL_ASK_KCAL && `bu öğün toplam ${d.total_kcal} kcal — porsiyonlar doğru mu?`,
      { question_tr: 'Bu öğün çok yüksek kalorili çıktı; porsiyonları doğru anladım mı?' }),
    rule('referans_sapmasi', `seçtiğin referansla kendi tahminin %${REF_DIVERGENCE * 100}’ten fazla farklı`, (a, d) => {
      const off = a.items.filter((it, i) => {
        const s = d.items[i];
        return s.data_source === 'reference' && Math.abs(s.kcal - it.kcal) > REF_DIVERGENCE * Math.max(s.kcal, it.kcal, 1);
      });
      return off.length > 0 && `referans ile tahmin uyuşmuyor: ${off.map((it) => it.name).join(', ')} — seçilen referans bu yiyecek olmayabilir`;
    }, { question_tr: 'Yediğin şeyi doğru eşleştirdiğimden emin olmak istiyorum; tam olarak neydi?' }),
  ],
  flag: [
    rule('enerji_yogunlugu', `kcal/gram ${trNum(MAX_KCAL_PER_G, 1)} üstü (saf yağdan yoğun)`, (a) => {
      const off = a.items.filter((it) => it.grams !== null && it.grams > 0 && it.kcal / it.grams > MAX_KCAL_PER_G);
      return off.length > 0 && `fiziksel olarak çok yoğun: ${off.map((it) => it.name).join(', ')}`;
    }),
    rule('makro_kcal_uyumsuz', `makrolar (alkol dahil) ile kcal %${MACRO_TOLERANCE * 100}’ten fazla uyuşmuyor`, (a) => {
      const off = a.items.filter((it) => Math.abs(macroKcal(it) - it.kcal) > Math.max(MACRO_TOLERANCE * it.kcal, MACRO_TOLERANCE_MIN_KCAL));
      return off.length > 0 && `makro/kcal uyumsuz: ${off.map((it) => it.name).join(', ')} (yeniden hesaplanmadı)`;
    }),
    rule('dusuk_guven', `güveni ${trNum(LOW_CONFIDENCE, 1)} altında kalem`, (a) => {
      const off = a.items.filter((it) => it.confidence < LOW_CONFIDENCE);
      return off.length > 0 && `tahmin belirsiz: ${off.map((it) => it.name).join(', ')}`;
    }),
  ],
});
