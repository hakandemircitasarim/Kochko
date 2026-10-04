/**
 * Thinking stages — what the chat shows WHILE a turn is being prepared.
 *
 * The reply is not streamed on purpose: the server's safety nets (allergen scan, calorie net,
 * sanitizer) need the whole text before the user sees a word, so a raw token stream would flash
 * unchecked sentences. Instead the wait is narrated: the client guesses what kind of turn this is
 * from the message, and walks through stages that mirror the server's real pipeline (read the
 * records → compute targets → write → safety check → save) on a time curve calibrated to measured
 * latencies (logging ~4-7 s, coaching ~5-8 s, simulation ~11-14 s, plans ~20-26 s).
 *
 * Pure module: no React, no I/O — the indicator component owns the clock and the animation.
 */

export type TurnKind =
  | 'photo' | 'meal' | 'water' | 'sleep' | 'weight' | 'steps' | 'workout'
  | 'plan_diet' | 'plan_workout' | 'plan_approve' | 'recipe' | 'simulation' | 'eating_out'
  | 'support' | 'correction' | 'question' | 'opener' | 'generic'
  | 'report_daily' | 'report_weekly' | 'report_monthly' | 'weekly_menu';

/** Ionicons glyph names used by the stages (kept as plain strings so this file stays React-free). */
export interface Stage { icon: string; text: string }

export interface ThinkingScript {
  kind: TurnKind;
  stages: Stage[];
  /** ms offsets at which each stage appears (same length as stages, first is 0). */
  at: number[];
  /** Typical total duration — drives the progress estimate for long kinds. */
  expectedMs: number;
  /** Long kinds show a progress bar + step pips. */
  long: boolean;
  /** Calm kinds (support) use a slow breathing animation and no "computing" vibe. */
  calm: boolean;
}

export interface ThinkingContext {
  /** Mid of today's calorie band, if known (e.g. 2059). */
  calorieTarget?: number | null;
  proteinG?: number | null;
}

const lower = (s: string) => s.toLocaleLowerCase('tr');
// JS \b is ASCII-only — Turkish letters need Unicode lookarounds.
const W = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, 'u');

const RE = {
  planNoun: /(plan|program|men[üu]|liste)/u,
  planVerb: /(haz[ıi]rla|olu[şs]tur|[çc][ıi]kar|yaz(ar|s)?|ver(ir|ebilir)?|yap(ar|abilir)?|iste|laz[ıi]m|de[ğg]i[şs]tir|g[üu]ncelle|yenile)/u,
  workoutWord: /(antrenman|egzersiz|spor|idman|workout|kuvvet|kardiyo|fitness)/u,
  simulation: /(yesem|yersem|i[çc]sem|yer miyim|i[çc]er miyim|yiyebilir miyim)|ne olur/u,
  eatingOut: /(d[ıi][şs]ar[ıi]da|restoran|lokanta|kebap[çc][ıi]|d[üu][ğg][üu]n|davet|mekan|kafe|fast ?food|burger[cç]i)/u,
  recipe: /(tarif|nas[ıi]l yap[ıi]l[ıi]r|ne pi[şs]ir|pi[şs]irsem)/u,
  support: /(motivasyon|b[ıi]kt[ıi]m|yapam[ıi]yorum|[üu]zg[üu]n|stres|moral|b[ıi]rakmak|kendimi k[öo]t[üu]|isteksiz|yoruldum|depresif|a[ğg]lad[ıi]m|umutsuz)/u,
  water: W('su|litre|lt|bardak su'),
  sleep: /(uyudum|uyku|uyand[ıi]m|yatt[ıi]m)/u,
  weight: /(tart[ıi]l|kilo geldim|kiloyum|\d+(?:[.,]\d+)?\s*kg)/u,
  steps: W('ad[ıi]m|ad[ıi]m att[ıi]m'),
  workout: /(ko[şs]tum|y[üu]r[üu]d[üu]m|antrenman yapt[ıi]m|spor yapt[ıi]m|salona gittim|bisiklet|y[üu]zd[üu]m|egzersiz yapt[ıi]m|idman yapt[ıi]m|\d+\s*(dk|dakika)\s*(ko[şs]|y[üu]r|bisiklet))/u,
  meal: /(yedim|i[çc]tim|kahvalt[ıi]|[öo][ğg]le|ak[şs]am yeme[ğg]|at[ıi][şs]t[ıi]r|yemek yedim|[öo][ğg][üu]n)/u,
  question: /\?\s*$|(neden|nas[ıi]l|ne kadar|ka[çc] |hangi|ne zaman|nedir)/u,
  approve: /^(plan[ıi] )?onayl[ıi]yorum|^onayla(d[ıi]m)?$/u,
};

