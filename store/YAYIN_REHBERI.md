# KOCHKO — Google Play Kapalı Test Yayın Rehberi

Her şey hazır. Senin yapman gerekenler sırayla — toplam ~30-45 dakika.

## 0. YEDEKLE (ilk iş, çok önemli)

Şu iki dosyayı güvenli bir yere kopyala (Google Drive, USB, şifre yöneticisi):

- `android/app/kochko-upload.keystore`
- `android/keystore.properties` (parolayı içerir)

**Bu anahtar kaybolursa Play'de uygulamanın güncellenme kimliği kaybolur.**
İkisi de bilerek git'e GİRMİYOR (gitignore'da).

## 1. Play Console hesabı

1. https://play.google.com/console → Google hesabınla gir
2. Geliştirici hesabı oluştur (tek seferlik $25 ücret — kart bilgisi Play'e girilir)
3. Kimlik doğrulaması isterse tamamla (yeni hesaplarda 1-2 gün sürebilir)

## 2. Uygulama oluştur

1. "Uygulama oluştur" → Ad: **KOCHKO — AI Beslenme Koçu**
2. Dil: Türkçe · Uygulama · Ücretsiz
3. Beyanları onayla

## 3. Mağaza kaydı (Store listing)

`store/play-listing.md` dosyasındaki metinleri kopyala-yapıştır:
- Kısa açıklama, tam açıklama, kategori (Sağlık ve Fitness), e-posta

Görseller (Console yüklerken ister):
- Uygulama simgesi 512×512: `assets/icon.png`'den üret (Console kendisi kırpar)
- Öne çıkan görsel 1024×500: basit koyu zemin + logo yeterli
- En az 2 telefon ekran görüntüsü: emülatörden aldıklarımız
  `scratchpad`'de var; istersen temiz set çekerim — dashboard + chat + rapor ideal

## 4. Zorunlu formlar (sol menü → Politika)

- **Gizlilik politikası URL'i:**
  `https://ugoynltxwrkqjwrdxmzt.supabase.co/functions/v1/legal/gizlilik` (CANLI ✓)
- **Veri güvenliği formu:** cevaplar `store/play-listing.md`'de hazır
- **İçerik derecelendirme anketi:** sağlık uygulaması, şiddet yok → "Herkes"
- **Hedef kitle:** 18+
- **Sağlık uygulamaları beyanı:** sağlık/fitness verisi topluyor, tanı koymuyor

## 5. Kapalı test sürümü

1. Sol menü → Test → **Kapalı test** → "Yeni sürüm oluştur"
2. AAB yükle: `android/app/build/outputs/bundle/release/app-release.aab`
   (upload anahtarıyla imzalı ✓ — "Play App Signing"i kabul et, Google kendi
   imzasını üstüne koyar, bu normal)
3. Sürüm notu: "İlk kapalı test sürümü"
4. **Test kullanıcıları:** e-posta listesi oluştur — kendi Gmail'lerin +
   arkadaşların (Play, production'a geçiş için 12+ testçinin 14 gün test
   etmesini isteyebilir; yeni hesaplarda bu şart var)
5. Kaydet → İncele → Yayınla

## 6. İnceleme sonrası

- Google incelemesi genelde birkaç saat - 2 gün sürer
- Onaylanınca testçilere davet linki gider (Console'dan kopyalanır)
- Testçiler linkten kabul edip Play Store'dan indirir

## 7. Test dönemi biterken

- Kullanıcı geri bildirimi + `ai_turn_log` verisiyle b1a kapılarının kanıtı birikir
- Sorun yoksa: Kapalı test sürümünü **Production'a terfi ettir** (aynı AAB, tek tık)

---

## Teknik durum özeti (hepsi hazır ✓)

| Ne | Durum |
|---|---|
| İmzalı AAB | `android/app/build/outputs/bundle/release/app-release.aab` (77 MB, CN=KOCHKO) |
| Ücretsiz lansman | Sunucu `KOCHKO_FREE_LAUNCH=on` + istemci `FREE_LAUNCH=true` — kapatmak tek satır |
| AI kapıları | b1a ×3 = **on** (canlı doğrulandı) |
| Gizlilik + koşullar | Canlı URL'de, uygulama içi linkler bağlı |
| SYSTEM_ALERT_WINDOW | Release'ten çıkarıldı (hassas izin incelemesi tetiklenmez) |
| Emülatör doğrulaması | Temiz kurulum + login + premium-gizli + Yakında rozetleri PASS |

## Bilinen ertelemeler (bilinçli)

- **Uzak push bildirimi** (FCM): yerel bildirimler çalışıyor; uzak push için
  Firebase projesi + google-services.json gerekir — test döneminde şart değil
- **IAP/RevenueCat:** lansman ücretsiz; açılacağı sürümde `FREE_LAUNCH=false` +
  secret kaldır + RevenueCat bağla
- **B7/D2 (AI içi):** gerçek trafik ölçümü birikince inecek
