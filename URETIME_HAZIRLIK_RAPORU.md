# KOCHKO — Üretime Hazırlık Raporu (Production Readiness)

> 9-ajan production-readiness denetimi (2026-05-30). 8 boyut, 55 blocker.
> **VERDICT: NO-GO.** Detaylı kanıt aşağıda. Bu rapor `BITIRME_PLANI_v2.md`'yi (özellik bitirme) tamamlar.

## ⚡ GÜNCELLEME (2026-05-30, tam-yetki turu)
**Deno 2.8.1 kuruldu ve 6 edge function ilk kez type-check edildi → bulunan 42 hatanın TAMAMI düzeltildi; `deno check` artık SIFIR hatayla geçiyor.** İçlerinde gerçek runtime bug'ları vardı: `ai-proactive` template'inde async-IIFE (modül HİÇ yüklenmiyordu → tüm proaktif/cron ölüydü), `hour` ReferenceError, 7 yerde Postgrest builder'da `.catch()` (TypeError), ai-plan'da menstrual kolonları select'te eksik (döngü-fazı sessizce ölü), duplicate `estimateTokens`. Bu, aşağıdaki "#1 runtime kanıtlanmadı" riskini **statik olarak** büyük ölçüde kapattı — geriye sadece gerçek deploy + cihazda davranış doğrulaması kaldı.

## Tek cümle
**Hayır, şu anda üretime hazır değil.** Kod ana akışta sağlam ama hiçbir şey deploy/çalıştırılmadı, gerçek ödeme yok (üstelik **premium bedavaya alınabiliyor — güvenlik açığı**), push çalışmıyor ve KVKK açık rıza ekranı yok — bu haliyle hem teknik olarak çökük hem de App Store/Play tarafından reddedilir.