/** Best guess of what this turn is, from the outgoing text + the screen's mode hint. */
export function predictTurnKind(text: string | null | undefined, taskMode?: string | null, isPhoto?: boolean): TurnKind {
  if (isPhoto) return 'photo';
  const m = taskMode ?? '';
  if (m.startsWith('repair:')) return 'correction';
  if (m === 'plan_workout') return 'plan_workout';
  if (m === 'plan_diet' || m === 'plan' || m === 'plan_suggestion') return 'plan_diet';
  if (m === 'recipe') return 'recipe';
  if (m === 'simulation') return 'simulation';
  if (m === 'eating_out') return 'eating_out';
  if (m === 'mvd' || m === 'recovery') return 'support';
  if ((text ?? '').startsWith('[SYSTEM_INIT]')) return 'opener'; // before lowering: tr lowercases I to dotless ı
  const t = lower(text ?? '').trim();
  if (!t) return 'generic';
  if (RE.approve.test(t)) return 'plan_approve';
  if (RE.planNoun.test(t) && RE.planVerb.test(t)) return RE.workoutWord.test(t) ? 'plan_workout' : 'plan_diet';
  if (RE.support.test(t)) return 'support';
  if (RE.simulation.test(t)) return 'simulation';
  if (RE.eatingOut.test(t)) return 'eating_out';
  if (RE.recipe.test(t)) return 'recipe';
  if (RE.question.test(t)) return 'question';
  if (RE.weight.test(t)) return 'weight';
  if (RE.sleep.test(t)) return 'sleep';
  if (RE.water.test(t) && /(i[çc]tim|i[çc]tik|litre|bardak|\d)/u.test(t)) return 'water';
  if (RE.steps.test(t)) return 'steps';
  if (RE.workout.test(t)) return 'workout';
  if (RE.meal.test(t)) return 'meal';
  return 'generic';
}

/**
 * Inside a plan negotiation most messages are revisions even when phrased as a question
 * ("akşamları daha hafif yapar mısın?") — only a real why/how question is answered, not rebuilt.
 */
export function planChatKind(text: string | null | undefined, planKind: 'plan_diet' | 'plan_workout'): TurnKind {
  const t = lower(text ?? '');
  if (RE.approve.test(t.trim())) return 'plan_approve';
  if (/(de[ğg]i[şs]tir|yap(ar|abilir)|ekle|[çc][ıi]kar|azalt|art[ıi]r|koy|hafiflet|a[ğg][ıi]rla[şs]t[ıi]r|yerine|olmas[ıi]n|istemiyorum|sevmem|alternatif)/u.test(t)) return planKind;
  if (/(neden|ni[çc]in|nas[ıi]l|ne kadar|ka[çc] |hangi|nedir|ne demek)/u.test(t)) return 'question';
  return planKind;
}

const fmtKcal = (n: number) => Math.round(n).toLocaleString('tr-TR');

/**
 * Stage variants per kind. Each inner array is one full narration; one is picked per turn so the
 * same request never reads identically twice in a row. Wording: present continuous, first person,
 * never claims a result ("kaydedildi") — only the work in progress.
 */
