# KOCHKO — Release Checklist (v1.0.0-rc)

Sırayla bitmesi gereken son-mil işleri. Her bölüm bağımsız doğrulanabilir.

## 1. Veritabanı & Edge Functions Deploy

Yeni migration'lar (015-026) ve edge function (`cleanup-scheduled`) henüz uzağa deploy edilmedi.

```bash
# Local supabase link varsa
supabase db push            # migration'ları uygula
supabase functions deploy ai-chat ai-plan ai-proactive ai-extractor ai-report cleanup-scheduled
supabase secrets set OPENAI_API_KEY=<value>
```

- [ ] 12 migration başarıyla apply oldu (`supabase db diff` → boş)
- [ ] 6 edge function deployed
- [ ] pg_cron schedule aktif (`SELECT jobname FROM cron.job`)
- [ ] OPENAI_API_KEY env doğrulandı

## 2. E2E Smoke Test (manuel)

Cihaz geldiğinde:

- [ ] Signup → onboarding → dashboard
- [ ] Text meal log → macro ring çıkıyor
- [ ] Foto meal log → items doğru parse
- [ ] Voice → transcribe → gönder onayı
- [ ] Barcode → TR ürün bulunur
- [ ] Plateau simülasyonu (3h aynı kilo) → chat'te öneri
- [ ] Premium paywall → satın alma flow
- [ ] 7-gün trial başlat → 5+ AI mesaj kısıtsız
- [ ] Inactivity bildirimi (test cihazda clock ileri)
- [ ] Weekly menu approve → başka cihazda sync
- [ ] Logout → relogin

## 3. RLS Isolation Audit

Her user-owned tabloda RLS policy'si olduğunu doğrula:

```sql
SELECT tablename, rowsecurity, COUNT(*) FILTER (WHERE cmd='SELECT') sel,
       COUNT(*) FILTER (WHERE cmd='INSERT') ins, COUNT(*) FILTER (WHERE cmd='UPDATE') upd,
       COUNT(*) FILTER (WHERE cmd='DELETE') del
FROM pg_policies p JOIN pg_tables t USING (tablename)
WHERE schemaname='public' GROUP BY tablename, rowsecurity ORDER BY tablename;
```

- [ ] Tüm user-owned tablolarda rowsecurity=true + minimum 4 policy (sel/ins/upd/del)
- [ ] Cross-user test: user A ile user B'nin meal_logs'larını okumaya çalış → 0 satır

## 4. Performance Budget

- [ ] Chat mesaj latency p50 < 2s, p95 < 5s (RevenueCat dashboard / Supabase logs)
- [ ] App cold start < 3s (Dev build measure)
- [ ] Image upload < 10s (50-250KB vision payload)

## 5. Accessibility

- [ ] Ana CTA butonların `accessibilityLabel` + `accessibilityRole`
- [ ] Touch target min 44pt (ikon butonları 32×32 → accessible hitSlop ile 44×44 etkin)
- [ ] Koyu/açık tema kontrast WCAG AA

Not: Chat calendar/voice/camera/barcode/send ikon butonlarına hitSlop 44×44 zaten uygulandı bu sürümde.

## 6. Sentry (error telemetry)

Kurulum (opsiyonel, package.json'a dep ekle):

```bash
npx expo install @sentry/react-native
```

Sonra `app/_layout.tsx` başına:

```typescript
import * as Sentry from '@sentry/react-native';
Sentry.init({ dsn: 'YOUR_DSN', tracesSampleRate: 0.1 });
```

- [ ] Sentry DSN alındı
- [ ] Production release'e wrap edildi
- [ ] Son 7 gün 0 unhandled crash

## 7. KVKK/GDPR Compliance

- [ ] `app/settings/privacy.tsx` (veya equivalent) live privacy policy var
- [ ] Onboarding'de consent checkbox/opt-in
- [ ] `export.service` JSON/CSV/PDF çalışıyor
- [ ] `privacy.service.requestAccountDeletion` → 30-day grace → migration 023 cron hard-delete
- [ ] Photo cleanup cron (migration 022 + cleanup-scheduled) 24h delete
- [ ] pgsodium migration 025 uygulandı (production ortamında)

## 8. Store Listing

- [ ] 5+ screenshots her platform (ana ekran, chat, menü, rapor, paywall)
- [ ] App icon + adaptive icon
- [ ] Description TR + EN (max 4000 chars)
- [ ] Keywords (fitness, koç, beslenme, diyet, AI)
- [ ] Yaş sınırı: 13+
- [ ] `app.config.js` production values (scheme, version, bundleId)

## 9. Build & Release

### EAS Build (cloud, önerilen)
```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview  # APK
eas build --platform all --profile production   # Production AAB + IPA
```

### Local Android (Windows)
Android Studio + JDK 17 kurulu olmalı.
```bash
npx expo prebuild --platform android
npx expo run:android --variant release
# APK: android/app/build/outputs/apk/release/app-release.apk
```

### Tag
```bash
git tag v1.0.0-rc1
git push origin v1.0.0-rc1
```

## 10. Known Gaps / Follow-ups

Post-v1 yapılacak:
- RevenueCat native SDK entegrasyonu (`@revenuecat/purchases-react-native`)
- Sentry DSN + actual wiring
- HealthKit (iOS) / Health Connect (Android) — step counter ötesinde HRV/sleep
- Jet lag region cuisine database
- Photo auto-deletion edge function test
- Multi-device session terminate UX smoke test
