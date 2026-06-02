# Kochko

AI yaşam tarzı koçu — beslenme, antrenman, uyku, su, stres, alışkanlık ve motivasyonu aynı anda yöneten yapay zeka destekli mobil uygulama.

React Native + Expo (SDK 55) ön yüzü, Supabase (Postgres + Edge Functions) arka ucu.

## Kurulum

1. Node 20+ ve npm kurulu olsun.
2. Supabase CLI: `npm install -g supabase`
3. Expo dev client: `npm install`
4. `.env.example` dosyasını `.env` olarak kopyala ve kendi Supabase anahtarlarını gir.
5. İlk çalıştırma:
   ```
   npx expo start
   ```
   Cihazında Expo Go yerine özel bir dev client gerekir (native modül kullandığımız için). Detay için `eas.json`.

## Komutlar

- `npm start` — Expo dev server
- `npm run android` — Android dev build çalıştır
- `npm run ios` — iOS dev build çalıştır
- `npm run lint` — TypeScript tip kontrolü (`tsc --noEmit`)
- `npx eslint .` — kod stili kontrolü
- `npx prettier --check .` — biçim kontrolü

## Proje yapısı

```
app/              # expo-router ekranları (layout ve routes)
src/
  components/     # paylaşılan UI bileşenleri
  services/       # veri + iş mantığı servisleri
  stores/         # Zustand store'ları (auth, profile, dashboard)
  lib/            # yardımcılar (tdee, day-boundary, guardrails)
supabase/
  functions/      # edge functions (Deno): ai-chat, ai-plan, ai-proactive, ai-report
  migrations/     # SQL şema geçişleri
```

## Planlama dokümanları

- `docs/MASTER_PLAN.md` — yapılandırılmış yol haritası (fazlar, durumlar)
- `kochko-spec-v10.md` — tam özellik spesifikasyonu
- `arayuz.md` — UI yeniden tasarım planı
- `bitirme.md`, `final.md`, `final2.md`, `liste.md`, `plan.md` — geçmiş analiz/planlar
- `C:\Users\demir\.claude\plans\merhaba-opus-bu-uygulamay-humble-cherny.md` — aktif bitirme planı

## Beta dağıtım (EAS)

Yakın çevre testi için `eas.json` içinde üç profil tanımlı:

1. `development` — dev cihazına doğrudan kurulan dev client
2. `preview` — TestFlight (iOS) + Play Internal Testing (Android) için imzalı build
3. `production` — store submission için imzalı build

İlk kurulum:

```
npm install -g eas-cli
eas login
eas build:configure          # app.json/app.config.js'i EAS project id ile eşler
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

OTA güncellemeler (build olmadan):

```
eas update --channel preview --message "küçük UI düzeltmeleri"
```

Not: iOS build için Apple Developer Program ($99/yıl), Android Play Internal için Play Console ($25 bir kere) gerekir. EAS bunları otomatik yönetir ama hesaplar kurulu olmalı.

### Crash ve hata raporlama (Sentry)

Sentry DSN'i `.env` dosyasına `EXPO_PUBLIC_SENTRY_DSN` olarak ekle. Ayrıca:

```
npm install @sentry/react-native
npx @sentry/wizard@latest -s -i reactNative
```

DSN ayarlı değilse `src/lib/sentry.ts` no-op olarak çalışır (uygulamayı bozmaz). DSN ayarlıyken global error handler + manuel `reportError()` çağrıları Sentry'ye gönderilir. Son 50 hata her zaman yerel ring buffer'da (`getRecentErrors()`) tutulur, Debug Mode ekranında görünür.

## Katkı

Şimdilik tek geliştirici projesi. Kritik kurallar:
- Ana dal: `claude/KOCHKO`
- Her faz (MASTER_PLAN'da tanımlı) bağımsız commit edilmeli, aralarında uygulama çalışır durumda kalmalı
- `tsc --noEmit` ve `eslint` temiz olmadan commit yapma
- Supabase migration'ları aşağıdan yukarı numaralandırılır, yeni migration eklerken en yüksek numaradan sonraya geç
