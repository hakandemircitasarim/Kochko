/**
 * v2 Stage A — the understanding brain's prompt (docs/AI_MIMARI_V2.md §8.3, §3.2 T4).
 *
 * WHY: v1 let ~60 code nets decide what a message meant (24-regex detectTaskMode, water/step/backdate
 * strippers, repair regexes) and gave the model a hand-written pseudo-schema without units. Stage A
 * inverts that: the model reads the message and makes ONE strict-schema decision; code only checks it.
 * This file is the model's side of that contract: ~1.3K tokens of understanding rules, a slot for the
 * registry's generated Turkish field doc, and few-shot decisions for the cases v1 got wrong in
 * production (final2#1/#2/#3/#4/#6, mem#7, "2 çimdik tuz", third-person allergies, "bayıldım",
 * "kustum").
 *
 * The prefix is byte-identical for every user so it caches globally under one key. Nothing per-user
 * or per-turn belongs here; the TurnInput block, tripwire facts and the message are appended after it
 * by understand.ts.
 *
 * Bound to the REAL registry (shared/write-registry), not to a hand-typed copy of it:
 *   • decision types come from the envelope declarations (an intent the schema lacks does not compile);
 *   • a few-shot is authored sparse (empty fields left out, as the rules tell the model) and
 *     completeDecision() fills the rest from the registry's own field specs — every completed
 *     decision must pass the generated strict schema AND validateDecision with the verdict the
 *     example teaches (understand-prompt.test.ts);
 *   • the rendered JSON follows the schema's key order at every level;
 *   • context lines use the block titles the input renderer emits (BLOCK_TITLES, the tripwire block).
 */
import {
  BLOCK_TITLES, type Channel, ENVELOPE_HEAD, ENVELOPE_TAIL, findWireOp, type INTENT_PRIMARY, SCHEMA_VERSION, UNDERSTAND_CHANNELS,
} from '../../shared/write-registry/mod.ts';
import type { FieldSpec, Fields, Infer } from '../../shared/write-registry/dsl.ts';

/**
 * Global Stage A cache key (§3.2 T4). The prefix is these rules + few-shots (UNDERSTAND_PROMPT_VERSION)
 * + the registry doc (SCHEMA_VERSION), so the key names both. Bump the prompt version whenever the
 * rules or few-shots change.
 */
export const UNDERSTAND_PROMPT_VERSION = 'v2';
export const UNDERSTAND_CACHE_KEY = `kochko-understand:${UNDERSTAND_PROMPT_VERSION}-${SCHEMA_VERSION}`;

/** Decision-first top-level order of kochko_understand_vN (§3.2 T4); pinned to the schema by a test. */
export const UNDERSTAND_DECISION_KEYS = [
  'intent',
  'safety',
  'writes',
  'record_ops',
  'pending_ops',
  'commitment_ops',
  'plan_action',
  'simulation',
  'clarify',
  'reply_route',
  'self_check',
] as const;
export type DecisionKey = typeof UNDERSTAND_DECISION_KEYS[number];

/**
 * Block labels a few-shot context line may start with. The record/constraint/pending/commitment/
 * draft/reference blocks are the registry's BLOCK_TITLES (the doc's op texts point at the same
 * words); the tripwire block is shared/safety-tripwires.ts renderTripwireFacts' heading. A test
 * checks each label against the renderers, so the examples never teach a block that never appears.
 */
export const FEW_SHOT_CONTEXT_LABELS = [
  BLOCK_TITLES.records,
  BLOCK_TITLES.constraints,
  BLOCK_TITLES.pending,
  BLOCK_TITLES.commitments,
  BLOCK_TITLES.draft,
  BLOCK_TITLES.references,
  'BUGÜN',
  'SON KONUŞMA',
  'GÜVENLİK TETİKLERİ',
] as const;

export type IntentPrimary = keyof typeof INTENT_PRIMARY;

/** The rest of a value may be left out; completeDecision() fills it from the registry. */
type Sparse<T> = T extends readonly (infer U)[] ? Sparse<U>[] : T extends object ? { [K in keyof T]?: Sparse<T[K]> } : T;
type Head = Infer<typeof ENVELOPE_HEAD>;
type Tail = Infer<typeof ENVELOPE_TAIL>;

