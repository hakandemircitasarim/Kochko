# Bitmemişlik envanteri — 2026-07-31

9 boyutlu bir "bitmemişlik denetimi" (bug avı değil: **vaat edilip teslim edilmemiş** olan
şeylerin avı) 125 bulgu çıkardı. Bu dosya, bu oturumda **kapatılanları** ve **kalanı**
kanıtla listeler. Amaç tek bir ölçüt: *hiçbir yüzey kullanıcıya yalan söylemesin, hiçbir
vaat ölü olmasın.*

---

## Bu oturumda KAPATILANLAR

### Yarım kalmış özellikler → tamamlandı

| # | Ne | Neydi | Ne oldu |
|---|---|---|---|
| 1 | **Açık / Sistem teması** | `LIGHT_COLORS` ve sağlayıcı en baştan yazılmıştı, ama 47 dosya statik `COLORS` (=`DARK_COLORS`) import ettiği için açık tema seçilse kabuk aydınlanır, ekranlar koyu kalırdı. Ayarlarda 3 seçeneğin 2'si kalıcı "Yakında". | 47 dosya `useTheme()`'e taşındı (uygulama genelinde **0** statik `COLORS` kaldı), import anında koyu paleti donduran **10 modül-seviyesi sabit** token-tablosu/fabrikaya çevrildi, kilit açıldı. |
| 2 | **Adım kaydı** | Ana ekrandaki Adım hücresi Android'de dokunulunca yalnızca "Yakında" uyarısı açıyordu — griddeki tek çıkmaz sokak (Su/Uyku/Kilo hepsi çalışıyor). Otomatik sayım Android'de imkânsız: `expo-sensors`'ın gün-toplamı okuması (`getStepCountAsync`) **iOS'a özel**. | Uçtan uca elle adım kaydı: `/log?to=steps` ekranı (doğrulama + hızlı çipler), `daily_metrics.steps` + `steps_source='manual'` yazımı, kayıt ekranında "Adım" kutucuğu, pano hücresi artık komşularıyla aynı davranıyor. |
| 3 | **"Yanlış anladın" düzeltmesi** | *Denetimin BLOCKER'ı.* `buildCorrectionContext` modele "eski yanlış kaydı otomatik sil" diyordu; system-prompt modele hiçbir şey silemeyeceğini söylüyordu; kod tarafında da correction dalı **tek bir yazımı bile** geri almıyordu. Koç "düzeltiyorum" diyor, yanlış öğün panoda duruyordu. | `revertLastTurnWrite()`: son asistan mesajını çıpa alıp o turun yazdığı kaydı bulur ve gerçekten geri alır (öğün soft-delete). Bulamazsa **hiçbir şey silmez** ve modele "sildim deme" der. Düzeltmeler artık `repair_history`'ye de düşüyor. |
| 4 | **Geri alma geri bildirimi** | Sunucunun undo dalı `actions: []` döndürüyordu; istemci başarıyı `actions.some(a => a.feedback)` ile ölçtüğü için **başarılı** bir geri alma bile HER ZAMAN "Geri alınamadı" uyarısı gösteriyor ve panoyu tazelemiyordu. | Sonuç zarfta tipli taşınıyor (`receipts[action_type='undo']`), istemci onu okuyor; "kayıt yok" durumunda ikinci bir uyarı yığmıyor. |
| 5 | **Antrenman hatırlatması** | Ayarlarda açılabilen bir anahtar ve "antrenman günlerinde hatırlatır" vaadi vardı, ama `workoutDays` sabit `null` bırakılmıştı → bildirim **bir kez bile** planlanmadı. | `daily_plans.plan_type='training'` üzerinden önümüzdeki 14 gün okunup hafta günleri türetiliyor (hem ayar kaydında hem açılışta). Plan yoksa kurulmuyor, uydurma gün üretilmiyor. |
| 6 | **Sohbetteki plan kartı** | "Detayı görmek için dokun" yazıyordu, `onPress={() => {}}` idi. `FullPlanModal` yazılmış ama bağlanmamıştı. | Dokunuş planın tamamını açıyor. |
| 7 | **Hata telemetrisi** | `reportError` son 50 hatayı RAM'de tutuyordu, `trackEvent` olayları tamponluyordu — **ikisinin de gönderen tarafı yoktu**. Uygulama kapanınca hepsi kayboluyordu. `@sentry/react-native` kurulu değil. | `client_events` tablosu (migration 103) + `telemetry.service`: arka plana geçişte, açılışta ve ErrorBoundary çökme yakaladığında gönderiyor. **Tablo yoksa sessizce yerelde kalır** — uygulama migration'sız da güvenle çalışır. Yerel tampon artık Debug ekranında görünüyor. |

### Kullanıcıya yalan söyleyen yüzeyler → gerçeğe çekildi