function variants(kind: TurnKind, ctx: ThinkingContext): Stage[][] {
  const kcal = ctx.calorieTarget && ctx.calorieTarget > 0 ? fmtKcal(ctx.calorieTarget) : null;
  const pro = ctx.proteinG && ctx.proteinG > 0 ? Math.round(ctx.proteinG) : null;
  switch (kind) {
    case 'photo':
      return [
        [{ icon: 'camera-outline', text: 'Fotoğrafı açıyorum' }, { icon: 'scan-outline', text: 'Tabaktakileri tanıyorum' }, { icon: 'resize-outline', text: 'Porsiyonları tahmin ediyorum' }, { icon: 'calculator-outline', text: 'Kalori ve makroları hesaplıyorum' }, { icon: 'shield-checkmark-outline', text: 'Alerji kontrolünü yapıyorum' }],
        [{ icon: 'image-outline', text: 'Görüntüye bakıyorum' }, { icon: 'restaurant-outline', text: 'Yemekleri ayırt ediyorum' }, { icon: 'scale-outline', text: 'Gramajları kestiriyorum' }, { icon: 'nutrition-outline', text: 'Besin değerlerini çıkarıyorum' }, { icon: 'shield-checkmark-outline', text: 'Kısıtlarını kontrol ediyorum' }],
      ];
    case 'meal':
      return [
        [{ icon: 'restaurant-outline', text: 'Öğününü okuyorum' }, { icon: 'search-outline', text: 'Besin tablosuna bakıyorum' }, { icon: 'calculator-outline', text: 'Kalorileri topluyorum' }, { icon: 'pie-chart-outline', text: 'Günün toplamına ekliyorum' }],
        [{ icon: 'fast-food-outline', text: 'Ne yediğini ayıklıyorum' }, { icon: 'scale-outline', text: 'Porsiyonları ölçüyorum' }, { icon: 'nutrition-outline', text: 'Protein ve makroları hesaplıyorum' }, { icon: 'stats-chart-outline', text: kcal ? `${kcal} kcal hedefine göre bakıyorum` : 'Günlük hedefine göre bakıyorum' }],
        [{ icon: 'book-outline', text: 'Yemekleri tanıyorum' }, { icon: 'calculator-outline', text: 'Değerleri hesaplıyorum' }, { icon: 'shield-checkmark-outline', text: 'Alerji kontrolünü yapıyorum' }, { icon: 'create-outline', text: 'Kaydı hazırlıyorum' }],
      ];
    case 'water':
      return [
        [{ icon: 'water-outline', text: 'Su miktarını okuyorum' }, { icon: 'beaker-outline', text: 'Litreye çeviriyorum' }, { icon: 'trending-up-outline', text: 'Günlük toplamını güncelliyorum' }],
        [{ icon: 'water-outline', text: 'Suyunu işliyorum' }, { icon: 'flask-outline', text: 'Bugünkü toplamına bakıyorum' }, { icon: 'flag-outline', text: 'Hedefe ne kaldığını hesaplıyorum' }],
      ];
    case 'sleep':
      return [
        [{ icon: 'moon-outline', text: 'Uykunu not ediyorum' }, { icon: 'time-outline', text: 'Hangi geceye ait olduğuna bakıyorum' }, { icon: 'pulse-outline', text: 'Toparlanmana etkisini düşünüyorum' }],
        [{ icon: 'bed-outline', text: 'Uyku süreni okuyorum' }, { icon: 'calendar-outline', text: 'Doğru güne yazıyorum' }, { icon: 'sparkles-outline', text: 'Yarın için ipucu hazırlıyorum' }],
      ];
    case 'weight':
      return [
        [{ icon: 'scale-outline', text: 'Tartını kaydediyorum' }, { icon: 'trending-down-outline', text: 'Önceki tartılarınla karşılaştırıyorum' }, { icon: 'analytics-outline', text: 'Eğilimine bakıyorum' }],
        [{ icon: 'scale-outline', text: 'Ölçümünü okuyorum' }, { icon: 'git-compare-outline', text: 'Haftalık ortalamayla kıyaslıyorum' }, { icon: 'flag-outline', text: 'Hedefe kalan mesafeyi hesaplıyorum' }],
      ];
    case 'steps':
      return [
        [{ icon: 'footsteps-outline', text: 'Adımlarını sayıyorum' }, { icon: 'flame-outline', text: 'Harcamana etkisine bakıyorum' }, { icon: 'trending-up-outline', text: 'Günün özetine ekliyorum' }],
      ];
    case 'workout':
      return [
        [{ icon: 'barbell-outline', text: 'Antrenmanını okuyorum' }, { icon: 'flame-outline', text: 'Yaktığın enerjiyi hesaplıyorum' }, { icon: 'trophy-outline', text: 'Rekorlarına bakıyorum' }, { icon: 'create-outline', text: 'Kaydı hazırlıyorum' }],
        [{ icon: 'walk-outline', text: 'Hareketini işliyorum' }, { icon: 'speedometer-outline', text: 'Süre ve yoğunluğu hesaplıyorum' }, { icon: 'battery-charging-outline', text: 'Toparlanmanı düşünüyorum' }],
      ];
    case 'plan_diet':
      return [
        [
          { icon: 'document-text-outline', text: 'Profilini ve kayıtlarını okuyorum' },
          { icon: 'calculator-outline', text: kcal ? `Günlük ~${kcal} kcal hedefini hesaplıyorum` : 'Kalori hedeflerini hesaplıyorum' },
          { icon: 'barbell-outline', text: 'Antrenman ve dinlenme günlerini ayırıyorum' },
          { icon: 'shield-checkmark-outline', text: 'Alerji ve kısıtlarını ayıklıyorum' },
          { icon: 'restaurant-outline', text: 'Öğünleri 7 güne diziyorum' },
          { icon: 'nutrition-outline', text: pro ? `Proteini ${pro} g hedefe oturtuyorum` : 'Makroları dengeliyorum' },
          { icon: 'checkmark-done-outline', text: 'Gün toplamlarını hedefle eşitliyorum' },
          { icon: 'sparkles-outline', text: 'Son kontrolleri yapıyorum' },
        ],
        [
          { icon: 'person-outline', text: 'Seni tanıyan notlara bakıyorum' },
          { icon: 'flag-outline', text: 'Hedefine göre bantları çıkarıyorum' },
          { icon: 'heart-outline', text: 'Sevdiğin yemekleri seçiyorum' },
          { icon: 'shield-checkmark-outline', text: 'Riskli besinleri eliyorum' },
          { icon: 'calendar-outline', text: 'Haftayı gün gün kuruyorum' },
          { icon: 'scale-outline', text: 'Gramajları ayarlıyorum' },
          { icon: 'calculator-outline', text: kcal ? `Her günü ~${kcal} kcal bandına oturtuyorum` : 'Her günü kalori bandına oturtuyorum' },
          { icon: 'sparkles-outline', text: 'Planı toparlıyorum' },
        ],
      ];
    case 'plan_workout':
      return [
        [
          { icon: 'document-text-outline', text: 'Seviyeni ve geçmişini okuyorum' },
          { icon: 'calendar-outline', text: 'Antrenman günlerini yerleştiriyorum' },
          { icon: 'medkit-outline', text: 'Sakatlık ve kısıtlarına bakıyorum' },
          { icon: 'barbell-outline', text: 'Hareketleri seçiyorum' },
          { icon: 'repeat-outline', text: 'Set ve tekrarları ayarlıyorum' },
          { icon: 'battery-charging-outline', text: 'Dinlenme günlerini dengeliyorum' },
          { icon: 'sparkles-outline', text: 'Programı toparlıyorum' },
        ],
        [
          { icon: 'body-outline', text: 'Vücut hedefini düşünüyorum' },
          { icon: 'git-branch-outline', text: 'Haftayı bölgelere ayırıyorum' },
          { icon: 'shield-checkmark-outline', text: 'Zorlayıcı hareketleri eliyorum' },
          { icon: 'fitness-outline', text: 'Egzersizleri sıralıyorum' },
          { icon: 'trending-up-outline', text: 'İlerleme adımlarını planlıyorum' },
          { icon: 'sparkles-outline', text: 'Son dokunuşları yapıyorum' },
        ],
      ];
    case 'plan_approve':
      return [
        [{ icon: 'checkmark-circle-outline', text: 'Onayını işliyorum' }, { icon: 'calendar-outline', text: 'Planı haftana yerleştiriyorum' }, { icon: 'today-outline', text: 'Günlük hedeflerini güncelliyorum' }],
        [{ icon: 'ribbon-outline', text: 'Planını aktif ediyorum' }, { icon: 'grid-outline', text: 'Günleri takvime diziyorum' }, { icon: 'flag-outline', text: 'Hedeflerini eşitliyorum' }],
      ];
    case 'recipe':
      return [
        [{ icon: 'book-outline', text: 'Tarif fikri arıyorum' }, { icon: 'basket-outline', text: 'Malzemeleri seçiyorum' }, { icon: 'shield-checkmark-outline', text: 'Alerjenleri ayıklıyorum' }, { icon: 'scale-outline', text: 'Ölçüleri hesaplıyorum' }, { icon: 'list-outline', text: 'Adımları sıralıyorum' }],
        [{ icon: 'flame-outline', text: 'Mutfağa giriyorum' }, { icon: 'leaf-outline', text: 'Malzeme listesini çıkarıyorum' }, { icon: 'calculator-outline', text: 'Porsiyon makrolarını hesaplıyorum' }, { icon: 'timer-outline', text: 'Pişirme adımlarını yazıyorum' }],
      ];
    case 'simulation':
      return [
        [{ icon: 'search-outline', text: 'Kalorisine bakıyorum' }, { icon: 'today-outline', text: 'Bugün ne yediğini topluyorum' }, { icon: 'calendar-outline', text: 'Haftalık bütçeni hesaplıyorum' }, { icon: 'git-compare-outline', text: 'Alternatif bir seçenek düşünüyorum' }, { icon: 'shield-checkmark-outline', text: 'Sayıları kontrol ediyorum' }],
        [{ icon: 'help-circle-outline', text: 'Senaryoyu kuruyorum' }, { icon: 'pie-chart-outline', text: 'Kalan bütçene bakıyorum' }, { icon: 'swap-horizontal-outline', text: 'Daha hafif bir seçenek arıyorum' }, { icon: 'analytics-outline', text: 'Haftaya etkisini hesaplıyorum' }],
      ];
    case 'eating_out':
      return [
        [{ icon: 'storefront-outline', text: 'Mekanı düşünüyorum' }, { icon: 'wallet-outline', text: 'Bugün ne kadar payın kaldığına bakıyorum' }, { icon: 'shield-checkmark-outline', text: 'Riskli yemekleri eliyorum' }, { icon: 'thumbs-up-outline', text: 'En iyi seçenekleri seçiyorum' }],
        [{ icon: 'map-outline', text: 'Menüyü kafamda canlandırıyorum' }, { icon: 'restaurant-outline', text: 'Akıllı seçimleri ayıklıyorum' }, { icon: 'chatbubbles-outline', text: 'Sosyal baskıya taktik hazırlıyorum' }],
      ];
    case 'support':
      return [
        [{ icon: 'heart-outline', text: 'Seni dinliyorum' }, { icon: 'leaf-outline', text: 'Düşünüyorum' }, { icon: 'hand-left-outline', text: 'Küçük bir adım arıyorum' }],
        [{ icon: 'heart-outline', text: 'Buradayım' }, { icon: 'cloud-outline', text: 'Söylediklerini tartıyorum' }, { icon: 'sunny-outline', text: 'Sana uygun bir yol düşünüyorum' }],
      ];
    case 'correction':
      return [
        [{ icon: 'arrow-undo-outline', text: 'Son kaydına bakıyorum' }, { icon: 'refresh-outline', text: 'Yanlışı geri alıyorum' }, { icon: 'create-outline', text: 'Doğrusunu işliyorum' }],
        [{ icon: 'search-outline', text: 'Neyi yanlış anladığımı buluyorum' }, { icon: 'arrow-undo-outline', text: 'Düzeltiyorum' }, { icon: 'checkmark-outline', text: 'Toplamları yeniden hesaplıyorum' }],
      ];
    case 'question':
      return [
        [{ icon: 'search-outline', text: 'Kayıtlarına bakıyorum' }, { icon: 'library-outline', text: 'Bildiklerimi topluyorum' }, { icon: 'bulb-outline', text: 'Cevabı toparlıyorum' }],
        [{ icon: 'reader-outline', text: 'Sorunu düşünüyorum' }, { icon: 'analytics-outline', text: 'Verilerine göre bakıyorum' }, { icon: 'chatbox-ellipses-outline', text: 'Net bir cevap yazıyorum' }],
        [{ icon: 'compass-outline', text: 'Konuyu tartıyorum' }, { icon: 'person-outline', text: 'Sana özel düşünüyorum' }, { icon: 'create-outline', text: 'Yazıyorum' }],
      ];
    case 'report_daily':
      return [
        [{ icon: 'clipboard-outline', text: 'Günün kayıtlarını topluyorum' }, { icon: 'git-compare-outline', text: 'Kalori ve proteini hedefle karşılaştırıyorum' }, { icon: 'water-outline', text: 'Su, uyku ve hareketine bakıyorum' }, { icon: 'speedometer-outline', text: 'Uyum puanını hesaplıyorum' }, { icon: 'footsteps-outline', text: 'Yarın için tek bir adım seçiyorum' }],
        [{ icon: 'today-outline', text: 'Gününü baştan sona okuyorum' }, { icon: 'pie-chart-outline', text: 'Makrolarını tartıyorum' }, { icon: 'help-circle-outline', text: 'Eksik kayıtları ayırıyorum' }, { icon: 'analytics-outline', text: 'Puanını çıkarıyorum' }, { icon: 'bulb-outline', text: 'Yarın için öneri yazıyorum' }],
      ];
    case 'report_weekly':
      return [
        [{ icon: 'calendar-outline', text: 'Haftanın günlerini diziyorum' }, { icon: 'calculator-outline', text: 'Ortalamaları hesaplıyorum' }, { icon: 'trending-down-outline', text: 'Tartı eğilimine bakıyorum' }, { icon: 'podium-outline', text: 'En iyi ve zor günleri buluyorum' }, { icon: 'create-outline', text: 'Gelecek hafta için not yazıyorum' }],
        [{ icon: 'albums-outline', text: 'Haftalık kayıtlarını topluyorum' }, { icon: 'wallet-outline', text: 'Haftalık bütçene bakıyorum' }, { icon: 'repeat-outline', text: 'Tekrarlayan alışkanlıkları arıyorum' }, { icon: 'sparkles-outline', text: 'Özeti toparlıyorum' }],
      ];
    case 'report_monthly':
      return [
        [{ icon: 'albums-outline', text: 'Son 4 haftayı topluyorum' }, { icon: 'trending-down-outline', text: 'Kilo değişimini hesaplıyorum' }, { icon: 'repeat-outline', text: 'Alışkanlık örüntülerini arıyorum' }, { icon: 'trophy-outline', text: 'Ayın başarısını seçiyorum' }, { icon: 'compass-outline', text: 'Önümüzdeki ay için yön çiziyorum' }],
        [{ icon: 'calendar-number-outline', text: 'Ayını hafta hafta okuyorum' }, { icon: 'analytics-outline', text: 'Eğilimleri çıkarıyorum' }, { icon: 'alert-circle-outline', text: 'Risk sinyallerine bakıyorum' }, { icon: 'sparkles-outline', text: 'Aylık özeti yazıyorum' }],
      ];
    case 'weekly_menu':
      return [
        [{ icon: 'document-text-outline', text: 'Hedeflerini okuyorum' }, { icon: 'barbell-outline', text: 'Antrenman günlerine göre kaloriyi ayarlıyorum' }, { icon: 'shield-checkmark-outline', text: 'Alerji ve kısıtlarını ayıklıyorum' }, { icon: 'restaurant-outline', text: '7 günlük menüyü kuruyorum' }, { icon: 'cart-outline', text: 'Alışveriş listesini çıkarıyorum' }, { icon: 'sparkles-outline', text: 'Son kontrolleri yapıyorum' }],
        [{ icon: 'heart-outline', text: 'Sevdiğin yemeklere bakıyorum' }, { icon: 'calculator-outline', text: 'Günlük kalorileri hesaplıyorum' }, { icon: 'leaf-outline', text: 'Mevsim ve çeşitliliği dengeliyorum' }, { icon: 'calendar-outline', text: 'Menüyü günlere yayıyorum' }, { icon: 'basket-outline', text: 'Alışveriş listesini hazırlıyorum' }],
      ];
    case 'opener':
      return [
        [{ icon: 'sparkles-outline', text: 'Konuyu hazırlıyorum' }, { icon: 'reader-outline', text: 'Son durumuna bakıyorum' }],
      ];
    default:
      return [
        [{ icon: 'chatbubble-ellipses-outline', text: 'Kochko yazıyor' }, { icon: 'bulb-outline', text: 'Düşünüyorum' }, { icon: 'create-outline', text: 'Cevabı toparlıyorum' }],
        [{ icon: 'ear-outline', text: 'Seni okuyorum' }, { icon: 'person-outline', text: 'Sana göre düşünüyorum' }, { icon: 'create-outline', text: 'Yazıyorum' }],
      ];
  }
}

