# KOCHKO — Gece Otonom Test Oturumu (2026-06-19)

Hakan, sen yatarken yürüttüğüm otonom test + düzeltme oturumunun canlı durum defteri.
En güncel özet en altta. Sabah ilk bakacağın yer: **"⚠️ SENİN YAPMAN GEREKEN"** bölümü.

---

## ⚠️ SENİN YAPMAN GEREKEN (tek harici blocker)

**OpenAI API kotası tükenmiş.** Tüm AI akışları (sohbet, plan üretimi, rapor, foto/vision)
edge function'larda `429 insufficient_quota` ile dönüyor. Bu bir **billing** durumu — kod hatası değil.
Edge function'lar sağlıklı boot ediyor, sadece çalışan bir LLM'e ulaşamıyorlar.

**Uygulamayı gerçek manada test edebilmen için yapman gereken tek şey:**
- OpenAI hesabına kredi/kota ekle (platform.openai.com → Billing), **VEYA**
- Bana çalışan bir anahtar bırak; sağlayıcıyı (OpenAI / OpenRouter / Azure) tek secret ile
  değiştirebilmen için LLM katmanını yapılandırılabilir hale getiriyorum (aşağıda).

Bu çözülür çözülmez tüm AI akışları çalışır — geri kalan her şeyi bu gece kusursuzlaştırıyorum.

**SEÇENEK A — En basit:** OpenAI hesabına kredi ekle (platform.openai.com → Settings → Billing).
Hiçbir kod/secret değişikliği gerekmez; mevcut `OPENAI_API_KEY` zaten kurulu.

**SEÇENEK B — Farklı sağlayıcıya geç (kod artık buna hazır, REDEPLOY GEREKMEZ, sadece secret):**
```bash
# Örn. OpenRouter (Claude/GPT/Llama hepsini OpenAI-uyumlu sunar) ya da başka bir OpenAI hesabı:
export SUPABASE_ACCESS_TOKEN=<senin sbp_ token>
npx supabase secrets set OPENAI_API_KEY=<çalışan-anahtar> --project-ref ugoynltxwrkqjwrdxmzt
npx supabase secrets set OPENAI_BASE_URL=https://openrouter.ai/api/v1 --project-ref ugoynltxwrkqjwrdxmzt
# (OpenAI'da kalıyorsan OPENAI_BASE_URL'i hiç set etme — varsayılan api.openai.com.)
```
Secret değişikliği bir sonraki çağrıda etkin olur (edge function'lar env'i runtime okur).
Test: `node TEMP/kk.mjs chat "merhaba"` → 200 ve Türkçe yanıt görmelisin.

---

## ✅ Doğrulanan Temel Sağlık (gece başı)

- Canlı Supabase erişimi: **çalışıyor** (yeni token), 25 kullanıcı, DB sağlıklı.
- `tsc --noEmit` (npm run lint): **0 hata**.
- Edge function'lar: **boot ediyor** (yalnız LLM çağrısında billing 429).
- Migration'lar 037–044: **canlıda uygulı** (039 status CHECK, 042 FK SET NULL, 043 weekly_plans
  policies + goal CHECK, households/coach_consents tabloları, 044 birth_year hepsi doğrulandı).
  Not: `supabase_migrations.schema_migrations` defteri yalnız 036'ya kadar kayıtlı (037–044
  doğrudan SQL ile uygulanmış) — kozmetik; CLI deploy kullanılmıyor.

## 🔍 Bu gece yürüttüğüm iş

8 boyutlu derin canlı denetim (multi-agent): client DB yazma/okuma, edge function DB ops,
routing/navigasyon, RLS/güvenlik, spec-kritik özellik kapsamı, LLM dayanıklılık, veri tutarlılığı.
Her bulgu düşmanca (adversarial) ikinci bir ajanla doğrulanıyor; yalnız kanıtlananları düzeltiyorum.

---

## 📋 İlerleme Defteri

### Tur 1 — 8-boyutlu denetim → 21 onaylı bulgu DÜZELTİLDİ (commit 097c4f1)
2 critical, 4 high, 8 medium, 7 low. Hepsi adversarial doğrulandı, düzeltildi, canlı test edildi.

**İki KRİTİK (canlı doğrulandı):**
1. `subscriptions` tablosunda INSERT RLS politikası yoktu → **7 günlük ücretsiz deneme HİÇ
   başlamıyordu** (14 onboarding'i biten kullanıcının 0'ında trial vardı). Politika eklendi.
   Canlı test: kendi satırını insert 201 ✓, başka kullanıcıya 403 ✓, trigger premium set etti ✓.
2. `ai_summary_merge`/`append_patterns` RPC'leri herhangi bir kullanıcının **başka kullanıcının
   AI hafızasını ezmesine** izin veriyordu (EXECUTE anon+authenticated'a açık, auth.uid() guard yok).
   PUBLIC'ten revoke, yalnız service_role. Canlı: authenticated artık execute edemiyor ✓.

**Yüksek (high):**
3. `ai_summary` UPDATE politikası yoktu → KVKK "unutma" sessizce başarısız (Madde 17 ihlali). Düzeltildi, canlı UPDATE 1 satır ✓.
4. Chat hata mesajı ham İngilizce "Edge Function returned a non-2xx..." gösteriyordu → Türkçe dostça mesaj.
5. Diyet/antrenman plan oluşturma AI hatasında sessizce takılıyordu → Alert ile görünür.
6. Onboarding görev-kartı sohbeti AI hatasında boş ekran bırakıyordu → dostça baloncuk.

**Orta/Düşük (8 medium + 7 low):** enum whitelist (profil+goal), plan_type clamp, TDEE bakım-dönemi
koruması, haftalık bütçe tek-kaynak, mesaj kotası iadesi, reverse-diet çift-sayım, ölü route'lar,
0-satır KVKK guard, Layer-2 ölü sinyal plumbing + tdee_notes yazıcı, is_owner search_path, vb.

**Bonus:** LLM sağlayıcı yapılandırılabilir hale getirildi (`OPENAI_BASE_URL` secret).

**Deploy durumu:** Migration 045 canlıda ✓. 5 AI edge function (ai-chat/plan/extractor/proactive/report)
yeniden deploy edildi ✓. Hepsi temiz boot ediyor (yalnız OpenAI 429). Client `tsc` 0 hata ✓.

### ⚠️ GIT PUSH ENGELİ (senin müdahalen gerek)
Commit **097c4f1** yerelde hazır ve doğru kimlikle (hakandemircitasarim). Ama `git push` **403** veriyor:
Windows kimlik yöneticisi **irmakcaglayan** hesabıyla giriş yapmış, o hesabın `hakandemircitasarim/Kochko`
deposuna yazma yetkisi yok. Sabah: GCM'i hakandemircitasarim olarak yeniden doğrula, sonra
`git push origin claude/KOCHKO`. (Tüm iş yerelde güvende, commit'ler kayıp değil.)

### Tur 2 — derin denetim (çalışıyor)
Kendi düzeltmelerimin regresyon taraması + ilk turda OpenAI kapalı olduğu için canlı test
edilemeyen çekirdek AI pipeline (aksiyon yürütme, guardrail güvenliği, onboarding+hafıza,
raporlar/dashboard canlı, bildirim/offline). Sonuçlar buraya eklenecek.