| # | Ne | Düzeltme |
|---|---|---|
| 8 | Sohbet arşivi **ters sırada** okunuyordu (koçun cevabı sorudan önce) — `.reverse()` eklenmiş, eşi olan `inverted` prop'u hiç gelmemişti. | `.reverse()` kaldırıldı. |
| 9 | "Aboneliği İptal Et" hiçbir şey yapmadan **"İptal Edildi"** diyordu. | Abonelikler mağazada yönetilir: doğruyu söylüyor ve Play/App Store abonelik sayfasına götürüyor. |
| 10 | Hedef ekranı "7 gün içinde kademeli olarak X→Y kcal" diyordu; rampa bu yolda **hiç çalışmıyor** (yalnız faz otomatik-ilerlemesinde çalışır) ve gösterilen sayılar da gerçekte yazılan banttan 100-300 kcal sapan tahminlerdi. | Kart artık olanı söylüyor, uydurma sayı vermiyor. Kullanılmayan `calculatePhaseTransition` çağrısı kaldırıldı. |
| 11 | "AI Şeffaflık" ekranı **uydurma** bir sabit basıyordu ("K4 Bütçesi %35 / 45.500 token") — sunucu yapılandırmasıyla hiçbir bağı yoktu. | Kaldırıldı; yerine istemcinin gerçekten bildiği veri (son hatalar + Sentry durumu). |
| 12 | "Ölçü Birimi: İmperial" kaydediliyor, "Profil güncellendi" onayı veriliyor, ama `units.ts` hiçbir yerden import edilmiyor — **tek bir yüzey** bile değişmiyordu. | Seçici kaldırıldı (uygulama metrik-tek). Kolon ve `units.ts` yerinde; tüm gösterim noktalarına bağlandığında geri gelir. |
| 13 | Premium listesi "Telefon adım sayacı" diyordu — Android'de böyle bir şey yok. | "Adım takibi (iOS otomatik, Android elle giriş)". |
| 14 | `mini_cut_suggestion` herkese sabit **"1.5kg üstündesin"** diyordu; 1.5 yalnızca tetik eşiğiydi, gerçek fark aynı blokta hesaplıydı. | Gerçek son tartı ve gerçek fark yazılıyor. |
| 15 | `progressive_overload` kullanıcıya **ham İngilizce anahtar** gösteriyordu: "bench_press: 2 seanstır…". | Türkçe ad sözlüğü. |
| 16 | "Dışarıda Yemek Planlıyorum" ve "AI'dan Tarif Öner" düğmeleri **boş sohbet** açıyordu. | Sohbet ekranının zaten okuduğu `prefill` ile niyet taşınıyor. |
| 17 | Ayarlardaki sağlık-senkron uyarısı elle girişten hiç bahsetmiyordu. | Elle giriş yolu (Adım/Uyku/Tartı kutucukları) söyleniyor. |

### Lansman kapıları

| # | Ne | Düzeltme |
|---|---|---|
| 18 | **`versionCode` sürüm kontrolünde yoktu** ve prebuild `build.gradle`'a sabit `1` yazıyordu (dosya gitignore'lu). İkinci Play yüklemesi *"Version code 1 has already been used"* ile reddedilirdi ve sebebi görünmezdi. | `app.config.js` → `android.versionCode`, artırma kuralı RELEASE_CHECKLIST'te. |
| 19 | `expo-notifications` ikon/renk **yapılandırmasız** kayıtlıydı → Android durum çubuğunda **beyaz kare**. | Monokrom siluet ikon + marka teali. |
| 20 | `updates.enabled: true` idi ama `expo-updates` **kurulu bile değil** ve URL yok — "OTA hotfix yolumuz var" izlenimi veren ölü yapılandırma. | Dürüstçe `false` + nasıl açılacağı yazılı. |

**Doğrulama:** `npm run ci` yeşil — tsc + arch-guards (61 dosya) + seam-check (0 boşluk) +
6 edge fonksiyon `deno check` + **108 test**. Ayrıca hook-sırası için ayrı bir tarayıcı
yazıldı (tsc bunu görmez, çalışma zamanında çöker): 47 dosyada **0 ihlal**.

---

## KALAN — dürüst backlog

Aşağıdakiler denetimde çıktı ve **kapatılmadı**. Hiçbiri sessizce bırakılmadı.

### A. Kanıttan üretilmeyen nudge metinleri (13 aile)
19 proaktif mesaj ailesinden 13'ü donmuş literal. Kanıt çoğu zaman **aynı blokta hesaplanıp
atılıyor**: `motivation_dip` (7/30 günlük kayıt frekansı), `snack_hour_nudge` (14 günlük
atıştırma sayımı), `alcohol_next_day`, `periodic_end` (dönem özeti), `weight_reminder`
(sorgu bilerek yalnız `date` seçiyor), `mvd_reset`, `reinforcement_milestone`,
`deload_suggestion`, `habit_introduce`. *Etki: koç genel konuşuyor, kullanıcının kendi
verisini görmüyor.* Aile-aile dönüşüm gerekiyor.