/** Typical total duration per kind (measured live, 2026-10-04). */
const EXPECTED_MS: Record<TurnKind, number> = {
  photo: 13000, meal: 7000, water: 5000, sleep: 5500, weight: 5500, steps: 5000, workout: 6500,
  plan_diet: 26000, plan_workout: 22000, plan_approve: 6000, recipe: 11000, simulation: 13000, eating_out: 8000,
  support: 6500, correction: 6500, question: 7000, opener: 5000, generic: 6500,
  report_daily: 9000, report_weekly: 7000, report_monthly: 12000, weekly_menu: 25000,
};

const LONG: ReadonlySet<TurnKind> = new Set(['photo', 'plan_diet', 'plan_workout', 'recipe', 'simulation', 'report_daily', 'report_monthly', 'weekly_menu']);

/** Lines added when a turn runs well past its typical duration — the wait stays honest. */
const OVERTIME: Stage[] = [
  { icon: 'hourglass-outline', text: 'Biraz uzun sürdü, neredeyse hazır' },
  { icon: 'time-outline', text: 'Hâlâ buradayım, bitiriyorum' },
];

/**
 * Stage offsets: the first switch comes quickly (the user sees movement within ~1.5 s), then the
 * remaining stages spread over the expected duration, front-loaded so the last stage is reached
 * a little before the typical end. Overtime lines appear well past the typical end (≥ +5 s, then ≥ +15 s).
 */
