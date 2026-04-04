# KOCHKO - Kurulum Rehberi

Bu rehber uygulamayi sifirdan calisir hale getirmek icin adim adim talimatlari icerir.

---

## Gereksinimler

- Node.js 18+ (`node -v` ile kontrol et)
- npm (`npm -v` ile kontrol et)
- Expo Go uygulamasi (telefonunda App Store / Play Store'dan indir)
- Supabase hesabi (ucretsiz: https://supabase.com)
- OpenAI API key (https://platform.openai.com/api-keys)

---

## Adim 1: Supabase Projesi Olustur

1. https://supabase.com/dashboard adresine git
2. **"New Project"** tikla
3. Proje ismi: `kochko` (veya istedigin isim)
4. Database password belirle (BUNU BIR YERE NOT ET!)
5. Region: **Frankfurt (eu-central-1)** sec (Turkiye'ye en yakin)
6. **"Create new project"** tikla ve 1-2 dk bekle

### Key'leri al:
1. Sol menuden **Settings > API** sayfasina git
2. Su degerleri kopyala:
   - **Project URL** (ornek: `https://abcdefgh.supabase.co`)
   - **anon public** key (uzun JWT token)
   - **service_role secret** key (GIZLI TUT!)

---

## Adim 2: .env Dosyasini Doldur

Proje klasorundeki `.env` dosyasini ac ve degerleri yapistir:

```
EXPO_PUBLIC_SUPABASE_URL=https://SENIN-PROJE-ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Adim 3: Veritabani Tablolarini Olustur

### Yontem A: SQL Editor (EN KOLAY)

1. Supabase Dashboard'da sol menuden **SQL Editor** tikla
2. **"New query"** tikla
3. Asagidaki dosyalarin icerigini SIRASIYLA kopyala-yapistir ve **"Run"** tikla:

```
supabase/migrations/001_profiles_and_goals.sql
supabase/migrations/002_daily_logs.sql
supabase/migrations/003_ai_memory_and_chat.sql
supabase/migrations/004_plans_and_reports.sql
supabase/migrations/005_rls_policies.sql
supabase/migrations/006_feature_extensions.sql
supabase/migrations/007_coaching_messages_and_cleanup.sql
supabase/migrations/008_goal_start_weight.sql
supabase/migrations/009_barcode_corrections.sql
supabase/migrations/010_missing_tables_and_columns.sql
supabase/migrations/011_missing_tables_and_fixes.sql
```

Her dosyayi ayri ayri calistir. Hata alirsan bir onceki basarili oldugunu kontrol et.

### Yontem B: Supabase CLI (Ileri duzey)

```bash
# CLI kur
npm install -g supabase

# Projeye baglan
supabase login
supabase link --project-ref SENIN-PROJE-ID

# Migration'lari calistir
supabase db push
```

---

## Adim 4: Auth Ayarlari (Supabase Dashboard)

1. Sol menuden **Authentication > Providers** git
2. **Email** provider'in acik oldugunu kontrol et
3. **"Confirm email"** seceenegini KAPAT (gelistirme icin)
   - Authentication > Settings > "Enable email confirmations" OFF

### Google OAuth (opsiyonel):
1. Google Cloud Console'dan OAuth client olustur
2. Redirect URI: `https://SENIN-PROJE-ID.supabase.co/auth/v1/callback`
3. Supabase Dashboard > Auth > Providers > Google > Client ID ve Secret gir

### Apple Sign-In (opsiyonel, sadece iOS):
1. Apple Developer Account'tan Service ID olustur
2. Supabase Dashboard > Auth > Providers > Apple > ayarlari gir

---

## Adim 5: Edge Functions Deploy Et

### Supabase CLI gerekli:

```bash
# CLI yoksa kur
npm install -g supabase

# Login ol
supabase login

# Projeye baglan (proje ID'ni dashboard URL'den alabilirsin)
supabase link --project-ref SENIN-PROJE-ID

# OpenAI API key'i secret olarak ayarla
supabase secrets set OPENAI_API_KEY=sk-SENIN-OPENAI-KEY

# Edge function'lari deploy et
supabase functions deploy ai-chat
supabase functions deploy ai-plan
supabase functions deploy ai-proactive
supabase functions deploy ai-report
```

Her deploy sonrasi **"Function deployed successfully"** mesaji gormeli sin.

---

## Adim 6: Uygulamayi Calistir

```bash
# Bagimliklar zaten kuruldu, ama emin olmak icin:
npm install --legacy-peer-deps

# Uygulamayi baslat
npx expo start
```

Terminalda QR kod cikacak. Telefonundaki **Expo Go** ile tara.

---

## Kontrol Listesi

- [ ] Supabase projesi olusturuldu
- [ ] .env dosyasi dolduruldu (URL + anon key)
- [ ] 11 migration dosyasi SQL Editor'de calistirildi
- [ ] Email auth acik, email confirmation kapali
- [ ] Supabase CLI kuruldu (`supabase --version`)
- [ ] OpenAI API key secret olarak ayarlandi
- [ ] 4 edge function deploy edildi
- [ ] `npx expo start` basarili
- [ ] Expo Go'da uygulama aciliyor
- [ ] Kayit olup giris yapabiliyorsun
- [ ] Chat'te mesaj gonderince AI cevap veriyor

---

## Sik Karsilasilan Sorunlar

### "Network request failed" hatasi
- `.env` dosyasindaki Supabase URL'yi kontrol et
- URL sonunda `/` OLMAMALI

### "Edge Function 500 error"
- `supabase functions deploy ai-chat` tekrar calistir
- `supabase secrets list` ile OPENAI_API_KEY ayarli mi kontrol et

### "Invalid API key" (OpenAI)
- OpenAI dashboard'dan key'in aktif oldugunu kontrol et
- Bakiye oldugunu kontrol et (https://platform.openai.com/usage)

### Kayit olduktan sonra "undefined" hatasi
- Migration'larin hepsinin calistigini kontrol et
- Supabase Dashboard > Table Editor > `profiles` tablosu var mi bak

### Metro bundler hatasi
```bash
npx expo start --clear
```