/** One item of a channel array as authored: the wire op + the fields that are not empty. */
export interface FewShotItem {
  op: string;
  [field: string]: unknown;
}

/**
 * A decision as the example shows it: only the non-empty fields. Envelope fields are typed from the
 * registry's envelope declarations; channel items are checked against their op by the schema test.
 */
export type FewShotDecision =
  & { intent: Sparse<Head['intent']> & { primary: IntentPrimary } }
  & { [K in 'safety']?: Sparse<Head[K]> }
  & { [K in keyof Tail]?: Sparse<Tail[K]> }
  & { [K in 'writes' | 'record_ops' | 'pending_ops' | 'commitment_ops']?: FewShotItem[] };

export interface UnderstandFewShot {
  id: string;
  /** TurnInput lines the decision depends on, each starting with a FEW_SHOT_CONTEXT_LABELS label. */
  context: readonly string[];
  message: string;
  /** Only the non-empty fields; the strict schema makes the model fill the rest. */
  decision: FewShotDecision;
  /** One sentence: the principle this example teaches. Rendered, because the reason generalises. */
  why: string;
}

export const UNDERSTAND_RULES = `# Kochko: anlama aşaması

Sen Kochko'nun anlama aşamasısın. Kişiye cevap yazmazsın: mesajı okur, ne olduğuna karar verir ve kararı şemadaki tek JSON olarak verirsin. Kod kararı denetler, geçenleri kaydeder; koç cevabını ondan sonra, olanlara bakarak yazar. Yanlış bir yazma kişinin günlüğünü bozar, yazılmayan bir şeyi ise koç tek soruyla tamamlar. Bu yüzden emin olmadığında yazma, clarify ile sordur.

1. Niyet. Mesaj şimdi olan bir şeyin bildirimi mi, soru mu, varsayım mı ("yesem ne olur", "yarın yapacağım"), düzeltme mi, onay mı, plan isteği mi? Kayıt yalnızca bildirimden ve düzeltmeden doğar. Soru, niyet, hedef ve varsayım kayıt değildir: "7-8 saat uyumam lazım mı?" uyku kaydı, "82,5'ta takıldım, neden?" tartı kaydı değildir.
2. Kimin hakkında. Kişinin kendisi mi, başkası mı (kızı, annesi, arkadaşı)? Başkasına ait alerji, yemek ya da ölçü kişinin kaydına yazılmaz; "kadın arkadaşımla yemeğe gittim" cinsiyet bilgisi değildir.
3. Gün. Günü bağlamdaki yerel tarihe göre ver: today, yesterday ya da YYYY-MM-DD. Gelecek tarih ve yedi günden eski kayıt yazılmaz.
4. Miktarın iki yüzü. as_stated kişinin ifadesidir ve aynen yazılır ("2 çimdik", "koca bir bardak", "annemin tabağı kadar"); kod onu ayrıştırmaz. Kanonik sayıyı sen verirsin: gram, kcal, makrolar. Ölçülebilir miktarda birimi listeden seç, listede yoksa other ile kendi ml tahminini yaz. Birim çevirmeyi kod yapar: 1 bardak su quantity 1, unit bardak'tır, 1 litre değil. Küçük miktarlar da geçerlidir; 2 çimdik tuz ~0,7 g ve 0 kcal'dir, soru gerektirmez.
5. Referans adayları ipucudur. Bir aday gerçekten aynı yiyecekse reference_key'e yaz; değilse boş bırak ve kendi tahminini ver. Kelime benzerliği aynı yiyecek demek değildir: tavuk nugget tavuk göğsü değildir.
6. Mevcut kayıtlar. Bağlamdaki kayıtlar m12, d3 gibi kısa ref'lerle gelir; geri alma ve düzeltme yalnızca bu listedeki bir ref'le yapılır. Kişi bir kaydı geri alıyorsa record_ops delete. Kişi gösterilen bir kaydın yanlış olduğunu söyleyip doğrusunu veriyorsa record_ops update: basis user_correction, düzeltme cümlesinden birebir evidence_quote, patch'te kaydın düzeltilmiş tam hâli. Aynı düzeltmeyi bir de replaces ile yeni yazma olarak ekleme; çift işlem olur. Kişi listede görünen bir öğünü yeniden anlatıyorsa status restatement olur; "bir muz daha" ise yeni yemektir. Makul görünmeyen eski bir kaydı (6 nugget için 1708 kcal) fark edersen kendin düzeltme: update'i basis suspicious ile öner; kod bekletir, koç bir kez sorar, kişi evet derse sonraki turda pending_ops confirm ile işlenir.
7. Emin değilsen sordur. Hangi kayıttan söz edildiği belli değilse (son turda iki yazma varken "sonuncuyu sil") yazma; clarify'a aday ref'leri koy. Bir soru kendiliğinden hiçbir kaydı silmez ya da değiştirmez.
8. Bağlantılar. Son asistan mesajı bağlamdadır; kısa bir cevap ("82", "evet", "2 bardak") ona verilmiş olabilir. Bekleyen onaylara (p#) ve açık sözlere (k#) bağlanan cevapları pending_ops ve commitment_ops ile bağla.
9. Güvenlik okuması. Bağlamda tetik varsa tripwire_reading'i gerekçesiyle doldur: kelime gerçek bir durumu mu anlatıyor ("antrenmanda bayıldım"), mecaz mı ("bu tatlıya bayıldım")? Emin değilsen benign deme; yanlış alarm bir cümleyle düzelir, kaçırılan acil düzelmez. Tetik olmasa da akut tıbbi durum, kendine zarar ya da yeme bozukluğu sinyali görürsen işaretle. Hastalık ya da zehirlenmeyle kusmak yeme bozukluğu sinyali değildir (illness_vomiting). ed_signal'in evidence_quote'u kişinin mesajından birebir alıntıdır; koçun cümleleri sinyal sayılmaz.
10. Alerji ve sakatlık. Her öğeyi ayrı yaz: "fıstık alerjim yok ama fındık var" iki kayıttır (does_not_have ve has). Şiddet söylenmediyse unknown yaz; kod onu netleşene kadar ciddi sayar. Bir kısıtın kaldırılması tek turda olmaz; kod onay ister.
11. Plan. Kişi açıkça plan istiyor, değiştiriyor ya da onaylıyorsa plan_action'ı buna göre seç; açık taslağa dönük her işlemde draft_ref taslağın ref'idir. Taslak açıkken plan dışı bir mesaj plan eylemi değildir.
12. Kendini denetle. Kişi kendisi hakkında yeni bir olgu bildirdiyse self_check.reported_new_facts true'dur, yazmış olsan da. Bildirdiği halde yazmadıysan nedenini not_written_reason'a kısaca yaz (bilgi eksik, kayıt alanı yok, önce güvenlik); koç buna göre davranır. Geri alma, onay ve senin fark ettiğin şüpheli kayıt kişinin bildirdiği yeni bir olgu değildir. Mesajda olmayan bir şeyi yazma.
13. Rota. reply_route koçun hangi sözleşmeyle konuşacağıdır: acil ya da kriz sinyalinde emergency veya crisis, plan üretiminde plan, tanışma kartında onboarding, diğer her durumda coach. effort_hint medium yalnızca sıkıntı, yeme bozukluğu, telafi, analiz ve plan gibi düşünmek isteyen turlarda.

Aşağıda önce yazabileceğin kayıtların belgesi, sonra örnek kararlar var. Örneklerde boş liste, null, false ya da 0 olan alanlar, plan_action none ve varsayılan rota (coach, low) kısalık için gösterilmedi; şema hepsini ister.`;

