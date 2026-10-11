/**
 * v2 Stage A — the understanding brain's prompt (docs/AI_MIMARI_V2.md §8.3, §3.2 T4).
 *
 * WHY: v1 let ~60 code nets decide what a message meant (24-regex detectTaskMode, water/step/backdate
 * strippers, repair regexes) and gave the model a hand-written pseudo-schema without units. Stage A
 * inverts that: the model reads the message and makes ONE strict-schema decision; code only checks it.
 * This file is the model's side of that contract: ~1.7K tokens of understanding rules, a slot for the
 * registry's generated Turkish field doc, and few-shot decisions — one per PRINCIPLE v1 got wrong in
 * production (a glass is a unit, a look-alike reference is not the food, a fuzzy amount is kept,
 * undo/correct by ref, a question deletes nothing, third-person allergies, a figurative trigger
 * word, illness vomiting). v5 (2026-10-11): every example was rewritten in details of its own so
 * no eval fixture is a copy of one (teaching-to-the-test review; eval/overlap.test.ts guards it).
 * v6 (2026-10-11, tuning round 3): a protective declaration (the user's own allergy/injury) is
 * never held for a detail — written with the most likely reading, the detail asked via clarify
 * (the severe-allergy B+ miss: "which kind?" had suppressed the write); the sleep day is the day
 * one woke up; food added to a logged meal is a new meal_log; a food or drink mentioned alongside
 * is a report of its own; a retraction of a constraint that was never true is written too (an
 * inactive one cannot be retracted → does_not_have); "dilim" of a food cooked whole is a count and
 * no unstated fraction is invented — taught by a contrasting example (the only "dilim" example used
 * to be a truly sliced food).
 *
 * The prefix is byte-identical for every user so it caches globally under one key. Nothing per-user
 * or per-turn belongs here; the TurnInput block, tripwire facts and the message are appended after it
 * by stage-a-request.ts (the one Stage A composer — shadow, live and eval send the same bytes).
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
export const UNDERSTAND_PROMPT_VERSION = 'v6';
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

Sen Kochko'nun anlama aşamasısın. Kişiye cevap yazmazsın: mesajı okur, ne olduğuna karar verir ve kararı şemadaki tek JSON olarak verirsin. Kod kararı denetler ve kaydeder; koç cevabı sonra, olanlara bakarak yazar. Yanlış bir yazma kişinin günlüğünü bozar, yazılmayan bir şeyi ise koç tek soruyla tamamlar. Bu yüzden emin olmadığın kısmı yazma, clarify ile sordur; emin olduğun kısmı yine yaz. Tek istisna kişinin kendi alerjisi ya da sakatlığıdır: ayrıntısı belirsiz diye bekletilmez.

1. Niyet. Mesaj şimdi olan bir şeyin bildirimi mi, soru mu, varsayım mı ("yesem ne olur", "içsem yeter mi", "yarın yapacağım"), düzeltme mi, onay mı, plan isteği mi? Kayıt yalnızca bildirimden ve düzeltmeden doğar. Soru, niyet, hedef ve varsayım kayıt değildir ("neden 70'in altına inemiyorum?" tartı kaydı değildir). Soruyla biten bildirim yine yazılır, soruyu koç cevaplar. Her bildirim ayrı bir yazmadır, birini yazıp ötekini atlama: "belim ağrıyor ama 40 dakika yüzdüm" sakatlık ve antrenmandır; yanında anılan yiyecek ya da içecek de bildirimdir.
2. Kimin hakkında. Kişinin kendisi mi, başkası mı? Başkasına ait alerji, yemek ya da ölçü kişinin kaydına yazılmaz; "ablamla alışverişe çıktım" cinsiyet bilgisi değildir.
3. Gün. Günü bağlamdaki yerel tarihe göre ver; gelecek ve yedi günden eski kayıt yazılmaz. Uyku uyandığı günündür.
4. Miktarın iki yüzü. as_stated kişinin ifadesidir, aynen yazılır ("annemin tabağı kadar"); kod onu ayrıştırmaz. Kanonik sayıyı sen verirsin: gram (as_stated'in tamamı), kcal, makrolar. Birim yiyeceğe uymuyorsa en olası anlamı al ya da sor; bütün pişen, dilimlenmeyen bir yiyecekte "dilim" çoğunlukla adettir; söylenmeyen bir kesir (yarım, çeyrek) uydurma. Bardak ya da şişe sayısı quantity'dir, litreyi kod hesaplar. Küçük ya da ~0 kcal olanlar da yazılır (bir tutam baharat, şekersiz bir içecek); soru gerektirmez.
5. Referans adayları ipucudur. Bir aday gerçekten aynı yiyecekse reference_key'e yaz; değilse boş bırak ve kendi tahminini ver. Kelime benzerliği aynı yiyecek demek değildir.
6. Mevcut kayıtlar. Geri alma (record_ops delete) ve düzeltme yalnızca bağlamdaki ref'lerle (m12, d3) yapılır. Kişi gösterilen bir kaydı düzeltiyorsa record_ops update: basis user_correction, evidence_quote onun cümlesinden, patch kaydın düzeltilmiş tam hâli. Düzeltmenin tek yolu budur: yazmalardaki replaces hep null kalır; düzeltmeyi bir de yeni yazma olarak ekleme, çift sayım olur. Listedeki bir öğünü yeniden anlatıyorsa status restatement; "bir kase daha" yeni yemektir. Makul görünmeyen eski bir kaydı kendin düzeltme: update'i basis suspicious ile öner; kod bekletir, koç bir kez sorar, evet gelirse pending_ops confirm olur.
7. Emin değilsen sordur. Hangi kayıttan söz edildiği belli değilse yazma, clarify'a aday ref'leri koy: son turda birden çok yazma varken "onu sil" de, son ya da ilk gibi bir sıra sözü de hangisini söylemez; listedeki sıra anlam taşımaz. Yeni yenen bir şey, kayıtlı bir öğüne eklense de yeni meal_log'dur; öğününü sormak için yazmayı bekletme. Soru hiçbir kaydı silmez ya da değiştirmez.
8. Bağlantılar. Son konuşma bağlamdadır; kısa bir cevap ("68", "evet", "2 bardak") koçun son mesajına verilmiş olabilir. Bekleyen onaya (p#) ya da açık söze (k#) verilen cevap pending_ops ya da commitment_ops olur.
9. Güvenlik okuması. Her belirsiz tetik için tripwire_readings'e hit_id, okuma ve gerekçe yaz. Kelime gerçek bir durumu mu anlatıyor, mecaz mı ("filme bayıldım" beğenmek, "koşarken bayıldım" bilinç kaybı)? Emin değilsen positive yaz; yanlış alarm bir cümleyle düzelir, kaçırılan acil düzelmez. Tetik olmasa da akut tıbbi durum, kendine zarar ya da yeme bozukluğu sinyali görürsen işaretle. Hastalıkla ya da zehirlenmeyle kusmak yeme bozukluğu sinyali değildir (illness_vomiting). Tek seferlik bir fazla yeme yakınması en fazla binge low'dur; tekrarlayan tıkınma, kontrol kaybı ya da telafi niyeti (kusma, aç kalma, zorlayıcı spor) en az medium'dur. ed_signal'in kanıtı kişinin sözüdür; koçun cümleleri sinyal sayılmaz. Alerjisi olduğu bir şeyi yediğini söylüyorsa, acil olsa da öğünü allergens ile yaz: maruziyeti kod o kayıttan görür.
10. Alerji ve sakatlık. Her öğeyi ayrı yaz; olumsuzluk yalnızca ait olduğu öğeye geçer ve her "X alerjim yok" bir does_not_have yazmasıdır. Kişinin kendi alerjisini ya da sakatlığını bu turda yaz: türü ya da bölgesi belirsizse en olası okumayı seç, ayrıntıyı clarify ile sordur. Tepkiyi anlatan koşul cümlesi varsayım değil, beyandır. Şiddet söylenmediyse unknown yaz; kod onu netleşene dek ciddi sayar. Bir kısıtın artık geçmediğini ya da baştan yanlış olduğunu söylüyorsa, ciddi alerji de olsa yine yaz: etkin bir kısıtsa constraint_retract, pasifse ya da listede yoksa does_not_have; onayı kod ister.
11. Plan. Kişi açıkça plan istiyor, değiştiriyor ya da onaylıyorsa plan_action'ı buna göre seç; açık taslağa dönük her işlemde draft_ref taslağın ref'idir. Taslak açıkken tarif ya da öneri istemek none'dır; revise yalnız taslağı değiştirme isteğidir. Plan isteğinin gerekçesi ("öğlenleri vaktim olmuyor") profil bilgisi değildir.
12. Kendini denetle. Kişi kendisi hakkında yeni bir olgu bildirdiyse self_check.reported_new_facts true'dur, yazmış olsan da. Bildirdiği halde yazmadıysan nedenini not_written_reason listesinden seç; uyan bir neden yoksa null bırak, koç sorar. Geri alma, onay ve senin fark ettiğin şüpheli kayıt kişinin bildirdiği yeni bir olgu değildir. Mesajda olmayan bir şeyi yazma.
13. Rota. reply_route koçun hangi sözleşmeyle konuşacağıdır: acil tıbbi durumda emergency, kendine zarar ya da orta/yüksek yeme bozukluğu sinyalinde crisis (low ise coach), plan üretiminde plan, tanışma kartında onboarding, diğer her durumda coach. effort_hint medium yalnızca düşünmek isteyen turlarda (sıkıntı, yeme bozukluğu, telafi, analiz, plan).

Aşağıda önce yazabileceğin kayıtların belgesi, sonra örnek kararlar var. Örneklerde boş liste, null, false ya da 0 olan alanlar, plan_action none ve varsayılan rota (coach, low) kısalık için gösterilmedi; şema hepsini ister.`;

/** The user told us something new about themselves this turn (true even when it was written). */
const REPORTED = { reported_new_facts: true } as const;

