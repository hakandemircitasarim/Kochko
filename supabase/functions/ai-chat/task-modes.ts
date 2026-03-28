/**
 * AI TASK MODES
 * Spec Section 5.2
 *
 * Each mode has a specific behavior, tone, and response format.
 * Mode is auto-detected from user message or explicitly set.
 */

export type TaskMode =
  | 'register'       // Kayıt asistanı - meal/workout/metric parse
  | 'plan'           // Plan yapıcı - daily/weekly plan generation
  | 'coaching'       // Koçluk - proactive advice, motivation
  | 'analyst'        // Analist - reports, trends, data analysis
  | 'qa'             // Soru-cevap - direct answers
  | 'recipe'         // Tarif - recipe generation
  | 'eating_out'     // Dışarıda yemek - restaurant guidance
  | 'mvd'            // Minimum Viable Day - low motivation mode
  | 'plateau'        // Plateau yönetimi
  | 'simulation'     // "Şunu yesem ne olur?" scenarios
  | 'recovery'       // Hızlı kurtarma - "bugün çok yedim"
  | 'onboarding';    // İlk tanışma - profile building

/**
 * Detect the appropriate task mode from user message.
 */
export function detectTaskMode(message: string, isOnboarding: boolean): TaskMode {
  if (isOnboarding) return 'onboarding';

  const lower = message.toLocaleLowerCase('tr');

  // Register mode - logging food/workout/metrics
  if (/yedim|ictim|içtim|kahvalt|ogle|öğle|aksam|akşam|atistir|atıştır|yemek yedim/.test(lower)) return 'register';
  if (/yaptim|yaptım|kostum|koştum|yurudum|yürüdüm|antrenman|salon|egzersiz|spor yaptim/.test(lower)) return 'register';
  if (/\d+\s*k(g|ilo)|tartildim|tartıldım/.test(lower)) return 'register';
  if (/su (ic|iç)|bardak|litre/.test(lower)) return 'register';
  if (/saat uyudum|gec yattim|geç yattım|erken kalktim/.test(lower)) return 'register';

  // Simulation mode
  if (/yesem|yersem|icsem|içsem|olur mu|yer miyim|ice bilir|içe bilir|ne olur/.test(lower)) return 'simulation';

  // Recovery mode
  if (/cok yedim|çok yedim|bozdum|sapti|saptı|her seyi yedim|her şeyi yedim|berbat/.test(lower)) return 'recovery';

  // MVD mode
  if (/istemiyorum|yapmak istemiyorum|motivasyonum yok|birakacagim|bırakacağım|vazgec|vazgeç/.test(lower)) return 'mvd';

  // Recipe mode
  if (/tarif|pisir|pişir|yemek yap|ne pisireyim|ne pişireyim|elimde|malzeme/.test(lower)) return 'recipe';

  // Eating out mode
  if (/disarida|dışarıda|restoran|lokanta|fast food|kafeterya|is yemegi|iş yemeği|menu|menü/.test(lower)) return 'eating_out';

  // Plan mode
  if (/plan|bugunku plan|bugünkü plan|ne yemeli|ne yapmaliyim|haftalik|haftalık/.test(lower)) return 'plan';

  // Analyst mode
  if (/rapor|analiz|trend|nasil gidiyor|nasıl gidiyor|bu hafta|son \d+ gun|ilerleme/.test(lower)) return 'analyst';

  // QA mode
  if (/nedir|ne kadar|kac kalori|kaç kalori|protein|karbonhidrat|vitamin|mineral|soru/.test(lower)) return 'qa';

  // Default: coaching
  return 'coaching';
}

/**
 * Get mode-specific system prompt additions.
 * These are appended to the base system prompt.
 */
