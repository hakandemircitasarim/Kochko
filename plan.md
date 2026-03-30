# KOCHKO - Kapsamli Tamamlama Plani

## Context

Kochko, AI destekli yasam tarzi kocluk uygulamasi (React Native/Expo + Supabase). `kochko-spec-v10.md` dosyasinda 2126 satirlik detayli spec var. Uygulamanin iskeleti hazir (%90+ UI tamamlanmis) ancak bircok ozellik tam entegre degil, bazi servisler stub, bazi akislar eksik.

**Mevcut Durum Ozeti:**
- 25+ settings ekrani TAMAMLANMIS (UI)
- 5 tab ekrani TAMAMLANMIS (UI)
- 3 rapor ekrani TAMAMLANMIS (UI)
- 6 Edge Function TAMAMLANMIS (backend)
- 28 servis dosyasi (cogu tamamlanmis, bazi entegrasyon eksik)
- 23 component (tamamlanmis)
- Auth: sadece email/sifre (sosyal giris yok)
- Odeme: UI var, gercek IAP yok
- Bildirimler: tercih UI'i var, gercek push yok
- Offline: destek yok

**Ana Bosluklar:** Sosyal auth, odeme entegrasyonu, push notifications, bazi servis-UI entegrasyonlari, offline destek, tema degistirme, bazi gelismis AI ozellikleri.

---

## FAZ 1 - TEMEL ALTYAPI (Spec 21.1, Items 1-11)

### 1.1 Auth Sistemi (Spec 1.1-1.4)
**Dosyalar:** `src/stores/auth.store.ts`, `app/(auth)/login.tsx`, `app/(auth)/register.tsx`

- [ ] **T1.1** Google Sign-In entegrasyonu: `expo-auth-session` veya `@react-native-google-signin` kur, Supabase OAuth ayarla
- [ ] **T1.2** Apple Sign-In entegrasyonu: `expo-apple-authentication` kur, Supabase'de aktif et
- [ ] **T1.3** `auth.store.ts`'e `signInWithGoogle()` ve `signInWithApple()` ekle, login/register ekranlarinda sosyal giris butonlari ekle
- [ ] **T1.4** Email dogrulama zorunlulugu: Kayit sonrasi "email kontrol et" ekrani (`app/(auth)/verify-email.tsx`), `email_confirmed_at` olmadan plan uretimini engelle
- [ ] **T1.5** Sifre sifirlama: `supabase.auth.resetPasswordForEmail()`, yeni `app/(auth)/reset-password.tsx` ekrani, login'de "sifremi unuttum" linki
- [ ] **T1.6** Hesap baglama (account linking): Google kullanici sonradan Apple/email baglayabilmeli. Yeni `app/settings/account-security.tsx` ekrani
- [ ] **T1.7** Coklu cihaz oturum yonetimi: Aktif oturumlari gorme ve uzaktan kapatma. Esanli AI sohbet kilidi (15dk timeout)
- [ ] **T1.8** Hesap silme 30 gunluk yumusak silme: `deleted_at` kolonu, 30 gun icinde geri donebilme, sonra kalici silme (scheduled function)

### 1.2 Backend Guvenlik (Spec 18.4, 16.4)
**Dosyalar:** `supabase/functions/shared/`

- [ ] **T1.9** Rate limiting: Tum edge function'lara kullanici bazli gunluk API call siniri (free vs premium). Yeni `shared/rate-limit.ts`
- [ ] **T1.10** Request validasyonu: JSON body sema kontrolu, buyuk payload reddi. Yeni `shared/request-validator.ts`
- [ ] **T1.11** Prompt injection korumasi: `sanitizeUserInput()` fonksiyonu `shared/guardrails.ts`'e ekle. Bilinen injection kaliplarini tespit et ve engelle (Spec 5.26)

### 1.3 Profil + Kayit Sistemi Entegrasyonu (Spec 2.1, 3.1, 12.6)
**Dosyalar:** `src/stores/dashboard.store.ts`, `app/(tabs)/index.tsx`, `src/lib/day-boundary.ts`

- [ ] **T1.12** Gun siniri (day boundary) entegrasyonu: `dashboard.store.ts`'deki naive `new Date()` kullanimimini `getEffectiveDate()` ile degistir. Tum tarih hesaplamalari `day-boundary.ts` uzerinden
- [ ] **T1.13** Stres kaydi UI: `MoodTracker.tsx`'e stres notu alani ekle veya ayri `StressInput` componenti, `daily_metrics.stress_note` yazilsin
- [ ] **T1.14** Toparlanma kaydi UI: Yeni `RecoveryInput.tsx` componenti (kas agrisi 1-5, toparlanma hissi), dashboard'a ekle. Sadece guc antrenmani yapanlara goster
- [ ] **T1.15** `checkSuspiciousInput()` entegrasyonu: `guardrails-client.ts`'deki fonksiyonu su, kilo, uyku girisleri oncesi cagir. Suphe varsa Alert ile dogrulama iste
- [ ] **T1.16** Supplement hizli kayit: `SupplementQuickAdd.tsx` componentini dashboard'a entegre et
- [ ] **T1.17** Gecmise donuk kayit (batch entry): Sohbette "dunku ogunu gireyim" dendiginde tarih secici, `logged_for_date` kolonunu kullan

