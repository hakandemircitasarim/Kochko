# Güvenlik / Gizlilik Tasarım Kararları — 2026-06-21

Audit 2026-06-21'in (KAPSAMLI_AUDIT_2026-06-21.md) **mimari** nitelikli MEDIUM bulguları. Bunlar
kod-cilası değil tasarım kararı gerektirir; yarım bir teknik düzeltme sahte güvence verir.
Aşağıda her biri için **mevcut durum + risk + önerilen remediation** açıkça karara bağlanmıştır.

---

## DB-PRV-03 (MEDIUM) — Özel-nitelikli sağlık verisi düz-metin
**Durum:** `health_events.description/event_type` ve `lab_values` KVKK "özel nitelikli kişisel
veri" / GDPR Art.9 kategorisindedir ve migration 069 inert pgsodium scaffolding'ini kaldırdıktan
sonra **düz-metin** saklanır. Koruma şu an: Supabase at-rest disk şifrelemesi + RLS (kullanıcı
yalnız kendi satırını okur; service_role edge fonksiyonları erişir).

**Karar (kabul edilen risk — V1 için):** At-rest disk şifrelemesi + RLS, V1 tehdit modeli için
yeterli kabul edilmiştir. Uygulama/kolon-seviyesi şifreleme V1'de UYGULANMAYACAKTIR çünkü:
- AI koçluğu bu alanları her turda okumak zorundadır (sakatlık/hastalık bağlamı guardrail'ler
  için kritik) → envelope encryption her edge çağrısında decrypt gerektirir (gecikme + anahtar
  yönetimi karmaşası).
- KMS-tutulan anahtar + envelope encryption ayrı bir altyapı projesidir, bir audit-fix değil.

**Remediation (V2 / pazar genişlemesi öncesi):** `health_events.description/event_type` ve
`lab_values` için KMS-tutulan anahtarla envelope encryption; decrypt yalnız ihtiyaç duyan edge
fonksiyonunda. DPIA dokümanına işlenmeli. **Bu, KVKK VERBİS kaydı öncesi tekrar değerlendirilmeli.**

---

## DB-PRV-02 (MEDIUM) — Kullanıcı kendi audit_logs satırını uydurabilir
**Durum:** `audit_logs_insert_own` policy'si `WITH CHECK (auth.uid()=user_id)` ile public INSERT'e
izin verir (istemci KVKK olaylarını privacy.service/audit-log.service'ten yazar). Kullanıcı BAŞKASI
için yazamaz (403) ve UPDATE/DELETE edemez (doğrulandı) — yani iz **silinemez/değiştirilemez** ama
kendi adına **uydurulabilir** (ör. gerçekleşmemiş bir 'data_export' satırı). Bu, iz'in "ne oldu"nun
güvenilir kanıtı olmasını zayıflatır.

**Etkinin sınırı:** Kullanıcı yalnızca KENDİ izini kirletebilir; başka kullanıcının izini değil.
Silme/değiştirme zaten engelli. Gerçek-dünya istismarı düşük (kendi audit trail'ini şişirmek).

**Karar:** Tam çözüm (iz'i yalnız sunucu-yazımlı yapmak) mimari bir değişikliktir: client-başlatımlı
aksiyonların (özellikle client-tarafı üretilen `data_export`) sunucu tarafına taşınmasını gerektirir.
V1 kapsamında YAPILMAYACAK; bunun yerine:

**Remediation (önerilen, V2):**
1. Kanıt-niteliğindeki olayları (`account_delete_request/cancel`, `data_export`, `ai_summary_delete`)
   eylemi GERÇEKTEN yapan SECURITY DEFINER RPC / edge fonksiyonu içinde service_role ile yaz
   (satır ancak eylem olduysa oluşur → güvenilir).
2. Public `audit_logs` INSERT policy'sini kaldır (ya da kanıt-niteliğinde-olmayan event_type'lara
   kısıtla). UPDATE/DELETE yokluğu zaten doğru.

> Not: 077 migration'ı `promote_weekly_plan`'ı user-scope'ladı, 072 SECURITY DEFINER RPC'lerden
> PUBLIC/anon EXECUTE'u kaldırdı — audit yazımı için de aynı "yalnız sunucu" deseni izlenmeli.

---

## DB-MIG-04 (LOW) — Cron topoloji drift'i
**Durum:** Migration 056 belgeleri canlı cron'un elle-yamalı olduğunu söyler; deklare topoloji ile
canlı ayrışmıştı.
**Karar/aksiyon:** **Migration 077 (DB-MIG-01)** ile 014'ün 3 öksüz proaktif job'ı koşullu
unschedule edildi → temiz reset artık tek `kochko-proactive-hourly`'ye yakınsar (canlıda zaten
öyleydi). `CRON_SECRET` GUC'u (`app.settings.cron_secret`) operasyonel bir adımdır; cron-auth.ts
artık fail-CLOSED (AI-PRO-04) olduğundan secret set olmasa bile fleet abuse service-role-key
fallback'iyle engellenir. **Kalan operasyonel adım:** prod'da `ALTER DATABASE postgres SET
app.settings.cron_secret = '<secret>'` (opsiyonel sertleştirme; fail-closed zaten koruyor).