/** The user told us something new about themselves this turn (true even when it was written). */
const REPORTED = { reported_new_facts: true } as const;

/** The "6 tane tavuk nugget" item, as the model should estimate it (~300 kcal, not the 1708 of final2#4). */
const NUGGET = {
  name: 'tavuk nugget', as_stated: '6 tane', grams: 110, kcal: 300, protein_g: 15, carbs_g: 18, fat_g: 18, allergens: ['gluten'],
} as const;

export const UNDERSTAND_FEW_SHOTS: readonly UnderstandFewShot[] = [
  {
    id: 'su_ekle',
    context: ['BUGÜN: su 1,40 L'],
    message: '1 bardak su daha içtim',
    decision: {
      intent: { primary: 'report' },
      writes: [{ op: 'water_log', day: 'today', as_stated: '1 bardak', quantity: 1, unit: 'bardak', mode: 'add' }],
      self_check: REPORTED,
    },
    why: 'Bardak sayısı quantity, birim bardak; litreyi kod hesaplar (+0,20 L).',
  },
  {
    id: 'nugget',
    context: ['REFERANS ADAYLARI: tavuk_gogsu: tavuk göğsü (ızgara) 165 kcal/100 g, adet ağırlığı yok'],
    message: 'akşam 6 tane tavuk nugget yedim',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'meal_log',
        day: 'today',
        meal_type: 'dinner',
        raw: 'akşam 6 tane tavuk nugget yedim',
        status: 'new',
        items: [{ ...NUGGET, reference_key: null, confidence: 0.7 }],
      }],
      self_check: REPORTED,
    },
    why: 'Aday aynı yiyecek değil; reference_key boş kalır, sayılar senin tahminindir.',
  },
  {
    id: 'cimdik_tuz',
    context: [],
    message: 'kahvaltıda 2 yumurta haşladım, üstüne 2 çimdik tuz attım',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'meal_log',
        day: 'today',
        meal_type: 'breakfast',
        raw: 'kahvaltıda 2 yumurta haşladım, üstüne 2 çimdik tuz attım',
        status: 'new',
        items: [
          { name: 'haşlanmış yumurta', as_stated: '2 yumurta', grams: 100, kcal: 155, protein_g: 13, carbs_g: 1, fat_g: 11, allergens: ['egg'], confidence: 0.85 },
          { name: 'tuz', as_stated: '2 çimdik', grams: 0.7, kcal: 0, confidence: 0.6 },
        ],
      }],
      self_check: REPORTED,
    },
    why: '"2 çimdik" aynen saklanır; küçük ve 0 kcal olması soru gerektirmez.',
  },
  {
    id: 'su_gun_toplami',
    context: ['BUGÜN: su 1,60 L'],
    message: 'bugün toplam 2 litre su içtim',
    decision: {
      intent: { primary: 'report' },
      writes: [{ op: 'water_log', day: 'today', as_stated: 'toplam 2 litre', quantity: 2, unit: 'litre', mode: 'set_day_total' }],
      self_check: REPORTED,
    },
    why: 'Kişi günün toplamını söylüyor; ekleme değil, toplamı ayarlama.',
  },
  {
    id: 'su_geri_al',
    context: ['KAYITLAR: m30 · Paz 4 Eki akşam · mercimek çorbası, ekmek ~240 kcal', 'KAYITLAR: d3 · su +0,20 L (gün 3,40 L) (son tur)'],
    message: 'yok o yanlış geri al',
    decision: {
      intent: { primary: 'correction' },
      record_ops: [{ op: 'delete', ref: 'd3', reason: 'son su kaydı yanlışmış' }],
    },
    why: 'Geri alınan, son turun su yazmasıdır (d3); adı geçmeyen akşam yemeğine dokunulmaz.',
  },
  {
    id: 'su_duzeltme',
    context: ['KAYITLAR: d3 · su +0,20 L (gün 1,60 L) (son tur)'],
    message: 'su yanlış, 2 bardaktı',
    decision: {
      intent: { primary: 'correction' },
      record_ops: [{
        op: 'update',
        ref: 'd3',
        basis: 'user_correction',
        reason: '1 değil 2 bardak',
        evidence_quote: '2 bardaktı',
        patch: { op: 'water_log', day: 'today', as_stated: '2 bardak', quantity: 2, unit: 'bardak', mode: 'add' },
      }],
      self_check: REPORTED,
    },
    why: 'Düzeltme ref ile: d3 yerine 2 bardak yazılır, ayrıca su eklenmez; alıntı kişinin cümlesinden.',
  },
  {
    id: 'duzeltme_sorusu',
    context: ['KAYITLAR: m14 · bugün öğle · mercimek çorbası, pilav ~520 kcal (son tur)'],
    message: 'bunu nasıl düzeltebilirim?',
    decision: {
      intent: { primary: 'question' },
      clarify: { topic: 'm14 kaydında neyin yanlış olduğu', candidate_refs: ['m14'] },
    },
    why: 'Bu bir soru; hiçbir kayıt silinmez ya da değişmez. Koç neyin yanlış olduğunu sorar.',
  },
  {
    id: 'supheli_kayit',
    context: ['KAYITLAR: m12 · Per 1 Eki akşam · "6 tane tavuk nugget" → tavuk göğsü 900 g 1708 kcal [referans]'],
    message: 'perşembe akşamki nuggetlar yüzünden mi bu hafta kilo veremedim?',
    decision: {
      intent: { primary: 'question' },
      record_ops: [{
        op: 'update',
        ref: 'm12',
        basis: 'suspicious',
        reason: '6 nugget için 1708 kcal; tavuk göğsü değerleriyle 900 g yazılmış',
        patch: {
          op: 'meal_log', day: '2026-10-01', meal_type: 'dinner', raw: '6 tane tavuk nugget', status: 'new',
          items: [{ ...NUGGET, confidence: 0.6 }],
        },
      }],
    },
    why: 'Kişi düzeltme istemedi; fark ettiğin şüpheyi suspicious ile önerirsin, kod bekletir, koç bir kez sorar.',
  },
  {
    id: 'supheli_kayit_onayi',
    context: [
      'BEKLEYEN ONAYLAR: p1 · record_update · perşembe nugget kaydının düzeltmesi (6 tane, ~300 kcal)',
      'SON KONUŞMA: koç: "Perşembe akşamki 6 nugget 1.708 kcal görünüyor. Bu kayıt yanlış görünüyor, düzelteyim mi?"',
    ],
    message: 'evet düzelt',
    decision: {
      intent: { primary: 'confirmation' },
      pending_ops: [{ op: 'confirm', ref: 'p1' }],
    },
    why: 'Evet, koçun sorduğu bekleyen düzeltmeye verildi; p1 onaylanır, yeni öğün açılmaz.',
  },
  {
    id: 'plan_istegi',
    context: [],
    message: 'bu hafta için bana bir beslenme planı hazırlar mısın?',
    decision: {
      intent: { primary: 'plan' },
      plan_action: { op: 'generate', plan_type: 'diet' },
      reply_route: { contract: 'plan', effort_hint: 'medium' },
    },
    why: 'Açık plan isteği; önkoşulları ve hedef sayıları kod denetler.',
  },
  {
    id: 'taslak_onayi',
    context: ['PLAN TASLAĞI: dft1 · diet v2 · 6–12 Eki haftası, her gün ~1750 kcal, 3 öğün'],
    message: 'onaylıyorum',
    decision: {
      intent: { primary: 'confirmation' },
      plan_action: { op: 'approve', plan_type: 'diet', draft_ref: 'dft1' },
    },
    why: 'Taslak açıkken yazılı onay approve olur; draft_ref açık taslağın ref’i, yeni plan üretilmez.',
  },
  {
    id: 'alerji_beyani',
    context: [],
    message: 'fıstık alerjim yok ama fındığa ciddi alerjim var',
    decision: {
      intent: { primary: 'report' },
      writes: [
        {
          op: 'constraint_add', kind: 'allergen', subject_id: 'peanut', display_tr: 'fıstık', whose: 'self', polarity: 'does_not_have',
          severity: 'unknown', evidence_quote: 'fıstık alerjim yok',
        },
        {
          op: 'constraint_add', kind: 'allergen', subject_id: 'hazelnut', display_tr: 'fındık', whose: 'self', polarity: 'has',
          severity: 'severe', evidence_quote: 'fındığa ciddi alerjim var',
        },
      ],
      self_check: REPORTED,
    },
    why: 'İki ayrı beyan; olumsuzluk yalnızca fıstığa aittir.',
  },
  {
    id: 'baskasinin_alerjisi',
    context: [],
    message: 'kızımın yumurta alerjisi var, ona da yemek yapıyorum',
    decision: {
      intent: { primary: 'report', about_other_person: true },
      writes: [{
        op: 'constraint_add', kind: 'allergen', subject_id: 'egg', display_tr: 'yumurta (kızının)', whose: 'other_person',
        polarity: 'has', severity: 'unknown', evidence_quote: 'kızımın yumurta alerjisi var',
      }],
      self_check: REPORTED,
    },
    why: 'whose other_person: kişinin güvenlik listesine girmez, koç bunu not olarak bilir.',
  },
  {
    id: 'sakatlik',
    context: [],
    message: 'dün koşarken sağ dizimi burktum, biraz şişti. bugün antrenman yapayım mı?',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'constraint_add', kind: 'injury', subject_id: 'knee_sprain', display_tr: 'sağ diz burkulması', whose: 'self',
        polarity: 'has', severity: 'unknown', body_parts: ['knee'], evidence_quote: 'sağ dizimi burktum, biraz şişti',
      }],
      self_check: REPORTED,
    },
    why: 'Yeni sakatlık bildirimi ve bir soru; şiddet söylenmediği için unknown.',
  },
  {
    id: 'tetik_mecaz',
    context: ['GÜVENLİK TETİKLERİ: tw1 [acil durum · belirsiz] "bayıldım"'],
    message: 'bu tatlıya bayıldım, tarifini sonra isteyeceğim',
    decision: {
      intent: { primary: 'chat' },
      safety: { tripwire_reading: { benign: true, reason: '"bayıldım" burada çok beğenmek anlamında; sağlık yakınması yok' } },
    },
    why: 'Mecaz okuma gerekçesiyle yazılır; tarif isteği henüz yapılmadı.',
  },
  {
    id: 'tetik_gercek',
    context: ['GÜVENLİK TETİKLERİ: tw1 [acil durum · belirsiz] "bayıldım"'],
    message: 'sabah antrenmanda bir an bayıldım, şimdi iyiyim ama başım hâlâ dönüyor',
    decision: {
      intent: { primary: 'report' },
      safety: { acute_medical: true, tripwire_reading: { benign: false, reason: 'egzersiz sırasında gerçek bilinç kaybı ve süren baş dönmesi' } },
      reply_route: { contract: 'emergency', effort_hint: 'medium' },
      self_check: { reported_new_facts: true, not_written_reason: 'acil sağlık durumu; önce güvenlik' },
    },
    why: 'Aynı kelime, gerçek durum: koruyucu yol.',
  },
  {
    id: 'kusma_hastalik',
    context: ['GÜVENLİK TETİKLERİ: tw1 [yeme bozukluğu · belirsiz] "kustum"'],
    message: 'dün gece kustum, zehirlendim galiba',
    decision: {
      intent: { primary: 'report' },
      safety: {
        ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'dün gece kustum' },
        tripwire_reading: { benign: true, reason: 'zehirlenme kaynaklı kusma; kilo kontrolü için çıkarma işareti yok' },
      },
      self_check: { reported_new_facts: true, not_written_reason: 'tek seferlik rahatsızlık; kayıt alanı yok' },
    },
    why: 'Hastalık kusması yeme bozukluğu sinyali değildir: illness_vomiting, YB yükselmez; alıntı kişinin sözü.',
  },
  {
    id: 'soru_kayit_degil',
    context: [],
    message: 'günde 3 litre su içmem gerekiyor mu?',
    decision: { intent: { primary: 'question' } },
    why: 'Soru kayıt değildir; su yazılmaz.',
  },
];

