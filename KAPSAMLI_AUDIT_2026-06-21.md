# KOCHKO Kapsamlı Audit — 2026-06-21

Bu rapor, KOCHKO fitness/koçluk uygulamasının dört boyutta (UI — Arayüz & Tasarım Sistemi, UX — Kullanıcı Deneyimi & Akışlar, DB — Veritabanı/RLS/Şema/Performans, AI — Yapay Zeka Mimarisi: edge/LLM/bellek/güvenlik) yürütülen kapsamlı denetiminin birleştirilmiş çıktısıdır. 36 bağımsız "finder" ajanı bulguları üretti, ardından her bulgu adversaryal (düşman) doğrulamadan geçirildi: gerçek olmayan/üretilemeyen iddialar elendi, abartılı şiddet seviyeleri düşürüldü ve yakın-kopya bulgular birleştirildi. Veritabanı katmanındaki çoğu HIGH/CRITICAL bulgu canlı PostgREST probe'larıyla (anon/authenticated JWT ile) doğrulandı; AI ve UX bulguları kod-yolu izleme ve canlı şema haritasıyla teyit edildi. Toplam **157 onaylı bulgu** (3 CRITICAL + 23 HIGH + 81 MEDIUM + 50 LOW) bu raporda dört tam bölüm halinde sunulmaktadır.

---

## Yönetici Özeti (Executive Summary)

### Şiddet Dağılımı (tüm boyutlar)

| Boyut | CRITICAL | HIGH | MEDIUM | LOW | Toplam (onaylı) | Elenen |
|-------|:--------:|:----:|:------:|:---:|:---------------:|:------:|
| **UI** — Arayüz | 0 | 2 | 19 | 20 | 41 | 2 |
| **UX** — Deneyim | 0 | 4 | 27 | 11 | 42 | 2 |
| **DB** — Veritabanı | 1 | 4 | 12 | 8 | 25 | 0 |
| **AI** — Yapay Zeka | 2 | 13 | 23 | 11 | 49 | 5 (birleştirme) |
| **TOPLAM** | **3** | **23** | **81** | **50** | **157** | — |

> Not: AI'daki 5 "elenen" gerçekte geçersiz değil, yakın-kopya birleştirme nedeniyle düşürülen ID'lerdir (0 bulgu invalid). UI'da 2 ve UX'te 2 bulgu adversaryal doğrulamada INVALID/üretilemez olarak elendi.

### Lansman Engelleyiciler — TÜM CRITICAL ve HIGH Bulgular (boyuta göre)

#### 🔴 CRITICAL (3)

**DB**
- `DB-FUN-01` — Atomik plan/hedef SECURITY DEFINER RPC'leri (set_active_goal, project_daily_plans, promote_weekly_plan) anon/authenticated tarafından çağrılabilir, p_user'a auth kontrolü olmadan güvenir → kimliksiz çapraz-kullanıcı veri imhası — `supabase/migrations/057_atomic_plan_goal_writes.sql:100-102`

**AI**
- `AI-GRD-01` — Kriz tespiti "kendimi asmak/asmayı" mastar/ulaç biçimini kaçırıyor — akut intihar sinyali sıradan koçluğa düşüyor — `supabase/functions/shared/guardrails.ts:399`
- `AI-EXT-01` — Sunucu payload kapağı (1MB) görüntü/ses limitleri (7.5MB) ve istemcinin 3.5MB gönderimiyle çelişiyor — foto & sesli öğün-kaydı 413 ile reddediliyor — `supabase/functions/shared/request-validator.ts:6-9,73-78`

#### 🟠 HIGH (23)

**UI (2)**
- `UI-CHT-01` — SDK 55 zorunlu edge-to-edge altında chat composer'ı klavye kapatabilir (behavior='height' Android) — `app/chat/[sessionId].tsx:996`
- `UI-LAY-01` — Hızlı kayıt ana ekranı: metin input + Kaydet butonu klavye arkasında kalabilir (KeyboardAvoidingView yok) — `app/log.tsx:566`

**UX (4)**
- `UX-ONB-01` — Login ekranındaki sosyal kayıt KVKK/Koşullar onayı gösterilmeden yeni hesap oluşturuyor — `app/(auth)/login.tsx:69-77`
- `UX-NAV-01` — Yeniden-onboarding girişi navigasyon tuzağı: geri butonu yok, swipe-back kapalı, tek çıkış hedef/profili yıkıcı biçimde yeniden yazıyor — `app/(tabs)/index.tsx:278 + app/_layout.tsx:94 + app/onboarding.tsx:246-322`
- `UX-FBK-01` — Dashboard öğün/antrenman uzun-basışı onay/haptik/geri-al olmadan anında siliyor (antrenman hard-delete) — `src/components/dashboard/ActivityTimeline.tsx:123-132`
- `UX-FBK-02` — Bildirim toggle'ları OS izni reddedildiğinde sessizce no-op (izin UX'i yok) — `app/settings/notifications.tsx:37-63`

**DB (4)**
- `DB-FUN-02` — start_trial_if_eligible sahiplik guard'ı anon için NULL-bypass ediliyor ve fonksiyon anon tarafından çağrılabilir (REVOKE FROM PUBLIC yok) → kimliksiz deneme verme / deneme-hakkı yakma — `supabase/migrations/053_trial_selfgrant_rpc.sql:33-34,59`
- `DB-PHC-01` — plan.service.getActive/getDraft weekly_plans.plan_subtype'ı yok sayar → diyet-plan ekranı uyumsuz haftalık-menü satırını yükleyebilir (sessiz plan bozulması) — `src/services/plan.service.ts:124-144`
- `DB-TRG-01` — advanceToNextPhase() son fazı geçince kullanıcıyı SIFIR aktif hedefle bırakır (tek-aktif-hedef invariantı istemci üzerinden, atomik olmayan şekilde kırılır) — `src/services/goals.service.ts:96-125`
- `DB-CON-01` — ai-proactive cron doğrulanmamış LLM-türevi priority'yi CHECK-kısıtlı coaching_messages.priority'ye yazar ve insert hatasını yok sayar → enum-dışı değer nudge'ı sessizce düşürür ama yine de commitment'ları followed-up işaretler ve hayalet push gönderir — `supabase/functions/ai-proactive/index.ts:1355-1384`

**AI (13)**
- `AI-ORC-01 / AI-EXT-04 / AI-INT-03` — meal_log_items makroları NaN/üst-sınır korumasız: tek bozuk değer TÜM kalemleri sessizce düşürür, sıfır-makrolu öğünü "kaydedildi" diye gösterir (validateMealParse import edilip hiç çağrılmıyor) — `supabase/functions/ai-chat/index.ts:2810-2849`
- `AI-ORC-02` — Workout-planı onay yolu taslağı sakatlık çakışması için yeniden-taramıyor (alerjen yolu tarıyor); taslak sonrası bildirilen sakatlık aktivasyonda atlanıyor — `supabase/functions/ai-chat/index.ts:1207-1296`
- `AI-ORC-03` — meal_log alerjen uyarısı checkAllergens yerine naif substring kullanıyor; kategori alerjeni ("deniz ürünleri") için üye gıda ("somon") kaydında uyarı üretmiyor — `supabase/functions/ai-chat/index.ts:2710-2728`
- `AI-SYS-01` — Recovery modu recovery_plan action'ını hiç emit etmiyor — ertesi-gün kalori dengeleme (daily_plans yeniden-yazımı) sessizce ölü kod — `supabase/functions/ai-chat/task-modes.ts:236-255`
- `AI-MEM-01` — Layer-2 token bütçesi (LAYER2_PCT / max_token_budget) hiç uygulanmıyor — sınırsız ai_summary büyümesi prompta sızıp Layer 3/4'ü dışlıyor — `supabase/functions/shared/memory.ts:19,123-212,386-409`
- `AI-MEM-02 / AI-INT-05` — Öğrenilen öğün saatleri / atıştırma saatleri / geç-öğün-uyku UTC saatinden hesaplanıyor; tüketiciler kullanıcı-yerel saat kullanıyor (UTC offset kadar kaymış) — `supabase/functions/shared/memory.ts:588,691`
- `AI-CTX-02` — Layer-1 "## ZAMAN" bloğu kullanıcı-yerel yerine UTC zaman/gün/tarih basıyor — AI yanlış saat ve yanlış "bugün" üzerinden akıl yürütüyor — `supabase/functions/shared/context-builders.ts:77-87,256-262`
- `AI-PLN-01` — weekly_budget_consumed / weekly_budget_total SMALLINT taşıyor — chat→daily_plans projeksiyonu (ağır-yeme/bulk haftalarda) sessizce kırılıyor, dashboard boşalıyor — `supabase/functions/shared/plan-projection.ts:315-336`
- `AI-EXT-02` — Extractor, model literal JSON null döndürdüğünde Object.entries(null) ile tüm cron batch'ini çökertiyor — sonraki tüm kullanıcılar atlanıyor — `supabase/functions/ai-extractor/index.ts:190-202`
- `AI-MDL-04` — ai-plan günlük üretimi rate-limit VE free-tier kapısı olmadan çalışıyor — free kullanıcılar için sınırsız gpt-4o maliyet açığı — `supabase/functions/ai-plan/index.ts:92-126,482-487`
- `AI-INT-01` — AI action yazımları istemci retry'da yeniden çalışıyor (idempotency yok) — su/supplement/workout/commitment mükerrer, recovery-plan kalori kesintisi çift uygulanıyor — `supabase/functions/ai-chat/index.ts:3036-3535; src/services/chat.service.ts:178-200`
- `AI-INT-02` — ai-proactive hedef faz-ilerletme hedefleri iki ayrı statement'ta deaktive+aktive ediyor (transaction yok) — kullanıcı SIFIR aktif hedefle kalabilir — `supabase/functions/ai-proactive/index.ts:910-913`
- `AI-PRO-04` — Cron-korumalı fleet fonksiyonları (ai-proactive, cleanup-scheduled) FAIL-OPEN: CRON_SECRET set değilken herkes fleet-çapında LLM/push çalıştırabilir — `supabase/functions/shared/cron-auth.ts:14-23`

---

## En Kritik 10 Bulgu

1. **`DB-FUN-01` [CRITICAL] — Kimliksiz çapraz-kullanıcı veri imhası.** `set_active_goal`, `project_daily_plans` ve `promote_weekly_plan` SECURITY DEFINER RPC'leri `REVOKE ... FROM PUBLIC` taşımadığından anon dahil herkes tarafından PostgREST üzerinden çağrılabilir ve `p_user`'ı `auth.uid()` ile doğrulamaz. Saldırgan kurban UUID'siyle başka kullanıcının günlük planlarını silebilir, aktif hedefini devre dışı bırakabilir ve aktif planını arşivleyebilir. **Düzeltme:** üç fonksiyon için de `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;` ekleyin ve her gövdeye `IF p_user <> auth.uid() AND auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'` çağıran-doğrulaması koyun.

2. **`AI-GRD-01` [CRITICAL] — Akut intihar sinyali kaçıyor.** Kriz regex'i asma fiilinin yalnızca zaman çekimlerini (asacağım, astım) yakalar; çok yaygın "kendimi asmak istiyorum" / "kendimi asmayı düşünüyorum" mastar/ulaç biçimleri ne literal listeye ne regex'e uyar, mesaj normal fitness koçluğuna düşer. **Düzeltme:** asma/kesme gruplarına `mak/may` ve `mek/mey` eklerini ekleyin (kıy(mak) ile simetrik), kendine-hedef + herhangi bir yöntem kökünü her çekimde eşleyen geniş bir ideation pattern'i ekleyin.

3. **`AI-EXT-01` [CRITICAL] — Foto/sesli öğün-kaydı ödeme arkasında kırık.** 1MB sunucu payload kapağı, 7.5MB alan-limitleri ve istemcinin 3.5MB gönderimiyle çelişiyor; ~1MB üstü her gerçek telefon fotoğrafı HTTP 413 ile reddediliyor. Premium foto-kalori analizi pratikte çalışmıyor. **Düzeltme:** `MAX_PAYLOAD_BYTES`'i en büyük alan limitiyle (~8MB) hizalayın veya 1MB content-length kapağını kaldırıp alan-bazlı base64 limitlerine güvenin.

4. **`AI-ORC-01/EXT-04/INT-03` [HIGH] — meal_log sessiz veri kaybı + sahte başarı.** Kalem makroları `Number()` coercion ve NaN koruması olmadan insert ediliyor; modelin atladığı tek bir makro NaN→null üretip TÜM kalem batch'ini (yalnız bozuk kalemi değil) düşürüyor, ama kullanıcı "Öğün kaydedildi" çipini görüyor. `validateMealParse` import edilmiş ama hiç çağrılmıyor. **Düzeltme:** her sayısal alanı insert öncesi `Number.isFinite` ile sanitize/clamp edin, `validateMealParse`'ı gerçekten çağırın ve başarı çipini `!itemsErr` koşuluna bağlayın.

5. **`DB-TRG-01` / `AI-INT-02` [HIGH] — Tek-aktif-hedef invariantı atomik olmayan yazımlarla kırılıyor.** Hem `advanceToNextPhase()` (istemci) hem ai-proactive faz-ilerletme, hedefi iki ayrı transaction-dışı UPDATE ile deaktive+aktive ediyor. Son fazı geçmek veya kısmi başarısızlık kullanıcıyı SIFIR aktif hedefle bırakıyor; dashboard, koç bağlamı ve TDEE hedeflemesi null hedefle sessizce bozuluyor. **Düzeltme:** takası tek bir SECURITY DEFINER RPC içinde atomik yapın; geçerli ardıl onaylanmadan mevcut hedefi asla devre dışı bırakmayın.

6. **`AI-INT-01` [HIGH] — Idempotency yok; istemci retry'da çift yazım.** İstemci 60s timeout'ta aynı body'yi yeniden gönderiyor; sunucu request-dedup yapmadığından su/supplement/workout/commitment mükerrer yazılıyor, recovery-plan kalori kesintisi gelecek günlerde çift uygulanıyor. **Düzeltme:** body'ye istemci-üretimi idempotency anahtarı ekleyip executeActions öncesi kontrol edin veya her idempotent-olmayan action'a yakın-mükerrer guard'ı (meal_log'un 10-dk penceresini yansıtarak) koyun.

7. **`AI-CTX-02` / `AI-MEM-02` [HIGH] — Yaygın UTC/timezone hatası tüm Türkiye tabanını vuruyor.** Layer-1 "## ZAMAN" bloğu UTC saat/gün/tarih basıyor ve öğrenilen öğün/atıştırma saatleri UTC'den hesaplanıyor; UTC+3 kullanıcı için 07:00 kahvaltı 04:00 olarak öğreniliyor, plan "04:00'te kahvaltı" diyor ve AI yanlış "bugün" üzerinden akıl yürütüyor. **Düzeltme:** çözülmüş timezone'u (client → active → home) tüm zaman türetimlerine geçirin; `service-contexts.ts:595`'teki mevcut `toLocaleString({ timeZone })` düzeltmesini memory.ts ve context-builders.ts'e yansıtın.

8. **`AI-PLN-01` [HIGH] — SMALLINT taşması dashboard'ı boşaltıyor.** `weekly_budget_total/consumed` SMALLINT (max 32767) ve chat→daily_plans projeksiyonu haftalık kalori toplamını clamp'lemiyor; ağır-yeme veya bulk haftası 32767'yi aşınca atomik projeksiyon 22003 ile sessizce başarısız oluyor, dashboard o kullanıcıya boş plan gösteriyor. **Düzeltme:** üç bütçe alanını RPC öncesi SMALLINT aralığına clamp'leyin veya kolonları (ve jsonb_to_recordset tiplerini) INTEGER'a genişletin.

9. **`UX-ONB-01` [HIGH] — KVKK boşluğu: sosyal kayıt onaysız hesap açıyor.** Login ekranındaki Google/Apple butonları, register.tsx'in tüm kayıt yollarının üstünde gösterdiği KVKK/Koşullar onayını göstermeden yeni hesap (ve 7 günlük deneme) oluşturuyor. **Düzeltme:** login.tsx'te sosyal-giriş butonlarının üstüne register.tsx ile aynı onay satırını ekleyin veya ilk-defa OAuth kullanıcılarını profil oluşturmadan önce açık onay kapısından geçirin.

10. **`AI-PRO-04` / `DB-FUN-02` [HIGH] — Fail-open / kimliksiz erişim açıkları.** Cron-korumalı fleet fonksiyonları (ai-proactive, cleanup-scheduled) CRON_SECRET set değilken fail-open çalışıyor; URL'i bilen herkes fleet-çapında LLM/push tetikleyebiliyor. Paralel olarak `start_trial_if_eligible` anon için NULL-guard-bypass ediliyor ve REVOKE FROM PUBLIC taşımıyor — kimliksiz saldırgan keyfi kullanıcının deneme hakkını yakabiliyor. **Düzeltme:** fleet endpoint'lerini fail-closed yapın (CRON_SECRET zorunlu deploy gereksinimi); trial RPC'sini `REVOKE ... FROM PUBLIC, anon` + `IF auth.uid() IS NULL OR uid <> auth.uid()` guard'ıyla sertleştirin.

---

# Bölümler

Aşağıda dört boyutun tam bölümleri (her bulgunun sorun/etki/kanıt/öneri detayıyla) yer almaktadır.

---


## UI — Arayüz (Görsel & Tasarım Sistemi)

### Özet

| Şiddet | Adet |
|--------|------|
| CRITICAL | 0 |
| HIGH | 2 |
| MEDIUM | 19 |
| LOW | 20 |
| **Toplam (onaylı)** | **41** |
| Elenen (INVALID/gerçek değil) | 2 |

**Tema:** Bu boyutun bulguları üç ana eksende toplanıyor: (1) **Klavye-kaçınma (KeyboardAvoidingView) eksikliği** — birden çok metin-giriş yüzeyinde (chat composer, hızlı kayıt, tartı, çok-fazlı hedef) input ve kaydet butonu klavyenin arkasında kalabiliyor (3 HIGH dahil ana risk); (2) **Yükleme/boş/hata durumu disiplini** — birçok liste ve dashboard yüzeyi `loading` durumu tutmadığından, veri gelmeden önce yanıltıcı "boş/plan yok" flaşı gösteriyor; (3) **Tasarım sistemi tutarsızlığı** — sabit `#fff` üstüne teal kontrast (WCAG AA), tema-bypass eden primitifler, off-grid token'lar, yuvarlanmamış sayı gösterimi ve çoğaltılmış başlık/toggle markup. Hiçbir CRITICAL yok; en yüksek risk Android edge-to-edge altındaki chat klavye davranışı.

---

### [HIGH] UI-CHT-01 — SDK 55 zorunlu edge-to-edge altında chat composer'ı klavye kapatabilir (behavior='height' Android)

**Dosya:** `app/chat/[sessionId].tsx:994-1001` (behavior satırı 996)

**Sorun:** Chat ekranı her şeyi `KeyboardAvoidingView` içine sarıyor ve `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` kullanıyor. Expo SDK 55'te (expo ~55.0.26, react-native 0.83.6) edge-to-edge varsayılan ve devre dışı bırakılamıyor; `react-native-edge-to-edge` paketi, `expo-build-properties` ve `android.softwareKeyboardLayoutMode` ayarı yok. Edge-to-edge altında pencere IME için `behavior='height'`'in varsaydığı gibi yeniden boyutlanmıyor, dolayısıyla composer klavyenin üstüne güvenilir biçimde yükselmiyor. `app/_layout.tsx`'te telafi edecek bir `KeyboardProvider` (react-native-keyboard-controller) de yok.

**Etki:** Android'de (hafızaya göre kullanıcının birincil build hedefi) chat'te klavye açıldığında input bar ve gönder butonu klavyenin arkasında kısmen/tamamen gizlenebiliyor. Bu, uygulamanın en çok kullanılan giriş yüzeyinde temel sohbet akışını bozma riski taşıyor. (Not: doğrulama güveni "medium" — bazı Android OEM/klavye kombinasyonlarında pencere yine de yeniden boyutlanabilir; kesin başarısızlık modu fiziksel/emülatör Android'de klavye-açık testiyle doğrulanmalı.)

**Kanıt:**
```jsx
behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
// package.json: expo ~55.0.26, react-native 0.83.6,
//   react-native-edge-to-edge: undefined, react-native-keyboard-controller: undefined
// app.config.js android: { ... } — softwareKeyboardLayoutMode / edgeToEdge yok
// app/_layout.tsx — KeyboardProvider yok
```

**Öneri:** `react-native-keyboard-controller` benimseyin (uygulamayı `<KeyboardProvider>` ile sarın, onun `KeyboardAvoidingView`/`KeyboardStickyView`'ını kullanın) — edge-to-edge altında desteklenen kalıp budur. Asgari olarak `expo-build-properties` ekleyin veya `android.softwareKeyboardLayoutMode` ayarlayın ve `behavior='padding'`'in Android'de input bar'a uygulanan safe-area inset'leriyle çalıştığını doğrulayın. Fiziksel/emülatör Android cihazda klavye-açık test edin.

---

### [HIGH] UI-LAY-01 — Hızlı kayıt ana ekranı: metin input + Kaydet butonu klavye arkasında kalabilir (KeyboardAvoidingView yok)

**Dosya:** `app/log.tsx:566, 629-646`

**Sorun:** Quick Log modalının ANA ekranı düz bir `<ScrollView>` ve hiçbir `<KeyboardAvoidingView>` sarmalayıcısı yok. "Hızlı kayıt" çok-satırlı `<TextInput>` (satır 630) ve "Kaydet" butonu (satır 637) içeriğin alt-ortasında, 4 satırlık input-metot kartının altında yer alıyor. Bu ekran `app/_layout.tsx:95`'te `presentation:'modal'` olarak sunuluyor — iOS'ta modal sayfası hem yüksekliği daraltır hem de klavyeden otomatik kaçınmaz, dolayısıyla alan ve Kaydet butonu örtülür. `keyboardShouldPersistTaps='handled'` (satır 566) yalnızca tap yayılımını etkiler, layout offset'ini değil. Diğer giriş yüzeyleri (login, onboarding, lab-values, edit-profile vb.) doğru biçimde KeyboardAvoidingView ile sarılı, bu da bu akışı tutarsız aykırı kılıyor.

**Etki:** iOS'ta (ve küçük Android cihazlarda) hızlı-kayıt giriş noktasının inline metin alanı yazılırken ve Kaydet butonu klavyeyle örtülür; kullanıcı klavyeyi manuel kapatmadan kaydedemez. Not: birincil "Yazarak gir" yolu ilk kart satırından (satır 585) chat sekmesine yönlendirir; örtülen alan ikincil bir kestirme giriştir — yine de iOS modalda Kaydet butonunun gizlenmesi HIGH etkidir.

**Kanıt:**
```jsx
// Satır 566:
<ScrollView style={{ flex: 1, ... }} contentContainerStyle={{ padding: SPACING.xl, paddingTop: insets.top + 12, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
// Satır 630-635:
<TextInput style={{ ... minHeight: 50, textAlignVertical: 'top' }} placeholder="Örnek: 2 dilim ekmek, 1 yumurta, çay" value={text} onChangeText={setText} multiline maxLength={2000} />
{text.trim() ? (<TouchableOpacity onPress={handleLog} ...>  // Kaydet, input altında
// dosyanın hiçbir yerinde KeyboardAvoidingView yok
```

**Öneri:** Ana ScrollView'ı (satır 565) `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>` ile sarın (`app/(auth)/login.tsx:53/127`'i örnek alın). Alternatif olarak hızlı-metin kartını input-metot kartının üstüne taşıyın veya focus'ta `scrollTo` çağırın.

---

> Not: UI-STA-01 ve UI-STA-02 finder tarafından HIGH önerildi ancak düşman-doğrulama şiddeti MEDIUM'a indirdi (geçici/ilk-mount flaşı, kendiliğinden çözülüyor). Bu iki kalem aşağıda MEDIUM bölümünde yer alıyor.

---

### [MEDIUM] UI-DS-01 — Teal/uyarı dolgusu üstünde sabit beyaz metin 3 ekranda hâlâ WCAG AA'da kalıyor

**Dosya:** `app/reports/calendar.tsx:94`, `app/settings/health-events.tsx:65`, `app/settings/progress-photos.tsx:146`

**Sorun:** Tasarım sisteminin kendi kuralı (Button.tsx ve düzeltilmiş periodic-state.tsx, notifications.tsx, ErrorBoundary.tsx) seçili-chip ön planını `getContrastColor(fill) === 'black' ? '#0D0D12' : '#fff'` ile seçer. Üç ekran bu göçü hiç yapmadı ve `COLORS.primary` (teal #1D9E75) dolgusu üzerine ham `'#fff'`'i etiket rengi olarak sabit tutuyor. `getContrastColor('#1D9E75')` 'black' döndürür — yani beyaz YANLIŞ tercih. Repo genelinde `? '#fff' :` araması TAM olarak bu üç dosyayı döndürür (yarım kalmış göç doğrulandı).

**Etki:** Seçili takvim günü, seçili sağlık-olay tipi chip'i ve seçili ilerleme-foto pozu beyaz-üstüne-teal'de 3.39:1 ile render olur, WCAG AA'da kalır (eşik 4.5:1; koyu ön plan 5.72:1 verir). Bunlar yaygın etkileşimler. Metin tamamen okunamaz değil (3.39:1) ve fonksiyonel/veri etkisi yok — bu nedenle şiddet MEDIUM.

**Kanıt:**
```jsx
// calendar.tsx:94  (isSelected bg = COLORS.primary, satır 90)
<Text style={{ color: isSelected ? '#fff' : day.hasData ? COLORS.text : COLORS.textMuted, ... }}>{dayNum}</Text>
// health-events.tsx:65  (seçili bg = COLORS.primary, satır 64)
<Text style={{ color: type === t ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>
// progress-photos.tsx:146  (seçili bg = COLORS.primary, satır 143)
<Text style={{ color: selectedPose === pose ? '#fff' : COLORS.textSecondary, ... }}>
// Hesap: beyaz on #1D9E75 = 3.39:1 (AA FAIL); #0D0D12 on #1D9E75 = 5.72:1 (PASS)
```

**Öneri:** Bu üç seçili-durum Text renginde ham `'#fff'`'i yerleşik `getContrastColor(COLORS.primary) === 'black' ? '#0D0D12' : '#fff'` kalıbıyla (veya paylaşılan chip primitifiyle) değiştirin. Repo'da primary/warning/error dolgusu üstündeki `? '#fff'` kalanlarını taramak için grep edin.

---

### [MEDIUM] UI-DS-02 — StreakBadge primitifi temayı tamamen baypaslıyor: teal hex + beyaz metin (3.39:1) + magic fontSize

**Dosya:** `src/components/tracking/StreakBadge.tsx:24, 26-27`

**Sorun:** StreakBadge paylaşılan bir UI primitifi ama `useTheme`/colors hiç import etmiyor. `backgroundColor: '#1D9E75'` (DARK_COLORS.primary'nin sessizce sürüklenecek bir kopyası) ve hem alev ikonu hem de `'{days} gün'` etiketi için `color: '#fff'` sabitliyor. Beyaz on #1D9E75 = 3.39:1 (AA FAIL, UI-DS-01 ile aynı kök neden). Ayrıca FONT ölçeğinde olmayan magic `fontSize: 12` kullanıyor (FONT.xs=11, FONT.sm=13).

**Etki:** Streak rozeti metni canlı tasarımda düşük kontrast (3.39:1), rozet rengi tema token'ından kopuk (marka rengi değişince yayılmaz) ve font boyutu tip ölçeğinin dışında. Yeniden kullanılabilir primitif olarak bu kusurları her streak render eden ekran miras alır (rozet `days < 2` iken hiç render etmediğinden etki bununla sınırlı).

**Kanıt:**
```jsx
24: backgroundColor: '#1D9E75',
26: <Ionicons name="flame" size={14} color="#fff" />
27: <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{days} gün</Text>
// dosyada useTheme import yok; beyaz on #1D9E75 = 3.39:1 AA FAIL
```

**Öneri:** `useTheme()` import edin; dolgu için `colors.primary`, ikon+metin için `getContrastColor(colors.primary)` kullanın; `fontSize: 12`'yi `FONT.xs` (veya bir ölçek token'ı) ile değiştirin.

---

### [MEDIUM] UI-DS-03 — Toggle anahtarı tek primitif yerine 4 yerde elle yazılmış; ToggleRow useTheme() değil statik COLORS kullanıyor

**Dosya:** `src/components/settings/ToggleRow.tsx:27-36`, `app/settings/notifications.tsx:76-78 ve 121-123`, `app/settings/if-settings.tsx:~108`

**Sorun:** Aynı iOS-stili toggle (dış 48x28 r14 track + iç 24x24 r12 knob, alignSelf flex-end/flex-start) notifications.tsx'te (iki kez), if-settings.tsx'te ve ToggleRow primitifinde ham inline markup olarak çoğaltılmış — hepsi tek bir paylaşılan `<Toggle/>` tüketeceğine. notifications.tsx:120'deki yorum bile "standardize switch to 48x28 (matches ... ToggleRow primitive)" diyerek çoğaltmayı kabul ediyor. Ayrıca kanonik ToggleRow primitifi `useTheme()` yerine statik COLORS fallback'ini (koyu snapshot) import ettiğinden tema değişimine tepki veremez; Card/Button/Input ise hepsi `useTheme()` tüketir.

**Etki:** Aynı toggle geometrisinin dört kopyası elle senkronda tutulmalı (yorum bir kez sürüklendiğini gösteriyor). ToggleRow'un statik COLORS'a sabitlenmesi onu src/components/ui/* geri kalanından farklı, tema-bilmeyen bir primitif yapıyor. (Not: if-settings.tsx artık knob için `'#fff'` yerine `getContrastColor(COLORS.primary)` kullanıyor — kısmen göç etti; geometri yine inline.)

**Kanıt:**
```jsx
// ToggleRow.tsx:5
import { COLORS, SPACING, FONT } from '@/lib/constants';  // useTheme yok
// ToggleRow.tsx:32-35
<View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: value ? 'flex-end' : 'flex-start' }} />
// notifications.tsx:77 & 122: özdeş inline knob
// notifications.tsx:120 yorum: 'standardize switch to 48x28 (matches main toggle / ToggleRow primitive)'
```

**Öneri:** Tek bir `<Toggle value onToggle/>` primitifi çıkarın (useTheme ile temalı, a11ySwitch dahili) ve notifications.tsx/if-settings.tsx'teki inline kopyalarla ToggleRow gövdesini bununla değiştirin. ToggleRow'u useTheme()'e çevirin.

---

### [MEDIUM] UI-PR-01 — ToggleRow etiketsiz genel buton olarak duyuruluyor — açık/kapalı durum ekran okuyucuya görünmez

**Dosya:** `src/components/settings/ToggleRow.tsx:14-37`

**Sorun:** ToggleRow tüm satırı `<TouchableOpacity>` olarak render ediyor; `accessibilityRole`, `accessibilityState` ve `accessibilityLabel` YOK. Açık/kapalı görünüm yalnızca el-çizimi bir `<View>` knob/track ile (satır 27-36) iletiliyor, hiçbir erişilebilirlik açıklaması yok. TalkBack/VoiceOver kullanıcısı bu kontrole geldiğinde yalnızca görünür etiket metnini duyar, genel bir touchable olarak duyurulur ('switch' rolü yok) ve toggle'ın ON mu OFF mu olduğu konusunda HİÇBİR bilgi verilmez. Proje tam yardımcıyı içeriyor — `a11ySwitch(label, isOn)` (src/lib/accessibility.ts:134) `{ accessibilityRole:'switch', accessibilityState:{ checked }, ... }` döndürür — ve diğer inline toggle'lar (notifications.tsx, coach-sharing.tsx) zaten yayıyor; paylaşılan ToggleRow primitifi hiç benimsemedi. ToggleRow, app/settings/menstrual.tsx:74'teki döngü-takip anahtarında canlı.

**Etki:** Görme engelli/az gören kullanıcılar döngü-takip (ve gelecekteki her ToggleRow tüketicisi) etkin mi devre dışı mı söyleyemez; kontrol switch yerine buton olarak yanlış duyurulur. Üretimde canlı bir erişilebilirlik hatası ve mağaza erişilebilirlik-incelemesi riski.

**Kanıt:**
```jsx
<TouchableOpacity onPress={() => onToggle(!value)} style={{ flexDirection: 'row', ... }}>
  <View style={{ flex: 1, marginRight: SPACING.md }}>
    <Text ...>{label}</Text>
// ^ accessibilityRole="switch" yok, accessibilityState={{checked:value}} yok, accessibilityLabel yok
// kullanılmayan yardımcı: src/lib/accessibility.ts:134 a11ySwitch(label,isOn)
```

**Öneri:** TouchableOpacity'ye `a11ySwitch(label, value)`'ı yayın (`@/lib/accessibility`'den import). Dekoratif track/knob View'larını `importantForAccessibility="no-hide-descendants"` ile işaretleyin. Bonus: async kaydetme sırasında kilitlemek için opsiyonel `disabled?: boolean` prop ekleyin.

---

### [MEDIUM] UI-TAB-03 → değerlendirme sonrası LOW'a düşürüldü — bkz. LOW bölümü (UI-TAB-03)

> Not: Finder MEDIUM önerdi; sütun tipleri (DECIMAL(5,2)/(3,1)) en kötü durumu '73.46 kg'/'6.8 sa' ile sınırladığından şiddet LOW'a indirildi. Detay LOW bölümünde.

---

### [MEDIUM] UI-SET-01 — settings/index gövdede native başlığı çoğaltan bir "Ayarlar" H1 render ediyor

**Dosya:** `app/settings/index.tsx:85`

**Sorun:** Settings index ekranı `app/settings/_layout.tsx:15`'te `title: 'Ayarlar'` ile kayıtlı ve hiçbir yerde `headerShown:false` ayarlamadığından native Stack başlığı "Ayarlar"ı render eder. Üstüne ekran gövdesi satır 85'te yine büyük bir inline "Ayarlar" H1 render ediyor. Kullanıcı "Ayarlar"ı iki kez, üst üste görür. Bu, diğer ~24 settings ekranının (goals, edit-profile, theme, household, menstrual, notifications, premium vb.) `FIX (audit duplicate-title)` yorumuyla bilinçli olarak kaldırdığı kalıp; index.tsx tek istisna.

**Etki:** En çok ziyaret edilen settings ekranında görünür çoğaltılmış başlık; ~24 kardeş ekrana uygulanan başlık kuralını bozuyor, üst-katlama alanında dikey alan israf ediyor ve cilasız görünüyor. Tamamen kozmetik, fonksiyonel etki yok.

**Kanıt:**
```jsx
// app/settings/index.tsx:85
<Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: colors.text, marginBottom: SPACING.lg }}>Ayarlar</Text>
// app/settings/_layout.tsx:15
<Stack.Screen name="index" options={{ title: 'Ayarlar' }} />  // headerShown:false yok → native başlık da gösteriliyor
```

**Öneri:** Satır 85'teki inline başlık `<Text ...>Ayarlar</Text>`'ı kaldırın; native başlık ekran başlığının tek kaynağı olsun, diğer her settings ekranıyla eşleşsin.

---

### [MEDIUM] UI-SET-02 — coach-memory için tek ekranda ÜÇ çelişen başlık (çoğaltma + ölü layout başlığı) + tutarsız Kochko/Koçko marka yazımı

**Dosya:** `app/settings/coach-memory.tsx:263, 271`

**Sorun:** Coach-memory başlığını üç yerde, hiçbiri uyuşmadan tanımlıyor. (1) Ekran native başlığı satır 263'te `title: "Kochko'nun Senin Hakkında Bildikleri"` ile geçersiz kılıyor. (2) Gövde satır 271'de FARKLI metinle `"Koçko Senin Hakkında Ne Biliyor"` prominent ikon+H1 satırı render ediyor (çoğaltılmış inline başlık). (3) `_layout.tsx:23` rota başlığını `"Koçko Senin Hakkında Ne Biliyor"` olarak ilan eder ve yorumu (satır 20-23) üç ismin "birleştirildiğini" iddia eder; ancak satır-263'teki in-screen `<Stack.Screen>` override çalışma zamanında sessizce kazanır, dolayısıyla layout başlığı hiç render olmaz ve "birleştirme" bozuktur. Üstelik aynı ekran için marka adı iki farklı yazılmış: header'da "Kochko" vs gövde H1 ve _layout.tsx'te "Koçko" (ç ile).

**Etki:** KVKK/gizlilik-kritik bir ekranda kendiyle çelişen header vs gövde başlığı; belgelenmiş "birleşik başlık" aslında bozuk. Kochko vs Koçko ayrımı tek görünümde iki yazımı gösterip marka adını yazım hatası gibi gösteriyor.

**Kanıt:**
```jsx
// coach-memory.tsx:263
<Stack.Screen options={{ title: 'Kochko\'nun Senin Hakkında Bildikleri', ... }} />
// coach-memory.tsx:271
<Text style={{ fontSize: FONT.lg, fontWeight: '800', color: colors.text }}>Koçko Senin Hakkında Ne Biliyor</Text>
// _layout.tsx:23 (override edilmiş, ölü)
<Stack.Screen name="coach-memory" options={{ title: 'Koçko Senin Hakkında Ne Biliyor' }} />
```

**Öneri:** TEK başlık string'i ve TEK marka yazımı seçin (uygulama ağırlıkla "Kochko" kullanıyor). Native header'ı tutup gövde H1'ini (satır 271) silin VEYA gövde H1'ini tutup gereksiz per-ekran header override'ını (satır 263) kaldırın, ve _layout.tsx:23'ü eşleyin. Üç string uyuşmalı.

---

### [MEDIUM] UI-CHT-02 — WeeklyBudgetBar bütçesiz kullanıcıda anlamsız 'X / 0 kcal' ve negatif 'Kalan' render ediyor

**Dosya:** `app/chat/[sessionId].tsx:1767-1771`

**Sorun:** Her meal_log aksiyonundan sonra bubble `<WeeklyBudgetBar consumed={totalCalories} total={weeklyBudgetRemaining != null ? totalCalories + weeklyBudgetRemaining : 0} />` render ediyor. `dashboard.store.ts:82` `weeklyBudgetRemaining`'i `null` başlatır ve yalnızca `planRes.data?.weekly_budget_remaining ?? null` (satır 173) ile set eder. Haftalık bütçe taşımayan planı olmayan kullanıcılar (yeni kullanıcılar dahil) için `null` kalır, `total` olarak 0 geçilir. WeeklyBudgetBar (RichMessage.tsx:282-298) header'ı `'{consumed} / 0 kcal'` render eder, `remaining = 0 - consumed` hesaplar ve `'Kalan: -{totalCalories} kcal'` (negatif bütçe) gösterir.

**Etki:** Bütçesiz bir kullanıcının chat üzerinden kaydettiği her öğün bozuk, alarm verici bir bütçe kartı gösterir ('1850 / 0 kcal', 'Kalan: -1850 kcal'). Koçun yanıtında satır-içi, kendinden emin sunulan yanlış veri; öğün kaydı (uygulamanın temel aksiyonu) çok yaygın bir yol.

**Kanıt:**
```jsx
{!isUser && message.actions?.some(a => a.type === 'meal_log' && a.feedback) && (
  <WeeklyBudgetBar consumed={totalCalories} total={weeklyBudgetRemaining != null ? totalCalories + weeklyBudgetRemaining : 0} />
)}
// RichMessage.tsx: const remaining = total - consumed; ... Kalan: {remaining} kcal  (total=0 iken negatif)
// dashboard.store.ts:82  weeklyBudgetRemaining: null,
```

**Öneri:** WeeklyBudgetBar'ı yalnızca `weeklyBudgetRemaining != null` (ve `total > 0`) iken render edin. Haftalık bütçe yoksa kartı tamamen atlayın veya WeeklyBudgetBar'ı dahili olarak `total <= 0` iken hiçbir şey ('bütçe ayarlanmadı') render edecek şekilde koruyun.

---

### [MEDIUM] UI-CHT-05 — Gönderilen fotoğraflar chat'te geri gösterilmiyor — kullanıcı bubble'ı yalnızca '[Foto gönderildi]' metni gösteriyor

**Dosya:** `app/chat/[sessionId].tsx:615-624, 1596-1615`

**Sorun:** Bir fotoğraf gönderildiğinde optimistik kullanıcı mesajı içeriği düz bir string'e (`'[Foto] ' + text` veya `'[Foto gönderildi]'`) ayarlanıyor ve UIMessage hiçbir image-URI alanı taşımıyor. MessageBubble yalnızca `message.content`'i Text olarak render ediyor (satır 1596-1615); kullanıcı mesajları için `<Image>` dalı yok. Foto-merkezli bir öğün-kayıt uygulamasında, kullanıcının az önce çektiği yemek fotoğrafı bubble'da literal placeholder metni '[Foto gönderildi]' ile değiştiriliyor ve görüntü konuşmada hiç gösterilmiyor. Yerel foto URI'si gönderim anında `photo` olarak zaten mevcut (önizleme thumbnail'i için satır 1158'de kullanılıyor) ama atılıyor.

**Etki:** Kullanıcılar gönderdikleri fotoğrafı göremez (doğru resmin gidip gitmediğini doğrulamak veya bir öğünün neye benzediğini hatırlamak için geri kaydırmak). "Yemeğini çek" temel akışı olan bir uygulama için fotoğrafın transkriptten kaybolması anlamlı bir UX boşluğu.

**Kanıt:**
```jsx
const userMsg: UIMessage = { id: userMsgId, role: 'user', content: photo ? (text ? `[Foto] ${text}` : '[Foto gönderildi]') : text, created_at: ... };
// MessageBubble yalnızca: {splitBoldSegments(sanitizeAssistantText(message.content)).map(...)} — isUser için Image yok
```

**Öneri:** Optimistik UIMessage'a yerel foto URI'sini taşıyın ve kullanıcı bubble'ı içinde bir `<Image>` thumbnail render edin (URI gönderim anında zaten elde). Kalıcı foto mesajları placeholder metnini veya saklandıysa uzak URL'i gösterebilir.

---

### [MEDIUM] UI-PLN-01 — PhaseTimeline etiketleri dar fazlarda taşıyor/kırpılıyor (numberOfLines/overflow yok)

**Dosya:** `src/components/plan/PhaseTimeline.tsx:62-116`

**Sorun:** Timeline bar segment genişliği `widthPct = (phase.targetWeeks / totalWeeks) * 100` ile saf yüzde olarak hesaplanıyor. Bar altındaki faz-etiketi metninin (satır 100-116) `numberOfLines`/`ellipsizeMode` yok ve etiket hücresi View'ında (satır 105) `overflow:'hidden'` yok (bar konteynerı satır 66'da kırpıyor, etiket satırı kırpmıyor). `phase.label` kullanıcı/LLM-temininli serbest metin (goals.service.ts getTimelineData satır 175: `label = p.phase_label ?? p.goal_type`), dolayısıyla keyfi uzun Türkçe ifade olabilir. Çok-fazlı bir hedefte bir faz toplama göre kısaysa (örn. 30 haftalık planda 2 haftalık faz ≈ %6.6 genişlik) etiket dar bir hücreye render olur ve komşu etiketlerin üstüne yatay taşar.

**Etki:** Çok-fazlı hedeflerde bar altı faz etiketleri çakışıp okunamaz hale gelebilir. Yalnızca dengesiz çok-fazlı planlarda ortaya çıkan kozmetik kenar durum.

**Kanıt:**
```jsx
<View style={{ width: `${widthPct}%`, alignItems: 'center' }}>
  <Text style={{ color: phase.isActive ? COLORS.text : COLORS.textMuted, fontSize: 10, ... }}>
    {phase.label ?? `${phase.targetWeeks}h`}
  </Text>   // numberOfLines yok, ellipsize yok, hücrede overflow:hidden yok
```

**Öneri:** Bar-altı etiket Text'ine (satır 106) `numberOfLines={1}` ve `ellipsizeMode='tail'` ekleyin, hücre View'ına (satır 105) `overflow:'hidden'` ekleyin. Ayrıca yükseltilmiş sistem fontunun çakışmayı kötüleştirmemesi için `maxFontSizeMultiplier={MAX_FONT_SCALE}` ile font ölçeklemesini sınırlayın.

---

### [MEDIUM] UI-PLN-03 — All-time rapor kilo kilometre taşlarını yalnızca kilo KAYBI için gösteriyor — kilo/kas-hedefi kullanıcısı asla kg rozeti kazanmıyor

**Dosya:** `app/reports/all-time.tsx:156-168`

**Sorun:** Milestones kartı kilo kilometre taşlarını yalnızca `totalWeightChange < 0` (kilo verildi) iken render eder. `totalWeightChange = currentWeight - startWeight`. Kilo alma veya kas-kazanma hedefli (uygulamada birinci-sınıf goal_type'lar) bir kullanıcı için `totalWeightChange` POZİTİF olur, dolayısıyla tüm `{totalWeightChange < 0 && (...)}` bloğu atlanır ve ne kadar kilo alırsa alsın 'İlk 1 kg / 5 kg / 10 kg' kilometre taşı hiç gösterilmez. Üstelik boş-satır fallback'i (satır 166) yalnızca `totalMeals === 0 && longestStreak < 7` iken göründüğünden, öğün kaydeden bir kazanan kullanıcı +kg ilerlemesini onaylamayan boş bir Milestones kartı görür.

**Etki:** Bulk/kas-kazanma hedefli kullanıcılar (uygulamada birinci-sınıf goal_type) all-time raporda sıfır kilo-kilometre-taşı tanıması alır; temel motivasyon yüzeyini baltalar ve raporu kullanıcı tabanının yarısı için bozuk/boş gösterir.

**Kanıt:**
```jsx
{totalWeightChange !== null && totalWeightChange < 0 && (
  <>
    {Math.abs(totalWeightChange) >= 1 && <MilestoneRow text="İlk 1 kg" done />}
    {Math.abs(totalWeightChange) >= 5 && <MilestoneRow text="5 kg" done />}
    {Math.abs(totalWeightChange) >= 10 && <MilestoneRow text="10 kg" done />}
  </>
)}
```

**Öneri:** Eşik kontrolleri zaten `Math.abs()` kullanıyor; yalnızca kapıyı `< 0` yerine `!== 0` yapın ve kilometre taşını yöne göre etiketleyin ('İlk 1 kg' her iki yön için de çalışır). Hedef yönünü yansıtarak kazanan kullanıcılar +kg taşlarını görsün.

---

### [MEDIUM] UI-PLN-04 — Takvim 'bugün' vurgusu UTC tarihi kullanıyor — UTC+ saat dilimlerinde yerel geceyarısından sonra yanlış hücre vurgulanıyor

**Dosya:** `app/reports/calendar.tsx:79`

**Sorun:** `isToday`, yerel oluşturulmuş `day.date` string'ini `now.toISOString().split('T')[0]` (UTC tarihi) ile karşılaştırır. `day.date` yerel takvim değerlerinden (calendar.service.ts:44 year/month/day) kurulur. Türkiye'de (UTC+3), yerel 00:00–03:00 arasında UTC tarihi hâlâ önceki takvim günüdür; dolayısıyla bu pencerede takvim DÜNü 'bugün' diye vurgular (gerçek bugünün hücresi sınır almaz). Bu, monthly.tsx'in #S13 yorumuyla açıkça düzelttiği aynı toISOString()/yerel uyumsuzluğu.

**Etki:** Her gece ~3 saat boyunca (daha doğudaki zonlarda daha uzun) 'bugün' halkası yanlış güne çizilir ve accessibilityLabel yanlış günü 'bugün' diye duyurur. Takvimde görünür şekilde yanlış (pencere sınırlı ve kendiliğinden düzeliyor).

**Kanıt:**
```jsx
const isToday = day.date === now.toISOString().split('T')[0];
```

**Öneri:** Bugünün string'ini kod tabanının geri kalanı gibi yerel bileşenlerden kurun: `const t = new Date(); const todayStr = \`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}\`;` ve `day.date === todayStr` karşılaştırın.

---

### [MEDIUM] UI-LAY-02 — Dashboard üst banner'lar + soğuk-yükleme skeleton'ı notch/durum çubuğu altında render oluyor (ScrollView'da üst safe-area inset yok)

**Dosya:** `app/(tabs)/index.tsx:259-262, 264-348`

**Sorun:** Dashboard ScrollView yalnızca contentContainerStyle `paddingBottom` ayarlıyor (satır 260) — `paddingTop` ve `insets.top` YOK. Üst safe-area inset'i `<HeroSection>` (HeroSection.tsx:85: `paddingTop: insets.top + 8`) sahipleniyor. Ama HeroSection'ın ÜSTÜNDE, ScrollView'ın ilk çocukları olarak birkaç eleman render oluyor: 'HOŞ GELDİN'/'TEKRAR HOŞ GELDİN' dönüş banner'ı (264-299), trial-countdown banner'ı (303-331) ve ilk-soğuk-yükleme skeleton bloğu (333-348, yalnızca `marginTop` kullanıyor). Üç durumda da en üst içerik y=0'dan başlayıp durum çubuğu/notch altına kayıyor.

**Etki:** Notch/Dynamic-Island cihazlarda hoş-geldin banner'ı, trial-bitiş banner'ı ve tüm ilk-yükleme skeleton'ı durum çubuğu ve notch tarafından kırpılır/örtülür. Dönüş ve trial banner'ları, uygulamanın kullanıcının dikkatini en çok istediği anlardır. Durumsal (nadir banner durumları), bu yüzden MEDIUM.

**Kanıt:**
```jsx
// Satır 259-262:
<ScrollView contentContainerStyle={{ paddingBottom: 100 + insets.bottom }} refreshControl={...}>
  {/* Welcome back banner */}
  {returnStatus && returnStatus.level !== 'active' && (
    <View style={{ ... padding: SPACING.md, marginBottom: SPACING.md, ... }}>   // insets.top yok
// Satır 336-338 (skeleton):
<View ... style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>   // yalnızca marginTop
```

**Öneri:** ScrollView contentContainerStyle'ına `paddingTop: insets.top` ekleyin (veya `SafeAreaView edges=['top']`) ve duplikasyonu HeroSection'dan kaldırın; böylece her üst durum inset'e saygı duyar.

---

### [MEDIUM] UI-LAY-03 — Hızlı kayıt 'Tartı' alt-ekranı: ortalanmış TextInput + butonlar küçük cihazlarda klavyeyle örtülebilir

**Dosya:** `app/log.tsx:396-431`

**Sorun:** Quick Log modalının 'weight' alt-ekranı `justifyContent:'center'` flex konteyner ve KeyboardAvoidingView yok. TextInput (satır 411) `autoFocus` (satır 420), dolayısıyla decimal-pad klavyesi ekran açılır açılmaz belirir. İçerik dikey ortalandığından input dikey ortaya yakın oturur ve İptal/Kaydet butonları hemen altında (423-430) render olur. app/log.tsx modal sunulduğundan (app/_layout.tsx:95) yükseklik daralır ve klavye kaçınması yok; küçük cihazlarda klavyenin üst kenarı dikey ortanın üstüne ulaşıp Save/Cancel butonlarını örter.

**Etki:** Küçük/kompakt telefonlarda kilo-giriş Kaydet butonu, autoFocus nedeniyle ekran açılışında hemen klavyeyle örtülür; klavye kapatılana kadar tartı hızlı-kaydı zahmetli. (Aynı kalıp index.tsx'teki ortalanmış kilo Modal'ında da var, ama orada `onSubmitEditing=handleWeightSave` kısmen hafifletiyor.)

**Kanıt:**
```jsx
// Satır 398:
<View style={{ flex: 1, ..., justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
// Satır 411-421:
<TextInput style={{ ... textAlign: 'center', width: '70%', ... }} placeholder="73.5" value={weightInput} onChangeText={setWeightInput} keyboardType="decimal-pad" autoFocus />
// Satır 423: İptal/Kaydet, kaçınma yok
```

**Öneri:** Bu alt-ekranı KeyboardAvoidingView ile sarın veya içeriği ortalamak yerine üste sabitleyin (`justifyContent:'flex-start'` + paddingTop), böylece autoFocus'lu input + butonlar klavyenin üstünde kalır.

---

### [MEDIUM] UI-LAY-04 — Çok Fazlı Hedef: KAV olmayan ScrollView'ın en altındaki 'Yeni Faz Ekle' input'ları klavyeyle örtülüyor

**Dosya:** `app/settings/multi-phase-goals.tsx:88, 153-169`

**Sorun:** multi-phase-goals.tsx içeriğini düz `<ScrollView>` içinde render ediyor, KeyboardAvoidingView yok (satır 88). 'Yeni Faz Ekle' kartı — ekranın tek veri-giriş yolu — scroll içeriğinin SON elemanı (153-170), 'Hedef Kilo' ve 'Süre (hafta)' `<Input>` alanları (166-167) ve 'Faz Ekle' butonu (168) içeriyor. Bu input'lar sayfanın altında ve klavye kaçınması olmadığından, iOS'ta odaklanınca onlar ve gönder butonu klavyenin arkasında kalır. Kardeş settings formları (goals, lab-values, edit-profile) KAV ile sarılı; bu premium ekran atlanmış.

**Etki:** Premium kullanıcılar bir hedef fazı eklerken 'Süre (hafta)' input'unu veya 'Faz Ekle' butonunu yazarken göremez (iOS); kör yazıp gönderebilmek için klavyeyi kapatmaları gerekir. Ücretli bir özellikte bozuk-hissi veren form. (Hafifletici: pushed ekran olduğundan iOS'un otomatik scroll-to-focused-input'u kısmen yardım eder.)

**Kanıt:**
```jsx
// Satır 88:
<ScrollView style={{ flex: 1, ... }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
// Satır 166-168 (scroll içeriğinin altında):
<Input label="Hedef Kilo (opsiyonel)" ... keyboardType="decimal-pad" />
<Input label="Süre (hafta)" ... keyboardType="numeric" />
<Button title="Faz Ekle" onPress={handleAdd} />
// dosyada KeyboardAvoidingView import/kullanımı yok
```

**Öneri:** ScrollView'ı `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>` ile sarın ve `keyboardShouldPersistTaps='handled'` ekleyin (`app/settings/lab-values.tsx:73-74`'ü örnek alın).

---

### [MEDIUM] UI-STA-01 — Sohbet sekmesi ilk soğuk yüklemede boş (loading göstergesi yok)

**Dosya:** `app/(tabs)/chat.tsx:49, 276-289`

**Sorun:** SessionListScreen `loading`'i `useState(true)` ile başlatır ama yükleme sırasında hiçbir spinner/skeleton göstermez. Tek dallanma var: `sessions.length === 0 && !loading` → EmptyState, aksi halde FlatList. İlk soğuk yüklemede (`loading=true`, `sessions=[]`) koşul `false` olduğundan FlatList dalına düşülür; FlatList boş `data=[]` ile çizilir ve `RefreshControl` yalnızca kullanıcı aşağı çekerse görünür. Sonuç: herkes fetch çözülene kadar ScreenHeader altında BOŞ bir ekran görür. EmptyState ve SkeletonScreen projede mevcut ama bu yüzeyde kullanılmamış.

**Etki:** AI-first uygulamanın merkez sohbet sekmesi her açılışta (özellikle yavaş ağda) anlık tamamen boş görünür. Yeni kullanıcı bozuk sanabilir; mevcut kullanıcı oturum listesinin kaybolduğunu sanabilir. Tek bir `fetchSessions()` çözülmesiyle geçici bir flaş olduğundan (normal ağda <1sn, veri kaybı yok, ScreenHeader + onboarding kartları yine render olur) şiddet MEDIUM.

**Kanıt:**
```jsx
const [loading, setLoading] = useState(true);
...
{sessions.length === 0 && !loading ? (
  <EmptyState icon="chatbubble-ellipses-outline" title="Kochko ile tanış" ... />
) : (
  <FlatList data={sessions} ... refreshControl={<RefreshControl refreshing={loading} ... />} />
)}
// loading=true & sessions=[] → ne EmptyState ne spinner; boş FlatList çizilir
```

**Öneri:** `loading && sessions.length === 0` durumunda SkeletonScreen/SkeletonCard listesi (veya en azından ActivityIndicator) render edin. Koşulu üç-yollu yapın: loading→skeleton, boş→EmptyState, dolu→FlatList.

---

### [MEDIUM] UI-STA-02 — Dashboard PlanOverviewCards: plan varken ilk yüklemede 'planın yok' yanıltıcı boş-durum flaşı

**Dosya:** `src/components/dashboard/PlanOverviewCards.tsx:30-44, 107-113`

**Sorun:** Bileşen `diet`/`workout` state'lerini `null` ile başlatır ve aktif planı `getActive()` ile yükler; `loading`/`hasLoaded` ayrımı YOKTUR. İlk fetch çözülene kadar `plan === null` olduğundan PlanCard 'Diyet planın yok / Oluşturmak için dokun' (ve antrenman için aynısı) boş-durumunu gösterir. Yani aktif planı olan kullanıcı, dashboard ilk mount'unda kısa süre 'planın yok' metnini görür, sonra plan içeriği gelir. Üst bileşen index.tsx ilk-yükleme için skeleton + hasLoadedOnce kalıbı kullanırken bu alt bileşen bu korumadan yoksun.

**Etki:** Ana ekranın en görünür kartlarından ikisi, plan sahibi kullanıcıya ilk yüklemede 'plan yok' diye yanıp söner — veri kaybı izlenimi ve gereksiz 'oluştur' CTA'sı. (Not: refocus'ta state null'a SIFIRLANMADIĞINDAN — setDiet/setWorkout yalnızca yeni getActive() çözülünce çalışır — flaş yalnızca ilk mount'ta olur, her sekme değişiminde değil; bu yüzden HIGH değil MEDIUM.)

**Kanıt:**
```jsx
const [diet, setDiet] = useState<PlanRow | null>(null);
const [workout, setWorkout] = useState<PlanRow | null>(null);
const load = useCallback(async () => { const [d, w] = await Promise.all([getActive(userId,'diet'), getActive(userId,'workout')]); setDiet(d); setWorkout(w); }, [userId]);
useFocusEffect(useCallback(() => { load(); }, [load]));
// PlanCard: if (!plan) return { primary: 'Diyet planın yok', ... }  ← yükleme sırasında da çalışır
```

**Öneri:** Bir `loaded` (veya `loading`) bayrağı ekleyin; ilk fetch çözülene kadar SkeletonBlock/placeholder kart gösterin, 'plan yok' boş-durumunu yalnızca `loaded && !plan` iken render edin.

---

### [MEDIUM] UI-STA-03 — Birden çok ayar listesi ekranı loading state'siz fetch ediyor → veri gelmeden 'Henüz yok' boş-durum flaşı

**Dosya:** `app/settings/recipes.tsx:20, 36-37, 185-186` (+ meal-templates.tsx, lab-values.tsx, supplements.tsx, venues.tsx, multi-phase-goals.tsx)

**Sorun:** Bir grup liste ekranı veriyi mount'ta fetch eder ama hiç `loading` durumu tutmaz; veri gelene kadar boş diziyle render edip 'Henüz ... yok' kartını gösterir. recipes.tsx (satır 185 `recipes.length === 0` → 'Henüz kayıtlı tarif yok'), meal-templates.tsx (satır 18/96), lab-values.tsx (satır 24, loading yok), supplements.tsx (satır 28/78), venues.tsx (satır 20/43), multi-phase-goals.tsx (satır 37-43) aynı kalıbı paylaşır. Verisi OLAN kullanıcı her açılışta önce yanlış 'boş' mesajını görür, sonra liste belirir. Aynı kod tabanında food-preferences.tsx loading state'i doğru tutar (ActivityIndicator).

**Etki:** Tutarsız ve telaş yaratan UX: kullanıcı kayıtlarının silindiğini sanabilir. SkeletonCard mevcut ama kullanılmamış.

**Kanıt:**
```jsx
// recipes.tsx
const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
useEffect(() => { load(); }, [filter]);
const load = () => getRecipes(filter ?? undefined).then(setRecipes);  // loading state YOK
{recipes.length === 0 ? (<Card><Text>Henüz kayıtlı tarif yok...</Text></Card>) : (...)}
// meal-templates / lab-values / supplements / venues / multi-phase-goals aynı: useState<...[]>([]) + .then(set...), loading yok
```

**Öneri:** Bu ekranlara `loading` state'i ekleyip ilk fetch çözülene kadar SkeletonCard/ActivityIndicator gösterin; boş-durum kartını yalnızca `!loading && length === 0` iken render edin (food-preferences.tsx kalıbını izleyin).

---

### [MEDIUM] UI-STA-04 — health-events.tsx: boş-durumu yok + seçili chip'te beyaz-üstüne-teal kontrast AA hatası

**Dosya:** `app/settings/health-events.tsx:24, 65, 80-102`

**Sorun:** İki kusur: (1) Sağlık olayları (ameliyat, sakatlık, kronik durum gibi tıbbi-bağlamlı veriler) `getHealthEvents().then(setEvents)` ile yüklenir; ne loading ne boş-durum vardır. `events` boşken (yeni kullanıcı veya henüz kayıt yok) form altında HİÇBİR ŞEY render edilmez — ekran bomboş bir form olarak kalır. Kardeş liste ekranları (supplements, recipes, venues, chat-history, progress-photos, coach-memory) boş-durum kartı gösterir. (2) Satır 65: seçili tür chip'inin metni sabit beyaz, arka plan `COLORS.primary` (#1D9E75); beyaz-üstüne-teal 3.39:1, FONT.xs (11px) küçük metin için WCAG AA (4.5:1) altında. (Bu ikinci kusur UI-DS-01 ile aynı satırı paylaşır; UI-DS-01 sistemsel 3-ekran görünümünü, bu kalem health-events boş-durumunu ekler.)

**Etki:** Tıbbi geçmiş ekranı boş durumda yönlendirmesiz görünür; kullanıcı uygulamanın bozuk olduğunu sanabilir. Seçili tür etiketi düşük kontrast nedeniyle zor okunur.

**Kanıt:**
```jsx
useEffect(() => { getHealthEvents().then(setEvents); }, []);  // loading + empty state yok
<Text style={{ color: type === t ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{EVENT_LABELS[t]}</Text>
// beyaz(#fff) on primary(#1D9E75) = 3.39:1 → 11px için AA FAIL; getContrastColor→siyah (~6.2:1)
{events.map(e => (...))}  // events=[] iken hiçbir boş-durum render edilmez
```

**Öneri:** (1) `events.length === 0` için açıklayıcı boş-durum kartı ekleyin ('Henüz sağlık olayın yok...'). (2) Satır 65'te `'#fff'` yerine `getContrastColor(COLORS.primary)` kullanın.

---

### [MEDIUM] UI-STA-05 — Raporlar (progress) sekmesi: sorgu hatası yutuluyor, ağ hatası 'sıfır veri yeni kullanıcı' gibi görünüyor (error state yok)

**Dosya:** `app/(tabs)/progress.tsx:64-113, 197`

**Sorun:** `load()` Promise.all ile 6 sorgu çalıştırır. catch dalında yalnızca `console.warn` yapılır; hiçbir `error` state set EDİLMEZ ve `finally` `setLoading(false)` çağırır. Sonuç: ağ/Supabase hatasında skeleton kapanır ve ekran tüm kartları boş/sıfır değerlerle ('-' özet kutuları, 'Henüz yeterli veri yok', 'Henüz rapor yok') render eder — gerçek bir hata, içeriği olmayan yeni bir kullanıcının ekranıyla bire bir AYNI görünür. Kullanıcıya tekrar deneme yolu veya hatanın geçici olduğu bilgisi sunulmaz. reports/daily.tsx, weekly.tsx, monthly.tsx, all-time.tsx aynı yüzeyde retry'lı error-state kullanırken ana progress sekmesi kullanmaz.

**Etki:** Ağ hatasında kullanıcı 'verilerim silinmiş / hiç ilerleme yok' algısına kapılır ve yeniden denemeyi bilmez. (Hafifletici: progress.tsx salt-okunur analitik ve pull-to-refresh RefreshControl mevcut — satır 213 — yani kullanıcı yine yenileyebilir; bu yüzden MEDIUM netlik sorunu.)

**Kanıt:**
```jsx
} catch (err) {
  console.warn('[progress] load failed', err);  // error state YOK
} finally {
  setLoading(false);
}
// catch sonrası ekran: SummaryBox value '-', 'Henüz yeterli veri yok', 'Henüz rapor yok' (boş kullanıcıyla aynı)
```

**Öneri:** Bir `error` state ekleyip catch'te set edin; yüklenen veri yokken hata olduğunda kardeş rapor ekranlarındaki gibi (cloud-offline ikonu + 'Tekrar dene' butonu) error-state render edin. Mevcut veri varken sessizce eskisini koruyabilirsiniz.

---

### [LOW] UI-DS-04 — SPACING ve RADIUS ölçekleri off-grid ve çift değerler içeriyor

**Dosya:** `src/lib/constants.ts:7, 11`

**Sorun:** `SPACING = { xs:4, sm:8, md:12, lg:14, xl:16, xxl:24 }`. Seri 4/8/12/14/16/24 — 'lg' 14 olarak 4dp grid'i bozar (md→lg adımı 2dp, diğer her adım 4 veya 8). Card.tsx birincil içerik dolgusu olarak SPACING.lg (14) kullanır. `RADIUS = { sm:8, md:12, lg:16, xl:24, xxl:24, pill:99, full:999 }`'de xl ve xxl ikisi de 24 (özdeş), pill:99 ve full:999 efektif olarak aynı 'tam yuvarlak' değer iki isimle — yazarlar hangisini kullanacağını bilemez (StreakBadge'de RADIUS.pill, başka yerde RADIUS.full).

**Etki:** Off-grid (14) ve çift (xl===xxl, pill≈full) token'lar ölçeği muğlaklaştırır: iki isim tek değere eşlenir, soyutlama tutarlılığı garanti etmeyi bırakır. Çalışma zamanı etkisi yok.

**Kanıt:**
```ts
constants.ts:7: export const SPACING = { xs: 4, sm: 8, md: 12, lg: 14, xl: 16, xxl: 24 } as const;
constants.ts:11: export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, xxl: 24, pill: 99, full: 999 } as const;  // xl === xxl === 24
```

**Öneri:** 'lg'yi 16 yapıp yeniden numaralandırın (4/8/12/16/20/24) veya 14'ün neden kasıtlı olduğunu belgeleyin. RADIUS.xxl'i xl'e katın (veya ayrı değer verin) ve pill/full'dan birini kanonik seçip diğerini deprecate edin.

---

### [LOW] UI-DS-05 — UI primitifleri FONT/SPACING ölçeklerini magic sayılarla baypaslıyor (ErrorBoundary, Skeleton, Button, CircularProgress)

**Dosya:** `src/components/ui/ErrorBoundary.tsx:66-98`, `Skeleton.tsx:48,50,52,61`, `Button.tsx:40`, `CircularProgress.tsx:78`

**Sorun:** Birkaç çekirdek primitif SPACING/FONT/RADIUS tüketmek yerine ham spacing/boyut/font-size sabitler. ErrorBoundary padding:32, fontSize:18, marginBottom:8/24, paddingHorizontal:24, fontSize:14/11/10 kullanır. Skeleton padding:16, gap:10/12, height:18/12 sabitler. Button height'leri 32/40/48 inline literal olarak türetir. CircularProgress `fontSize: size > 120 ? 24 : FONT.xl` — 24 mevcut FONT.xxl token'ını çoğaltır.

**Etki:** Primitiflerde magic sayılar token sistemini temelden baltalar: 'doğru' kullanımı modellemesi gereken bileşenler ölçeği baypaslar, global spacing/tip değişimi onlara ulaşmaz, inceleyiciler kasıtlı değerleri sürüklenmeden ayıramaz. (ErrorBoundary class component olduğundan useTheme çağıramaz — bu renkler için kabul edilir; eleştiri yalnızca sayısal token'lar hakkında.)

**Kanıt:**
```jsx
Skeleton.tsx:48: padding: 16, ... gap: 10
Skeleton.tsx:52: height={18}
ErrorBoundary.tsx:66: padding: 32 ... :67 fontSize: 18 ... :70 fontSize: 14
CircularProgress.tsx:78: fontSize: size > 120 ? 24 : FONT.xl  (24 duplicates FONT.xxl)
Button.tsx:40: const height = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
```

**Öneri:** Bir token eşleştiğinde literal'leri token'larla değiştirin (CircularProgress 24 → FONT.xxl; Skeleton padding:16 → SPACING.xl; ErrorBoundary fontSize:18 → FONT.xl2, fontSize:14 → FONT.md). Button height'leri için bir SIZES/heights token haritası tanımlayın.

---

### [LOW] UI-DS-06 — FONT ölçek sıralaması yanıltıcı: FONT.xl2 (18) FONT.xl'den (20) küçük

**Dosya:** `src/lib/constants.ts:8-10`

**Sorun:** `FONT = { xs:11, sm:13, md:14, lg:16, xl2:18, xl:20, xxl:24, hero:28 }`. 'xl2' anahtarı 'extra-extra-large' ('xl'den büyük) gibi okunur, ama değeri 18, FONT.xl'den (20) KÜÇÜK. 16→20 boşluğunu doldurmak için eklenmiş, ama isim ölçekteki konumunu iletmiyor; 'xl2'yi başlık için seçen yazar 'xl'den küçük boyut alır. ScreenHeader.tsx:40 başlık için zaten FONT.xl2'ye dayanıyor (canlı kullanımda).

**Etki:** İsmi boyutuyla çelişen tip token'ı yanlış seçimleri davet eder (yazarlar xl2 > xl bekler). Görsel-hiyerarşi hatalarının gizli kaynağı.

**Kanıt:**
```ts
constants.ts:10: export const FONT = { xs: 11, sm: 13, md: 14, lg: 16, xl2: 18, xl: 20, xxl: 24, hero: 28 } as const;  // xl2(18) < xl(20)
// src/components/ui/ScreenHeader.tsx:40: <Text style={{ ... fontSize: FONT.xl2, fontWeight: '700' }}>
```

**Öneri:** Konum-doğru bir anahtara yeniden adlandırın (örn. 'lg2' olarak ekleyin veya isimce monoton okunacak şekilde yeniden numaralandırın), ScreenHeader referansını güncelleyin. Asgari olarak nesne literalini sayısal değerler monoton olacak şekilde yeniden sıralayın ve satır-içi not ekleyin.

---

### [LOW] UI-DS-07 — Ölü/deprecated tasarım-sistemi yüzeyi: kullanılmayan colors.shadow token'ı ve light dalında (görünmez) CARD_SHADOW

**Dosya:** `src/lib/theme.ts:73,112`, `src/lib/constants.ts:28-29,41-42`, `src/components/profile/InsightCard.tsx:31`

**Sorun:** ThemeColors bir 'shadow' token'ı (her iki palette de #000000) tanımlar ama hiçbir yerde tüketilmez ('.shadow' grep'i *.tsx'te sıfır kullanım döndürür). constants.ts hâlâ deprecated alias CARD_SHADOW = CARD_BORDER ve ELEVATED_SHADOW = CARD_BORDER export eder; theme.ts deprecated GRADIENTS/HERO_GRADIENTS export eder (tuple'ları aynı rengi tekrar eden no-op gradient'lar). InsightCard.tsx:31 CARD_SHADOW'u (aslında sabit rgba(255,255,255,0.08) beyaz kenar) yalnızca light dalında yayar — beyaz light-mode kart üstünde beyaz %8 kenar görünmez, yani elevation affordance'ı light mode'da sessizce kaybolur (light gated olduğundan latent).

**Etki:** Ölü token'lar (shadow), no-op deprecated export'lar ve InsightCard'ın light-mode-bozuk kenarı tasarım-sistemi yüzeyini kirletir ve yazarları elevation/shadow token'larının işlevsel olduğuna inandırır. Light mode gated olduğundan bugün düşük etki.

**Kanıt:**
```jsx
theme.ts:73: shadow: '#000000',  (DARK) / theme.ts:112: shadow: '#000000',  (LIGHT) — hiç okunmuyor
constants.ts:28-29: /** @deprecated */ export const CARD_SHADOW = CARD_BORDER;
constants.ts:41-42: /** @deprecated No elevation in flat design */ export const ELEVATED_SHADOW = CARD_BORDER;
InsightCard.tsx:31: ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),  // CARD_BORDER = rgba(255,255,255,0.08) → beyaz kart üstünde görünmez
```

**Öneri:** Kullanılmayan 'shadow' alanını ThemeColors'tan kaldırın (veya bağlayın), no-op GRADIENTS/HERO_GRADIENTS ve CARD_SHADOW/ELEVATED_SHADOW alias'larını silin, InsightCard'ı her iki temada da colors.border kullanacak şekilde değiştirin.

---

### [LOW] UI-DS-08 — DateTimeField temadan türetmek yerine themeVariant="dark" sabitliyor

**Dosya:** `src/components/ui/DateTimeField.tsx:74`

**Sorun:** DateTimeField diğer her renk için useTheme() tüketir (colors.inputBg, colors.border, colors.text, colors.textSecondary) ama native DateTimePicker'da `themeVariant="dark"` sabitler. Bileşen temaya zaten erişiyor; `isDark ? 'dark' : 'light'` geçmeli. Şu anda native picker temadan bağımsız zorla koyu.

**Etki:** Latent tutarsızlık: light mode geldiğinde date/time spinner dark-on-light render olur. Şimdi bile bir tasarım-sistemi smell'i. Koyu tek aktif tema olduğundan bugün görsel kusur yok.

**Kanıt:**
```jsx
DateTimeField.tsx:43: const { colors } = useTheme();  // tema mevcut
DateTimeField.tsx:74: themeVariant="dark"   // sabit, temayı yok sayar
```

**Öneri:** useTheme()'den isDark çekin ve `themeVariant={isDark ? 'dark' : 'light'}` geçin.

---

### [LOW] UI-PR-02 — SectionHeader başlık olarak gösterilmiyor (accessibilityRole="header" yok)

**Dosya:** `src/components/settings/SectionHeader.tsx:11-24`

**Sorun:** SectionHeader çıplak bir `<Text>` (büyük harf bölüm başlığı) render eder, `accessibilityRole="header"` yok. Kardeş primitif ScreenHeader başlığını header olarak işaretler (ScreenHeader.tsx:40), dolayısıyla iki başlık primitifi tutarsız. Uzun bir settings sayfasında 'başlıklar' ile gezinen ekran-okuyucu kullanıcıları (standart rotor/TalkBack jesti) bölümler arasında atlayamaz çünkü bölüm başlıkları düz metindir.

**Etki:** Settings ekranlarında ekran-okuyucu kullanıcıları için bozulmuş gezinme; ScreenHeader primitifiyle minör tutarsızlık.

**Kanıt:**
```jsx
<Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', ... textTransform: 'uppercase', ... }}>
  {title}
</Text>
// karşılaştır ScreenHeader.tsx:40 -> <Text ... accessibilityRole="header">{title}</Text>
```

**Öneri:** `<Text>`'e `accessibilityRole="header"` ekleyin, ScreenHeader ile eşleşsin.

---

### [LOW] UI-PR-04 — Button başlığı sabit yükseklikte taşabilir/kırpılabilir (numberOfLines/truncation yok)

**Dosya:** `src/components/ui/Button.tsx:40-81`

**Sorun:** Button sabit `height` (boyuta göre 32/40/48) taşır ve başlık `<Text>`'ini `numberOfLines` ve `ellipsizeMode` olmadan render eder. Uzun bir Türkçe etiketle (veya yükseltilmiş sistem font ölçeğinde, çünkü Text'te `maxFontSizeMultiplier` de yok) metin ikinci satıra sarar, sabit satır yüksekliğiyle kırpılır veya ikonu görünüm dışına iter. CircularProgress `maxFontSizeMultiplier={MAX_FONT_SCALE}` ile sınırlarken Button sınırlamıyor.

**Etki:** Uzun button etiketleri veya büyük erişilebilirlik font boyutları sabit-yükseklik button içinde dikey kırpılmış etiket render edebilir. Kenar durum ama erişilebilirlik font ölçeklemesiyle gerçek cihazlarda ulaşılabilir.

**Kanıt:**
```jsx
const height = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
<Text style={{ color: textColor, fontSize, fontWeight: '500' }}>{title}</Text>
// numberOfLines yok, ellipsizeMode yok, maxFontSizeMultiplier yok; parent sabit height + overflow varsayılan clip
```

**Öneri:** Button başlık `<Text>`'ine `numberOfLines={1}` ve `maxFontSizeMultiplier={MAX_FONT_SCALE}` ekleyin; uzun etiketler ellipsis ile kesilsin ve büyük sistem fontları sabit yüksekliği patlatmasın.

---

### [LOW] UI-TAB-01 — Progress grafikleri kart konteynerından 4px daha geniş ve sağ kenarda kırpılıyor

**Dosya:** `app/(tabs)/progress.tsx:23, 212, 240, 270`

**Sorun:** `chartWidth = Dimensions.get('window').width - SPACING.md * 4` = pencere − 48. Her iki LineChart `width={chartWidth}` ile `<Card>` içinde render ediliyor. Gerçek yatay inset 48'den büyük: ScrollView contentContainer `padding: SPACING.md` ekler (12px×2=24) ve Card'ın iç içerik View'ı `padding: SPACING.lg` ekler (14px×2=28). Gerçek kullanılabilir iç genişlik pencere − 24 − 28 = pencere − 52, yani chartWidth'ten (pencere − 48) 4px DAHA AZ. Card `overflow:'hidden'` olduğundan grafiğin en sağ 4px'i her cihazda kırpılır.

**Etki:** Her iki grafiğin sağ kenarı her ekran boyutunda kırpılır. Matematik sabit 4px yanlış olduğundan tutarlı (kenar durum değil). Etki düşük çünkü taşma sabit 4px (bezier çizgisinin son noktası, r=3); x-ekseni etiketleri seyrek olduğundan 'son etiket kesik' kısmı genelde geçersiz.

**Kanıt:**
```jsx
const chartWidth = Dimensions.get('window').width - SPACING.md * 4;
contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 12, paddingBottom: 100 + insets.bottom }}
<Card title="Kilo Trendi">  // Card inner: <View style={{ padding: SPACING.lg }}>
  <LineChart ... width={chartWidth} height={180} ... />
```

**Öneri:** Gerçek inset'i çıkarın: `Dimensions.get('window').width - (SPACING.md * 2) - (SPACING.lg * 2)` (= pencere − 52), veya onLayout ile ölçülen kart genişliğinden hesaplayın. `SPACING.md * 4` kullanmayın.

---

### [LOW] UI-TAB-02 — chartWidth modül yükünde bir kez yakalanıyor — oryantasyon/pencere değişimine tepki vermiyor

**Dosya:** `app/(tabs)/progress.tsx:23`

**Sorun:** `chartWidth` JS bundle ilk yüklendiğinde tam olarak bir kez değerlendirilen üst-düzey modül sabiti; `useWindowDimensions` hook'u veya Dimensions değişim dinleyicisiyle hiç yeniden hesaplanmıyor. Cihaz dönerse, split-screen/foldable'da kullanılırsa veya bundle farklı bir pencere boyutunda değerlendirilmişse grafikler eski genişliği korur ve ya taşar ya da kartı eksik doldurur.

**Etki:** Dönme/split-screen'de kilo/uyum grafikleri yanlış genişlikte render olur. Portrait-kilitli telefon uygulaması için minör, ama tablet/foldable'da gerçek kusur. (UI-TAB-01 ile aynı kök alan; ikisi de bileşen içinde useWindowDimensions ile birlikte düzeltilir.)

**Kanıt:**
```jsx
const chartWidth = Dimensions.get('window').width - SPACING.md * 4;  // modül kapsamı, bir kez değerlendirilir
```

**Öneri:** Genişlik türetimini bileşen içine taşıyın ve `useWindowDimensions()` kullanın: `const { width } = useWindowDimensions(); const chartWidth = width - (SPACING.md*2) - (SPACING.lg*2);`

---

### [LOW] UI-TAB-03 — StatStrip kilo & uyku değerlerini yuvarlamadan render ediyor — uzun ondalıklar görünebilir

**Dosya:** `src/components/dashboard/StatStrip.tsx:104, 110`

**Sorun:** Uyku ve Kilo stat kartları ham DB sayılarını biçimlendirmeden interpole eder: `value={sleepHours != null ? \`${sleepHours} sa\` : '-'}` ve `value={weightKg != null ? \`${weightKg} kg\` : '-'}`. Su/adım kartları biçimlendirirken (satır 88, 96) bu ikisi etmez. (Finder MEDIUM önerdi ama sütun tipleri en kötü durumu sınırlıyor — bkz. Etki.)

**Etki:** Sütun tipleri `daily_metrics.weight_kg = DECIMAL(5,2)` ve `sleep_hours = DECIMAL(3,1)` olduğundan Postgres değerleri 2 ve 1 ondalığa sabitler. Finder'ın '73.456 kg' / '6.7500001 sa' örnekleri İMKANSIZ; gerçekçi en kötü durum '73.46 kg' / '6.8 sa' — karta sığar, sarmaz. Su/adım kartlarıyla tutarsız gerçek bir gösterim-hijyeni boşluğu ama tarif edilen taşma riski değil; bu yüzden LOW.

**Kanıt:**
```jsx
value={sleepHours != null ? `${sleepHours} sa` : '-'}
value={weightKg != null ? `${weightKg} kg` : '-'}
```

**Öneri:** Gösterim katmanında biçimlendirin: `${weightKg.toFixed(1)} kg` ve `${Number(sleepHours).toFixed(1)} sa` (ve value Text'ine `numberOfLines={1}` ekleyin).

---

### [LOW] UI-TAB-05 — Progress (Raporlar) sekmesi başlığı Profil/Hero'da uygulanan tab-başlık kalıbını bozuyor

**Dosya:** `app/(tabs)/progress.tsx:212, 215`

**Sorun:** profile.tsx ve HeroSection açık 'FIX (audit: tab başlık tutarlılığı)' yorumlarıyla tab başlıklarını `fontSize: FONT.xl2 (18), fontWeight: '700'` + `paddingTop: insets.top + 8` olarak standartlaştırıyor. progress.tsx güncellenmemiş: 'Raporlar' başlığı ham `fontSize: 18, fontWeight: '600'` (bir ağırlık adımı daha hafif) ve konteyner `paddingTop: insets.top + 12` (+8 yerine). Ayrıca profile.tsx başlığında olan `accessibilityRole="header"` da yok.

**Etki:** Tablar arası görünür tutarsızlık: Raporlar başlığı daha hafif (600 vs 700), 4px daha aşağıda ve ekran-okuyucuya başlık olarak duyurulmuyor. En savunulabilir kısım a11y boşluğu (eksik accessibilityRole="header"). (Not: FONT.xl2 === 18, dolayısıyla ham 18 görsel boyutu eşleşir.)

**Kanıt:**
```jsx
contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 12, ... }}
<Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: SPACING.md }}>Raporlar</Text>
```

**Öneri:** Paylaşılan kalıbı eşleyin: `fontSize: FONT.xl2, fontWeight: '700'`, `accessibilityRole="header"` ekleyin ve üst dolguyu `insets.top + 8`'e hizalayın.

---

### [LOW] UI-SET-03 — edit-profile ve premium (Active dalı) native header altında üst safe-area inset'i çift sayıyor

**Dosya:** `app/settings/edit-profile.tsx:205` (+ `app/settings/premium.tsx:159`)

**Sorun:** Tüm app/settings/* ekranları native Stack header'ı render eder (hiçbiri headerShown:false ayarlamaz) ve bu header üst safe-area inset'ini zaten sahiplenir. Suite'teki yerleşik kural insets.top OLMADAN düz `padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom` (household, day-boundary, menstrual, supplements vb.). İki ekran bunu bozar: edit-profile.tsx:205 `paddingTop: insets.top + 12` ekler ve premium.tsx 'Active Premium' dalı:159 `paddingTop: SPACING.lg + insets.top` ekler. Native header notch'u zaten hesapladığından bunlar ikinci bir üst inset (~44-59px) ekler. premium.tsx kendi içinde de tutarsız: Trial dalı (177) ve Expired dalı (218) düz `padding: SPACING.md` kullanır.

**Etki:** Notch/Dynamic-Island cihazlarda edit-profile ve active-premium ekranındaki ilk kart diğer her settings ekranından belirgin daha aşağıda oturur ve üç premium durumu birbirine hizalanmaz. Kozmetik tutarsız spacing.

**Kanıt:**
```jsx
// edit-profile.tsx:205
contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 12, paddingBottom: SPACING.xxl + insets.bottom }}
// premium.tsx:159
contentContainerStyle={{ padding: SPACING.md, paddingTop: SPACING.lg + insets.top, ... }}
// baskın kalıp: household.tsx:141 → padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom (insets.top yok)
```

**Öneri:** Bu iki content padding'inden `insets.top` terimini kaldırın; geri kalanla eşleşsin. premium.tsx'te ekstra üst alan istenirse SPACING.lg'yi koruyun ama üç premium dalına da tekdüze uygulayın.

---

### [LOW] UI-SET-04 — health-events ve lab-values listesi boşken neredeyse-boş ekran gösteriyor (boş-durum yok)

**Dosya:** `app/settings/health-events.tsx:80` (+ `app/settings/lab-values.tsx:112`)

**Sorun:** Çoğu liste-stili settings ekranı veri yokken açık bir boş-durum kartı render eder (supplements 'Bugün supplement kaydı yok', recipes 'Henüz kayıtlı tarif yok', venues, chat-history, progress-photos, coach-memory). İki ekran bunu atlar. health-events.tsx `events`'i doğrudan map'ler, boş fallback yok (satır 80), dolayısıyla add-form kapalı yeni kullanıcı yalnızca 'Yeni Ekle' butonu ve boş bir alan görür. lab-values.tsx aynı: `grouped` girişlerini map'ler (satır 112), boş-durum yok.

**Etki:** Bu iki ekranın ilk-kez kullanıcıları boş, açıklanmamış bir alanla karşılaşır; diğer her liste ekranı tek satırlık ipucuyla yönlendirir. Görünür tutarsızlık. (Not: health-events boş-durumu UI-STA-04 ile örtüşür; bu kalem lab-values'i de kapsar.)

**Kanıt:**
```jsx
// health-events.tsx:80 → {events.map(e => (  ... events.length === 0 dalı yok
// lab-values.tsx:112 → {Object.entries(grouped).map(([param, values]) => (  ... boş fallback yok
// karşılaştır supplements.tsx:78-79 → {logs.length === 0 ? (<Text ...>Bugün supplement kaydı yok.</Text>) : (
```

**Öneri:** health-events.tsx'e (`events.length === 0 && !showAdd` iken) ve lab-values.tsx'e (`Object.keys(grouped).length === 0` iken) supplements/recipes/venues stilini eşleyen boş-durum Card'ı ekleyin.

---

### [LOW] UI-CHT-03 — messages.length <= 1 sınırında konteyner takası listeyi remount edip tüm bubble animasyonlarını tekrar oynatıyor (ilk yanıtta flicker)

**Dosya:** `app/chat/[sessionId].tsx:1064-1072`

**Sorun:** Ekran `messages.length <= 1 && !sending` iken `<EmptyState>` (bir ScrollView), aksi halde `<FlatList>` render eder. Bu sınırı geçince (1 mesaj → 2 mesaj) tüm ScrollView alt-ağacı yıkılır ve taze bir FlatList mount edilir. Her MessageBubble mount'ta Animated.spring giriş çalıştıran MessageBubbleFrame ile sarılı olduğundan (satır 1510-1519), görünür tüm bubble'lar aynı anda yeniden mount olup fade/slide-in'lerini tekrar oynatır. Onboarding intro EmptyState'te (custom bubble) vs listede MessageBubble olarak farklı stillenmiş, dolayısıyla görünür şekilde sıçrar.

**Etki:** Her yeni chat/onboarding'in ilk yanıtına geçiş flicker yapar: tüm görünüm takas olur, intro bubble yeniden stillenir/sıçrar ve önceki bubble'lar yeniden animasyon yapar. Düzgün ekleme yerine glitch gibi okunur. Tamamen kozmetik ve tek seferlik.

**Kanıt:**
```jsx
{messages.length <= 1 && !sending ? (
  <EmptyState ... />
) : (
  <View style={{ flex: 1 }}>
    <FlatList ref={listRef} ... />
// MessageBubbleFrame: useEffect(() => { Animated.spring(anim,{toValue:1,...}).start(); }, [anim]);
```

**Öneri:** En az bir gerçek mesaj olduğunda her zaman FlatList render edin ve boş/öneri affordance'ını ListHeader/ListEmptyComponent veya overlay olarak render edin; böylece mesaj konteyneri mesajlar büyürken mount tipini değiştirmez.

---

### [LOW] UI-CHT-04 — Yalnızca tek kullanıcı mesajı olan oturum hiçbir şey render etmiyor — kullanıcının mesajı görünmez

**Dosya:** `app/chat/[sessionId].tsx:1064-1070, 1414-1428`

**Sorun:** `messages.length <= 1` iken ekran mesaj listesi yerine EmptyState gösterir. EmptyState yalnızca `messages.length === 1 && messages[0].role === 'assistant'` iken bir mesaj bubble'ı render eder (satır 1414). Bir oturum tam olarak bir kalıcı mesajla (role:'user') yüklenirse (örn. asistan yanıtı sunucu tarafında kalıcı olamadı), bu kullanıcı mesajı düşürülür: EmptyState genel 'Kochko ile konuş' başlığı ve örnek-başlatıcı chip'lerini gösterir. Loader'ın else-dalı (satır 471-473) length===1 için setMessages(data) yapar, bu durum ulaşılabilir.

**Etki:** Böyle bir oturumu yeniden açan kullanıcı, gönderdiği gerçek mesajı hiçbir yerde görünmeyen boş bir 'yeni chat başlat' ekranı görür; veri kaybı gibi görünür. (Nadir köşe: kalıcı asistan yanıtı olmayan kalıcı kullanıcı mesajı + oturumu yeniden açma gerektirir; bu yüzden LOW.)

**Kanıt:**
```jsx
{messages.length <= 1 && !sending ? ( <EmptyState messages={messages} .../> ) : ( ...FlatList... )}
// EmptyState: {messages.length === 1 && messages[0].role === 'assistant' && ( <bubble .../> )}  // lone user mesajı için dal yok
```

**Öneri:** messages herhangi bir gerçek (non-[SYSTEM_INIT]) mesaj içerdiğinde sayıdan bağımsız FlatList render edin, veya EmptyState'i tek kullanıcı mesajını da render edecek şekilde genişletin. Boş/öneri UI'sını 'length <= 1' yerine 'sıfır gerçek mesaj'a bağlayın.

---

### [LOW] UI-CHT-06 — withDateSeparators ve macro/target nesneleri her render'da yeniden hesaplanıyor — tüm bubble'lar her dashboard/klavye state değişiminde yeniden render oluyor

**Dosya:** `app/chat/[sessionId].tsx:1075, 919, 922-932, 1080`

**Sorun:** FlatList data'sı her render'da inline `withDateSeparators(messages.filter(...))` ile hesaplanır, her geçişte yepyeni array/nesne kimlikleri üretir. `dashboardMacros` (919) ve `macroTargets` (922-932) de her render'da yeni nesne literali olarak yeniden oluşturulur ve React.memo ile sarılmamış her MessageBubble'a geçirilir. Ekran birçok ilgisiz state değişiminde (keyboardVisible, her 1sn tıklayan rateLimitCountdown, dashboard store toplamları) yeniden render olur. Giriş animasyonları ref kullandığından tekrar oynamaz (flicker yok), ama 50 mesajlık geçmişle bu israf iş.

**Etki:** Uzun konuşmada gereksiz CPU; rate-limit geri sayımı saniyede bir tıkladıkça tüm mesaj listesi saniyede bir yeniden render olur. Düşük-uçlu Android'de bozulmuş akıcılık/kaydırma, ama yanlış çıktı yok.

**Kanıt:**
```jsx
data={withDateSeparators(messages.filter(m => !(m.role === 'user' && m.content.startsWith('[SYSTEM_INIT]'))))}
const dashboardMacros = { protein: totalProtein, carbs: totalCarbs, fat: totalFat };
const macroTargets = (() => { ... return { protein: ..., carbs: ..., fat: ... }; })();  // her render'da yeni nesne
```

**Öneri:** Ayraç-satır listesini `useMemo([messages])` ile, dashboardMacros/macroTargets'ı useMemo ile memoize edin; MessageBubble'ı React.memo ile sarın ve stabil (useCallback) handler'lar geçirin.

---

### [LOW] UI-PLN-02 — Öğün/gün kalori & makro sayıları yuvarlamasız render ediliyor — LLM ondalıkları '487.5 kcal', 'P32.5' olarak görünüyor

**Dosya:** `src/components/plan/MealCard.tsx:99-104` (+ FullPlanModal.tsx:167, PlanActiveView.tsx:255)

**Sorun:** MealCard meal.total_kcal/protein/carbs/fat'i `Math.round`/`toFixed` olmadan doğrudan basar. Bu değerler ham LLM-yazımlı JSON (plan.service.ts'te `number` tiplenmiş) ve LLM rutin olarak tam-olmayan değerler yayar (total_protein: 32.5, total_kcal: 487.3). computeDayTotals da yuvarlamadan toplar. Aynı yuvarlanmamış değerler FullPlanModal gün başlığında (167), PlanActiveView'da (255) gösterilir; PlanPreviewCard avgKcal yuvarlı ama makro satırı `P {targets.protein}g` ham.

**Etki:** Plan UI'sı boyunca kalori/makro figürleri uzun ondalıklar gösterebilir ('P31.99 · K45.2 · Y12.85', '1843.7 kcal'), bozuk/cilasız görünür ve kaloriler tamsayı olan uygulamanın geri kalanıyla tutarsız. Tamamen kozmetik ve LLM'in ondalık yaymasına bağlı; bu yüzden LOW.

**Kanıt:**
```jsx
<Text style={{ ... fontWeight: '700' }}>{meal.total_kcal} kcal</Text>
<Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>
  P{meal.total_protein} · K{meal.total_carbs} · Y{meal.total_fat}
</Text>
```

**Öneri:** Render'da yuvarlayın: `{Math.round(meal.total_kcal)} kcal` ve `P{Math.round(meal.total_protein)} · K{Math.round(meal.total_carbs)} · Y{Math.round(meal.total_fat)}`. Aynısını FullPlanModal.tsx:167, PlanActiveView.tsx:255, PlanPreviewCard makro hedeflerine ve per-meal item kcal'a (MealCard.tsx:131) uygulayın.

---

### [LOW] UI-PLN-05 — AlternativeComparisonModal LLM day_index aralık dışıyken antrenman gün etiketinde 'undefined' render ediyor

**Dosya:** `src/components/plan/AlternativeComparisonModal.tsx:140-144`

**Sorun:** WorkoutSummary haftalık-bölünme satırlarını `{DAY_LABELS_TR[d.day_index]}: {d.focus ...}` ile map'ler. DAY_LABELS_TR'de 7 giriş var (index 0-6). Candidate plan ham LLM JSON (bileşen bunu kendi yorumunda kabul ediyor) ve burada d.day_index üzerinde clamp/guard yok. LLM 7+ bir day_index veya çöp index yayarsa `DAY_LABELS_TR[d.day_index]` undefined olur ve satır literal 'undefined: Push' render eder. Diyet tarafı güvenli (day_label kullanır), yalnızca antrenman tarafı day_index ile indeksler.

**Etki:** Bir alternatif antrenman candidate'ında aralık-dışı/bozuk day_index, karşılaştırma modalında görünür 'undefined: ...' satırı üretir — kullanıcının iki plan arasında seçim yaptığı yüzey. Yalnızca bozuk LLM çıktısında tetiklenir; bu yüzden LOW.

**Kanıt:**
```jsx
{active.slice(0, 4).map((d, i) => (
  <Text key={i} ... numberOfLines={1}>
    • {DAY_LABELS_TR[d.day_index]}: {d.focus ?? `${d.exercises?.length ?? 0} egzersiz`}
  </Text>
))}
```

**Öneri:** Etiketi fallback'leyin: `{DAY_LABELS_TR[d.day_index] ?? d.day_label ?? \`Gün ${d.day_index + 1}\`}` ve egzersizi olmayan günleri yok sayın.

---

### [LOW] UI-PLN-06 — Plan gün kartları LLM-temininli day_index ile key'leniyor — çift index React key çakışması/yanlış render üretir

**Dosya:** `src/components/plan/FullPlanModal.tsx:143` (+ PlanActiveView.tsx:236, PlanPreviewCard.tsx:36/75, history.tsx)

**Sorun:** Plan UI'sı boyunca gün kartları ham LLM-yazımlı `day.day_index` ile key'lenir. plan_data ham LLM JSON ve bu bileşenler zaten `Array.isArray(days)` ile defansif guard yapar (snapshot'ın bozuk olabileceğini kabul eder). Model aynı day_index'li iki gün yayarsa (gerçekçi bir generation glitch), React çift key render eder, uyarı loglar ve expand/collapse state'i (FullPlanModal expandedDay/expandedMeal ve PlanActiveView'da day.day_index ile anahtarlı) yanlış günü toggle eder.

**Etki:** Çift day_index'li bozuk snapshot'ta bir güne dokunmak başka bir günü açar/kapatır ve React'in reconciliation'ı bir kartı düşürebilir/çoğaltabilir. Birincil plan-görüntüleme yüzeylerinde bozulmuş ama kurtarılabilir UX.

**Kanıt:**
```jsx
{(Array.isArray(plan.days) ? plan.days : []).map(day => {
  const isOpen = expandedDay === day.day_index;
  return (
    <View key={day.day_index} style={{ marginBottom: SPACING.md }}>
```

**Öneri:** Güvenilmeyen alan yerine dizi konumuyla key'leyin: gün listesi için map index'i `key={i}` (veya `${day.day_index}-${i}`), meals/exercises'in zaten index ile key'lendiği gibi. Not: expand-state day_index'e bağlı olduğundan tam düzeltme için expanded-day takibini de dizi index'ine taşıyın.

---

### [LOW] UI-STA-06 — Kart üstü küçük vurgu-renkli metinler (error/fat/pink/purple/protein) AA-küçük eşiğinin altında

**Dosya:** `app/(tabs)/progress.tsx:512`

**Sorun:** Tema vurgu renklerinin çoğu `card`/`cardElevated`/`surfaceLight` (#1A1A24/#22222E) üstünde 3:1–4.5:1 aralığında kalır (ölçüldü: error 4.39/4.00, fat 4.46/4.06, pink 4.39/3.99, purple 4.59/4.18, protein 4.80/4.37). Bu değerler büyük metin için AA'yı geçer ama küçük (≤13px normal) metin için 4.5:1 eşiğini geçmez. progress.tsx:512'deki kilo deltası somut örnek: `fontSize: FONT.xs` (11px) ve `color: delta <= 0 ? colors.success : colors.error` — error (#E24B4A) card üstünde 4.39:1, AA-küçük altında. Benzer örnekler reports/daily.tsx MacroCircle etiketlerinde ve çeşitli FONT.xs durum etiketlerinde tekrarlanır.

**Etki:** Az gören/parlak ortam koşullarında bu küçük renkli sayı ve etiketler zor okunur. Tek tek küçük etki ama sistemsel olduğundan toplamda erişilebilirlik kalitesini düşürür.

**Kanıt:**
```jsx
{delta != null && <Text style={{ fontSize: FONT.xs, fontWeight: '700', marginTop: 1, color: delta <= 0 ? colors.success : colors.error }}>...</Text>}
// ölçüm: error(#E24B4A) on card(#1A1A24)=4.39:1, on surfaceLight(#22222E)=4.00:1 → 11px için AA(4.5) FAIL
```

**Öneri:** Küçük (≤13px, normal/bold) vurgu-renkli metinlerde font'u büyütüp daha açık vurgu tonları kullanın (error için kart üstünde ≥4.5:1 veren açık varyant), veya sayıları text/textSecondary renginde verip vurguyu ikon/rozetle taşıyın.

---

### Elenen Bulgular (INVALID / gerçek değil)

- **UI-PR-03** (ToggleRow knob beyaz-üstüne-beyaz) — INVALID. ToggleRow statik DARK_COLORS kullanır (OFF track '#22222E', beyaz değil) ve light tema runtime'da erişilemez (theme.tsx'te 'Yakında'/disabled, _layout yalnızca 'dark' honor eder). Tarif edilen beyaz-üstüne-beyaz knob hiçbir ulaşılabilir durumda oluşamaz; cited 'fix' sibling de dark-only runtime'da no-op.
- **UI-TAB-04** (Dashboard ActivityTimeline ham kalori) — INVALID. `meal_log_items.calories` SMALLINT NOT NULL (migration 002), ondalık tutamaz; Math.round no-op olur. Hiçbir kullanıcı-görünür ondalık render olamaz.


---

## UX — Kullanıcı Deneyimi & Akışlar

### Özet

| Severity | Adet |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 27 |
| LOW | 11 |
| **Toplam (onaylanan)** | **42** |
| Elenen (INVALID / isReal=false) | 2 |

**Tema özeti:** Bu boyutun baskın kalıbı *"sessiz başarı / sessiz başarısızlık"* — yıkıcı aksiyonlar (dashboard silme, faz silme, undo) onay/haptik/geri-al olmadan tamamlanıyor; istemci tarafı (offline kuyruğu, mesaj sayacı, premium kontrolü) sunucunun otoriter durumundan kopuk çalışıyor ve kullanıcıya yanlış güvence/yanlış limit gösteriyor; KVKK onayı tüm kayıt yollarını kapatmıyor; ve birkaç temel ekran (grafikler, toggle'lar, form alanları) ekran okuyuculara erişilemez durumda. Elenen 2 bulgu (UX-CHT-03, UX-PRM-01), kod şekli var olsa da gerçek bir üretim yolundan tetiklenemediği için INVALID işaretlendi.

> Not: Adversarial doğrulama sonucunda hiçbir CRITICAL bulgu ayakta kalmadı. UX-PRM-01 (CRITICAL iddiası) ve UX-CHT-03 (HIGH iddiası) reproduce edilemediği için elendi; UX-FBK-01 (CRITICAL iddiası) HIGH'a düşürüldü.

---

## HIGH

### [HIGH] UX-ONB-01 — Login ekranındaki sosyal kayıt, KVKK / Kullanım Koşulları onayı gösterilmeden yepyeni hesap oluşturuyor

**Dosya:** `app/(auth)/login.tsx:69-77`

**Sorun:** Login ekranı, register ekranıyla birebir aynı `signInWithGoogle()` / `signInWithApple()` akışını çağıran "Google ile Giriş Yap" / "Apple ile Giriş Yap" butonlarını gösteriyor. İlk defa giren bir kullanıcı için OAuth ile giriş şeffaf biçimde **yeni hesap oluşturur** (Supabase `auth.users` satırını otomatik açar + `handle_new_user` trigger'ı profili yaratır — migration 001:100-110). Oysa `register.tsx:88-109` onay metnini "tüm kayıt yollarının üstünde" gösterirken, login.tsx'te hiçbir KVKK/Koşullar onayı yok (`Kullanım Koşulları|Gizlilik|KVKK|kabul|TERMS_URL|PRIVACY_URL` grep'i 0 eşleşme).

**Etki:** Yeni bir kullanıcı, Kullanım Koşulları'nı ve KVKK aydınlatma metnini hiç görmeden tam olarak kayıt olabilir (ve 7 günlük denemeyi başlatabilir). Bu, KVKK açık-rıza beklentisi açısından bir uyum boşluğu ve ekranlar arası tutarsızlık: aynı hesap-yaratan aksiyon bir ekranda onay isterken diğerinde istemiyor. İki ekran da aynı OAuth butonlarını sunduğu için register.tsx'in "her kayıt yolunda onay" garantisi bozuluyor.

**Kanıt:**
```tsx
// login.tsx — hiçbir onay metni yok
<Button title="Google ile Giriş Yap" onPress={handleGoogle} loading={loading} variant="outline" size="lg" />
<Button title="Apple ile Giriş Yap" onPress={handleApple} ... />

// register.tsx:88-109 — onay tüm kayıt yollarının üstünde
<Text>Kayıt olarak <Text onPress={()=>openLink(TERMS_URL)}>Kullanım Koşulları</Text>'nı ve
  <Text onPress={()=>openLink(PRIVACY_URL)}>Gizlilik Politikası</Text>'nı kabul edersin.</Text>
```

**Öneri:** login.tsx'te sosyal-giriş butonlarının üstüne register.tsx ile aynı onay satırını (Koşullar + Gizlilik linkleriyle) ekleyin VEYA ilk-defa OAuth kullanıcılarını profil oluşturmadan önce açık bir onay kapısından geçirin. Her hesap-yaratan yolda onayın görünmesi için register.tsx ile tutarlı tutun.

---

### [HIGH] UX-NAV-01 — Yeniden onboarding girişi navigasyon tuzağı: geri butonu yok, swipe-back kapalı, tek çıkış kullanıcının hedef/profilini yıkıcı biçimde yeniden yazıyor

**Dosya:** `app/(tabs)/index.tsx:278` + `app/_layout.tsx:94` + `app/onboarding.tsx:103/322/246-264`

**Sorun:** 6+ ay ara veren kullanıcılar (`returnStatus.needsReOnboarding===true`, `src/services/return-flow.service.ts:99-107`) dashboard'da `router.push('/onboarding?mode=re_onboarding')` yapan bir "Güncelleme yap" butonu görür. Onboarding rotası root Stack'te `gestureEnabled:false` ve `headerShown:false` ile tanımlı (`app/_layout.tsx:94`), ekranda hiçbir geri/iptal/atla-uygulamaya affordance'ı yok ve `useLocalSearchParams` hiç okunmadığı için `mode=re_onboarding` parametresi tamamen yok sayılıyor — tam ilk-çalıştırma akışı (3 karşılama slaytı + zorunlu QuickForm) render ediliyor. Tek çıkış formu tamamen doldurmak; `handleComplete` mevcut aktif hedefi pasifleştirip yeni 12 haftalık hedef ekliyor ve TDEE/kalori/makro alanlarını üzerine yazıyor. Ek olarak hardware BackHandler de yok ve `app/index.tsx`'in onboarding yönlendirme kapısı doğrudan push edilen `/onboarding` rotasını korumuyor.

**Etki:** Normal bir dashboard butonuyla ulaşılabilen kullanıcı, geri navigasyonu olmayan tam ekran bir akışta kilitleniyor. Tek kaçış yolu tamamlamayı zorluyor, bu da mevcut hedefini sessizce yok ediyor ve profil hedeflerini yeniden yazıyor. Hem "geri dönülemeyen ekran" hem de "zorla çıkışta veri mutasyonu" kusuru; uzun süre uzakta kalmış her geri dönen kullanıcıyı vuruyor.

**Kanıt:**
```tsx
// app/(tabs)/index.tsx:278
onPress={() => router.push('/onboarding?mode=re_onboarding')}
// app/_layout.tsx:94
<Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
// app/onboarding.tsx (useLocalSearchParams yok; tek çıkış:)
246  await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
253  const { error: goalError } = await supabase.from('goals').insert({ ... target_weeks: 12, ... is_active: true });
322  router.replace('/(tabs)/chat');
```

**Öneri:** (a) OnboardingScreen'e bir geri/"Şimdi değil" kontrolü ekleyin ve re_onboarding modunda `gestureEnabled`'ı yeniden açın, VEYA (b) `mode` parametresini okuyup yeniden-onboarding'i hafif, iptal edilebilir bir güncelleme akışına (header geri butonlu bir ayarlar ekranı gibi) yönlendirin. En azından zaten-onboard olmuş kullanıcılar için `gestureEnabled:false`/`headerShown:false` onboarding rotasını push etmeyin.

---

### [HIGH] UX-FBK-01 — Dashboard öğün/antrenman uzun-basışı onay, haptik veya geri-al olmadan anında siliyor

**Dosya:** `src/components/dashboard/ActivityTimeline.tsx:123-132`

**Sorun:** Dashboard'ın ana aktivite listesi (bugünkü öğünler + antrenmanlar) yıkıcı silmeyi doğrudan `onLongPress`'e bağlıyor. Uzun basış hiçbir `Alert.alert` onayı, hiçbir haptik (ne öncesinde uyarı ne sonrasında başarı) ve hiçbir geri-al olmadan anında `onDeleteMeal`/`onDeleteWorkout` çağırıyor. Uzun-basışın sildiğine dair görünür bir affordance veya erişilebilirlik ipucu da yok. `deleteWorkout` (`src/stores/dashboard.store.ts:223-227`) **hard delete** (`supabase.delete()`) olduğu için kazara bir uzun basış, kayıtlı antrenmanı UI'da kurtarma yolu olmadan kalıcı olarak yok ediyor.

**Etki:** Yoğun trafikli bir ekranda kazara veri kaybı. Parmak dinlenirken/kaydırırken bir öğün veya antrenman satırı uyarısız yok oluyor. Uygulamanın diğer tüm silme akışlarıyla (recipes uzun-basış = Alert onay + haptik; multi-phase-goals = Alert onay; chat öğün/antrenman kayıtları 10 sn'lik geri-al penceresi) tutarsız. Başarıda haptik olmaması, gerçek silmeyi yanlış-dokunuştan ayırt edilemez kılıyor. (Not: öğün yolu `is_deleted` ile soft-delete olduğundan DB düzeyinde geri alınabilir; yalnızca antrenman yolu gerçek hard-delete — bu yüzden CRITICAL'den HIGH'a düşürüldü.)

**Kanıt:**
```tsx
onLongPress={async () => {
  try {
    await (activity.type === 'meal' ? onDeleteMeal(activity.id) : onDeleteWorkout(activity.id));
  } catch {
    Alert.alert('Silinemedi', 'Bir şeyler ters gitti, lütfen tekrar dene.');
  }
}}
// dashboard.store.ts deleteWorkout = hard delete:
//   const { error } = await supabase.from('workout_logs').delete().eq('id', workoutId);
```

**Öneri:** Silmeyi recipes.tsx/multi-phase-goals ile eşleşen bir `Alert.alert` onayının arkasına alın; onay açıldığında `haptics.warning()`, silme çözüldükten sonra `haptics.success()` çalıştırın ve bir geri-al (öğün zaten `is_deleted` ile soft-delete, "Geri al" snackbar'ı kolay) sunun. En azından bir `accessibilityHint` ve onay adımı ekleyin ki uzun basış sessizce veri yok edemesin.

---

### [HIGH] UX-FBK-02 — Bildirim ayar toggle'ları, OS izni reddedildiğinde sessizce hiçbir şey yapmıyor (izin UX'i yok)

**Dosya:** `app/settings/notifications.tsx:37-63`

**Sorun:** Bildirim tercih toggle'ları (ana açma, tür-bazlı, günlük limit, sessiz saatler) yalnızca DB'ye yazıp `scheduleLocalNotifications` çağırıyor. Hiçbir zaman `Notifications.getPermissionsAsync()` kontrol etmiyor, izni yeniden istemiyor ve app/ içinde `Linking.openSettings` deep-link'i yok (`openSettings/requestNotificationPermission` grep'i app/ üzerinde 0 eşleşme). OS izni yalnızca açılışta bir kez isteniyor (`src/services/app-init.service.ts:22` → `initializeNotifications`). Kullanıcı sistem isteminde reddetmişse (veya temiz kurulumda hiç vermemişse) buradaki "Bildirimler Açık"ı açmak toggle'ı teal yapıyor ama OS izni reddedildiği için hiçbir bildirim atılamıyor. Banner, "izin gerekli" durumu ve iOS/Android Ayarlar'a giden yol yok.

**Etki:** Sistem istemini reddetmiş bir kullanıcı bildirimlerin AÇIK olduğunu sanıyor (toggle yeşil) ama hiçbir şey almıyor, nedenini ve nasıl düzelteceğini gösteren hiçbir işaret yok. Tüm bildirim özelliği için "hiçbir şey olmamış gibi görünen başarı" kusuru; "İzin Verme"ye bir kez basmış her kullanıcı için hatırlatıcıları sessizce bozuyor.

**Kanıt:**
```tsx
const toggleMain = () => {
  haptics.tap();
  const updated = { ...prefs, enabled: !prefs.enabled };
  setPrefs(updated);
  if (userId) updateNotificationPrefs(userId, updated);
};
// Ekranda getPermissionsAsync / requestPermissionsAsync / Linking.openSettings yok.
```

**Öneri:** Ekrana girişte (ve ana switch açılırken) `Notifications.getPermissionsAsync()` çağırın; verilmemişse satır-içi uyarı banner'ı ve "Bildirim iznini aç" butonu gösterin — `undetermined` ise `requestPermissionsAsync()`, `denied` ise `Linking.openSettings()`. UI'da yalnızca DB tercihini değil gerçek OS izin durumunu yansıtın.

---

## MEDIUM

### [MEDIUM] UX-ONB-02 — Onboarding, seçilen hedef yönüyle çelişen bir hedef kilo kabul ediyor (kilo verme + hedef > mevcut, vb.)

**Dosya:** `app/onboarding.tsx:205-264`

**Sorun:** QuickForm yalnızca alan varlığını doğruluyor (`isValid`, satır 207), tutarlılığı değil. "Kilo Vermek" seçen biri mevcuttan YÜKSEK hedef kilo girebilir (mevcut 70, hedef 90); "Kas Kazanmak" mevcuttan düşük alabilir. `handleComplete`, haftalık tempoyu `Math.abs(w - targetWeight)` (satır 251) ile hesapladığı için çelişkiyi sessizce yutuyor ve `goal_type` ile `target_weight_kg`'nin uyuşmadığı bir hedef satırı ekliyor. goals tablosunda (migration 001/019/043/057) bunu yakalayan yön/aralık CHECK kısıtı yok. `validateWeeklyRate()` tdee.ts'te mevcut ama onboarding'den hiç çağrılmıyor. `calculateTargets` (tdee.ts:82-99) açığı yalnızca `goalType`'tan türetir ve `target_weight_kg`'yi okumaz; dolayısıyla lose_weight hedefi yine açık planı üretip kullanıcıyı imkânsız hedeften uzağa iter.

**Etki:** Kullanıcının ilk hedefi içsel olarak tutarsız oluyor. Aşağı akıştaki GoalProgress, AI planlayıcı ve kalori hedefleme yanlış tempo/ETA ve kullanıcıyı imkânsız hedeften daha da uzağa iten bir açık planı gösterir — fitness uygulaması için yanlış-veri/bozuk-ilk-deneyim. (Zarar yarıçapı sınırlı: kullanıcının aktif olarak çelişkili değer girmesini gerektirir ve Math.abs tempoyu 1.0 kg/hafta sınırı içinde tutar; bu yüzden MEDIUM.)

**Kanıt:**
```tsx
// satır 207 — yalnızca varlık kontrolü
const isValid = heightCm && weightKg && gender && goalType && activity && (!needsTargetWeight || targetWeightKg) && (!needsBirthYear || birthYear);
// satır 250-251 — abs() çelişkiyi gizliyor
const weeklyRate = (needsTargetWeight && targetWeight !== w)
  ? Math.min(1.0, Math.round((Math.abs(w - targetWeight) / 12) * 100) / 100)
  : 0.5;
```

**Öneri:** Hedef eklemeden önce yönü doğrulayın: lose_weight için `targetWeight < weight`, gain_muscle/gain_weight için `targetWeight > weight`; aksi halde satır-içi hata (mevcut `missingLabel` UX'ini yeniden kullanarak) gösterip engelleyin. Savunma amaçlı DB CHECK kısıtı opsiyonel.

---

### [MEDIUM] UX-ONB-03 — Boy, kilo veya hedef kiloda aralık/akıl-sağlığı doğrulaması yok — absürt değerler kalıcılaşıp TDEE'yi zehirliyor

**Dosya:** `app/onboarding.tsx:207, 278-307`

**Sorun:** Boy (`parseInt`), kilo ve hedef kilo (`parseFloat`) hiçbir min/max sınırı olmadan kabul ediliyor. DB sütunları çok geniş (`height_cm SMALLINT` 32767'ye kadar, `weight_kg DECIMAL(5,2)` 999.99'a kadar — migration 001:10-11) ve istemci-tarafı clamp yok. Boy '17' (170 yerine) veya kilo '8' (80 yerine) gibi bir hata doğrudan `calculateBMR`/`calculateTDEE`'ye (satır 286-292) akıp profile kullanıcının kalori aralıkları ve haftalık bütçesi olarak yazılıyor. tdee.ts'teki kat (floor) yalnızca kalori min'ini korur, absürt boy/kilo girişini değil.

**Etki:** En önemli onboarding ekranındaki tek bir yazım hatası, çöp bir TDEE ve tüm ilk planı ve dashboard halkalarını süren kalori hedefleri üretiyor. Giriş tarafında güvenlik katı olmadığı için kullanıcının ilk deneyimi sessizce ve kötü biçimde yanlış olabilir, hiçbir uyarı vermeden.

**Kanıt:**
```tsx
const heightNum = parseInt(heightCm);
...
const bmr = calculateBMR(w, heightNum, age, gender as Gender);
const tdee = calculateTDEE(bmr, activity as ActivityLevel);
// Hiçbir yerde sınır yok; isValid (satır 207) yalnızca varlık kontrolü.
```

**Öneri:** `handleComplete` ilerlemeden önce sınırlı doğrulama ekleyin: ör. boy 100–230 cm, kilo 30–300 kg, hedef makul bir bant içinde; satır-içi mesajla reddedin. Doğum yılı için zaten kullanılan 18+ koruma kalıbını (satır 224-236) aynalayın.

---

### [MEDIUM] UX-OFF-01 — Offline chat mesajları kuyruğa alınmadan atılıyor — tüm chat offline-kuyruğu ölü kod

**Dosya:** `app/chat/[sessionId].tsx:564-567`; `src/services/chat.service.ts:295-340`

**Sorun:** chat.service.ts tam bir offline-kuyruk API'si (`queueMessageOffline()`, `processOfflineQueue()`, `getOfflineQueueSize()`, `@kochko_chat_offline_queue` destekli) export ediyor ama hiçbirinin app/ veya src/ içinde çağıranı yok (grep ile doğrulandı). Canlı gönderim yolu `handleSend()` ise offline iken: `if (!isOnline) { Alert.alert('İnternet yok', ...); return; }` yapıyor. Yani offline iken yazılan mesaj ne kuyruğa alınıyor ne de bağlantı dönünce yeniden gönderiliyor.

**Etki:** Reklamı yapılan bir dayanıklılık özelliği (offline mesaj kuyruklama, Spec 11) çalışmıyor. (Kayıp tamamen sessiz değil — kullanıcı açık bir "İnternet yok" uyarısı görür ve yazdığı metin composer'da kalır, bu yüzden HIGH değil MEDIUM. Asıl kusur ölü kuyruk API'si + yeniden-bağlanınca otomatik gönderim olmaması.)

**Kanıt:**
```tsx
// [sessionId].tsx:564
if (!isOnline) {
  Alert.alert('İnternet yok', 'Bağlı olduğundan emin olup tekrar dene.');
  return;
}
// chat.service.ts:295/304 — queueMessageOffline / processOfflineQueue tanımlı ama çağıran yok
```

**Öneri:** Ya `queueMessageOffline()`'ı `handleSend()`'in offline dalına bağlayın (sadece uyarmak yerine metni kuyruğa alın) ve yeniden-bağlanınca `processOfflineQueue()` çağırın, ya da ölü kuyruk fonksiyonlarını silip uyarı metnini dürüstleştirin. `processOfflineQueue`'nin UX-OFF-02'deki slice hatası bağlanmadan önce düzeltilmelidir.

---

### [MEDIUM] UX-OFF-02 — processOfflineQueue başarısız mesajları düşürüp başarılı olanları yeniden gönderiyor (slice kimlik değil sayı kullanıyor)

**Dosya:** `src/services/chat.service.ts:304-329 (özellikle 312-322)`

**Sorun:** `processOfflineQueue` tüm kuyruğu dolaşır, hatasız dönen her mesaj için `sent`'i artırır, sonra `queue.slice(sent)` ile öğeleri kaldırır. `slice(sent)` İLK `sent` öğeyi konuma göre düşürür — hangilerinin gerçekten başarılı olduğuyla ilişkisiz. msg[0] başarısız, msg[1]/msg[2] başarılıysa → sent=2 → slice(2) yalnızca msg[2]'yi tutar: başarısız msg[0] kaybedilir, zaten başarılı msg[1] düşürülür ve msg[2] yeniden gönderilip duplicate üretir.

**Etki:** Kısmi senkronizasyonda (bağlantı dalgalıyken yaygın durum) kullanıcılar başarısız mesajları sessizce kaybeder ve başarılı olanların duplicate gönderimini alır. (Şu an gizli, çünkü fonksiyonun çağıranı yok — UX-OFF-01; kuyruk bağlandığı an gerçek veri-kaybı/duplicate hatası olur, bu yüzden MEDIUM.)

**Kanıt:**
```ts
312  for (const msg of queue) {
313    const { error } = msg.targetDate ? await sendMessageForDate(...) : await sendMessage(msg.text);
316    if (!error) sent++;
317  }
320  if (sent > 0) {
321    const remaining = queue.slice(sent);
322    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
323  }
```

**Öneri:** Hangi mesajların başarılı olduğunu sayıyla değil kimlikle takip edin. `const remaining = queue.filter((_, i) => !succeededIndexes.has(i))` kurun (veya başarısız mesajları yeni bir diziye push edin) ve onu kalıcılaştırın; böylece yalnızca gerçekten başarısız olanlar tutulur ve başarılılar tam bir kez kaldırılır.

---

### [MEDIUM] UX-OFF-03 — Quick-log yazımları (su/kilo/vb.) offline iken sessizce başarısız olup kaybediliyor, OfflineBanner senkronize olacaklarını vaat etmesine rağmen

**Dosya:** `src/stores/dashboard.store.ts:194-205`; `src/components/common/OfflineBanner.tsx:65-67`

**Sorun:** `addWater()` (ve `deleteMeal`, `deleteWorkout`) ağ kontrolü ve yapılandırılmış offline kuyruğuna ekleme olmadan doğrudan Supabase'e yazıyor. Offline iken `supabase.upsert` reddediyor, `addWater` throw atıyor ve dashboard handler'ı (`app/(tabs)/index.tsx:134-138`) "Su kaydedilemedi. Lütfen tekrar deneyin." gösteriyor — artış kaybediliyor, hiçbir şey kuyruğa alınmıyor. `offline-queue.service.ts` `enqueue()` (bir `water_log` türü olan) tam bunun için var ama uygulama genelinde 0 çağıranı var. `setupAutoSync` mount edilmiş (index.tsx:118) ama kuyruğu hiç doldurulmuyor.

**Etki:** Offline iken +su (veya bir öğün/antrenman silme) yapan kullanıcılar aksiyonu kaybeder. (Kayıp sessiz değil — açık bir hata uyarısı çıkar; OfflineBanner metni de bir FIX yorumuyla yapılandırılmış kuyruğun bağlı olmadığını kabul ediyor. Çekirdek kusur — offline dashboard mutasyonlarının kuyruğa alınmaması — geçerli, bu yüzden MEDIUM.)

**Kanıt:**
```ts
// dashboard.store.ts:199
const { error } = await supabase.from('daily_metrics').upsert({ user_id: userId, date, water_liters: newTotal, synced: true }, { onConflict: 'user_id,date' });
203  if (error) throw error;
// index.tsx:137  Alert.alert('Hata', 'Su kaydedilemedi. Lütfen tekrar deneyin.');
// enqueue() → yalnızca tanım (offline-queue.service.ts:78), çağıran yok
```

**Öneri:** Dashboard mutasyonlarını offline iken `offline-queue.service.enqueue()` üzerinden yönlendirin (ve yeniden-bağlanınca `setupAutoSync` ile işleyin), VEYA banner metnini chat-dışı loglar için otomatik devam vaadini bırakacak şekilde değiştirin.

---

### [MEDIUM] UX-OFF-04 — Uykuda kullanıcılar (30+ gün hareketsiz) budanmış oturum satırı "uzaktan sonlandırıldı" sayıldığı için otomatik çıkış yapılıyor

**Dosya:** `src/services/realtime-sync.service.ts:189-198`; `src/services/app-init.service.ts:77-86`; `supabase/migrations/024_user_sessions.sql:32-35`

**Sorun:** `isSessionStillValid()` yerel önbellekteki `SESSION_ID_KEY`'i okuyup o id için `user_sessions`'ı sorgular; satır yoksa `false` döner ve `useAppStateSync()` `false`'u "başka cihaz bizi sonlandırdı" sayıp `signOut()` çağırır. Ancak prune cron'u `last_active_at < NOW() - INTERVAL '30 days'` satırlarını siliyor ve yerel `SESSION_ID_KEY` hiç temizlenmiyor (yalnızca realtime-sync.service.ts'te referanslanıyor, signOut onu temizlemiyor). 30+ gün uygulamayı açmayan kullanıcının satırı budanır; sonraki foreground'da önbellekteki id çözülmez, `false` döner ve kullanıcı sessizce çıkış yaptırılır.

**Etki:** Geri dönen uykuda kullanıcılar beklenmedik biçimde çıkış yaptırılır; "temizlik nedeniyle oturum bitti" ile "bu cihaz başka cihazdan atıldı" güvenlik özelliği birbirine karışır. Uygulamanın geri kazanmak istediği kullanıcılar için kötü bir yeniden-etkileşim deneyimi.

**Kanıt:**
```ts
realtime-sync.service.ts:193  const { data } = await supabase.from('user_sessions').select('id').eq('id', id).maybeSingle();
194  return !!data;
app-init.service.ts:80  if (!valid) { await useAuthStore.getState().signOut(); }
024_user_sessions.sql:35  DELETE FROM user_sessions WHERE last_active_at < NOW() - INTERVAL '30 days';
```

**Öneri:** "Hareketsizlikten budandı"yı "başka cihaz aktif olarak sildi"den ayırın — satır yoksa çıkış yapmak yerine yeni bir oturum yeniden kaydedin ve eski `SESSION_ID_KEY`'i temizleyin.

---

### [MEDIUM] UX-OFF-05 — Gerçek zamanlı çoklu-cihaz senkronu (Spec 14) hiç aktive edilmiyor; değişiklikler canlı yayılmıyor; resolveConflict/forceSync ölü

**Dosya:** `src/services/realtime-sync.service.ts:35-61, 114-129, 235-258, 97`

**Sorun:** realtime-sync.service.ts Supabase Realtime abonelikleri, `forceSync` çekmesi, çakışma çözücü ve senkron-durum makinesi uygular. Grep, `subscribeToChanges`, `forceSync`, `getSyncState` ve yereldeki `resolveConflict`'in hiçbir yerde (app/ veya src/) çağıranı olmadığını gösteriyor — yalnızca kendi tanımları. Sadece oturum-yönetimi yardımcıları (registerSession/heartbeatSession/isSessionStillValid/getActiveSessions/terminateSession) gerçekten kullanılıyor.

**Etki:** Belgelenmiş bir özellik (Spec 14 "çoklu cihaz desteği — gerçek zamanlı senkronizasyon") atıl. Çoklu-cihaz kullanıcıları manuel ekran yenilemesine kadar bayat veri görür. Veri kaybı değil ama kod/spec iddiası ile gerçekte gönderilen arasında gerçek bir boşluk.

**Kanıt:**
```ts
realtime-sync.service.ts:35  export function subscribeToChanges(userId, onChange): void { ... }
realtime-sync.service.ts:235 export async function forceSync(userId): Promise<...> { ... }
// grep 'subscribeToChanges|forceSync|getSyncState' app/+src → yalnızca tanımlar, dış çağıran yok
```

**Öneri:** Ya `subscribeToChanges()`'i auth + ekran mount'ta bağlayın (unmount'ta sökün) ve foreground'da `forceSync()` çağırın, ya da ölü senkron makinesini kaldırıp çoklu-cihaz iddiasını yalnızca oturum yönetimine daraltın. (Not: bu dosyadaki `resolveConflict` ölü; ancak ayrı bir `resolveConflict` — conflict-resolver.service'ten — offline-queue.service.ts:17 tarafından kullanılıyor.)

---

### [MEDIUM] UX-OFF-06 — Yapılandırılmış offline kuyruk su/kilo/uyku/ruh hali loglarını kaybeder: eşlenmemiş türler onConflict olmadan upsert ediliyor

**Dosya:** `src/services/offline-queue.service.ts:27, 162-168, 183-191`

**Sorun:** `QueuedAction.type` `water_log | weight_log | sleep_log | mood_log` izin verir ve bunlar `daily_metrics` tabanlıdır (kullanıcı+tarih başına tek satır). Ama `mapActionTypeToSyncType` yalnızca meal/workout/supplement/profile eşler ve diğerleri için `null` döner. `syncQueue`'de `null` dataType son `else` dalına düşer ve `supabase.from(table).upsert({...action.data})`'i **onConflict olmadan** yapar. `daily_metrics`'in (user_id,date üzerinde benzersiz) bir satırı tarihe göre çözemediği için insert dener ve benzersizlik ihlaline çarpar; öğe başarısız sayılıp sonsuza dek tutulur.

**Etki:** Yapılandırılmış kuyruk gerçekten bağlandığında (bkz. UX-OFF-03) her offline su/kilo/uyku/ruh hali girişi kalıcı olarak senkronize olamaz (veya duplicate olur), sessizce. (Şu an gizli, çünkü `enqueue()`'nun çağıranı yok — bu yüzden MEDIUM.)

**Kanıt:**
```ts
183  function mapActionTypeToSyncType(actionType) { switch (actionType) {
185    case 'meal_log': return 'meal_log';
189    default: return null; } }
166  const { error } = await supabase.from(action.table).upsert(hasSynced ? { ...action.data, synced: true } : { ...action.data });
```

**Öneri:** `water_log/weight_log/sleep_log/mood_log`'u `mapActionTypeToSyncType`'ta `'daily_metrics'`'e eşleyin (tarih-duyarlı `onConflict:'user_id,date'` dalını alsın) veya `else` dalına tablo başına açık `onConflict` verin. Bir `water_log` round-trip testi ekleyin.

---

### [MEDIUM] UX-FRM-01 — edit-profile: Türkçe virgüllü ondalıklar doğrulamayı geçiyor ama kaydederken sessizce kırpılıyor (ondalık kaybı)

**Dosya:** `app/settings/edit-profile.tsx:139, 146, 186-191`

**Sorun:** Satır-içi doğrulayıcı `rangeError()` virgülü ayrıştırmadan önce normalize ediyor — `Number(val.replace(',', '.'))` (satır 139) — yani "80,5" GEÇERLİ sayılır. Ama kaydetme eşlemesi (`handleSave`, satır 166-191) ham, normalize edilmemiş dizgiyi ayrıştırıyor: `weight_kg: weightKg ? parseFloat(weightKg) : null`. `parseFloat("80,5")` virgülde durup 80 döner. tr-TR Android'de decimal-pad ondalık ayraç olarak virgül üretir, dolayısıyla bu hedef kitle için VARSAYILAN yol. Her ondalık alan (kilo, yağ %, kas %, bel/kalça/göğüs/uyluk cm) kesir kısmını sessizce düşürür.

**Etki:** Kullanıcı 80,5 kg girer, doğrulama kabul eder ama 80 kalıcılaşır — yanlış vücut ağırlığı TDEE/kalori hedeflerini, hedef ilerlemesini ve BMI'yi besler. Yazılan ile saklanan arasındaki uyumsuzluk görünmez. (Hata sınırlı: yalnızca kesir kısmı düşer, en fazla <1 birim; bu yüzden MEDIUM.)

**Kanıt:**
```tsx
// doğrulayıcı normalize ediyor:
const n = Number(val.replace(',', '.'));
// kaydetme etmiyor:
weight_kg: weightKg ? parseFloat(weightKg) : null,
body_fat_pct: bodyFat ? parseFloat(bodyFat) : null,
waist_cm: waist ? parseFloat(waist) : null,   // parseFloat("85,5") === 85
```

**Öneri:** Kaydetme eşlemesinde virgülü doğrulayıcıyla aynı şekilde normalize edin: `parseFloat(weightKg.replace(',', '.'))`. Daha iyisi: tek bir `parseNum(v) = Number(v.replace(',', '.'))` yardımcısı çıkarıp hem `rangeError`'da hem `handleSave`'de kullanın, böylece doğrulama ile kalıcılaştırma asla ayrışamaz.

---

### [MEDIUM] UX-FRM-02 — goals: hedef kilo çıplak parseFloat ile ayrıştırılıyor — Türkçe virgül HEM güvenlik kontrolünü HEM kaydedilen hedefi bozuyor

**Dosya:** `app/settings/goals.tsx:124, 136, 149, 268`

**Sorun:** "Hedef Kilo (kg)" alanı `keyboardType="decimal-pad"` (satır 268) ama değerin her tüketicisi çıplak `parseFloat(targetWeight)` ile ayrıştırıyor ve virgül normalizasyonu YOK: haftalık-tempo gösterimi (124), agresif-hedef efekti (136) ve `handleSave` (149 `const tw = parseFloat(targetWeight)`). tr-TR Android'de decimal-pad virgül üretir, "70,5" → 70. edit-profile'ın aksine burada normalize eden bir doğrulayıcı bile yok; bozuk değer hem `validateWeeklyRate`'e hem `addPhase`'e gider.

**Etki:** Kullanıcının hedef kilosu ondalığı sessizce düşürülmüş saklanır (70,5 → 70). Aynı kırpılmış sayı `validateWeeklyRate`/`checkAggressiveGoal`'a beslendiği için güvenlik uyarıları da yanlış sayıya göre hesaplanır. Kalıcı hedef plan üretimini, tempo grafiğini ve ilerleme %'sini sürer. (Bozulma sınırlı kesir kaybı, bu yüzden MEDIUM.)

**Kanıt:**
```tsx
const tw = parseFloat(targetWeight);   // .replace(',', '.') yok — "70,5" -> 70
<Input label="Hedef Kilo (kg)" ... value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" />
```

**Öneri:** Bir kez normalize edin: `const tw = parseFloat(targetWeight.replace(',', '.'))` ve aynı tek değeri tempo gösterimi, agresif kontrol ve `handleSave` için tekrar kullanın. Makul bir aralık (ör. 30–300 kg) ipucu/koruması ekleyin.

---

### [MEDIUM] UX-FRM-04 — login & register ham İngilizce Supabase auth hatalarını gösteriyor; istemci-tarafı e-posta format doğrulaması yok

**Dosya:** `app/(auth)/login.tsx:17-21, 42-48`

**Sorun:** Her iki auth ekranı yalnızca alanların boş olmadığını kontrol edip (`!email.trim()`) Supabase hatasını doğrudan geçiriyor: `if (error) Alert.alert('Hata', error)`. Store `error?.message`'i olduğu gibi döner. Supabase auth mesajları İngilizce — ör. "Invalid login credentials", "User already registered", "Unable to validate email address: invalid format". İstemci-tarafı e-posta format kontrolü olmadığı için hatalı bir e-posta sunucuya ulaşıp Türkçe-tek-dil bir kitleye İngilizce hata döner.

**Etki:** Uygulamanın en yoğun iki formu rutin hatalarda (yanlış şifre, mevcut hesap, hatalı e-posta) çevrilmemiş İngilizce hata dizgileri gösteriyor. Türkçe bir uygulama için kafa karıştırıcı ve marka-dışı; kullanıcı yazım hatasını gerçek arızadan ayırt edemiyor.

**Kanıt:**
```tsx
const handleLogin = async () => {
  if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'E-posta ve şifre gerekli.'); return; }
  const { error } = await signIn(email.trim(), password);
  if (error) Alert.alert('Hata', error);   // 'error' ham İngilizce Supabase mesajı
  else router.replace('/');
};
```

**Öneri:** Store'u çağırmadan önce temel bir e-posta regex kontrolü ekleyip Türkçe satır-içi hata gösterin. Yaygın Supabase auth kodlarını/mesajlarını Türkçe metne eşleyen tek bir yardımcı yazın (invalid credentials → "E-posta veya şifre hatalı", user already registered → "Bu e-posta zaten kayıtlı", invalid email → "Geçerli bir e-posta gir") ve her iki ekranda kullanın.

---

### [MEDIUM] UX-CHT-01 — Canlı chat geri bildirimi (İşe yaradı / Bana göre değil) mevcut-oturum yanıtları için context_id daima null olduğundan satır içinde sakatlanıyor

**Dosya:** `app/chat/[sessionId].tsx:1778-1781`; `src/services/feedback.service.ts:22-27`

**Sorun:** `FeedbackButtons`, `contextId={message.id}` ile render ediliyor. Mevcut oturumda canlı üretilen her asistan mesajı için `message.id`, `a-${Date.now()}` biçiminde istemci-üretimi UUID-olmayan bir dizgi. `feedback.service.submitFeedback`, UUID olmayan herhangi bir `contextId`'yi insert'ten önce `null`'a zorluyor (`UUID_RE.test`, satır 23). Edge fonksiyonu kalıcılaştırılan `chat_messages` UUID'sini döndürmediği için istemci gerçek bir id ekleyemiyor. Sonuç: yeni alınan bir koç yanıtına verilen geri bildirim `context_id = null` ile saklanıyor.

**Etki:** Geri bildirim TAMAMEN atılmıyor — satır `user_id` + `context_type` + değerle eklenir, yani toplam ("hangi mesaj-türü işe yarıyor") sinyali korunur; kaybedilen yalnızca mesaj başına bağlantı. Bu yüzden HIGH iddiası MEDIUM'a düşürülmüştür.

**Kanıt:**
```tsx
// [sessionId].tsx ~690
const reply: UIMessage = { id: `a-${Date.now()}`, role: 'assistant', ... };
// [sessionId].tsx:1778  <FeedbackButtons contextType={...} contextId={message.id} />
// feedback.service.ts:22-27
const safeContextId = contextId && UUID_RE.test(contextId) ? contextId : null;
await supabase.from('ai_feedback').insert({ user_id, context_type, context_id: safeContextId, feedback });
```

**Öneri:** Edge fonksiyonu kalıcılaştırılan satırın id'sini `ChatResponse`'ta döndürsün ve istemci bunu `UIMessage`'a yazsın; sonra o UUID'yi `contextId` olarak geçirin. Alternatif olarak `session_id` + sunucu-tarafı sıra numarası geçirin. En azından UUID olmayan `contextId`'yi bir text sütununda saklayın ya da `session_id` dahil edin.

---

### [MEDIUM] UX-CHT-02 — Undo ("Geri Al") ateşle-ve-unut çalışıyor, geri bildirim yok — kullanıcı kaydın gerçekten kaldırılıp kaldırılmadığını anlayamıyor

**Dosya:** `app/chat/[sessionId].tsx:1203-1221 (onPress 1206-1210)`

**Sorun:** 10 saniyelik undo banner'ının `onPress`'i banner'ı temizleyip (`setUndoAction(null)`) `await sendMessageToSession(sessionId, undoText)` yapıyor — ama sonuç tamamen atılıyor. `sending`/typing durumu set edilmiyor, ne kullanıcı ne asistan baloncuğu eklenmiyor ve `{data, error}` dönüşü yok sayılıyor. "Geri Al"a basınca banner kaybolur ve görünür olarak başka HİÇBİR ŞEY olmaz: onay yok, typing göstergesi yok, hata yok. Undo ayrıca LLM'in serbest metni doğru yorumlayıp bir delete aksiyonu üretmesine bağlı.

**Etki:** Güvenlik-ilişkili bir aksiyonda (yanlış loglanmış öğün/takviye kaldırma) veri-bütünlüğü/güven kusuru. Kullanıcı girişin gittiğine inanır; gerçekte günün toplamlarında kalmış olabilir. (Undo yine de sunucuya ulaşır ve model bir delete üretince satırı kaldırır — eksik olan UI geri bildirimi/onay/hata gösterimi; bu yüzden MEDIUM.)

**Kanıt:**
```tsx
onPress={async () => {
  const undoText = `Son ${undoAction.type === 'meal_log' ? 'ogun' : ...} kaydini geri al`;
  setUndoAction(null);
  await sendMessageToSession(sessionId, undoText);  // sonuç atılıyor, UI geri bildirimi yok
}}
```

**Öneri:** Undo'yu normal gönderim yoluyla aynı şekilde yönlendirin: `sending` set edin, typing göstergesi gösterin, AI yanıt baloncuğunu ekleyin, dashboard'ı yenileyin ve `{error}` dönerse (veya delete aksiyonu gelmezse) bir hata durumu gösterin. Banner sessizce kaybolmadan önce silmenin başarılı olduğunu doğrulayın.

---

### [MEDIUM] UX-CHT-04 — Quick-select / confirm-reject / persona / ask-why aksiyon handler'larında uçuş-içi koruma yok — hızlı dokunuşlar çift-gönderiyor

**Dosya:** `app/chat/[sessionId].tsx:786-830, 935-975, 1206-1210`; `src/components/chat/RichMessage.tsx:11, 98`

**Sorun:** Ana composer gönderimi (`handleSend`) `if (sending) return` (satır 562) ile korunuyor. Satır-içi aksiyon göndericileri korunmuyor: `handleQuickSelect`, `handleAskWhy` ve undo handler'ı `sendMessageToSession`'ı `if (sending) return` ve debounce olmadan çağırıyor. `QuickSelectButtons` ve `ConfirmRejectButtons` bileşenleri gönderim sırasında devre dışı bırakılmıyor. "Onayla", bir quick-select seçeneği veya "Doğru"/"Yanlış"a çift-dokunmak iki eşzamanlı `sendMessageToSession` çağrısı ateşler.

**Etki:** Yinelenen AI turları ve daha kötüsü, başıboş bir çift-dokunuştan yinelenen yan-etkili aksiyonlar (çift log / çift delete). Kafa karıştırıcı, iki neredeyse-aynı yanıtlı transcript.

**Kanıt:**
```tsx
const handleQuickSelect = useCallback((option, displayLabel) => {
  haptics.tap();
  setTimeout(async () => {
    setMessages(prev => [...prev, userMsg]);
    setSending(true);   // sending koruması yok
    const { data, error } = await sendMessageToSession(sessionId, option);
// RichMessage.tsx — chip'ler sending/disabled durumu taşımıyor
export function ConfirmRejectButtons({ onConfirm, onReject, ... }) { /* daima etkin */ }
```

**Öneri:** `handleQuickSelect`, `handleAskWhy` ve undo `onPress`'in başına `if (sending) return;` ekleyin. `sending` true iken `QuickSelectButtons`/`ConfirmRejectButtons`'ı (ve satır-içi neden chip'lerini) composer'ın `sendDisabled` davranışını aynalayarak devre dışı bırakın.

---

### [MEDIUM] UX-CHT-05 — Ücretsiz-kademe "mesaj hakkı kaldı" rozeti kayıyor: yalnızca düz metin gönderimleri azaltıyor; foto/chip/undo/ask-why ve sunucunun otoriter sayısı hiç uzlaştırılmıyor

**Dosya:** `app/chat/[sessionId].tsx:591-603, 786-830, 935-975, 1206-1210`; `src/services/chat.service.ts:30-33`

**Sorun:** `incrementAndCheck` yalnızca düz-metin composer yolunda VE yalnızca `if (text && !photo)` (satır 591) çağrılıyor. Foto gönderimleri, quick-select chip'leri, plan confirm/reject, düşük-güven doğrulama, persona confirm/reject, ask-why ve undo sunucuya ulaşıp sunucu-tarafı günlük kotayı tüketiyor ama yerel AsyncStorage sayacına dokunmuyor. `ChatResponse` bir sunucu `remaining` alanı taşıyor (satır 32) ama istemci uzlaştırmak için okumuyor.

**Etki:** Ücretsiz kullanıcılar için yanıltıcı kota gösterimi; rate-limit cooldown'ı rozete göre "birden bire" çıkıyor. Yükseltme isteminin güvenilirliğini zedeliyor.

**Kanıt:**
```tsx
if (text && !photo) {
  const counterResult = await incrementAndCheck(isPremium);
  setRemainingMsgs(counterResult.remaining);
}
// chat.service.ts: export interface ChatResponse { ...; rate_limited?: boolean; remaining?: number; }
// hiçbir yerde setRemainingMsgs(data.remaining) yok
```

**Öneri:** Her başarılı gönderimden sonra (metin, foto ve tüm chip/aksiyon yolları) `ChatResponse`'tan `data.remaining` okuyup `setRemainingMsgs(data.remaining)` çağırın. Sunucu sayısını gerçeğin kaynağı kabul edin ve gösterim için yalnızca yerel iyimser sayaca güvenmeyi bırakın.

---

### [MEDIUM] UX-CHT-06 — Uzun konuşmalar "daha eski yükle" affordance'ı olmadan en yeni 50 mesaja sessizce kırpılıyor

**Dosya:** `src/services/chat.service.ts:476-491`; `app/chat/[sessionId].tsx:436`

**Sorun:** `loadSessionMessages` yalnızca en yeni 50 mesajı çekiyor (azalan + limit 50, sonra ters çevrilir). Chat ekranı bunu mount'ta tam bir kez çağırıyor ve hiç sayfalama yapmıyor — "daha eski mesajları yükle" kontrolü, yukarı kaydır-getir veya geçmişin kesildiğine dair gösterge yok. 50'yi aşan oturumlarda (günlük-koçluk uygulaması için olası) tüm eski bağlam resume'da sessizce kaybolur.

**Etki:** Kullanıcılar daha eski koçluk geçmişine görünür erişimi, var olduğuna dair hiçbir ipucu olmadan kaybeder. Bağlam-kalıcılığı belirtilen bir çekirdek değer; bu, etkin kullanıcılar için onu sessizce ihlal ediyor.

**Kanıt:**
```ts
export async function loadSessionMessages(sessionId, limit = 50) {
  const { data } = await supabase.from('chat_messages').select(...).eq('session_id', sessionId).order('created_at', { ascending: false }).limit(limit);
  return ((data as ChatMessage[]) ?? []).reverse();
}
// [sessionId].tsx — bir kez yüklenir, sayfalama yok
```

**Öneri:** Yukarı sayfalama ekleyin: kullanıcı en üste yakın kaydırınca sonraki sayfayı (`created_at < oldest loaded`) getirin. Opsiyonel olarak 50 satır döndüğünde ince bir "Daha eski mesajları yükle" başlık satırı gösterin.

---

### [MEDIUM] UX-PRM-02 — İstemci kapı sunucunun muaf tuttuğu kayıt-parse loglarını sayıyor — yoğun loglayanlar yanlış "limit doldu" kilidine takılıyor

**Dosya:** `app/chat/[sessionId].tsx:591-602`; `supabase/functions/shared/rate-limit.ts:108-133`

**Sorun:** `incrementAndCheck` TÜM metin mesajları için `isRecordParse` ayrımı olmadan çağrılıyor. Sunucu kayıt-parse (öğün/antrenman/su/uyku/kilo logları) mesajlarını 50/gün konuşma kapısından kasten muaf tutuyor (`FREE_RECORD_PARSE_DAILY=120`). Yani chat üzerinden yemek/su loglayan ücretsiz kullanıcı yerel 50-mesaj hakkını loglarla yakıyor, sonra istemci "Mesaj Limiti" uyarısını atıp göndermeyi reddediyor — sunucu hâlâ kabul edecekken. Servisin kendi başlık yorumu "kayıt parse'ları sayılmaz" diyor ama kod bunu uygulamıyor.

**Etki:** Chat üzerinden öğün/su loglayan (amaçlanan birincil loglama yolu) aktif ücretsiz kullanıcılara yanlışlıkla günlük limite ulaştıkları söylenir ve göndermeleri engellenir — backend hâlâ izin verirken. (Tetik >50 yerel-gün mesajı gerektirdiği için nadir ve ertesi gün sıfırlanır; bu yüzden MEDIUM.)

**Kanıt:**
```ts
// message-counter.service.ts:5  '* Ücretsiz plan: ... (kayıt parse'ları sayılmaz)' — ama incrementAndCheck yalnızca isPremium alır
// rate-limit.ts:113  if (isRecordParse) { ... return { allowed: true, remaining: -1 }; }  // loglar sunucuda muaf
```

**Öneri:** Ya (a) ayrı istemci sayacını sürdürmeyi bırakıp sunucunun `remaining` değerini yüzeye çıkarın, ya da (b) tespit edilen task-mode/record-parse bayrağını `incrementAndCheck`'e geçirip kayıt-parse mesajlarını saymayı atlayın — sunucuyla eşleşsin.

---

### [MEDIUM] UX-PRM-03 — Chat premium kontrolü premium_expires_at'i yok sayıyor — diğer tüm kapılar ona uyuyor (iki yönlü sınır sızıntısı)

**Dosya:** `app/chat/[sessionId].tsx:347`

**Sorun:** Chat ekranı `const isPremium = !!(profile)?.premium;` türetiyor — ham boolean, her yerde kullanılan süre-duyarlı `isActivePremium()` değil (premium-gate.ts:63, usePremium.ts:17, server premium.ts:13, rate-limit.ts:97). Kod tabanı `profiles.premium`'in cron grace penceresi sırasında `premium_expires_at`'ten ~1-2 gün sonra true kaldığını açıkça belgeliyor. Süresi-dolmuş-premium kullanıcı chat istemcisinde premium muamelesi görür (sınır yok, sınırsız gönderim); ama sunucunun `checkRateLimit`'i `isActivePremium` kullanıp ona ÜCRETSİZ 50/gün kapısını verir.

**Etki:** Chat'te tutarsız ücretsiz/premium sınırı: süresi-dolmuş-premium kullanıcı istemci-tarafında premium (sınırsız) deneyimi görür ama sunucu-tarafında sessizce kısılır; açıklanamayan, sürpriz bir cooldown üretir. Tersine yerel sayaç ve uyarılar bastırıldığından sunucu engellemeye başlamadan önce hiç ön-uyarı almaz.

**Kanıt:**
```tsx
// app/chat/[sessionId].tsx:347
const isPremium = !!(profile as Record<string, unknown> | null)?.premium;
// premium-gate.ts:63 isActivePremium(): if (!profile?.premium) return false; const exp = profile.premium_expires_at; return !exp || new Date(exp) > new Date();
```

**Öneri:** `!!(profile)?.premium`'i `isActivePremium(profile)` ile değiştirin (`@/lib/premium-gate`'ten) ki chat sınır UI'ı sunucuyla ve uygulamanın geri kalanıyla eşleşsin.

---

### [MEDIUM] UX-PRM-04 — Yeni ücretli aylık abone "Premium Aktif" yerine "deneme bitiyor" ekranını görüyor

**Dosya:** `src/hooks/usePremium.ts:23-31`; `app/settings/premium.tsx:175-214`

**Sorun:** `usePremium` `isInTrial`'i tamamen zamanlamadan türetiyor: `isActive && premiumExpiresAt != null && daysSinceSignup < 7`. Abonelik kademesini/durumunu hiç sorgulamıyor. Ücretli aylık abone de `premium_expires_at` set'lidir (+30g) ve kayıttan sonraki 7 gün içinde abone olursa (yaygın durum) `daysSinceSignup < 7` true olur, `isInTrial` true olur. premium.tsx o zaman zaten ödeme yapmış bir kullanıcı için "Deneme Süresi" ekranını ("Deneme süren 30 gün sonra bitiyor", "Aboneliğe Geç") render eder.

**Etki:** İlk haftasındaki ödeme yapan müşteriye, bitmek üzere olan bir ücretsiz denemede olduğu söylenir ve tekrar abone olması istenir. Güveni ve satın almanın değerini zedeler; erken abonelere "Premium Aktif" onay ekranı hiç gösterilmez. (Şu an gizli: çalışan bir satın alma yolu yok — bkz. UX-PRM-08 — bu yüzden gerçek bir +30g aylık abone yalnızca manuel/admin webhook ile var olabilir; MEDIUM.)

**Kanıt:**
```ts
usePremium.ts:26  const isInTrial = isActive && premiumExpiresAt != null && daysSinceSignup < 7;
premium.tsx:175  if (isInTrial) { ... 'Deneme süren {trialDaysLeft} gün sonra bitiyor' ... <Button title="Aboneliğe Geç" ... }
```

**Öneri:** Deneme durumunu `daysSinceSignup<7` sezgisinden değil gerçek abonelikten (subscriptions tablosu tier/status) türetin. En azından ~7 günlük pencere (deneme uzunluğuna uygun) kullanın ve denemeyi ücretliden ayırmak için tier'ı tercih edin.

---

### [MEDIUM] UX-PRM-05 — Foto chat mesajları istemci kapısını atlıyor ama sunucu-tarafında sayılıyor — kapı paydasında sessiz ayrışma

**Dosya:** `app/chat/[sessionId].tsx:591`; `supabase/functions/shared/rate-limit.ts:142-150`

**Sorun:** İstemci sayacı yalnızca `if (text && !photo)` çalışıyor — yalnızca-foto (ve metin+foto) gönderimleri yerel 50 kapıya hiç sayılmıyor. Ama sunucu yerel-gün başlangıcından beri TÜM `role='user'` `chat_messages`'ı (foto dahil) sayıyor (satır 142). Ağırlıkla foto ile öğün loglayan ücretsiz kullanıcı istemcide bol kalan mesaj görürken sunucu bağımsız olarak 50 kapıya yaklaşır/ulaşır; açıklanamayan sunucu cooldown'ları üretir, ön "X mesaj hakkı kaldı" uyarısı olmadan.

**Etki:** Foto-ağırlıklı kullanıcılar için ücretsiz-kademe kalan-mesaj UX'i güvenilmez: kapıdan önce uyarı yok, sonra sürpriz sunucu kısıtlaması. İstemci-gösterilen kalan sayısı sunucunun uyguladığına göre yanlış.

**Kanıt:**
```ts
// app/chat/[sessionId].tsx:591  if (text && !photo) { ... }  // foto yolu sayacı tamamen atlar
// rate-limit.ts:142  .from('chat_messages').select('*',{count:'exact',head:true}).eq('role','user').gte('created_at', dayStart)
```

**Öneri:** İstemci kalan-mesaj göstergesini sunucunun döndürdüğü `remaining` değerini okuyarak otoriter hale getirin; foto ve log mesajlarını atlayan ayrışan bir yerel sayaç sürdürmek yerine.

---

### [MEDIUM] UX-PRM-06 — Premium-yalnız özellik ekranlarında ekran-içi kapı sıfır — kapı tamamen ayarlar menüsü korumasına dayanıyor

**Dosya:** `app/settings/index.tsx:104-156` (tek kapı); hedef ekranlar (recipes, strength, challenges, progress-photos, periodic-state, multi-phase-goals, meal-prep-plan)

**Sorun:** Premium özelliklerin ayarlar satırları yalnızca menünün `isPremium ? push(...) : gated(...)` üçlüsüyle korunuyor. Hedef ekranların kendisinde HİÇBİR premium kontrolü yok (bu dosyalarda premium/gate grep'i boş). Bunlara başka herhangi bir yol (chat `navigate_to` ipucu, deep link veya ekran açıkken biten deneme) ücretsiz kullanıcının özelliği kapısız kullanmasına izin verir. Birkaçı yalnızca RLS-sahipli veri okur/yazar, sunucu-tarafı premium uygulaması olmadan (weekly-menu ve health-export'un aksine, ki onlar sunucuda korunur).

**Etki:** Ayarlar menüsü dışındaki herhangi bir yolla bu ekranlara ulaşan kullanıcılar için premium sınırları sızar. Premium özellikler arası tutarsız uygulama (bazısı sunucu-korumalı, bazısı değil) ücretsiz/premium çizgisini gözenekli ve merkezi-olmayan kılar.

**Kanıt:**
```tsx
// Tek kapı settings/index.tsx:122
onPress={isPremium ? () => router.push('/settings/recipes') : gated('/settings/recipes', 'Tarif Kütüphanesi')}
// Hedef ekranlarda 'premium|Premium|gate|locked' grep'i → eşleşme yok
```

**Öneri:** Her premium-yalnız ekranın başına bir `usePremium`/`useFeatureAccess` koruması ekleyin (izin yoksa `/settings/premium`'e yönlendir), böylece kapı tek bir navigasyon noktasının değil özelliğin bir özelliği olur. Mutasyona uğrayan backend etkisi olan özellikler için weekly-menu/health-export gibi sunucu-tarafında da uygulayın.

---

### [MEDIUM] UX-FBK-03 — Başarısız bildirim-tercih kaydı başarıyla aynı görünüyor (boolean dönüş yok sayılıyor, iyimser toggle kalıyor)

**Dosya:** `app/settings/notifications.tsx:37-63`

**Sorun:** `updateNotificationPrefs` boolean döner ve DB yazımı başarısızsa `false` döner (`src/services/notifications.service.ts:157-160`). Bu ekrandaki her çağrı yeri (toggleType, toggleMain, persist, updateQuiet) yerel durumu iyimser set edip `updateNotificationPrefs`'i await ETMEDEN ve dönüş değerini incelemeden ateşliyor. Başarısız kayıtta toggle ekranda dönmüş kalır, kullanıcı `haptics.tap()` (başarı-hissi) alır ve hiçbir şey geri alınmaz veya uyarmaz.

**Etki:** Bildirim ayarı değiştirilirken bir ağ/DB hatası UI'da hiç kalıcılaşmamış bir durum gösterir. Sonraki yüklemede sessizce geri döner, kullanıcıyı şaşırtır ve bu arada hatırlatıcılar bayat tercihlere göre planlanır. Hiçbir hata geri bildirimi yok.

**Kanıt:**
```tsx
const toggleType = (key: string) => {
  haptics.tap();
  const updated = { ...prefs, types };
  setPrefs(updated);
  if (userId) updateNotificationPrefs(userId, updated); // dönüş değeri (hata=false) yok sayılıyor
};
// servis: if (error) { console.error(...); return false; }
```

**Öneri:** `updateNotificationPrefs` sonucunu await edin; `false` dönerse iyimser `setPrefs`'i geri alıp bir hata (Alert veya satır-içi banner) + `haptics.error()` gösterin. Boolean'ı tasarlandığı kalıcılaştırma sinyali olarak ele alın.

---

### [MEDIUM] UX-FBK-04 — Faz silme hem başarıda HEM başarısızlıkta tamamen sessiz (haptik yok, toast yok, hata yutuluyor)

**Dosya:** `app/settings/multi-phase-goals.tsx:59-64`

**Sorun:** `handleDelete` Alert ile onaylar, sonra `deletePhase(id)`'yi await ETMEDEN ve ardından `load()` çağırır, `haptics.success()` ve başarı mesajı YOK. `deletePhase` (`src/services/goals.service.ts:130-133`) kendi hatasını yakalayıp yalnızca `console.error()` yapar, void döner. Silme başarısız olursa (ör. aktif fazda RLS/FK) kullanıcı `load()` sonrası satırın yeniden belirdiğini sıfır açıklamayla görür; başarılı olursa da onay yoktur. Bu, uygulamadaki her iki yolda da geri bildirimi olmayan tek silme.

**Etki:** Tutarsız, sessiz yıkıcı aksiyon. Başarısız bir faz silme başarılı olandan ayırt edilemez ve başarılı olan onay vermez. Uygulamanın aksi halde tutarlı silme-geri bildirimi kalıbını bozar.

**Kanıt:**
```tsx
const handleDelete = (id: string) => {
  Alert.alert('Sil', 'Bu fazı silmek istediğine emin misin?', [
    { text: 'İptal' },
    { text: 'Sil', style: 'destructive', onPress: () => { deletePhase(id); load(); } }, // await/haptik/geri-bildirim yok
  ]);
};
// goals.service.ts: if (error) console.error('deletePhase error:', error.message); // yutuluyor, void döner
```

**Öneri:** `deletePhase` hatasını döndürsün/throw etsin, sonra `handleDelete`'te try/catch içinde await edin: başarıda `haptics.success()` (opsiyonel toast), başarısızlıkta `haptics.error()` + `Alert.alert('Silinemedi', ...)`. recipes.tsx kalıbını aynalayın. (Not: önceki bir audit fix görünür bir çöp-kovası butonu ekledi ama aynı sessiz `handleDelete`'e yönlendiriyor; bu kusur etkilenmiyor.)

---

### [MEDIUM] UX-FBK-05 — Faz ekle / faz ilerlet, Button onPress içinde yeniden throw edip kullanıcı geri bildirimi olmadan yakalanmamış reddetme üretiyor

**Dosya:** `app/settings/multi-phase-goals.tsx:45-83`

**Sorun:** `handleAdd` ve `handleAdvance` catch bloklarında `haptics.error()` ateşleyip `throw e` yapıyor. Her ikisi de doğrudan Button `onPress` handler'ı olarak bağlı (satır 168 "Faz Ekle"; satır 147 "Sonraki Faza Geç"). Async bir `onPress`'ten gelen throw, yakalanmamış bir promise reddetmesi olur — hiçbir Alert/toast yüzeye çıkmaz. Başarısızlıkta kullanıcı yalnızca bir haptik titreşim alır ve mesaj görmez; `handleAdd` için ekleme formu da açıklamasız açık kalır.

**Etki:** Hedef fazı eklemek veya ilerletmek başarısız olduğunda kullanıcı bir hata titreşimi hisseder ama mesaj görmez ve tekrar denemek için yönlendirme almaz. Hata gösterilmek yerine yakalanmamış reddetmeye kaybedilir. (Reddetme telemetri için global handler'ca yakalanıyor ama kullanıcıya-yönelik geri bildirim sıfır.)

**Kanıt:**
```tsx
try { await addPhase(...); }
catch (e) { haptics.error(); throw e; }   // Button onPress'te yakalanmaz, Alert yok
// handleAdvance aynı `haptics.error(); throw e;` kalıbını kullanır.
```

**Öneri:** `throw e`'yi kullanıcıya-yönelik `Alert.alert('İşlem başarısız', ...)` ile değiştirin (`haptics.error()`'ı koruyarak) ve return edin; böylece başarısızlıklar runtime'a yutulmak yerine iletilir.

---

### [MEDIUM] UX-A11-01 — Kilo/ilerleme LineChart'ları ekran okuyuculara tamamen sessiz

**Dosya:** `src/components/reports/ProgressChart.tsx:71-96`; `src/components/plan/TempoChart.tsx:83-107`

**Sorun:** Her iki veri-görselleştirme bileşeni react-native-chart-kit `<LineChart>`'ı erişilebilirlik sarmalayıcısı, `accessibilityLabel` veya çizilen seri için metin alternatifi olmadan render ediyor. Grafik, kullanıcının kilo trendini (ProgressChart, monthly.tsx'te) ve planlanan-vs-gerçek tempoyu (TempoChart) gördüğü birincil yol. Kütüphane etiketsiz SVG `<Path>`/`<Circle>` düğümleri yayar; VoiceOver/TalkBack anlamlı hiçbir şey okumaz. Aynı kod tabanında halka/skor görselleri erişilebilir düğümlere sarılı (CircularProgress, ComplianceScore, DeviationTag), bu yüzden bu iki grafik tutarsız bir boşluk.

**Etki:** Bir ekran okuyucu kullanıcısı kilo yörüngesini veya hedef temposunda olup olmadığını hiç algılayamaz. WCAG 1.1.1'i (metin-olmayan içerik) uygulamanın temel veri görselleştirmesi için başarısız kılar. (ProgressChart zaten metinsel min/son/maks başlığı render ediyor, yani anahtar sayılar okunur — yalnızca trend ŞEKLİ kaybolur; bu yüzden MEDIUM.)

**Kanıt:**
```tsx
ProgressChart.tsx:71  <LineChart data={{ labels, datasets:[...] }} ... bezier ... />  // grafikte accessibilityLabel/sarmalayıcı yok
TempoChart.tsx:83  <LineChart data={{ ..., legend:['Planlanan','Gerceklesen'] }} ... />  // benzer şekilde a11y sarmalayıcısı yok
```

**Öneri:** Her grafiği `accessibilityRole='image'` (veya 'text') ve seriyi özetleyen üretilmiş bir `accessibilityLabel` içeren bir View'a sarın — ProgressChart: `En düşük ${min}, son ${last}, en yüksek ${max} ${unit}; ${data.length} ölçüm`; TempoChart: planlanan-vs-gerçek + ETA cümlesi. Grafiğin kendi SVG'sini `accessible={false}` işaretleyin (CircularProgress'in zaten yaptığı gibi).

---

### [MEDIUM] UX-A11-02 — Özel ToggleRow switch'i hiçbir rol/etiket/durum açığa çıkarmıyor — açık-kapalı yalnızca renk+konum

**Dosya:** `src/components/settings/ToggleRow.tsx:16-37`

**Sorun:** ToggleRow elle-yapılmış bir switch'i `accessibilityRole`, `accessibilityLabel` ve `accessibilityState` OLMADAN düz bir TouchableOpacity olarak render ediyor. Açık/kapalı durum yalnızca görsel olarak iletiliyor (backgroundColor primary vs surfaceLight + knob alignSelf). Ekran okuyucuya satır yalnızca etiket metnini duyurur, bunun bir toggle olduğunu veya açık/kapalı olduğunu belirtmez. menstrual.tsx, coach-sharing.tsx ve notifications.tsx'te kullanılan yeniden-kullanılabilir toggle bu. Erişilebilirlik kütüphanesi bir `a11ySwitch(label, isOn)` yardımcısı içeriyor ama bu bileşen onu kullanmıyor.

**Etki:** ToggleRow kullanan ayar ekranlarındaki ekran okuyucu kullanıcıları bir kontrolün switch olduğunu veya mevcut durumunu okuyamaz ve yalnızca renge güvenemez (WCAG 1.4.1 ve 4.1.2 başarısız). Ayarları (bildirim/koç-paylaşımı/menstrual) sonuç durumuna kör biçimde değiştirebilirler.

**Kanıt:**
```tsx
export function ToggleRow({ label, description, value, onToggle }: Props) {
  return (
    <TouchableOpacity onPress={() => onToggle(!value)} style={{...}}>
      ... <View style={{ ... backgroundColor: value ? COLORS.primary : COLORS.surfaceLight ...}}>
      // hiçbir accessibilityRole / accessibilityLabel / accessibilityState yok
```

**Öneri:** Mevcut `a11ySwitch(label, value)` yardımcısını (veya `accessibilityRole='switch'`, `accessibilityLabel={label}`, `accessibilityState={{ checked: value }}`) TouchableOpacity'ye yayın. Opsiyonel olarak description'ı etikete dahil edin.

---

### [MEDIUM] UX-A11-03 — Form TextInput'lar erişilebilir adları için yalnızca placeholder'a (veya hiçbir şeye) dayanıyor

**Dosya:** `app/settings/challenges.tsx:174-180`; `app/log.tsx:411-421`; `app/chat/[sessionId].tsx:1293-1306`; `src/components/plan/PlanChatComposer.tsx:224-239`

**Sorun:** Birden çok TextInput'un `accessibilityLabel`'ı yok ve adı için bir placeholder'a — veya bir durumda hiçbir şeye — dayanıyor. Placeholder güvenilir bir erişilebilir ad değildir: kullanıcı yazınca kaybolur. En kötü durum: challenges.tsx "Süre (gün)" input'unun (satır 174) NE placeholder'ı NE accessibilityLabel'ı var — tek etiketi programatik olarak ilişkilendirilmemiş görsel-bitişik bir `<Text>`. log.tsx kilo input'u (411) yalnızca `placeholder='73.5'` kullanıyor. Chat composer (en çok kullanılan input, 1293) ve PlanChatComposer (224) etiketsiz. Kod tabanı içinde tutarsız: app/(tabs)/index.tsx:231'deki AYNI kilo input'u doğru biçimde `accessibilityLabel='Kilo (kg)'` set ediyor.

**Etki:** Ekran okuyucu kullanıcıları bu alanları odaklandıktan/doldurulduktan sonra tanımlayamaz (WCAG 1.3.1/4.1.2 ve 3.3.2 başarısız). challenges süre alanı tamamen etiketsiz; kilo ve birincil chat/plan composer'ları giriş başlayınca adlarını kaybeder.

**Kanıt:**
```tsx
challenges.tsx:174  <TextInput value={customDays} onChangeText={setCustomDays} keyboardType="numeric" style={{...}} />  // placeholder DE accessibilityLabel DE yok
log.tsx:411  <TextInput ... placeholder="73.5" value={weightInput} ... />  // yalnızca placeholder
chat/[sessionId].tsx:1293  <TextInput ... placeholder={... 'Mesajını yaz...'} ... />  // accessibilityLabel yok
// karşılaştır: app/(tabs)/index.tsx:231 accessibilityLabel="Kilo (kg)" SET ediyor
```

**Öneri:** Her TextInput'a görünür bağlamı aynalayan `accessibilityLabel` ekleyin: challenges süre `'Süre (gün)'`; log kilo `'Kilo (kg)'`; chat composer `'Mesajını yaz'`; PlanChatComposer `'Plandaki bir şeyi değiştir'`. Placeholder'a güvenmek yerine görünür `<Text>` etiketini ilişkilendirmeyi tercih edin.

---

## LOW

### [LOW] UX-ONB-04 — (tabs) grubu içinde onboarding kapısı yok — kapı yalnızca app/index.tsx'e dayanıyor

**Dosya:** `app/(tabs)/_layout.tsx:39-92`

**Sorun:** "Onboarding tamamlanmalı" kuralı tam olarak TEK yerde uygulanıyor: `app/index.tsx:84` `!profile.onboarding_completed` iken `/onboarding`'e yönlendiriyor. (tabs) layout'unun kendisinde koruma yok ve `app/_layout.tsx` global koruması (satır 48) yalnızca eksik oturumu kontrol ediyor. Teorik olarak index.tsx'ten geçmeden bir (tabs) rotasına inen herhangi bir navigasyon — gelecekteki bir deep link veya `router.replace` — onboarding verisi null iken authed uygulamaya ulaşabilir.

**Etki:** Savunma-derinliği/sağlamlık boşluğu. Ancak şu an yeniden-üretilebilir bir bypass YOK: chat rotasına tek navigasyon `handleComplete`'te (onboarding tamamlandıktan ve `onboarding_completed=true` yazıldıktan SONRA) çalışıyor, index.tsx geri kalan her şeyi yönlendiriyor ve kayıtlı bir deep-link/bildirim handler'ı yok. İleriye-dönük bir sertleştirme, canlı bug değil; bu yüzden LOW.

**Kanıt:**
```tsx
// Tek kapı app/index.tsx:84
if (!profile.onboarding_completed) { return <Redirect href="/onboarding" />; }
// app/_layout.tsx:48  if (!session && !isPublic) router.replace('/(auth)/login')  // onboarding kontrolü yok
```

**Öneri:** `app/(tabs)/_layout.tsx`'e (veya paylaşılan bir hook'a) yüklenen profilde `onboarding_completed=false` olduğunda `/onboarding`'e sıçrayan bir yönlendirme koruması ekleyin; böylece tab grubuna her giriş kapılanır.

---

### [LOW] UX-ONB-05 — İki yaş kapısı arasında tutarsız minimum doğum yılı (register <1920 reddediyor, onboarding 1901'e kadar kabul ediyor)

**Dosya:** `app/onboarding.tsx:224-236`

**Sorun:** Onboarding içindeki OAuth doğum-yılı yakalaması yalnızca `<= 1900` (satır 226) ile reddediyor, yani 1901 kabul ediliyor; register.tsx (satır 39) ise `year < 1920` olanı reddediyor. Aynı "18+" politikasını koruyan iki yaş-doğrulama kapısı farklı alt sınırlar kullanıyor.

**Etki:** Küçük tutarsızlık: bir OAuth kullanıcısı, e-posta yolunun reddedeceği açıkça olanaksız bir doğum yılı (ör. 1905) girebilir. Güvenlik sorunu değil (ikisi de hâlâ 18+ uyguluyor), ama aynı kuralın iki kopyasında önlenebilir bir sapma.

**Kanıt:**
```tsx
// app/onboarding.tsx:226
if (!Number.isFinite(by) || by <= 1900 || by > nowYear) {
// app/(auth)/register.tsx:39
if (!year || year < 1920 || year > currentYear) { ... }
```

**Öneri:** Tek bir paylaşılan doğum-yılı doğrulayıcısı (min 1920, max currentYear, age>=18) çıkarın ve hem register.tsx hem onboarding.tsx'te kullanın.

---

### [LOW] UX-NAV-02 — Chat sekmesi, zaten oturumu olan kullanıcılar için prefill/quick-log yönlendirmesi sırasında tüm oturum listesini bir an gösteriyor

**Dosya:** `app/(tabs)/chat.tsx:197-200`

**Sorun:** Chat sekmesi, dashboard quick-action'ları ve Quick-Log "Fotoğraf çek" deep-link'i için yönlendirme atlama noktası. Ekran "yönlendirme olurken hiçbir şey gösterme" deniyor ama koruma yalnızca boş-oturum durumunu kapsıyor: `if ((prefill || openCamera) && !sessions.length) return <blank>`. Zaten oturumu olan bir kullanıcı için `sessions.length` sıfır-olmadığından koşul false olur ve `router.replace` ateşlenmeden önce tam SessionListScreen bir kare render edilir.

**Etki:** Chat geçmişi olan kullanıcılar dashboard veya quick-log'dan bir chat prefill tetiklediklerinde temiz bir geçiş yerine oturum-listesi ekranının kısa, sarsıcı bir parıltısını görür. Kozmetik ama her böyle navigasyonda görünür.

**Kanıt:**
```tsx
// app/(tabs)/chat.tsx:197-200
// If prefill redirect is happening, show nothing
if ((prefill || openCamera) && !sessions.length) {
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
```

**Öneri:** Boş-sırasında-render'ı `!sessions.length` yerine yönlendirme durumunun kendisine bağlayın (ör. `(prefill || openCamera) && !prefillHandled`), böylece liste kullanıcının mevcut oturumu olup olmamasından bağımsız olarak bastırılır.

---

### [LOW] UX-OFF-07 — Yeniden-bağlanınca "senkronize ediliyor" banner'ı "Bekleyen kayıtlar senkronize ediliyor" gösteriyor ama yapılandırılmış kuyrukta hiçbir şey yok

**Dosya:** `src/components/common/OfflineBanner.tsx:30-42, 67`

**Sorun:** Bağlantı dönünce OfflineBanner `syncing=true` set edip `syncQueue()` çağırır ve "Bekleyen kayıtlar senkronize ediliyor..." gösterir. Ama `syncQueue()` YAPILANDIRILMIŞ kuyruğu boşaltır, ki o `enqueue()`'nun çağıranı olmadığı için (UX-OFF-03) daima boştur. Chat offline kuyruğu ve dashboard log yazımları burada işlenmez. Kullanıcı, (a) gerçekten kuyruğa-alınmış kaydı olmadan ve (b) offline kaybettikleri mesajlar/loglar kurtarılmazken bir "bekleyen kayıtlar senkronize ediliyor" mesajını kısaca görür.

**Etki:** Yanıltıcı güvence: banner gerçekte olmayan offline işin uçuş-içi kurtarımını ima eder. Küçük, ama UX-OFF-01 ve UX-OFF-03'teki gerçek boşlukları örter.

**Kanıt:**
```tsx
OfflineBanner.tsx:36  syncQueue().catch(() => {}).finally(() => setSyncing(false));
OfflineBanner.tsx:67  const label = syncing ? 'Bekleyen kayıtlar senkronize ediliyor...' : '...';
```

**Öneri:** Senkronizasyon durumunu yalnızca gerçekten senkronize edilecek bir şey olduğunda gösterin (ör. `getQueueCount()>0` veya chat kuyruk boyutuna bağlayın) ve/veya yeniden-bağlanınca gerçek kuyrukları (chat `processOfflineQueue` + dashboard `enqueue`) işleyin.

---

### [LOW] UX-FRM-03 — multi-phase-goals: faz hedef kilo parseFloat'ı da Türkçe virgüllü ondalığı düşürüyor

**Dosya:** `app/settings/multi-phase-goals.tsx:49, 166`

**Sorun:** UX-FRM-02 ile aynı sınıf bug. "Hedef Kilo (opsiyonel)" input'u decimal-pad (satır 166) ama `handleAdd` onu çıplak `parseFloat(newTarget)` (satır 49) ile virgül normalizasyonu olmadan ayrıştırıyor, "77,5" → 77 saklanıyor. Ayrıca ekleme-başarı geri bildirimi yok ve başarısız bir `addPhase` async `onPress` içinde yeniden throw ediyor (yakalanmamış reddetme).

**Etki:** Çoklu-faz cut/bulk hedef kiloları tr-TR/Android'de ondalığını sessizce kaybeder, faz planını hizasızlaştırır. Ekleme başarısızlığında kullanıcı yalnızca bir hata haptiği alır, mesaj almaz. (Alan açıkça opsiyonel ve faz-ekleme yolu olduğundan FRM-02'nin birincil hedef kilosundan daha az yük-taşıyan; bu yüzden LOW.)

**Kanıt:**
```tsx
await addPhase(user.id, goalType, newTarget ? parseFloat(newTarget) : null, parseInt(newWeeks) || 12, newPhaseLabel);
} catch (e) { haptics.error(); throw e; }   // Button onPress'te yakalanmamış reddetme, mesaj yok
```

**Öneri:** `parseFloat(newTarget.replace(',', '.'))` kullanın. `handleAdd`'deki `throw e`'yi Türkçe Alert ('Faz eklenemedi, tekrar dene.') ile değiştirin ve eklemede goals.tsx ile tutarlı bir başarı onayı gösterin.

---

### [LOW] UX-FRM-05 — recipes: düzenle-kaydet boş bir başlığın tarif adını üzerine yazmasına izin veriyor (zorunlu-alan doğrulaması yok)

**Dosya:** `app/settings/recipes.tsx:67-84`

**Sorun:** `saveEdit()` yalnızca porsiyonu doğruluyor (NaN → 1), başlığın boş-olmadığını hiç kontrol etmiyor. Kullanıcı "Tarif adı" alanını temizleyip Kaydet'e basarsa `title: editTitle.trim()` — boş bir dizgi — kalıcılaşıp mevcut tarif adını üzerine yazar. Kart sonra boş başlık render eder ve kayıt başarı bildirir (`haptics.success`).

**Etki:** Geçerli bir tarifin adı, başarılı-görünen bir kayıtla boşa silinebilir; listede ve AI'ın kayıtlı-tarif tercih sorgusunda tanımlanamayan bir tarif bırakır.

**Kanıt:**
```tsx
await updateRecipe(editingId, {
  title: editTitle.trim(),   // boş dizgi kabul ediliyor, adı üzerine yazıyor
  instructions: editInstructions.trim(),
  servings: isNaN(servingsNum) ? 1 : servingsNum,
});
```

**Öneri:** `saveEdit`'te `updateRecipe`'ten önce koruyun: `if (!editTitle.trim()) { haptics.error(); Alert.alert('Eksik', 'Tarif adı boş olamaz.'); return; }`.

---

### [LOW] UX-CHT-07 — Yalnızca-istemci proaktif karşılama baloncuğu state'e ekleniyor ama hiç kalıcılaşmıyor ve davet ettiği AI'a görünmez

**Dosya:** `app/chat/[sessionId].tsx:479-497`

**Sorun:** Son asistan mesajı >4 saat eski olan görev-dışı bir chat'in resume'unda ekran, sentetik bir karşılama baloncuğu (`greet-${Date.now()}`) messages'a push ediyor. Yorum "kullanıcı yanıtlayana dek DB'ye gitmez" diyor ama hiçbir şey bunu kalıcılaştırmıyor ve edge fonksiyonu bağlamı `chat_messages`'tan kurduğu için model "Uzun zamandır konuşmadık..." gönderdiğine dair kayda sahip değil. Kullanıcı "evet" derse AI neyi kabul ettiğini bilmez. Karşılama ayrıca 4 saat sonra her yeniden açışta tekrar görünür.

**Etki:** Hafifçe kopuk konuşma: koç kendi karşılamasını "unutur" ve ona verilen kısa yanıtlar bağlamsız iner. Her yeniden açışta aynı karşılama robotik hisseder.

**Kanıt:**
```tsx
setMessages(prev => [...prev, {
  id: 'greet-' + Date.now(), role: 'assistant',
  content: 'Uzun zamandır konuşmadık. Bugünü konuşalım mı — ne yediğin, enerjin nasıldı?',
  created_at: new Date().toISOString(),
}]);  // DB'ye hiç yazılmaz; her yeniden açışta yeniden hesaplanır
```

**Öneri:** Ya karşılamayı gerçek bir asistan `chat_messages` satırı olarak kalıcılaştırın (model görsün) ya da sentetik baloncuğu bırakıp modelin kullanıcının ilk yanıtında doğal açılış yapmasına izin verin. Oturum için karşılamanın gösterildiğini izleyin ki her yeniden açışta tekrar enjekte edilmesin.

---

### [LOW] UX-PRM-07 — Plan-onay paywall'ı yalnızca kullanıcı taslağı oluşturup rafine ettikten sonra ateşleniyor (emek-sonra-paywall)

**Dosya:** `app/plan/diet.tsx:232-247`; `app/plan/workout.tsx:211-225`

**Sorun:** `canApprovePlan` yalnızca `handleApprove` içinde kontrol ediliyor, yani ücretsiz kullanıcı 2. diyet/antrenman planı için tüm konuşmaya dayalı taslak-oluşturma ve rafine akışından geçtikten SONRA. Taslak/giriş noktalarında "bu Premium gerektirecek" sinyali yok, dolayısıyla kullanıcı tam bir chat oturumunu plan oluşturmaya yatırıp paywall'a yalnızca son "Onayla" dokunuşunda çarpar. Taslak korunur ama emeği ödeme yapmazsa boşa gider.

**Etki:** Klasik "iş yapıldıktan sonra paywall" sürtünmesi: kullanıcı kapıyı yalnızca dönüşüm anında, batık emekten sonra keşfeder; bu da önden "Premium" etiketinden daha çok güveni zedeler.

**Kanıt:**
```tsx
diet.tsx:232  const handleApprove = async () => { ... const gate = canApprovePlan('diet'); if (!gate.allowed) { ...router.push('/settings/premium'); return; } ... }  // taslak başında önden kapı yok
```

**Öneri:** Kota durumunu taslak oluşturmadan önce yüzeye çıkarın (ör. 2. plan başlarken, chat başlamadan "Ücretsiz planda 1 plan hakkın doldu — yeni plan Premium gerektirir") — `canApprovePlan('diet'/'workout').reason === 'free_quota_used'` kullanarak kullanıcı emek yatırmadan bilinçli seçim yapsın.

---

### [LOW] UX-PRM-08 — "Satın Alımları Geri Yükle" ve "Abone Ol" kalıcı ölü stub'lar ama gerçek, çalışan aksiyonlar gibi sunuluyor

**Dosya:** `src/services/subscription.service.ts:86-97`; `app/settings/premium.tsx:55-115, 72-85`

**Sorun:** `initiatePurchase` ve `restorePurchases` koşulsuz olarak `{ ok:false, error:'native_sdk_not_wired' }` döner. Premium ekranı belirgin "Premium'a Geç" / "Aboneliğe Geç" butonları ve bir "$9.99 / $79.99" fiyat kartı render ediyor; Abone Ol'a basmak daima ücretsiz denemeye pivot eden "Satın alma yakında" uyarısına düşer ve "Satın Alımları Geri Yükle" daima "çok yakında" gösterir. Şu an ödeme yolu yok ve geri-yükleme asla başaramaz.

**Etki:** Kullanıcılar gerçek fiyatlar ve asla satın alma/geri-yükleme tamamlayamayan Abone Ol/Geri Yükle butonları görür. Yanıltıcı para-kazanma UX'i ve bir Apple/Google inceleme engelleyicisi (çalışmayan Restore + çalışan satın alma yolu olmayan ilan edilen IAP). Mağaza-gönderim anında bir sorun olduğu için LOW.

**Kanıt:**
```ts
subscription.service.ts:86  export async function initiatePurchase(...) { return { ok: false, error: 'native_sdk_not_wired' }; }
subscription.service.ts:94  export async function restorePurchases(): ... { return { ok: false, error: 'native_sdk_not_wired' }; }
premium.tsx:250  <Button title="Premium'a Geç" onPress={handleSubscribe} size="lg" /> // görünür $9.99/$79.99 kartlarıyla
```

**Öneri:** RevenueCat bağlanana dek fiyatlandırma/Abone Ol/Geri Yükle affordance'larını deneme CTA'sının arkasına saklayın veya satın almayı canlı $9.99/$79.99 fiyatlandırması yerine açıkça "yakında" etiketleyin. Restore, mağaza gönderiminden önce çalışır olmalı.

---

### [LOW] UX-FBK-06 — Quick-log metin "Kaydet" başarısı sessizken her diğer quick-log aksiyonu checkmark + haptik gösteriyor

**Dosya:** `app/log.tsx:99-120`

**Sorun:** Quick Log modalında birincil metin-girişi kaydı (`handleLog`) başarıda `await fetchToday(...); router.back();` yapıyor, `haptics.success()` ve başarı toast'ı YOK. Aynı ekrandaki her kardeş kayıt — `handleWaterAdd`, `handleWeightSave`, `handleSleepSave`, `handleRecoverySave` — `showSuccessAndClose()` (satır 84-97) çağırıyor, ki o `haptics.success()` ateşleyip kapatmadan önce animasyonlu bir "X kaydedildi!" kartı gösteriyor. En çok kullanılan yol (serbest-metin "Yazarak gir" sonra "Kaydet") en az geri bildirim veren yol.

**Etki:** Uygulamanın merkezi loglama yüzeyinde tutarsız başarı geri bildirimi. Manşet log aksiyonu "hiçbir şey olmamış" gibi hissettiriyor, ikincil aksiyonlar tatmin edici bir onay alırken; başka yerde kullanılan ödül dilini baltalıyor.

**Kanıt:**
```tsx
const handleLog = async () => {
  const { error } = await sendMessage(text.trim());
  if (error) { haptics.error(); Alert.alert('Kayıt eklenemedi', error); }
  else { await fetchToday(user.id, dayBoundaryHour); router.back(); } // haptics.success / showSuccessAndClose yok
};
// vs handleWeightSave: ... showSuccessAndClose('Kilo kaydedildi!');
```

**Öneri:** `handleLog`'un başarısını `showSuccessAndClose('Kaydın eklendi!')` üzerinden yönlendirin (veya en azından `haptics.success()` ekleyin) ki birincil metin-log yolu su/kilo/uyku/iyileşme ile aynı onayı versin.

---

### [LOW] UX-A11-04 — StreakBadge ikon+sayı pili'nde accessibilityLabel yok (ekran okuyuculara belirsiz)

**Dosya:** `src/components/tracking/StreakBadge.tsx:16-29`

**Sorun:** StreakBadge bir alev ikonu artı "{days} gün"ü `accessibilityLabel` olmayan bir View içinde render ediyor. Ekran okuyucu yalnızca çıplak "{n} gün" metnini, bunun bir seri olduğu bağlamı olmadan okur; alev ikonu (seriyi işaret eden tek şey) dekoratif ve etiketsiz. Dashboard hero'sunda (HeroSection) ve profil başlığında (app/(tabs)/profile.tsx:92) görünüyor. DeviationTag gibi açık `accessibilityLabel` set eden kardeşlerle tutarsız.

**Etki:** Küçük: bir VoiceOver/TalkBack kullanıcısı dashboard/profilde belirsiz bir "5 gün" duyar, bunun bir loglama serisine atıfta bulunduğuna dair gösterge olmadan. İkonla iletilen anlam (alev) kaybolur (hafif 1.4.1 endişesi).

**Kanıt:**
```tsx
<View style={{ ... backgroundColor:'#1D9E75' }}>
  <Ionicons name="flame" size={14} color="#fff" />
  <Text style={{ color:'#fff', fontSize:12, fontWeight:'600' }}>{days} gün</Text>
</View>   // badge'de accessibilityLabel yok; alev ikonu etiketsiz
```

**Öneri:** Dış View'a `accessible={true}` ve `accessibilityLabel={`${days} günlük seri`}` ekleyin ki badge anlamını duyursun, DeviationTag/ComplianceScore kalıbıyla eşleşsin.

---

## Elenen Bulgular (referans)

- **UX-CHT-03** (INVALID) — "Yalnızca bir kullanıcı mesajı saklanan oturum boş render ediliyor." Boş-durum kapısı kod şekli olarak var, ama iddia edilen kök neden (mid-turn LLM/edge hatasının yalnız bir kullanıcı satırı bırakması) gerçekleşemez: `storeMessages` (ai-chat/index.ts:2612-2620) kullanıcı VE asistan satırlarını tek atomik `.insert([...])` ile, yalnızca LLM tamamlama başarılı olduktan SONRA yazar. Mid-turn hata sıfır satır yazar. Üreten yol olmadığından defekt reproduce edilemiyor.
- **UX-PRM-01** (INVALID) — "İstemci mesaj-sayacı onboarding bypass'ını yok sayıyor, ücretsiz kullanıcılar onboarding ortasında hard-block olabilir." Premise yanlış: `app/index.tsx:84` `!onboarding_completed` olan HER kullanıcıyı form rotası `/onboarding`'e yönlendirir (chat'e değil), ve form (`onboarding.tsx:308`) `/(tabs)/chat`'e gitmeden ÖNCE `onboarding_completed:true` yazar. Yani chat ekranındaki ücretsiz kullanıcı DAİMA `onboarding_completed===true`'ya sahiptir; chat'in `isOnboarding`'i daima false'tur ve sunucunun onboarding bypass'ı da inaktiftir — istemci ve sunucu 50/gün kapısında ANLAŞIR. Önerilen "!isOnboarding'e bağla" no-op'tur.


---

## DB — Veritabanı, RLS, Şema & Performans

### Özet

| Severity | Adet |
|----------|------|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 12 |
| LOW | 8 |
| **Toplam (onaylı)** | **25** |
| Reddedilen / düşürülen | 0 |

**Tema:** En ağır bulgular `SECURITY DEFINER` RPC'lerin yetkilendirme modelinde yoğunlaşıyor — üç atomik plan/hedef RPC'si (`set_active_goal`, `project_daily_plans`, `promote_weekly_plan`) ve `start_trial_if_eligible` `REVOKE ... FROM PUBLIC` taşımadığı için anon/authenticated tarafından doğrudan PostgREST üzerinden çağrılabiliyor; bu da kimliksiz çapraz-kullanıcı veri imhası (CRITICAL) ve deneme-hakkı yakma (HIGH) anlamına geliyor. İkinci küme, tek-aktif-hedef invariantını istemci/cron tarafında atomik olmayan deactivate+activate çiftleriyle kıran ve LLM-türevi enum'u doğrulamadan CHECK-kısıtlı kolona yazıp insert hatasını yutan **veri bütünlüğü/sessiz veri kaybı** hataları (HIGH). Migration zincirinde idempotency/replay-güvenliği eksiklikleri (cron drift, guard'sız `ADD CONSTRAINT`/`CREATE POLICY`) ve `WHERE`-kısıtlı kısmi indekslerin FK cascade'leri ile sıcak sorgulara hizmet edememesinden kaynaklanan **performans/erişim-yolu** sorunları MEDIUM/LOW seviyede. Son olarak KVKK/GDPR uyum boşlukları (eksik export tabloları, sahtelenebilir audit log, plaintext özel-nitelikli sağlık verisi, denetlenmeyen silme yolu) MEDIUM ağırlıkta. Çoğu HIGH/CRITICAL bulgu canlı PostgREST probe'larıyla doğrulanmış; multi-faz hedef ve haftalık-menü gibi az kullanılan özelliklerde latent ama deterministik tetikleniyor.

---

### [CRITICAL] DB-FUN-01 — Atomik plan/hedef SECURITY DEFINER RPC'leri (set_active_goal, project_daily_plans, promote_weekly_plan) anon/authenticated tarafından çağrılabilir ve p_user'a auth kontrolü olmadan güvenir → kimliksiz çapraz-kullanıcı veri imhası

**Dosya:** `supabase/migrations/057_atomic_plan_goal_writes.sql:100-102`, `supabase/migrations/058_fix_project_daily_plans_explicit_columns.sql:57`, `supabase/migrations/071_promote_weekly_plan_subtype_aware.sql:50` (yalnızca GRANT, REVOKE FROM PUBLIC yok); gövdeler `057:19-41`, `058:15-58`

**Sorun:** `set_active_goal(p_user,p_goal)`, `project_daily_plans(p_user,p_lower,p_end,p_rows)` ve `promote_weekly_plan(p_user,...)` `SECURITY DEFINER` fonksiyonlardır; tüm yetkilendirme modelleri "sadece ai-chat edge fonksiyonu (service_role) bunları çağırır" varsayımına dayanır — hiçbiri `p_user`'ı `auth.uid()` ile doğrulamaz. Migration'lar yalnızca `GRANT EXECUTE ... TO service_role` çalıştırır, hiçbir zaman `REVOKE EXECUTE ... FROM PUBLIC` çalıştırmaz. PostgreSQL'de `CREATE FUNCTION`, PUBLIC'e örtük bir `EXECUTE` grant'i ekler; anon ve authenticated bunu miras alır, dolayısıyla bu fonksiyonlar PostgREST (`/rest/v1/rpc/<fn>`) üzerinden HERHANGİ bir çağıran tarafından — tamamen kimliksiz anon dahil — erişilebilir. Fonksiyonlar çağıranın verdiği `p_user`'a güvendiği için saldırgan keyfi bir kurban UUID'si geçebilir. `set_active_goal` önce `UPDATE public.goals SET is_active=false WHERE user_id=p_user` çalıştırır (kurbanın aktif hedefini devre dışı bırakır), `project_daily_plans` önce `DELETE FROM public.daily_plans WHERE user_id=p_user AND date>=p_lower AND date<=p_end` çalıştırır (kurbanın plan satırlarını siler), `promote_weekly_plan` ise kurbanın aktif haftalık planını arşivler (arşiv UPDATE'inde aktivasyon-guard'ı yok; yalnızca yeniden-aktivasyon adımı `tg_weekly_plans_block_client_activation` ile engellenir).

**Etki:** Kimliksiz (anon) veya herhangi bir authenticated kullanıcı, kurbanın UUID'siyle bu RPC'leri çağırarak başka kullanıcının verisini imha edebilir: herhangi bir tarih aralığında günlük planlarını siler, aktif hedefini devre dışı bırakır ve aktif diyet/antrenman planını arşivler (kaybeder). Giriş gerekmeden, hedeflenmiş keyfi kullanıcılar için veri kaybı + çekirdek özelliğin reddi (DoS). Doğru sertleştirilmiş definer'lar (045, 050, 067, 068) tümü açıkça `REVOKE ... FROM PUBLIC` yapar; bu üçü istisnadır.

**Kanıt:**
```
Canlı anon probe (apikey=anon JWT) /rest/v1/rpc:
project_daily_plans  -> HTTP 204 (çalıştı; verilen p_user için DELETE koştu)
set_active_goal {"p_user":"00000000-...","p_goal":{"goal_type":"lose_weight"}}
  -> HTTP 400 23503 goals_user_id_fkey  (INSERT gövdesine ULAŞTI — guard yok;
     GERÇEK kurban uuid ile önceki UPDATE goals SET is_active=false ... + INSERT
     tüm işlem olarak commit eder)
promote_weekly_plan  -> HTTP 200 null (çalıştı)

057:100-102:
  GRANT EXECUTE ON FUNCTION public.set_active_goal(uuid, jsonb) TO service_role;
  GRANT EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb) TO service_role;
  GRANT EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb) TO service_role;
  -- (hiçbir yerde REVOKE ... FROM PUBLIC yok)
058:27: DELETE FROM public.daily_plans WHERE user_id = p_user ...  (yalnızca çağıran-verili p_user)
```
*Not (adversarial düzeltme):* plpgsql gövdesi tek transaction olduğundan sahte UUID ile INSERT FK hatası tüm çağrıyı (UPDATE dahil) geri alır — bu bulguyu zayıflatmaz; gerçek kurban için INSERT başarılı olur ve TÜM işlem commit eder (hedef devre dışı + saldırgan hedefi eklenir), bu daha kötüdür. `promote_weekly_plan`'da ikinci UPDATE (draft→active) anon için `tg_weekly_plans_block_client_activation` (047) ile engellenir, ama ilk UPDATE (active→archived) guard'sızdır; var-olmayan/yabancı `p_draft_id` ile ikinci UPDATE hiçbir satıra eşleşmez, trigger tetiklenmez, fonksiyon NULL döner ve kurbanın aktif planı arşivlenmiş kalır (veri-reddi).

**Öneri:** Üç fonksiyon için de `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;` ekleyin (045/050/068 ile uyumlu). Ek olarak her gövdede çağıran kimliğini doğrulayın — örn. `IF p_user <> auth.uid() AND auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;` — böylece gelecekteki bir grant kayması açığı yeniden açamaz (savunma derinliği).

---

### [HIGH] DB-FUN-02 — start_trial_if_eligible sahiplik guard'ı anon için NULL-bypass ediliyor ve fonksiyon anon tarafından çağrılabilir (REVOKE FROM PUBLIC yok) → kimliksiz deneme verme / keyfi kullanıcının deneme hakkını yakma

**Dosya:** `supabase/migrations/053_trial_selfgrant_rpc.sql:33-34` (guard), `:51-53` (yazımlar), `:59` (GRANT TO authenticated, REVOKE FROM PUBLIC yok)

**Sorun:** `start_trial_if_eligible(uid)` `SECURITY DEFINER`'dır ve kullanıcının YALNIZCA kendi denemesini başlatmasını sağlamalıdır. Guard `IF uid <> auth.uid() THEN RAISE EXCEPTION 'forbidden';` şeklindedir. Anonim istekte `auth.uid()` NULL'dur, dolayısıyla `uid <> NULL` üç-değerli mantıkta NULL'a değer (IF dalı alınmaz) ve yürütme deneme-oluşturma mantığına düşer. Migration ayrıca yalnızca `GRANT EXECUTE ... TO authenticated` yapar, asla `REVOKE ... FROM PUBLIC` yapmaz; örtük PUBLIC grant'i anon'un fonksiyona erişmesini sağlar. Bunlar birleşince kimliksiz çağıran `start_trial_if_eligible('<herhangi var-olan kullanıcı uuid>')` çağrısı yapabilir. Denemesini kullanmamış ve aktif aboneliği olmayan bir hedef için fonksiyon 7-günlük deneme aboneliği INSERT eder ve o kurban için `profiles.trial_used=true` ayarlar — kurbanın katılımı olmadan. `tg_block_trial_reuse` trigger'ı yalnızca `trial_used` zaten ayarlandıktan SONRA yeniden-kullanımı engeller, bu ilk seferki kimliksiz yakmayı durdurmaz.

**Etki:** Bir kullanıcının UUID'sini bilen/elde eden kimliksiz saldırgan o kullanıcının ücretsiz-deneme hakkını tüketebilir (ücretli-dönüşüm teşvikinin reddi) ve onun için subscription/profile durumu yazabilir. En azından keyfi var-olan kullanıcılar için subscriptions+profiles'a kimliksiz yazımdır.

**Kanıt:**
```
Canlı anon probe (anon JWT) /rest/v1/rpc/start_trial_if_eligible {"uid":"00000000-..."}
  -> {"code":"23503", "details":"Key (user_id)=(00000000-...) is not present in profiles.",
      "message":"... violates foreign key constraint subscriptions_user_id_fkey"}
  yani gövde 'forbidden' raise etmek yerine INSERT INTO public.subscriptions (053:51) adımına ULAŞTI
  → uid <> auth.uid() guard'ı anon için ATEŞLENMEDİ.

053:59  GRANT EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) TO authenticated;
        -- eşlik eden REVOKE FROM PUBLIC yok
```

**Öneri:** `REVOKE EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) FROM PUBLIC, anon;` ekleyin ve guard'ı NULL'a karşı sertleştirin: `IF auth.uid() IS NULL OR uid <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;` (veya `IF uid IS DISTINCT FROM auth.uid() ...`).

---

### [HIGH] DB-PHC-01 — plan.service.getActive/getDraft, weekly_plans.plan_subtype'ı yok sayar → diyet-plan ekranı uyumsuz haftalık-menü satırını yükleyebilir (sessiz plan bozulması)

**Dosya:** `src/services/plan.service.ts:124-144, 233-264`

**Sorun:** Migration 055 (`055_weekly_menu_isolation.sql`) `weekly_plans.plan_subtype` kolonunu ekledi ve kısmi unique indeksi `(user_id, plan_type, COALESCE(plan_subtype,'core')) WHERE status='active'` olarak yeniden tanımladı. Bu kasıtlı bir şema değişikliğidir: `plan_type='diet'` için kullanıcı aynı anda İKİ aktif satıra sahip olabilir — chat-onaylı 'core' diyet planı (`plan_subtype = NULL`) ve eski ai-plan haftalık MENÜ'sü (`plan_subtype = 'weekly_menu'`). İki satır UYUMSUZ `plan_data` şekilleri tutar: core plan bir NESNE (`{targets, days:[...], version}`), weekly_menu ise DÜZ DİZİ (`[{date, meals:[...]}]`). Menü okuyucusu (`weekly-plan.service.ts:151`) ve ai-plan/ai-chat yazıcıları doğru güncellenmiş, ANCAK çekirdek diyet/antrenman PLAN ekranını (`app/plan/diet.tsx`) besleyen `plan.service.ts` güncellenmemiş. `getActive()` (124-132) ve `getDraft()` (135-143) yalnızca `user_id`, `plan_type`, `status` üzerinde filtreler, `.limit(1)` kullanır, `plan_subtype` filtresi ve `ORDER BY` YOKTUR. Kullanıcı bir haftalık menü ürettiğinde (aktif `plan_type='diet', plan_subtype='weekly_menu'` satırı oluşur), `getActive(userId,'diet')` diyet-plan ekranına weekly_menu satırını non-deterministik olarak döndürebilir. `diet.tsx` bu satırın `plan_data`'sını `DietPlanData`'ya cast eder ve `planData.days[dayIndex]...` erişir; weekly_menu satırı için `planData.days` undefined → ekran boş kalır/çöker.

**Etki:** Kullanıcı bir haftalık menü ürettikten sonra, diyet PLAN sekmesi menünün düz-dizi `plan_data`'sını nesne-şekli bekleyen ekrana sessizce yükleyebilir — boş/çöken diyet plan görünümü (hem chat diyet planı hem haftalık menü kullanan herhangi bir kullanıcı için çekirdek özellik bozulur). Bugün latent (canlı DB'de yalnızca `plan_subtype=NULL` aktif diyet satırları var) ama herhangi bir kullanıcı ai-plan ile haftalık menü ürettiği ilk anda tetiklenir. Salt-okuma yanlış-seçim (veri kaybı yok) ve haftalık-menü özelliği arkasında kapılı.

**Kanıt:**
```js
// src/services/plan.service.ts:124 — subtype-kör okuyucu
export async function getActive(userId, planType) {
  const { data } = await supabase
    .from('weekly_plans').select('*')
    .eq('user_id', userId).eq('plan_type', planType)
    .eq('status', 'active')   // <-- .eq/.is('plan_subtype', ...) YOK
    .limit(1);                // <-- ORDER BY YOK: core VEYA weekly_menu satırı döner
  return (data)?.[0] ?? null;
}
// migration 055: her iki satır aynı anda aktif olabilir
CREATE UNIQUE INDEX uniq_active_plan_per_type
  ON public.weekly_plans (user_id, plan_type, COALESCE(plan_subtype, 'core'))
  WHERE status = 'active';
// menü okuyucu filtreyi EKLEMİŞ (weekly-plan.service.ts:151): .eq('plan_subtype', 'weekly_menu')
// $ grep plan_subtype src/services/plan.service.ts  -> No matches found
// app/plan/diet.tsx:485 NESNE şeklini tüketir: planData.days[dayIndex]?.day_label
```

**Öneri:** `plan.service`'i 055-sonrası kontrata uygun subtype-farkında yapın: `getActive()`, `getDraft()` ve `getHistory()`'e `.is('plan_subtype', null)` ekleyin (core plan NULL-subtype satırıdır), böylece bu okuyucular yalnızca chat 'core' planını görür, asla 'weekly_menu' satırını görmez. `weekly-plan.service`/ai-plan'deki savunmacı guard'ı yansıtın (plan_subtype kullanılamıyorsa sessizce geri düşmek yerine reddedin).

*Not (adversarial düzeltme):* Bulgunun `approveDraft()` yarısı GEÇERSİZdir — `plan.service.ts:approveDraft` (satır 233) `app/` veya `src/` içinde hiçbir çağırana sahip değildir (ölü kod). Gerçek diyet-onay yolu `diet.tsx:handleApprove → invokePlanChat → ai-chat edge fonksiyonu`'dur; bu da `promote_weekly_plan` RPC'sini çağırır ve migration 071 ile subtype-farkında yapılmıştır. Dolayısıyla "approveDraft yanlış satırı arşivler" senaryosu canlı yolda OLUŞMAZ. Severity yine de HIGH kalır çünkü okuyucu hatası tek başına çekirdek bir ekranı bozar, workaround ve client-side guard yoktur.

---

### [HIGH] DB-TRG-01 — advanceToNextPhase() son fazı geçince kullanıcıyı SIFIR aktif hedefle bırakır (tek-aktif-hedef invariantı istemci üzerinden, atomik olmayan şekilde kırılır)

**Dosya:** `src/services/goals.service.ts:96-125` (deactivate 109, activate 114-118); UI tetik `app/settings/multi-phase-goals.tsx:66-83` ve buton `:146-147`

**Sorun:** DB "en fazla bir aktif hedef" invariantını kısmi unique indeks `uniq_goals_one_active_per_user` (migration 033) ile zorlar ve tüm uygulama TAM OLARAK bir aktif hedef varsayar (okuyucular `is_active=true` üzerinde `.maybeSingle()/.single()` kullanır: `useStreak.ts:34`, `maintenance.service.ts:90`, `dashboard.store.ts:108`, `ai-chat/index.ts:2505/4389/4468`). `advanceToNextPhase()` bu invariantın "tam olarak bir" yarısını kırar. İki AYRI, transaction-dışı UPDATE çalıştırır: (1) satır 109 mevcut aktif fazı `phase_order` ile devre dışı bırakır (anında commit); (2) satır 114 `phase_order = currentOrder+1`'i aktive etmeye çalışır. UI 'Sonraki Faza Geç' butonu `activePhase && phases.length > 1` olduğunda (son faz dahil) gösterilir. Sondan ileri gitmek tek aktif hedefi devre dışı bırakırken adım 2 hiçbir satıra eşleşmez (currentOrder+1 yoktur), `.single()` null verir, fonksiyon null döner ve ekran 'Tüm fazlar tamamlandı!' gösterir ama kullanıcının artık 0 aktif hedefi vardır. İki yazım atomik olmadığından, ileri-gitme ortasında kısmi başarısızlık da 0 aktif hedef bırakır.

**Etki:** Deterministik, sessiz hedef kaybı. Son fazı geçtikten sonra `getActiveGoal()` ve her `is_active=true` okuyucusu null döner: dashboard hedef/ilerleme kartı, koç bağlamı, hedef-farkında TDEE/kalori hedefleme ve raporlar kullanıcının hedefini hatasız kaybeder. Kullanıcı hedefini yeniden oluşturmak zorunda kalır ve bir şeyin bozulduğuna dair hiçbir gösterge yoktur. Multi-faz hedeflerin (Spec 6.7) çekirdek özelliği bozulur + kullanıcı-verisi kaybı. Şu an latent çünkü multi-faz hedefler canlıda nadiren kullanılır (DB probe: yalnızca 1 kullanıcının >1 hedef satırı var, ikisi de phase_order=1 paylaşıyor), bu yüzden CRITICAL değil HIGH.

**Kanıt:**
```js
// goals.service.ts:108-118
const currentOrder = current.phase_order;
await supabase.from('goals').update({ is_active: false })
  .eq('user_id', userId).eq('phase_order', currentOrder);   // anında commit
const { data: next } = await supabase.from('goals')
  .update({ is_active: true })
  .eq('user_id', userId).eq('phase_order', currentOrder + 1)
  .select().single();   // son fazda hiçbir satıra eşleşmez -> 0 aktif hedef
return next ?? null;

// multi-phase-goals.tsx:75-82 (next yokken başarı raporlar, mevcut hedef zaten devre dışı):
if (next) { ... } else { haptics.success(); Alert.alert('Bitti', 'Tüm fazlar tamamlandı!'); }
// multi-phase-goals.tsx:146-147 (buton phases.length>1 için, son faz dahil gösterilir):
{activePhase && phases.length > 1 && (<Button title="Sonraki Faza Geç" onPress={handleAdvance} />)}
```

**Öneri:** Takası tek bir `SECURITY DEFINER` RPC içinde atomik yapın (migration 057'deki `set_active_goal`'u yansıtın): tek transaction içinde sonraki fazı bul (currentOrder+1); yoksa HİÇBİR ŞEY YAPMA (mevcut fazı aktif bırak ve kullanıcıya sonraki faz olmadığını söyle); yalnızca varsa mevcut fazı devre dışı bırakıp sonrakini aktive et. Geçerli bir ardıl onaylanmadan mevcut hedefi asla devre dışı bırakma. Ayrıca UI butonunu `activePhase.phase_order < maxPhaseOrder` ile kapı altına alın, böylece 'ileri' son fazda gizlenir.

---

### [HIGH] DB-CON-01 — ai-proactive cron, doğrulanmamış LLM-türevi priority'yi (CHECK-kısıtlı) coaching_messages.priority'ye yazar ve insert hatasını yok sayar → enum-dışı değer nudge'ı sessizce düşürür ama yine de commitment'ları followed-up işaretler ve hayalet push gönderir

**Dosya:** `supabase/functions/ai-proactive/index.ts:1355-1384` (yazım), `:1358` (ham priority); `supabase/migrations/003_ai_memory_and_chat.sql:143` (CHECK)

**Sorun:** `coaching_messages.priority` canlı bir CHECK kısıtı taşır: `CHECK (priority IN ('low','medium','high'))` (migration 003:143; sonraki hiçbir migration değiştirmez). Saatlik proaktif-nudge yolu ham bir LLM completion'dan (`chatCompletion<NudgeResult>`, 1331-1334) bir NudgeResult kurar ve `priority: result.priority ?? 'medium'` (1358) ile insert eder — modelin değeri HİÇBİR enum normalizasyonu olmadan doğrudan geçer. `NUDGE_PROMPT` yalnızca modele `"priority": "low|medium|high"` emit etmesini SÖYLER (22); JSON-mode değer kümesini zorlamaz ve Türkçe-tuned bir model kolayca enum-dışı bir token emit edebilir (örn. 'yüksek', 'urgent', 'High', ya da boşluklu 'medium '). Bu tür herhangi bir değer INSERT'ü Postgres 23514 check_violation ile başarısız yapar. Kritik olarak insert hatası KONTROL EDİLMEZ (`const { data: inserted } = await supabaseAdmin.from('coaching_messages').insert({...}).select('id').maybeSingle();`), dolayısıyla başarısızlık yutulur. Bu, tüm edge katmanındaki TEK doğrulanmamış enum yazımıdır — diğer her analog yol önce normalize eder (PROFILE_ENUM_WHITELIST, VALID_WORKOUT_TYPES, SQ_MAP, VALID_EVENTS vb.).

**Etki:** Nadir-olmayan bir LLM sapmasında proaktif koçluk mesajı sessizce kaybolur (kullanıcının gelen kutusunda asla görünmez), ancak kod başarısız insert'in ötesine devam eder: (1) her vadesi gelen commitment `status='followed_up'` işaretlenir (1363-1368) — hiçbir takip mesajı teslim edilmediği halde — commitment-takip özelliğini bozarak o nudge'ı kalıcı baskılar; (2) `totalSent` artırılır (1370), teslimi olduğundan fazla raporlar; (3) push notification yine gönderilir (`sendPushNotification`, 1374) — kullanıcı uygulamayı açtığında var olmayan bir mesaj için titreşim alır; `push_sent=true` flip'i atlanır çünkü `inserted?.id` null'dur (1380). Net etki: çekirdek spec özelliği (proaktif nudge) aralıklı olarak kullanıcıya-görünür tutarsızlıkla başarısız olur ve DB hatası atıldığı için normal izlemede görünmez.

**Kanıt:**
```js
// migration 003_ai_memory_and_chat.sql:143
//   priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
// ai-proactive/index.ts:1355-1360 (insert hatası asla kontrol edilmez; priority doğrulanmaz)
const { data: inserted } = await supabaseAdmin.from('coaching_messages').insert({
  user_id: profile.id, content: clean,
  trigger_type: result.trigger ?? 'proactive',
  priority: result.priority ?? 'medium', read: false, push_sent: false,
}).select('id').maybeSingle();
for (const c of dueCommitments) { await supabaseAdmin.from('user_commitments').update({ status: 'followed_up' })... }
totalSent++;
// push insert başarısından bağımsız ateşlenir (1374)
// shared/output-validator.ts veya ai-proactive'te priority normalizasyonu -> HİÇBİRİ
```

**Öneri:** Insert'ten önce priority'yi normalize/whitelist edin, diğer enum-yazım yollarını yansıtın: `const VALID_PRIORITIES = new Set(['low','medium','high']); const pr = VALID_PRIORITIES.has((result.priority ?? '').toString().trim().toLowerCase()) ? result.priority.trim().toLowerCase() : 'medium';`. Ayrıca insert hatasını yakalayıp kontrol edin ve commitment'ları followed-up işaretleme / totalSent artırma / push gönderme işlemlerini yalnızca `inserted?.id` non-null olduğunda yapın, böylece başarısız bir yazım commitment durumunu bozmaz ve hayalet push üretmez.

---

### [MEDIUM] DB-MIG-01 — Cron drift hiç uzlaştırılmamış: migration 014, sonraki hiçbir migration'ın unschedule etmediği 3 öksüz ai-proactive job bırakır → temiz DB reset 4 proaktif job alır (mükerrer nudge + CRON_SECRET ayarlıyken 3 eski job'ın sessiz 401'i)

**Dosya:** `supabase/migrations/056_cron_secret_header.sql:33-43, 79-94`; `supabase/migrations/014_cron_jobs.sql:41-84`

**Sorun:** Migration 014 isimle ÜÇ ai-proactive cron job zamanlar: 'kochko-proactive-morning' ('0 5 * * *'), '-afternoon' ('0 10 * * *'), '-evening' ('0 17 * * *') — her biri yalnızca Content-Type + Bearer service_role header'larıyla (x-cron-secret yok). Migration 056 x-cron-secret header'ını eklemek ve cron job'larını 'hizalamak' için yazılmış, ama unschedule döngüsü yalnızca `['kochko-tier2-extraction','kochko-tier3-extraction','kochko-proactive-hourly','kochko-photo-cleanup']`'u listeler. Yepyeni bir 'kochko-proactive-hourly' job ('7 * * * *') EKLER ve 014'ün üç eski jobname'ini asla unschedule etmez. 056'nın kendi yorumu canlı DB'nin elle tek 'kochko-proactive-hourly' job'a yamalandığını kabul eder ve uzlaştırmayı '057'ye erteler — ama migration 057 plan/hedef RPC'leriyle ilgilidir ve sıfır cron deyimi içerir. Repo-geneli grep, eski isimlerin YALNIZCA 014'te göründüğünü ve hiçbir yerde unschedule edilmediğini doğrular. Dolayısıyla herhangi bir temiz `supabase db reset`'te 014→056 zinciri DÖRT ai-proactive job verir: 3 eski header'sız (08:00/13:00/20:00 TR) + yeni saatlik.

**Etki:** Her temiz/yeni ortamda (yeni staging, CI, disaster-recovery yeniden-kurulum, ya da bir geliştiricinin `supabase db reset`'i): (1) ai-proactive eski job'lardan günde 3x VE her saat ateşlenir → kullanıcılar mükerrer proaktif koçluk nudge'ları / push bildirimleri alır, token/LLM maliyeti çoğalır. (2) CRON_SECRET ayarlandığı an (056'nın var olma sebebi olan güvenlik kontrolü), cron-auth'un denyIfNotCron'u 3 eski header'sız job'ı 401-reddeder (x-cron-secret göndermezler), bunlar sessizce ölürken saatlik job çalışmaya devam eder — kafa karıştırıcı yarı-bozuk durum. Production yalnızca elle yamalandığı için şu an OK. **Severity not:** Production bugün etkilenmez; defekt yalnızca yeniden-kurulumda görünür, üretimi-yıkma/güvenlik-ihlali değil reliability/drift sorunudur.

**Kanıt:**
```
014:41-43  SELECT cron.schedule('kochko-proactive-morning', '0 5 * * *', ...)  (+afternoon, +evening)
           header = Content-Type + Bearer service_role yalnızca
056:33-43  FOREACH jn IN ARRAY ['kochko-tier2-extraction','kochko-tier3-extraction',
             'kochko-proactive-hourly','kochko-photo-cleanup'] LOOP ... unschedule(jn)
           — 3 eski isim YOK
056:19 yorum: "014'teki 3 ayrı job yerine kochko-proactive-hourly... bu drift
        uzlaştırması ayrı 057 işidir"  ama 057'de cron yok.
grep 'kochko-proactive-morning|afternoon|evening' -> SADECE 014:42/57/72; 'unschedule' -> sadece 056
```

**Öneri:** Koşulsuz `PERFORM cron.unschedule('kochko-proactive-morning'/'afternoon'/'evening')` (her biri `IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ...)` ile korunmuş) çalıştıran bir migration ekleyin, böylece zincir 014'ten mi yoksa elle-yamalı canlı durumdan mı başladığından bağımsız olarak tek 'kochko-proactive-hourly' job'a yakınsar. Alternatif: migration 014'ün kendisini tek saatlik job'u (ve header'ı) zamanlayacak şekilde değiştirin.

---

### [MEDIUM] DB-MIG-02 — Migration 049 ADD CONSTRAINT weight_history_user_date_uniq idempotent değil (IF NOT EXISTS / pg_constraint guard yok) — yeniden-uygulama veya kısmi replay 42P07/42710 ile abort eder

**Dosya:** `supabase/migrations/049_weight_history_unique_per_day.sql:8-9`

**Sorun:** Migration çıplak `alter table weight_history add constraint weight_history_user_date_uniq unique (user_id, recorded_at);` ile biter. PostgreSQL'in `ADD CONSTRAINT`'inde `IF NOT EXISTS` formu yoktur ve bu deyim, projenin kendi sonraki migration'larının (063:30-41, 070:17-31, 054:20-29) tam olarak bu durum için doğru kullandığı `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) ... END $$` guard'ına sarılmamıştır. Migration 049 herhangi bir nedenle yeniden çalıştırılırsa (mid-chain başarısızlık sonrası `supabase db reset`, migration-history desync, ya da elle yeniden-uygulama) deyim tüm transaction'ı SQLSTATE 42710 ("constraint already exists") ile abort eder. Üstündeki de-dup DELETE zararsızca idempotenttir; yalnızca ADD CONSTRAINT tehlikedir.

**Etki:** Bu migration'ın yeniden-koşması (ya da onu iki kez dokunan temiz-yeniden-kurulum) migration transaction'ını başarısız yapar ve zincirin geri kalanının uygulanmasını engeller, elle müdahale gerektirir. Pristine bir kurulumda ilk-koşuşu etkilemez, ama son baseline çalışmasının (051) desteklemeyi amaçladığı recovery/reset iş akışlarına karşı migration'ı kırılgan yapar.

**Kanıt:**
```sql
-- 049:5-9
delete from weight_history a using weight_history b
  where a.user_id = b.user_id and a.recorded_at = b.recorded_at and a.id < b.id;
alter table weight_history
  add constraint weight_history_user_date_uniq unique (user_id, recorded_at);
-- karşılaştır 063:30-41 korumalı desen:
--   IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass
--     AND conname='profiles_periodic_state_check') THEN ALTER TABLE ... ADD CONSTRAINT ...
```

**Öneri:** ADD CONSTRAINT'i repoda zaten kullanılan idempotency guard'ına sarın: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.weight_history'::regclass AND conname='weight_history_user_date_uniq') THEN ALTER TABLE public.weight_history ADD CONSTRAINT weight_history_user_date_uniq UNIQUE (user_id, recorded_at); END IF; END $$;`

---

### [MEDIUM] DB-MIG-03 — Migration 050, household_members policy'lerini (hm_select_own / hm_delete_own / hm_insert_owned) DROP POLICY IF EXISTS guard'ı olmadan oluşturur — yeniden-uygulama 42710 ile abort eder

**Dosya:** `supabase/migrations/050_security_hardening_round2.sql:21-39`

**Sorun:** Migration 050 eski geniş policy'yi ('Users can manage own membership') drop eder ve sonra bu üç yeni isim için önceki bir `DROP POLICY IF EXISTS` olmadan üç çıplak `CREATE POLICY hm_select_own / hm_delete_own / hm_insert_owned ON public.household_members ...` çalıştırır. Tüm migration'larda grep, bu üç policy isminin yalnızca burada göründüğünü ve hiçbir yerde drop edilmediğini doğrular. `CREATE POLICY`'nin `IF NOT EXISTS` formu yoktur, dolayısıyla 050'nin herhangi bir replay'inde (kısmi başarısızlık sonrası db reset, migration-history desync, elle yeniden-koşma) ilk `CREATE POLICY hm_select_own` transaction'ı SQLSTATE 42710 ile abort eder. Bu, son sertleştirmede her diğer policy için kullanılan projenin standart DROP-then-CREATE desenine (045:34-38, 046:19-29, 047:10-14, 053:20) aykırıdır ve 050'yi istisna yapar.

**Etki:** Migration 050'nin yeniden-koşması migration transaction'ını başarısız yapar ve bir operatör üç policy'yi elle drop edene kadar zincirin geri kalanını durdurur. İlk-kez temiz kurulumu etkilemez, ama household RLS sertleştirmesi için idempotency/replay-güvenliğini kırar — herhangi bir yeniden-kurulum/recovery akışında regresyon riski.

**Kanıt:**
```sql
-- 050:21-39
DROP POLICY IF EXISTS "Users can manage own membership" ON public.household_members;
CREATE POLICY hm_select_own ON public.household_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY hm_delete_own ON public.household_members ...
CREATE POLICY hm_insert_owned ON public.household_members ...
-- üç yeni isim için DROP yok.
-- grep 'hm_select_own|hm_delete_own|hm_insert_owned' -> sadece 050:23/27/33
```

**Öneri:** Her CREATE'ten önce `DROP POLICY IF EXISTS hm_select_own ON public.household_members;` (ve hm_delete_own, hm_insert_owned için de) ekleyin, 045/046/047/053'ün kullandığı DROP-then-CREATE konvansiyonuyla eşleşsin.

---

### [MEDIUM] DB-IDX-01 — goals.user_id yalnızca PARTIAL indekslere sahip (WHERE is_active=true) — FK cascade ve tam-geçmiş okumalar indekssiz seq scan yapar

**Dosya:** `supabase/migrations/001_profiles_and_goals.sql:128`; `supabase/migrations/033_goals_single_active.sql:20-21`; `src/services/goals.service.ts:21-27, 52-58`

**Sorun:** `goals.user_id` ile başlayan her indeks `WHERE is_active = true` üzerinde PARTIAL'dır: `idx_goals_user_active ON goals(user_id, is_active) WHERE is_active = TRUE` (001:128) ve `uniq_goals_one_active_per_user ON goals(user_id) WHERE is_active = true` (033:20). `goals.user_id` üzerinde tam (kısmi-olmayan) indeks YOKTUR (71 migration'ın grep'i yalnızca bu ikisini döner). Postgres, kısmi predikatı geçemeyen satırları içeren bir lookup'ı bir kısmi indeksle karşılayamaz, dolayısıyla (a) profiles'tan gelen `ON DELETE CASCADE` hesap silme sırasında kullanıcının inaktif hedeflerini bulmak için goals'ı seq-scan etmeli ve (b) `goals.service.ts` `getGoalPhases()` (`.eq('user_id',userId).order('phase_order')`, satır 21) ve `addPhase()`'in max-phase probe'u (satır 52) kullanıcının TÜM hedeflerini (aktif ve inaktif) okur ve hiçbir kısmi indeksle hizmet edilmez.

**Etki:** Multi-faz hedef kullanıcıları inaktif (is_active=false) hedef satırları biriktirir (faz geçmişi). `getGoalPhases` hedefler/fazlar ekranında, cascade ise her KVKK hesap silmesinde çalışır; ikisi de goals tablosu büyüdükçe sıralı tarama yapar. Bugün tablo küçük olduğundan gecikme alt-ms ama erişim-yolu yanlıştır ve toplam hedef sayısıyla doğrusal bozulur. (goals: 14 satır, is_active=false: 1.)

**Kanıt:**
```sql
001:128  CREATE INDEX idx_goals_user_active ON goals(user_id, is_active) WHERE is_active = TRUE;
033:20   CREATE UNIQUE INDEX IF NOT EXISTS uniq_goals_one_active_per_user ON goals(user_id) WHERE is_active = true;
-- goals.service.ts:23  .from('goals').select('*').eq('user_id', userId).order('phase_order');
--   // is_active filtresi YOK -> kısmi indeks kullanılamaz
-- goals.user_id REFERENCES profiles(id) ON DELETE CASCADE (001:115); hesap silme cron'u
--   hard DELETE FROM profiles (068:90) yapar -> cascade goals'ı tarar.
```

**Öneri:** Düz bir kapsayıcı indeks ekleyin: `CREATE INDEX idx_goals_user ON public.goals(user_id);` (ya da getGoalPhases'in ORDER BY'ına da hizmet etmek için `(user_id, phase_order)`). İki mevcut kısmi indeks kalabilir — aktif-hedef sıcak okumasına hizmet ederler.

---

### [MEDIUM] DB-IDX-02 — idx_meal_logs_user_logged_at PARTIAL'dır (WHERE is_deleted=false) ama onu gerekçelendiren sıcak sorgu is_deleted predikatını atlar, dolayısıyla indeks o sorgu tarafından asla kullanılmaz

**Dosya:** `supabase/migrations/060_perf_and_fk_covering_indexes.sql:44-46`; `src/services/realtime-sync.service.ts:241`

**Sorun:** Migration 060 `idx_meal_logs_user_logged_at ON public.meal_logs (user_id, logged_at desc) WHERE is_deleted = false` oluşturdu ve header yorumu indeksi `realtime-sync.service.ts:241`'i (logged_at DESC sıralayan sıcak sorgu) açıkça gerekçelendirir. Ama satır 241'deki gerçek sorgu `supabase.from('meal_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(50)`'dir — `.eq('is_deleted', false)` İÇERMEZ. Sorgu predikatı indeksin kısmi WHERE'iyle eşleşmediğinden planlayıcı bu sorgu için kısmi indeksi kullanamaz; `(user_id)` indeks scan + bellek-içi sort'a ya da seq scan + sort'a geri düşer. Tek diğer meal_logs indeksi `idx_meal_logs_user_date (user_id, logged_for_date)` logged_for_date (date) üzerindedir, logged_at (timestamptz) değil, dolayısıyla ORDER BY'a da hizmet etmez.

**Etki:** `forceSync` pull'u (uygulama foreground/reconnect'te çalışır) kullanıcının tüm meal_logs geçmişini logged_at'e göre sıralayıp en yeni 50'yi alır, sort için indeks desteği olmadan. Tam bu sorgu için eklenen indeks, bu sorgu için ölü ağırlıktır (yine de INSERT/UPDATE bakımı ödenir) ve sıfır fayda sağlar. Her loglanan öğünle büyür. İkincil doğruluk hatası: filtre olmadığı için soft-delete edilmiş öğünler (canlı: is_deleted=true 4 satır) de yanlışça döndürülür.

**Kanıt:**
```
060:44  create index if not exists idx_meal_logs_user_logged_at
          on public.meal_logs (user_id, logged_at desc) where is_deleted = false;
060 header: "meal_logs(user_id, logged_at DESC) — sıcak sorgular logged_at DESC
             sıralıyor (realtime-sync.service.ts:241 ...)"
realtime-sync.service.ts:241  supabase.from('meal_logs').select('*')
  .eq('user_id', userId).order('logged_at', { ascending: false }).limit(50)
  // <-- is_deleted=false YOK, kısmi indeks kullanılamaz
Canlı: meal_logs is_deleted=true count = 4 (filtresiz sorgu bunları da yanlış döner)
```

**Öneri:** Ya realtime-sync sorgusuna `.eq('is_deleted', false)` ekleyin (kısmi indeksle eşleşir VE soft-delete edilmiş öğünleri döndürmeyi keser — tercih edilen düzeltme), ya da indeksi kısmi-olmayan yapın. Sorguyu hizalamak hem erişim-yolunu düzeltir hem de yanlış sonuç dönüşünü durdurur.

---

### [MEDIUM] DB-IDX-03 — loadSessions, oturum-başı son-mesaj önizlemelerini göstermek için 20 oturumun her mesajını aşırı-çeker

**Dosya:** `src/services/chat.service.ts:384-400`

**Sorun:** `loadSessions()` en yeni 20 chat_sessions'ı çeker, sonra `supabase.from('chat_messages').select('session_id, content, created_at').in('session_id', ids).order('created_at', { ascending: false })`'i oturum-başı limit OLMADAN çalıştırır ve istemci tarafında her session_id için yalnızca ilk (en yeni) satırı tutar — gerisini atar. Postgres/PostgREST'in tek bir `.in()+order` sorgusunda oturum-başı yalnızca en yeni satırı döndürmesinin yolu yoktur, dolayısıyla veritabanı 20 oturumdaki HER mesajı döndürür ve cihaz indirir. `idx_chat_messages_session (session_id, created_at)` indeksi lookup'a yardım eder ama aktarılan satır sayısını sınırlamaz. Kod yorumu bunun bir N+1'i öldürmek için kasıtlı bir takas olduğunu kabul eder, ama N round-trip'i tek bir devasa aşırı-çekmeyle değiştirdi.

**Etki:** Chat-geçmişi liste ekranında, 20 oturumlu (her biri onlarca mesaj) aktif bir kullanıcı, en fazla 20 adet 80-karakter önizleme parçacığı render etmek için ekran açılışı başına yüzlerce-ila-binlerce tam mesaj gövdesi (content text) indirir. Ağ, bellek ve parse maliyeti gösterilen 20 önizlemeyle değil toplam mesaj hacmiyle ölçeklenir. chat_messages zaten en büyük tablodur (küçük dev DB'de 518 satır) ve production'da en hızlı büyür (mesaj başına bir satır).

**Kanıt:**
```js
chat.service.ts:384  const { data: msgs } = await supabase
  .from('chat_messages').select('session_id, content, created_at')
  .in('session_id', ids)
  .order('created_at', { ascending: false });   // oturum-başı .limit() YOK — tüm 20 oturumun TÜM mesajları
...
for (const m of msgs ...) {
  if (!lastBySession.has(m.session_id)) lastBySession.set(m.session_id, m.content);
}  // oturum başına yalnızca ilk tutulur; gerisi indirilir sonra atılır
```

**Öneri:** Sıralama için zaten seçilen `chat_sessions.message_count/updated_at`'i kullanın ve önizlemeleri lazy çekin, ya da oturum başına tam olarak bir son-mesaj satırı döndüren bir DB-side helper ekleyin (örn. `DISTINCT ON (session_id) ... ORDER BY session_id, created_at DESC` kullanan `SECURITY DEFINER` RPC). Alternatif: chat_sessions üzerinde denormalize bir last_message snippet'i saklayın ve insert'te güncelleyin.

---

### [MEDIUM] DB-TRG-02 — ai-proactive cron, atomik olmayan deactivate+reactivate hedef-fazı takası yapar (atomik set_active_goal RPC'sini atlar) ve yanlış (önceki) fazı yeniden-aktive edebilir

**Dosya:** `supabase/functions/ai-proactive/index.ts:906-913` (nextPhase select 906-909; takas 912-913)

**Sorun:** Migration 057, tek-aktif-hedef invariantının TEK bir transaction içinde korunması için `set_active_goal` `SECURITY DEFINER` RPC'sini oluşturdu ('başarısız insert kullanıcıyı asla 0 aktif hedefle bırakamaz') ve ai-chat goal_suggestion bunu doğru çağırır (index.ts:3852). Ama ai-proactive otomatik-faz-ilerletme yolu hiçbir zaman atomik yazıma taşınmadı: iki bağımsız `supabaseAdmin.update()` çağrısı çalıştırır — satır 912 mevcut aktif hedefi devre dışı bırakır, satır 913 nextPhase.id'yi aktive eder. Bunlar transaction wrapper'ı olmayan iki ayrı deyimdir; ikinci UPDATE birincisinden sonra başarısız olursa kullanıcı 0 aktif hedefle kalır. Ayrıca 906-909'daki nextPhase sorgusu, mevcuttan hemen sonraki fazı değil, `phase_order>1` olan HERHANGİ bir inaktif hedefi artan sırada seçer (`.gt('phase_order',1).order('phase_order').limit(1)`); dolayısıyla faz 3'te oturan 3-fazlı bir hedefte faz 2'yi (geriye) yeniden-aktive edebilir, aktif-faz işaretçisini bozar.

**Etki:** Bir cron koşusunda kısmi başarısızlık geçici olarak kullanıcıyı hedefsiz bırakır — DB-TRG-01 ile aynı downstream bozulma (dashboard, koç, TDEE için kayıp hedef bağlamı). DB-TRG-01'den düşük severity çünkü yalnızca sunucu-tarafı proaktif cron'da çalışır (düşük frekans, günlük retry) ve takas çalıştığında nextPhase'in var olduğu garantilidir, dolayısıyla deterministik son-faz veri-kaybı durumu burada uygulanmaz. Geriye-faz-seçim hatası bir kullanıcıyı önceki fazın kalori hedefine sessizce regresyona da uğratabilir (3+ faz varken deterministik).

**Kanıt:**
```js
// ai-proactive/index.ts:906-913
const { data: nextPhase } = await supabaseAdmin
  .from('goals').select('id, goal_type, phase_label, weekly_rate')
  .eq('user_id', profile.id).eq('is_active', false)
  .gt('phase_order', 1).order('phase_order').limit(1).maybeSingle();
if (nextPhase) {
  await supabaseAdmin.from('goals').update({ is_active: false })
    .eq('user_id', profile.id).eq('is_active', true);
  await supabaseAdmin.from('goals').update({ is_active: true }).eq('id', nextPhase.id);
// Atomik yol var ve başka yerde kullanılıyor (ai-chat/index.ts:3852):
//   await supabaseAdmin.rpc('set_active_goal', { p_user: userId, p_goal: {...} })
```

**Öneri:** Satır 912-913'ü tek bir transactional RPC ile değiştirin (`set_active_goal`'u genişletin ya da `swap_active_goal_phase(p_user, p_next_goal_id)` `SECURITY DEFINER` fonksiyonu ekleyin) — mevcudu devre dışı bırakıp hedefi tek transaction'da aktive etsin. nextPhase seçimini, en düşük inaktif `phase_order>1` yerine `phase_order = currentActivePhase.phase_order + 1` olan fazı seçecek şekilde düzeltin.

---

### [MEDIUM] DB-PRV-01 — KVKK Md.20 veri-taşınabilirliği export'u, "TÜM veri" iddiasına rağmen kullanıcıya-ait PII tablolarını (repair_history, user_sessions, barcode_corrections) atlar

**Dosya:** `src/services/export.service.ts:28-60`

**Sorun:** `exportJSON()` ~31 tablonun sabit bir `queries` haritasını kurar. Kişisel veri tutan üç kullanıcıya-ait tablo sorgulanmaz: `repair_history` (kullanıcının gerçek öğün/düzeltme metni, RLS auth.uid()=user_id migration 011:21-24), `user_sessions` (device_info, app_version, push_token migration 024:10-28) ve `barcode_corrections` (kullanıcı-atfedilen besin düzeltmeleri, RLS auth.uid()=user_id migration 009:22-34). Üçü de authenticated kullanıcı tarafından RLS altında erişilebilir ve hesapla cascade-silinir, yani taşınabilirliğe tabi kişisel veridir. Bu arada `app/settings/index.tsx:170` kullanıcıya "Tüm verilerini dışa aktarabilir" der ve `export.service.ts:96` audit olayını "Kullanici tum verisini JSON olarak disa aktardi" olarak kaydeder.

**Etki:** KVKK Md.20 / GDPR Art.20 taşınabilirlik export'u eksiktir: "tüm verim" isteyen kullanıcı öğün-düzeltme geçmişini, giriş/cihaz geçmişini ya da barkod düzeltmelerini almaz. Ürün ayrıca UI'da ve kendi audit izinde yanlış bir 'tam export' iddiasında bulunur ki bu da bir uyum riskidir. (Pratik etki ılımlı: atlanan tablolar operasyonel/cihaz verisi + düşük-değerli düzeltme geçmişi; çekirdek beslenme/sağlık verisi export edilir.)

**Kanıt:**
```
export.service.ts queries haritası (repair_history / user_sessions / barcode_corrections YOK):
  profile, ai_summary, goals, meal_logs, workout_logs, daily_metrics, daily_reports,
  weekly_reports, monthly_reports, daily_plans, weekly_plans, chat_sessions, chat_messages,
  coaching_messages, health_events, lab_values, food_preferences, supplement_logs,
  weight_history, meal_templates, user_venues, user_commitments, ai_feedback, saved_recipes,
  challenges, achievements, coach_consents, household_members, subscriptions, progress_photos
UI iddiası app/settings/index.tsx:170: 'Tüm verilerini dışa aktarabilir...'
Canlı (service_role): GET /repair_history -> {"user_id":"4d0a97c4-...","repair_type":"undo",
  "original_text":"dinner: 200 gram ızgara tavuk ve salata"}  (kişisel öğün metni, export'ta yok)
migration 011:21-24 'CREATE POLICY ... ON repair_history FOR ALL USING (auth.uid() = user_id)'
```

**Öneri:** `repair_history`, `user_sessions` ve `barcode_corrections`'ı (kullanıcının kendi satırları) `exportJSON()`'daki `queries` haritasına ekleyin. Export tablo listesini kullanıcıya-ait tabloların tek-doğruluk-kaynağı bir listesinden üretmeyi düşünün (yeni tablolar sessizce düşmesin) ve user_id/owner_id kolonu olan her public tablonun ya export edildiğini ya da belgelenmiş bir gerekçeyle hariç tutulduğunu doğrulayan bir test ekleyin.

---

### [MEDIUM] DB-PRV-02 — Kullanıcılar kendi audit_logs satırlarını sahteleyebilir/uydurabilir (audit izi forensik kanıt olarak tahrif-kanıtlı değil)

**Dosya:** `supabase/migrations/064_audit_logs_dedupe_select_policy.sql:15-16`

**Sorun:** `audit_logs`'ta `audit_logs_insert_own` INSERT policy'si `WITH CHECK (auth.uid() = user_id)` ile vardır (istemci KVKK olaylarını `privacy.service.ts:231` ve `audit-log.service.ts:44`'ten yazdığı için gereklidir). Canlı doğrulandı: yeni oluşturulmuş bir authenticated kullanıcı olarak, hiç gerçekleşmemiş bir 'data_export' olayını iddia eden keyfi bir audit satırı eklemek BAŞARILI olur (HTTP 201). BAŞKA bir kullanıcı için ekleme doğru engellenir (403). Kendi satırlarının UPDATE ve DELETE'i doğru engellenir (policy yok → 0 satır). Yani iz kullanıcı tarafından tahrif edilemez veya silinemez, ama UYDURULABILIR; bu da audit_logs'un gerçekte ne olduğunun güvenilir kanıtı olarak hizmet edemeyeceği anlamına gelir (örn. kullanıcı sahte 'account_delete_request'/'data_export' satırları ekleyebilir).

**Etki:** KVKK/GDPR audit log'u, sorumlu tutmayı amaçladığı öznenin kendisi tarafından uydurulabilir, dolayısıyla bir anlaşmazlık veya regülatör soruşturmasında sınırlı kanıt değeri taşır. Gerçek uyum-kritik olaylar (silme istekleri, export'lar) kullanıcı-uydurma olanlardan ayırt edilemez. (Hafifletici: en kritik olaylar AYRICA service_role altında sistem-tarafında yazılır — ai-chat/index.ts:205 account_delete_request'i supabaseAdmin ile yazar; 30-günlük hard-delete ayrı account_deletion_audit tablosuna kaydedilir, migration 068 — dolayısıyla uydurulmuş istemci satırı sistem kaydının yerine değil yanına eklenir.)

**Kanıt:**
```
Canlı test (authenticated user 73b7b24d-...):
INSERT forged own: {"s":201, ... "event_type":"data_export","description":"FORGED never happened"}
INSERT for other user: {"s":403, "message":"new row violates row-level security policy for audit_logs"}
UPDATE own: {"s":200,"b":"[]"}  (0 satır — engellendi)
DELETE own: {"s":200,"b":"[]"}  (0 satır — engellendi)
migration 064: 'audit_logs_insert_own  cmd=INSERT  with_check=(auth.uid()=user_id) {public}'
(politika kaynağı 027:31-33, 038:48-49 ile korunur — yalnızca ayrı 'Service can insert' politikası service_role'a kısıtlandı)
```

**Öneri:** Tüm KVKK uyum-kritik olaylarını (data_export, account_delete_request/cancel, ai_summary_delete) `SECURITY DEFINER` RPC'ler ya da service_role altında yazan edge fonksiyonları üzerinden yönlendirin ve public `WITH CHECK(auth.uid()=user_id)` INSERT policy'sini kaldırın (ya da kanıt-niteliğinde-olmayan event_type'lara kısıtlayın). INSERT'ü service_role'a sınırlayın, böylece iz sistem-yazımlı olur. UPDATE/DELETE'in yokluğu (doğrulandı) doğrudur.

---

### [MEDIUM] DB-PRV-03 — Özel-nitelikli sağlık verisi, pgsodium scaffolding'i kaldırıldıktan (migration 069) sonra düz-metinde saklanıyor

**Dosya:** `supabase/migrations/069_cleanup_inert_pgsodium.sql:67-71`

**Sorun:** Migration 069, inert pgsodium şifreleme scaffolding'ini (decrypted_health_events view, description_nonce / event_type_nonce kolonları, SECURITY LABEL'lar) düşürdü çünkü yazım-anı şifreleme hiçbir zaman gerçekte aktif değildi. Canlı doğrulandı: view ve nonce kolonları gitti (GET /decrypted_health_events -> 404; GET health_events nonce kolonlarıyla -> 42703 column does not exist). `health_events.description` ve `event_type` artık KVKK 'özel nitelikli kişisel veri' / GDPR Art.9 özel-kategori sağlık verisini düz-metinde tutar. Canlı doğrulandı: gerçek bir satır 'diz sakatligi - sol diz meniskus yirtigi, doktor squat ve kosu yasakladi' içerir. `lab_values` (glikoz vb.) de düz-metindir. Koruma artık yalnızca Supabase'in at-rest disk şifrelemesi ve RLS'e dayanır; bu en-hassas kategori için uygulama/kolon-seviyesi şifreleme yoktur.

**Etki:** Sağlık/tıbbi durumlar ve sakatlıklar — KVKK Md.6 ve GDPR Art.9 altında en yüksek korumayı hak eden özel-kategori veri — düz-metinde durur. RLS'i atlayan herhangi bir okuma yolu (service_role key sızıntısı, gelecekteki geniş bir SECURITY DEFINER fonksiyonu, bir loglama/export hatası) isimlendirilmiş tıbbi durumları açığa çıkarır. Bu bir regresyon değil rezidüel mahremiyet riskidir, ama sessiz değil izlenen bir karar olmalıdır. (Not: pgsodium scaffolding'i 069 öncesinde de provably inert idi — her nonce NULL'du — dolayısıyla 069 gerçek koruma değil yanlış bir güvenlik hissi kaldırdı; net güvenlik duruşu değişmedi.)

**Kanıt:**
```
Canlı: GET /decrypted_health_events -> 404 PGRST205 (view gitti)
GET /health_events?select=...,description_nonce -> 42703 'column ... does not exist'
GET /health_events -> [{"event_type":"injury","description":"diz sakatligi - sol diz
   meniskus yirtigi, doktor squat ve kosu yasakladi","is_ongoing":true}]
migration 069:70-71 'ALTER TABLE public.health_events DROP COLUMN IF EXISTS description_nonce;
   DROP COLUMN IF EXISTS event_type_nonce;'
```

**Öneri:** Pozisyonu açıkça karara bağlayın ve belgeleyin. At-rest disk şifrelemesi + RLS tehdit modeli için yeterli görülüyorsa, bunu privacy/DPIA dokümanlarında kabul edilmiş risk olarak kaydedin. Değilse, `health_events.description/event_type` ve `lab_values` için gerçek kolon-seviyesi şifreleme uygulayın (örn. KMS-tutulan anahtarla envelope encryption, yalnızca ihtiyaç duyan edge fonksiyonunda decrypt edilen) ve yazımları/okumaları o yoldan geçirin.

---

### [MEDIUM] DB-PRV-04 — Settings-ekranı hesap-silme yolu silme bayraklarını doğrudan yazar ve HİÇBİR KVKK 'account_delete_request' audit olayı çıkarmaz (privacy.service yoluyla tutarsız)

**Dosya:** `app/settings/index.tsx:56-69`

**Sorun:** İki silme giriş noktası vardır. `privacy.service.requestAccountDeletion()` (privacy.service.ts:26-38) bayrakları ayarlar VE bir KVKK audit olayı `logAuditEvent(userId,'account_delete_request',...)` yazar. Settings ekranının `confirmDelete()`'i bunun yerine bayrakları `supabase.from('profiles').update({deletion_requested_at, deleted_at})` ile doğrudan yazar ve sonra çıkış yapar — asla `requestAccountDeletion()` çağırmaz ve asla audit olayı çıkarmaz. Dolayısıyla Settings'ten (birincil UI yolu) başlatılan bir silme, grace-window içinde kullanıcının silme talebinde bulunduğuna dair hiçbir kayıt bırakmaz. Kalıcı `account_deletion_audit` tablosu (migration 068) yalnızca nihai cron-yürütülen hard-delete'i kaydeder (reason='grace_period_expired'); bu yoldan gelen orijinal kullanıcı-başlatımlı talebi yakalamaz.

**Etki:** Ana Settings UI üzerinden yapılan silmeler için, 30-günlük grace-window boyunca kullanıcının silme talebinin çağdaş bir KVKK/GDPR kaydı yoktur — uyum izini zayıflatır ve iki kod yolu arasında uyumsuz davranış yaratır (biri loglar, diğeri loglamaz). Ayrıca Settings confirmDelete yolu fiilen TEK hayatta kalan UI silme yoludur (profil-sekmesi yolu kaldırılıp /settings'e yönlendirildi, app/(tabs)/profile.tsx:133-136), dolayısıyla denetlenen kod yolu (requestAccountDeletion) ölü, denetlenmeyen Settings yolu canlıdır.

**Kanıt:**
```js
app/settings/index.tsx:56-59
  const { data, error } = await supabase.from('profiles')
    .update({ deletion_requested_at: now, deleted_at: now }).eq('id', user.id).select('id');
  // ... satır 69 signOut(); — logAuditEvent çağrısı YOK
// Karşılaştır privacy.service.ts:36
//   await logAuditEvent(userId, 'account_delete_request', 'Kullanici hesap silme talebinde bulundu', {...})
```

**Öneri:** `confirmDelete()`'in profiles UPDATE'ini inline etmek yerine `privacy.service.requestAccountDeletion(user.id)` çağırmasını sağlayın, böylece her iki yol aynı bayrak-ayarlama VE audit-loglama mantığını paylaşır. Alternatif: aynı `account_delete_request` audit olayını Settings yolundan da yazın.

---

### [MEDIUM] DB-PRM-01 — Plan-onay free-cap'i atomik olmayan check-then-increment (lost-update / eşzamanlı-onay bypass)

**Dosya:** `supabase/functions/ai-chat/index.ts:1213-1226, 1298-1305`

**Sorun:** Free-tier plan cap'i (1 ömür-boyu diyet + 1 ömür-boyu antrenman) TAMAMEN ai-chat edge'de atomik OLMAYAN bir read-modify-write olarak zorlanır. Kapı önce `profiles.plans_used_free`'yi OKUR (1213-1218) ve `used[type] >= 1` ise reddeder. Çok sonra, promosyon sonrası, `plans_used_free`'yi YENİDEN-OKUR (1298-1302), `nextUsed = used+1` hesaplar ve sonucu hiç kontrol edilmeyen düz bir `.update` (1305) ile geri yazar. Check ve increment'i kapsayan satır kilidi, transaction ve DB-side atomik increment/cap yoktur (promote_weekly_plan RPC migration 057 cap'i zorlamaz — yalnızca arşivler+promosyon yapar). Aynı plan_type için eşzamanlı ateşlenen iki onay isteği ikisi de used=0 okur, ikisi de kapıyı geçer, ikisi de promosyon yapar ve ikisi de plans_used_free=1 yazar (klasik lost update) — 2 yerine. Free kullanıcı kasıtlı olarak iki 'approve' çağrısını yarıştırarak sayacı 1'de sabit tutarken modelin izin verdiğinden fazla onay tüketir.

**Etki:** Free kullanıcılar, kasıtlı eşzamanlı isteklerle, amaçlanan tip-başı 1-ömür-boyu free kotanın ötesinde plan onaylayabilir/yeniden-onaylayabilir, bir premium satış noktasını aşındırır. Veri kaybı veya güvenlik ihlali değildir (unique indeks sayesinde tip başına yalnızca bir plan aktif kalır), bu yüzden HIGH değil MEDIUM; kasıtlı eşzamanlılık gerektirir.

**Kanıt:**
```js
// Kapı (1213-1218):
const { data: gateProfile } = await supabaseAdmin
  .from('profiles').select('premium, premium_expires_at, plans_used_free').eq('id', userId).maybeSingle();
... if ((used[expectedType] ?? 0) >= 1) { return respond({ ... plan_persist_error: 'free_quota_used' ... }); }
// Increment (1298-1305), ayrı read-modify-write, sonuç kontrol edilmez:
const { data: profUsed } = await supabaseAdmin
  .from('profiles').select('plans_used_free').eq('id', userId).maybeSingle();
const used = (profUsed?.plans_used_free) ?? { diet: 0, workout: 0 };
const nextUsed = { ...used, [expectedType]: (used[expectedType] ?? 0) + 1 };
await supabaseAdmin.from('profiles').update({ plans_used_free: nextUsed }).eq('id', userId);
// migration 057/071 promote_weekly_plan'da cap kontrolü YOK (yalnızca archive+promote)
```

**Öneri:** Cap'i DB'de atomik yapın: ya (a) kota kontrolü + increment'i tek transaction'da profiles satırında `SELECT ... FOR UPDATE` ile promote_weekly_plan RPC'sine katlayıp cap-aşımında raise edin; ya da (b) profiles'ı FOR UPDATE kilitleyen, plans_used_free'yi premium durumuna karşı yeniden-kontrol eden ve tek deyimde artıran özel bir `SECURITY DEFINER` increment RPC'si ekleyin (örn. `UPDATE ... SET plans_used_free = jsonb_set(...) WHERE used < 1`). Update sonucunu 0-satır için kontrol edin ve `free_quota_used` olarak ele alın.

---

### [LOW] DB-FK-01 — user_commitments.source_message_id'nin chat_messages'a FK'si yok (zorlanmayan referans)

**Dosya:** `supabase/migrations/003_ai_memory_and_chat.sql:130`

**Sorun:** `user_commitments.source_message_id` çıplak bir UUID olarak deklare edilmiştir, FOREIGN KEY kısıtı yoktur, oysa semantik olarak `chat_messages(id)`'ye (commitment'ı üreten chat turn'üne) referans verir. Canlı doğrulama: PostgREST embedding `user_commitments?select=id,chat_messages(id)` PGRST200 "Could not find a relationship" döner, canlı DB'de FK OLMADIĞINI kanıtlar. Bu kolon doldurulsaydı, bir chat_message silmek (chat_session kaldırıldığında 054 chat_messages_session_id_fkey ON DELETE CASCADE ile cascade-silinir) var olmayan bir satıra işaret eden dangling source_message_id bırakırdı. **Severity'yi düşüren bağlam:** her insert yolu bu kolonu atlar (ai-chat/index.ts:3106, 3476, 3489 yalnızca user_id, commitment, follow_up_at, status yazar); canlı veride user_commitments'ta 0 satır var ve kolon fiilen ölüdür. Mevcut/yakın bir orphan yoktur; bu latent bir şema boşluğudur.

**Etki:** Mevcut veri etkisi yok (kolon hiç yazılmaz, tablo boştur). Commitment-izlenebilirlik özelliği source_message_id'yi dolduracak şekilde bağlanırsa, FK + ON DELETE kuralının yokluğu silinmiş chat mesajlarına dangling referanslara izin verir. Bugün için saf şema-hijyeni boşluğu.

**Kanıt:**
```
003:130 `source_message_id UUID,`  (REFERENCES yok)
Canlı PostgREST: GET /rest/v1/user_commitments?select=id,chat_messages(id)
  -> 400 {"code":"PGRST200","message":"Could not find a relationship ... in the schema cache"}
Insert (ai-chat:3106-3109): insert({ user_id, commitment, follow_up_at, status: 'pending' }) — source_message_id atlanmış
Canlı sayım: user_commitments rows=0
```

**Öneri:** Ya (a) kolon kullanılacaksa FK ekleyin: `ALTER TABLE public.user_commitments ADD CONSTRAINT user_commitments_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;` (SET NULL seçilir, böylece chat mesajı silindiğinde commitment kalır ama anlamsız link düşer), ya da (b) hiçbir kod yazmadığı için kullanılmayan kolonu tamamen kaldırın. Burada ON DELETE CASCADE KULLANMAYIN.

---

### [LOW] DB-MIG-04 — Migration 056 (cron x-cron-secret) canlıya hiç uygulanmadı ve canlı cron elle-yamalı kaldı — migration'lar fail-open header'sız cron tanımlar, temiz yeniden-kurulum production'dan sessizce farklılaşır

**Dosya:** `supabase/migrations/056_cron_secret_header.sql:8-21`

**Sorun:** Migration 056'nın kendi dokümantasyonu canlı cron job'larının elle yamalandığını ("Canlı job'lar elle yamandı (secret içeriyor) ama migration dosyaları geride kaldı") ve 014'ün üç proaktif job'unun canlıda 056 yazılmadan önce tek 'kochko-proactive-hourly'ye çökertildiğini belirtir. DB-MIG-01 ile birleşince, deklare edilen migration topolojisi (014'ün 3 header'sız job'u) ile gerçek canlı topoloji (1 saatlik elle-yamalı header'lı job) ayrışmıştır ve migration zinciri canlı duruma yakınsamaz. `current_setting('app.settings.cron_secret', true)` ile okunan CRON_SECRET GUC'u bir operasyonel adımdır ve hiçbir seed/config migration'da ayarlanmaz, dolayısıyla 056'nın davranışı ortam-bağımlı ve belgesizdir.

**Etki:** Production'da bugün runtime kırılması değil dokümantasyon/operasyonel drift: herhangi bir temiz yeniden-kurulum elle-yamalı canlı topoloji yerine header'sız eski job'ları yeniden üretir (DB-MIG-01'e bkz.), dolayısıyla migration'lar artık konuşlandırılmış programın sadık bir açıklaması değildir. Bir operatörün `db reset`'in production'ı yeniden üreteceğine güvenip farklı bir cron seti almasını olası kılar. (DB-MIG-01 düzeltilirse bu bulgu büyük ölçüde kapsanır.)

**Kanıt:**
```
056:8-10 `-- Canlı job'lar elle yamandı (secret içeriyor) ama migration dosyaları geride kaldı`
056:19-21 secret = current_setting('app.settings.cron_secret', true)  (missing_ok=true -> unset'te NULL -> cron-auth fail-open)
grep app.settings.cron_secret -> sadece 056; GUC'u ayarlayan migration yok.
migration 064 -> audit_logs policy dedupe (056'nın ima ettiği cron-secret/Vault migration'ı DEĞİL)
```

**Öneri:** Cron uzlaştırmasını (eski isimleri unschedule, tek saatlik job, header) migration'lara katlayın, böylece temiz uygulama canlıya eşit olsun, ve gerekli `ALTER DATABASE ... SET app.settings.cron_secret` adımını belgelenmiş bir yerde kaydedin (ya da 056'nın ima ettiği gibi secret'ı Vault'a taşıyın).

---

### [LOW] DB-IDX-04 — coach_consents.coach_id FK'si yalnızca PARTIAL indeksle (WHERE is_active=true) destekleniyor; bir coach profili silmek coach_consents'i seq-scan eder

**Dosya:** `supabase/migrations/051_baseline_household_coach_tables.sql:38`; `supabase/migrations/060_perf_and_fk_covering_indexes.sql:49-51`

**Sorun:** `coach_consents.coach_id` `uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`'dir (051:38). coach_id ile başlayan tek indeks PARTIAL `idx_coach_consents_coach_active ON coach_consents (coach_id) WHERE is_active = true`'dur (060:49). Bir kısmi indeks FK'nin ON DELETE CASCADE referans aksiyonunu zorlamak için kullanılamaz, çünkü cascade silinen coach_id'ye referans veren TÜM satırları — iptal edilmiş onaylar (is_active=false) dahil — bulmalıdır. coach_id üzerinde tam indeks olmadığından, bir coach profilini silmek coach_consents'in sıralı taramasını tetikler. (Kardeş FK coach_consents.user_id sorunsuzdur: UNIQUE(user_id, coach_id) kısıt indeksinin önde gelen kolonuyla kapsanır.)

**Etki:** Bir coach hesabı silindiğinde (bir coach'un KVKK silmesi), coach_consents.coach_id'ye cascade tabloyu seq-scan eder. Severity LOW çünkü coach özelliği şu an kullanılmaz (canlı coach_consents satır sayısı = 0) ve coach'lar nadirdir, ama FK erişim-yolu eksiktir ve özellik benimsenip tablo büyürse bozulur.

**Kanıt:**
```sql
051:38  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
060:49  create index if not exists idx_coach_consents_coach_active
          on public.coach_consents (coach_id) where is_active = true;
        // partial — is_active=false satırlar için FK cascade'e hizmet edemez
Canlı: coach_consents total row count = 0 (özellik henüz kullanılmıyor)
```

**Öneri:** FK cascade için tam kapsayıcı indeks ekleyin: `CREATE INDEX idx_coach_consents_coach ON public.coach_consents(coach_id);`. Kısmi indeks aktif-onay okuma yolu için kalabilir, ya da tam indeks + is_active koşul kolonuyla değiştirilebilir.

---

### [LOW] DB-IDX-05 — user_commitments'ta gereksiz indeks: idx_commitments_pending, idx_commitments_user tarafından tamamen gölgelenir, saf yazım yükü ekler

**Dosya:** `supabase/migrations/003_ai_memory_and_chat.sql:134`; `supabase/migrations/007_coaching_messages_and_cleanup.sql:7`

**Sorun:** `user_commitments` üç indeks taşır: `idx_commitments_user (user_id, status)` (003:134), `idx_commitments_followup (follow_up_at) WHERE status='pending'` (003:135) ve `idx_commitments_pending (user_id) WHERE status='pending'` (007:7). Pending commitment'ların her okuması `(user_id, status='pending')` üzerinde filtreler (örn. context-builders.ts:483-486, memory.ts:232, ai-proactive:846). Kompozit `idx_commitments_user (user_id, status)` zaten herhangi bir `(user_id, status='pending')` lookup'ını karşılar, dolayısıyla kısmi `idx_commitments_pending (user_id) WHERE status='pending'` işlevsel olarak gereksizdir — idx_commitments_user'ın zaten sağlamadığı hiçbir erişim yolu sunmaz. Bu, 059/061 dedup turlarının yakalamadığı bir işlevsel-gölge mükerrerdir (tanımlar byte-aynı değil).

**Etki:** `user_commitments` yazım-ağırdır (AI'nın chat sırasında çıkardığı her commitment'ta bir satır eklenir — ai-chat 3106/3476/3489). Gereksiz indeks her INSERT/UPDATE/DELETE'te sıfır sorgu faydası için bakım yapılır, ayrıca disk. Mevcut ölçekte düşük etki ama saf israf.

**Kanıt:**
```sql
003:134  CREATE INDEX idx_commitments_user ON user_commitments(user_id, status);
007:7    CREATE INDEX IF NOT EXISTS idx_commitments_pending ON user_commitments(user_id) WHERE status = 'pending';
         // gereksiz: (user_id, status) zaten (user_id, status='pending')'i kapsar
context-builders.ts:485  .eq('user_id', userId).eq('status', 'pending').order('follow_up_at').limit(5);
         // idx_commitments_user ile hizmet edilir
```

**Öneri:** Gereksiz kısmi indeksi düşürün: `DROP INDEX IF EXISTS public.idx_commitments_pending;`. idx_commitments_user (user_id/status okumalarına hizmet eder) ve idx_commitments_followup (cron'un follow_up_at-due taramasına hizmet eder) kalsın. Düşürmeden önce pg_stat_user_indexes ile idx_commitments_pending üzerinde idx_scan=0 olduğunu doğrulayın.

---

### [LOW] DB-FUN-03 — promote_weekly_plan, bir draft'ın plan_subtype'ını id ile okur ve kullanıcı-kapsamlı UPDATE'ten önce sahipliği doğrulamaz

**Dosya:** `supabase/migrations/071_promote_weekly_plan_subtype_aware.sql:31`

**Sorun:** `promote_weekly_plan`, `SELECT plan_subtype INTO v_subtype FROM public.weekly_plans WHERE id = p_draft_id;` yapar — `AND user_id = p_user` filtresi olmadan — dolayısıyla farklı bir kullanıcıya ait olabilecek bir satırın subtype'ını okur. Sonraki arşiv UPDATE'i `(user_id=p_user, plan_type, COALESCE(plan_subtype)=COALESCE(v_subtype))` ile kapsamlanır ve aktivasyon UPDATE'i `(id=p_draft_id AND user_id=p_user)` ile kapsamlanır. p_draft_id kullanıcı A'ya ama p_user kullanıcı B'ye aitse, A'nın draft'ının sızdırılan subtype'ı B'nin aktif planlarından hangisinin arşivleneceğini seçer — her iki argümanı kontrol eden bir çağıran, başka bir kullanıcının draft'ını subtype oracle'ı olarak kullanarak p_user'ın aktif planlarının seçilmiş bir subtype'ını seçici olarak arşivleyebilir. Etki sınırlıdır (gerçek yazımlar p_user içinde kalır; aktivasyon adımı id+user_id eşleşmediği için no-op olur) ve istismar edilebilirlik DB-FUN-01'deki aynı grant sorunuyla kapı altındadır.

**Etki:** plan_subtype'ın çapraz-kullanıcı okunması ve p_user'ın hangi aktif planının arşivleneceğinin subtype-seçimi; doğrudan veri hırsızlığı değil sınırlı veri-bütünlüğü uç-durumu.

**Kanıt:**
```sql
071:31  SELECT plan_subtype INTO v_subtype FROM public.weekly_plans WHERE id = p_draft_id;
        -- `AND user_id = p_user` YOK (karşılaştır 071:43 aktivasyon UPDATE
        --  WHERE id = p_draft_id AND user_id = p_user — kapsamlı)
```

**Öneri:** Subtype lookup'ını aynı kullanıcıya kapsamlayın: `SELECT plan_subtype INTO v_subtype FROM public.weekly_plans WHERE id = p_draft_id AND user_id = p_user;` ve draft p_user için bulunamazsa çıkın (RETURN NULL), böylece fonksiyon asla yabancı bir draft üzerinde çalışmaz.

---

### [LOW] DB-PRV-05 — Hesap silme talebi grace dönemindeki herhangi bir giriş'te sessizce otomatik iptal edilir, onay istemi olmadan

**Dosya:** `app/index.tsx:21-31`

**Sorun:** Her uygulama başlangıcında, `profile.deleted_at` VEYA `profile.deletion_requested_at` ayarlıysa, `app/index.tsx` koşulsuz `reactivateAccount()` çağırır (her iki bayrağı temizler, profile.store.ts:61-74). Kullanıcı onayı yoktur — 30-günlük pencere içinde tek bir giriş belgelenmiş bir silme talebini sessizce geçersiz kılar. Süre dolmadan önce yalnızca export'unu almak için bir kez giriş yapan bir kullanıcının silmesi niyeti olmadan iptal edilir. Bu davranış silme anında kullanıcıya açıklanır (`app/settings/index.tsx:210`: '30 gün içinde tekrar giriş yaparsan hesabın otomatik olarak yeniden aktif olur'), bu hafifletir, ama katı KVKK/GDPR pratiği kaydedilmiş bir silme talebini örtük tersine çevirmek yerine tersine çevirmeden önce niyeti onaylamaktır.

**Etki:** Bir silme talebi açık kullanıcı niyeti olmadan geçersiz kılınabilir (örn. kazara veya veri-alma girişi). LOW çünkü davranış UI'da açıklanmış ve belgelenmiş tasarımdır, ama tersine-çevirmeye-açık-onay best-practice'inden sapar.

**Kanıt:**
```js
app/index.tsx:21-25
  useEffect(() => {
    const p = profile;
    if ((p?.deleted_at || p?.deletion_requested_at) && session?.user?.id) {
      reactivateAccount(session.user.id);   // onay istemi YOK
    }
  }, [...])
// Açıklama: app/settings/index.tsx:210
```
*Not (adversarial düzeltme):* Bulgunun "cancel yolu reversal için audit olayı çıkarmaz" alt-iddiası YANLIŞ. reactivateAccount() → cancelAccountDeletion(userId) → `logAuditEvent(userId,'account_delete_cancel',...)` (privacy.service.ts:53) çıkarır; reversal denetlenir. Esas UX/onay endişesi (açık onay-öncesi-istem olmadan sessiz tersine-çevirme) geçerli kalır.

**Öneri:** Giriş'te pending-silme profili tespit edildiğinde bir onay ekranı gösterin ('<tarih>'te silme talep ettin; <tarih>'te tamamlanacak. Silmeyi iptal et / Silmeye devam et?') ve yalnızca açık kullanıcı seçiminde reactivateAccount() çağırın.

---

### [LOW] DB-CON-02 — PeriodicState TS tipi/config'i bayat (10 değer) vs canlı DB CHECK ve edge config (12 değer) — istemci tipi mini_cut ve maintenance'ı atlar, AI bunları profiles.periodic_state'e yazar

**Dosya:** `src/types/database.ts:41`; `src/services/periodic.service.ts:9-11, 27-78`; `supabase/migrations/070_fix_periodic_state_check_add_mini_cut_maintenance.sql:26-28`; `supabase/functions/shared/periodic-config.ts:7`

**Sorun:** Canlı `profiles.periodic_state` CHECK (migration 070 ile yeniden oluşturuldu) ve kanonik edge enum (`periodic-config.ts:7`) ikisi de 'mini_cut' ve 'maintenance' dahil 12 değer sıralar. Bu iki durum, AI'nın `mini_cut_start`/`maintenance_start` aksiyonlarıyla `profiles.periodic_state`'e yazılır. Ama İSTEMCİ tipi ve config'i hâlâ ESKİ 10-değerli listedir: `src/types/database.ts:41` PeriodicState mini_cut/maintenance'ı içermez ve `periodic.service.ts:9-11` PeriodicState + PERIODIC_STATE_CONFIG yalnızca 10 orijinal durumu tanımlar. Dolayısıyla edge periodic_state'i 'mini_cut'/'maintenance' yaptığında istemcinin `PERIODIC_STATE_CONFIG['mini_cut']`'ı undefined'dır.

**Etki:** Tip-güvenliği/tutarlılık drift'i, canlı çöküş değil: çökerek atacak tek runtime yolu (getTransitionInfo, periodic.service.ts:147) zaten optional chaining ve açık mini_cut/maintenance etiket fallback'leriyle (148-153) sertleştirilmiş ve periodic-state ayarlar ekranı `?? currentState` fallback'leri kullanır (app/settings/periodic-state.tsx:108). Pratik etki bugün AI-ayarlı mini-cut/maintenance için yanlış-etiketli/boş periodic-state gösterimi ve 10-değerli tip üzerinde exhaustively switch eden HERHANGİ bir GELECEK istemci kodunun iki eksik durumu sessizce yanlış işlemesi latent riskiyle sınırlıdır.

**Kanıt:**
```ts
// src/types/database.ts:41 (10 değer, mini_cut/maintenance eksik)
export type PeriodicState = 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam'
  | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';
// supabase/functions/shared/periodic-config.ts:7 (12 değer — kanonik)
export type PeriodicState = ... | 'custom' | 'mini_cut' | 'maintenance';
// migration 070 (canlı DB CHECK, 12 değer)
CHECK (periodic_state IS NULL OR periodic_state IN ('ramadan','holiday','illness',
  'busy_work','exam','pregnancy','breastfeeding','injury','travel','custom','mini_cut','maintenance'));
// ai-chat/index.ts:3763, :3787 periodic_state:'maintenance'/'mini_cut' yazar
```

**Öneri:** Her iki PeriodicState deklarasyonuna ('mini_cut','maintenance') ekleyin (src/types/database.ts:41 ve periodic.service.ts:9-11) ve PERIODIC_STATE_CONFIG'e karşılık gelen girişler ekleyin, böylece istemci `supabase/functions/shared/periodic-config.ts`'in sadık bir aynası olur (dosyanın kendi yorumunun, satır 5, gerektirdiği gibi). Bu latent footgun'ı ve çağrı-yeri-başı fallback bağımlılığını kaldırır.

---

### [LOW] DB-PRM-02 — profiles.daily_msg_count, yanıltıcı yorumlu, ölü, korumasız bir entitlement-bitişik kolondur

**Dosya:** `supabase/migrations/032_plans_used_free.sql:10-12`

**Sorun:** `profiles.daily_msg_count` free günlük mesaj cap'i için eklendi (mig 032) ve COLUMN COMMENT'i 'Rate limiter reads and increments' der. MEVCUT kodda bu yanlıştır: edge rate limiter (`shared/rate-limit.ts`) günlük cap'i sunucu-tarafı chat_messages satırları SAYARAK hesaplar ve daily_msg_count'a hiç dokunmaz; istemci mesaj sayacı (`message-counter.service.ts`) kullanımı yalnızca AsyncStorage'da izler ve o da daily_msg_count yazmaz. Repo-geneli grep, daily_msg_count'un yalnızca kendi migration 032'si ve bayat docs/audit markdown tarafından referans verildiğini gösterir — hiçbir zorlama tüketicisi okumaz veya yazmaz. Kritik olarak, premium/premium_expires_at/is_coach/plans_used_free/trial_used'in aksine, daily_msg_count `protect_profile_entitlements` whitelist'inde (mig 038) DEĞİLDİR, dolayısıyla serbestçe istemci-yazılabilirdir. Canlı doğrulandı: free authenticated kullanıcı daily_msg_count'u PATCH etti ve kalıcı oldu (HTTP 204), oysa aynı kullanıcının premium/plans_used_free/trial_used değiştirme denemeleri trigger ile sessizce geri alındı.

**Etki:** Mevcut istismar yok (kolon okunmaz). Risk doğruluk/sürdürülebilirliktir: yanıltıcı yorum + eksik trigger koruması, gelecekte bir cap-bypass regresyonunu davet eder. Yorumlara güvenip rate limiter'ı daily_msg_count'a bağlayan ve onu diğer kota kolonları gibi korumalı varsayan bir geliştirici, önemsizce istemci-sıfırlanabilir bir mesaj cap'i sevk eder.

**Kanıt:**
```sql
-- migration 032:10-12
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_msg_count JSONB DEFAULT '{"date": null, "count": 0}'::jsonb;
COMMENT ON COLUMN profiles.daily_msg_count IS 'Tracks free-tier daily message usage. Rate limiter reads and increments. ...';
-- rate-limit.ts satır sayar, daily_msg_count değil:
const { count: dailyCount } = await supabaseAdmin.from('chat_messages')
  .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('role','user').gte('created_at', dayStart);
-- Canlı: PATCH profiles.daily_msg_count -> 204, değişti; premium/plans_used_free/trial_used PATCH -> trigger geri aldı
-- (mig 038 whitelist daily_msg_count'u atlar)
```

**Öneri:** Ya (a) chat_messages satır-sayımları yetkili olduğu için profiles.daily_msg_count'u tamamen düşürün; ya da (b) tutulacak/kullanılacaksa, istemcilerin sıfırlayamaması için onu `protect_profile_entitlements` OLD-değer whitelist'ine (mig 038) ekleyin VE edge'in bu kolon değil chat_messages saydığını yansıtacak şekilde kolon yorumunu düzeltin.

---


---

## AI — Yapay Zeka Mimarisi (Edge / LLM / Bellek / Güvenlik)

Bu bölüm KOCHKO'nun yapay zeka katmanını (ai-chat orkestrasyonu, sistem promptu & task-modlar, guardrail/güvenlik, bellek katmanları, context builder/retrieval, plan üretimi & projeksiyon, proaktif cron & raporlar, extractor/doğrulama/onarım, model yönlendirme/maliyet/rate-limit ve AI→DB bütünlüğü) kapsar. Tüm bulgular adversaryal olarak doğrulanmış; verdict'lerdeki düzeltilmiş şiddet (`adjustedSeverity`) esas alınmış, yakın-kopya bulgular birleştirilmiştir.

### Özet

| Şiddet | Adet |
|---|---|
| CRITICAL | 2 |
| HIGH | 13 |
| MEDIUM | 23 |
| LOW | 11 |
| **Toplam (ayrı bulgu)** | **49** |

Ham bulgu sayısı 54; hepsi `isReal=true`, hiçbiri `INVALID` değil — 0 bulgu düşürüldü. 5 ham ID yakın-kopya olarak 4 başlığa birleştirildi: (1) meal_log makro NaN/overflow üçlüsü `AI-ORC-01 / AI-EXT-04 / AI-INT-03` → tek; (2) learnMealTime/öğrenilen-saat UTC ikilisi `AI-MEM-02 / AI-INT-05` → tek; (3) JSONB bellek read-modify-write yarışı `AI-ORC-06 / AI-MEM-04` → tek; (4) validatePlanOutput hata-yutma ikilisi `AI-PLN-03 / AI-EXT-06` → tek. Geriye 49 ayrı bulgu kaldı. (Birleştirme nedeniyle düşürülen ID sayısı = 5; gerçekte hatalı/geçersiz bulunan = 0.)

**Tema özeti:** Üç sistemik kök neden hâkim — (1) **güvenlik guardrail boşlukları**: kriz/ED tespiti bazı yaygın Türkçe çekimleri (asmak/asmayı, yiyorum) kaçırıyor; (2) **zaman dilimi / UTC hatası**: context, öğrenilen öğün saatleri ve cron raporları kullanıcının efektif gününü değil ham UTC'yi kullanıyor; (3) **doğrulama & atomiklik eksikleri**: meal_log makroları NaN/overflow korumasız (sessiz veri kaybı), idempotency/transaction yokluğu mükerrer/yarım yazımlar üretiyor, SMALLINT taşmaları plan/rapor projeksiyonunu sessizce düşürüyor. Ayrıca fail-open cron auth ve 1MB payload kapağı (foto/ses) gibi operasyonel/maliyet açıkları mevcut.

---

### [CRITICAL] AI-GRD-01 — Kriz tespiti "kendimi asmak/asmayı" (kendini asma) mastar/ulaç biçimini kaçırıyor

**Dosya:** `supabase/functions/shared/guardrails.ts:399` (CRISIS_RE ilk pattern, `detectCrisis` 371-411)

**Sorun:** `detectCrisis()` literal ifade listesi (crisisPhrases) ile CRISIS_RE regex'lerini birleştirir. Asma fiili için self-harm grubu `as(acağ|acak|tım|tim|arak|ıyor|iyor)` yalnızca gelecek/geçmiş/şimdiki zaman çekimlerini kapsar (asacağım, astım, asıyorum, asarak). Mastar `-mak` ve ulaç/yönelme `-ma/-mayı` biçimlerini İÇERMEZ. Dolayısıyla son derece yaygın ve net Türkçe intihar ifadeleri "kendimi asmak istiyorum" ve "kendimi asmayı düşünüyorum" NE literal listeye NE regex'e uyar. Kardeş fiil grupları tutarsız: `kıy(mak|...)` `mak` içerir, `öldür` çıplak köktür ve öldürmek'i yakalar — ama `as` mastar/ulaçsız bırakılmış. Çıplak "kendimi kesmek istiyorum" da kaçar çünkü `kes(...)` grubunda `mek` yok ("bileğimi kesmek" yalnızca ayrı bilek regex'i ile yakalanır).

**Etki:** Akut intihar niyetini mastar/ulaç (Türkçe'de gramerce doğal ve çok sık kullanılan biçim) ile ifade eden kullanıcı 112 + profesyonel kriz yanıtına (satır 405-408) YÖNLENDİRİLMEZ. Mesaj detectEDRisk'e ve oradan normal LLM koçluğuna düşer; intihar eğilimli kullanıcı kriz hattı yerine sıradan bir fitness yanıtı alabilir. Bu, tüm guardrail başarısızlıkları içinde en yüksek etkili olanı: kaçırılan akut kriz sinyali.

**Kanıt:**
```
Line 399: /(kendi(mi|me)|...).{0,30}(as(acağ|acak|tım|tim|arak|ıyor|iyor)|kes(ece|ece[kğ]|eceğ|erim|iyor|tim|tım)|kıy(mak|acağ|acak|dım|dim|dı|arım|arim|amam)|...|öldür|...)/u
// `as(` içinde `mak`/`may` yok, `kes(` içinde `mek`/`mey` yok.
MISS [hang infinitive] "kendimi asmak istiyorum"     -> false
MISS [hang gerund]     "kendimi asmayı düşünüyorum"  -> false
MISS [cut infinitive]  "kendimi kesmek istiyorum"    -> false
OK   [control]         "kendimi asacağım"            -> true
```

**Öneri:** Mastar ve ulaç eklerini asma/kesme gruplarına ekleyerek `kıy(mak|...)` ile simetrik hale getir: ör. `as(mak|may|acağ|acak|tım|tim|arak|ıyor|iyor)` ve `kes(mek|mey|ece|eceğ|erim|iyor|tim|tım)`. Tasarım yorumu (391-392) kriz için yanlış-pozitife meyilli olmayı zaten söylediğinden, kendine-hedef (kendimi/kendime/canıma/hayatıma) + herhangi bir yöntem kökünü (as|kes|kıy|öldür|vur|atla|zehirle) herhangi bir çekimde eşleyen geniş bir ideation cümlesi ve overdose pattern'i (hap/ilaç ... iç ... öl) ekle. Doğrulama: "kendimi asmak istiyorum", "kendimi asmayı düşünüyorum", "kendimi kesmek istiyorum".

---

### [CRITICAL] AI-EXT-01 — Sunucu payload kapağı (1MB) görüntü/ses limitleri (7.5MB) ve istemcinin 3.5MB gönderiminiyle çelişiyor — foto & sesli öğün-kaydı 413 ile reddediliyor

**Dosya:** `supabase/functions/shared/request-validator.ts:6-9, 73-78` (çağrı: `ai-chat/index.ts:51-52`; istemci: `src/services/chat.service.ts:251`)

**Sorun:** `checkPayloadSize()`, Content-Length > `MAX_PAYLOAD_BYTES = 1_000_000` (1MB) olan her isteği reddeder ve ai-chat'te her şeyden ÖNCE çalışır. Ancak aynı dosyadaki alan-bazlı limitler `MAX_IMAGE_BASE64_LENGTH / MAX_AUDIO_BASE64_LENGTH = 10_000_000` (~7.5MB) izin verir; İSTEMCİ ise `MAX_IMAGE_BASE64_BYTES = 3_500_000` ile 3.5MB'a kadar görüntü gönderir ("well under the Supabase edge function 5 MB body cap" yorumuyla). `supabase.functions.invoke` body'yi JSON'a serialize edip Content-Length'i tüm payload boyutuna ayarlar; base64'ü >1MB olan herhangi bir foto (yani pratikte gerçek her telefon fotoğrafı, tipik 1-3MB) istemcinin 3.5MB kontrolünü geçer, gönderilir ve sunucuda HTTP 413 ile reddedilir. 7.5MB alan-limitleri ölü koddur — 1MB kapağı önce ateşler.

**Etki:** Foto öğün-kaydı ve sesli-not transkripsiyonu — amiral gemisi Premium özellikleri — ~1MB üstü her görüntü/ses için kırık. Foto kalori analizi için özellikle ödeme yapan Premium kullanıcılar gerçek her fotoğrafta 413 alır. Bu, ödemenin arkasına kilitlenmiş sert bir işlevsel kırılma.

**Kanıt:**
```
request-validator.ts:6  const MAX_PAYLOAD_BYTES = 1_000_000; // 1MB
request-validator.ts:8  const MAX_IMAGE_BASE64_LENGTH = 10_000_000; // ~7.5MB
request-validator.ts:74 if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) { return { valid:false, error:`Payload too large...` }; }
ai-chat/index.ts:51     const sizeCheck = checkPayloadSize(req.headers.get('content-length')); if (!sizeCheck.valid) return respond({error:...}, 413);
chat.service.ts:251     const MAX_IMAGE_BASE64_BYTES = 3_500_000; // 3.5MB'a kadar gönderir
```

**Öneri:** `MAX_PAYLOAD_BYTES`'i en büyük izinli alanla eşleşecek şekilde yükselt (ör. 8_000_000) ki gerçek bir dış zarf olsun, VEYA gereksiz 1MB content-length kapağını kaldırıp alan-bazlı base64 limitlerine güven. Üç limiti birbiriyle ve istemcinin `MAX_IMAGE_BASE64_BYTES` değeriyle tutarlı tut.

---

### [HIGH] AI-ORC-01 / AI-EXT-04 / AI-INT-03 — meal_log_items makroları NaN/üst-sınır korumasız: tek bozuk değer TÜM kalemleri sessizce düşürür, sıfır-makrolu öğünü "kaydedildi" diye gösterir

**Dosya:** `supabase/functions/ai-chat/index.ts:2810-2825, 2849` (validator: `supabase/functions/shared/output-validator.ts:19-75`; kolonlar: `supabase/migrations/002_daily_logs.sql:31-33`)

**Sorun:** Her kalemin makroları `protein_g: Math.max(0, i.protein_g)`, `carbs_g: Math.max(0, i.carbs_g)`, `fat_g: Math.max(0, Math.round(i.fat_g * multiplier))` ile insert edilir — `Number()` coercion YOK, NaN/undefined koruması YOK (yalnızca `calories` 32767'ye clamp'lenir). Model bir makroyu atlarsa `i.protein_g` undefined olur, `Math.max(0, undefined)` = NaN; PostgREST NaN'ı JSON null olarak serialize eder. `meal_log_items.protein_g/carbs_g/fat_g` = `DECIMAL(5,1) NOT NULL DEFAULT 0` olduğundan null, 23502 ile TÜM `.insert(mealItems.map(...))` batch'ini düşürür (sadece bozuk kalemi değil). DECIMAL(5,1) 9999.9'da tavanlandığından clamp'lenmemiş büyük bir makro değeri de 22003 ile aynı batch'i düşürür. `itemsErr` yalnızca `console.error`'a yazılır (2824); parent meal_logs satırı zaten insert edildiğinden kontrol koşulsuzca satır 2849 `mealFeedback.push('Ogun kaydedildi')`'ya ulaşır. Ek olarak, bu tam korumayı sağlamak için var olan **`validateMealParse` (Spec 5.29) import edildiği halde hiçbir yerde çağrılmaz** (`ai-chat/index.ts:20` import, `output-validator.ts:19` tanım; grep ile başka çağrı yok) — `ai-plan`'in `validatePlanOutput.corrected`'i kullanmasının (index.ts:491-492) aksine.

**Etki:** Çekirdek günlük akışta sessiz veri kaybı: meal_logs satırı SIFIR kalemle kalır, öğün güne 0 kcal/0 makro katkı verir, ama kullanıcı 'Ogun kaydedildi' başarı çipini ve modelin "kaydedildi" anlatısını görür. Uygulamanın merkezi işlevi olan kalori/makro takibi sessizce yanlışlanır ve kullanıcının yeniden-kaydetme sinyali olmaz. Bu, geçmişte CRITICAL işaretlenen "model metni başarı diyor ama DB mutasyonu yok" sınıfının ta kendisi.

**Kanıt:**
```
calories: Math.min(32767, Math.max(0, Math.round(i.calories * multiplier))),
protein_g: Math.max(0, i.protein_g), carbs_g: Math.max(0, i.carbs_g),
fat_g: Math.max(0, Math.round(i.fat_g * multiplier)),
...
if (itemsErr) console.error('[meal_log_items] insert failed:', itemsErr.message);
...
mealFeedback.push('Ogun kaydedildi');   // itemsErr'den bağımsız çalışır
--- 002_daily_logs.sql:31-33 ---
protein_g DECIMAL(5,1) NOT NULL DEFAULT 0,
carbs_g   DECIMAL(5,1) NOT NULL DEFAULT 0,
fat_g     DECIMAL(5,1) NOT NULL DEFAULT 0,
--- grep validateMealParse supabase/functions ---
ai-chat/index.ts:20      import { validateMealParse }   (yalnız import)
output-validator.ts:19   export function validateMealParse(...)   (yalnız tanım)
```

**Öneri:** Her sayısal kalem alanını insert öncesi coerce + sanitize et: ör. `const num = (v, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; }` ve `protein_g: num(i.protein_g, 9999.9)` (carbs_g/fat_g aynı). Tercihen `validateMealParse`'ı insert öncesi gerçekten çağırıp dönen `corrected` kalemleri kullan. Son olarak başarı çipini `!itemsErr` koşuluna bağla — kalem insert'i başarısızsa kullanıcıya başarı yerine başarısızlık çipi göster / yeniden-sor.

---

### [HIGH] AI-ORC-02 — Workout-planı onay yolu taslağı sakatlık çakışması için yeniden-taramıyor (alerjen yolu tarıyor); taslak sonrası bildirilen sakatlık aktivasyonda atlanıyor

**Dosya:** `supabase/functions/ai-chat/index.ts:1207-1296` (yeniden-tarama yalnız 1244-1267)

**Sorun:** Yetkili onay turunda (`user_approved === true`) kod, taslağı yükseltmeden önce alerjen guardrail'ini kalıcı taslağa karşı yeniden çalıştırır ("taslak kullanıcı alerjen eklemeden önce kalıcılaştırılmış olabilir" gerekçesiyle, satır 1244-1267, `expectedType === 'diet'` ile geçişli). `expectedType === 'workout'` için SİMETRİK sakatlık yeniden-taraması YOKTUR: blok free-tier kapısından doğrudan taslağı çekip `promote_weekly_plan`'a (satır 1286) gider. Sakatlık filtresi (`filterExercisesByInjury`) YALNIZCA snapshot-kalıcılaştırma anında (1089-1157) çalışır. Yani kullanıcı bir workout planı pazarlığı yapar (taslak kalıcılaşır), SONRA sakatlık bildirir (deterministik sakatlık güvenlik ağı 840-859 veya onboarding kartı `health_events`'e yazar) ve onayla'ya basarsa, eski taslak yükseltilir, aktive edilir ve sakatlı eklemi yükleyen egzersizlerle `daily_plans`'a projekte edilir.

**Etki:** Güvenlik başarısızlığı: sakatlık-yükleyen hareketler içeren (diz/bel sakatlığı için squat/deadlift/koşu) sohbet-üretimi bir workout planı, kayıtlı süregelen sakatlığı olan kullanıcıya aktive edilip gösterilebilir. Bu, kalıcılaştırma-anı sakatlık filtresinin önlemek için eklendiği tam zararın onay-kenarında açık bırakılmış halidir. Yazar bu riski diyet/alerjen ikizi için zaten tanımış ve ele almış; workout ikizi eksik.

**Kanıt:**
```
// Re-run the allergen guardrail on the draft before promoting ...
if (draft && expectedType === 'diet') { ... checkAllergens ... }
if (draft && !planPersistError) { ... promote_weekly_plan ... }
// taslak fetch ile promote_weekly_plan arasında hiçbir expectedType==='workout' sakatlık yeniden-taraması yok
```

**Öneri:** Diyet alerjen yeniden-taramasını yansıt: `promote_weekly_plan` öncesi `else if (draft && expectedType === 'workout')` dalı ekle; süregelen `health_events`'i oku, taslak egzersizleri üzerinde `filterExercisesByInjury` çalıştır, çakışan hareketleri yerinde düşür/notla veya çakışma kalırsa `planPersistError` set ederek yükseltmeyi blokla.

---

### [HIGH] AI-ORC-03 — meal_log alerjen uyarısı `checkAllergens` yerine naif substring kullanıyor; kategori alerjeni ("deniz ürünleri") için üye gıda ("somon") kaydında uyarı üretmiyor

**Dosya:** `supabase/functions/ai-chat/index.ts:2710-2728` (paylaşılan: `shared/guardrails.ts:101` checkAllergens, `ALLERGEN_FOODS`)

**Sorun:** Kayıt-modu alerjen kontrolü `itemNames.some(n => n.includes(a.food_name.toLocaleLowerCase('tr')))` ile — saklanan alerjen `food_name`'i üzerinde tek-yönlü literal substring testi. Kullanıcı alerjenleri sıklıkla KATEGORİ adları olarak saklanır (alerji güvenlik ağı 809-833 ve food_preference handler 'deniz ürünleri', 'balık', 'fındık' gibi kanonik adlar yazar). `checkAllergens` (guardrails.ts:101) tam da bu kategorileri `ALLERGEN_FOODS` üzerinden genişletmek için var ('deniz ürünleri' → karides/midye/somon/levrek...) ve çift-yönlü/sonek-toleranslı eşleme yapar; plan yolu bunu kullanır — ama meal_log inline uyarısı kullanmaz. Sonuç: 'deniz ürünleri' alerjeni olan kullanıcı 'somon yedim' kaydettiğinde 'somon' substring'i 'deniz ürünleri' içinde olmadığından öğün kaydedilir ve HİÇBİR '⚠️ ALERJEN UYARISI' çipi üretilmez. Çıkış-tarafı tarama (1571-1606) checkAllergens kullanır ama asistanın YANIT metnini tarar, kaydedilen kalem adlarını değil — modelin yanıtı 'somon' demezse ikisi de kaçırır.

**Etki:** Güvenlik: bildirdiği alerjen kategorisine ait bir gıdayı kaydeden alerjik kullanıcı kayıt anında alerjen uyarısı almaz; kullanıcıların sohbette gerçekten bildirdiği kategori-tipi alerjenler için Spec 12.7 kayıt-modu alerjen korumasını boşa çıkarır. Alerjen uyarısı bir güvenlik yüzeyidir; buradaki sessiz yanlış-negatif tehlikeli yöndür.

**Kanıt:**
```
const itemNames = items.map(i => i.name.toLocaleLowerCase('tr'));
const matched = allergens.filter(a => itemNames.some(n => n.includes(a.food_name.toLocaleLowerCase('tr'))));
// vs guardrails.ts checkAllergens(): ... ALLERGEN_FOODS['deniz ürünleri'] = [...,'somon','levrek','hamsi']
```

**Öneri:** Substring döngüsünü paylaşılan `checkAllergens(itemNames.join(' '), allergens)` (veya kalem-bazlı) ile değiştir; böylece kategori genişletme, sonek toleransı ve çift-yönlü eşleme plan-snapshot ve çıkış-tarama yollarıyla aynı şekilde uygulanır. Eşleşen kanonik alerjen adını uyarı çipinde göster.

---

### [HIGH] AI-SYS-01 — Recovery modu `recovery_plan` action'ını hiç emit etmiyor — ertesi-gün kalori dengeleme sessizce ölü

**Dosya:** `supabase/functions/ai-chat/task-modes.ts:236-255` (handler: `ai-chat/index.ts:3485-3539`)

**Sorun:** 'recovery' task-modu talimatı (task-modes.ts:236) modele sözlü bir kurtarma planı vermesini ve YALNIZCA bir `commitment` action'ı emit etmesini söyler (249). Servis-context KURTARMA MODU bloğu (service-contexts.ts:214-225) da sadece sözlü kuralları anlatır. Hiçbiri modele `{"type":"recovery_plan", "excess_kcal": N}` emit etmesini söylemez. Oysa index.ts'te dengelenen kalori hedeflerini gelecek `daily_plans` satırlarına yazan (günün fazlasını sonraki 2 güne cinsiyet-duyarlı tabanla dağıtan) TEK kod yolu olan tam bir `case 'recovery_plan'` handler'ı vardır (3485-3539). Hiçbir prompt `recovery_plan` action tipini ifşa etmediğinden, model onu tetikleyemez; asla emit edilmez ve handler sohbetten erişilemez.

**Etki:** Recovery modunun çekirdek vaadi — task-modes.ts:246-247 'Kalan Z gunde gunluk W kcal azaltirsan hafta dengelenir' — kozmetiktir. Model bir dengeleme stratejisini düzyazıyla belirtir, ama kullanıcının sonraki günlerdeki gerçek planı DEĞİŞTİRİLMEZ. Belgelenmiş, tamamen-inşa edilmiş bir özellik (aşırı-yeme günü sonrası kalori yeniden-dağıtımı) sessizce hiçbir şey yapmaz.

**Kanıt:**
```
// task-modes.ts recovery (tek emit edilen action):
"<actions>[{\"type\": \"commitment\", \"text\": \"Kurtarma takibi\", \"follow_up_days\": 1}]</actions>"
// index.ts:3485 erişilemez handler:
case 'recovery_plan': { ... let excessKcal = (action.excess_kcal ?? 0); ...
   await supabaseAdmin.from('daily_plans').update({ calorie_target_min: newMin, calorie_target_max: newMax }) ... }
// grep 'recovery_plan' supabase/functions => YALNIZCA handler tanımı; hiçbir promptta yok
```

**Öneri:** Recovery modu talimatına açık bir `recovery_plan` action sözleşmesi ekle (ör. `<actions>[{"type":"recovery_plan","excess_kcal": sayi}]</actions>`) ki model dengeleme hesapladığında emit etsin; VEYA ölü `recovery_plan` handler'ını kaldırıp recovery akışını modele bağımlı olmadan sunucu tarafında yeniden-hesapla.

---

### [HIGH] AI-MEM-01 — Layer-2 token bütçesi (LAYER2_PCT / max_token_budget) hiç uygulanmıyor — sınırsız ai_summary büyümesi prompta sızıyor

**Dosya:** `supabase/functions/shared/memory.ts:19, 123-212, 386-409` (chat append: `ai-chat/index.ts:4087-4089`)

**Sorun:** Dosya bir Layer-2 bütçesi (LAYER2_PCT: 0.10, ~13.000 token) tanımlar ve ai_summary tablosunda bu amaçla `token_size_estimate / max_token_budget` kolonları (migration 003:116-117, default 13000) vardır. Ama HİÇBİR ŞEY uygulamaz. `buildLayer2()` (123-212) ve `buildLayer2Scoped()` (context-builders.ts:267-407) her bölümü token kontrolü olmadan birleştirir; `buildFullContext()` (386-409) yalnızca `estimateTokens(layer2)`'yi `estimatedTokens`'a TOPLAR, asla kırpmaz. Layer-3 (compressLayer3 çağrısı) ve Layer-4 (LAYER4_PCT'ye kırpma) İSE uygulanır. Dahası chat yazma yolu `general_summary`'ye sınırsız ekler: processLayer2Updates (ai-chat/index.ts:4087-4089) `changes.general_summary = current + '\n' + updates.general_summary_append` (sınır yok; ai-extractor yolu 3000 karakterde clamp'ler ama chat yolu clamp'lemez). grep ile `token_size_estimate/max_token_budget` SIFIR reader/writer.

**Etki:** Zamanla general_summary, coaching_notes, behavioral_patterns, seasonal_notes (tarih damgalı append), social_eating_notes vb. sınırsız büyür. Layer 2 sessizce 13k-token tahsisini aşar ve Layer 3 (yakın veri) ile Layer 4 (canlı sohbet)'ü model penceresinde dışlar; koçluk kalitesini düşürür ve nihayetinde her sohbet turunda context-penceresi taşması / daha yüksek token maliyeti riski yaratır. (Not: canlı yol `buildLayer2Scoped` kısmi modlarda per-bölüm scoping yapar, ama genel bir Layer-2 token bütçesi yine yoktur ve per-tur sınırsız general_summary append'i kırpılmaz.)

**Kanıt:**
```
memory.ts:19  LAYER2_PCT: 0.10, // ~13,000 tokens  -> yalnız satır 396 'estimateTokens(layer2) +' (toplam, hiç limit değil)
ai-chat/index.ts:4087-4089  const current = (existing?.general_summary) ?? ''; changes.general_summary = current + '\n' + updates.general_summary_append;  // sınır yok
grep token_size_estimate|max_token_budget -> yalnız migration 003 + types; edge-function reader/writer yok
```

**Öneri:** Layer-2 bütçesini uygula: Layer 2 inşa sonrası `estimateTokens(layer2) > floor(TOTAL * LAYER2_PCT)` ise compressLayer3 gibi sıkıştır (en eski tarih-damgalı satırlar / en düşük skorlu pattern'ler düşürülür). Chat append yolunda (4089) general_summary'yi extractor gibi (son ~3000 karaktere slice) clamp'le. `token_size_estimate/max_token_budget`'i bu kontrole bağla veya ölü kolonları kaldır.

---

### [HIGH] AI-MEM-02 / AI-INT-05 — Öğrenilen öğün saatleri / atıştırma saatleri / geç-öğün-uyku UTC saatinden hesaplanıyor; tüketiciler kullanıcı-yerel saat kullanıyor (UTC offset kadar kaymış)

**Dosya:** `supabase/functions/shared/memory.ts:588, 691`; `supabase/functions/ai-chat/index.ts:3922` (öğrenme: 3889-3927)

**Sorun:** `meal_logs.logged_at` timestamptz (UTC). Üç öğrenme fonksiyonu saati naif `new Date(logged_at).getHours()` ile türetir; Supabase/Deno edge runtime'da bu UTC saatini döndürür, kullanıcının yerel saatini değil: `detectSnackingHours` (memory.ts:691), `analyzeLateMealSleep` (memory.ts:588), `learnMealTime` (ai-chat/index.ts:3922). AYNI codebase bu hatayı tam olarak service-contexts.ts:589-597'de tanımış ve `logged_at is UTC` yorumuyla `toLocaleString('en-US', { timeZone: 'Europe/Istanbul' })` ile düzeltmiş — memory.ts'e bu fix verilmemiş. Tüketiciler zaman-dilimi-duyarlıdır: ai-proactive (`h - 1 === getUserLocalHour(profile)` ile ateşler, ayrıca nudge metni yanlış saati yazar), ai-plan learned_meal_times'ı kullanıcıya 'OGUN SAATLERI kahvalti 04:00' diye basar.

**Etki:** UTC+3 kullanıcısı için 07:00 kahvaltı 04:00 olarak öğrenilir/saklanır ve plan kullanıcıya 04:00'te kahvaltı yapmasını söyler. 16:00 atıştırma zirvesi saat 13 olarak saklanır, ai-proactive ön-atıştırma su uyarısını yerel 12:00'de gönderir — gerçek zirveden ~3-4 saat önce, faydasız. analyzeLateMealSleep'in 21:00 'geç öğün' kesimi UTC'ye karşı uygulanır, gerçekten geç öğünler yanlış sınıflandırılır. Üç öğrenilen sinyal de UTC offset kadar yanlış ve canlı yollarda tüketiliyor.

**Kanıt:**
```
memory.ts:691  const hour = new Date(s.logged_at).getHours();
memory.ts:588  const h = new Date(m.logged_at).getHours() + new Date(m.logged_at).getMinutes()/60;
ai-chat/index.ts:3922  totalMinutes += d.getHours()*60 + d.getMinutes();
// düzeltilmiş: service-contexts.ts:595  hour = new Date(new Date(meal.logged_at).toLocaleString('en-US', { timeZone: 'Europe/Istanbul' })).getHours();
```

**Öneri:** service-contexts.ts:595 fix'ini üç fonksiyonda da yansıt: saati kullanıcının diliminde hesapla, ör. `new Date(new Date(logged_at).toLocaleString('en-US', { timeZone: tz })).getHours()`; tz'i profile.active_timezone/home_timezone'dan (default Europe/Istanbul) çöz — ai-proactive'in getUserLocalHour'unun yaptığı gibi.

---

### [HIGH] AI-CTX-02 — Layer-1 "## ZAMAN" bloğu kullanıcı-yerel yerine UTC zaman/gün/tarih basıyor — AI yanlış saat ve yanlış "bugün" üzerinden akıl yürütüyor

**Dosya:** `supabase/functions/shared/context-builders.ts:77-87, 256-262`

**Sorun:** `buildLayer1Scoped` ve `buildLayer1Minimal` zaman satırını `new Date()`'ten `now.getHours()`, `now.getMinutes()`, `now.toLocaleDateString('tr-TR', {weekday:'long'})` ve `now.toISOString().split('T')[0]` ile inşa eder — HİÇBİRİNDE timezone argümanı yok. Supabase/Deno edge runtime'da TZ=UTC olduğundan `## ZAMAN` başlığı UTC haftagünü, UTC saat ve UTC tarihi raporlar. İstanbul kullanıcısı (UTC+3) yerel 01:00'de modele 22:00 (önceki gün) söylenir; haftagünü ve ISO tarih (satır 87) ikisi de bir gün kayabilir. Builder `userId` alır ama call site'taki (index.ts:240) client_timezone'u almaz; yerelleştiremez. Bu `## ZAMAN ... | <date>` satırı modelin kanonik "bugün" olarak ele aldığı şeydir ve AI-CTX-01'i pekiştirir.

**Etki:** Zaman-duyarlı koçluk her non-UTC kullanıcı için yanlış: öğün-zamanı tavsiyesi, selamlama tonu (günaydın vs iyi akşamlar), geç-gece yeme uyarıları ve 'sabah mı akşam mı' akıl yürütmesi birkaç saat kaymış saat kullanır, gece yarısına yakın düpedüz yanlış takvim günü. Çoğu kullanıcı bunu yaşar (tüm Türkiye tabanı her oturumda 3 saat kaymış saat görür).

**Kanıt:**
```
77  const now = new Date();
79  const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });  // timeZone yok -> UTC
80  const hour = now.getHours();                                           // UTC saat
87  parts.push(`## ZAMAN\n${dayName}, ${hour}:${minute} | ${now.toISOString().split('T')[0]}`);  // UTC tarih
258 const dayName = now.toLocaleDateString('tr-TR', { weekday: 'long' });  // buildLayer1Minimal aynı
```

**Öneri:** Çözülmüş tz'i (client_timezone → active_timezone → home_timezone) Layer-1 builder'larına geçir ve haftagünü/saat/dakika/tarihi `Intl.DateTimeFormat`/`toLocaleString({ timeZone })` ile biçimlendir veya tarih kısmı için getEffectiveDateForUser'ı yeniden kullan. Saat/haftagünü UTC değil kullanıcının duvar-saatini yansıtmalı.

---

### [HIGH] AI-PLN-01 — weekly_budget_consumed / weekly_budget_total SMALLINT taşıyor — chat→daily_plans projeksiyonu sessizce kırılıyor

**Dosya:** `supabase/functions/shared/plan-projection.ts:315-336`; `ai-chat/index.ts:1357-1360, 1382-1398`; `supabase/migrations/058_fix_project_daily_plans_explicit_columns.sql:48-51` (kolon: `migrations/004_plans_and_reports.sql:28-30`)

**Sorun:** `daily_plans.weekly_budget_total/consumed/remaining` SMALLINT (max 32767). Canlı kaynak-doğruluk yolu (chat onay → projectDailyPlanRows → project_daily_plans RPC) weekConsumed'ü haftanın tüm meal_log_items.calories SINIRSIZ toplamı olarak hesaplar (ai-chat:1357-1360) ve weekly_budget_total = caloriePoint*7 (plan-projection.ts:316-317); ikisi de clamp'lenmez. Yoğun/cheat hafta (~7×5000 = 35000) veya bulk hedefi (~4700×7 = 32900) 32767'yi aşar. RPC bunları `jsonb_to_recordset(... smallint ...)` ile cast eder (058:50), INSERT 22003 (numeric out of range) yükseltir. project_daily_plans best-effort çağrılır (ai-chat:1390-1398): projErr2 yalnızca console.error'a yazılır, chat onayı başarılı olur ama daily_plans projeksiyonu sessizce başarısız olur — dashboard (daily_plans'tan okur) o kullanıcıya plan yok / boş 'kalan kalori' gösterir.

**Etki:** Yüksek-kalorili hafta loglayan veya günlük hedefi ~4680 kcal üstündeki bulk kullanıcılar, tüm chat-onaylı planını hiçbir hata yüzeye çıkmadan daily_plans'tan düşürür. Dashboard, Layer-3 context, raporlar ve home widget boşalır — projeksiyonun düzeltmek için inşa edildiği tam belirti. (Başlıktaki "normal loggers" abartılı: tipik 2000-2800 kcal/gün logger güvenli; etkilenen kitle ağır-yeme haftaları ve ekstrem-bulk hedefleridir.)

**Kanıt:**
```
plan-projection.ts:316-317  const weeklyTotal = ... ? ri(profile.weekly_calorie_budget, caloriePoint*7) : caloriePoint*7;  // üst sınır yok
plan-projection.ts:230      const weeklyConsumed = Math.max(0, ri(weekConsumed, 0));  // üst sınır yok
058:50  weekly_budget_total smallint, weekly_budget_consumed smallint, weekly_budget_remaining smallint,
004:28-30  weekly_budget_total SMALLINT, ...
ai-chat:1396-1398  if (projErr2) { console.error('[approve][projection] atomic projection failed', projErr2); }  // yutulur
```

**Öneri:** Üç bütçe alanını da RPC öncesi SMALLINT aralığına clamp'le (`Math.min(32767, ...)`) VEYA kolonları INTEGER'a genişlet (`ALTER TABLE daily_plans ALTER COLUMN weekly_budget_* TYPE integer`) ve 058'deki jsonb_to_recordset tiplerini güncelle. Kalori toplamları meşru olarak 32767'yi aşabildiğinden INTEGER'a genişletme doğru çözüm.

---

### [HIGH] AI-EXT-02 — Extractor, model literal JSON `null` döndürdüğünde (promptun açıkça davet ettiği) tüm cron batch'ini çökertiyor

**Dosya:** `supabase/functions/ai-extractor/index.ts:190-202`

**Sorun:** JSON.parse try/catch'le sarılı (191-197) ama catch yalnızca parse BAŞARISIZLIĞINI ele alır. Model geçerli JSON literal `null` döndürdüğünde (çok olası: prompt satır 85 'Bilgi yoksa null döndür' der), JSON.parse başarılı olur ve `extracted = null` atar. Sonra satır 200-201 — try/catch DIŞINDA — `Object.entries(null)` çağırır, 'TypeError: Cannot convert undefined or null to object' fırlatır. Bu satır 309'daki DIŞ try/catch'e propagate olur, HTTP 500 döndürür ve TÜM for-loop'u ABORT eder. Batch'teki kalan her kullanıcı (100'e kadar) atlanır ve checkpoint'leri hiç ilerlemez.

**Etki:** Çıkarım çağrısı çıplak `null` döndüren tek bir kullanıcı, tüm gecelik/haftalık çıkarım cron'unu zehirler: ondan sonra iterate edilen tüm kullanıcılar sessizce atlanır; Tier-2/Tier-3 profil zenginleştirme ve Layer-2 özet merge'i, kusurlu kullanıcı en sona sıralanana dek kullanıcı tabanının büyük bölümü için çalışmayı durdurur.

**Kanıt:**
```
try { const jsonStr = content.replace(...).trim(); extracted = JSON.parse(jsonStr); } catch { continue; }
// model "null" döndürür -> extracted === null
const nonNull = Object.fromEntries(Object.entries(extracted).filter(...));  // Object.entries(null) FIRLATIR -> 500 -> batch abort
```

**Öneri:** Object.entries kullanımını try içine taşı veya guard'la: `if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) { await updateCheckpoint(...); continue; }`. null/non-object parse sonuçlarını 'veri çıkarılmadı' olarak ele al ve fırlatmak yerine checkpoint'i ilerlet.

---

### [HIGH] AI-MDL-04 — ai-plan günlük üretimi RATE-LIMIT VE free-tier kapısı YOK — free kullanıcılar için sınırsız gpt-4o çağrısı

**Dosya:** `supabase/functions/ai-plan/index.ts:92-126, 482-487`

**Sorun:** checkRateLimit (tek per-user maliyet kontrolü) YALNIZCA ai-chat'e bağlı. ai-plan edge fonksiyonu WEEKLY dalı isActivePremium ile kapılar (satır 113), ama DAILY plan yolu getUserId()'den generateDailyPlan'a premium kontrolü VE rate-limit OLMADAN gider. generateDailyPlan SMART tier'da (default gpt-4o) maxTokens 3000 ve jsonMode ile chatCompletion çağırır. Geçerli user JWT tutan herhangi bir authenticated free kullanıcı (veya script) ai-plan'a `daily` tipiyle tekrar tekrar POST atıp sınırsız gpt-4o token yakabilir. Rate-limit modülünün kapatmak için inşa edildiği 'free-tier maliyet açığı' sınıfı, ama ai-plan onun erişiminin dışında.

**Etki:** Maliyet-kontrol bypass'ı: free kullanıcılar sınırsız pahalı günlük plan üretebilir, monetizasyon/maliyet modelini boşa çıkarır. En pahalı (gpt-4o, 3000-token) üretim yolunda suistimal tavanı yok.

**Kanıt:**
```
const userId = await getUserId(req);
// === DAILY PLAN GENERATION ===
const ctx = await buildFullContext(userId);
const plan = await chatCompletion(..., { temperature: TEMPERATURE.plan, maxTokens: 3000, jsonMode: true });
// checkRateLimit yok, bu yolda isActivePremium yok
```

**Öneri:** ai-plan daily yolunun başında generateDailyPlan öncesi `checkRateLimit(userId)` (veya özel düşük günlük plan tavanı) çağır ve aşırı yeniden-üretimleri kapıla. Tavanın ai-chat ile tutarlı olması için paylaşılan rate-limit modülünü yeniden kullan.

---

### [HIGH] AI-INT-01 — AI action yazımları istemci retry'da yeniden çalışıyor (idempotency anahtarı yok) — su/supplement/workout/commitment mükerrer, recovery-plan kalori kesintisi çift uygulanıyor

**Dosya:** `supabase/functions/ai-chat/index.ts:2642-2649, 3036-3050, 3087-3112, 3489-3535`; `src/services/chat.service.ts:178-200`

**Sorun:** executeActions() her ai-chat çağrısında koşulsuz çalışır. İstek body'si idempotency/message-id TAŞIMAZ ve sunucu-tarafı request-dedup yoktur. İstemci (chat.service.ts:178-200) invoke'u 60s timeout race'iyle sarar ve REQUEST_TIMEOUT'ta AYNI body'yi yeniden-invoke eder (yorum 180-182 'altyapı isteği devam edebilir' der). İlk yavaş istek sunucuda gerçekten tamamlandıysa, retry her action'ı yeniden çalıştırır. meal_log 10-dk raw_input dedup'ı ile korunur, ama diğerleri idempotent DEĞİL: water_log ARTIRIR (3039: next = waterFor + l) — su çift sayılır; supplement_log (3092) ve workout_log (2886) unique constraint'siz düz insert — satır + tüm strength_sets çiftlenir, 'pr' achievement yeniden ateşlenebilir; commitment/mvd_activate/recovery_plan mükerrer user_commitments insert eder; recovery_plan (3529-3532) sonraki 2 günün daily_plans'ından kaloriyi YENİDEN çıkarır (gelecek hedefleri çift-keser). DB seviyesinde (mig 002/003) workout_logs/supplement_logs/user_commitments'te unique constraint YOK.

**Etki:** Herhangi bir yavaş (>60s) ama nihayetinde başarılı sohbet çağrısında (cold start, vision+chat+extraction zinciri, OpenAI gecikmesi), kullanıcı sessizce mükerrer supplement/workout/su logu, şişirilmiş su toplamları, yaklaşan günlerde çift kalori kesintisi ve muhtemelen mükerrer PR kutlaması alır — izlenen veriyi ve aşağı-akış kalori matematiğini bozar.

**Kanıt:**
```
chat.service.ts:184-199  Promise.race([invoke('ai-chat',{body}), timeout(60_000)]); ... if (timedOut && attempt < maxRetries) continue;
index.ts:3039  const next = (await waterFor(actionDate)) + l;        // artırma
index.ts:3092  await supabaseAdmin.from('supplement_logs').insert({...})  // dedup yok
index.ts:2886  await supabaseAdmin.from('workout_logs').insert({...})    // dedup yok
index.ts:3529-3532  daily_plans update her çağrıda perDayDip çıkarır
```

**Öneri:** ai-chat body'sine istemci-üretimi bir idempotency anahtarı (ör. message uuid) ekle ve executeActions öncesi sunucuda kontrol et/kalıcılaştır, VEYA her idempotent-olmayan action'ı idempotent yap: water_log/supplement_log/workout_log/commitment'e yakın-mükerrer guard'ı (meal_log'un 10-dk penceresini yansıtarak) ekle ve uygun yerlerde unique constraint koy.

---

### [HIGH] AI-INT-02 — ai-proactive hedef faz-ilerletme, hedefleri iki ayrı statement'ta deaktive+aktive ediyor (transaction yok) — kullanıcı SIFIR aktif hedefle kalabilir

**Dosya:** `supabase/functions/ai-proactive/index.ts:910-913`

**Sorun:** Çok-fazlı bir hedefe ulaşıldığında cron, sonraki faza iki bağımsız, atomik-olmayan UPDATE ile ilerler: önce TÜM aktif hedeflerde is_active=false (satır 912), sonra ayrı bir await'te sonraki fazda is_active=true (satır 913). İkinci UPDATE başarısız olursa (geçici DB hatası, cron ortası bağlantı kopması) kullanıcı HİÇ aktif hedefsiz kalır. Bu, migration 057'nin atomik set_active_goal() RPC'sini önlemek için yarattığı tam veri-kaybı senaryosudur ('goals .update(is_active=false) sonra ayrı .insert(): insert hata verirse hiç aktif hedef kalmaz'). goal_suggestion (index.ts:3852) ve approve yolları atomik RPC'ye taşındı, ama bu ai-proactive faz-ilerletme kaçırıldı ve hâlâ güvensiz iki-statement pattern'ini kullanır.

**Etki:** Yarı-başarısız bir faz geçişi kullanıcıyı sıfır aktif hedefle bırakır; is_active=true sorgulayan her aşağı-akış reader'ı (plan projeksiyonu, kalori faktörü, dashboard ilerleme, ai-chat context) null alır ve kullanıcıyı sessizce maintenance/hedefsiz davranışa döndürür — kırık planlar ve kaybolmuş hedef durumu, hiçbir hata yüzeye çıkmadan.

**Kanıt:**
```
if (nextPhase) {
  await supabaseAdmin.from('goals').update({ is_active: false }).eq('user_id', profile.id).eq('is_active', true);
  await supabaseAdmin.from('goals').update({ is_active: true }).eq('id', nextPhase.id);  // iki ayrı await, transaction yok
```

**Öneri:** Satır 912-913'ü tek atomik işlemle değiştir: deaktive+aktive'yi tek transaction'da çeviren bir SECURITY DEFINER faz-ilerletme RPC'si (set_active_goal'un faz-ilerletme analoğu) yaz. Not: nextPhase zaten mevcut olduğundan set_active_goal (deaktive-sonra-INSERT) doğrudan geçmez; her iki UPDATE'i bir tx'e saran küçük bir RPC doğru çözümdür.

---

### [HIGH] AI-PRO-04 — Cron-korumalı fleet fonksiyonları FAIL-OPEN: CRON_SECRET set değilken herkes fleet-çapında LLM/push çalıştırabilir

**Dosya:** `supabase/functions/shared/cron-auth.ts:14-23` (denyIfNotCron); config: `supabase/config.toml:76-83`

**Sorun:** ai-proactive ve cleanup-scheduled `verify_jwt=false` ile çalışır (config.toml:76-83) ve TEK kapıları denyIfNotCron'dur; bu, CRON_SECRET env değişkeni set değilken null (izin ver) döndürür ('not configured → allow (fail open)'). Schedule migration 056 secret'ı yalnızca DB GUC `current_setting('app.settings.cron_secret', true)`'tan (missing_ok=true) okur ve header yorumu GUC+edge env set etmenin deploy'da yapılması gereken bir 'operasyonel adım' olduğunu söyler. Yani operatörün HEM CRON_SECRET (edge runtime env) HEM eşleşen DB GUC'u set etmediği herhangi bir ortamda, bu public, JWT-siz endpoint'ler URL'i bilen herkesten unauthenticated POST {} kabul eder ve tüm fleet'in per-user LLM çağrılarını + Expo push'larını çalıştırır. ai-proactive ek olarak ai-report'a (o da verify_jwt=false) internal fetch zincirler, maliyeti artırır.

**Etki:** Deploy adımı atlanırsa (kolay: manuel GUC/env adımı, migration ile zorlanmaz), fonksiyon URL'ini keşfeden bir saldırgan fleet-çapında AI üretimi ve push bildirimlerini tekrar tekrar tetikleyebilir — kontrolsüz OpenAI harcaması, her kullanıcıya push spam ve DB yazma amplifikasyonu. Gerçek bir suistimal/maliyet vektörü, çünkü guard opt-in.

**Kanıt:**
```
export function denyIfNotCron(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return null; // not configured → allow (fail open)
  const got = req.headers.get('x-cron-secret');
  if (got === expected) return null;
  return new Response(JSON.stringify({ error: 'forbidden' }), { status: 401 });
}
--- config.toml --- [functions.ai-proactive] verify_jwt = false / [functions.cleanup-scheduled] verify_jwt = false
```

**Öneri:** Bu fleet endpoint'leri için FAIL-CLOSED yap: CRON_SECRET set değilse reddet (veya en az geçerli service-role bearer iste). Secret'ı sert bir deploy gereksinimi yap (cron migration uygulanmadan önce hem edge env hem DB GUC'un konfigüre edildiğini CI ile doğrula). En azından fail-open çalışırken yüksek-sesle logla. (Not: fail-open kasıtlı bir tasarım tercihi — secret yokken tüm cron'ları kilitlememek için; bu güvenlik-vs-erişilebilirlik dengesinin fleet endpoint'leri için fail-closed'a kaydırılması gerekir.)

---

### [MEDIUM] AI-ORC-04 — Acil/kriz/ED-yüksek güvenlik yanıtları storeMessages DB yazımının arkasında kapılanıyor; SESSION_NOT_FOUND veya geçici insert hatası kriz yönlendirmesini genel hata ile değiştiriyor

**Dosya:** `supabase/functions/ai-chat/index.ts:116-138, 2562-2573, 1759-1772`

**Sorun:** Acil (detectEmergency), kendine-zarar krizi (detectCrisis) ve yüksek-şiddet ED taraması, `respond(<güvenlik mesajı>)` ÖNCESİNDE `await storeMessages(...)` yapar. storeMessages, istemci-sağlanan session_id çözülmediğinde SESSION_NOT_FOUND fırlatır (2569-2573, kasıtlı fail-closed) ve herhangi bir geçici chat_messages insert hatasında da reject/throw eder. Güvenlik dalı storeMessages'i önce await ettiğinden, bir throw dış catch'e (satır 1759) unwind olur, 404 'Oturum bulunamadi' (veya genel AI_INTERNAL 500) döndürür — akut krizdeki kullanıcı 112 / profesyonel-yardım yönlendirmesini asla almaz. Normal istemci hep geçerli session_id gönderir, ama silinmiş/eski oturum (ör. KVKK bellek sıfırlama sonrası yazılan veya closeSession ile yarış) bunu erişilebilir kılar.

**Etki:** Sıkıntılı/intihar eğilimli kullanıcı bir uç durumda kriz/acil yönlendirmesi yerine 'session not found' veya genel hata alabilir. Güvenlik-kritik yanıtlar asla başarılı, kritik-olmayan bir history yazımına bağlı olmamalı.

**Kanıt:**
```
const crisis = detectCrisis(message);
if (crisis.isCrisis) {
  await storeMessages(userId, message, crisis.message, 'safety', ..., session_id);
  return respond({ message: crisis.message, actions: [], task_mode: 'safety' });
}
// storeMessages: if (!existing) throw new Error(`SESSION_NOT_FOUND: ${externalSessionId}`);
// dış catch: if (msg.startsWith('SESSION_NOT_FOUND')) return respond({ error:'Oturum bulunamadi...' }, 404);
```

**Öneri:** Güvenlik yanıtını ÖNCE gönder (veya kalıcılaştırma başarısız olsa bile hesapla ve döndür): güvenlik dallarındaki storeMessages çağrısını kendi try/catch'ine sar (başarısızlıkta logla) ki kriz/acil/ED-yüksek `respond(...)` history yazımından bağımsız garanti döndürülsün. Güvenlik turunun kalıcılaştırılması best-effort, kapı değil.

---

### [MEDIUM] AI-ORC-05 — İstemci-sağlanan target_date format/aralık/gelecek-tarih doğrulaması olmadan log yazımlarına iletiliyor (clamp'li days_ago yolunun aksine)

**Dosya:** `supabase/functions/ai-chat/index.ts:60, 1538, 2650, 2683-2685`

**Sorun:** `target_date` istek body'sinden destructure edilir ve doğrudan executeActions'a `targetDate` olarak geçer, `today = targetDate ?? ...` (2650) olur ve meal/water/sleep/mood/weight için `logged_for_date`/`daily_metrics.date` olur. validateChatRequest target_date'i hiç doğrulamaz. Doğal-dil backdate yolu açıkça 1-7 güne clamp'lenir ve asla gelecek değildir (`rawDaysAgo >= 1 && rawDaysAgo <= 7`, 2683-2685), ama target_date bunu tamamen bypass eder. Geçerli-ama-absürt tarih ('3026-01-01', '1900-01-01') sessizce kabul edilip yazılır; bozuk string ('2026-13-99') tarih kolonuna ulaşıp action-bazlı 23xxx-fail eder.

**Etki:** Hazırlanmış veya hatalı bir istemci, meal/metrik satırlarını geçmişe veya geleceğe keyfi olarak yazabilir; kilo trendlerini, haftalık kalori uzlaşımını, günlük raporları ve hedef/ETA matematiğini bozar. Aynı yazımlar için days_ago'nun kasıtlı 1-7-gün clamp'iyle tutarsız.

**Kanıt:**
```
const { message, image_base64, target_date, ... } = body;
... executeActions(userId, actions, profile?.gender, (target_date) ?? effectiveToday, inputSource);
const today = targetDate ?? new Date().toISOString().split('T')[0];
// request-validator.ts validateChatRequest target_date'e hiç değinmez
```

**Öneri:** target_date'i sunucu-tarafında doğrula: `/^\d{4}-\d{2}-\d{2}$/` iste, parse et, NaN'ı reddet ve makul pencereye clamp'le (ör. effectiveToday'e göre gelecekte değil, ~30-90 günden eski değil) — days_ago clamp'inin sınır felsefesiyle eşleşerek.

---

### [MEDIUM] AI-ORC-06 / AI-MEM-04 — JSONB belleğin read-modify-write'ı JS'te yapılıp atomik merge RPC ile yazılıyor; atomik append RPC'si ölü — eşzamanlı yazarlar pattern/not kaybediyor

**Dosya:** `supabase/functions/ai-chat/index.ts:4079-4163, 4354-4357`; `supabase/functions/shared/memory.ts:441-453, 545-560`

**Sorun:** processLayer2Updates önce mevcut ai_summary satırını `existing`'e okur (4081), JS'te mutate edilmiş diziler/string'ler hesaplar (behavioral_patterns push/dedup, coaching_notes concat, portion_calibration merge, features_introduced vb.), sonra `updateLayer2(userId, changes)` ile `ai_summary_merge` RPC'sine yönlendirir. RPC tek merge statement'ı için atomik (FOR UPDATE) olsa da, sağlanan her anahtarı JS'te hesaplanan değerle COALESCE-REPLACE eder — 4081'deki okuma ve 4355'teki yazma TEK transaction DEĞİLDİR. Aynı kullanıcı için iki eşzamanlı ai-chat çağrısı (iki cihaz, veya hızlı ardışık mesajların async Layer-2 yazımları örtüşür) aynı `existing`'i okur, her biri farklı bir tam dizi hesaplar ve ikinci merge ilkinin eklediğini ezer. Migration 015/045 bunu önlemek için atomik `ai_summary_append_patterns()` inşa etti ve memory.ts:441-453 `appendBehavioralPatterns()`'i sundu — ama grep ile hiçbir yerde çağrılmaz (ölü kod). Hem ai-chat (her tur) hem evolvePatternConfidence (günlük tier-2) racy array-replace kullanır.

**Etki:** Koç belleğinde lost-update: bir eşzamanlı turdan eklenen davranışsal pattern, coaching notu, porsiyon-kalibrasyon gözlemi veya completed-feature flag'i diğeri tarafından sessizce ezilebilir; bir chat turu ile günlük evolver (veya iki yakın chat turu) interleave olduğunda yeni-tespit pattern'ler veya tazece-artırılmış times_observed/confidence kaybolabilir. Migration 015'in atomik append'inin önlemek için yaratıldığı tam veri-kaybı yarışı, güvenli helper kullanılmadığı için hâlâ açık.

**Kanıt:**
```
const { data: existing } = await supabaseAdmin.from('ai_summary').select('...behavioral_patterns, coaching_notes, portion_calibration...').eq('user_id', userId).maybeSingle();
changes.coaching_notes = `${current}\n[${dateStr}] ${updates.coaching_note}`.trim();
changes.behavioral_patterns = patterns;  // `existing`'ten hesaplandı
await updateLayer2(userId, changes);  // ai_summary_merge her anahtarı JS-hesaplı değerle replace eder
// memory.ts:446 appendBehavioralPatterns -> rpc('ai_summary_append_patterns')  // grep: çağıran yok, ölü kod
```

**Öneri:** Append/merge-tipi JSONB kolonları (coaching_notes, behavioral_patterns, portion_calibration, features_introduced, seasonal_notes, social_eating_notes) için read-modify-write'ı kilitli Postgres fonksiyonu içinde yap. Özellikle yeni-pattern eklemelerini zaten-inşa-edilmiş `appendBehavioralPatterns()`/`ai_summary_append_patterns` üzerinden (yalnız YENİ pattern'leri geçerek) yönlendir; mevcut girdilerin dedup/observe/decay'ini ayrı bir kilitli RPC'ye taşı.

---

### [MEDIUM] AI-SYS-02 — Temel prompt 'hastalik'/'tedavi' kelimelerini yasaklıyor ama hastalık akışı modelin bunları söylemesini gerektiriyor

**Dosya:** `supabase/functions/ai-chat/system-prompt.ts:188` (KESIN KURALLAR #2) vs `377-383, 432-434`

**Sorun:** KESIN KURALLAR #2 (satır 188) mutlak bir yasak: "ASLA 'hastalik', 'tedavi', 'ilac', 'recete' kullanma". Ama aynı promptun DONEMSEL DURUM > HASTALIK bölümü modele hastalık etrafında aktif koçluk yapmasını ve hastalık-durum mesajlarını söylemesini der: satır 380 "IF OTOMATIK durdur - 'Hastalikta IF uygun degil, durdurdum'". Periodic mode ve periodic action `state: 'illness'` kullanır. Guardrail katmanı çıplak 'hastalık'ı KASITLI olarak FORBIDDEN_PHRASES'ten dışlar (guardrails.ts:19-23 yorumu: 'bare hastalık deliberately NOT here — the app itself labels the illness periodic state with it'), uygulamanın kelimeye ihtiyacı olduğunu onaylar. Yani kural #2 hem promptun kendi hastalık akışıyla hem kodun niyetiyle çelişir.

**Etki:** Çelişen talimatlar: kural #2'ye uyan bir model hastalık durumunu adlandırmayı reddeder, gerekli 'Hastalıkta IF uygun değil, durdurdum' mesajını ve tüm hastalık-dönem koçluğunu bozar. En iyi ihtimalle model çelişkiyi keyfi çözer; en kötü meşru, gerekli yanıtları bastırır.

**Kanıt:**
```
Line 188: "2. ASLA \"hastalik\", \"tedavi\", \"ilac\", \"recete\" kullanma"
Line 380: "- IF OTOMATIK durdur - \"Hastalikta IF uygun degil, durdurdum\""
guardrails.ts:19-23: "NOTE: bare 'hastalık' is deliberately NOT here — the app itself labels the illness periodic state with it"
```

**Öneri:** Kural #2'yi yalnız klinik aşırılığa daralt (ör. 'teşhis/tanı/tedavi/ilaç/reçete'yi reçeteleme anlamında yasakla) ve 'hastalık'ın yaşamsal/dönemsel kullanımını açıkça muaf tut — guardrail'in belgelenmiş istisnasıyla eşleşerek.

---

### [MEDIUM] AI-SYS-03 — Persona-tespit promptu parser'ın sessizce düşürdüğü JSON-olmayan bir `<layer2_update>` öğretiyor

**Dosya:** `supabase/functions/shared/repair-handler.ts:356-359` (buildPersonaDetectionPrompt) vs `system-prompt.ts:310-313` ve parser `index.ts:2445-2447`

**Sorun:** Temel prompt persona yazımları için doğru JSON biçimini öğretir (`<layer2_update>{"user_persona": "disiplinli|..."}</layer2_update>`). Ama persona-tespit gerektiğinde sistem promptuna eklenen buildPersonaDetectionPrompt FARKLI, JSON-olmayan bir biçim öğretir: `<layer2_update>\nuser_persona: [tespit edilen persona]\n</layer2_update>`. Extractor (index.ts:2445-2447) `JSON.parse(match[1])`'i `try { } catch { /* ignore */ }` içinde yapar. Persona-tespit varyantı (parantez/tırnak yok, literal `[...]` placeholder) geçersiz JSON olduğundan JSON.parse fırlatır ve güncelleme sessizce atılır.

**Etki:** Model daha yeni/spesifik persona-tespit talimatını literal izlerse (en son eklendiği ve açık tetikleyici olduğu için doğal eğilim), persona parse-edilip-düşürülür: user_persona ai_summary'ye asla yazılmaz, persona-bazlı ton ayarı (Spec 5.15) asla aktive olmaz ve shouldDetectPersona her eşik penceresinde (başarısız) tespiti yeniden-tetikler.

**Kanıt:**
```
repair-handler.ts:357-359: "<layer2_update>\nuser_persona: [tespit edilen persona]\n</layer2_update> blogu ile kaydet."
system-prompt.ts:311-313 (doğru): "<layer2_update>\n{\"user_persona\": \"disiplinli|...\"}\n</layer2_update>"
index.ts:2447: "try { updates = JSON.parse(match[1]); } catch { /* ignore */ }"
```

**Öneri:** buildPersonaDetectionPrompt'u temel promptla aynı geçerli JSON'u emit edecek şekilde değiştir: `<layer2_update>{"user_persona": "disiplinli|motivasyon_bagimlisi|minimalist|veri_odakli|sosyal_yiyici|stres_yiyici"}</layer2_update>`.

---

### [MEDIUM] AI-SYS-04 — plan_workout disliked_exercises talimatı önceki sakatlık/dislike geçmişinin üzerine yazılmasına yol açıyor

**Dosya:** `supabase/functions/ai-chat/task-modes.ts:476-478` (plan_workout PAZARLIK) vs handler `index.ts:3201`

**Sorun:** Workout-plan pazarlığında plan_workout modu modele yeni kısıtı tek string olarak kalıcılaştırmayı der: `{"type":"profile_update","disliked_exercises":"squat (diz sakatligi)"}` (task-modes.ts:477). Handler (index.ts:3201) bunu düz overwrite ile uygular: `if (action.disliked_exercises) updates.disliked_exercises = action.disliked_exercises;` — mevcut değere EKLEMEZ. Temel prompt (system-prompt.ts:151) de disliked_exercises'i tek virgül-ayrık string tanımlar ve modele yalnızca az önce swap ettiği egzersizi emit etmesini söyler. Yani her sonraki pazarlık turu (veya farklı sakatlık hakkında sonraki oturum) tüm alanı değiştirir, önceden kaydedilmiş her dislike/sakatlık egzersizini düşürür.

**Etki:** Zamanla biriken sakatlık-kaynaklı egzersiz dışlamaları sessizce kaybolur. Önce 'squat (diz sakatligi)', sonra 'deadlift (bel fitigi)' bildiren kullanıcıda yalnız 'deadlift' kalır; diz kısıtı plan üretiminin okuduğu profilden kaybolur, böylece bilinen diz sakatlığına rağmen gelecek planda squat yeniden gelebilir.

**Kanıt:**
```
task-modes.ts:477: "<actions>[{\"type\":\"profile_update\",\"disliked_exercises\":\"squat (diz sakatligi)\"}]</actions>"
index.ts:3201: "if (action.disliked_exercises) updates.disliked_exercises = action.disliked_exercises;"  // overwrite
// karşılaştır: disliked_foods append index.ts:3220-3225 (dedup + concat)
```

**Öneri:** Ya modele TAM kümülatif disliked_exercises string'ini (önceki kalemler dahil) emit ettir, ya da handler'ı disliked_exercises'i overwrite yerine merge/append (dedup) edecek şekilde değiştir — index.ts:3220-3225'teki disliked_foods append+dedupe mantığını yansıtarak.

---

### [MEDIUM] AI-CTX-01 — Layer-3 "bugün/dün" ham UTC tarihi kullanıyor, kullanıcının efektif günü değil → bugünün öğünleri/metrikleri yanlış atfediliyor veya "KAYIT YOK" gösteriliyor

**Dosya:** `supabase/functions/shared/context-builders.ts:452-453, 518-520, 536`

**Sorun:** buildContextFromPlan / buildLayer3Scoped referans günü SUNUCUNUN ham UTC saatinden hesaplar (`new Date().toISOString().split('T')[0]`), ama her YAZMA yolu `meal_logs.logged_for_date` ve `daily_metrics.date`'i kullanıcının EFEKTİF gününe (timezone + day_boundary_hour, Spec 2.8) anahtarlar. buildContextFromPlan'in imzası efektif gün için parametre içermez ve ai-chat çağıranı (index.ts:277) zaten hesapladığı effectiveToday'i (index.ts:243) GEÇMEZ. Sonuç: okuma-tarafı `today`/`yesterday` filtreleri, UTC takvim tarihi efektif tarihten farklı her kullanıcı için yazma-tarafı tarihiyle anlaşmazlık yaşar. Yaygın `meal_log` planında (daysBack=1) tazece-loglanan öğün efektif tarihe (=UTC-dün) düşer, fetch edilir ama `daysBack >= 2` yesterday bloğu daysBack=1'de çalışmadığından öğün HİÇBİR YERDE render edilmez. AI kullanıcıya bugün hiçbir şey loglamadığını söyler / yenilen öğünü yeniden önerir. Bu, service-contexts.ts'in açıkça düzeltildiği (resolveEffectiveToday + AI/HIGH FIX yorumları) bug sınıfıdır — context-builders.ts kalan tek düzeltilmemiş örnek.

**Etki:** UTC dışındaki her kullanıcı için tarih dönüşüne yakın (ve negatif-offset bölgelerde tüm akşam) öğün ve metriklerin yanlış-gün atfı. Model kullanıcıya bugün yemediğini/loglamadığını söyler, çift-sayar, kalan bütçeyi yanlış hesaplar ve hatalı kalori/öğün koçluğu verir. (Not: bu okuma-tarafı bir context/prompt-kalite hatasıdır; yazma yolu doğru anahtarlar, veri bozulması yoktur. Birincil Türk UTC+3 tabanı için anlaşmazlık yerel gece yarısına yakın dar bir pencere ile sınırlı.)

**Kanıt:**
```
452 const today = new Date().toISOString().split('T')[0];
518 const todayMeals = meals.filter(m => m.logged_for_date === today);
520 const todayMetrics = metrics.find(m => m.date === today);
527 } else { parts.push('Ogunler: KAYIT YOK'); }
536 const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
--- ai-chat/index.ts ---
243 const effectiveToday = getEffectiveDateForUser(userTz, profile?.day_boundary_hour);
277 const ctx = await buildContextFromPlan(userId, retrievalPlan, effectiveSessionId);   // effectiveToday GEÇİLMİYOR
```

**Öneri:** Çağıranın effectiveToday'ini (ve ideal olarak tz + day_boundary_hour) buildContextFromPlan → buildLayer3Scoped → formatLayer3'e thread et — service-contexts.ts'in resolveEffectiveToday/getEffectiveDateForUser ile yaptığı gibi. `today` ve yesterday/per-day türetimlerini effectiveToday üzerine demirlenmiş efektif-gün aritmetiğiyle (ör. shiftDateString(effectiveToday, -1)) değiştir.

---

### [MEDIUM] AI-CTX-03 — Toplam context token-bütçesi uygulanmıyor; estimatedTokens hesaplanıyor ama kontrol edilmiyor, Layer-3 8-30. gün öğünlerini fazla-fetch'leyip atıyor

**Dosya:** `supabase/functions/shared/context-builders.ts:44-50, 459-462, 563-589`

**Sorun:** Yalnızca Layer 4 (chat history) bütçeye kırpılır (LAYER4_TOKEN_BUDGET=6000). Layer 1-3'ün kapağı yok: buildContextFromPlan `estimatedTokens`'i toplar ama değer hiçbir limitle karşılaştırılmaz ve ai-chat çağıranı (index.ts:511-518) ctx.layer1/2/3 + tüm servis context'lerini ctx.estimatedTokens'ı okumadan/kırpmadan sistem promptuna birleştirir. Ayrıca buildLayer3Scoped'in meals sorgusunda `.limit()` yok; full-detail planlarda (general_analysis daysBack=14, full) meals fetch edilir ama formatLayer3 yalnız bugün/dün/2-7. gün öğünlerini render eder (döngü min(daysBack,8)'de biter) — 8+. gün öğünleri fetch edilip sessizce atılır. gpt-4o (128k pencere) ile bu nadiren taşar; sert çökme değil, maliyet/gecikme israfı.

**Etki:** Her full-detail analist/koçluk/plateau çağrısında boşa giden DB I/O ve prompt token'ı (maliyet/gecikme); model penceresi küçülürse veya per-gün veri olağandışı büyükse context taşmasına karşı güvenlik ağı yok. (Düzeltme: orijinal bulgu örneği plateau_diagnosis idi; gerçek meal fazla-fetch vakası general_analysis'tir — plateau scope'unda 'meals' yok.)

**Kanıt:**
```
44  const totalTokens = estimateTokens(layer1) + ... layer4.reduce(...);
50  return { ..., estimatedTokens: totalTokens };   // çağıran tarafından hiç tüketilmez
459 queries.meals = supabaseAdmin.from('meal_logs').select(...).gte('logged_for_date', startDate)...order('logged_at');  // .limit() yok
563 for (let d = 2; d < Math.min(daysBack, 8); d++) {   // 8-30. gün öğünleri fetch edilir, hiç render edilmez
```

**Öneri:** meals/workouts sorgularını formatLayer3'ün gerçekten render ettiğine (bugün + dün + 2-7. gün) boyutlanmış `.limit()` ile kapağa al ve 8+. günleri reports-only sorguya bağla veya öğünlerini fetch etme. buildContextFromPlan'e estimatedTokens tavanı aşıldığında Layer-3'ü (en eski önce) kırpan bir toplam-bütçe kontrolü ekle (Layer-4 kırpma pattern'ini yansıtarak).

---

### [MEDIUM] AI-MEM-03 — analyzeLateMealSleep caffeine_sleep_notes'u ÜZERİNE YAZIYOR (veri kaybı) ve içgörüyü kafein başlığı altında yanlış etiketliyor

**Dosya:** `supabase/functions/shared/memory.ts:612-613`

**Sorun:** analyzeLateMealSleep geç-öğün→uyku korelasyonunu `caffeine_sleep_notes` kolonuna `updateLayer2(userId, { caffeine_sleep_notes: note })` ile yazar (memory.ts:613). caffeine_sleep_notes TEXT/scalar kolon olduğundan ai_summary_merge bunu `COALESCE(p_patch->>'caffeine_sleep_notes', ...)` ile ele alır (migration 045:68) — yani tam OVERWRITE, append değil. Bu arada chat yolu gerçek kafein notlarını AYNI kolona APPEND ederek biriktirir (ai-chat/index.ts:4275-4278). Yani analyzeLateMealSleep'in her haftalık ai-extractor çalışması, tüm birikmiş kafein-notları geçmişini tek geç-öğün cümlesiyle değiştirir. Her iki reader da bunu yanlış etiketle yüzeye çıkarır: memory.ts:186 ve context-builders.ts:367 'Kafein-uyku: ${s.caffeine_sleep_notes}'.

**Etki:** Chat'te birikmiş kafein-uyku gözlemleri haftalık sessizce silinir (bellek/veri kaybı) ve bir öğün-zamanı içgörüsü modele 'kafein-uyku' gerçeği olarak sunulur, öğrenilen sinyali bozar.

**Kanıt:**
```
memory.ts:612-613  const note = `Gec yemek (21:00+) → uyku kalitesi ...`; await updateLayer2(userId, { caffeine_sleep_notes: note });
045:68  caffeine_sleep_notes = COALESCE(p_patch->>'caffeine_sleep_notes', caffeine_sleep_notes),  // overwrite
ai-chat/index.ts:4276-4277  const current = (existing?.caffeine_sleep_notes) ?? ''; changes.caffeine_sleep_notes = current ? `${current}\n${updates.caffeine_note}` : ...;  // aynı kolona append
```

**Öneri:** Geç-öğün-uyku içgörüsüne kendi kolonunu ver (ör. özel bir not alanı) veya overwrite yerine append et; caffeine_sleep_notes'u paylaşması gerekiyorsa, scalar yerine mevcut değeri önce oku ve tarih-damgalı satır append et (chat yolunu yansıtarak).

---

### [MEDIUM] AI-PLN-02 — ai-plan'in tüm günlük-plan üretim dalı erişilemez ölü kod — yalnızca type:'weekly' çağrılıyor

**Dosya:** `supabase/functions/ai-plan/index.ts:123-749` (daily dal); `src/services/weekly-plan.service.ts:162-165`

**Sorun:** ai-plan edge fonksiyonunun tek prodüksiyon çağıranı weekly-plan.service.ts:162-165'tir ve hep body={ type: 'weekly', ... } geçer; bu generateWeeklyPlan'a (index.ts:106-121) yönlenir ve daily dalından önce döner. periodic.service.ts:217-218 legacy daily ai-plan auto-invocation'ın kaldırıldığını açıkça not eder. Hiçbir cron veya başka edge fonksiyon ai-plan'ı daily body ile invoke etmez (repo-geneli grep weekly-plan.service.ts:165'i tek invoke('ai-plan') olarak gösterir). Dolayısıyla index.ts:123-749 — ~600 satır, tüm goal/TDEE/alerji/sakatlık/periodic/velocity guardrail'leri ve daily_plans insert'i dahil — hiçbir kullanıcı için çalışmaz.

**Etki:** Bu daldaki dikkatle-inşa edilmiş günlük guardrail'ler (goal-bazlı açık, cinsiyet kalori tabanı, kilo-velocity güvenliği, sakatlık/ekipman egzersiz filtreleri, döngü-fazı ayarı, su hedefi) atıl — canlı daily_plans satırları yalnızca plan-projection.ts'ten gelir ve bunların HİÇBİRİNİ uygulamaz. Ayrıca AI-PLN-03/04'ü maskeler. ~600 satır bakımsız, prod'da-test-edilmemiş mantık önemli bir latent-risk ve bakım tehlikesi.

**Kanıt:**
```
weekly-plan.service.ts:163-165: const body = { type: 'weekly' }; ... supabase.functions.invoke('ai-plan', { body });
ai-plan/index.ts:106: if (body.type === 'weekly') { ... return ...; } / 123: // === DAILY PLAN GENERATION ===
// repo-geneli grep invoke('ai-plan') -> yalnız weekly-plan.service.ts:165
```

**Öneri:** Daily dalı sil/devre-dışı bırak (ve plan-projection.ts'i çiftleyen guardrail'leri), VEYA daily generator çalışacaksa bir scheduler/cron'a bağla ve guardrail'lerini projeksiyon yoluna taşı ki canlı daily_plans satırları goal/velocity/sakatlık/ekipman kısıtlarına gerçekten uysun. En azından dalın atıl olduğunu belgele.

---

### [MEDIUM] AI-PLN-03 / AI-EXT-06 — validatePlanOutput hata listesi atılıyor — makro-kalori / öğün-hedef / protein-dağılım tutarlılık kontrolleri ölü (retry yok, Spec 5.29 karşılanmıyor)

**Dosya:** `supabase/functions/ai-plan/index.ts:491-492`; `supabase/functions/shared/output-validator.ts:163-205`

**Sorun:** ai-plan validator'ı çağırır ve yalnız yerinde düzeltmelerini uygular: `const validated = validatePlanOutput(plan); Object.assign(plan, validated.corrected);`. validated.valid veya validated.errors hiç okunmaz. validatePlanOutput içinde birkaç kontrol YALNIZCA errors[]'a push eder ve `output`'u mutate ETMEZ: öğün-kalorisi-vs-hedef kontrolü (163-180), makro-kalori tutarlılığı ve protein-eşit-dağılım kontrolü (182-202). Çağıran errors'ı yoksaydığı ve retry/regeneration döngüsü olmadığı için bu kontroller no-op'tur — önerilen-öğün kalorileri hedeften çok sapan veya proteini tek öğüne yığan bir plan değişmeden saklanır. Spec 5.29'un 'validate → retry'ı burada uygulanmıyor.

**Etki:** İçsel tutarsız makrolu / dengesiz protein dağılımlı / kalori hedefiyle çelişen öğün toplamlı planlar sessizce kalıcılaştırılır. (Şu an daily dal ölü olduğu için maskeli — AI-PLN-02 — ama belgelenmiş doğrulama kapısıdır ve bu kısıtların uygulandığı yanılgısı yaratır.)

**Kanıt:**
```
ai-plan/index.ts:491-492: const validated = validatePlanOutput(plan); Object.assign(plan, validated.corrected);
output-validator.ts:176-178: if (ratio < 0.7 || ratio > 1.3) { errors.push(`Ogun kalorileri toplami ... tutarsiz`); }  // yalnız push
output-validator.ts:198-200: if (imbalanced.length > 0) { errors.push(`Protein dagilimi dengesiz ...`); }
// ai-plan/index.ts'te validated.errors / validated.valid referansı yok
```

**Öneri:** validated.errors'ı tüket: boş değilse modele hata listesiyle yeniden-sor (spec'in retry'ı) veya deterministik düzeltme uygula (öğün seçeneklerini hedefe yeniden-ölçekle, reconcileDietCalories gibi). En azından validated.errors'ı logla ki sessiz tutarsızlıklar gözlemlenebilir olsun.

---

### [MEDIUM] AI-PLN-04 — Faz-geçiş UPDATE'i profiles.calorie_range_rest_*'ı mutate ediyor ama in-memory profile bayat kalıyor — velocity tabanı & haftalık bütçe o gün geçiş-öncesi değerleri kullanıyor

**Dosya:** `supabase/functions/ai-plan/index.ts:146-149, 393-426, 529, 699-704`

**Sorun:** profile bir kez 146-149'da fetch edilir (calorie_range_rest_min/max dahil). Çok-fazlı geçiş bloğu (393-426) sonra profiles.calorie_range_rest_min/max'ı interpolated değerlere UPDATE eder ama in-memory `profile` nesnesini hiç güncellemez. Sonraki kod BAYAT in-memory değerleri okur: kilo-velocity maintenance tabanı `(profile?.calorie_range_rest_min)` (529) ve kanonik haftalık-bütçe fallback restMid (701-702). Yani her geçiş gününde velocity güvenlik tabanı ve weekly_budget_total fallback'i kullanıcının GEÇİŞ-ÖNCESİ rest aralığından hesaplanır, tazece-yazılan interpolated aralıktan değil.

**Etki:** 7-günlük faz geçişinde (Spec 6.7) günün plan bütçesi/tabanı, profiles'a kalıcılaştırılan interpolasyonun bir gün gerisinde kalır, hafif yanlış maintenance tabanı ve haftalık bütçe üretir. Yanlış-ama-sınırlı veri, yalnız geçiş-ortası kullanıcıları daily yolda etkiler. (AI-PLN-02 ile maskeli.)

**Kanıt:**
```
408-411: await supabaseAdmin.from('profiles').update({ calorie_range_rest_min: interpMin, calorie_range_rest_max: interpMax }).eq('id', userId);  // yalnız DB
529: const maintenanceMin = (profile?.calorie_range_rest_min) ?? (calCheck.corrected + 300);  // bayat 146-fetch okur
701-702: const restMid = Math.round(((profile?.calorie_range_rest_min ?? ...) + (profile?.calorie_range_rest_max ?? ...)) / 2);
```

**Öneri:** Geçiş UPDATE'inden sonra in-memory nesneyi de güncelle (`profile.calorie_range_rest_min = interpMin; profile.calorie_range_rest_max = interpMax;`) — veya velocity tabanı / restMid'i doğrudan interpolated değerlerden hesapla — ki aşağı-akış okumaları geçiş-sonrası sayıları kullansın.

---

### [MEDIUM] AI-PRO-01 — Günlük rapor upsert'i SMALLINT makro kolonlarında 22003-taşabilir, tüm raporu kaybeder

**Dosya:** `supabase/functions/ai-report/index.ts:252-270`; kolon tipleri: `supabase/migrations/004_plans_and_reports.sql:65-69`

**Sorun:** generateDailyReport calorie_actual/protein_actual/carbs_actual/fat_actual/alcohol_calories'i toplanan öğün-kalem totallerinden CLAMP'SİZ yazar. Bu beş daily_reports kolonu SMALLINT (max 32767) ve sonraki migration genişletmedi. Fonksiyon compliance_score'u (0-100 clamp) ve steps_actual'ı (INT kolonu için 0..2.000.000 clamp, '#R5-8: non-numeric/absürt değer tüm rapor upsert'ini 22P02/22003 edemez' yorumuyla) açıkça savunur ama bu SMALLINT kolonları korumasız bırakır. Tek bir yanlış-parse öğün kalemi (bu app'te bilinen risk alanı — miktar parse, ör. '10000g'a ölçeklenmiş kalem) totalCal/totalCarb/totalAlcCal'i 32767 üstüne çıkarır, upsert numeric overflow (22003) ile başarısız olur, generateDailyReport 500 döner ve o günün raporu hiç kaydedilmez. Gecelik cron sürekli existingReport bulamayıp yeniden dener.

**Etki:** Kötü/büyük öğün kalemi olan herhangi bir günde kullanıcının günlük raporu sessizce hiç kalıcılaşmaz (cron upsert hatası loglar ve 500 döner). protein_target_met vb. gecelik challenge değerlendiriciyi besler ve haftalık/aylık aggregate'ler daily_reports okur — eksik rapor o gün için streak'leri, haftalık bütçe toplamlarını ve challenge skorunu da bozar.

**Kanıt:**
```
255-257  calorie_actual: totalCal, protein_actual: Math.round(totalPro), carbs_actual: Math.round(totalCarb), fat_actual: Math.round(totalFat), alcohol_calories: totalAlcCal,
--- 004:65-69 ---
calorie_actual SMALLINT DEFAULT 0, protein_actual SMALLINT DEFAULT 0, carbs_actual SMALLINT DEFAULT 0, fat_actual SMALLINT DEFAULT 0, alcohol_calories SMALLINT DEFAULT 0,
```

**Öneri:** Makro totallerini upsert öncesi steps_actual gibi clamp'le: `const clampSmallInt = (n)=>Math.max(0,Math.min(32767,Math.round(n)));` ve calorie_actual/protein_actual/carbs_actual/fat_actual/alcohol_calories'e uygula. Alternatif: kolonları INT'e genişlet.

---

### [MEDIUM] AI-PRO-02 — Fleet pencerelemesi 960. index'in ötesindeki tüm kullanıcıları proaktif LLM uyarılarından mahrum bırakıyor

**Dosya:** `supabase/functions/ai-proactive/index.ts:56-62`

**Sorun:** Ana per-user LLM nudge döngüsü yalnız `fleet`'i işler — startIdx = (utcHour % windowCount) * FLEET_WINDOW ile seçilen 40-kullanıcılık pencere, windowCount = ceil(profiles.length / 40). Cron saatlik ateşler ('7 * * * *', migration 056), utcHour yalnız 0..23 alır. Fleet 40*24 = 960 kullanıcıyı aştığında windowCount > 24 olur ve (utcHour % windowCount) asla 24..windowCount-1 pencere index'lerini üretemez. Array index 960'tan itibaren her kullanıcı (id sırasıyla) hiçbir günün hiçbir saatinde ana nudge döngüsü için seçilmez. Yorum 'tüm fleet'i gün boyunca kapsar' iddiasındadır ama aritmetik kapsamı ilk 960 kullanıcıyla sınırlar.

**Etki:** >960 onboarded kullanıcıda, deterministik bir kullanıcı kuyruğu (id-sıralı) sessizce sıfır LLM-üretimi proaktif uyarı, uyandırma mesajı, plateau/goal/risk tetikleyici alır — bir özellik onlar için hatasız ölür. Prod-öncesi latent, ama uygulama ölçeklendiğinde tam olarak aktive olur. (Yalnız per-user LLM nudge döngüsü açtır; sabah/Pazartesi/auto-report blokları tüm profiles listesini iterate eder.)

**Kanıt:**
```
const windowCount = Math.ceil(fleet.length / FLEET_WINDOW);
const startIdx = (utcHour % windowCount) * FLEET_WINDOW;   // utcHour ∈ [0,23] — windows ≥24 erişilemez
fleet = fleet.slice(startIdx, startIdx + FLEET_WINDOW);
```

**Öneri:** Pencereyi utcHour yerine tam pencere-sayısını kapsayan bir sayaçla döndür. Ör. gün-ve-saat ordinali: `const slot = Math.floor(now.getTime()/3600000) % windowCount; const startIdx = slot * FLEET_WINDOW;` (veya kalıcı cursor). Bu, windowCount ne olursa olsun her pencerenin sonunda seçilmesini garantiler.

---

### [MEDIUM] AI-PRO-03 — Pencereli döngüdeki periodic-state auto-clear, dönem-özeti snapshot'ını VE duraklatılmış-challenge resume'unu atlıyor

**Dosya:** `supabase/functions/ai-proactive/index.ts:1263-1269` (pencereli clear) vs `455-517` (sabah clear)

**Sorun:** Süresi dolmuş periodic_state'i auto-clear eden İKİ kod yolu var. Sabah bloğu (455-517, yerel saat 8-10'a kapılı, tüm profiles listesi) süre dolduğunda üç şey yapar: (1) dönem özetini ai_summary.seasonal_notes'a snapshot'lar (Spec 9), (2) periodic_state'i temizler, (3) duraklatılmış challenge'ları yeniden-aktive eder. Pencereli-döngü IIFE'si (1263-1269) de daysLeft<=0 olduğunda periodic_state'i temizler ama YALNIZ üç kolonu null'lar — seasonal_notes snapshot'lamaz ve duraklatılmış challenge'ları resume etmez. İlk ateşleyen kazanır: kullanıcı sabah-dışı bir saatte (ör. yerel 14:00) pencereli döngüde işlenirse, periodic_state null'lanır, sonraki sabah geçişinde sabah bloğunun `if (!profile.periodic_state) continue`'su atlar ve snapshot + challenge-resume kalıcı kaybolur.

**Etki:** Dönemi dolan kullanıcılar tarihsel-dönem belleğini kaybeder (sonraki Ramazan/hastalık/seyahat için AI'nin referans alacağı seasonal_notes girdisi yok) ve o dönem için duraklatılmış challenge'lar sonsuza dek duraklatılmış kalır (asla resume olmaz). Hangi cron saatinin kullanıcıyı önce işlediğine bağlı, non-deterministik sessiz veri/özellik kaybı.

**Kanıt:**
```
// pencereli (1263-1269) — snapshot/challenge-resume OLMADAN temizler:
if (daysLeft <= 0) { triggers.push(`TETIK: DONEM DOLDU ...`); supabaseAdmin.from('profiles').update({ periodic_state: null, periodic_state_start: null, periodic_state_end: null, ... }).eq('id', profile.id)... }
// sabah (498-507) — state zaten null'lanmışsa atlanan TAM clear:
await supabaseAdmin.from('profiles').update({ periodic_state: null, ... }).eq('id', profile.id);
await supabaseAdmin.from('challenges').update({ status: 'active', paused_at: null }).eq('user_id', profile.id).eq('status', 'paused')...
```

**Öneri:** Pencereli-döngü IIFE'sini state temizlemeyecek şekilde yap (yalnız 'DONEM DOLDU' tetik metnini emit etsin) ve tek, tam sabah bloğunun clear'a sahip olmasına izin ver; ya da tam clear'ı (snapshot + null + challenge resume) tek paylaşılan fonksiyona çıkarıp her iki yerden çağır. İkinci, kayıplı bir clear yolu olmasın.

---

### [MEDIUM] AI-PRO-05 — Otomatik günlük/haftalık raporlar öğün-kaydında kullanılan efektif gün yerine sunucu-UTC gün sınırını kullanıyor

**Dosya:** `supabase/functions/ai-proactive/index.ts:1390-1413` (günlük), `1432-1453` (haftalık)

**Sorun:** Gecelik auto-report tetikleyici yesterdayStr'yi ham sunucu UTC'sinden hesaplar (new Date(now); setDate(-1); toISOString()) ve rapor tarihi olarak ai-report'a geçer. Ama meal_logs.logged_for_date kullanıcının EFEKTİF gününe (timezone + day_boundary_hour, getEffectiveDateForUser) yazılır ve ai-report'un generateDailyReport'u öğünleri eq('logged_for_date', reportDate) ile aggregate eder. timezone/day-boundary'si yerel takvim gününü UTC'den farklılaştıran kullanıcılar için (anlamlı non-UTC+3 bölgesi veya özel day_boundary_hour), 'UTC dün' kullanıcının dünü değildir; auto-report yanlış takvim gününün öğünlerini toplar (veya boş gün). Haftalık tetikleyici aynı UTC demirlemeyi miras alır. Codebase bu uyumsuzluğu chat service-contexts için zaten çözmüş ama rapor cron'u güncellenmemiş.

**Etki:** Non-Türkiye kullanıcıları (ve non-default day_boundary_hour'lu her kullanıcı) yanlış güne anahtarlanmış auto-rapor alır → yanlış compliance skoru, yanlış calorie_actual, yanlış target-met flag'leri ve yanlış haftalık aggregate'ler. Türkiye için (UTC+3) 07:00-09:00 yerel pencere genelde hizalanır, hata yurtiçinde görünmez ama gezginler/expat'lar için doğruluğu bozar.

**Kanıt:**
```
if ((utcHour >= 4 && utcHour <= 6) || forceDaily) {
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];   // ham UTC, her kullanıcı için aynı
  for (const profile of profiles) { ... body: JSON.stringify({ report_type: 'daily', date: yesterdayStr }) ... }
```

**Öneri:** Rapor tarihini per-user `getEffectiveDateForUser(active_timezone ?? home_timezone, day_boundary_hour)` ile hesapla ve kullanıcının 'dün'ünü (`shiftDateString(effectiveToday, -1)`) ai-report'a geçir, tek global UTC yesterdayStr yerine. Not: tz alanları zaten select ediliyor ama day_boundary_hour profil sorgusuna eklenmeli (veya default 4 kabul edilmeli).

---

### [MEDIUM] AI-EXT-03 — Extractor serbest-metin/aliaslı model çıktısını tipli SMALLINT/TIME kolonlara doğrudan yazıyor, etkilenen kullanıcılar için çıkarımı kalıcı donduruyor

**Dosya:** `supabase/functions/ai-extractor/index.ts:22-28, 71-80, 213-240`

**Sorun:** TIER2_FIELDS meal_count_preference (profiles kolonu SMALLINT, mig 001:46) ve work_start/work_end/sleep_time/wake_time'ı (TIME kolonlar, mig 001:41-44) içerir. Hiçbirinin FIELD_ENUMS girdisi yok, normalizeEnumValue() modelin değerini değişmeden döndürür ve değer ham olarak profileUpdates'e yazılır. Çıkarım promptu sayısal/zaman alanları için biçim rehberliği vermez (yalnız FIELD_ENUMS alanları value hint alır). Model meal_count_preference: '3 öğün' / 'üç' / '3-4' veya work_start: 'sabah 9' / '09.00' emit edebilir. Postgres 22P02 (invalid input syntax) yükseltir, tüm profiles UPDATE'ini başarısız eder. Kod (233-239) hata durumunda checkpoint'i KASITLI olarak ilerletmez, batch yeniden denenir — ama model deterministik (temperature 0.1) aynı kötü değeri her çalışmada yeniden-emit eder, o kullanıcının Tier-2 çıkarımı SONSUZA dek takılır ve aynı batch'teki iyi-tipli alanlar da hiç kalıcılaşmaz.

**Etki:** Modeli non-numeric meal_count veya non-ISO zaman string'i emit etmeye götüren her kullanıcının tüm yapısal-çıkarım pipeline'ı kalıcı bloklanır: occupation, sleep, stress, dietary alanları vb. hiç yazılmaz ve aynı döngü gövdesindeki Layer-2 özet merge'i o kullanıcı için hiç çalışmaz.

**Kanıt:**
```
TIER2_FIELDS = [...,'work_start','work_end','sleep_time','wake_time','sleep_quality','meal_count_preference', ...]
001:41-46: sleep_time TIME, wake_time TIME, work_start TIME, work_end TIME, meal_count_preference SMALLINT DEFAULT 3,
index.ts:217: const normalized = normalizeEnumValue(key, value);  // FIELD_ENUMS girdisi yok -> değer değişmeden döner
index.ts:225: profileUpdates[key] = ... normalized;  // '3 öğün'/'sabah 9' -> SMALLINT/TIME -> 22P02 tüm UPDATE'i fail eder
```

**Öneri:** UPDATE öncesi non-enum tipli alanlara coercion/validation ekle: meal_count_preference'i parseInt ile parse et, NaN veya 1-8 dışıysa düşür; TIME alanlarını sıkı HH:MM regex'iyle doğrula ve parse-edilemeyenleri düşür (normalizeEnumValue'nun drop-on-unmappable davranışını yansıtarak). Tek kötü alanı düşürmek, batch'in geri kalanının kalıcılaşmasına ve checkpoint'in ilerlemesine izin verir.

---

### [MEDIUM] AI-EXT-05 — handleUndo eşleşen ifadenin semantiğini yoksayıyor — 'son öğünü sil' kullanıcının son antrenmanını veya supplementini hard-delete edebiliyor

**Dosya:** `supabase/functions/shared/repair-handler.ts:42-45, 101-200`

**Sorun:** UNDO_PHRASES 'son öğünü sil' gibi tip-spesifik komutlar içerir. Ama detectRepairIntent yalnız type:'undo'yu eşleşen ifadeyle döndürür ve ai-chat (index.ts:171-172) handleUndo(userId)'yi tip/ifade argümanı OLMADAN çağırır. handleUndo en son öğünü (soft-delete), antrenmanı (hard-delete) ve supplementi (hard-delete) fetch eder, tüm adayları logged_at'a göre sıralar ve hangisi en yeniyse o tek satırı siler — kullanıcının ne istediğini yoksayar. Yani kullanıcı öğün loglar, sonra antrenman loglar, sonra 'son öğünü sil' derse (açıkça: son ÖĞÜNÜMÜ sil), handleUndo ANTRENMANI siler (en yeni) ve antrenman silme soft-delete/recovery olmadan hard DELETE'tir.

**Etki:** Öğün-spesifik undo veren kullanıcı farklı bir log tipini geri-döndürülemez yok edebilir (workout/supplement hard-delete, is_deleted flag'i yok). Yanlış kaydın veri kaybı, yanlış kalemi adlandıran bir onay mesajıyla.

**Kanıt:**
```
UNDO_PHRASES = [... 'son ogunu sil', 'son öğünü sil', ...]
ai-chat/index.ts:171: if (repairIntent.type === 'undo') { const undoResult = await handleUndo(userId);  // ifade atılır
repair-handler.ts:101: export async function handleUndo(userId: string)  // tip param yok
repair-handler.ts:170: candidates.sort((a,b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()); const target = candidates[0];  // herhangi tipin en yenisi
repair-handler.ts:184-191: case 'workout': await supabaseAdmin.from('workout_logs').delete().eq('id', target.id);  // HARD delete
```

**Öneri:** detectRepairIntent'ten eşleşen ifadeyi/amaçlanan tipi handleUndo'ya geçir ve aday kümesini buna göre kısıtla ('öğün' ifadeleri için yalnız meal vb.). Newest-across-types fallback'ini yalnız genel 'geri al'/'iptal et' ifadeleri için kullan.

---

### [MEDIUM] AI-MDL-01 — Fallback/primary modeller openai.ts'te hardcode — OPENAI_BASE_URL ile sağlayıcı değişimi fallback yolunda kırılıyor

**Dosya:** `supabase/functions/shared/openai.ts:16-19, 105-112, 144-145`

**Sorun:** Sağlayıcı-konfigüre-edilebilirlik tasarımı (OPENAI_BASE_URL + KOCHKO_MODEL_* ile operatör tüm LLM backend'ini saniyeler içinde değiştirir) yalnız yarı-bağlı. model-router.ts chat tier'ları için KOCHKO_MODEL_FAST/SMART/VISION env override'larını okur, ama openai.ts AYRI bir hardcode MODELS sabiti tanımlar ({primary:'gpt-4o', vision:'gpt-4o', fallback:'gpt-4o-mini'}) ve bu env-konfigüre-edilebilir DEĞİL. Her geçici-başarısızlık retry'ı (429/5xx) ve her boş-içerik retry'ı zorla MODELS.fallback = literal 'gpt-4o-mini'ye geçer. Operatör OPENAI_BASE_URL'i non-OpenAI bir gateway'e yönlendirirse (OpenRouter 'openai/gpt-4o-mini' ister, Azure deployment adı kullanır, self-hosted Llama'da 'gpt-4o-mini' hiç yok), override yalnız primary çağrıyı kapsar; ilk geçici hıçkırık tanınmayan model adına downgrade eder ve retry 404/400'ler. ai-extractor (174) ve Whisper STT (ai-chat 90-91) de 'gpt-4o-mini'/'whisper-1' ve api.openai.com host'unu hardcode eder.

**Etki:** Sağlayıcı-değişimi (belgelenmiş quota-outage kurtarma mekanizması) fallback/extractor/STT yollarında sessizce başarısız olur. Sağlayıcı değiştikten sonra normal sohbetler ilk 429/5xx'e dek çalışır gibi görünür, sonra retry bilinmeyen model adına çarpar ve kullanıcı zarif fallback yerine sert hata alır. (Default OpenAI konfigürasyonunda kullanıcı etkisi yok; bu operasyonel/dayanıklılık boşluğu.)

**Kanıt:**
```
const MODELS = { primary: 'gpt-4o', vision: 'gpt-4o', fallback: 'gpt-4o-mini' };
if (model !== MODELS.fallback && transient) { ... return chatCompletion(messages, { ...options, model: MODELS.fallback }); }
```

**Öneri:** openai.ts MODELS'i env'den sür: primary = KOCHKO_MODEL_SMART, vision = KOCHKO_MODEL_VISION, fallback = KOCHKO_MODEL_FAST (mevcut literal'ler default). ai-extractor model'i ve Whisper STT host/model'i de OPENAI_BASE_URL + KOCHKO_MODEL_* (KOCHKO_MODEL_STT) üzerinden yönlendir. Böylece tek secret seti backend'i gerçekten değiştirir.

---

### [MEDIUM] AI-MDL-02 — OpenAI fetch'inde istek timeout'u yok — yavaş/asılı sağlayıcı her sohbeti zarif hata olmadan blokluyor

**Dosya:** `supabase/functions/shared/openai.ts:92-99`

**Sorun:** chatCompletion fetch()'i AbortController/timeout olmadan çağırır. Upstream sağlayıcı asılırsa (OPENAI_BASE_URL custom/self-hosted gateway'e işaret ettiğinde veya OpenAI incident'ında yaygın), istek Supabase edge platform duvar-saati tüm fonksiyonu öldürene dek bloklar. Geçici-başarısızlık yolu da AYNI fetch'ten timeout'suz recursive retry yaptığından, tek yavaş istek iki uzun asılmayı arka arkaya yığabilir. Önceki bir audit ~45s fetchWithTimeout önerdi ama hiç eklenmedi. ai-extractor (167) ve Whisper STT fetch'i aynı timeout'suz.

**Etki:** Sağlayıcı yavaşlığında chat fonksiyonu kullanıcı-yüzlü hata olmadan ve bağlantıyı erken bırakmadan asılır; kullanıcılar süresiz spinner görür ve fonksiyon temiz Türkçe 'servis meşgul' mesajı yerine platform limitinde ölür.

**Kanıt:**
```
const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, { method:'POST', headers:{...}, body: JSON.stringify(body) });  // signal/timeout yok
```

**Öneri:** fetch'i AbortController (ör. 45s) ile sar, AbortError'ı yakala ve timeout'ta ya fast model'e bir kez fallback et ya temiz hata döndür. Aynısını ai-extractor ve Whisper STT fetch'ine uygula.

---

### [MEDIUM] AI-MDL-03 — Retry/backoff kaliteyi düşürüyor: smart modelde tek 429/5xx isteği kalıcı gpt-4o-mini'ye downgrade ediyor, 5xx sıfır backoff alıyor

**Dosya:** `supabase/functions/shared/openai.ts:101-114`

**Sorun:** Herhangi bir geçici başarısızlıkta (429 VEYA status>=500) kod aynı (smart) modeli retry ETMEZ — hemen MODELS.fallback'e (fast/ucuz model) geçer. Backoff YALNIZ 429 için uygulanır (Retry-After veya 500ms); 5xx için downgrade öncesi HİÇ gecikme yok. Yani (a) primary model hiç retry edilmez — tek geçici hıçkırık koçluk/plan/analiz kalitesini gpt-4o'dan gpt-4o-mini'ye sessizce çevirir, ve (b) 5xx backoff'suz anında retry edilir, zorlanan sağlayıcıyı dövebilir. Retry-After yalnız saniye olarak parse edilir (Number()); HTTP-date Retry-After NaN verir, 500ms'ye fallback eder.

**Etki:** Geçici upstream baskısı smart-tier görevlerde (koçluk, plateau, plan akıl yürütme) kısaca bekleyip amaçlanan modeli retry etmek yerine cevap kalitesini sessizce düşürür. 5xx fırtınaları backoff'suz anında retry'larla büyütülür.

**Kanıt:**
```
const transient = response.status === 429 || response.status >= 500;
if (model !== MODELS.fallback && transient) {
  if (response.status === 429) { const ra = Number(response.headers.get('retry-after')); await new Promise(r => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra*1000 : 500)); }
  return chatCompletion(messages, { ...options, model: MODELS.fallback });
```

**Öneri:** Geçici başarısızlıkta önce AYNI modeli sınırlı backoff'tan sonra bir kez retry et (backoff'u 5xx'e de uygula, ör. exponential 500ms→1s) ve yalnız o retry de başarısız olursa ucuz modele fallback et. İsteğe bağlı HTTP-date Retry-After'ı parse et.

---

### [MEDIUM] AI-MDL-05 — Rate-limit TOCTOU: sayı, kullanıcı mesajı isteğin en sonunda saklanmadan önce okunuyor, eşzamanlı istekler hepsi kapağı geçiyor

**Dosya:** `supabase/functions/shared/rate-limit.ts:142-152`

**Sorun:** checkRateLimit chat_messages'taki mevcut satırları sayar (role='user', created_at>=dayStart) ve mevcut kullanıcı mesajı ai-chat handler'ının SONUNDAki storeMessages'a (index.ts:1649, LLM çağrısı tamamlandıktan sonra) kadar insert edilmez. Atomik increment/reservation yok. Bir kullanıcının paralel ateşlediği N istek, herhangi biri satır saklamadan önce aynı günlük sayıyı okur, hepsi kapağı birlikte geçer. Kontrol read-then-act'tır ve yazma tüm LLM round-trip'i kadar ertelenir, yarış penceresini saniyelere genişletir. Free 50/gün ve record-parse 120/gün kapakları, kararlı bir istemcinin eşzamanlı istek atarak aşabileceği yumuşak tavanlardır.

**Etki:** Per-user günlük/saatlik kapaklar (çekirdek LLM maliyet kontrolü) eşzamanlılık altında aşılabilir, konfigüre limitten daha fazla ücretli LLM çağrısına izin verir. İstemci paralelliğiyle sınırlı ama gerçek bir maliyet-kontrol zayıflığı.

**Kanıt:**
```
const { count: dailyCount } = await supabaseAdmin.from('chat_messages').select('*', { count:'exact', head:true }).eq('user_id', userId).eq('role','user').gte('created_at', dayStart);
const daily = dailyCount ?? 0; ... if (daily >= dailyLimit) { ... }
// mevcut mesaj yalnız sonradan saklanır: index.ts:1649 storeMessages(...) chatCompletion'dan sonra
```

**Öneri:** Slot'u LLM çağrısı öncesi atomik olarak rezerve et — ör. kullanıcı mesajını (veya atomik bir sayaç / row-lock'lu RPC ile profiles.daily_msg_count) kontrolden ÖNCE insert et, veya tek atomik 'check-and-increment' RPC kullan ki eşzamanlı istekler aynı sayaç satırında serileşsin.

---

### [MEDIUM] AI-INT-04 — Backdate'li weight_log/profile_update MEVCUT profiles.weight_kg'yi eziyor ve TDEE'yi backdate'li kilodan yeniden-hesaplıyor

**Dosya:** `supabase/functions/ai-chat/index.ts:2682-2685, 3002-3014, 3118-3140`

**Sorun:** executeActions actionDate'i model-sağlanan days_ago'dan HER action tipi için türetir (2682-2685, clamp 1..7). Sistem promptu (system-prompt.ts:148) ve sunucu-tarafı regex backdater (index.ts:1510 BACKDATABLE seti) weight_log'u backdate'ten KASITLI dışlar, ama executeActions'ta böyle bir guard yok: days_ago set'li bir weight_log/profile_update daily_metrics/weight_history'yi geçmiş tarihe yazar (doğru) ama AYRICA koşulsuz `profiles.update({ weight_kg: w })` (3009/3119) yapar ve recalculateTDEEIfNeeded(userId, w) (3014/3138) çağırır — bu backdate'li kiloyu mevcut kilo olarak alıp BMR/TDEE ve tüm kalori aralıklarını yeniden-hesaplar. Yani model 'geçen hafta 95 kiloydum' ifadesine days_ago iliştirirse, kullanıcının mevcut kilosu (90) eski 95 ile ezilir ve kalori hedefleri yanlış kilodan yeniden-hesaplanır.

**Etki:** profiles.weight_kg goals/plan/progress/dashboard'un okuduğu kanonik MEVCUT kilodur. Backdate'li değerle bozmak hedef ilerleme %'sini, ETA'yı ve yeniden-hesaplanan kalori aralıklarını bir sonraki gerçek tartıya dek sessizce bozar. Modelin talimata aykırı days_ago emit etmesine bağlı, ama codebase kiloyu iki başka yerde backdate'ten dışlamasına rağmen kod-seviyesi guard yok.

**Kanıt:**
```
2683-2685: const actionDate = ... rawDaysAgo >= 1 && rawDaysAgo <= 7 ? shiftDateString(today, -Math.round(rawDaysAgo)) : today;  // tüm tiplere uygulanır
3009: await supabaseAdmin.from('profiles').update({ weight_kg: w, ... }).eq('id', userId);  sonra 3014 recalculateTDEEIfNeeded(userId, w)
1510: const BACKDATABLE = new Set(['meal_log','workout_log','water_log','sleep_log','mood_log','supplement_log']);  // weight_log kasıtlı yok
```

**Öneri:** weight_log ve profile_update'in weight dalında profiles.weight_kg'yi yalnız actionDate === today olduğunda güncelle ve recalculateTDEEIfNeeded'ı tetikle; backdate'li kilolar için yalnız daily_metrics/weight_history yaz. Alternatif: executeActions'ta weight_log'tan days_ago'yu strip et (index.ts:1510 BACKDATABLE whitelist'ini yansıt).

---

### [LOW] AI-GRD-02 — Taban-altı kalori ED tespiti "yiyorum"u kaçırıyor — "sadece 600 kalori yiyorum" işaretlenmiyor

**Dosya:** `supabase/functions/shared/guardrails.ts:441` (EATING_CTX, kullanım 443-453 detectEDRisk)

**Sorun:** Deterministik tehlikeli-düşük-kalori dalı, 1100 altı kcal sayısı VE EATING_CTX = /(ye|yi?yec|yemek|alaca|alıyor|aliyor|gün(de)?|gun(de)?|diyet|beslen|tüket|tuket)/ eşleşmesi gerektirir. 'yemek' fiilinin şimdiki-zaman birinci-tekili "yiyorum"dur. 'ye' içermez ve `yi?yec` yalnız 'yiyecek' kökünü eşler, 'yiyor...'u değil. Çıplak "sadece 600 kalori yiyorum" ifadesinde diğer alternatiflerin (alıyor/diyet/tüket/gün) hiçbiri yoktur. Yani 'yemek' fiilinin en yaygın çekimiyle açıkça tehlikeli alımı bildiren kullanıcı tespit edilmez. ("günde 600 kalori yiyorum" yalnız tesadüfi 'gün' token'ı sayesinde geçer.)

**Etki:** Spec-gerekli (12.5/5.6) deterministik profesyonel-destek yönlendirmesi eklenmez ve yanıt tamamen LLM'e bırakılır (geçmiş auditler atladığını buldu). ~600 kcal/gün alım bildiren risk-altı ED kullanıcısı güvenlik çerçevesi olmadan normal koçluk alabilir. (HIGH→LOW: bu ED-tier orta-şiddet bir dal, akut-kriz kaçırması değil.)

**Kanıt:**
```
Line 441: const EATING_CTX = /(ye|yi?yec|yemek|alaca|alıyor|aliyor|gün(de)?|gun(de)?|diyet|beslen|tüket|tuket)/;
MISS [low cal yiyorum] "sadece 600 kalori yiyorum" -> false
OK   [low cal yemek]   "günde 500 kalori yemek istiyorum" -> true
```

**Öneri:** EATING_CTX'i 'yiyor' kökü ve diğer yaygın yeme çekimlerini kapsayacak şekilde genişlet, ör. alternasyona `yiyor|yedim|yiyom|yicem|yicek|öğün|ogun` ekle. Doğrulama: "sadece 600 kalori yiyorum" ve "700 kcal yiyom" ikisi de ateşlesin.

---

### [LOW] AI-GRD-03 — ED kısıtlayıcı-pattern listesi "hiç yemek yemiyorum"u kaçırıyor (araya giren isim literal eşleşmeyi bozuyor)

**Dosya:** `supabase/functions/shared/guardrails.ts:463-471` (mediumPatterns, detectEDRisk)

**Sorun:** Orta-şiddet kısıtlayıcı liste literal substring eşleşmesine dayanır ve 'hic yemiyorum' / 'hiç yemiyorum' içerir ama eşit derecede doğal "hiç yemek yemiyorum"u İÇERMEZ — burada 'yemek' nesnesi 'hiç' ile 'yemiyorum' arasında durur. Eşleşme `lower.includes(pattern)` sabit string'lere karşı olduğundan, araya giren kelime onu bozar ve cümlede kcal sayısı olmadığından kalori dalı (AI-GRD-02 başına 'yemiyorum'u da kaçıracak) ateşlemez.

**Etki:** Yaygın bir ifadeyle tam gıda kısıtlaması bildiren kullanıcı ED profesyonel-destek yönlendirmesi almaz; güvenlik çerçevesi tamamen LLM'e bağlı kalır. Kısıtlayıcı-yeme açıklaması için bozulmuş güvenlik kapsamı.

**Kanıt:**
```
Lines 463-465: const mediumPatterns = ['hic yemiyorum', 'hiç yemiyorum', 'hic bir sey yemiyorum', 'hicbir sey yemiyorum', 'hiçbir şey yemiyorum', ...];
// 'hiç yemek yemiyorum' için orta eşleşme = false
```

**Öneri:** Kırılgan literal varyantları küçük bir regex ile değiştir, ör. /hi[cç]\s*(bir\s*[sş]ey|yemek)?\s*yemiyorum/ ve /hi[cç]bir\s*[sş]ey\s*yemiyorum/, ki 'hiç' ile 'yemiyorum' arasındaki isteğe bağlı nesne ismi yine eşleşsin. Doğrulama: "hiç yemek yemiyorum".

---

### [LOW] AI-GRD-04 — Sakatlık çıkış-taraması Türkçe egzersiz adı "bacak presi"ni (leg press) diz/quad sakatlığı için kaçırıyor

**Dosya:** `supabase/functions/shared/guardrails.ts:663-733` (EXERCISE_BODY_PART_MAP), `816-829` (findInjuryConflictsInText)

**Sorun:** EXERCISE_BODY_PART_MAP İngilizce 'leg press' → ['knee','quad'] (670) eşler ve birkaç Türkçe ad eklendi (çömelme, koşu, şınav, mekik vb.), ama leg press'in yaygın Türkçe terimi "bacak presi"ni atlar. findInjuryConflictsInText (816-829) yalnız map'te key olarak var olan substring'leri işaretler; koç diz sakatlığı olan kullanıcıya "bacak presi yap" yazdığında çakışma tespit edilmez ve ⚠️ sakatlık notu eklenmez. Koçluk modeli Türkçe emit ettiğinden, diz/quad-yükleyen makine hareketi için gerçekçi bir kaçırma.

**Etki:** Kayıtlı diz/quad sakatlığı olan kullanıcı, Türkçe ifade edilmiş bir leg-press önerisini sakatlık uyarısı olmadan alabilir. Uç durum (tek spesifik Türkçe terim) ve yaygın terimler (çömelme/skuat/koşu) kapsandığından etki sınırlı, ama sakatlık-yükleyen hareket için gerçek bir kod-zorlamalı-filtre boşluğu.

**Kanıt:**
```
// 'leg press' -> true ama 'bacak pres' -> false
findInjuryConflictsInText('Bacak presi yap', ['knee']) -> [] (çakışma yok)
findInjuryConflictsInText('çömelme yap', ['knee']) -> ['çömelme']
```

**Öneri:** Türkçe makine/compound adlarını EXERCISE_BODY_PART_MAP'e ekle: 'bacak presi'/'bacak pres' → ['knee','quad'], 'bacak ekstansiyon' → ['knee','quad'], uygun şekilde 'bacak curl'/'arka bacak'. Doğrulama: findInjuryConflictsInText('bacak presi yap', ['knee']) → ['bacak presi'].

---

### [LOW] AI-SYS-05 — Foto-analiz bölümü yanlış auto-onay confidence eşiğini belgeliyor (0.6 vs kod 0.7)

**Dosya:** `supabase/functions/ai-chat/system-prompt.ts:184` vs `index.ts:1545`

**Sorun:** FOTO ANALIZI bölümü modele 'Dusuk confidence (0.6 alti) varsa kod tarafi otomatik "Dogru anladiysam..." onayi istiyor' der. Gerçek kod eşiği 0.7'dir: index.ts:1545 `const lowConf = items.filter(i => (i.confidence ?? 0.8) < 0.7);`. Aynı promptun PROAKTIF DOGRULAMA bölümü (339-341) '<0.7' der. Yani foto bölümü hem koda hem promptun kendi diğer bölümüne aykırı bir kesim aktarır.

**Etki:** Minör. Kapı kod-sürümlü olduğundan davranış doğru, ama prompt sözleşmeyi modele yanlış belirtir; model sınırda (0.6-0.7) bir foto tahminini ne kadar temkinli ifade edeceğine karar verirken yanlış eşik üzerinden akıl yürütebilir.

**Kanıt:**
```
system-prompt.ts:184: "Dusuk confidence (0.6 alti) varsa kod tarafi otomatik ... onayi istiyor"
index.ts:1545: "const lowConf = items.filter(i => (i.confidence ?? 0.8) < 0.7);"
```

**Öneri:** system-prompt.ts:184'te '0.6 alti'yi '0.7 alti' yap; index.ts:1545 ve PROAKTIF DOGRULAMA bölümüyle eşleşsin.

---

### [LOW] AI-SYS-06 — Chat-onarım 'son kaydı sil' promptu modelin yapamadığı silmeyi talimat ediyor; belgelenmemiş bir action'a güveniyor

**Dosya:** `supabase/functions/ai-chat/system-prompt.ts:330-336` (SOHBET ONARIM)

**Sorun:** SOHBET ONARIM bölümü modele '1. Onceki parse'i HEMEN geri al (is_deleted=true)' ve '"Son kaydi sil" → en son eklenen kaydi geri al, "X kaydini sildim" de' (332,336) der. Modelin belgelenmiş action sözleşmesinde (87-145) bir satırı soft-delete edecek action yoktur. index.ts:3438-3466'da bir `undo_last` handler'ı VARDIR (undo_type meal/workout/supplement) ama hiçbir promptta belgelenmemiştir, model emit edemez. Pratikte silme yalnız detectRepairIntent/handleUndo'nun belirli ifadeleri ('son kaydı sil', 'geri al') LLM'den ÖNCE deterministik yakalaması sayesinde çalışır. Kullanıcı bir undo'yu farklı ifade eder ve LLM'e ulaşırsa, prompt modeli 'X kaydını sildim' diye sözlü iddiaya yönlendirir oysa hiçbir şey silinmez — promptun başka yerde yasakladığı sahte-onay pattern'i.

**Etki:** UNDO_PHRASES listesi dışındaki undo ifadeleri için model bir kaydın silindiğini iddia etmeye talimat edilir oysa silme olmaz (silecek aracı yok), yanıltıcı 'sildim' onayı riski. Ölü `undo_last` action'ı da amaçlanmış-ama-bağlanmamış işlevsellik sinyali.

**Kanıt:**
```
system-prompt.ts:336: "\"Son kaydi sil\" → en son eklenen kaydi geri al, \"X kaydini sildim\" de"
system-prompt.ts:332: "1. Onceki parse'i HEMEN geri al (is_deleted=true)"
index.ts:3438 case 'undo_last': — undo_last hiçbir promptta yok, yalnız handler
```

**Öneri:** Ya `undo_last` action'ını promptun action sözleşmesinde ifşa et (model gerçekten silme isteyebilsin), ya da SOHBET ONARIM metnini modeli silmeyi iddia etmeye TALIMAT ETMEYECEK şekilde değiştir — silmenin özel undo akışıyla yapıldığını netleştir ve model 'sildim' demek yerine ona devretsin.

---

### [LOW] AI-MEM-05 — Ölü ai_summary kolonları: repair_frequency, last_tdee_weight, last_tdee_date hiç okunmuyor/yazılmıyor

**Dosya:** `supabase/migrations/003_ai_memory_and_chat.sql:91, 112-113`

**Sorun:** ai_summary repair_frequency (DEFAULT 'low'), last_tdee_weight (DECIMAL) ve last_tdee_date (DATE)'i migration 003'te tanımlar. supabase/ ağacı genelinde grep bu üç kolonun YALNIZ migration 003'te göründüğünü gösterir — hiçbir edge fonksiyon select/update/merge etmez (mig 045 ai_summary_merge whitelist'inde de yok, inbound patch anahtarı sessizce düşürülür). Amaçlanmış-ama-inşa-edilmemiş öğrenmeyi (repair frequency takibi, son TDEE yeniden-hesaplama snapshot'ı) temsil ederler.

**Etki:** Runtime kırılması yok, ama ölü şema bakımcıları repair-frequency ve last-TDEE belleğinin var olduğunu sanmaya iter; bu anahtarları updateLayer2 ile emit eden gelecek bir writer merge whitelist'inde olmadığından sessizce no-op olur.

**Kanıt:**
```
grep repair_frequency|last_tdee_weight|last_tdee_date supabase/ -> yalnız 003:91 repair_frequency TEXT DEFAULT 'low', :112 last_tdee_weight DECIMAL(5,2), :113 last_tdee_date DATE
// supabase/functions'ta hiç yok, mig 045 ai_summary_merge whitelist'inde yok
```

**Öneri:** Ya writer'ları uygula (ve anahtarları ai_summary_merge whitelist'ine ekle) ya da Layer-2 şemasını dürüst tutmak için üç kullanılmayan kolonu kaldır.

---

### [LOW] AI-CTX-04 — Kafein-uyku korelasyonu 15:00 kesimi için Europe/Istanbul'u hardcode ediyor, kullanıcının gerçek timezone'unu yoksayıyor

**Dosya:** `supabase/functions/shared/service-contexts.ts:591-605`

**Sorun:** getCaffeineSleepContext her öğünün logged_at'ını (UTC) hardcode `timeZone: 'Europe/Istanbul'` ile yerel saate çevirir, sonra 'after 15:00' geç-kafein kuralını uygular. home/active timezone'u Istanbul olmayan kullanıcı için (gezgin veya non-Türk), 15:00 kesimi yanlış duvar-saatinde değerlendirilir, öğleden-sonra-kahve günleri yanlış kovalanır ve geç-kafein/uyku içgörüsü yanlış ateşler/ateşlemez. Fonksiyon profiles'tan tz çözebilir (home_timezone/active_timezone) ama çözmez. Etki yumuşak, opsiyonel bir koçluk içgörüsüyle sınırlı (güvenlik/veri değil), bu yüzden LOW.

**Etki:** Istanbul timezone'u dışındaki kullanıcı, öğleden-sonra-kafein günleri yanlış yerel 15:00 kesimine kovalandığından sahte veya eksik kafein-uyku korelasyon içgörüsü alabilir. Minör, yalnız opsiyonel-içgörü bozulması.

**Kanıt:**
```
595: hour = new Date(new Date(meal.logged_at).toLocaleString('en-US', { timeZone: 'Europe/Istanbul' })).getHours();
599: if (hour >= 15) { ... lateCaffeineDates.add(meal.logged_for_date); }
```

**Öneri:** Kullanıcının timezone'unu (active_timezone → home_timezone → Europe/Istanbul fallback) profiles'tan çöz ve toLocaleString çağrısında literal 'Europe/Istanbul' yerine kullan.

---

### [LOW] AI-PLN-05 — Projeksiyon weekly_budget_total caloriePoint*7 kullanıyor; ai-plan/widget kanonik 4×train-mid + 3×rest-mid kullanıyor — weekly_calorie_budget null ise sapıyor

**Dosya:** `supabase/functions/shared/plan-projection.ts:315-317`; `ai-plan/index.ts:696-704`; `src/services/widget.service.ts:150-159`; `src/lib/tdee.ts:134-136`

**Sorun:** ai-plan (696-704), widget.service.ts:159 ve tdee.ts:134-136 haftalık bütçeyi kanonik olarak 4×training-mid + 3×rest-mid tanımlar (profiles.weekly_calorie_budget set değilken). Canlı projeksiyon (plan-projection.ts:315-317) bunun yerine caloriePoint*7'ye fallback eder. ai-plan yorumu (696-698) planMid*7'yi BIRAKTIĞINI açıkça söyler ÇÜNKÜ dashboard ve home widget farklı bütçeler gösteriyordu — ama daily_plans'ı gerçekten dolduran projeksiyon hâlâ caloriePoint*7 kullanır. Onboarded kullanıcılar için zararsız (onboarding weekly_calorie_budget = kanonik yazar), yani yalnız weekly_calorie_budget null olan kullanıcıyı etkiler.

**Etki:** Set-edilmemiş-bütçeli kullanıcı, daily_plans-türevli haftalık bütçeyi (dashboard) caloriePoint*7 görürken home widget 4×train-mid+3×rest-mid gösterir — ai-plan yorumunun kapattığını iddia ettiği tam tutarsızlık. Bütçe normalde onboarding'de dolduğundan düşük etki.

**Kanıt:**
```
plan-projection.ts:315-317: const weeklyTotal = profile.weekly_calorie_budget != null && Number.isFinite(...) ? ri(profile.weekly_calorie_budget, caloriePoint*7) : caloriePoint*7;
ai-plan/index.ts:703-704: const canonicalFallback = (trainMid>0 && restMid>0) ? (4*trainMid + 3*restMid) : 0; const weeklyBudgetTotal = profile?.weekly_calorie_budget ?? canonicalFallback;
widget.service.ts:159: const weeklyBudget = profile?.weekly_calorie_budget ?? (4*trainingMid + 3*restMid);
```

**Öneri:** training/rest kalori mid'lerini (veya kanonik 4×train+3×rest değerini) projectDailyPlanRows'a geçir ve caloriePoint*7 yerine ai-plan/widget ile aynı kanonik fallback'i kullan, böylece weekly_calorie_budget null olsa bile tüm reader'lar uyuşur.

---

### [LOW] AI-MDL-06 — daily_log effectiveMode'unda analyzeMessage case'i yok → general_coaching'e düşüyor → her onboarding-sonrası log için SMART modeli zorluyor (latent maliyet-tier bypass'ı)

**Dosya:** `supabase/functions/shared/retrieval-planner.ts:92-121`

**Sorun:** analyzeMessage'in switch'i register/plan/coaching/analyst/qa/mvd/plateau/simulation/recovery/recipe/eating_out/onboarding/periodic'i kapsar ama üç HINT_MODES daily_log / plan_diet / plan_workout için case YOK. daily_log için (Phase-5 onboarding-sonrası konuşmasal-loglama modu) default dalına çarpar, subtype:'general_coaching' döner. selectModel'de bu subtype SMART_SUBTYPES'ta olduğundan, daily_log basit bir 'su içtim' su logu için bile smart modele (gpt-4o) yönlenir — o mod için iki-tier fast/smart maliyet optimizasyonunu boşa çıkarır. effectiveMode='daily_log'da istemci hint detectTaskMode'a kazanır, register→fast yönlendirme uygulanmaz. Şu an LOW çünkü canlı istemci task_mode_hint='daily_log' göndermez; ama getRetrievalPlan'da zaten daily_log dalı (355) var ve task-modes.ts modu tanımlar, daily_log istemci-tarafı bağlandığı an her günlük log sessizce pahalı modelde çalışır.

**Etki:** daily_log istemcide etkinleştirilirse, en yaygın onboarding-sonrası akış (günlük öğün/su/uyku loglama) gpt-4o-mini yerine tamamen gpt-4o'da çalışır, basit parse'lar için kalite faydası olmadan per-mesaj maliyeti çarpar.

**Kanıt:**
```
switch (taskMode) {
  case 'register': return analyzeRegister(lower);
  ...
  default: return { taskMode, subtype: 'general_coaching', riskLevel: 'low', ... };
}  // case 'daily_log'/'plan_diet'/'plan_workout' yok -> default -> general_coaching -> SMART_SUBTYPES -> gpt-4o
```

**Öneri:** analyzeMessage'a daily_log için açık case ekle (analyzeRegister-stili mantığa devret ki loglar fast-tier subtype alsın) ve plan_diet/plan_workout için (smart). Bilinen modlar için default dalına güvenme. (Not: plan_diet/plan_workout zaten model-router.ts:113-121'de smart'a force-route ediliyor, o ikisi için bu eksik case zararsız; yalnız daily_log maliyet-tier endişesi canlı-ilgili.)

---

### [LOW] AI-MDL-07 — Rate-limit yerel-gün sınırı 0'a default ediyor oysa app'in geri kalanı 4 kullanıyor — day_boundary_hour NULL iken kapak penceresi kayıyor

**Dosya:** `supabase/functions/shared/rate-limit.ts:42, 9-13`

**Sorun:** localDayStartIso, profiles.day_boundary_hour null olduğunda sınırı 0'a default eder (`const boundary = typeof dayBoundaryHour === 'number' ? dayBoundaryHour : 0;`), ama dosyanın kendi header yorumu 'day_boundary_hour (default 4)' iddiasındadır ve app'in geri kalan gün mantığı (src/lib/day-boundary.ts getEffectiveDate, meal-log gün atama) 4'e default eder. day_boundary_hour'u açıkça NULL olan kullanıcı, meal-log 'günü' hesaplanışıyla tutarsız olarak 04:00 yerine 00:00'da resetlenen bir günlük-kapak penceresi alır. Pratikte DB kolonu 4'e default eder (mig 001), yani yalnız açık NULL'lu profilleri etkiler, bu yüzden LOW; ama sapan default latent bir doğruluk hatası ve yorum yanıltıcı.

**Etki:** day_boundary_hour NULL olan herhangi bir profil için mesaj-kapak gün sınırı (gece yarısı), kullanıcının meal-log gün sınırıyla (04:00) eşleşmez, kapak kullanıcının algıladığı günden 4 saate kadar kayık reset/tetikleyebilir.

**Kanıt:**
```
function localDayStartIso(tz, dayBoundaryHour): string {
  const boundary = typeof dayBoundaryHour === 'number' ? dayBoundaryHour : 0;  // header yorumu 'default 4' der
```

**Öneri:** day_boundary_hour null iken sınırı 4'e default et (day-boundary.ts ile eşleşerek) veya aynı default sabitini her iki yerden çek; header yorumunu koda uydur.

---

### [LOW] AI-PRO-06 — Deprecated migration 014, taze DB reset'te 056'nın saatlik job'unu çiftleyen bayat UTC-pencere proaktif cron job'larını bırakıyor

**Dosya:** `supabase/migrations/014_cron_jobs.sql:40-84` vs `supabase/migrations/056_cron_secret_header.sql:33-43, 79-94`

**Sorun:** Migration 014 ÜÇ ai-proactive job'u zamanlar (kochko-proactive-morning/afternoon/evening, 05:00/10:00/17:00 UTC) x-cron-secret header'sız. Migration 056 proaktif cron'u tek saatlik kochko-proactive-hourly ('7 * * * *') ile header'lı değiştirir, ama 056 yalnız 'kochko-proactive-hourly' jobname'ini unschedule eder (036) — üç 014 jobname'ini (morning/afternoon/evening) asla unschedule etmez. Temiz DB rebuild'inde (014 sonra 056) üç eski 014 job'u yeni saatlik job'la birlikte hayatta kalır. 056 header yorumu drift'i kabul eder ('057 işidir') ama bu branch'te 057 reconciliation yok (057 farklı bir migration). Sonuç: proaktif fonksiyon HEM 3 legacy sabit-saat job'undan (x-cron-secret header'sız) HEM yeni saatlik job'tan ateşler.

**Etki:** Migration replay'iyle yaratılan herhangi bir ortamda (CI, yeni staging, DR reset), ai-proactive legacy job'lardan ekstra çalışır ve bu legacy çağrıları x-cron-secret göndermez — CRON_SECRET konfigüreyse 401 (zararsız), set değilse fail-open çalışır, çalışma frekansını ve LLM/push maliyetini amaçlanan saatlik kadansın ötesine çıkarır. Prod hand-patch'lendiğinden yalnız rebuild edilen ortamları etkiler — LOW, ama gerçek reproducibility/correctness boşluğu.

**Kanıt:**
```
// 056:33-38 — yalnız bunlar unschedule edilir:
FOREACH jn IN ARRAY ARRAY['kochko-tier2-extraction','kochko-tier3-extraction','kochko-proactive-hourly','kochko-photo-cleanup'] LOOP ...
// 014:41 — hiç kaldırılmayan morning/afternoon/evening:
SELECT cron.schedule('kochko-proactive-morning', '0 5 * * *', ...); ... -afternoon ... -evening ...
```

**Öneri:** 056'daki FOREACH dizisine 'kochko-proactive-morning/afternoon/evening' (ve 'kochko-proactive-hourly') için unschedule ekle (veya referans verilen 057 reconciliation migration'ını gönder) ki taze migrate tam olarak tek proaktif job versin.

---

---

## Sonuç & Öncelikli Aksiyon Planı

Bu denetim, KOCHKO'nun çekirdek mimarisinin sağlam olduğunu ancak lansman öncesi kapatılması gereken bir avuç güvenlik/güvenilirlik açığı taşıdığını gösteriyor. Bulgular üç sistemik kök nedende yoğunlaşıyor: (1) **yetkilendirme & RLS sertleştirme boşlukları** (SECURITY DEFINER RPC'lerinin PUBLIC grant'leri, fail-open cron auth), (2) **zaman dilimi / UTC tutarsızlığı** (context, öğrenilen saatler, raporlar) ve (3) **doğrulama & atomiklik eksikleri** (NaN/overflow korumasız makro yazımları, idempotency yokluğu, SMALLINT taşmaları). Aşağıdaki sıra, etki × istismar-kolaylığı × kullanıcı-yüzeyi temelinde önceliklendirilmiştir.

### P0 — Lansman engelleyici (derhal, gönderimden önce)

Bunlar güvenlik ihlali, veri kaybı veya can güvenliği riski taşır; başka her şeyin önüne geçer.

- **`DB-FUN-01`** — Üç atomik plan/hedef RPC'sine `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + çağıran-kimliği doğrulaması ekleyin. (Kimliksiz çapraz-kullanıcı veri imhası.)
- **`DB-FUN-02`** — `start_trial_if_eligible`'a `REVOKE ... FROM PUBLIC, anon` + NULL-sağlam sahiplik guard'ı ekleyin.
- **`AI-GRD-01`** — Kriz regex'ine mastar/ulaç ekleri + geniş ideation pattern'i ekleyin. (Kaçırılan akut intihar sinyali.)
- **`AI-EXT-01`** — Payload kapağını alan-limitleriyle hizalayın. (Premium foto/ses kaydı kırık.)
- **`AI-PRO-04` / `cron-auth`** — Fleet cron endpoint'lerini fail-closed yapın; CRON_SECRET'ı zorunlu deploy gereksinimi haline getirin.
- **`AI-ORC-01/EXT-04/INT-03`** — Makro sanitizasyonu + `validateMealParse` çağrısı + başarı çipini `!itemsErr`'e bağlama. (Sessiz veri kaybı + sahte başarı.)
- **`AI-ORC-02` / `AI-ORC-03`** — Workout onay yolunda sakatlık yeniden-taraması; meal_log alerjen kontrolünü `checkAllergens`'e taşıma. (Güvenlik yanlış-negatifleri.)

### P1 — Yüksek öncelik (lansman sonrası ilk sprint)

Kullanıcı-yüzlü güvenilirlik, para-kazanma bütünlüğü ve veri doğruluğu.

- **Atomiklik:** `DB-TRG-01` + `AI-INT-02` (tek-aktif-hedef invariantı — atomik RPC), `AI-INT-01` (action idempotency anahtarı), `DB-PRM-01` (plan-onay free-cap atomik increment).
- **Timezone/UTC:** `AI-CTX-02`, `AI-MEM-02/INT-05`, `AI-CTX-01` (Layer-3 efektif gün), `AI-PRO-05` (rapor cron efektif gün).
- **Taşma/projeksiyon:** `AI-PLN-01` + `AI-PRO-01` (SMALLINT clamp / INTEGER genişletme — daily_plans bütçe + daily_reports makroları), `DB-PHC-01` (plan.service subtype-farkındalığı).
- **AI dayanıklılık:** `AI-EXT-02` (extractor null-guard — cron batch çökmesi), `AI-MDL-04` (ai-plan rate-limit/free-tier kapısı), `AI-MEM-01` (Layer-2 token bütçesi), `AI-SYS-01` (recovery_plan ölü kod).
- **UX/KVKK:** `UX-ONB-01` (sosyal kayıt onayı), `UX-NAV-01` (re-onboarding navigasyon tuzağı), `UX-FBK-01` (onaysız hard-delete), `UX-FBK-02` (bildirim izin UX'i), `DB-CON-01` (priority enum doğrulama + insert-hata kontrolü).
- **UI klavye:** `UI-CHT-01`, `UI-LAY-01` (chat composer + hızlı kayıt KeyboardAvoidingView — fiziksel Android'de doğrulayın).

### P2 — Orta/düşük (planlı temizlik)

Cila, tutarlılık, erişilebilirlik, performans erişim-yolu ve şema hijyeni.

- **Erişilebilirlik:** `UX-A11-01/02/03`, `UI-PR-01/02`, `UX-A11-04` (grafik/toggle/form a11y etiketleri).
- **WCAG kontrast:** `UI-DS-01/02`, `UI-STA-06` (beyaz-üstüne-teal AA hataları — paylaşılan `getContrastColor` kalıbına geçiş).
- **Tasarım sistemi:** `UI-DS-03/04/05/06/07/08`, `UI-SET-01/02` (token tutarlılığı, toggle primitifi birleştirme, çoğaltılmış başlıklar).
- **Loading/boş/hata durumları:** `UI-STA-01/02/03/04/05` (skeleton + error-state disiplini).
- **Offline/sync:** `UX-OFF-01..07` (offline kuyruk ya bağlanmalı ya ölü kod + yanıltıcı banner kaldırılmalı).
- **Form doğrulama:** `UX-FRM-01/02/03` (Türkçe virgül normalizasyonu), `UX-ONB-02/03` (hedef-yön + aralık doğrulaması).
- **DB performans/şema:** `DB-IDX-01..05` (FK-cascade kapsayıcı indeksler, gereksiz indeks düşürme), `DB-MIG-01..04` (cron drift + idempotency guard'ları), `DB-PRV-01..05` (KVKK export eksikleri, audit-log sahtelenebilirliği, sağlık verisi şifreleme kararı).
- **AI cila:** `AI-SYS-02..06`, `AI-MDL-01/02/03/05/06/07`, `AI-GRD-02/03/04`, `AI-MEM-03/05`, `AI-PLN-02/03/04/05`, `AI-CTX-03/04`, `AI-EXT-03/05`, `AI-PRO-02/03/06`, `AI-INT-04` (prompt-kod tutarlılığı, model-router maliyet tier'ları, ölü kod, fleet pencereleme >960 kullanıcı).

### Genel öneri

P0 kalemleri tek bir güvenlik-sertleştirme migration + edge-deploy turunda toplanabilir (çoğu birkaç satırlık REVOKE/guard/clamp). Timezone ailesi (P1) tek bir paylaşılan "efektif gün/saat" yardımcısıyla toptan çözülmeli — şu an aynı düzeltme kod tabanında parça parça uygulanmış (`service-contexts.ts` düzeltilmiş, `memory.ts`/`context-builders.ts` değil). SMALLINT taşmaları için kalori toplamları meşru olarak 32767'yi aşabildiğinden INTEGER'a genişletme, clamp'ten daha sağlam bir kalıcı çözümdür.
