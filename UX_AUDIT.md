# KOCHKO — Kapsamlı UX/UI Denetimi (2026-06-20)

> 14 boyutlu çoklu-ajan UX denetimi (99 ajan, ~4.9M token). Her önemli bulgu ikinci bir
> ajanla doğrulandı. Mobil (React Native/Expo) UX heuristiklerine + projenin kendi tasarım
> vizyonuna (düz koyu tema, teal accent, AI-öncelikli sohbet) göre değerlendirildi.
> Kontrast oranları hex token'lardan kesin hesaplandı.

> ## ✅ ÇÖZÜM DURUMU (2026-06-20 — uygulandı)
> Tüm bulgular **2 paralel düzeltme turunda** giderildi (75-dosya + 22-dosya, dosya-bazlı
> çakışmasız partition), her tur **düşmanca regresyon-incelemesiyle** doğrulandı (toplam
> 6 regresyon yakalanıp düzeltildi). Sonuç: **client `tsc` 0 hata**, release APK temiz derlendi,
> yeni `KOCHKO-test.apk` Masaüstünde. Commit'ler: `1750ce0` (385+ fix), `1ca4590` (101 fix + primitive'ler).
> - **Global:** textMuted WCAG-AA token (#8E8EA3), getContrastColor ile buton/baloncuk kontrastı,
>   expo-haptics + haptik lib, marka-dışı palet → token, ASCII-Türkçe → diakritik.
> - **Yeni paylaşılan primitive'ler:** Skeleton (shimmer yükleyiciler), EmptyState, ScreenHeader, DateTimeField.
> - **Logic/UX:** native tarih-saat picker'ları (5 ekran), plan-red inline chip'leri, profile-completion
>   tek-kaynak, typed "SİL" silme onayı, dürüst premium CTA + 7-gün deneme, settings premium-kilit işareti.
> - **Bilinçli ertelendi (defect değil, cila):** token streaming (canlı ai-chat'i yeniden mimari ister),
>   bazı paylaşılan-bileşen DRY-refactor'ları (altta yatan kontrast/boyut/a11y zaten inline düzeltildi).
> _Aşağıdaki rapor orijinal denetim bulgularıdır (tarihsel kayıt)._

## 📊 Genel Skor: **2.9 / 5**

| Boyut | Skor | Tek-cümle |
|-------|:----:|-----------|
| Sohbet (Koç) | **4/5** | Premium hisli, ChatGPT-seviyesine yakın hero yüzey — en güçlü alan |
| Mobil ergonomi | **4/5** | Safe-area disiplini güçlü; birkaç mekanik kusur |
| Tasarım sistemi | 3/5 | Doğru token altyapısı var ama marka-dışı renkler sızıyor |
| Navigasyon/IA | 3/5 | 5-tab omurga temiz; ayarlar derinliği dağınık |
| Onboarding | 3/5 | İskelet sağlam; iki çelişkili ilerleme sistemi |
| Ekran durumları | 3/5 | Boş-durumlar iyi; skeleton yok, birkaç sonsuz-spinner |
| Formlar | 3/5 | Tutarlı Input; tarih/saat picker'sız, klavye örtmesi |
| Geri bildirim/mikro | 3/5 | Sohbet canlı; gerisi statik, haptik motoru yok |
| Tutarlılık/cila | 3/5 | Formlar uyumlu; hero yüzeyler marka-dışı palete kaymış |
| Mikrokopi/Türkçe | 3/5 | Birincil ekranlar iyi; ayarlar ASCII-soyulmuş Türkçe |
| Plan UX | 3/5 | Taslak→onay→revize mimarisi iyi; "düşünüyor" geri bildirimi yok |
| **Raporlar/grafik** | **2/5** | Veri dökümü; sahte grafikler, marka-dışı renkler |
| **Ayarlar/premium** | **2/5** | 30+ satırlık duvar; paywall çıkmaz "geliştirici" alert'i |
| **Erişilebilirlik** | **2/5** | İyi a11y kütüphanesi var ama HİÇ kullanılmıyor (ölü kod) |

**Bulgu dağılımı:** 0 kritik · **24 yüksek** · 44 orta · 49 düşük · 12 nit (1 reddedildi) = **129 doğrulanmış bulgu**.

---

## 🎯 EN YÜKSEK KALDIRAÇ: 4 kesişen tema (tüm ekranları aynı anda iyileştirir)

Bu dört sorun denetimin yarısında tekrar ediyor. Birini düzeltmek onlarca ekranı birden düzeltir.

### 1. 🎨 Marka-dışı renk sızıntısı — "iki ayrı uygulama" hissi (EN BÜYÜK GÖRSEL SORUN)
Çekirdek **diyet/antrenman/rapor** yüzeyleri Tailwind/Material renkleriyle render ediliyor
(yeşil `#22C55E`, indigo `#6366F1`, vb.) — markanın teal `#1D9E75` / mor `#7F77DD`'siyle yarışıyor.
**16 dosya, 73 sızıntı.** Sonuç: diskerli bir kullanıcı uygulamayı "birbirine dikilmiş iki app"
gibi okur — cilalı formlar ama jenerik hisli home/plan çekirdeği.
→ **Fix:** Her marka-dışı hex'i en yakın token'a maple (`#22C55E`→`colors.primary`, `#6366F1`→`colors.purple`/`METRIC_COLORS.workout`, vb.) ve tek süpürmede sil. (orta efor, devasa görsel kazanç)

### 2. 🔍 `textMuted #66667A` kontrast başarısızlığı — uygulama genelinde okunabilirlik
İkincil metnin çoğu bu token'la, çoğu zaman 10-12px boyutunda yazılıyor — **45 dosyada 202 kullanım.**
WCAG'a göre: yüzeyde **3.08:1**, surfaceLight'ta **2.80:1 = AA FAIL** (normal metin 4.5:1 gerektirir).
Zaman damgaları, makro etiketleri, boş-durum alt metinleri, fiyat birimleri hepsi etkileniyor.
→ **Fix:** Tek token değişikliği — `textMuted`'i ~`#8A8AA0`'a (≈4.6:1) çıkar. **Bir satır, uygulama-geneli okunabilirlik.** (trivial efor)

### 3. ♿ Renk üstü beyaz etiket kontrastı — birincil butonlar AA'da başarısız
- **Teal primary buton üstünde beyaz etiket = 3.39:1** (normal metin AA FAIL) — en çok dokunulan kontrol.
- **Amber warning üstünde beyaz = 2.17:1** (soreness seçici, "gün kaldı" rozeti, backdate pill — ciddi başarısızlık).
→ **Fix:** Zaten projede **var olan ama hiç kullanılmayan** `getContrastColor()` helper'ını (`src/lib/accessibility.ts`) `Button.tsx`'e ve rozetlere bağla → dolu butonlarda koyu metin (teal'de 6.20:1 ✓). (trivial efor)

### 4. 🇹🇷 ASCII-soyulmuş Türkçe — Türk-öncelikli üründe kırık görünüm
Birincil ekranlar düzgün aksanlı ama bir bant ikincil ekran (`settings/coach-sharing`, `coach-memory`,
`household`, `health-export`, `weekly-menu`, `recipes`, `strength`, plan ekranları) tamamen ASCII:
"Koc Paylasimi", "Haftalik Menu", "Genel Ozet", "Sifreniz degistirildi", "Dusunuyor...".
**Bonus risk:** `src/lib/i18n.ts`'teki ~140 anahtarlık sözlük tamamen ASCII — bağlanırsa anında kırık ship eder.
→ **Fix:** Etkilenen ekranlarda diakritikleri geri-yükle; en görünür (ayarlardan ulaşılan) ekranları önceliklendir. **Bayrak güven özelliği olan "Koç Hafızası" ekranını öncele.** (orta efor)

---

## ⚡ HIZLI KAZANIMLAR (trivial/küçük efor, yüksek etki) — önce bunlar

| # | Düzeltme | Konum | Efor |
|---|----------|-------|:----:|
| 1 | `textMuted`'i ~`#8A8AA0`'a çıkar (uygulama-geneli kontrast) | `theme.ts:60` | trivial |
| 2 | `Button.tsx`'i `getContrastColor()`'a bağla (beyaz/teal → koyu metin) | `Button.tsx:28-31` | trivial |
| 3 | Amber rozetlerde koyu metin (`log.tsx:452`, `periodic-state.tsx:101`, `[sessionId].tsx:1087`) | 3 satır | trivial |
| 4 | Sohbet composer `keyboardVerticalOffset` 90→0 (header'sız ekran) | `[sessionId].tsx:914` | trivial |
| 5 | Raporlar tab alt-padding'i tab bar'ı temizlesin (son satır gizleniyor) | `progress.tsx:197` | trivial |
| 6 | Onboarding form başlığı çentik altında — `insets.top` ekle | `onboarding.tsx:280` | trivial |
| 7 | Günlük rapor makro renkleri token'a (protein teal değil mavi) | `daily.tsx:97-100` | trivial |
| 8 | Sohbette agresif force-scroll'ı `isNearBottom` guard'la (eski mesaj okunamıyor) | `[sessionId].tsx:990` | küçük |
| 9 | Rapor/coach-memory loader'larına `.catch/.finally` (sonsuz spinner) | 4 dosya | küçük |
| 10 | Plan taslak sohbetinde `TypingIndicator` göster (LLM beklerken ölü sessizlik) | `diet.tsx`,`workout.tsx` | küçük |
| 11 | Paywall'daki çıkmaz "Geliştirici Modu" alert'ini kaldır | `premium.tsx:70-76` | küçük |
| 12 | 7 form ekranına `KeyboardAvoidingView` (klavye input'u örtüyor) | 7 dosya | küçük |

---

## 🏆 Zaten ÇOK İYİ olanlar (korunmalı)

- **Sohbet yüzeyi (4/5):** satır-içi "Neden bu öneri?" reasoning reveal (ChatGPT "show thinking"),
  inline zengin kartlar (makro halkası, tarif, simülasyon), optimistik gönderim + başarısız/retry
  baloncukları, sessiz-aksiyon rozetleri, tarih ayraçları, 3-nokta typing göstergesi. Çoğu fitness app'ini geçiyor.
- **Mobil safe-area disiplini (4/5):** 60 route'un hepsi `useSafeAreaInsets` kullanıyor, tab bar
  home-indicator'a clamp'leniyor, FAB tab-bar butonu olarak doğru native pattern.
- **AI-öncelikli IA:** `/chat/[sessionId]` top-level stack route — sohbette tab bar kayboluyor, koç tam-ekran hero.
- **Onboarding dayanıklılığı:** slide + form alanları AsyncStorage'a persist — uygulama öldürülse bile kaldığın yerden devam.
- **Plan yaşamdöngüsü:** read-gated onay butonu, versiyon rozetleri, drift banner'ları, yan-yana alternatif karşılaştırma — senior-seviye dokunuşlar.
- **Düz-tasarım kuralı kaynakta zorlanıyor:** gradient/gölge gerçekten deprecated, runtime'da render olmuyor.
- **Yıkıcı aksiyon onayları** tutarlı ve doğru.

---

## 📋 Boyut-bazlı özet

### Sohbet/Koç — 4/5 ✅ (en güçlü)
Premium hisli. Eksikler: gerçek token streaming yok (yanıt uzun sessiz beklemeden sonra blok halinde
"pat" diye geliyor), scroll-to-bottom butonu yok, agresif auto-scroll geçmiş okumayı engelliyor,
32px gönder butonu (44px altı), 10-11px düşük-kontrast zaman damgaları, quick-select robotik cümleyi
kullanıcı yazmış gibi echo'luyor, plan-reddi 7-seçenekli native Alert'te gömülü.

### Mobil ergonomi — 4/5 ✅
Safe-area güçlü. Mekanik kusurlar: chat composer offset (90→0), raporlar alt-padding, onboarding çentik.

### Tasarım sistemi — 3/5
Doğru token + scale altyapısı var ama: marka-dışı palet (16 dosya), 215 hardcoded fontSize,
119 hardcoded borderRadius, `coach-memory` tamamen ad-hoc palet.

### Navigasyon/IA — 3/5
5-tab temiz. Sorunlar: 30 ayar ekranı İngilizce ham-dosyaadı native header + kendi Türkçe başlığı
(çift başlık), Profil tab'ı ile /settings çakışan iki ayarlar yüzeyi, Plan'ın top-level girişi yok.

### Onboarding — 3/5
Sağlam iskelet. Sorunlar: iki çelişkili ilerleme sistemi (chat "X/13" vs dashboard "%"), kayıt sonrası
boş forma düşme (değer pekiştirmesi yok), **KVKK/şartlar onayı yok (yasal+güven açığı)**, şifre göster/gizle yok.

### Ekran durumları — 3/5
Boş-durumlar iyi. Sorunlar: hiç skeleton yok (her yer çıplak spinner), rapor/memory sonsuz-spinner
riski (`.catch/.finally` yok), "Rapor Oluştur" sessiz başarısızlık, dashboard ilk-yükte sıfırlı iskelet gösteriyor.

### Formlar — 3/5
Tutarlı Input + iyi submit disiplini. Sorunlar: tarih/saat serbest-metin (picker yok), placeholder
kontrast AA-altı, return-key zincirleme yok, autofill metadata yok, edit-profile 30-alanlı form dökümü
(AI-öncelikli vizyonla çelişiyor), yıkıcı silme keşfedilemez long-press'te.

### Geri bildirim/mikro — 3/5
Sohbet canlı. Sorun: gerçek haptik motoru yok (`expo-haptics` dependency bile değil), su/kilo/uyku
kayıtları sadece görsel onay, log-modal "toast"u animasyonsuz tam-ekran takeover.

### Tutarlılık/cila — 3/5
Form/rapor yarısı uyumlu. Sorun: hero yüzeyler marka-dışı palete kaymış, 5 el-yapımı tab header
(farklı ağırlık/boyut), kart radius bölünmesi (RADIUS.md vs RADIUS.xl).

### Mikrokopi/Türkçe — 3/5
Birincil ekranlar iyi + sıcak ton. Sorun: ayarlar bandı ASCII-soyulmuş, sen/siz ton karışması,
ölü i18n.ts sözlüğü tamamen ASCII (latent ship-breaker).

### Plan UX — 3/5
İyi mimari. Sorun: çok-saniyelik LLM çağrılarında "düşünüyor" geri bildirimi yok, revizyon boş sohbete
yanıltıcı "Plan hazırlanıyor..." ile düşürüyor, marka-dışı renkler, onaylı planda alışveriş listesi yok.

### Raporlar/grafik — 2/5 ⚠️
Veri dökümü, motive edici değil. Sorun: ComplianceScore sahte 4-segment halka (skoru yanlış gösteriyor),
ProgressChart ay görünümünde okunamaz çit, 8-9px etiketler, makro/sapma renkleri marka-dışı + kontrast-altı.

### Ayarlar/premium — 2/5 ⚠️
30+ özdeş outline buton duvarı (chevron yok, arama yok), her kullanıcıya debug girişi, paywall
birincil "Satın Al" butonu çıkmaz "geliştirici modu" alert'ine gidiyor, **22 premium özelliği işaretsiz
dağılmış** (free kullanıcı gated ekrana çıkmaza dokunuyor — premium-gate kütüphanesi var ama hiç bağlı değil).

### Erişilebilirlik — 2/5 ⚠️
İyi a11y kütüphanesi (`src/lib/accessibility.ts`) var ama **%100 ölü kod** — hiçbir dosya import etmiyor.
Sohbet composer örnek (44dp + etiketli) ama gerisi etiketsiz, 44dp-altı, kontrast-altı. İki sistemik
en-zararlı: beyaz/teal buton (3.39:1) + beyaz/amber (2.17:1) AA FAIL; textMuted 11px her yüzeyde 3:1-altı.

---

## 🗺️ Önerilen yol haritası

**P0 — Hızlı kazanımlar (1 oturum, çoğu trivial):** Yukarıdaki 12 hızlı kazanım. Özellikle 3 kontrast
düzeltmesi + textMuted token bump → tek seferde uygulama-geneli okunabilirlik + WCAG uyumu.

**P1 — Marka tutarlılığı (1-2 oturum):** Marka-dışı palet süpürmesi (16 dosya → token), ASCII-Türkçe
geri-yükleme (ayarlar + plan + coach-memory + i18n.ts), 5 tab header'ı birleştir, çift-header'ı kaldır.

**P2 — Yüzey derinleştirme (2-3 oturum):** Raporları veri-dökümünden glanceable grafiklere çevir (gerçek
CircularProgress + LineChart), premium işaretleme + paywall düzelt, settings'i chevron'lu liste yap,
haptik motoru ekle, skeleton yükleyiciler, sohbet streaming + scroll-to-bottom, tarih/saat picker'ları,
KVKK onay kapısı.

---

*Tam bulgu listesi (129 madde, konum + öneri + efor) denetim çıktısında. Bu rapor en yüksek
kaldıraçlı temaları ve önceliklendirilmiş aksiyonu özetler.*
