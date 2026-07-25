# DEVAM — uzak makinede kaldığın yerden nasıl devam edilir

Son commit: **`29f0db7`** (branch `claude/KOCHKO`) — tüm-sistem denetim backlog'u (12/12) +
AI davranış spec'i (16/18). Detaylı döküm: [`AI_DAVRANIS_PLANI_2026-07-24.md`](AI_DAVRANIS_PLANI_2026-07-24.md).

> **Durum:** kod yazıldı ve `deno check` + 52 test + `tsc` + arch-guards ile doğrulandı.
> **HENÜZ YAPILMADI:** migration'lar uygulanmadı, edge fonksiyonlar deploy edilmedi,
> emülatörde/telefonda sürülmedi. Aşağıdaki 4 adım tam olarak bunlar.

---

## 0) Repoda OLMAYAN şeyler (gitignore'lu — yeniden oluşturman gerekiyor)

| Ne | Neden yok | Ne yapmalısın |
|---|---|---|
| `.env` | secret | Adım 2'de 2 satırla oluştur |
| `android/` | native klasör | `npx expo prebuild` otomatik üretir (Adım 5) |
| `node_modules/` | bağımlılık | `npm ci` |
| `TEMP/` | eski yardımcı script'ler (`q.mjs`, `provision.mjs`) | Gerekmiyor; aşağıdaki adımlar CLI ile |

## 1) Gereksinimler

```bash
node -v      # 20+
deno --version   # 2.x  (edge fonksiyonların TEK tip kontrolü — tsc supabase/functions'ı DIŞLIYOR)
supabase --version
java -version    # 17  (sadece APK/emülatör için)
```

Eksikse: Deno → https://deno.land · Supabase CLI → `npm i -g supabase` (veya scoop/brew).

## 2) Klonla ve kur

```bash
git clone https://github.com/hakandemircitasarim/Kochko.git
cd Kochko
git checkout claude/KOCHKO
npm ci
```

`.env` dosyasını oluştur (Supabase panel → Settings → API):

```
EXPO_PUBLIC_SUPABASE_URL=https://<PROJE-REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

> `OPENAI_API_KEY` **client .env'ine YAZILMAZ** — Supabase secret'ı olarak durur (Adım 4).

Sağlık kontrolü (hiçbir şeye dokunmadan, her şey yeşil olmalı):

```bash
npm run ci
```

`52 passed` + 6 × `Check` + `arch-guards: all invariants hold` görmelisin.

## 3) Migration'ları uygula (İLK BU — sıra önemli)

3 yeni migration var ve **kod bunlara ihtiyaç duyuyor**:
`094` (plan kaybını bitiren smallint→integer RPC), `095` (activity_level default'u kaldırır),
`096` (yeni yakalama kolonları).

```bash
supabase link --project-ref <PROJE-REF>     # .env'deki URL'de yazan ref
supabase db push
```

Doğrula (Supabase Studio → SQL Editor):

```sql
-- 094: RPC artık integer kullanıyor mu (smallint DÖNMEMELI)
select pg_get_functiondef(oid) like '%weekly_budget_total integer%' as ok_094
from pg_proc where proname = 'project_daily_plans';

-- 095: default kalktı mı (NULL dönmeli)
select column_default as ok_095 from information_schema.columns
where table_name='profiles' and column_name='activity_level';

-- 096: 4 kolon geldi mi (4 satır dönmeli)
select table_name, column_name from information_schema.columns
where (table_name='profiles'   and column_name in ('sleep_problems','meal_times'))
   or (table_name='goals'      and column_name='reason')
   or (table_name='lab_values' and column_name='notes');