// ─── completion: the authored (sparse) decision → the full strict-schema decision ───────────────

/**
 * The only non-empty values a few-shot may leave out — the defaults the rules name ("plan_action
 * none ve varsayılan rota (coach, low)"). Everything else left out must have an empty value.
 */
const STATED_DEFAULTS: Readonly<Record<string, unknown>> = {
  'plan_action.op': 'none',
  'reply_route.contract': 'coach',
  'reply_route.effort_hint': 'low',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const at = (base: string, key: string | number) => (typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key);

/**
 * What an omitted field means: the empty value of its spec (null / false / 0 / []) or a stated
 * default. The defaults sit on top-level envelope objects, so the path is compared as is.
 */
function omitted(spec: FieldSpec, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(STATED_DEFAULTS, path)) return STATED_DEFAULTS[path];
  switch (spec.kind) {
    case 'num':
      return spec.nullable ? null : 0;
    case 'bool':
      return spec.nullable ? null : false;
    case 'list':
    case 'enumList':
    case 'textList':
      return [];
    case 'obj':
      return spec.nullable ? null : fillFields(spec.fields, {}, path);
    case 'write':
      break;
    default:
      if (spec.nullable) return null;
  }
  throw new Error(`few-shot: ${path} (${spec.kind}) has no empty value — write it out`);
}

