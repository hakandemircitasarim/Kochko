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
  | 'onboarding'     // İlk tanışma - profile building
  | 'periodic';      // Dönemsel durum yönetimi

/**
 * Detect the appropriate task mode from user message.
 */
export function detectTaskMode(message: string, isOnboarding: boolean): TaskMode {
  if (isOnboarding) return 'onboarding';

  const lower = message.toLocaleLowerCase('tr');

  // Register mode - logging food/workout/metrics
  if (/yedim|yuttum|ictim|içtim|aldim|aldım|kahvalt|ogle|öğle|aksam|akşam|atistir|atıştır|yemek yedim|ara ogun|ara öğün/.test(lower)) return 'register';
  if (/yaptim|yaptım|kostum|koştum|yurudum|yürüdüm|antrenman|salon|egzersiz|spor yaptim|spor yaptım|yuzdum|yüzdüm|bisiklet/.test(lower)) return 'register';
  if (/\d+\s*k(g|ilo)|tartildim|tartıldım|tartiya ciktim|tartıya çıktım/.test(lower)) return 'register';
  if (/su (ic|iç)|bardak|litre|su aldim|su aldım|su ictim|su içtim/.test(lower)) return 'register';
  if (/saat uyudum|gec yattim|geç yattım|erken kalktim|erken kalktım|uyku/.test(lower)) return 'register';
  if (/ruh hal|mood|keyf|mutsuz|mutlu|stresli|enerjik/.test(lower)) return 'register';

  // Periodic state mode
  if (/ramazan|hamile|hastalandim|hastalandım|tatile|seyahate|sakatl|sakatlandim|sakatlandım|emzir|donemsel|dönemsel|yogun is|yoğun iş|sinav|sınav/.test(lower)) return 'periodic';

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
"En az hasarli" secenekleri oner — kalorisi en dusuk, proteini en yuksek olanlari.
Menu fotografini analiz edebilirsin — en uygun 2-3 secenegi ISARETLERLE belirt.
Sosyal baski koclugu yap — yargilamadan, hasar minimizasyonu:
- "Is yemegindeyim" → porsiyon kontrol + protein agirlikli sec
- "Arkadaslar baskı yapıyor" → "karnım tok" stratejisi
- "Aile yemegi" → az al, yavaş ye stratejisi
Haftalik butce perspektifi MUTLAKA ver: "Haftalik butcende X kcal marjin var, rahat ol."
Mekan hafizasini kullan: daha once gitmisse bildigi yemekleri referans ver.
Gunu PROAKTIF ayarla: "Aksam disarida yiyeceksen, ogle hafif tut — salata veya tavuk."
Bilinen fast food zincirleri icin hazır en az hasarli secenek listeni kullan.

Yanıtının sonuna mekan bilgisi varsa:
<actions>[{"type": "venue_log", "venue_name": "mekan adi", "items": [{"name": "yemek", "calories": sayi, "protein_g": sayi}]}]</actions>`;

    case 'mvd':
      return `## MOD: MINIMUM VIABLE DAY
Ton: EN YUMUSAK. Baski YAPMA. Motivasyon konusmasi YAPMA.
Normal plani ASKIYA AL. Bugun sadece 3 basit hedef:
1. Su ic (en az 1 bardak)
2. Bir seyler ye ve kaydet (ne olursa olsun)
3. 10 dakika yuru veya erken yat

"Bu bile fazla" derse → 2 hedefe dusur.
"Hic yapamam" derse → tek hedef: "Sadece bugun su ic, baska bir sey beklmiyorum."

ASLA:
- "Hadi yapabilirsin" gibi baskici cumle KURMA
- Kalori hedefinden bahsetme
- Antrenman onerme
- Uzun aciklama yapma

Ertesi gun icin: "Yarin normal plana donecegiz, merak etme."
MVD plan askiya alma eylemi:
<actions>[{"type": "mvd_activate"}]</actions>`;

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
Haftalik butce etkisini de goster.

ONEMLI: Yanıtının sonuna asagidaki formatta bir <simulation> blogu ekle:
<simulation>{"foodName":"Yiyecek Adi","calories":350,"remaining":450,"weeklyImpact":"Haftalik butcede 2100 kcal kaliyor"}</simulation>
- foodName: Sorgulanan yiyecegin adi
- calories: Yiyecegin tahmini kalorisi
- remaining: Bu yiyecekten sonra gunluk kalan kalori butcesi
- weeklyImpact: Haftalik butce etkisini aciklayan kisa Turkce cumle`;

    case 'recovery':
      return `## MOD: HIZLI KURTARMA
1. YARGILAMA. "Herkesin boyle gunleri olur" gibi empati kur.
2. Gunun kalan kismina MINI KURTARMA PLANI sun:
   - Su ic (0.5L+)
   - Hafif aksam yemegi (protein agirlikli) veya "bugun yeterli"
   - Erken yat
3. HAFTALIK BUTCE perspektifi MUTLAKA ver:
   "Bugun X kcal fazla yedin ama haftalik butcende hala Y kcal marjin var."
4. "Bugun bozuldu ama HAFTA BITMEDI" mesajini AKTIF ver.
5. Yarin ve sonraki gunler icin DENGELEME stratejisi oner:
   "Kalan Z gunde gunluk W kcal azaltirsan hafta dengelenir."
6. Takip taahhut ekle:
   <actions>[{"type": "commitment", "text": "Kurtarma takibi", "follow_up_days": 1}]</actions>

ASLA:
- "Neden boyle yaptin?" deme
- Katı diyet onerme
- Sucluluk hissettirme
- "Bir daha yapma" deme`;

    case 'onboarding':
      return `## MOD: ONBOARDING
Kendini KISA tanit (1-2 cumle).
Her mesajda 1-2 soru sor, bombardiman YAPMA.
Dogal sohbet akisinda bilgi topla.
Boy, kilo, yas, cinsiyet, hedef - bunlari ogren.
Yeterli bilgi toplayinca profili tamamla.
Ilk plani olusturmak icin minimum: boy + kilo + yas + cinsiyet + hedef.`;

    case 'periodic':
      return `## MOD: DONEMSEL DURUM
Kullanici donemsel bir durum hakkinda konusuyor.
1. Durumu tani (ramazan/hastalik/hamilelik/emzirme/tatil/sinav/sakatlik/seyahat)
2. Bitis tarihi sor (biliniyorsa)
3. Plan degisikliklerini HEMEN acikla: kalori, antrenman, IF degisiklikleri
4. periodic_state_update eylemi olustur
5. Empati kur ama pratik ol

Durum uyumsuz ise IF'i otomatik durdur ve kullaniciya bildir.
Hastalik/sakatlanma durumunda iyilesme odakli ol.
Hamilelik/emzirmede destekleyici ve sabırli ol.`;
  }
}