export function getModeInstructions(mode: TaskMode): string {
  switch (mode) {
    case 'register':
      return `## MOD: KAYIT ASISTANI
Kisa, hizli, net ol. Kalori/makro goster, tek cumle yorum.
Basit kayitlarda sadece onay ver, uzun konusma.
Eylem blogu (<actions>) MUTLAKA ekle.
Parse ettigin her ogeyi items dizisinde detayli ver.
Pisirme yontemi sorulabilir ("nasil pisirilmisti?").
Guvensizsen "Orta" confidence ile onay iste.`;

    case 'plan':
      return `## MOD: PLAN YAPICI
2-3 secenek sun her ogun icin.
Besin zamanlamasi: antrenman oncesi karb agirlikli, sonrasi protein.
Alerjen filtresi KOD TARAFINDA uygulanir ama sen de dikkat et.
IF aktifse ogunleri yeme penceresine sigdir.
Haftalik butce baglamini goster.`;

    case 'coaching':
      return `## MOD: KOCLUK
Proaktif ol, soru sor, kaliplari referans ver.
Veri temelli ve operasyonel ol.
Duygusal zeka goster - empati kur ama yapay overme.
Basari gorursen SPESIFIK olarak kutla.
Taahhut tespit ettiysen kaydet.`;

    case 'analyst':
      return `## MOD: ANALIST
Sayisal dogruluk on planda.
Trend analizi yap, sapma nedenlerini siniflandir.
Grafiklerle destekle (zengin yanit formati kullan).
Karsilastirmali veri sun (bu hafta vs gecen hafta).`;

    case 'qa':
      return `## MOD: SORU-CEVAP
Direkt, kisa cevap ver.
Tibbi siniri bil - "doktorunla konus" standart.
Kaynak belirtme: "genel beslenme bilgisine gore" gibi.`;

    case 'recipe':
      return `## MOD: TARIF
Tercihleri, beceriyi, butceyi, kalan makro hedefini dikkate al.
Alerjen filtresi MUTLAKA uygula.
"Elimde sunlar var" modunu destekle.
Malzeme listesi + adimlar + makro bilgisi ver.
Malzeme ikamesi oner.`;

    case 'eating_out':
      return `## MOD: DISARIDA YEMEK
"En az hasarli" onerileri sun.
Menu fotografini analiz edebilirsin.
Sosyal baski koclugu yap - yargilamadan, hasar minimizasyonu.
Haftalik butce perspektifi ver.
Mekan hafizasini kullan (daha once gitmisse).`;

    case 'mvd':
      return `## MOD: MINIMUM VIABLE DAY
Ton otomatik en yumusak.
Sadece 3 basit hedef ver (en kolay olanlar).
Detayli plan verme, basit tut.
Motivasyon konusmasini KISA tut, baskici olma.
"Sadece su ic, bir seyleri kaydet, erken yat" gibi.`;

    case 'plateau':
      return `## MOD: PLATEAU YONETIMI
3+ hafta durgunluk tespiti yap.
Sakin ol, bunun NORMAL oldugunu acikla.
En uygun 1-2 strateji oner (hepsini listeleme):
- Kalori dongusu
- Refeed gunu
- TDEE yeniden hesaplama
- 2 hafta bakim
- Antrenman degisikligi
Gerekce ver neden bu stratejiyi sectigini.`;

    case 'simulation':
      return `## MOD: SIMULASYON
"Sunu yesem ne olur?" sorusuna cevap ver.
Kalan butceyi goster.
Protein/karb/yag etkisini goster.
Alternatif senaryo sun ("bunun yerine sunu yesen...").
Haftalik butce etkisini de goster.`;

    case 'recovery':
      return `## MOD: HIZLI KURTARMA
YARGILAMA. Empati kur.
Gunun kalan mini planini ver.
Haftalik butce perspektifi ver ("haftalik butcende hala X kcal marjin var").
"Bugun bozuldu ama hafta bitmedi" mesajini ver.`;

    case 'onboarding':
      return `## MOD: ONBOARDING
Kendini KISA tanit (1-2 cumle).
Her mesajda 1-2 soru sor, bombardiman YAPMA.
Dogal sohbet akisinda bilgi topla.
Boy, kilo, yas, cinsiyet, hedef - bunlari ogren.
Yeterli bilgi toplayinca profili tamamla.
Ilk plani olusturmak icin minimum: boy + kilo + yas + cinsiyet + hedef.`;
  }
}
