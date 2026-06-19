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

### Tur 2 — derin denetim → 14/19 bulgu DÜZELTİLDİ (commit f36dbeb, cc0afba)
Regresyon + çekirdek AI pipeline + guardrail + raporlar. **Kendi düzeltmelerimde kritik
regresyon YOK** (sadece 1 low: profile.tsx KVKK try/catch — düzeltildi).
- **GÜVENLİK (kritik):** Acil durum + yeme bozukluğu taraması artık prompt-injection ve
  rate-limit'ten ÖNCE çalışıyor → kriz mesajı her zaman 112/yönlendirme alır. **Canlı
  doğrulandı: "kendime zarar vermek istiyorum" → 200, task_mode 'safety', OpenAI kapalı
  olmasına rağmen Türkiye kriz hattı mesajı döndü.** (En kritik akış artık LLM'siz de çalışıyor.)
- workout_log artık başarısız insert'te "Antrenman kaydedildi" yalanı atmıyor + enum whitelist.
- save_recipe/supplement_log/commitment NOT NULL guard + hata kontrolü.
- weight/water/sleep/mood geçersiz-değer feedback hizası düzeltildi.
- ai-proactive atıştırma tespiti (phantom created_at → logged_at + saat dilimi).
- Sakatlık filtresine Türkçe egzersiz adları; deniz ürünleri/kabuklu alerjen kategorileri.
- Hafıza kalitesi: alkol/sosyal sinyaller çift-yazım giderildi, raw JSON parse-back.
- Aylık rapor "Ort. Uyum" 0 yerine daily_reports fallback; Cuma artık hafta sonu sayılmıyor.
- **Ertelenenler (riskli/büyük, OpenAI kapalıyken test edilemez):** R2-3 offline kuyruk
  bağlama, R2-9 şüpheli-kilo onayı, R2-17/18/19 (low).

### Tur 3 — UI/UX + akış denetimi (çalışıyor)
Ekran durumları (loading/empty/error), navigasyon, safe-area/klavye, görsel tutarlılık +
kalan notlar (#3 chat-arası bağlam, #11 biten görevler, #12 boş hafıza). Sonuçlar eklenecek.

---

## Notlarının durumu (12 madde)
| # | Not | Durum |
|---|-----|-------|
| 1 | Yaş düzeltme alınmıyor | Prompt düzeltildi (düzeltme=zorunlu yeniden kaydet) — canlı doğrulama bekliyor |
| 2 | Motivasyon her chatte soruluyor | Prompt: kayıt zorunlu, yoksa tekrar sorar — canlı doğrulama bekliyor |
| 3 | Chat-arası bağlam taşınmıyor | Tur 3 inceliyor |
| 4 | Onboarding ilerlemesi görünmüyor | ✅ "Profilini tamamla X/13" + ilerleme çubuğu |
| 5 | Aynı şeyleri tekrar soruyor | Prompt güçlendirildi (kök neden: kayıt güvenilirliği) — canlı doğrulama bekliyor |
| 6 | Kartlar ana sayfada görünmüyor | ✅ 0 oturumda da görünüyor artık |
| 7 | "Neden bu öneri" yeni mesaj atıyor | ✅ Artık inline düşünce-akışı (ChatGPT tarzı) + prompt |
| 8 | Chat→chat yeni sekme gibi | ✅ router.replace |
| 9 | Alakasız örnek başlangıçlar | ✅ Görev sohbetlerinde gizlendi |
| 10 | Mutfak aletlerini tek tek soruyor | Prompt: pasif öğren, sayma — canlı doğrulama bekliyor |
| 11 | Biten görevler düşmüyor | Altyapı var + focus-refresh; Tur 3 derinleştiriyor |
| 12 | Hafıza alanları boş | L2 plumbing + tdee_notes yazıcı; Tur 3 derinleştiriyor |

> **Not:** "canlı doğrulama bekliyor" maddeleri LLM davranışı — OpenAI anahtarı gelince
> test edilmeli (aşağıdaki test senaryosuyla).

---

## 🧪 OpenAI anahtarı geldikten sonra TEST SENARYOSU

Test hesabı: **kochko.uitest@gmail.com** / şifre **Kochko!Test2026** (premium, onboarded, gerçek verili).

1. **Sohbet temel:** "merhaba" yaz → Türkçe yanıt gelmeli (500 değil).
2. **Düzeltme (#1):** "32 yaşındayım" sonra "yok 30 yaşındayım" → ikinci değer kaydedilmeli
   (Profil/Ayarlar'da yaş 30 görünmeli).
3. **Tekrar sorma (#2/#5):** Motivasyonunu söyle → yeni sohbette tekrar SORMAMALI.
4. **Neden butonu (#7):** Bir öneri al, "Neden bu öneriyi yaptım?" butonuna bas →
   chate yeni mesaj ATMADAN, mesajın altında düşünce akışı açılmalı.
5. **Chat geçişi (#8):** Bir görevi bitir, "sıradaki konu" kartına bas → yeni sohbet açılır;
   geri bas → sohbet LİSTESİNE dönmeli (eski sohbete değil).
6. **Görev kartları (#6):** Ana Kochko (chat) sekmesi → "Profilini tamamla X/13" + kartlar görünmeli.
7. **Öneriler (#9):** Bir görev kartına bas → AI soru sorar, altta alakasız "2 yumurta yedim"
   örnekleri GÖRÜNMEMELI.
8. **Plan (#5 P0):** Plan sekmesi → "Plan oluştur" → diyet/antrenman taslağı gelmeli;
   onayla → aktif plan; revize et → güncellenmeli.
9. **Kayıt:** "2 yumurta yedim" → öğün kaydı; "10 km koştum" → antrenman; tartı, su, uyku.
10. **Guardrail:** Alerjini söyle (ör. "deniz ürünleri alerjim var") → plan/öneride karides olmamalı.
11. **Rapor:** Günlük/haftalık/aylık rapor üret → gerçek sayılar (0 değil).
12. **Hafıza (#12):** Birkaç sohbetten sonra Ayarlar → Koç Hafızası → alanlar dolmaya başlamalı.

Beklenmeyen bir 500 görürsen: `node TEMP/kk.mjs login kochko.uitest@gmail.com 'Kochko!Test2026'`
sonra `node TEMP/kk.mjs chat "test"` ile ham hatayı görebilirsin.