```

> **Neden sıra önemli:** kod `sleep_problems` / `notes` gibi kolonlara yazıyor. Migration'dan
> ÖNCE deploy edersen 42703 alırsın — kod bunu yakalayıp geri düşecek şekilde korumalı
> (veri kaybı olmaz) ama o alanlar sessizce kaydedilmez. Migration'ı önce uygula.

## 4) Edge fonksiyonları deploy et

Secret'lar duruyor mu (yoksa AI cevap vermez):

```bash
supabase secrets list
# OPENAI_API_KEY yoksa:
supabase secrets set OPENAI_API_KEY=sk-...
```

Bu commit **6 fonksiyonun 5'ine** dokundu:

```bash
supabase functions deploy ai-chat
supabase functions deploy ai-proactive
supabase functions deploy ai-report
supabase functions deploy ai-extractor
supabase functions deploy ai-plan
```

Sonra sözleşme testleri (canlı fonksiyonlara vurur):

```bash
npm run contract-tests
```

## 5) Uygulamayı çalıştır

**Hızlı yol (dev client, emülatör/telefon):**

```bash
npx expo start --dev-client
# veya native derleme + kurulum (android/ klasörünü otomatik üretir):
npx expo run:android
```

**Release APK** (kurulabilir dosya):

```bash
npx expo prebuild --platform android      # android/ klasörünü üretir
cd android && ./gradlew assembleRelease
# çıktı: android/app/build/outputs/apk/release/app-release.apk
```

> ⚠️ Windows'ta `android/local.properties` içindeki `sdk.dir` **düz eğik çizgi** kullanmalı:
> `sdk.dir=C:/Users/<sen>/AppData/Local/Android/Sdk` (ters eğik çizgi build'i kırar).

## 6) NE TEST EDİLMELİ (asıl kapı burası)

Bu oturumun kuralı: *"sunucu yeşil ≠ UX doğrulandı."* Şunları **elle** dene:

**Bu oturumda düzeltilen, mutlaka bak:**
1. **Uyku kartı** (senin bulduğun bug): "belli bir düzen yok" → kart **kapanmalı**, aynı soru
   tekrar sorulmamalı. "9 12" → koç kabul edip kaydetmeli. "7 buçuk saat uyudum" → 7.5 kaydolmalı.
2. **Sohbette plan**: normal sohbete "bana haftalık diyet listesi hazırla" yaz →
   plan **mesajın içinde** gelmeli + **Onayla/Değiştir** butonları. Ekrana yönlendirme OLMAMALI.
   Onayla → panelde kalori hedefi görünmeli. *(Bu en riskli değişiklik — önce bunu dene.)*
3. **Öğün fişi**: "bir kase yulaf yedim" → **~156 kcal** (972 DEĞİL). Fiş kalem kalem olmalı,
   tahminler `~` ile işaretli, sohbetteki sayı panelle **aynı**.
4. **Adım**: "bugün 12 bin adım attım" → gerçekten kaydolmalı (eskiden boşluğa gidiyordu).
5. **Su**: "3 su bardağı içtim" → 0.6 L.
6. **Ses**: koç "Harika!", "Tabii ki", "Kaydettim" **dememeli**; Türkçe **tam diakritikli** olmalı.
7. **Tek soru**: bir öğün kaydında birden fazla soru/paragraf yığını gelmemeli.
8. **Severe alerjen**: "ciddi fıstık alerjim var" → sonra "fıstık alerjim geçti" → koç **silmemeli**,
   açık teyit istemeli.

**Sunucu logları** (`supabase functions logs ai-chat --follow`) şunları görmelisin:
`[mode_promotion]`, `[meal_log] grounded`, `[step_safety_net]`, `[allergen_block]`,
`[nudge]`, `[approve][projection]`.

## 7) Kalan iş (bilinçli bırakıldı)

| # | Ne | Neden bırakıldı |
|---|---|---|
| #15 | Ters çevrilmiş onay altyapısı | `chat_sessions.pending_intent` JSONB migration + client bağlantısı gerekiyor ("Hayır, yanlış anladın" gerçekten yazımı geri almalı) |
| #17 | Nudge metinlerinin kanıttan üretilmesi | 16 aileden 13'ü donmuş literal; aile-aile dönüşüm + FALLBACK_COPY gerekiyor |
| — | Ödeme altyapısı (RevenueCat/IAP) + lira fiyatlama | Ürün kararı; `PURCHASE_ENABLED=false`. **"Tutar mı?" sorusu bu açılmadan ölçülemez.** |

## 8) Bir şey ters giderse

```bash
git log --oneline -3          # 29f0db7 en üstte olmalı
git revert 29f0db7            # kodu geri al (migration'lar ayrı — aşağıdaki DOWN'ları kullan)
```

Migration geri alma notları her `.sql` dosyasının başında yazıyor (`-- DOWN:` satırı).
`095` için: `ALTER TABLE profiles ALTER COLUMN activity_level SET DEFAULT 'sedentary';`