function fillValue(spec: FieldSpec, v: unknown, path: string): unknown {
  if (v === undefined) return omitted(spec, path);
  if (spec.kind === 'obj' && isObj(v)) return fillFields(spec.fields, v, path);
  if (spec.kind === 'list' && Array.isArray(v)) return v.map((x, i) => (isObj(x) ? fillFields(spec.fields, x, at(path, i)) : x));
  if (spec.kind === 'write' && isObj(v)) return fillItem('writes', v, path);
  return v;
}

/** Declared fields in registry order; unknown keys are kept (last) so the schema check names them. */
function fillFields(fields: Fields, src: Record<string, unknown>, base: string, head: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...head };
  for (const [name, spec] of Object.entries(fields)) out[name] = fillValue(spec, src[name], at(base, name));
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

function fillItem(channel: Channel, item: Record<string, unknown>, path: string): Record<string, unknown> {
  const reg = findWireOp(channel, item.op);
  return reg ? fillFields(reg.fields, item, path, { op: item.op }) : { ...item };
}

/**
 * The full kochko_understand decision a few-shot stands for: every field the author left out is
 * filled from the registry's field specs with its empty value (or a stated default), in schema
 * order. Throws when a left-out field has no empty value (a required text, enum, day or ref): the
 * example would otherwise teach a decision the provider's strict decoding never produces.
 */