### B. Yazılmış ama hiçbir yerden çağrılmayan altyapı
`conflict-resolver.service` (Spec 5.11 çelişki motoru, 238 satır), `strength.service`'in 9
analiz fonksiyonu, `notification-intelligence`'ın önceliklendirme katmanı,
`auto-backup`'ın açılabileceği arayüz, `meal-prep.service`'in ürettiği alışveriş listesi /
kap önerisi / hazırlık günü, widget veri hattı (okuyan native widget yok),
`repair.service` (sunucudakinin kopyası), `venues.service.getVenues`.
*Bunlar kullanıcıya vaat edilmiş ama bağlanmamış yüzeyler — her biri ayrı bir iş.*

### C. Şemada olup kod tarafından okunmayan/yazılmayan alanlar
`clinical_rules` ve `food_reference` tabloları (tohumlanmış, hiç okunmuyor — üstelik
`food_reference` kodla **drift etmiş**: yulaf 68 vs 389 kcal), `user_safety_state.overtraining_tier`,
`coach_consents` + `get_coach_clients()` RPC, `profiles.theme_mode` (tema yalnız cihazda),
`weight_history.age_at_time`, `maintenance_target_weight_kg`, migration 031'in üç kolonu.

### D. Ürün kararı bekleyenler (bilinçli)
- **IAP/RevenueCat**: lansman ücretsiz (`FREE_LAUNCH`), satın alma stub.
- **Uzak push (FCM)**: sunucu zinciri tam, istemcide `EAS_PROJECT_ID`/FCM yok → `push_token` daima null. Yerel bildirimler çalışıyor.
- **Health Connect / Apple Health**: iskelet; uyku/HRV/kilo boş dönüyor. (Adım artık elle girilebiliyor.)
- **Google/Apple ile giriş**: sağlayıcılar Supabase'te yapılandırılmamış, arayüz dürüstçe "Yakında" diyor.

### E. Diğer doğrulanmış kusurlar
- Toparlanma ekranındaki 1-5 skoru hiçbir yerde okunmuyor.
- Sohbet Geçmişi'ndeki konu-etiketi filtresi hiçbir zaman dolmuyor.
- Meal Prep aktivasyonu tek yönlü kapı; üretilen plan kaydedilmiyor.
- "İlk 3 gün plan hafifletildi" (geri dönüş akışı) vaadi uygulanmıyor.
- Haftalık menüde alerjen içeren öğün **sessizce siliniyor**, yerine bir şey konmuyor.
- `ai-extractor` filonun yalnız ilk 100 profilini işliyor (rotasyon yok).
- Kriz/acil-durum turları güvenlik defterine yazılmıyor.
- `eas.json` profilleri hâlâ şablon değerlerde.
- Play mağaza görselleri (1024×500 öne çıkan görsel, ekran görüntüleri) üretilmedi.

---

## Deploy — ✅ YAPILDI (2026-07-31)

| Adım | Durum | Kanıt |
|---|---|---|
| Migration 103 (`client_events`) | **canlıda** | 10 kolon + `rowsecurity=true` + 2 politika sorguyla doğrulandı; `schema_migrations`'a 103 olarak kaydedildi (`supabase db push` "up to date" der) |
| `ai-chat` deploy | **canlıda** | v194 · düzeltme geri-alma + undo fişi |
| `ai-proactive` deploy | **canlıda** | v71 · mini-cut gerçek fark + TR egzersiz adı |
| Canlı sözleşme testleri | **8/8 geçti** | `npm run contract-tests` |

> `verify_jwt=false` ayarı değiştirilmedi — bu, `supabase/config.toml`'da altı fonksiyonun
> tamamı için önceden tanımlı bilinçli yapılandırma (kimlik doğrulamayı fonksiyonun kendisi yapıyor).

## Ek düzeltme: durum çubuğu (açık tema açılınca ortaya çıktı)

Açık tema emülatörde sürülürken görüldü: aydınlık zeminde saat/pil ikonları **beyaz** kalıyor
ve okunmuyordu. Sebep: targetSdk 36'da (Android 15) edge-to-edge zorunlu ve RN'in
`StatusBarModule`'ü stil değişimini sessizce yok sayıyor (`"Ignored status bar change,
current activity is edge-to-edge"` — logcat'te açıkça yazıyordu). Koyu tema tek seçenekken
kusur görünmezdi. `expo-status-bar` yerine `react-native-edge-to-edge`'in `<SystemBars>`
bileşeni kullanıldı (WindowInsetsControllerCompat'ı sarar). Yeniden derlenip kuruldu:
uygulama temiz açılıyor, o logcat uyarısı **kayboldu**, koyu temada ikonlar doğru.