## Üç bağımsız başarısızlık sınıfı (her biri tek başına NO-GO)
1. **Runtime'da hiçbir şey kanıtlanmadı.** Deno + supabase CLI kurulu değil → 6 edge function (ai-chat 2571 satır dâhil) hiç type-check/çalıştırılmadı. Bu oturumdaki tüm P0 düzeltmeleri **migration 030-036 prod'a uygulanana kadar atıl** (036 hâlâ git'te untracked). Cron işleri (proaktif koç, gece extraction, KVKK 30-gün silme) çalışamıyor çünkü migration 014/022/023 hiçbir migration'ın set etmediği GUC'leri (`app.settings.supabase_url`/`service_role_key`) okuyup runtime'da throw ediyor.
2. **Para hem yok hem güvenlik açığı.** `initiatePurchase/restorePurchases` stub (`native_sdk_not_wired`); RevenueCat yok → ücretli app para alamıyor. Dahası: prod paywall'da guard'sız "Test" butonları (`premium.tsx:196,242`) `activatePremium` → client-side `profiles.update({premium:true})`. `profiles` UPDATE RLS politikası `USING(auth.uid()=id)` ama **WITH CHECK yok, kolon kısıtı yok** (005:45) → **herhangi bir kullanıcı tek REST çağrısıyla kendine bedava premium veriyor** ve sunucu bu boolean'a güvenip sınırsız (gerçek-maliyetli) LLM veriyor.
3. **Ücretli-pazar yasal/teslim boşlukları.** Sağlık verisi için KVKK aydınlatma/açık rıza ekranı yok; barındırılan gizlilik politikası yok (store zorunluluğu); `app.config.js`'te iOS izin metinleri yok (kamera/mik/foto → crash + auto-reject); push token `projectId:undefined`; crash reporting yok (@sentry/react-native kurulu değil); 48 dosya commit'siz.

> Güçlü yanlar (gerçekten sağlam): RLS veri-izolasyonu çekirdeği, in-app proaktif koçluk döngüsü, guardrail'ler. Ama "kod doğru görünüyor" ≠ "ödeyen kullanıcı için çalışıyor" — ve bu app o çizgiyi hiç geçmedi.

## Boyut skorları
| Boyut | Durum |
|-------|-------|
| Kritik kullanıcı yolları (auth→onboarding→plan→log→dashboard→rapor) | not-ready |
| Deployment & config | not-ready |
| Ödeme / monetizasyon | not-ready |
| Bildirim & proaktif teslim | not-ready |
| Güvenlik, RLS & KVKK/GDPR | not-ready |
| Veri bütünlüğü & şema drift | minor-gaps |
| Spec'e karşı işlevsel tamlık | minor-gaps |
| Release, build & operability | not-ready |

---

## A) KODLANABILIR ship-blocker'lar (hesap/cihaz gerektirmez)

1. **🔴 Bedava-premium RLS açığını kapat + client premium yazımını sil.** `profiles_upd` (005:45) politikasını kolon-güvenli yap: `premium/premium_expires_at/trial_used` kolonlarını service_role dışında OLD'a zorlayan BEFORE UPDATE trigger (veya bu kolonlarda UPDATE'i `authenticated`'tan revoke). Sonra `premium.tsx:103-126`'daki client `subscriptions.insert` + `update({premium:true})` fallback'ını sil. ~20-30 satır + 1 migration. **En yüksek öncelik (gelir sızıntısı + sınırsız-LLM-maliyet abuse).**
2. **🔴 Tüm "Test" premium butonlarını `__DEV__` arkasına al** (`premium.tsx:196,242` + handleSubscribe). ~5 satır.
3. **✅ coaching_messages 3 eksik insert (P0#3 eksikti) — BU TUR DÜZELTİLDİ** (`ai-chat:2179/2565` + dedup 2171, `memory.ts:638` → trigger_type/content).
4. **🔴 Yeni kullanıcı için TDEE/kalori aralığı + daily_plans üretimi.** İlk-açılış dashboard'ı sıfır olmasın: (a) `onboarding.tsx handleComplete`'te `calorie_range_*` hesapla (lib/tdee.ts var) veya `ai-chat:812` onboarding gate'ini düşür; (b) onboarding sonrası/dashboard focus'ta ai-plan daily-mode çağır veya günlük ai-plan cron ekle. + onboarding formuna `birth_year` ekle. ~30-50 satır.
5. **🔴 ai-proactive + cleanup-scheduled public endpoint'lerine cron-secret guard.** İkisi de `verify_jwt=false`, inbound auth yok → anonim POST tüm-filo LLM+push tetikliyor. serve() başında `x-cron-secret` header kontrolü + cron'dan header geç. ~10 satır/her biri.
6. **🟡 Authenticated startup'ta local bildirim + Android channel.** `scheduleLocalNotifications()` sadece ayarlar ekranından çağrılıyor → ayarları açmayan kullanıcı sıfır hatırlatma alıyor. app-init'te + onboarding sonrası çağır; `setNotificationChannelAsync` ekle (Android 8+ aksi halde sessiz); token fetch'i `Device.isDevice` ile guard'la. ~30-50 satır.
7. **🟡 iOS izin metinleri + native plugin'ler** (`app.config.js`): `ios.infoPlist` NSCamera/NSMicrophone/NSPhotoLibrary(+Add)UsageDescription + ITSAppUsesNonExemptEncryption:false; expo-camera/image-picker/av/notifications/sensors plugin'lerini kaydet. Yoksa binary auto-reject + kamera/mik/foto'da crash.
8. **🟡 push projectId'yi gerçek EAS config'ten oku** (`notifications.service.ts:73,92`: `projectId: undefined` → `Constants.expoConfig.extra.eas.projectId`).
9. **🟡 Kalan canlı-yol şema drift'i:** `challenges.service.ts:49` insert'e `user_id`; phantom `weight_logs` insert (`log.tsx:181`, `index.tsx:116` → `weight_history.recorded_at`); phantom `workout_days` select (`notifications.service.ts:140` — TÜM kişiselleştirilmiş hatırlatma planlamasını kırıyor); `export.service.ts`'e health_events/chat_messages/weight_history/supplement_logs ekle (KVKK erişim hakkı).
10. **🟡 Crash reporting kur + ağacı commit'le:** `@sentry/react-native` + expo plugin + DSN; 48 commit'siz dosyayı commit'le; minimal CI (tsc --noEmit).

## B) HARİCİ blocker'lar (hesap/cihaz/build gerektirir — kodla çözülemez)
- Deno + supabase CLI kur → `deno check` 6 fonksiyon → prod'a `supabase functions deploy` + OPENAI/service-role secret'ları.
- Migration 030-036'yı prod'a `supabase db push` (036 trend CHECK dâhil); önce canlı şemayı geçmişle doğrula.
- Cron GUC'lerini prod'da bir kez SET et: `ALTER DATABASE postgres SET app.settings.supabase_url=...` / `... service_role_key=...` (veya Vault'a taşı) — yoksa tüm zamanlanmış işler throw.
- RevenueCat hesabı + App Store Connect/Play IAP ürünleri; `react-native-purchases` kur, purchase/restore wire et, **yeni imzalı native build**.
- RevenueCat webhook edge function (service-role) → `subscriptions` tablosunu INITIAL_PURCHASE/RENEWAL/CANCELLATION'da idempotent doldur (entitlement client'tan DEĞİL webhook'tan).
- EAS proje + push credential: `eas init`, FCM key + APNs .p8 yükle, push entitlement, TestFlight/Play Internal'a build.
- `eas.json`'daki tüm placeholder'ları gerçek secret'larla doldur (Supabase URL+anon, appleId/ascAppId/teamId, play-service-account.json — JSON'ı gitignore'la).
- Gizlilik politikası URL'i barındır + KVKK aydınlatma/açık rıza metni; Apple App Privacy + Play Data Safety formları.
- pgsodium prod planında açık mı doğrula + migration 025 uygula (yoksa sağlık PII düz metin, UI "şifrelenir" diyor).
- Fiziksel iOS + Android cihazda tam yolculuk smoke testi.

## MVP'ye en kısa dürüst yol (~2-3 odaklı hafta, harici hesaplara bağlı)
- **Hafta 1 — Backend'i gerçekten ayağa kaldır:** Deno+CLI kur, edge'leri `deno check` + deploy, migration 030-036 uygula, GUC SET'leri çalıştır, secret'lar. Paralelde hesap gerektirmeyen kod düzeltmeleri (A listesi). Sonra cihazda smoke test → hiç çalışmamış edge kodu burada gerçek bug verecek.
- **Hafta 2 — Para + teslim:** EAS proje, RevenueCat + store IAP, gerçek purchase/restore + webhook, push projectId, FCM/APNs, imzalı build, sandbox satın alma + gerçek push doğrula.
- **Hafta 3 — Uyumluluk + gönderim:** Gizlilik politikası, KVKK açık rıza gate'i, pgsodium/şifreleme, Apple/Play formları, eas.json secret'ları, build number'lar, TestFlight/Play Internal'a gönder.
- **Scope kesmek gerekirse:** v1'i sadece 7-gün sunucu-issued trial olarak ver (gerçek abonelik v1.1). Ama RLS açığı, KVKK rıza, gizlilik politikası, iOS izin metinleri, edge deploy, GUC/migration uygulaması trial-only için bile **pazarlık dışı** (correctness/yasal/store gate'leri).