### 1.4 TDEE Hesaplama Entegrasyonu (Spec 2.4)
**Dosyalar:** `src/lib/tdee.ts`, `supabase/functions/ai-chat/index.ts`

- [ ] **T1.18** Onboarding tamamlandiginda TDEE hesapla ve profile kaydet (kalori araliklari, makro hedefleri)
- [ ] **T1.19** Kilo kaydedildiginde `shouldRecalculateTDEE()` kontrol et, gerekirse otomatik yeniden hesapla
- [ ] **T1.20** Dinamik aktivite carpani: 2-4 haftalik veri sonrasi tahmini vs gercek kilo degisimini karsilastirarak carpani refine et

### 1.5 AI Chat Saglamlastirma (Spec 5.1-5.32)
**Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/output-validator.ts`

- [ ] **T1.21** Structured output retry: `validateMealParse()` hata bulursa hatayi OpenAI'a geri gonderip 1 kez retry yap
- [ ] **T1.22** "Son kaydi sil" aksiyonu: `undo_last` action tipi ekle, son action'i geri al
- [ ] **T1.23** `token_count` ve `model_version` bilgisini `chat_messages`'a yaz (kolonlar var, hic doldurulmuyor)
- [ ] **T1.24** `actions_executed` JSONB bilgisini mesajla birlikte kaydet
- [ ] **T1.25** Sohbet oturumu baslik otomatik olusturma: Her N mesajda `chat_sessions.title` ve `topic_tags` guncelle
- [ ] **T1.26** Dusuk guven durumunda kullanicidan onay isteme akisi: "pending_confirmation" state

### 1.6 Plan Uretimi Tamamlama (Spec 7.1-7.4)
**Dosyalar:** `supabase/functions/ai-plan/index.ts`, `app/(tabs)/plan.tsx`

- [ ] **T1.27** Plan versiyonlama: Regenerate'de version artir, versiyon gecmisi goster
- [ ] **T1.28** Plan onaylama/reddetme akisi: "Onayla" / "Degistir" butonlari, `status` ve `approved_at` kaydet
- [ ] **T1.29** `validatePlanOutput()` calistir: Plan uretildikten sonra output-validator'den gecir

### 1.7 Dashboard Tamamlama (Spec 8, 17)
**Dosyalar:** `app/(tabs)/index.tsx`, `src/stores/dashboard.store.ts`

- [ ] **T1.30** "Bugunun tek odagi" mesaji: `daily_plans.focus_message` fetch et, dashboard'un ustune goster
- [ ] **T1.31** `WeeklyBudgetWidget` entegrasyonu: Component var, `weekly-budget.ts` ile veri bagla, dashboard'a ekle
- [ ] **T1.32** IF penceresi gostergesi: `profile.if_active` ise yeme penceresi durumunu goster (acik/kapali, geri sayim)
- [ ] **T1.33** `StepCounter.tsx` entegrasyonu: Component var, `daily_metrics.steps` ile bagla

### 1.8 Premium / Odeme (Spec 16)
**Dosyalar:** `app/settings/premium.tsx`, `src/hooks/usePremium.ts`

- [ ] **T1.34** RevenueCat veya `expo-in-app-purchases` entegrasyonu: Aylik/yillik abonelik urunleri
- [ ] **T1.35** Trial donemi: Yeni kullanicilar N gun ucretsiz premium. `premium_expires_at` takibi
- [ ] **T1.36** Edge function'larda premium bazli rate limiting
- [ ] **T1.37** Downgrade akisi: Premium bitince veriyi koru, AI etkilesimini sinirla, upsell goster

### 1.9 Rapor Uretimi (Spec 8.1-8.2)
**Dosyalar:** `supabase/functions/ai-report/index.ts`, `app/reports/`

- [ ] **T1.38** Otomatik gunluk rapor tetikleyici: Gun sinirinda veya ertesi gun ilk giriste otomatik uret
- [ ] **T1.39** Gunluk rapor ekraninin veriye baglanmasi: Compliance score gorsellestirimesi, sapma etiketleri
- [ ] **T1.40** Haftalik rapor ekraninin veriye baglanmasi: Kilo trendi grafigi, uyum haritasi

### 1.10 Hedef Motoru (Spec 6.1-6.7)
**Dosyalar:** `src/services/goals.service.ts`, `app/settings/goals.tsx`

- [ ] **T1.41** `goals.service.ts` tamamla: CRUD, deaktivasyon, otomatik faz gecisi
- [ ] **T1.42** Hedef ekranini form ile tamamla: hedef tipi, hedef kilo, sure, oncelik, kisit modu
- [ ] **T1.43** Hedef ilerlemesini haftalik rapora entegre et: Kullanici hedefe gore yolda mi?

---

## FAZ 2 - KOCLUK DERINLIGI (Spec 21.1, Items 12-30)

### 2.1 Haftalik Kalori Butcesi (Spec 2.6) - Item 12
**Dosyalar:** `src/lib/weekly-budget.ts`, `src/components/tracking/WeeklyBudgetWidget.tsx`, `src/stores/dashboard.store.ts`

- [ ] **T2.1** Dashboard store'a haftalik butce hesaplama ekle: `getWeeklyStatus()` fonksiyonunu her gun fetch'inde cagir
- [ ] **T2.2** `WeeklyBudgetWidget.tsx`'i gercek veriye bagla ve dashboard'da render et
- [ ] **T2.3** Haftalik butce durumunu gunluk plana yansit: "Bu hafta X kcal marjin var" mesaji

### 2.2 Haftalik Rapor Tamamlama (Spec 8.2) - Item 13
**Dosyalar:** `app/reports/weekly.tsx`

- [ ] **T2.4** Kilo trendi grafigi (react-native-chart-kit ile)
- [ ] **T2.5** Uyum haritasi, en iyi/en kotu gun, sapma analizi gorsel
- [ ] **T2.6** Guc progresyon ozeti (antrenman stili guc agirlikli ise)
- [ ] **T2.7** AI ogrenme notu gorunumu

### 2.3 Favori Ogun Sablonlari + Su Formulu (Spec 3.4, 2.7) - Item 14
**Dosyalar:** `src/services/templates.service.ts`, `app/settings/meal-templates.tsx`

- [ ] **T2.8** `templates.service.ts` CRUD dogrula: olusturma, silme, kullanim sayisi artirma, sablondan hizli kayit
- [ ] **T2.9** Sablondan tek dokunusla ogun kaydi akisi: Chat'e veya dashboard'a "sablonlarim" butonu
- [ ] **T2.10** AI'in 3+ kez tekrar eden ogunu tespit edip sablon onerme akisi (progressive disclosure ile)
- [ ] **T2.11** Su hedefinin `calculateWaterTarget()` ile dinamik hesaplanmasi: antrenman gunu, mevsim, kafein

### 2.4 Barkod Okuma (Spec 3.1, 19) - Item 15
**Dosyalar:** `src/services/barcode.service.ts`

- [ ] **T2.12** `expo-camera` barkod modu veya `expo-barcode-scanner` entegrasyonu
- [ ] **T2.13** Barkod tarama butonunu chat input'a veya dashboard hizli aksiyona ekle
- [ ] **T2.14** OpenFoodFacts API lookup + yerel cache (AsyncStorage ile offline destek)
- [ ] **T2.15** Bulunamayan barkod icin serbest metin girisi fallback ve barkod kaydedilmesi

### 2.5 IF (Aralikli Oruc) Modu (Spec 2.1, 9.4) - Item 16
**Dosyalar:** `app/settings/if-settings.tsx`, `supabase/functions/ai-plan/index.ts`

- [ ] **T2.16** IF ayarlar ekranini dogrula: protokol secimi (16:8, 18:6, 20:4, ozel), saat girisi, profile kayit
- [ ] **T2.17** Plan uretiminde IF penceresi zorunlulugu: Kod seviyesinde ogun onerilerinin pencere icinde oldugunu dogrula
- [ ] **T2.18** Dashboard'da IF zamanlayici widget: Yeme penceresi acik/kapali, geri sayim

### 2.6 Bildirim Sistemi (Spec 10.1-10.4) - Item 17
**Dosyalar:** `src/services/notifications.service.ts`, `app/_layout.tsx`, `app/settings/notifications.tsx`

- [ ] **T2.19** `expo-notifications` baslatma: Root layout'ta kayit, push token alma
- [ ] **T2.20** `device_tokens` tablosu veya profilde token saklama (yeni migration)
- [ ] **T2.21** Yerel bildirim zamanlama: Ogun hatirlatma, su hatirlatma, tarti hatirlatma, spor hatirlatma
- [ ] **T2.22** `ai-proactive/index.ts` mesajlarini push notification'a bagla
- [ ] **T2.23** Bildirim izni UX akisi: Ilk kez stratejik zamanda iste, reddedilirse 3-5 gun sonra tekrar dene
- [ ] **T2.24** Bildirim ayarlari ekranini dogrula: Her tip ayri toggle, sessiz saatler, gunluk limit

### 2.7 Minimum Viable Day Modu (Spec 5.2) - Item 18
**Dosyalar:** `supabase/functions/ai-chat/task-modes.ts`

- [ ] **T2.25** MVD modunu uctan uca test et: "motivasyonum yok" -> 3 basit hedef, yumusak ton, baskilamama

### 2.8 Re-engagement (Geri Donus) Akisi (Spec 10.4) - Item 19
**Dosyalar:** `supabase/functions/ai-proactive/index.ts`, `src/services/notifications.service.ts`

- [ ] **T2.26** 3 gun sessizlik: Hafif push notification (Layer 2 verisi kullanarak kisisellestir)
- [ ] **T2.27** 7 gun sessizlik: Derin kissilestirme ile bildirim (streak, son basari referansi)
- [ ] **T2.28** 14+ gun sessizlik: Email bildirimi (email gonderim altyapisi gerekli)
- [ ] **T2.29** 6+ ay sonra geri donus: Re-onboarding akisi, profil guncelleme, TDEE yeniden hesaplama

### 2.9 Telefon Adim Sayaci (Spec 14.2) - Item 20
**Dosyalar:** `src/components/tracking/StepCounter.tsx`

- [ ] **T2.30** `expo-sensors` veya Apple HealthKit / Google Fit entegrasyonu
- [ ] **T2.31** `daily_metrics.steps` otomatik doldurma, `steps_source: 'phone'`

### 2.10 Fotograf ile Ogun Kaydi (Spec 3.1) - Item 21
**Dosyalar:** `app/(tabs)/chat.tsx`, `supabase/functions/ai-chat/index.ts`

- [ ] **T2.32** Foto fallback: Dusuk guvenli analiz durumunda metin girisi isteme
- [ ] **T2.33** Foto + metin combo: Chat'te thumbnail gosterimi iyilestirme
- [ ] **T2.34** Bulanik/karanlik foto tespiti ve "metin olarak gir" yonlendirmesi

### 2.11 Porsiyon Kalibrasyonu (Spec 5.23) - Item 22
**Dosyalar:** `supabase/functions/shared/memory.ts`, `app/(tabs)/profile.tsx`

- [ ] **T2.35** Onboarding'de AI porsiyon kalibrasyonu baslatma (ilk hafta icinde standart sorular)
- [ ] **T2.36** Layer 2'deki porsiyon kalibrasyonlarini profil ekraninda gosterme/duzenleme

### 2.12 AI Oneri Geri Bildirimi (Spec 5.7) - Item 23
**Dosyalar:** `src/services/feedback.service.ts`, `src/components/chat/FeedbackButtons.tsx`

- [ ] **T2.37** `feedback.service.ts`'in `ai_feedback` tablosuna yazdigini dogrula
- [ ] **T2.38** Geri bildirimlerin Layer 2'de okunup gelecek onerileri etkiledigini dogrula

### 2.13 Simulasyon Modu (Spec 5.2) - Item 24
- [ ] **T2.39** Uctan uca test: "pizza yesem ne olur?" -> kalan butce, alternatif, haftalik etki

### 2.14 Hizli Kurtarma Modu (Spec 5.2) - Item 25
- [ ] **T2.40** Uctan uca test: "bugun cok yedim" -> empatik yanit, haftalik perspektif, mini kurtarma plani

### 2.15 Kademeli Zorluk Artisi (Spec 5.30) - Item 26
**Dosyalar:** `src/services/adaptive-difficulty.service.ts`

- [ ] **T2.41** `checkAdaptiveDifficulty()` sonuclarini profile kaydet (su an sadece oneri donuyor, persist etmiyor)
- [ ] **T2.42** Haftalik rapor veya plan uretiminde zorluk ayarlamasini tetikle

### 2.16 Beslenme Okuryazarligi (Spec 5.31) - Item 27
- [ ] **T2.43** Layer 2'de `nutrition_literacy` seviyesinin dogru yazilip okundugunu dogrula
- [ ] **T2.44** System prompt'un dusuk okuryazarlikta aciklama serpistigini test et

### 2.17 Progressive Disclosure (Spec 5.33) - Item 28
**Dosyalar:** `src/services/progressive-disclosure.service.ts`

- [ ] **T2.45** `getFeaturesToIntroduce()` sonuclarini Layer 2 `features_introduced` dizisine yaz
- [ ] **T2.46** `shared/memory.ts`'de Layer 2 ciktisina `features_introduced` ekle
- [ ] **T2.47** AI'in zaten tanittigi ozellikleri tekrar tanitmamasini dogrula

### 2.18 Aliskanlik Koclugu (Spec 5.35) - Item 29
**Dosyalar:** `src/services/habits.service.ts`

- [ ] **T2.48** `habits.service.ts` CRUD dogrula: aliskanlik onerisi, streak takibi, stacking mantigi
- [ ] **T2.49** Layer 2'de `habit_progress` verisinin dogru yazildigini dogrula

### 2.19 AI Hedef Onerisi (Spec 6.4) - Item 30
**Dosyalar:** `supabase/functions/ai-proactive/index.ts`

- [ ] **T2.50** 2+ haftalik veri sonrasi AI'in proaktif hedef onerisi gonderme mantigi
- [ ] **T2.51** Ayda en fazla 1-2 oneri siniri

## FAZ 3 - ILERI OZELLIKLER (Spec 21.1, Items 31-45)

### 3.1 Haftalik Menu Planlama + Alisveris Listesi (Spec 7.1, 7.3) - Item 31
**Dosyalar:** `src/services/weekly-plan.service.ts`, `app/settings/weekly-menu.tsx`

- [ ] **T3.1** `weekly-plan.service.ts` tamamla: 7 gunluk plan uretimi, gun bazli degisiklik, alisveris listesi toplama
- [ ] **T3.2** `weekly-menu.tsx` ekranini dogrula: 7 gunluk gorunum, ogun degistirme, alisveris listesi tab'i
- [ ] **T3.3** Alisveris listesi uretimi: Malzemeleri benzersizlestir, miktarlari topla, kategori bazli gruplama

### 3.2 Tarif Kutuphanesi (Spec 7.7) - Item 32
**Dosyalar:** `src/services/recipes.service.ts`, `app/settings/recipes.tsx`

- [ ] **T3.4** `recipes.service.ts` CRUD dogrula: kaydet, listele, filtrele, sil
- [ ] **T3.5** `recipes.tsx` ekranini dogrula: kategori filtresi, malzeme listesi, pisirme talimatlari
- [ ] **T3.6** Sohbette tarif kaydetme aksiyonu: AI tarif verdiginde "kaydet" butonu, `save_recipe` action tipi
- [ ] **T3.7** Malzeme ikamesi: "Tavuk yerine ne koyabilirim?" akisi (AI prompt-driven)
- [ ] **T3.8** "Elimde sunlar var" modu: Kullanicinin mevcut malzemelerinden tarif onerisi (AI prompt-driven)

### 3.3 Meal Prep Plani (Spec 7.6) - Item 33
**Dosyalar:** Yeni `src/services/meal-prep.service.ts`

- [ ] **T3.9** Meal prep servisi olustur: Toplu hazirlama plani, miktar olcekleme, saklama talimatlari
- [ ] **T3.10** Haftalik menu ekranina veya ayri ekrana meal prep bolumu ekle
- [ ] **T3.11** Profildeki `meal_prep_active` ve `meal_prep_days` degerlerini kullan

### 3.4 Plateau Yonetimi (Spec 6.5) - Item 34
**Dosyalar:** `src/services/plateau.service.ts`, `supabase/functions/ai-proactive/index.ts`

- [ ] **T3.12** `plateau.service.ts` dogrula: 3+ hafta +-0.3kg durgunluk tespiti
- [ ] **T3.13** Proaktif mesajla plateau bildirimi: AI kullaniciya strateji secenekleri sun (kalori dongusu, refeed, TDEE yeniden hesap, 2 hafta bakim, antrenman degisikligi)
- [ ] **T3.14** Secilen stratejiyi plana uygulama akisi

### 3.5 Bakim Modu / Maintenance (Spec 6.6) - Item 35
**Dosyalar:** `src/services/maintenance.service.ts`

- [ ] **T3.15** `maintenance.service.ts` dogrula: Hedefe ulastiginda otomatik oneri
- [ ] **T3.16** Reverse diet: 2-4 haftalik kademeli kalori artisi plani
- [ ] **T3.17** Tolerans bandi: Hedef kilodan +-1.5kg, asildiginda proaktif uyari
- [ ] **T3.18** Bakim milestone'lari: 1 ay, 3 ay, 6 ay bakimda kalma basarilari

### 3.6 Cok Fazli Hedef (Cut/Bulk Dongusu) (Spec 6.7) - Item 36
**Dosyalar:** `src/services/goals.service.ts`, `app/settings/multi-phase-goals.tsx`

- [ ] **T3.19** `multi-phase-goals.tsx` dogrula: Ardisik faz tanimlama, zaman cizelgesi gorunumu
- [ ] **T3.20** Otomatik faz gecisi: Hedefe ulasildiginda veya sure doldugunda sonraki faza kademeli gecis
- [ ] **T3.21** Her fazin ayri TDEE, makro ve tempo hesabi

### 3.7 Guc Antrenmani Progresyon (Spec 7.5) - Item 37
**Dosyalar:** `src/services/strength.service.ts`, `app/settings/strength.tsx`

- [ ] **T3.22** `strength.service.ts` dogrula: `strength_sets` okuma, PR hesaplama, progresyon takibi
- [ ] **T3.23** `strength.tsx` dogrula: Hareket listesi, 1RM gecmisi, PR rozeti, progresyon grafigi
- [ ] **T3.24** AI chat'te guc set parse: "bench press 4x8 70kg" -> `strength_sets` tablosuna kayit
- [ ] **T3.25** Deload onerisi: 4-6 haftalik yogun donem sonrasi otomatik deload hatirlat

### 3.8 Alkol Takibi (Spec 3.1) - Item 38
**Dosyalar:** `supabase/functions/ai-chat/index.ts`

- [ ] **T3.26** AI'in "2 bira ictim" parse edip `meal_log_items.alcohol_g` doldurdugunu dogrula
- [ ] **T3.27** Alkol kalorisinin gunluk toplama ve haftalik rapora ayri satirda yansimasi
- [ ] **T3.28** Alkol-sapma korelasyonu: AI'in alkol sonrasi plansiz atistirma kalibini tespit etmesi

### 3.9 Lab Modulu (Spec 3.1) - Item 39
**Dosyalar:** `src/services/health.service.ts`, `app/settings/lab-values.tsx`

- [ ] **T3.29** `lab-values.tsx` dogrula: Parametre ekleme, referans aralik, aralik disi uyari
- [ ] **T3.30** AI proaktif tahlil onerisi: Onemli diyet degisikliginden 3 ay sonra, uzun kisitlama sonrasi

### 3.10 Donemsel Durum Yonetimi (Spec 9) - Item 40
**Dosyalar:** `src/services/periodic.service.ts`, `app/settings/periodic-state.tsx`

- [ ] **T3.31** `periodic-state.tsx` dogrula: Ramazan, tatil, hastalik, hamilelik, seyahat vb. aktif etme
- [ ] **T3.32** Donemsel durum hafizasi: AI gecmis donemleri Layer 2'ye yazsin, gelecek donemlere referans
- [ ] **T3.33** Donem bitisinde kademeli normal plana gecis

### 3.11 Challenge Modulu (Spec 13.5) - Item 41
**Dosyalar:** `src/services/challenges.service.ts`, `app/settings/challenges.tsx`

- [ ] **T3.34** `challenges.tsx` dogrula: Aktif challenge'lar, ilerleme barı, sistem challenge kutuphanesi
- [ ] **T3.35** Challenge duraklatma: Donemsel durum devreye girdiginde otomatik duraklat
- [ ] **T3.36** En fazla 2 aktif challenge siniri
- [ ] **T3.37** Dashboard'da challenge ilerleme mini gostergesi

### 3.12 Mekan Hafizasi (Spec 2.1, 5.2) - Item 42
**Dosyalar:** `src/services/venues.service.ts`, `app/settings/venues.tsx`

- [ ] **T3.38** `venues.tsx` dogrula: Ogrenilen mekanlar, yemek bilgileri, ziyaret sayisi
- [ ] **T3.39** AI sohbette "Simit Sarayi'na gittim" denildiginde mekan hafizasini kullanma
- [ ] **T3.40** Menu fotografı analizi: Restoran menusu fotolayip oneri alma
- [ ] **T3.41** Sosyal yeme baskisi koclugu: "Is yemegindeyim" senaryosunda hasar minimizasyonu

### 3.13 Prediktif Analitik (Spec 5.14) - Item 43
**Dosyalar:** `src/services/predictive.service.ts`

- [ ] **T3.42** `predictive.service.ts` tamamla (dosya truncated gorunuyor): Hafta sonu sapma tahmini, atistirma saati tahmini
- [ ] **T3.43** Motivasyon dusus erken uyarisi: Streak kirilma riski, kayit sikligi dusme
- [ ] **T3.44** Alkol-sapma tahmini: Cuma gunu proaktif strateji sunma

### 3.14 Kafein-Uyku Korelasyonu (Spec 5.34) - Item 44
**Dosyalar:** `src/services/caffeine.service.ts`

- [ ] **T3.45** `caffeine.service.ts` dogrula: Kafein tespiti (kahve, cay, enerji icecegi), gunluk toplam
- [ ] **T3.46** Kafein-uyku korelasyonu: 15:00 sonrasi kafein ile uyku kalitesi iliskisi
- [ ] **T3.47** 400mg/gun uyarisi

### 3.15 Sohbet Gecmisi Arama (Spec 5.18) - Item 45
**Dosyalar:** `app/settings/chat-history.tsx`

- [ ] **T3.48** `chat-history.tsx` dogrula: Oturum listesi, arama, konu etiketi, secerek/toplu silme
- [ ] **T3.49** "Sohbet silinse bile kocun ogrendikleri korunur" uyarisi

## FAZ 4 - GENISLEME VE POLISH (Spec 21.1, Items 46-58)

### 4.1 Sesli Giris (Spec 20.3) - Item 46
**Dosyalar:** `app/(tabs)/chat.tsx`, yeni `src/services/voice.service.ts`

- [ ] **T4.1** `expo-speech` veya Whisper API entegrasyonu
- [ ] **T4.2** Chat input'a mikrofon butonu ekle
- [ ] **T4.3** Speech-to-text sonucunu normal metin mesaji olarak isle

### 4.2 Ilerleme Fotograflari (Spec 3.1) - Item 47
**Dosyalar:** Yeni `app/settings/progress-photos.tsx`

- [ ] **T4.4** Foto cekim ekrani: On/yan/arka pozlar
- [ ] **T4.5** Yerel sifrelenmis depolama (AI'a gonderilmez)
- [ ] **T4.6** Zaman cizelgesi karsilastirma: Tarih secerek yan yana goruntulem
- [ ] **T4.7** Yuz bulaniklastirma secenegi (paylasim oncesi)

### 4.3 Saglik Profesyoneli Rapor Exportu (Spec 8.7) - Item 48
**Dosyalar:** `src/services/export.service.ts`, `app/settings/health-export.tsx`

- [ ] **T4.8** PDF formatinda profesyonel rapor uretimi
- [ ] **T4.9** Kullanicinin raporda hangi verilerin yer alacagini secmesi
- [ ] **T4.10** CSV ham veri export secenegi

### 4.4 Baska Uygulamadan Veri Import (Spec 14.4) - Item 49
**Dosyalar:** `src/services/import.service.ts`, `app/settings/data-import.tsx`

- [ ] **T4.11** MyFitnessPal CSV format destegi
- [ ] **T4.12** FatSecret format destegi
- [ ] **T4.13** Import edilen verilerin gecmis kayit olarak islenmesi

### 4.5 Saat Dilimi / Seyahat Yonetimi (Spec 2.5) - Item 50
**Dosyalar:** `src/lib/day-boundary.ts`, `src/stores/profile.store.ts`

- [ ] **T4.14** Otomatik timezone tespiti: Telefon timezone'u degistiginde algilanip profile yazilsin
- [ ] **T4.15** IF penceresi + timezone cakismasi: 6+ saat farkta pencere esnetme
- [ ] **T4.16** Seyahat tespiti ve baglamsali mutfak bilgisi genisletme

### 4.6 Wearable Entegrasyonlari (Spec 14.1) - Item 51
- [ ] **T4.17** Apple Health / Google Fit entegrasyonu: adim, nabiz, uyku verisi cekme
- [ ] **T4.18** HRV verisi ile toparlanma durumu degerlendirme
- [ ] **T4.19** Akilli tarti entegrasyonu (ileride)

### 4.7 Sosyal / Paylasim Ozellikleri (Spec 13.4) - Item 52
- [ ] **T4.20** Ilerleme grafigi, haftalik rapor veya milestone paylasimi (Instagram story, WhatsApp)
- [ ] **T4.21** Arkadaslik davet mekanizmasi
- [ ] **T4.22** Gizlilik kontrolu: Neyin paylasilacagini secme, hassas veri otomatik gizleme

### 4.8 Zengin Sohbet Yanitlari (Spec 5.20) - Item 53
**Dosyalar:** `src/components/chat/RichMessage.tsx`

- [ ] **T4.23** Mini chart destegi: Kalori progress bar, makro pie chart inline gosterim
- [ ] **T4.24** Hizli secim butonlari: "Aksam ne yiyelim?" sorusuna 2-3 secenek butonu
- [ ] **T4.25** Onay butonlari: Plan degisikligi onerildikginde "Onayla / Reddet"
- [ ] **T4.26** Kaydiriabilir tarif karti ve simulasyon karti

### 4.9 AI Sesli Yanit (Spec 20.3) - Item 54
- [ ] **T4.27** TTS entegrasyonu: AI yanitini sesli okuma
- [ ] **T4.28** Ses tonu koc tercihine uyumlu

### 4.10 Widget Destegi (Spec 23) - Item 55
- [ ] **T4.29** Gunluk ozet widget: Kalori durumu, protein bari, su bari
- [ ] **T4.30** Bugunun tek odagi widget
- [ ] **T4.31** Hizli kayit widget: Su ekle, ogun kaydi kisayolu
- [ ] **T4.32** Streak widget

### 4.11 Debug/Seffaflik Modu (Spec 5.22) - Item 56
- [ ] **T4.33** Ayarlar > Gelistirici Modu: Katman token kullanimini goster
- [ ] **T4.34** AI gorev modunu ve guardrail tetiklenmelerini goster
- [ ] **T4.35** Kullanilan AI modeli ve versiyonu bilgisi

### 4.12 Zamanlanmis Export + Katman 2 Export (Spec 18.2) - Item 57
- [ ] **T4.36** Haftalik/aylik otomatik veri yedegi (email veya bulut depolama)
- [ ] **T4.37** Katman 2 (AI ogrenme notlari) export: JSON formatinda

### 4.13 Aile Plani / Household (Spec 20.4) - Item 58
- [ ] **T4.38** `household_id` alani profil tablosuna ekle (null varsayilan)
- [ ] **T4.39** Ortak alisveris listesi, ortak meal prep, paylasilan tarif kutuphanesi

### 4.14 Tema Degistirme ve Erisilebilirlik (Spec 22)
**Dosyalar:** `src/lib/constants.ts`, `src/lib/accessibility.ts`

- [ ] **T4.40** Acik tema renk seti olustur, tema context/provider yaz
- [ ] **T4.41** Ayarlarda tema secimi: Sistemi takip et / Her zaman acik / Her zaman koyu
- [ ] **T4.42** `accessibility.ts` helper'larini uygula: Min 44x44px dokunma alanlari, screen reader etiketleri
- [ ] **T4.43** WCAG AA kontrast orani kontrolu

### 4.15 Offline Destek (Spec 11)
**Dosyalar:** `src/services/conflict-resolver.service.ts`, yeni `src/services/offline-queue.service.ts`

- [ ] **T4.44** Offline kuyruk: Ag yokken aksiyonlari AsyncStorage'da sakla
- [ ] **T4.45** Yeniden baglantiginda senkronizasyon: Kayitlar icin append, profil icin last-write-wins
- [ ] **T4.46** Ag durumu izleme: UI'da offline gostergesi
- [ ] **T4.47** Barkod offline cache: Onceden taranan urunler yerel calissin

### 4.16 Aylik ve Tum Zamanlar Raporu (Spec 8.3-8.4)
**Dosyalar:** `supabase/functions/ai-report/index.ts`

- [ ] **T4.48** Aylik rapor uretimi: 4 haftalik raporlarin birlestirilmesi, trend analizi
- [ ] **T4.49** Yeni `app/reports/monthly.tsx` ekrani
- [ ] **T4.50** Tum zamanlar raporu: Baslangictan bugune toplam ilerleme, en uzun streak, km taslari
- [ ] **T4.51** Yeni `app/reports/all-time.tsx` ekrani

### 4.17 Gizlilik / KVKK / GDPR (Spec 18)
**Dosyalar:** `src/services/privacy.service.ts`

- [ ] **T4.52** Veri export tamamla: Tum kullanici verisi JSON/CSV olarak
- [ ] **T4.53** Veri silme akisi: 30 gunluk yumusak silme (T1.8 ile baglanli)
- [ ] **T4.54** Katman 2 seffafligi: "Benim hakkimda ne biliyorsun?" ekrani, duzeltme/silme hakki
- [ ] **T4.55** Ogun fotograflari retention: Parse sonrasi 24 saat icinde sunucudan silme

### 4.18 i18n Altyapisi (Spec 20.2)
**Dosyalar:** `src/lib/i18n.ts`

- [ ] **T4.56** `i18n.ts` tamamla: Tum hard-coded Turkce stringleri cikart
- [ ] **T4.57** Ingilizce dil dosyasi hazirla
- [ ] **T4.58** Dil secimi ayari ekle

---

## ONERILEN UYGULAMA SIRASI (Sprint Bazli)

### Sprint 1: Faz 1 Kritik Yol (En Oncelikli)
1. T1.12 (gun siniri entegrasyonu - tum tarih mantigi etkiler)
2. T1.18-T1.19 (TDEE entegrasyonu - planlarin dogru hedefleri olmasi icin sart)
3. T1.30-T1.33 (dashboard iyilestirmeleri - gunluk deneyim)
4. T1.38-T1.40 (rapor ekranlari - geri bildirim dongusu)

### Sprint 2: Auth + Odeme
5. T1.1-T1.5 (sosyal auth + email dogrulama + sifre sifirlama)
6. T1.34-T1.37 (premium/odeme)
7. T1.9-T1.11 (rate limiting + prompt injection korumasi)

### Sprint 3: Chat Saglamlastirma + Hedefler
8. T1.21-T1.26 (chat saglamligi)
9. T1.41-T1.43 (hedef motoru)
10. T1.27-T1.29 (plan versiyonlama ve onaylama)

### Sprint 4: Faz 2 Kocluk Derinligi
11. T2.1-T2.3 (haftalik butce dashboard'da)
12. T2.19-T2.24 (bildirim sistemi)
13. T2.16-T2.18 (IF modu)
14. T2.12-T2.15 (barkod tarama)

### Sprint 5: Faz 2 AI Derinligi
15. T2.25-T2.40 (MVD, re-engagement, simulasyon, kurtarma testleri)
16. T2.41-T2.51 (adaptive difficulty, progressive disclosure, habits, feedback)

### Sprint 6+: Faz 3 ve Faz 4
Yukarida siralanan siralamayla devam et.

---

## DOGRULAMA VE TEST

Her sprint sonunda:
1. **Manuel test:** Ilgili ekrani ac, veri gir, sonucu dogrula
2. **AI chat testi:** Her yeni task mode'u sohbette tetikle, dogru yanit aldigini dogrula
3. **Edge function testi:** `supabase functions serve` ile local test, curl ile API cagirisi
4. **Veri butunlugu:** Supabase dashboard'dan tablolari kontrol et, RLS politikalarini dogrula
5. **Cross-device:** Farkli cihazlardan ayni hesaba giris, veri senkronizasyonu

---

## KRITIK DOSYALAR REFERANSI

| Dosya | Rol | Dokunulacak Sprint |
|-------|-----|-------------------|
| `supabase/functions/ai-chat/index.ts` (385 satir) | Ana AI sohbet fonksiyonu | 1, 3, 4, 5 |
| `supabase/functions/ai-plan/index.ts` (156 satir) | Plan uretimi | 1, 3 |
| `supabase/functions/ai-report/index.ts` (199 satir) | Rapor uretimi | 1, 4 |
| `supabase/functions/ai-proactive/index.ts` (105 satir) | Proaktif mesajlar | 4, 5 |
| `supabase/functions/shared/memory.ts` (349 satir) | 4 katmanli context | 3, 5 |
| `supabase/functions/shared/guardrails.ts` (178 satir) | Guvenlik filtreleri | 2 |
| `supabase/functions/shared/output-validator.ts` (136 satir) | AI cikti dogrulama | 3 |
| `src/stores/dashboard.store.ts` | Ana veri store | 1 |
| `src/stores/auth.store.ts` | Auth yonetimi | 2 |
| `src/lib/tdee.ts` (266 satir) | TDEE hesaplama | 1 |
| `src/lib/day-boundary.ts` | Gun siniri mantigi | 1 |
| `src/lib/weekly-budget.ts` | Haftalik butce | 4 |
| `app/(tabs)/index.tsx` | Dashboard ekrani | 1 |
| `app/(tabs)/chat.tsx` | Sohbet ekrani | 3, 4 |
| `src/services/notifications.service.ts` | Bildirim servisi | 4 |

---

**Toplam TODO sayisi: 158 madde**
- Faz 1: 43 madde (temel altyapi)
- Faz 2: 51 madde (kocluk derinligi)
- Faz 3: 49 madde (ileri ozellikler)
- Faz 4: 58 madde (genisleme ve polish) -- bazi maddeler opsiyonel/ileride