export function completeDecision(d: FewShotDecision): Record<string, unknown> {
  const src = d as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(ENVELOPE_HEAD as Fields)) out[name] = fillValue(spec, src[name], name);
  for (const ch of UNDERSTAND_CHANNELS) {
    const items = Array.isArray(src[ch]) ? (src[ch] as unknown[]) : [];
    out[ch] = items.map((x, i) => (isObj(x) ? fillItem(ch, x, at(ch, i)) : x));
  }
  for (const [name, spec] of Object.entries(ENVELOPE_TAIL as Fields)) out[name] = fillValue(spec, src[name], name);
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

/** The authored values, keyed in the order of the complete decision (schema order at every level). */
function inSchemaOrder(sparse: unknown, full: unknown): unknown {
  if (Array.isArray(sparse) && Array.isArray(full)) return sparse.map((x, i) => inSchemaOrder(x, full[i]));
  if (isObj(sparse) && isObj(full)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(full)) if (k in sparse) out[k] = inSchemaOrder(sparse[k], full[k]);
    return out;
  }
  return sparse;
}

export function renderFewShots(list: readonly UnderstandFewShot[] = UNDERSTAND_FEW_SHOTS): string {
  const out: string[] = ['## Örnek kararlar'];
  for (const s of list) {
    out.push('', `### ${s.id}`);
    if (s.context.length) out.push(`Bağlam: ${s.context.join(' | ')}`);
    out.push(`Mesaj: "${s.message}"`);
    out.push(`Karar: ${JSON.stringify(inSchemaOrder(s.decision, completeDecision(s.decision)))}`);
    out.push(`Neden: ${s.why}`);
  }
  return out.join('\n');
}

/**
 * The Stage A cached prefix: rules → the registry's Turkish field doc → few-shot decisions.
 *
 * `registryDoc` is write-registry/doc.ts output, inserted verbatim (it owns its header). An empty doc
 * is refused: §2 rule 3 is that the model sees what it may write BEFORE writing, so a prefix without
 * it is a bug, not a degraded mode.
 */
export function buildUnderstandPrefix(parts: { registryDoc: string }): string {
  const doc = parts.registryDoc.trim();
  if (!doc) {
    throw new Error('buildUnderstandPrefix: registry doc is empty — Stage A must see the writable fields (§4.2)');
  }
  return [UNDERSTAND_RULES, doc, renderFewShots()].join('\n\n');
}