function schedule(count: number, expectedMs: number): number[] {
  const at = [0];
  if (count <= 1) return at;
  const first = Math.min(1500, expectedMs * 0.22);
  const end = expectedMs * 0.8;
  for (let i = 1; i < count; i++) {
    const f = (i - 1) / Math.max(1, count - 2); // 0 … 1 across the remaining stages
    at.push(Math.round(i === 1 ? first : first + (end - first) * Math.pow(f, 0.85)));
  }
  return at;
}

/**
 * Build the narration for one turn. `pick` chooses the variant (pass Math.random() in the app;
 * tests pass a fixed number).
 */
export function buildThinkingScript(kind: TurnKind, ctx: ThinkingContext = {}, pick = 0): ThinkingScript {
  const pool = variants(kind, ctx);
  const chosen = pool[Math.min(pool.length - 1, Math.floor(Math.max(0, Math.min(0.9999, pick)) * pool.length))];
  const expectedMs = EXPECTED_MS[kind];
  const at = schedule(chosen.length, expectedMs);
  const stages = [...chosen, ...OVERTIME];
  at.push(Math.round(Math.max(expectedMs * 1.6, expectedMs + 5000)), Math.round(Math.max(expectedMs * 2.6, expectedMs + 15000)));
  return { kind, stages, at, expectedMs, long: LONG.has(kind), calm: kind === 'support' };
}

/** Index of the stage to show `elapsedMs` after the send. */
export function stageIndexAt(script: ThinkingScript, elapsedMs: number): number {
  let idx = 0;
  for (let i = 0; i < script.at.length; i++) if (elapsedMs >= script.at[i]) idx = i;
  return idx;
}

/** Estimated progress 0…0.95 for long kinds — asymptotic, never claims "done" before the reply. */
export function estimatedProgress(script: ThinkingScript, elapsedMs: number): number {
  const tau = script.expectedMs / 2.2;
  return Math.min(0.95, 1 - Math.exp(-elapsedMs / tau));
}

/** Number of "real" stages (without the overtime lines) — for the step pips. */
export function coreStageCount(script: ThinkingScript): number {
  return script.stages.length - OVERTIME.length;
}