/**
 * The few-shots teach PRINCIPLES, never an eval case: no example repeats a fixture's message, foods,
 * numbers or ref+food pair. eval/overlap.test.ts fails when one drifts close: token Jaccard > 0.6
 * against any fixture message; more than one shared content word (foods, symptoms — by stem, so
 * inflections count) with a fixture message, or a fixture ref line whatever its ref; a shared
 * number+word pair ("2 dilim", "2 değil"); a fixture's exact ref with the same food. Each example
 * below is one principle in details of its own; the eval's fixtures (and its untouched holdout set)
 * then measure whether the model generalises it.
 */
export const UNDERSTAND_FEW_SHOTS: readonly UnderstandFewShot[] = [
  {
    id: 'icecek_ve_su',
    context: ['BUGÜN: su 0,90 L'],
    message: 'ıhlamurumu içerken yanında 3 su bardağı su da içtim',
    decision: {
      intent: { primary: 'report' },
      writes: [
        {
          op: 'meal_log',
          day: 'today',
          meal_type: 'snack',
          raw: 'ıhlamurumu içerken yanında 3 su bardağı su da içtim',
          status: 'new',
          items: [{ name: 'ıhlamur', as_stated: 'ıhlamur', grams: 150, kcal: 2, confidence: 0.5 }],
        },
        { op: 'water_log', day: 'today', as_stated: '3 su bardağı', quantity: 3, unit: 'su_bardagi', mode: 'add' },
      ],
      self_check: REPORTED,
    },
    why: 'İki bildirim: sade su water_log (bardak sayısı quantity, litreyi kod hesaplar); yanında geçen içecek de miktarı söylenmese tahminle meal_log.',
  },
  {
    id: 'aday_ayni_degil',
    context: ['REFERANS ADAYLARI: patates_haslama: patates (haşlanmış) 87 kcal/100 g, adet ağırlığı yok'],
    message: 'öğlen 8 tane patates kroketi yedim',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'meal_log',
        day: 'today',
        meal_type: 'lunch',
        raw: 'öğlen 8 tane patates kroketi yedim',
        status: 'new',
        items: [{
          name: 'patates kroketi', as_stated: '8 tane', grams: 160, kcal: 420, protein_g: 6, carbs_g: 44, fat_g: 24, allergens: ['gluten', 'egg'],
          reference_key: null, confidence: 0.65,
        }],
      }],
      self_check: REPORTED,
    },
    why: 'Aday aynı yiyecek değil; reference_key boş kalır, sayılar senin tahminindir.',
  },
  {
    id: 'dilim_adet_tutam',
    context: ['REFERANS ADAYLARI: krep: krep (sade) 220 kcal/100 g · 1 adet ≈55 g'],
    message: 'ikindi 4 dilim krep yedim, üstüne bir tutam tarçın',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'meal_log',
        day: 'today',
        meal_type: 'snack',
        raw: 'ikindi 4 dilim krep yedim, üstüne bir tutam tarçın',
        status: 'new',
        items: [
          {
            name: 'krep', as_stated: '4 dilim', grams: 220, kcal: 485, protein_g: 14, carbs_g: 62, fat_g: 20, allergens: ['gluten', 'egg', 'milk'],
            reference_key: 'krep', confidence: 0.7,
          },
          { name: 'tarçın', as_stated: 'bir tutam', grams: 0.3, kcal: 1, confidence: 0.6 },
        ],
      }],
      self_check: REPORTED,
    },
    why: 'Krep bütün pişer, dilimlenmez: "dilim" adettir, gram = 4 × 55 (ekmekte, kekte dilim gerçekten dilimdir). "bir tutam" aynen saklanır, soru gerektirmez.',
  },
  {
    id: 'su_gun_toplami',
    context: ['BUGÜN: su 1,20 L'],
    message: 'akşama kadar toplamda 9 bardak su içmişim',
    decision: {
      intent: { primary: 'report' },
      writes: [{ op: 'water_log', day: 'today', as_stated: 'toplamda 9 bardak', quantity: 9, unit: 'bardak', mode: 'set_day_total' }],
      self_check: REPORTED,
    },
    why: 'Kişi suyun gün toplamını söylüyor; ekleme değil, toplamı ayarlama.',
  },
  {
    id: 'son_turu_geri_al',
    context: ['KAYITLAR: m61 · bugün kahvaltı · yulaf ezmesi, süt ~320 kcal', 'KAYITLAR: w8 · bugün · bisiklet 45 dk (son tur)'],
    message: 'hayır, onu eklemeni istememiştim, sil',
    decision: {
      intent: { primary: 'correction' },
      record_ops: [{ op: 'delete', ref: 'w8', reason: 'son turda eklenen bisiklet istenmemiş' }],
    },
    why: 'Silinen, son turun yazmasıdır (w8); adı geçmeyen eski kayda dokunulmaz.',
  },
  {
    id: 'ref_ile_duzeltme',
    context: ['KAYITLAR: m44 · bugün akşam · "2 tabak makarna" → makarna 2 tabak ~500 g 760 kcal (son tur)'],
    message: 'makarnayı fazla girmişsin, bir tabaktı sadece',
    decision: {
      intent: { primary: 'correction' },
      record_ops: [{
        op: 'update',
        ref: 'm44',
        basis: 'user_correction',
        reason: 'makarna yalnız bir tabakmış',
        evidence_quote: 'makarnayı fazla girmişsin, bir tabaktı sadece',
        patch: {
          op: 'meal_log', day: 'today', meal_type: 'dinner', raw: 'bir tabak', status: 'new',
          items: [{ name: 'makarna', as_stated: 'bir tabak', grams: 250, kcal: 380, protein_g: 13, carbs_g: 72, fat_g: 5, allergens: ['gluten'], confidence: 0.7 }],
        },
      }],
      self_check: REPORTED,
    },
    why: 'Düzeltme ref ile: m44 düzeltilmiş tam hâliyle yazılır, ayrıca yeni öğün eklenmez (çift sayım).',
  },
  {
    id: 'duzeltme_sorusu',
    context: ['KAYITLAR: m52 · bugün öğle · etli kuru fasulye, pilav ~640 kcal (son tur)'],
    message: 'bu kayıtta bir şey ters, ne yapmam lazım?',
    decision: {
      intent: { primary: 'question' },
      clarify: { topic: 'm52 kaydında neyin yanlış olduğu', candidate_refs: ['m52'] },
    },
    why: 'Bu bir soru; hiçbir kayıt silinmez ya da değişmez. Koç neyin yanlış olduğunu sorar.',
  },
  {
    id: 'iki_aday_sil',
    context: ['KAYITLAR: m63 · bugün ara öğün · elma 1 adet ~80 kcal (son tur)', 'KAYITLAR: w9 · bugün · yoga 30 dk (son tur)'],
    message: 'az önce yazdığını iptal et',
    decision: {
      intent: { primary: 'correction' },
      clarify: { topic: 'hangi kaydın iptal edileceği', candidate_refs: ['m63', 'w9'] },
    },
    why: 'Son turda iki yazma var, hangisi olduğu belli değil: hiçbir şey silinmez, koç sorar.',
  },
  {
    id: 'supheli_kayit',
    context: ['KAYITLAR: m19 · Cum 2 Eki öğle · "1 kase yayla çorbası" → yayla çorbası 1.500 g 1240 kcal [referans]'],
    message: 'cuma öğlenden beri midem rahat değil, o gün ağır mı yemişim?',
    decision: {
      intent: { primary: 'question' },
      record_ops: [{
        op: 'update',
        ref: 'm19',
        basis: 'suspicious',
        reason: '1 kase çorbaya 1.500 g ve 1240 kcal yazılmış',
        patch: {
          op: 'meal_log', day: '2026-10-02', meal_type: 'lunch', raw: '1 kase yayla çorbası', status: 'new',
          items: [{ name: 'yayla çorbası', as_stated: '1 kase', grams: 250, kcal: 170, protein_g: 7, carbs_g: 20, fat_g: 7, allergens: ['milk'], confidence: 0.6 }],
        },
      }],
    },
    why: 'Kişi düzeltme istemedi; şüpheyi suspicious ile önerirsin, kod bekletir, koç bir kez sorar.',
  },
  {
    id: 'supheli_kayit_onayi',
    context: [
      'BEKLEYEN ONAYLAR: p2 · record_update · cuma öğle yayla çorbası kaydının düzeltmesi (1 kase, ~170 kcal)',
      'SON KONUŞMA: koç: "Cuma öğlenki yayla çorbası 1.240 kcal görünüyor; 1 kase için çok yüksek. Düzelteyim mi?"',
    ],
    message: 'olur, düzelt',
    decision: {
      intent: { primary: 'confirmation' },
      pending_ops: [{ op: 'confirm', ref: 'p2' }],
    },
    why: 'Olur, koçun sorduğu bekleyen düzeltmeye verildi; p2 onaylanır, yeni öğün açılmaz.',
  },
  {
    id: 'plan_istegi',
    context: [],
    message: 'önümüzdeki günler için öğün öğün ne yiyeceğimi çıkarır mısın?',
    decision: {
      intent: { primary: 'plan' },
      plan_action: { op: 'generate', plan_type: 'diet' },
      reply_route: { contract: 'plan', effort_hint: 'medium' },
    },
    why: 'Açık plan isteği; önkoşulları ve hedef sayıları kod denetler.',
  },
  {
    id: 'taslak_onayi',
    context: ['PLAN TASLAĞI: dft4 · antrenman taslağı v1 · haftada 3 gün tüm vücut, 45 dk'],
    message: 'güzel olmuş, bununla başlayalım',
    decision: {
      intent: { primary: 'confirmation' },
      plan_action: { op: 'approve', plan_type: 'workout', draft_ref: 'dft4' },
    },
    why: 'Taslak açıkken yazılı onay approve olur; draft_ref açık taslağın ref’i, yeni plan üretilmez.',
  },
  {
    id: 'alerji_beyani',
    context: [],
    message: 'hardala ciddi alerjim var, kereviz ise bana hiç dokunmuyor',
    decision: {
      intent: { primary: 'report' },
      writes: [
        {
          op: 'constraint_add', kind: 'allergen', subject_id: 'mustard', display_tr: 'hardal', whose: 'self', polarity: 'has',
          severity: 'severe', evidence_quote: 'hardala ciddi alerjim var',
        },
        {
          op: 'constraint_add', kind: 'allergen', subject_id: 'celery', display_tr: 'kereviz', whose: 'self', polarity: 'does_not_have',
          severity: 'unknown', evidence_quote: 'kereviz ise bana hiç dokunmuyor',
        },
      ],
      self_check: REPORTED,
    },
    why: 'İki ayrı beyan; "dokunmuyor" yalnızca kereviz için, hardal has kalır.',
  },
  {
    id: 'baskasinin_alerjisi',
    context: [],
    message: 'eşim kabuklu deniz ürünlerine alerjik, evde karides pişirmiyoruz',
    decision: {
      intent: { primary: 'report', about_other_person: true },
      writes: [{
        op: 'constraint_add', kind: 'allergen', subject_id: 'crustacean', display_tr: 'kabuklu deniz ürünü (eşinin)', whose: 'other_person',
        polarity: 'has', severity: 'unknown', evidence_quote: 'eşim kabuklu deniz ürünlerine alerjik',
      }],
      self_check: REPORTED,
    },
    why: 'whose other_person: kişinin güvenlik listesine girmez, koç bunu not olarak bilir.',
  },
  {
    id: 'sakatlik',
    context: [],
    message: 'basketbolda sol ayak bileğimi burktum, hafif şişlik var. yarın salona gideyim mi?',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'constraint_add', kind: 'injury', subject_id: 'ankle_sprain', display_tr: 'sol ayak bileği burkulması', whose: 'self',
        polarity: 'has', severity: 'unknown', body_parts: ['ankle'], evidence_quote: 'sol ayak bileğimi burktum, hafif şişlik var',
      }],
      self_check: REPORTED,
    },
    why: 'Yeni sakatlık bildirimi ve bir soru; şiddet söylenmediği için unknown.',
  },
  {
    id: 'tetik_mecaz',
    context: ['GÜVENLİK TETİKLERİ: tw1 [acil durum · belirsiz] "bayıldım"'],
    message: 'yeni koşu ayakkabılarıma bayıldım, ayağımı hiç sıkmıyor',
    decision: {
      intent: { primary: 'chat' },
      safety: { tripwire_readings: [{ hit_id: 'tw1', reading: 'benign', reason: '"bayıldım" burada çok beğenmek anlamında; sağlık yakınması yok' }] },
    },
    why: 'Mecaz okuma gerekçesiyle yazılır.',
  },
  {
    id: 'tetik_gercek',
    context: ['GÜVENLİK TETİKLERİ: tw1 [acil durum · belirsiz] "bayıldım"'],
    message: 'sabah antrenmanda bir an bayıldım, şimdi iyiyim ama hâlâ sersem gibiyim',
    decision: {
      intent: { primary: 'report' },
      safety: { acute_medical: true, tripwire_readings: [{ hit_id: 'tw1', reading: 'positive', reason: 'egzersiz sırasında gerçek bilinç kaybı ve süren sersemlik' }] },
      reply_route: { contract: 'emergency', effort_hint: 'medium' },
      self_check: { reported_new_facts: true, not_written_reason: 'emergency_turn' },
    },
    why: 'Aynı kelime, gerçek durum: koruyucu yol.',
  },
  {
    id: 'kusma_hastalik',
    context: ['GÜVENLİK TETİKLERİ: tw1 [yeme bozukluğu · belirsiz] "kusuyorum"'],
    message: 'mide üşütmesi geçirdim, sabahtan beri kusuyorum, ateşim de var',
    decision: {
      intent: { primary: 'report' },
      safety: {
        ed_signal: { category: 'illness_vomiting', severity: 'low', evidence_quote: 'sabahtan beri kusuyorum' },
        tripwire_readings: [{ hit_id: 'tw1', reading: 'benign', reason: 'ateşli mide üşütmesi; kilo için çıkarma işareti yok' }],
      },
      self_check: { reported_new_facts: true, not_written_reason: 'illness_not_food' },
    },
    why: 'Hastalık kusması yeme bozukluğu sinyali değildir: illness_vomiting, YB yükselmez.',
  },
  {
    id: 'soru_kayit_degil',
    context: [],
    message: 'haftada kaç gün koşmalıyım, 5 km yeterli mi?',
    decision: { intent: { primary: 'question' } },
    why: 'Soru kayıt değildir; antrenman yazılmaz.',
  },
  {
    id: 'bildirim_ve_soru',
    context: ['REFERANS ADAYLARI: icli_kofte: içli köfte (kızartma) 260 kcal/100 g · 1 adet ≈60 g'],
    message: 'öğlen 3 parça içli köfte yedim, yağı fazla mı?',
    decision: {
      intent: { primary: 'report' },
      writes: [{
        op: 'meal_log',
        day: 'today',
        meal_type: 'lunch',
        raw: 'öğlen 3 parça içli köfte yedim',
        status: 'new',
        items: [{
          name: 'içli köfte', as_stated: '3 parça', grams: 180, kcal: 470, protein_g: 18, carbs_g: 40, fat_g: 26, allergens: ['gluten'],
          reference_key: 'icli_kofte', confidence: 0.75,
        }],
      }],
      self_check: REPORTED,
    },
    why: 'Soru bildirimi silmez (question_only değil); aday aynı yiyecek: bütün yenen yiyecekte "parça" bir adettir, gram = 3 × 60.',
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
