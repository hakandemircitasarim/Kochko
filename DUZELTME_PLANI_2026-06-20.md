# KOCHKO — Somut Düzeltme Planı (UI · UX · DB · AI)

> 2026-06-20 — [KAPSAMLI_AUDIT_2026-06-20.md](KAPSAMLI_AUDIT_2026-06-20.md) bulgularına dayalı yürütme planı. Çoklu-ajan: **8 planlayıcı (boyut × P0/kalan) + 1 sıralayıcı + 1 düşmanca plan-kritiği**. Planlayıcılar her bulgunun kök-nedenini GERÇEK kaynağı açarak (DB için canlı `q.mjs` ile) teyit etti. Toplam **130 düzeltme kartı + 13 toplu-süpürme**, **21 yeni migration**, **8 dalga**.

## ⛔ v2 — Kritik Denetim Düzeltmeleri (ÖNCE BUNU OKU)

Düşmanca plan-kritiği, sıralayıcının planında **3 bloke-edici** + birkaç eksik yakaladı. Bu bölüm aşağıdaki "Yönetici Yürütme Planı"nı **ezer/düzeltir**; plan bunlar giderilmeden yürütülmemeli. (Kritiğin tam dökümü için → "🔎 Düşmanca Plan Denetimi" bölümü.)

### Düzeltme 1 — Gerçek P0 yalnız 5 madde (kapsam daraltma)

Sıralayıcı, Wave 0–3'ün **tamamını** `P0` etiketledi; bu yanlış ve gerçek lansman-engelleyicileri geciktirir. Lansman-engelleyici GERÇEK P0 tam olarak şunlardır:

1. **Premium self-grant** (trial INSERT `trial_used` kontrolü yapmıyor) — `mig 051`
2. **Weight-corruption** (aşağıdaki yeni kart — plandan düşmüştü) — `ai-chat/index.ts`
3. **Legacy ai-plan'in chat-onaylı diyeti ezmesi** (CRITICAL) — `mig 053` + `ai-plan/index.ts`
4. **Alerjen + intihar/kriz güvenlik-ağı boşlukları** — `guardrails.ts` + `ai-chat`
5. **Çok-adımlı yazım → atomik RPC** (transaction'sız delete/deactivate-then-insert) — `mig 055`

> **Tek istisna:** "Migration drift baseline + `schema_migrations` repair" (Wave 0) bir P0 *teknik ön-koşuludur* — diğer tüm yeni migration'lar buna dayandığı için EN ÖNCE kalır. Geri kalan Wave 0/2/3 işleri (OAuth birth_year, settings IA, sonsuz-spinner, retrieval taskMode, week_start TZ, save-guard'lar) **P1**'dir.

### Düzeltme 2 — Weight-corruption P0 fix kartı (plandan düşmüştü)

Bu, audit'in **#1 KRİTİK** çapraz-kesit riskiydi ama AI boyut-bölümünde ayrı bir bulgu kartı olmadığı için (oradaki CRITICAL = legacy ai-plan ezme) hiçbir planlayıcı kart üretmedi. Aşağıdaki kart bu boşluğu kapatır.

#### 🔴 CRITICAL — Egzersiz ağırlığı vücut ağırlığı sanılıp `profiles.weight_kg` sessizce eziliyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts` (567–582 merge bloğu + `executeActions` weight_kg yazım noktası) · `extractProfileFromMessage` tanımı (aynı dosya veya `shared/`)
- **Efor:** Orta · **Risk:** orta · **Migration gerekli:** hayır · **Dalga:** Wave 1 (P0)
- **Kök-neden:** `index.ts:558-560` yorumu riski açıkça kabul ediyor. Regex bodyweight çıkarımı **onboarding'de FULL** (safe-subset KAPALI: `fullExtraction=true → extractProfileFromMessage(..., safeSubset=false)`), bu yüzden onboarding sohbetinde "4x8 bench press 70 kg" gibi bir ifadenin bare "NN kg" eşleşmesi bodyweight sanılıp `weight_kg`'a yazılabilir. Ayrıca **modelin kendi `<actions>` `profile_update`'i** `weight_kg`'ı egzersiz bağlamından türetirse hiçbir doğrulama yok — regex safe-subset bunu yakalamaz.
- **Düzeltme (iki katmanlı, regex + model tek yoldan):**
  1. Bodyweight eşleşmesini KABUL ETMEDEN ÖNCE **egzersiz-bağlamı tara**; varsa `weight_kg`'ı atla (onboarding dahil). Yalnız **açık bodyweight ifadesi** varsa kabul et.
  2. `executeActions` `weight_kg` yazımından ÖNCE ortak doğrulama: makul aralık (30–300 kg) + aynı egzersiz-bağlam taraması; ihlalde `weight_kg`'ı action'dan düş ve uyar. Hem regex hem model action'ı bu tek kapıdan geçsin.

```ts
const EXERCISE_CTX = /\b(bench|squat|deadlift|press|lat|biceps|triceps|halter|dumbbell|barbell|set|tekrar|rep|\d+\s*[x×]\s*\d+|kaldır|antren|squat|deadlift)/i;
const BODYWEIGHT_CUE = /(kilom|ağırlığım|tartı|kg\s*(oldum|geldim|düştüm|çıktım)|vücut\s*ağırlığ)/i;
const plausibleBW = (kg) => typeof kg === 'number' && kg >= 30 && kg <= 300;

function guardWeight(act, message) {
  if (act?.weight_kg == null) return;
  const ambiguous = EXERCISE_CTX.test(message) && !BODYWEIGHT_CUE.test(message);
  if (ambiguous || !plausibleBW(act.weight_kg)) {
    console.warn('[weight_guard] dropped ambiguous/implausible weight_kg', { weight_kg: act.weight_kg, mode: effectiveMode });
    delete act.weight_kg;
  }
}
// regex merge sonrası VE model profile_update için, executeActions'tan ÖNCE:
const pa = actions.find(a => a.type === 'profile_update');
if (pa) guardWeight(pa, message ?? '');
```
- **Doğrulama:** `npx tsc --noEmit`. Canlı (`node TEMP/kk.mjs login ...`):
  - Onboarding modunda "4x8 bench press 70 kg yaptım" → `q.mjs` ile `SELECT weight_kg FROM profiles WHERE id=...` **DEĞİŞMEMELİ**.
  - "kilom 82 oldu" → `weight_kg=82` persist etmeli.
  - "antrenmanda 100 kg squat" → değişmemeli. "tartıda 500 kg" gibi makul-dışı → reddedilmeli.

### Düzeltme 3 — Tek kanonik migration numaralandırması

Aşağıdaki **"🗄️ Migration Sırası (051+)" tablosu TEK kaynaktır.** Boyut kartlarının içindeki satır-içi migration numaraları (PLAN ÖZETİ kaynaklı; ör. DB kartlarındaki `051=atomic...`) **ESKİDİR — yok say.** Ayrıca:

- **Kesirli adlar (`039a_*`, `036b_*`) Supabase CLI ile riskli** (leksikografik sıralama + `0036b` sıfır-padding tuzağı). Çözüm: bu iki baseline'ı **gerçek zaman-damgalı** (veya artan tamsayı) adlarla **yeni en-son slotlara** koy; tablolar/kolonlar canlıda zaten elle mevcut olduğu için `CREATE TABLE/COLUMN IF NOT EXISTS` **no-op** olur ve mantıksal sıra önemini yitirir. (Alternatif: baseline'ı `051`'in içine al → `051_baseline_and_trial`.)
- **037–050'yi "idempotent yapma + repair" YAPMA:** bu dosyaların içeriğini değiştirmek Supabase CLI'da **checksum drift** verir. İçeriği DEĞİŞTİRME; sadece `supabase migration repair --status applied 037..050` ile kaydet. Idempotency disiplini yalnız **YENİ** migration'larda uygulanır. Sonra `supabase db push --dry-run` diff'in **boş** döndüğünü teyit et.

### Düzeltme 4 — Atanmamış bulguların dalga ataması

| Bulgu | Boyut/Şiddet | Atama |
|-------|:---:|------|
| TempoChart x-ekseni hizası (`src/components/plan/TempoChart.tsx`) | UI/HIGH | UI chart dalgası — progress.tsx chart fix ile **farklı dosya**, paralel-güvenli ayrı batch |
| Ölü deneme-bitiş hatırlatması (`notifications.service.ts:421/445`, `scheduleTrialReminder !== 2` bug) | UX/HIGH (gelir) | Wave 1 (P0-bitişik) **veya** P1 `dashboard-premium` batch |
| ProfileCompletionDonut çelişkisi (13-görev vs 24-alan) | UX/MEDIUM | P1 `profile` batch |
| Üç offline-banner üst üste + deneme-geri-sayımı dashboard'da yüzeye çıkmıyor | UX/MEDIUM | P2 `dashboard-cila` batch (`index.tsx`/`HeroSection`/`usePremium`/`OfflineBanner`) |
| `lab-values.tsx` sayısal doğrulama (inline-validation-sweep kapsamadı) | UX/MEDIUM | Wave 3 `misc-ux-screens` batch'ine açıkça dahil et |

### Düzeltme 5 — Sertleştirilmiş doğrulamalar (kritiğin eksik bulduğu)

- **Premium self-grant:** client gate'i değil, **ham PostgREST** ile bypass denenmeli → `node TEMP/kk.mjs rest POST subscriptions '{"tier":"lifetime","status":"active","expires_at":"2099-01-01"}'` **403/42501** dönmeli; ayrıca expired-trial sonrası 2. trial INSERT reddedilmeli.
- **Cron-secret:** negatif test zorunlu — `CRON_SECRET` set + header **YOK** → **401**; header **VAR** → **200**. Hem `014` (proactive/report) hem `022` (scheduled_cleanups) kapsanmalı.
- **Yarış-durumu** (atomik append `behavioral_patterns`; `approveDraft` 0-aktif): tek-thread smoke yetmez — **eşzamanlı çift-tetik** ile lost-update / `uniq_active_plan_per_type` (23505) simüle et.
- **OAuth birth_year:** Google **ve** Apple ayrı yollar; "metadata.birth_year yoksa koşullu alan gösterilir" + "introduce_yourself görevi tamamlanır" + "plan-readiness bloğu kalkar" — üçü ayrı doğrulanmalı.
- **Index DROP (060):** DROP'tan ÖNCE `pg_stat_user_indexes.idx_scan = 0` ile gerçekten kullanılmadığını teyit et.
- **053 weekly_menu izolasyon:** şema izolasyonu yetmez — hâlihazırda legacy menü tarafından **bozulmuş satırlar** için veri-onarım/backfill adımı + migration öncesi dry-run **etki-sayımı** ekle.

---


## 🗺️ Yönetici Yürütme Planı
## KOCHKO 2026-06-20 Audit — Tek Yürütme Planı

4 boyut (UI / UX / DB / AI) tek akışa dizildi. Öncelik dalgaları **P0 (pazar-engelleyici / güvenlik / veri-bütünlüğü) → P1 (önemli) → P2 (cila)**. Her dalga içinde **aynı dosyaya dokunan işler asla farklı batch'lere bölünmedi**; bir dalganın `parallelBatches` listesindeki batch'ler eşzamanlı çalışabilir (dosya çakışması yok).

> KURAL: Migration'lar 051'den başlar — **tek istisna household baseline** (Wave 0 / risks). Edge function değişiklikleri bittiğinde `supabase functions deploy` gerekir; migration'lar `supabase db push` ile gider.

---

### Wave 0 — Migration Drift & Baseline Onarımı (P0, EN ÖNCE)
**Hedef:** Sonraki tüm DB dalgalarının üzerine kurulacağı zemini sağlamlaştır. `households / household_members / coach_consents` hiçbir migration'da CREATE edilmiyor (doğrulandı: yalnızca 018/040/043/050 REFERANS veriyor, CREATE yok) ve 040+ bunlara dayanıyor; 037–050 schema_migrations'a kayıtlı değil. Bu dalga TEK BAŞINA koşar — diğer DB dalgaları buna bağımlı.

**Bulgular:** DB-P0 household-baseline, DB chat-fk, DB ai_summary baseline, DB migration-idempotency-repair.

**Migration'lar:** 039a_baseline_household_coach_tables (IF NOT EXISTS, 040'tan ÖNCE), 036b_ai_summary_phantom_columns (learned_meal_times), 052_chat_messages_session_fk, + 037–050 idempotent yapma & schema_migrations repair script'i.

**Paralel batch:** Tek batch (db-baseline). Hepsi migration zinciri / schema_migrations durumuna dokunduğu için BÖLÜNEMEZ.

**DoD / regresyon:** `supabase db reset` temiz şemadan sıfır hata ile koşar; canlı schema_migrations 037–050 + yeni baseline'ları içerir; FK ihlali test: yetim chat_messages INSERT reddedilir.

---

### Wave 1 — Güvenlik & Para/Veri-Bütünlüğü (P0)
**Hedef:** Pazar-engelleyici güvenlik açıkları + para sızıntıları + veri kaybı.

**Bulgular:** DB sınırsız-trial self-grant; AI rate-limit "register" baypası; AI cron x-cron-secret eksik (CRON_SECRET tanımlanırsa tüm proaktif sistem 401); AI alerjen tarama (TR çekim + EN) kaçırma; AI alerjen çıkış-uyarısı yanlış-bastırma; AI intihar/kriz TR ifade kaçırma; AI weekly_plans EZME (legacy ai-plan aktif diyeti uyumsuz şekille eziyor); AI atomik plan/hedef yazımı; UX trial bitiş hatırlatması ölü kod.

**Paralel batch'ler (dosya çakışması yok):**
- `db-subscriptions-trial` (051 trial self-grant RPC + subscription.service.ts)
- `ai-chat-core-security` (ai-chat/index.ts: rate-limit register baypası + alerjen çıkış-uyarı + weekly_plans izolasyon + atomik yazım çağrı noktaları — TEK batch çünkü hepsi ai-chat/index.ts'e dokunuyor)
- `ai-guardrails` (shared/guardrails.ts: alerjen tarama + kriz tespiti + rate-limit.ts — ai-chat/index.ts'e DOKUNMAZ, ayrı dosya)
- `cron-secret` (014/022 + yeni cron_secret_header migration + cron-auth)
- `weekly-plans-isolation-migration` (yeni migration + ai-plan/index.ts + plan-projection.ts + task-modes.ts)

DİKKAT: `ai-chat-core-security` ve `weekly-plans-isolation` ile `atomic-writes` ÜÇÜ DE ai-chat/index.ts'e dokunabilir — bunları TEK seri batch `ai-chat-index-p0` altında birleştir (içeride sıra: weekly-plans izolasyon → rate-limit → alerjen → atomik). guardrails/rate-limit.ts/subscription/cron ayrı dosya olduğu için paralel.

**DoD / regresyon:** Trial 2. kez self-grant reddedilir; "register" mesajı limit tüketir; CRON_SECRET set iken cron 200 döner; "yer fıstığı"/"peanut" alerjen yakalanır; TR intihar ifadesi kriz hattı tetikler; legacy haftalık menü aktif chat planını EZMEZ; plan yazımı yarıda kesilince eski plan ayakta kalır.

---

### Wave 2 — AI Doğruluk & Bellek Bütünlüğü (P0/P1)
**Hedef:** Yanlış yönlendirme / sızıntı / lost-update.

**Bulgular:** AI retrieval-planner yanlış taskMode (daily_log/plan_diet/plan_workout erişilemiyor); onboarding öğün/antrenman güvenlik-ağına takılmıyor; <simulation> extractor yok (JSON sızıyor); extractActions yalnız ilk blok; learned_tone 3 farklı kelime dağarcığı; behavioral_patterns yarış-durumu (atomik append ölü); haftalık rapor cron tetiklenmiyor; servis bağlamları UTC "bugün"; week_start TZ ayrışması; L2 atomik merge birleştirme (ai-extractor general_summary bypass + micro_nutrient_risks).

**Paralel batch'ler:**
- `ai-chat-index-routing` (ai-chat/index.ts: retrieval taskMode + onboarding safety-net + simulation/actions extractor — TEK batch, hepsi ai-chat/index.ts)
- `ai-memory` (shared/memory.ts + repair-handler.ts: learned_tone + atomik append) — ai-chat/index.ts'e dokunmaz
- `ai-proactive` (ai-proactive/index.ts: haftalık rapor tetik)
- `ai-service-contexts` (shared/service-contexts.ts gün-sınırı) — ai-chat tarafı index-routing batch'ine ait, çakışma için service-contexts.ts'i ayrı, ai-chat dokunuşunu routing batch'ine bağla
- `week-start-tz` (src/services/weekly-plan.service.ts + ai-plan/index.ts)
- `l2-atomic-merge-migration` (055 atomik merge + ai-extractor/index.ts + context-builders.ts)

DİKKAT: memory.ts hem `ai-memory` (tone+patterns) hem `l2-atomic` (micro_nutrient_risks) tarafından isteniyor → memory.ts'i TEK batch `ai-memory` altında topla; l2-atomic yalnız ai-extractor + context-builders + migration'a dokunsun.

**DoD / regresyon:** "bugün ne yedim" daily_log planına ulaşır; onboarding'de bildirilen öğün loglanır; <simulation>/2. <actions> bloğu metne sızmaz; eşzamanlı 2 mesaj behavioral_patterns'i kaybetmez; haftalık rapor cron'da üretilir; servis bağlamı gün-sınırını onurlar; üretilen haftalık menü ekranda görünür; L2 yazımları lost-update yapmaz.

---

### Wave 3 — UX Akış Tıkanıkları (P0/P1)
**Hedef:** Kullanıcının takıldığı / veri kaybettiği akışlar.

**Bulgular:** Plan ekranları sonsuz spinner + chatSessionId rehidrasyon + draft INSERT unique ihlali (diet.tsx/workout.tsx); OAuth birth_year toplanmıyor (onboarding.tsx); menstrual/goals Kaydet guard yok; profile.tsx settings hub keşfedilemez IA; chat sayaç chip/foto baypas + data.remaining tüketilmiyor + premium_expires_at onurlanmıyor + prefill geri-tuş + reopenSession; strength.tsx loading/.catch; lab-values KAV + sayısal doğrulama; log.tsx uyku TextInput→DateTimeField; ham hata mesajı sweep; deleteSession hata yutma.

**Paralel batch'ler:**
- `plan-screens` (app/plan/diet.tsx + workout.tsx) — spinner+rehidrasyon+draft, hepsi bu iki dosya
- `onboarding-birthyear` (app/onboarding.tsx)
- `settings-save-guards` (app/settings/menstrual.tsx + goals.tsx) — UI diakritik sweep menstrual'a da dokunur, sıralamada dikkat (risks)
- `profile-ia` (app/(tabs)/profile.tsx) — UI ui-profile + UX hesap-silme aynı dosya → TEK batch, UX bu dalgada, UI Card extraction Wave 4'e ERTELE
- `chat-screen+service` (app/chat/[sessionId].tsx + src/services/chat.service.ts + message-counter.service.ts + premium-gate.ts)
- `chat-tab` (app/(tabs)/chat.tsx) — chat-screen ile prefill geri-tuş paylaşır; chat.tsx tek dokunan bu batch, [sessionId].tsx chat-screen batch'inde → ÇAKIŞMA YOK
- `misc-ux-screens` (strength.tsx + lab-values.tsx + log.tsx) — üçü ayrı dosya
- `error-messages-sweep` (src/lib/error-messages.ts + account-security.tsx + food-preferences.tsx) — chat.tsx'e dokunma (chat-tab batch'inde halledilir)

DİKKAT: app/(tabs)/chat.tsx hem `chat-tab` hem `error-messages-sweep`'te listeli → error sweep'in chat.tsx dokunuşunu chat-tab batch'ine taşı.

**DoD / regresyon:** Plan ekranı ağ hatasında retry gösterir; OAuth kullanıcı birth_year girer, TDEE doğru; menstrual/goals çift-gönderim olmaz; settings hub keşfedilebilir; chip/foto turu sayaç tüketir; geri-tuş oturum listesine döner; uyku DateTimeField; ham İngilizce hata görünmez.

---

### Wave 4 — UI Erişilebilirlik & Tutarlılık (P1)
**Hedef:** A11y + paylaşılan primitive yakınsama.

**Bulgular:** Button a11y prop yok + sm 32dp; yıkıcı silme long-press-only (6 dosya + sweep); progress/tempo chart x-ekseni hizası; settings duplicate-title (28 dosya); accent-contrast (#fff WCAG); ToggleRow switch rolü/birleştirme; chip selected state; tab header birleştirme; ErrorBoundary tema; Card primitive profile; PhaseTimeline/InsightCard palet; coach-memory 3 isim.

**Paralel batch'ler:**
- `ui-button-primitive` (src/components/ui/Button.tsx) — Wave 4'ün ÖNKOŞULU (EmptyState/diğerleri dependsOn)
- `ui-destructive-delete` (venues/multi-phase-goals/progress-photos/health-events/coach-memory + InsightCard) — KVKW+a11y silme
- `ui-charts` (progress.tsx chart + TempoChart.tsx) — iki ayrı dosya, ayn ı chart-kit fix
- `ui-settings-duplicate-title` (28 settings dosyası) — duplicate-title; coach-memory/strength/menstrual İSİM çelişkisi de burada (dependsOn ui-title-naming → aynı batch)
- `ui-shared-controls` (ToggleRow + notifications/if-settings/coach-sharing toggle + accessibility.ts) — ToggleRow a11y+boyut
- `ui-accent-theme` (StreakBadge/OfflineBanner/PhaseTimeline/ErrorBoundary/InsightCard + theme.ts) — accent-contrast+ErrorBoundary+palet, theme.ts TEK yazıcı bu batch
- `ui-tab-headers` (progress.tsx header + profile.tsx + HeroSection + ScreenHeader)

DİKKAT: progress.tsx hem `ui-charts` hem `ui-tab-headers`'ta → progress.tsx'i TEK batch'e koy (öner: tab-headers); chart fix'i o batch'e dahil et. profile.tsx Wave 3'te değişti (IA) → Wave 4'te yalnız Card extraction, seri olmalı (dependsOn Wave3). InsightCard hem destructive-delete hem accent-theme → tek batch (accent-theme), silme dokunuşunu destructive-delete'ten çıkar.

**DoD / regresyon:** TalkBack ile sil butonu erişilebilir; native header + gövde H1 tek başlık; chart etiketleri hizalı; tüm aksanlar #fff yerine getContrastColor; toggle "switch" rolü bildirir.

---

### Wave 5 — DB Performans, RPC Atomikliği & Tip Hizalama (P1)
**Hedef:** N+1, index, RPC atomik, database.ts drift.

**Bulgular:** loadChatHistory/loadSessionMessages yanlış sıra + N+1 (chat.service.ts); approveDraft archive→promote atomik değil (plan.service.ts); atomik plan/hedef RPC (051, Wave1 ile koordine); cron reconcile (052/059); chat session trigger consolidation (053); pgsodium cleanup (054); meal_logs index (055-perf); coach N+1 (coach-mode.service.ts); duplicate index drop (056); database.ts tip sweep; getCoachClients N+1.

**Paralel batch'ler:**
- `src-chat-service` (src/services/chat.service.ts) — sıra+N+1, Wave3 chat batch ile ÇAKIŞIR → bu işi Wave3 chat batch'ine TAŞI ya da Wave3 sonrası seri (risks)
- `rpc-atomic-migration` (051 atomic_plan_goal_writes + ai-chat/index.ts archive→promote) — Wave1 ai-chat batch ile koordine; ai-chat/index.ts'e ayrı turda dokun
- `plan-approval` (src/services/plan.service.ts) — ayrı dosya, paralel
- `index-cleanup` (056 drop duplicate/shadow + 062/066 add) — tek migration grubu
- `cron-trigger-migrations` (052 reconcile + 059 vault secrets) — Wave1 cron-secret ile koordine, ayrı turda
- `chat-triggers-migration` (053 consolidate)
- `pgsodium-cleanup` (054)
- `coach-mode-service` (src/services/coach-mode.service.ts + 057 coach RPC)
- `database-ts-types` (src/types/database.ts + privacy/recipes service) — tek dosya, paralel-güvenli

**DoD / regresyon:** Oturum listesi tek sorguda yüklenir; mesajlar doğru kronolojide; approveDraft yarışta 0-aktif bırakmaz; EXPLAIN meal_logs index kullanır; database.ts canlı şema ile typecheck PASS.

---

### Wave 6 — AI Cila & Sağlamlaştırma (P2)
**Hedef:** Düşük şiddetli AI/edge pürüzleri.

**Bulgular:** LLM timeout/AbortController; ham sağlayıcı hata sızıntısı; JSON-mode/temperature snapshot; Whisper URL hardcode; L2 metin token bütçesi; tdee_notes ölü; ai-report compliance/streak; nudge dailyLimit; handleUndo hard-delete; pregnancy kalori çelişki; meal-persist validateMealParse + clamp; prompt-injection TR; periodic chat bağlamı; ai-extractor toplu cila.

**Paralel batch'ler:**
- `ai-llm-fetch` (shared/openai.ts: timeout + hata sızıntısı) — diğer her şeyin ÖNKOŞULU (ai-extractor dependsOn)
- `ai-extractor-cleanup` (ai-extractor/index.ts + model-router) — openai.ts sonrası seri
- `ai-report` (ai-report/index.ts)
- `ai-proactive-polish` (ai-proactive/index.ts) — Wave2 ai-proactive ile ÇAKIŞIR → seri
- `periodic-config` (shared/periodic-config.ts + ai-plan/index.ts)
- `repair-handler` (shared/repair-handler.ts) — Wave2 ai-memory ile çakışmaz (farklı turda)
- `guardrails-text` (shared/guardrails.ts: sanitize kelime-sınırı + injection) — Wave1 guardrails ile ÇAKIŞIR → seri
- `ai-chat-meal-persist` (ai-chat/index.ts) — TÜM ai-chat/index.ts dokunuşları seri olmalı

**DoD / regresyon:** Asılı LLM isteği timeout ile düşer; ham sağlayıcı hatası sızmaz; ai-report değerleri deterministik; injection TR kalıbı bloklanır.

---

### Wave 7 — UI/UX Cila & Süpürmeler (P2)
**Hedef:** Diakritik, ölü kod, nit.

**Bulgular:** Türkçe diakritik geri-ekleme sweep (UI+UX); i18n.ts ölü kod; light-theme tokens; elevation; CircularProgress maxFontSize; EmptyState→Button; DateTimeField min/max; weight-chart renk tutarlılık; PhaseTimeline overflow; ölü dashboard prop'ları; a11y image label; RADIUS/SPACING nit; auth header; chat icon; haptics async; inline doğrulama sweep.

**Paralel batch'ler:**
- `diakritik-sweep` (data-import/venues/log/coach-mode.service/debug-mode/usePremium + UI ASCII ekranları) — Wave3/Wave4 ile aynı dosyalara dokunan kısımları EN SONA bırak (risks)
- `ui-theme-tokens` (theme.ts + constants.ts) — Wave4 ui-accent-theme theme.ts'e dokundu → SERİ
- `ui-small-primitives` (CircularProgress + EmptyState + DateTimeField) — EmptyState dependsOn Button (Wave4)
- `ui-misc-nit` (auth header login/register + chat icon + HeroSection/StatStrip dead props)
- `inline-validation-sweep` (log.tsx + menstrual + if-settings) — Wave3 log/menstrual sonrası SERİ
- `deadcode-cleanup` (i18n.ts + haptics.ts) — bağımsız

**DoD / regresyon:** Tüm görünür string tam diakritik; ölü kod kaldırıldı; manuel smoke test 4 sekme + plan + chat + onboarding PASS; tam regresyon (Wave 0–6 DoD'leri tekrar koşulur).

---

## Genel DoD
Her dalga sonunda: TypeScript typecheck PASS, edge deploy + `supabase db push` PASS, ilgili akışların manuel canlı smoke testi, ve bir önceki dalganın kritik DoD maddelerinin regresyon kontrolü. P0 dalgaları (0–3) ayrıca APK build + emulator deep-test gerektirir.

## 🌊 Dalga Özeti

| Dalga | Öncelik | Hedef | Doğrulama | Efor |
|-------|:-------:|-------|-----------|:----:|
| Wave 0 — Migration Drift & Baseline Onarımı | P0 | households/household_members/coach_consents baseline CREATE'i (040+ buna dayanıyor; canlıda elle açılmış, hiçbir migration'da CREATE yok — doğrulandı) + ai_summary phantom kolonlar + chat FK + 037–050 idempotent yapma & schema_migrations repair. Tüm sonraki DB dalgalarının zemini. | supabase db reset temiz şemadan sıfır hata; canlı schema_migrations 037–050 + baseline kayıtlı; yetim chat_messages INSERT FK ile reddedilir. | L |
| Wave 1 — Güvenlik & Para/Veri-Bütünlüğü | P0 | Sınırsız trial self-grant, rate-limit register baypası, cron x-cron-secret eksik, alerjen tarama/çıkış-uyarı, intihar/kriz tespiti, weekly_plans EZME, atomik plan yazımı. | Trial 2. self-grant red; register limit tüketir; CRON_SECRET set iken cron 200; yer fıstığı/peanut yakalanır; TR intihar→kriz hattı; legacy menü aktif planı ezmez; yarıda kesik plan yazımı eski planı korur. | XL |
| Wave 2 — AI Doğruluk & Bellek Bütünlüğü | P0 | Retrieval taskMode düzeltme, onboarding safety-net, simulation/2.actions extractor, learned_tone tekleme, behavioral_patterns atomik append, haftalık rapor cron tetik, servis bağlamı gün-sınırı, week_start TZ, L2 atomik merge. | 'bugün ne yedim' daily_log'a ulaşır; onboarding öğünü loglanır; simulation/2.actions sızmaz; eşzamanlı mesaj patterns kaybetmez; haftalık rapor cron'da üretilir; servis bağlamı gün-sınırı; üretilen menü ekranda görünür; L2 lost-update yok. | L |
| Wave 3 — UX Akış Tıkanıkları | P0 | Plan ekranı sonsuz spinner+rehidrasyon, OAuth birth_year, save guard'lar, settings IA, chat sayaç/premium/prefill/reopen, misc ekran loading/doğrulama, ham hata mesajı sweep. | Plan ekranı retry gösterir; OAuth birth_year→doğru TDEE; çift-gönderim yok; settings keşfedilebilir; chip/foto turu sayaç tüketir; geri-tuş oturum listesine döner; uyku DateTimeField; İngilizce ham hata yok. | L |
| Wave 4 — UI Erişilebilirlik & Tutarlılık | P1 | Button a11y+boyut, yıkıcı silme görünür+erişilebilir, chart x-ekseni hizası, settings duplicate-title (28 dosya)+isim çelişkisi, accent-contrast+ErrorBoundary+palet+theme.ts, paylaşılan toggle/chip a11y, tab header birleştirme, Card primitive. | TalkBack ile sil erişilebilir; tek başlık (native+gövde); chart etiketleri hizalı; aksanlarda getContrastColor; toggle 'switch' rolü; Card primitive paylaşılır. | L |
| Wave 5 — DB Performans, RPC Atomik & Tip Hizalama | P1 | approveDraft atomik, cron reconcile+vault, chat trigger consolidation, pgsodium cleanup, index temizlik+ekleme, coach N+1+RPC, database.ts tip drift, account-deletion safeguard, çeşitli RLS/CHECK/view dedup. | Oturum listesi tek sorgu; mesajlar doğru kronoloji; approveDraft yarışta 0-aktif bırakmaz; EXPLAIN index kullanır; typecheck PASS; geri-alınamaz silme audit'li. | XL |
| Wave 6 — AI Cila & Sağlamlaştırma | P2 | LLM timeout/AbortController, ham hata sızıntısı, JSON-mode/temperature, Whisper URL, L2 token bütçesi, ai-report compliance/streak, nudge dailyLimit, handleUndo soft-delete, pregnancy kalori, meal-persist validate+clamp, injection TR, periodic chat bağlamı, ai-extractor toplu. | Asılı LLM timeout ile düşer; ham sağlayıcı hatası sızmaz; ai-report deterministik; injection TR bloklanır; meal makro tutarlılık doğrulanır. | L |
| Wave 7 — UI/UX Cila & Süpürmeler | P2 | Türkçe diakritik geri-ekleme sweep, i18n.ts+haptics ölü kod, theme tokens (light/elevation/RADIUS/SPACING), CircularProgress/EmptyState/DateTimeField, weight-chart renk, dead props, auth/chat-icon nit, inline doğrulama sweep. | Tüm görünür string tam diakritik; ölü kod kaldırıldı; 4 sekme+plan+chat+onboarding smoke PASS; Wave0–6 kritik DoD regresyon tekrarı PASS. | M |

## 🗄️ Migration Sırası (051+)

| # | Migration | Amaç |
|:-:|-----------|------|
| 1 | `039a_baseline_household_coach_tables` | households/household_members/coach_consents tablolarını CREATE IF NOT EXISTS ile baseline'a ekle (040+ bunlara dayanıyor; canlıda elle açılmış, hiçbir migration'da CREATE yok). Mantıksal olarak 040'tan önce; idempotent. |
| 2 | `036b_ai_summary_phantom_columns` | ai_summary.learned_meal_times (+ diğer phantom kolonlar) ekle; ai_summary_merge referans veriyor ama hiçbir migration eklemiyor. Idempotent. |
| 3 | `051_trial_selfgrant_rpc` | Sınırsız ücretsiz premium açığını kapat: trial INSERT'i trial_used kontrolü yapan SECURITY DEFINER RPC'ye taşı, doğrudan INSERT politikasını kaldır. |
| 4 | `052_chat_messages_session_fk` | chat_messages.session_id için chat_sessions(id) ON DELETE CASCADE FK ekle (yetim mesaj riski). |
| 5 | `053_weekly_menu_isolation` | Legacy ai-plan haftalık menü yolu chat-onaylı aktif diyeti EZMESİN: weekly_plans/daily_plans şema izolasyonu + kaynak ayrımı kısıtları. |
| 6 | `054_cron_secret_header` | 014/022 cron HTTP çağrılarına x-cron-secret header ekle (CRON_SECRET set iken 401 ile sessiz ölümü önle). |
| 7 | `055_atomic_plan_goal_writes` | Plan/hedef ve weekly_plans archive→promote için atomik SECURITY DEFINER RPC (transaction'sız delete/deactivate-then-insert veri kaybını önle). |
| 8 | `056_ai_summary_atomic_merge` | L2 bellek yazımlarını (general_summary, micro_nutrient_risks, behavioral_patterns) lost-update'siz atomik ai_summary_merge yoluna birleştir; array vs obje merge düzelt. |
| 9 | `057_cron_reconcile_proactive_hourly` | 014'teki 3 proactive cron'u canlıdaki tek kochko-proactive-hourly ile uzlaştır (migration drift kapat). |
| 10 | `058_consolidate_chat_session_triggers` | chat_messages'taki çift trigger'ı tekle (her mesaj iki kez UPDATE) + eksik update_session_timestamp'i migration'a al. |
| 11 | `059_cleanup_inert_pgsodium` | Migration 025 inert pgsodium altyapısını temizle / düz-metin sağlık verisi durumunu belgele ve kaldır. |
| 12 | `060_drop_duplicate_indexes` | Tam-çift index'ler (5 tablo) + idx_daily_plans_user_date shadow index'i düşür (yazma maliyeti/disk). |
| 13 | `061_perf_and_fk_covering_indexes` | meal_logs(logged_at DESC) + coach_consents(coach_id,is_active) kısmi + FK kapsayıcı index'ler (households.owner_id, scheduled_cleanups.user_id, meal_logs.template_id, weekly_plans.superseded_by) ekle. |
| 14 | `062_coach_client_access_rpc` | Koç (B2B) rızalı danışan verisine erişim RPC'si (RLS katmanında ölü olan paylaşımı canlandır). |
| 15 | `063_account_deletion_audit_safeguards` | execute_pending_account_deletions için audit izi + iptal bayrağı + günlük üst-sınır (geri-alınamaz hard-delete güvenliği). |
| 16 | `064_cron_secrets_via_vault` | Cron job komutlarındaki düz-metin service_role JWT ve x-cron-secret'i Vault'tan çek (sır sızıntısı). |
| 17 | `065_household_members_policy_and_index_dedup` | household_members örtüşen SELECT politikalarını (hm_select_own vs Members can view members) ve iki örtüşen UNIQUE index'i tekle. |
| 18 | `066_barcode_view_security_invoker` | barcode_unfound_counts view'ını security_invoker=on yap + bypassrls postgres sahipliğini kaldır. |
| 19 | `067_enum_check_constraints` | ai_feedback.context_type ve profiles.periodic_state için DB CHECK kısıtları (yalnız TS'te enforce ediliyordu). |
| 20 | `068_audit_logs_policy_dedup` | audit_logs üzerindeki yinelenen SELECT politikalarını tekle. |
| 21 | `069_drop_dead_monthly_reports_columns` | monthly_reports mükerrer/ölü kolonları düşür (yazıcı yalnız kanonik adları dolduruyor). |

## ⚠️ Sıralama / Bağımlılık Riskleri
SIRALAMA/BAĞIMLILIK TEHLİKELERİ:

1) MIGRATION SIRALAMA ÇELİŞKİSİ (en kritik): household baseline mantıksal olarak 040'tan ÖNCE gelmeli ama 'yeniler 051'den başlar' kuralı var. Çözüm: 039a olarak yerleştir ve CREATE TABLE IF NOT EXISTS + tüm policy/index'leri idempotent yaz; canlı veritabanı tabloları zaten elle taşıdığı için 039a canlıda no-op olur, yalnızca temiz `db reset` ve schema_migrations bütünlüğü için gerekir. Bu yüzden Wave 0 schema_migrations repair ile birlikte ATOMİK yapılmalı — sıra bozulursa 040 RLS recursion fix bağımsız tabloya uygulanmaya çalışır.

2) AYNI DOSYAYA ÇOK-DALGA DOKUNUŞU — ai-chat/index.ts: P0 (rate-limit, alerjen, weekly-isolation, atomik), Wave2 (routing, safety-net, extractor), Wave5 (archive→promote), Wave6 (meal-persist). Bu dosya 4 dalgada geçiyor. KURAL: ai-chat/index.ts'e dokunan her batch SERİ olmalı; aynı dalga içinde tek batch'te topla, dalgalar arası ayrı turlarda uygula ve her turdan sonra deploy+regresyon.

3) guardrails.ts: Wave1 (alerjen+kriz, HIGH) ve Wave6 (sanitize kelime-sınırı + injection, MEDIUM/LOW). Aynı dosya → seri; Wave6 guardrails-text Wave1 guardrails tamamlanmadan başlamamalı.

4) memory.ts: Wave2'de hem learned_tone (tone) hem behavioral_patterns hem micro_nutrient_risks isteniyor. Üçünü tek ai-memory batch'inde topladık; l2-atomic batch'i memory.ts'e DOKUNMAMALI (yalnız ai-extractor + context-builders + migration).

5) theme.ts: Wave4 (accent-contrast/ErrorBoundary/palet) ve Wave7 (light tokens/elevation/RADIUS). Aynı dosya → Wave7 ui-theme-tokens Wave4 ui-accent-theme sonrası seri.

6) chat.service.ts: DB-P0'da (sıra+N+1) ve UX Wave3 chat batch'inde (reopen/delete). Aynı dosya → DB sıra/N+1 düzeltmesini Wave3 chat-screen+service batch'ine TAŞIDIK; Wave5'te chat.service.ts'e ayrıca dokunma.

7) progress.tsx: ui-charts (chart fix) + ui-tab-headers (header). Tek batch'e (tab-headers) birleştirildi.

8) profile.tsx: Wave3 (IA + hesap-silme, UX) ve Wave4 (Card primitive extraction, UI). Aynı dosya → Wave4 Card işi Wave3'e dependsOn, seri.

9) InsightCard.tsx: destructive-delete + accent-theme + palet + elevation. Tek batch (accent-theme) altında topla; destructive-delete batch'inden InsightCard'ı çıkar.

10) ai-plan/index.ts: weekly-isolation (Wave1), week-start-tz (Wave2), periodic-config (Wave6), atomik write (Wave5 dolaylı). Çok-dalga → her dalgada ayrı tur, seri.

11) ai-proactive/index.ts: Wave2 (haftalık rapor tetik) ve Wave6 (nudge dailyLimit + double-message + UTC report). Aynı dosya → Wave6 polish Wave2 sonrası seri.

12) Cron migration'ları: x-cron-secret header (054, Wave1) ÖNCE; reconcile (057) ve vault (064, Wave5) SONRA — vault Wave1 secret header'a dependsOn.

13) RPC atomik write migration'ı (055) hem Wave1 (plan ezme/atomik) hem Wave5 (approveDraft) tarafından kullanılır. Migration TEK kez Wave1'de yaz; Wave5 yalnız çağrı noktalarını (plan.service.ts, ai-chat archive→promote) bağlar.

14) database.ts: birden çok DB bulgusu (PlanStatus enum, Profile 27 kolon, AISummary, ChatSession/DailyMetrics/SavedRecipe). Tek batch (database-ts-types, Wave5); paralel-güvenli ama tek elden yapılmalı (çoklu editör çakışır).

15) Diakritik sweep (Wave7): log.tsx, menstrual.tsx, venues.tsx, data-import.tsx gibi dosyalar Wave1/3/4'te de değişiyor. Sweep'i EN SONA bırak ki önceki dalgaların eklediği yeni string'ler de aksanlı olsun; aksi halde sweep'ten sonra eklenen ASCII string'ler kaçar.

DİKKAT NOKTALARI: (a) Her edge-function dalgasından sonra `supabase functions deploy` + canlı smoke; migration dalgalarından sonra `supabase db push`. (b) Push yalnız PowerShell tool üzerinden (Bash GCM'e erişemiyor — MEMORY notu). (c) Git identity hakandemircitasarim, repo-local. (d) P0 dalgaları (0–3) APK build + emulator deep-test gerektirir; P1/P2 typecheck+smoke yeterli. (e) account-deletion safeguard (063) ve cron vault (064) risk=high — staging'de önce dene, geri-alma planı hazır olsun. (f) weekly_plans izolasyonu (053) risk=high ve canlı kullanıcı planlarına dokunuyor — migration öncesi yedek + dry-run SELECT ile etki sayımı.

## 🔎 Düşmanca Plan Denetimi

**Genel hüküm:** "Plan iyi-yapılandırılmış ve aynı-dosya çok-dalga çakışmalarını (ai-chat/index.ts 4 dalga, guardrails.ts, memory.ts, theme.ts, ai-plan/index.ts, profile.tsx, chat.service.ts) seri-batch'lerle ele alma disiplini güçlü; risks bölümü 15 maddeyle gerçek bağımlılıkların çoğunu yakalamış ve 039a baseline+schema_migrations atomikliği doğru kurgulanmış (039a'nın 040-öncesi slotu kaynak-doğrulandı: 018 yalnız profiles.household_size kolonu ekliyor, household_members tablosu ilk kez 040'ta referanslanıyor). Yine de plan MEVCUT HALİYLE GÜVENLE YÜRÜTÜLEMEZ; üç bloke-edici düzeltme şart: (1) WEIGHT-CORRUPTION P0 düzeltme+doğrulamasını Wave1/2'ye EKLE — audit'in en kritik maddesi tamamen düşmüş; (2) İKİ ÇELİŞKİLİ MIGRATION-NUMARA ŞEMASINI birleştir — üst 'migrationList' (051..069) ile alt 'PLAN ÖZETİ' aynı 051/052/053 numaralarını farklı migration'lara atıyor, tek kanonik şema sabitlenmeden dosya-adı/sıra çakışması kesin; ayrıca '0036b'/'036b'/'039a' kesirli versiyon adları Supabase CLI sıralama/repair ile uyumsuz olabilir (gerçek timestamp veya tamsayı slot gerekir). (3) Atanmamış HIGH/MEDIUM bulguları batch'lere bağla — ölü-trial-bildirim (notifications.service.ts, gelir-HIGH), ProfileCompletionDonut çelişkisi, üç-offline-banner, deneme-geri-sayımı-dashboard, TempoChart x-ekseni (iki chart-HIGH'dan biri düşmüş) hiçbir parallelBatch'te yok. Ek olarak: P0 etiketi Wave0-3'ün tamamına yayılarak audit'in P1 işlerini şişiriyor (gerçek-P0'ları geciktirir); yarış-durumu ve cron-401-negatif doğrulamaları somutlaştırılmalı; 053 weekly_menu_isolation için bozuk-satır veri-onarımı eksik. Bu üç bloke-edici giderilirse plan uygulanabilir ve audit-kapsamının ~%90'ını doğru sıralamayla kapatıyor."

**P0 tamlığı:** "EKSİK — yürütme planı gerçek lansman-engelleyicilerin TAMAMINI kapatmıyor. Audit'in açıkça lansman-öncesi ZORUNLU saydığı 4 P0 maddesinden biri (WEIGHT-CORRUPTION: AI'nin egzersiz ağırlığını vücut ağırlığı sanıp profiles.weight_kg'ı sessizce ezmesi — audit'in #1 KRİTİK çapraz-kesit riski) planın hiçbir dalgasında yok; ne düzeltme batch'i ne 'bench press 70kg→weight_kg değişmez' doğrulaması var. Diğer 3 P0 KAPSANMIŞ: premium self-grant (Wave1 db-subscriptions-trial/051), alerjen+kriz güvenlik-ağı (Wave1 ai-guardrails + ai-chat-allergen-scan), çok-adımlı yazım→transaction (Wave1+Wave5 055 RPC). Ayrıca Critical-AI bulgusu (legacy ai-plan'in chat diyetini EZMESİ, 053) Wave1'de DOĞRU şekilde P0'da. ANCAK plan ters yönde de hatalı: Wave0-3'ün tamamını P0 etiketleyerek audit'in P1 dediği ~15 işi (OAuth birth_year, settings IA, sonsuz-spinner, retrieval taskMode, week_start TZ, save-guard'lar) P0 turuna şişirmiş — bu, gerçek-P0 + ölü-trial-bildirim/donut gibi atanmamış HIGH UX bulgularının gözden kaçmasını kolaylaştırıyor. Net hüküm: weight-corruption eklenmeden P0 dalgası audit'in kendi tanımına göre TAMAMLANMAMIŞ sayılır."

**🕳️ Plana girmemiş boşluklar (gaps):**
- WEIGHT-CORRUPTION (audit'in #1 KRİTİK çapraz-kesit riski + AI/critical özet madde): Yönetici özeti ve P0 yol haritası 'AI vücut-ağırlığını egzersiz ağırlığıyla karıştırıp profiles.weight_kg'ı sessizce eziyor' (ai-chat/index.ts:559-562) maddesini lansman-öncesi ZORUNLU P0 olarak listeliyor ve kk.mjs ile 'bench press 70kg → weight_kg DEĞİŞMEMELİ' canlı testini şart koşuyor. Yürütme planının HİÇBİR dalgasında bu güvenlik-ağı sertleştirmesi veya doğrulaması yok. Bu en yüksek-etkili sağlık/güven riski ve plandan tamamen düşmüş — tek başına P0 dalgasını eksik bırakır.
- validateMealParse/validateMacroConsistency (AI-low, ai-chat-meal-persist) Wave6'da (P2) konumlanmış; ancak weight-corruption ile aynı 'sessiz veri bozma' sınıfından makro-kalori tutarlılığı da kullanıcının kalori takibini bozar. Daha kritik olan weight-corruption hiç yokken, ilgili meal-persist doğrulaması en sona (P2) atılmış — kategori-içi öncelik tutarsız.
- ProfileCompletionDonut çelişkisi (UX-medium, batchKey profile-completion-donut): Audit 'Donut başlığı 13-görev ile gap-ipucu 24-alan çelişiyor, pct=100'de hala eksik-alan diyor' bulgusunu içeriyor. Yürütme planı parallelBatches listelerinde bu batch'e hiç yer vermemiş (profile-ia yalnız IA+hesap-silme). Düşmüş bulgu.
- profile-completion-donut ve dashboard-premium ölü-trial-bildirim: Plan Wave3'te 'dashboard-premium' batch'inden bahsediyor mu? PLAN ÖZETİ'nde [HIGH] 'Deneme süresi bitiş hatırlatması ölü kod + iç mantık çelişkisi' (notifications.service.ts:421/445, scheduleTrialReminder !==2 bug) var ama waves listesindeki Wave3 parallelBatches'te notifications.service.ts'e dokunan bir batch YOK — yalnızca chat/plan/settings/profile/error batch'leri var. Bu HIGH UX bulgusu (gelir etkisi) hiçbir batch'e atanmamış.
- Deneme geri-sayımı dashboard'da yüzeye çıkarma (UX-medium, usePremium.ts dashboard banner) ve 'üç offline banner üst üste' (UX-medium, offline-banner+dashboard-hero) bulguları waves parallelBatches'lerinde görünmüyor — index.tsx/HeroSection/usePremium dokunuşları hiçbir Wave3 batch'inde tanımlı değil.
- ai-plan-allergen boş-öğün-fallback (AI-low) ve dashboard-store hafta-dönümü re-projeksiyon / status-filtreli okuyucu (AI-low, latent) bulguları hiçbir dalganın parallelBatches'inde yok. Latent olsalar da audit'te yer alıyor; plan bunları sessizce atlamış (kapsam beyanı eksik).
- lab-values-screen (UX-medium: KeyboardAvoidingView yok + sayısal doğrulama yok) ve strength-screen (UX-medium: loading okunmuyor + .catch yok) bulguları: strength misc-ux-screens batch'inde var ama lab-values.tsx Wave3 'misc-ux-screens (strength.tsx + lab-values.tsx + log.tsx)' içinde — TAMAM. Ancak inline-validation-sweep Wave7'de lab-values sayısal doğrulamasını KAPSAMIYOR (yalnız log/menstrual/if-settings). lab-values'ın parseFloat/Number.isFinite doğrulaması iki dalga arasında sahipsiz kalabilir — net atama yok.

**🔢 Sıralama sorunları:**
- P0 ETİKETİ AŞIRI GENİŞ: Audit'in gerçek P0'ı (lansman-engelleyici) tam 4 madde: premium self-grant drift, weight-corruption, alerjen/kriz güvenlik-ağı, çok-adımlı yazım→transaction. Plan Wave 0,1,2,3'ün TAMAMINI 'priority: P0' etiketliyor — OAuth birth_year, settings IA, sonsuz-spinner, retrieval taskMode, week_start TZ gibi audit'in açıkça P1 dediği işler P0'a yükseltilmiş. Bu, P0 dalgasının (APK+emulator deep-test gerektiren) kapsamını şişirip gerçek lansman-engelleyicilerin tamamlanmasını geciktirir. Sıralama hatası: P1 işleri P0 turuna karıştırılmış.
- 039a baseline ↔ schema_migrations repair atomikliği DOĞRU kurgulanmış (Wave0 tek batch). Ancak 039a'nın slot'u 'mantıksal olarak 040'tan önce' deniyor; gerçek en-erken household referansı 018 DEĞİL (018 yalnız profiles.household_size kolonu ekliyor, household_members tablosuna dokunmuyor — doğrulandı), gerçek tablo-referansı 040. Yani 039a placement DOĞRU. Risk yanlış değil ama 'canlıda no-op' iddiası yalnız households+household_members için geçerli; coach_consents canlıda elle açılmışsa onun da CREATE'i 039a'ya dahil edilmeli (plan ediyor) — fakat coach_consents'e referans veren İLK migration planın KENDİ 062'si, dolayısıyla 039a'nın 040'tan önce olması coach_consents için gerekli değil; coach_consents CREATE'i 062'den önce herhangi bir yeni slotta olabilir. Plan bunu 039a'ya bağlayarak gereksiz coupling yaratıyor (küçük).
- Wave5 rpc-atomic-migration (055 archive→promote, ai-chat) Wave1'in ai-chat dokunuşundan SONRA seri deniyor — DOĞRU. Ama 055 migration'ı Wave1 (atomik plan/hedef yazımı) tarafından yazılıp Wave5 (approveDraft) tarafından yalnız çağrılıyor. Plan bunu risks#13'te doğru notlamış. Ancak Wave1 verification'ı '055 atomik' doğrulamasını içermiyor — Wave1 verification yalnız 'yarıda kesik plan yazımı eski planı korur' diyor; bu 055 RPC'sinin Wave1'de TAM yazıldığını test etmiyor (ai-chat çağrı noktası Wave1'de mi Wave5'te mi belirsiz). plan.service.ts approveDraft (Wave5) ile ai-chat archive→promote (Wave1?) aynı 055 RPC'sine bağımlı — ai-chat çağrı noktasının hangi dalgada bağlandığı net değil.
- week-start-tz (Wave2): src/services/weekly-plan.service.ts İSTEMCİ tarafı eşitlik→aralık sorgusu + ai-plan UTC ankraj düzeltmesi GEREKTİRİR. Bu, weekly_plans_isolation (Wave1, 053) ile aynı 'weekly menü ekranda görünmüyor' kullanıcı yolunu paylaşıyor. 053 izolasyonu menüyü ayrı satıra taşırsa, week_start sorgu eşitliği o yeni satır şemasına göre güncellenmeli — Wave1 (053) Wave2 (week-start-tz) için ön-koşul olmalı ama plan bunu dependsOn olarak işaretlemiyor; ai-plan/index.ts her ikisinde de değişiyor (risks#10 ai-plan çok-dalga seri diyor, iyi) ama weekly-plan.service.ts sorgu mantığının 053 sonrası gelmesi gerektiği açıkça belirtilmemiş.
- Wave4 ui-tab-headers 'profile.tsx Card [Wave3 sonrası seri]' diyor; profile.tsx Wave3'te profile-ia (IA+hesap-silme) batch'inde de değişiyor. Doğru seri-bağımlılık (risks#8). Ancak progress.tsx Wave4 ui-tab-headers içinde 'chart fix dahil' ediliyor — PLAN ÖZETİ'nde chart-ekseni-hizası ayrı bir [HIGH] (ui-progress-charts) ve TempoChart ayrı [HIGH] (ui-tempo-chart). TempoChart.tsx (src/components/plan/TempoChart.tsx) hiçbir Wave parallelBatches'inde GÖRÜNMÜYOR — iki HIGH chart bulgusundan biri (TempoChart x-ekseni) yürütme planından düşmüş; yalnız progress.tsx chart'ı tab-headers'a iliştirilmiş.
- Wave7 diakritik-sweep 'Wave3/4 ile çakışan dosyalar EN SONA' doğru sıralanmış (risks#15). Ancak Wave3 i18n-strings batch'i (data-import.tsx + venues.tsx, P0/HIGH UX diakritik) ZATEN bu iki dosyayı diakritikle düzeltiyor; Wave7 diakritik-sweep aynı dosyaları tekrar listeliyor (data-import/venues). Çift-iş/çakışma: Wave3 düzeltmesi sonrası Wave7 sweep'i bu dosyalarda no-op olmalı ama plan açıkça 'Wave3 tamamlananları hariç tut' demiyor — yeniden-düzeltme/regresyon riski.

**🗄️ Migration çakışmaları:**
- KRİTİK NUMARA ÇAKIŞMASI: Yürütme planının iki bölümü (üst-düzey 'migrationList' vs alttaki 'PLAN ÖZETİ' DB scope) AYNI mantıksal değişikliğe FARKLI numaralar veriyor. migrationList: 051=trial_selfgrant, 052=chat_fk, 053=weekly_menu_isolation, 054=cron_secret, 055=atomic_plan_goal, 056=ai_summary_atomic_merge, 057=cron_reconcile, 058=chat_triggers, 059=pgsodium, 060=drop_dup_idx, 061=perf_idx, ... 069=monthly_reports. PLAN ÖZETİ ise: 051=atomic_plan_goal_writes (AİYNI numara FARKLI içerik!), 051=trial_selfgrant_rpc (db-subscriptions), 052=cron_reconcile, 052=chat_messages_session_fk, 053=consolidate_chat_triggers, 054=pgsodium, 055=meal_logs_index, 056=drop_dup_idx, 057=coach_rpc, 058=account_deletion, 059=cron_vault, ... Aynı 051/052/053... numaraları iki farklı migration'a atanmış. Tek bir migrations/ dizininde uygulanınca DOSYA ADI ÇAKIŞMASI veya yanlış-sıra kesin. Plan yürütülmeden önce TEK kanonik numara şeması (migrationList) sabitlenmeli; PLAN ÖZETİ numaraları stale/çelişkili.
- 036b/039a kesirli-numara şeması: migrationList '039a_baseline...' ve PLAN ÖZETİ '0036b_ai_summary_phantom_columns.sql' kullanıyor. Supabase migration sıralaması leksikografiktir: '036b' > '036_monthly...' ama '0036b' < '003_...' (sıfır-padding tutarsızlığı). PLAN ÖZETİ '0036b' (4 hane) yazımı '003'ten ÖNCE sıralanır ve ai_summary tablosu daha yaratılmadan kolon eklemeye çalışır → patlar. '036b' (migrationList'in metni) doğru sıralanır ama Supabase CLI bazı sürümlerde alfasayısal-olmayan versiyon kabul etmez (yalnız <14-hane-zaman-damgası veya artan tamsayı). Kesirli '039a'/'036b' versiyon adları supabase migration repair/db push ile uyumsuz olabilir — gerçek timestamp veya gerçek tamsayı slot gerekir. Bu, Wave0'ın tüm temelini riske atar.
- 055 (atomic_plan_goal_writes) çift-tüketim: migration Wave1'de yazılıp (plan ezme/atomik) Wave5'te (approveDraft + ai-chat archive→promote) ÇAĞRILIYOR (risks#13). Ancak migration 055'in İÇERİĞİ üç ayrı RPC kapsıyor (daily_plans upsert-projeksiyon, goals deactivate→insert, weekly_plans archive→promote). Wave1 yalnız weekly_plans+atomik yazımı, Wave5 approveDraft'ı bağlıyor — eğer 055 Wave1'de YALNIZ kısmen yazılırsa (yalnız weekly_plans RPC), Wave5 approveDraft'ın ihtiyaç duyduğu RPC eksik kalır. Migration tek seferde TÜM RPC'leri içermeli; plan '055 tek kez Wave1'de yaz' diyor ama Wave1 goal'ı yalnız 'atomik plan yazımı' — goals deactivate→insert (ai-chat:3751) Wave1 kapsamında mı belirsiz.
- İdempotency-repair (Wave0) ↔ 037-050 mevcut migration'ları: Plan '037-050'yi idempotent yap + schema_migrations repair' diyor. Ancak bu, 037-050'nin İÇERİĞİNİ değiştirmek demek (CREATE POLICY → CREATE POLICY IF NOT EXISTS / DROP+CREATE). Bu dosyalar canlıda zaten uygulanmış; içeriklerini değiştirip 'repair' ile kayıt eklemek, hash-tabanlı doğrulama yapan Supabase CLI'da checksum uyuşmazlığı verebilir. 'supabase migration repair --status applied 037..050' kaydı ekler ama dosya-içeriği değişirse sonraki 'db diff'/'db push' drift bildirir. Plan bu içerik-değişikliği↔repair etkileşimini ele almıyor (risk yalnız 'idempotent yap' diyor).
- 053_weekly_menu_isolation (risk=high, canlı kullanıcı planlarına dokunuyor): risks#f 'migration öncesi yedek + dry-run SELECT' diyor — iyi. Ancak izolasyon, mevcut tek 'active diet' satırını iki tüketici (projeksiyon vs menü) için BÖLMEK demek. Canlıdaki mevcut karışık-şekilli satırların (legacy menü tarafından zaten EZİLMİŞ olanlar) geri-migrasyonu (data backfill) plana dahil değil; yalnız şema izolasyonu var. Hâlihazırda bozulmuş satırlar izolasyondan sonra hangi tarafa gider? Veri-onarım adımı eksik.
- 046 (mevcut trial fix) ↔ 051 (yeni trial RPC) üst-üste binme: 046 zaten subscriptions_ins'i trial-only'e daralttı (doğrulandı: dosya satır 19-29). Yeni 051 'doğrudan INSERT politikasını KALDIR + RPC'ye taşı' diyor. 051, 046'nın bıraktığı subscriptions_ins politikasını DROP etmeli; ama 046 idempotency-repair (Wave0) ile 'idempotent yapılıp tracked' edilecek. Eğer Wave0 046'yı repair eder ve Wave1 051 onu DROP ederse, sıfırdan-reset senaryosunda 046'nın oluşturduğu politikayı 051 kaldırır — tutarlı; ama trial_used kontrolünün RPC'ye taşınması + tg_sync_profile_premium trigger'ının hâlâ SECURITY DEFINER olması, RPC dışı herhangi bir service_role/edge yazımının trigger'ı tetiklemesi riskini kapatmıyor. Plan trigger davranışını ele almıyor.

**🧪 Eksik doğrulama:**
- WEIGHT-CORRUPTION doğrulaması yok (yukarıda gap): audit 'kk.mjs ile bench press 70kg → weight_kg DEĞİŞMEMELİ' canlı testini P0 şart koşuyor; planın hiçbir verification'ında bu yok. Lansman-öncesi en kritik regresyon testi eksik.
- Wave1 verification 'Trial 2. self-grant red': bu yalnız client/RPC yolunu test ediyor. Audit asıl açığın PostgREST üzerinden client'ı BAYPAS ederek doğrudan INSERT olduğunu vurguluyor (subscriptions_ins politikası). Doğrulama 'authenticated kullanıcı raw REST ile trial INSERT (expired sonrası) reddedilir mi' senaryosunu içermeli; 'client startTrialIfEligible 2. çağrı reddi' yetersiz (client gate zaten vardı).
- schema_migrations repair sonrası 'supabase db reset temiz şemadan sıfır hata' (Wave0 verification) iyi ama YALNIZCA temiz-reset'i test ediyor. CANLI ortamda 'db push'un 037-050'yi YENİDEN UYGULAMAYA çalışmadığını (idempotency + repair kaydının tutması) ayrıca doğrulamak gerekir — staging'de 'db push --dry-run' diff'in boş döndüğü teyidi yok.
- Wave1 cron-secret verification 'CRON_SECRET set iken cron 200': iyi, ama audit'in asıl uyarısı 'CRON_SECRET set edilirse TÜM proaktif/rapor/temizlik 401 ile sessizce ölür'. Doğrulama hem (a) CRON_SECRET set + header gönderiliyor→200 hem (b) CRON_SECRET set + header YOK→401 (negatif kontrol) içermeli; ayrıca 022 scheduled_cleanups da kapsanmalı (plan 014/022 diyor ama verification yalnız genel 'cron 200').
- 053 weekly_menu_isolation için 'legacy menü aktif planı ezmez' (Wave1 verification) davranışsal doğru; ancak izolasyon migration'ının canlı veriye ETKİSİ (kaç satır bölünüyor, bozulmuş satırlar ne oluyor) için dry-run SELECT etki-sayımı verification'a alınmamış (risks#f'de tedbir var ama verification adımı değil).
- Wave2 'haftalık rapor cron'da üretilir' doğrulaması: audit tetik penceresinin (Pazartesi 6-8 UTC) cron saatleriyle (5/10/17 UTC) çakışmadığını söylüyor. Düzeltme sonrası doğrulama 'Pazartesi 05:00 cron tetikledi mi' SPESİFİK gün/saatte test edilmeli; jenerik 'cron'da üretilir' bunu kanıtlamaz (cron'u beklemeden manuel-tetik simülasyonu + dayOfWeek/utcHour mock gerekir).
- Atomik append (behavioral_patterns yarış-durumu, Wave2 ai-memory): verification 'eşzamanlı mesaj patterns kaybetmez' — bu yarış-durumu testi gerçek eşzamanlılık (ai-chat + extractor + ai-proactive paralel tetik) gerektirir; tek-thread smoke test lost-update'i yakalamaz. Doğrulama yönteminin eşzamanlı olduğu belirtilmeli.
- Wave5 'approveDraft yarışta 0-aktif bırakmaz': yine yarış-durumu; iki eşzamanlı onay senaryosu (uniq_active_plan_per_type 23505) açıkça simüle edilmeli. 'EXPLAIN index kullanır' (index doğrulaması) iyi ama drop edilen index'lerin (060) gerçekten kullanılmadığı pg_stat_user_indexes scan=0 ile DROP ÖNCESİ teyit edilmeli — plan bunu DROP'tan önce kontrol etmiyor.
- Wave3 OAuth birth_year 'OAuth birth_year→doğru TDEE': Google VE Apple iki ayrı yol (auth.store.ts signInWithGoogle/signInWithApple). Doğrulama her iki sağlayıcıyı + 'metadata.birth_year yoksa koşullu alan gösterilir' + 'introduce_yourself görevi tamamlanabilir' + 'plan-readiness bloğu kalkar' üç aşağı-akış etkisini ayrı test etmeli; 'doğru TDEE' tek başına yetersiz.
- diakritik-sweep (Wave7) verification 'Tüm görünür string tam diakritik': otomatik bir tarama (ASCII-only Türkçe string regex) olmadan manuel; objektif kabul kriteri (grep ile [A-Za-z]+ Türkçe-kök ama ı/ş/ğ/ö/ü/ç eksik tespiti) tanımlanmamış — kaçaklar kaçınılmaz.

---

# 📁 Boyut Bazında Detaylı Düzeltme Kartları

## UI / Görsel Tasarım & Tasarım Sistemi

_28 kart — 🔴 0 · 🟠 5 · 🟡 10 · 🔵 10 · ⚪ 3 · 🧹 2 süpürme_

### 🟠 HIGH — Paylaşılan Button primitive'i hiçbir erişilebilirlik prop'u taşımıyor
- **Dosyalar:** `src/components/ui/Button.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-button-primitive`

**Kök-neden:** src/components/ui/Button.tsx:40-66 TouchableOpacity'de accessibilityRole/accessibilityState/accessibilityLabel yok; disabled+loading yalnızca opacity:0.5 (satır 50) ile görsel olarak iletiliyor. Props arayüzü (satır 7-16) kapalı ve `...rest` spread'i yok, dolayısıyla tüketici dışarıdan da a11y prop ekleyemez. Aynı dizindeki EmptyState/DateTimeField role+label set ederken Button tek istisna. accessibility.ts:71 getButtonA11yProps helper'ı mevcut ama Button onu kullanmıyor; ayrıca helper accessibilityState içermiyor. TEYİT EDİLDİ.

**Düzeltme:** Button() içinde TouchableOpacity'ye a11y prop'larını ekle: accessibilityRole='button', accessibilityState={{ disabled: !!(disabled||loading), busy: !!loading }}, accessibilityLabel={accessibilityLabel ?? title}. Props arayüzünü genişlet: accessibilityLabel?: string; accessibilityHint?: string; testID?: string ekle ve bunları TouchableOpacity'ye geçir. getButtonA11yProps helper'ını OLDUĞU GİBİ kullanma — çünkü accessibilityState içermiyor; bunun yerine prop'ları doğrudan yaz (veya ayrı bir görevde helper'a state parametresi ekle, bu görev kapsamı dışı). disabled||loading mantığı zaten satır 55'te var, sadece state'e yansıt. Yalnızca bir bileşen değişir, çarpan etkisiyle onlarca ekranı düzeltir.

```tsx
// Props arayüzüne ekle
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
// imzaya ekle: ...{ ..., accessibilityLabel, accessibilityHint, testID }
<TouchableOpacity
  style={[...]}
  onPress={onPress}
  disabled={disabled || loading}
  activeOpacity={0.7}
  accessibilityRole="button"
  accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
  accessibilityLabel={accessibilityLabel ?? title}
  accessibilityHint={accessibilityHint}
  testID={testID}
>
```

**Doğrulama:** npx tsc --noEmit (yeni opsiyonel prop'lar mevcut çağrıları bozmamalı). Expo preview/cihazda TalkBack aç: bir primary butona odaklan -> 'düğme' rolüyle ve title ile okunmalı; loading durumundaki butona odaklan -> 'meşgul/devre dışı' duyurulmalı. Grep ile <Button kullanımlarının derlendiğini doğrula.

---

### 🟠 HIGH — Yıkıcı silme işlemleri yalnızca uzun-bas ile tetikleniyor — ekran okuyucu kullanıcısı silemiyor
- **Dosyalar:** `app/settings/venues.tsx`, `app/settings/multi-phase-goals.tsx`, `app/settings/progress-photos.tsx`, `app/settings/health-events.tsx`, `src/components/profile/InsightCard.tsx`, `app/settings/coach-memory.tsx`
- **Efor:** Orta · **Risk:** med · **batch:** `ui-destructive-delete`

**Kök-neden:** Birden çok ekran silmeyi SADECE onLongPress ile sunuyor, görünür/odaklanabilir sil butonu yok ve çoğunda a11y label yok: app/settings/venues.tsx:45 (label'sız salt long-press), app/settings/multi-phase-goals.tsx:106, app/settings/progress-photos.tsx:202, app/settings/health-events.tsx:70, src/components/profile/InsightCard.tsx:47/58. coach-memory için audit'teki yol HATALI (src/components/settings/coach-memory.tsx yok); gerçek yol app/settings/coach-memory.tsx. Orada satır wrapper'ları role='button'+label TAŞIYOR (yani venues'tan daha iyi) ama yine long-press-only; SectionHeader'daki trash ikonu (satır 945-947) onPress'siz salt dekoratif/yanıltıcı. Doğru desen app/(tabs)/chat.tsx:325-333 (onPress + role + label + hitSlop) ve food-preferences.tsx delete-chip deseninde mevcut. KVKK/veri-kontrolü açısından engelli kullanıcı bu verileri HİÇ silemiyor. TEYİT EDİLDİ.

**Düzeltme:** Her long-press-only yıkıcı satıra chat.tsx:325 şablonuyla GÖRÜNÜR bir sil butonu ekle (TouchableOpacity onPress + accessibilityRole='button' + accessibilityLabel='X sil' + hitSlop {top/bottom/left/right:12} + 44x44 dokunma alanı, trash-outline ikon). venues/multi-phase/health-events: kart satırının sağ üstüne küçük trash butonu yerleştir, mevcut onLongPress'i kısayol olarak KORU. progress-photos: her foto thumbnail'inin köşesine yarı saydam overlay sil butonu (yıkıcı olduğu için Alert.alert onay diyaloğu ekle — şu an doğrudan deletePhoto çağrılıyor, foto silme geri-alınamaz). InsightCard:47/58: metin satırlarının yanına görünür sil butonu. coach-memory: SectionHeader'a opsiyonel onDelete?: ()=>void prop'u ekle; deletable&&onDelete olduğunda dekoratif Ionicons'u TouchableOpacity'ye sar ve onPress=onDelete bağla; her çağrı yerinde mevcut handleDeleteNote/handleClearField'ı onDelete olarak geçir (label'lı onay diyaloğu zaten handle fonksiyonlarında varsa koru). Mevcut Button primitive değil ham TouchableOpacity tercih et çünkü ikon-tek-buton.

```tsx
// venues.tsx kart başlık satırında, isim Text'inin yanına:
<TouchableOpacity onPress={() => handleDelete(v.id)} accessibilityRole="button" accessibilityLabel={`${v.venue_name} mekanını sil`} hitSlop={{top:12,bottom:12,left:12,right:12}} style={{ padding: SPACING.xs }}>
  <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
</TouchableOpacity>
// coach-memory SectionHeader:
function SectionHeader({ ..., onDelete }) { ...
  {deletable && onDelete ? (
    <TouchableOpacity onPress={onDelete} accessibilityRole="button" accessibilityLabel={`${title} sil`} hitSlop={{top:10,bottom:10,left:10,right:10}}>
      <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
    </TouchableOpacity>
  ) : null }
```

**Doğrulama:** npx tsc --noEmit. TalkBack ile her ekranda: görünür sil butonuna odaklanılabildiğini ve 'X sil, düğme' duyurulduğunu doğrula; long-press kısayolunun hâlâ çalıştığını manuel test et. progress-photos için onay diyaloğunun yanlışlıkla silmeyi önlediğini doğrula. coach-memory'de trash ikonuna dokununca silme akışının tetiklendiğini gör.

---

### 🟠 HIGH — Kilo & Uyum trend grafiklerinde x-ekseni etiketleri veri noktalarıyla hizalanmıyor
- **Dosyalar:** `app/(tabs)/progress.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-progress-charts`

**Kök-neden:** app/(tabs)/progress.tsx:227 (Kilo) ve :256 (Uyum) içinde labels diziyi `filter((_,i)=> i % step === 0)` ile KISALTIYOR ama datasets.data tam uzunlukta map ediliyor (:228, :257). react-native-chart-kit etiketleri INDEX bazlı eşler; labels.length < data.length olunca etiketler grafiğin soluna kümelenir, geri kalan ~22 nokta etiketsiz/yanlış hizalı kalır. Doğru desen src/components/reports/ProgressChart.tsx:53-54: step hesapla, sonra `data.map((d,i)=> i%step===0 ? formatShortDate(d.label) : '')` ile labels'i veriyle EŞİT uzunlukta üret. TEYİT EDİLDİ.

**Düzeltme:** Her iki LineChart'ın labels üretimini ProgressChart deseniyle değiştir. Kilo: step = Math.max(1, Math.floor(weights.length / 5)); labels = weights.map((w,i)=> i%step===0 ? fmtLabel(w.date) : ''). Uyum: aynısını compliance ve fmtLabel(c.date) ile uygula. datasets.data değişmeden kalır. Bu, labels.length === data.length garantiler, dolayısıyla chart-kit etiketleri doğru indekslere yerleştirir. fmtLabel zaten dosyada tanımlı, ek import gerekmez.

```tsx
// Kilo (mevcut :227 satırını değiştir)
labels: (() => { const step = Math.max(1, Math.floor(weights.length / 5)); return weights.map((w, i) => (i % step === 0 ? fmtLabel(w.date) : '')); })(),
// datasets aynı kalır
// Uyum (mevcut :256)
labels: (() => { const step = Math.max(1, Math.floor(compliance.length / 5)); return compliance.map((c, i) => (i % step === 0 ? fmtLabel(c.date) : '')); })(),
```

**Doğrulama:** npx tsc --noEmit. Expo preview Raporlar sekmesinde >=10 günlük tartı verisiyle: en sağdaki etiketin son veri noktasının altına denk geldiğini, etiketlerin sola kümelenmediğini görsel doğrula. q.mjs ile bir test kullanıcısının weight_logs/daily_reports satır sayısını SELECT edip etiket sayısı (~5-6) ile nokta sayısının uyumsuzluğunun artık görsel soruna yol açmadığını teyit et.

---

### 🟠 HIGH — TempoChart x-ekseni etiketleri veri noktalarıyla hizalanmıyor (aynı chart-kit hatası)
- **Dosyalar:** `src/components/plan/TempoChart.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-tempo-chart`

**Kök-neden:** src/components/plan/TempoChart.tsx:65 labels = Array.from({length: weeks+1}, (_,i)=> `${i}h`) ile weeks+1 etiket üretiliyor; ama :77'de `labels.filter((_,i)=> i % Math.max(1, Math.floor(weeks/6)) === 0)` ile kısaltılıp LineChart'a geçiriliyor. datasets (:79-80 plannedPoints/actualSeries) tam weeks+1 uzunlukta kalıyor. Filter sonucu dataset'ten kısa olduğundan hafta etiketleri (0h,3h...) yanlış indekslere yerleşip sola kümeleniyor. progress.tsx ile aynı sınıf hata. TEYİT EDİLDİ.

**Düzeltme:** Satır 77'deki labels.filter(...) yerine eşit-uzunluk üretimi kullan. step'i bir kez hesapla (const step = Math.max(1, Math.floor(weeks / 6))) ve labels: labels.map((l,i)=> i%step===0 ? l : '') ile geçir. Böylece labels.length === plannedPoints.length === actualSeries.length olur ve etiketler doğru hizalanır. labels değişkeni :65'te tanımlı, datasets değişmez.

```tsx
// :65 yakınına step ekle
const step = Math.max(1, Math.floor(weeks / 6));
// :77 satırını değiştir
labels: labels.map((l, i) => (i % step === 0 ? l : '')),
// datasets aynı kalır
```

**Doğrulama:** npx tsc --noEmit. Hedef ekranında (çok-haftalı plan olan test kullanıcısı) TempoChart'ı Expo preview ile aç: hafta etiketlerinin (0h, 3h, 6h...) ilgili veri noktalarının altına hizalandığını, sola kümelenmediğini doğrula. Planlanan-vs-Gerçekleşen iki serinin x-ekseninin aynı hafta indekslerini gösterdiğini gör.

---

### 🟠 HIGH — Her ayar ekranında başlık iki kez görünüyor: native header + gövde H1 (duplicate-title)
- **Dosyalar:** `app/settings/food-preferences.tsx`, `app/settings/supplements.tsx`, `app/settings/notifications.tsx`, `app/settings/goals.tsx`, `app/settings/premium.tsx`, `app/settings/venues.tsx`, `app/settings/account-security.tsx`, `app/settings/coach-sharing.tsx`, `app/settings/chat-history.tsx`, `app/settings/challenges.tsx`, `app/settings/achievements.tsx`, `app/settings/health-export.tsx`, `app/settings/health-events.tsx`, `app/settings/debug-mode.tsx`, `app/settings/weekly-menu.tsx`, `app/settings/day-boundary.tsx`, `app/settings/data-import.tsx`, `app/settings/theme.tsx`, `app/settings/recipes.tsx`, `app/settings/coach-tone.tsx`, `app/settings/strength.tsx`, `app/settings/household.tsx`, `app/settings/meal-prep-plan.tsx`, `app/settings/meal-templates.tsx`, `app/settings/menstrual.tsx`, `app/settings/periodic-state.tsx`, `app/settings/progress-photos.tsx`, `app/settings/multi-phase-goals.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `ui-settings-duplicate-title` · **Bağımlı:** Gövde başlıkları native header başlığıyla çelişiyor; coach-memory için ÜÇ farklı isim

**Kök-neden:** app/settings/_layout.tsx her ekran için Stack.Screen options={{ title }} ile native header başlığı tanımlıyor (satır 15-47). Aynı zamanda ekran gövdeleri aynı metni FONT.xxl/fontWeight:'800' H1 olarak tekrar basıyor. Çözüm kodda zaten kabul edilmiş: if-settings.tsx:61-62 yorumu 'the in-body heading was a redundant duplicate and has been removed' diyor ve o ekranda H1 kaldırılmış. ABARTILI DEĞİL — TAM TERSİNE FINDER EKSİK SAYMIŞ: grep ile gövde H1 tespit edildi; sadece 5 değil ~28 settings ekranı duplike (venues, goals, supplements, notifications, premium, account-security, coach-sharing, chat-history, challenges, achievements, health-export, health-events, food-preferences, debug-mode, weekly-menu, day-boundary, data-import, theme, recipes, coach-tone, strength, household, meal-prep-plan(2x), meal-templates, menstrual, periodic-state, progress-photos, multi-phase-goals vb). index.tsx 'Ayarlar' H1'i de native title ile aynı. TEYİT EDİLDİ + KAPSAM GENİŞ.

**Yeniden değerlendirme:** Bulgu doğru ama kapsam finder'ın belirttiği 5 dosyadan çok daha geniş (~28 settings ekranı). Effort S'ten M'ye yükseltildi. İsim-uyuşmazlığı olan ekranlarda (strength/menstrual/multi-phase/coach-memory) H1 silinmeden ÖNCE native title kanonik ada çekilmeli; bu yüzden ilgili MEDIUM isim-normalizasyon bulgusuna yumuşak bağımlılık var (dependsOn). Çakışmayı önlemek için her dosya tek tek, aynı batchKey altında sıralı işlenmeli.

**Düzeltme:** if-settings.tsx çözümünü standartlaştır: native header'la AYNI metni tekrarlayan gövde H1 <Text>'lerini KALDIR (if-settings:61-62 yorum şablonunu ekle). Sadece tam metin eşleşen H1'leri sil; H1'in hemen altındaki açıklama/alt-başlık Text'lerini (textSecondary, FONT.sm) KORU. index.tsx 'Ayarlar' H1'i tartışmalı — settings ana menüsü olduğu için bırakılabilir; tutarlılık için o da kaldırılabilir (karar: kaldır, native title yeterli). DİKKAT: bazı ekranlarda H1 metni native title ile bire bir aynı değilse (ör. strength gövde 'Güç Progresyonu' vs header 'Güç Progresyon') önce kanonik adı seç (bkz. ayrı MEDIUM bulgu) — bu görevde sadece duplikeyi kaldır, isim normalizasyonunu o bulguya bırak; metin farkı olan ekranlarda H1'i silmeden önce native title'ı doğru kanonik ada güncelle. meal-prep-plan.tsx'te İKİ H1 var (loading + içerik state'leri); ikisini de kaldır. Geniş kapsam ama her dosyada tek satır silme — düşük risk, yüksek tekrar.

```tsx
// Her ekranda örnek (food-preferences.tsx:69)
- <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Yemek Tercihleri</Text>
+ {/* Native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
  <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, ... }}>Sevdiğin ve sevmediğin...</Text>  // açıklama KORUNUR
// H1 silindiğinde alttaki ilk öğenin marginTop'unu kontrol et (paddingTop:SPACING.md zaten ScrollView'da)
```

**Doğrulama:** npx tsc --noEmit. Expo preview: her settings ekranını aç, üstte SADECE native header başlığı görünmeli, gövdede tekrar olmamalı; açıklama metinleri ve dikey boşluk düzgün kalmalı (H1 marginBottom kaybından dolayı içerik header'a yapışmamalı — gerekirse ilk açıklama Text'ine marginTop ekle). if-settings.tsx ile görsel tutarlılığı karşılaştır.

---

### 🟡 MEDIUM — Aksan arka planlarında sabit #fff metin WCAG AA fail (getContrastColor atlanıyor)
- **Dosyalar:** `src/components/tracking/StreakBadge.tsx`, `src/components/common/OfflineBanner.tsx`, `src/components/plan/PhaseTimeline.tsx`, `src/lib/accessibility.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-accent-contrast (StreakBadge+OfflineBanner+PhaseTimeline)`

**Kök-neden:** Doğrulandı. StreakBadge.tsx:24/27 backgroundColor:'#1D9E75' üstünde color:'#fff' (3.39:1, AA fail). OfflineBanner.tsx:58/82 bg '#D85A30E6'/primary üstünde color:'#fff' (~3.87:1 fail). PhaseTimeline.tsx:85 aktif faz '#fff' (F97316=2.80, 06B6D4=2.43 fail). accessibility.ts:197 getContrastColor primary için 'black' döner (lum 0.260>0.179) ama üç bileşen helper'ı baypas edip beyaz sabitliyor. OfflineBanner _layout.tsx üzerinden app-global render ediliyor.

**Düzeltme:** Beyaz sabitleri getContrastColor ile değiştir. StreakBadge: bg sabit '#1D9E75' olduğundan basitçe icon ve Text color'ı '#0D0D12' (background token) yap — getContrastColor('#1D9E75')==='black'. OfflineBanner: bg dinamik (syncing→primary, offline→coral); foreground'u const fg = getContrastColor(syncing ? colors.primary : '#D85A30') === 'black' ? '#0D0D12' : '#fff' ile hesapla ve icon+Text'e uygula (mevcut bg değişkeninin alpha-suffix'i 'E6' getRelativeLuminance'ta hexToRgb tarafından parse edilemez; getContrastColor'a alpha'sız hex geçir — syncing için colors.primary, offline için '#D85A30'). PhaseTimeline: aktif Text color'ı sabit '#fff' yerine getContrastColor(color)==='black' ? '#0D0D12' : '#fff' (color = GOAL_COLORS[goalType]). Not: PhaseTimeline GOAL_COLORS token'lara taşınınca (ayrı bulgu) bu hesap doğal olarak yeşil/coral token'larıyla çalışır.

```tsx
// OfflineBanner.tsx
import { getContrastColor } from '@/lib/accessibility';
const baseBg = syncing ? colors.primary : '#D85A30';
const fg = getContrastColor(baseBg) === 'black' ? '#0D0D12' : '#fff';
// <Ionicons color={fg} /> ; <Text style={{ color: fg, ... }}>

// StreakBadge.tsx — bg '#1D9E75' sabit
<Ionicons name="flame" color="#0D0D12" />
<Text style={{ color:'#0D0D12', ... }}>
```

**Doğrulama:** tsc --noEmit; getContrastRatio('#0D0D12','#1D9E75')≈5.72 ve getContrastRatio('#0D0D12','#D85A30')≥4.5 olduğunu q.mjs/node ile getContrastRatio çağırıp doğrula; preview: StreakBadge'i (streak≥2), OfflineBanner'ı (NetInfo offline simülasyonu) ve PhaseTimeline'ı render edip metnin koyu/okunabilir geldiğini gör.

---

### 🟡 MEDIUM — Dört görünür sekme dört farklı başlık deseni — paylaşılan ScreenHeader yalnızca Chat'te
- **Dosyalar:** `app/(tabs)/progress.tsx`, `app/(tabs)/profile.tsx`, `src/components/dashboard/HeroSection.tsx`, `src/components/ui/ScreenHeader.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `ui-tab-headers (progress+profile+HeroSection)`

**Kök-neden:** Doğrulandı. progress.tsx:207 'Raporlar' başlığı elle fontSize:18/fontWeight:'600' + paddingTop:insets.top+12. HeroSection.tsx:90 selamlama 18/700 + paddingTop:insets.top+8. profile.tsx ekran başlığı taşımıyor (sadece SectionTitle'lar var). Chat ScreenHeader kullanıyor (FONT.xl2=18/700, insets.top+8). Yani ağırlık (600 vs 700) ve top-inset (+12 vs +8) tutarsız; profilde hiç başlık yok.

**Düzeltme:** Minimal tutarlılık: başlık token'larını tek kaynaktan tüket. progress.tsx:207 başlığını fontSize:FONT.xl2 + fontWeight:'700' yap ve contentContainerStyle paddingTop'u insets.top+8'e çek (HeroSection/Chat ile aynı). profile.tsx'e ScrollView başına bir 'Profil' başlığı ekle (FONT.xl2/700, paddingTop hizalı) — mevcut layout'u bozmamak için ilk View'ın üstüne. HeroSection zaten 18/700/+8; sadece raw 18 yerine FONT.xl2 kullan (token hijyeni). İsteğe bağlı tam birleştirme (ScreenHeader'ı her sekmeye yaymak) L efor ve scroll/inset davranışını değiştirebileceğinden ayrı/sonraya bırak; bu fix yalnızca görsel parametreleri hizalar.

**Doğrulama:** tsc --noEmit; preview: 4 sekme arası gezinip başlık ağırlığı/üst boşluğun zıplamadığını ve Profil sekmesinde artık başlık göründüğünü gör.

---

### 🟡 MEDIUM — ErrorBoundary tema yerine elle yazılmış (drift olmuş) renkler — eski teal #14B8A6
- **Dosyalar:** `src/components/ui/ErrorBoundary.tsx`, `src/lib/theme.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-errorboundary`

**Kök-neden:** Doğrulandı. ErrorBoundary.tsx:60-89 tüm renkler sabit: :70 retry bg '#14B8A6' (eski Tailwind teal-500; güncel primary '#1D9E75' değil), :60 '#0D0D12', :62/73 '#fff', :65 '#888', :77 '#333', :80 '#bbb', :84 '#1a1a24', :85 '#f87171', :89 '#666'. :73 retry metni beyaz — Button primitive filled varyantta getContrastColor ile SİYAH veriyor (Button.tsx:34), iki farklı kontrast kuralı. Class component olduğu için useTheme() doğrudan çağrılamaz.

**Düzeltme:** Class component olduğundan en düşük-riskli yol: render() içindeki sabitleri DARK_COLORS'tan türet (import { DARK_COLORS } from '@/lib/theme'; const c = DARK_COLORS;). Eşlemeler: '#14B8A6'→c.primary, '#0D0D12'→c.background, '#fff' (başlık/metin)→c.text, '#888'→c.textMuted, '#333'→c.border (veya c.surfaceLight), '#bbb'→c.textSecondary, '#1a1a24'→c.surface, '#f87171'→c.error, '#666'→c.textMuted. Retry butonu metnini getContrastColor(c.primary) ile hesapla (siyah dönecek) — Button ile aynı kural. Tam Button primitive'e geçirmek (variant='primary') daha temiz ama Button bir fonksiyonel bileşen + useTheme; class render içinde import edip kullanmak sorun değil, ancak crash anında ThemeProvider mount değilse riskli — bu yüzden DARK_COLORS sabiti tercih edilir (light tema gated olduğundan dark zaten doğru fallback).

```tsx
import { DARK_COLORS as c } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
// bg:{...background:c.background}; retry style backgroundColor:c.primary;
// retry Text color:getContrastColor(c.primary);
```

**Doğrulama:** tsc --noEmit; preview: bilerek throw eden bir test bileşeni mount edip ErrorBoundary'nin teal yerine yeşil primary buton + koyu metin gösterdiğini doğrula; __DEV__ stack bloğu renklerinin de tema ile uyumlu olduğunu gör.

---

### 🟡 MEDIUM — PhaseTimeline ve InsightCard'da tema dışı sabit Material Design palet
- **Dosyalar:** `src/components/plan/PhaseTimeline.tsx`, `src/components/profile/InsightCard.tsx`, `src/lib/theme.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-accent-contrast (StreakBadge+OfflineBanner+PhaseTimeline)`

**Kök-neden:** Doğrulandı. PhaseTimeline.tsx:27-30 gain_muscle '#8B5CF6', health '#06B6D4', conditioning '#F97316' — token'larda olmayan Material tonları (METRIC_COLORS.workout '#7F77DD' ile çakışıyor). InsightCard.tsx:15-18 PATTERN_COLORS tamamen Material: '#E91E63/#FF9800/#9C27B0/#FF5722/#607D8B/#2196F3' — hiçbir token'la örtüşmüyor. PhaseTimeline COLORS (static) kullanıyor; InsightCard useTheme kullanıyor ama PATTERN_COLORS modül-seviyesi sabit.

**Düzeltme:** Hex'leri mevcut token'lara eşle. PhaseTimeline GOAL_COLORS: gain_muscle→COLORS.purple ('#7F77DD'), health→COLORS.protein ('#378ADD') veya COLORS.success, conditioning→COLORS.coral ('#D85A30') veya COLORS.warning. InsightCard PATTERN_COLORS: token alt-kümesinden ata — night_eating→colors.purple, weekend_binge→colors.carbs ('#EF9F27'), stress_eating→colors.pink ('#D4537E'), skipping_meals→colors.coral ('#D85A30'), exercise_avoidance→colors.textMuted, social_eating→colors.protein ('#378ADD'). InsightCard'da PATTERN_COLORS modül-seviyesi olduğundan ya bileşen içine alıp colors'tan türet ya da METRIC_COLORS sabitlerini import et (theme-bağımsız). Yeni token grubu eklemeye gerek yok — mevcut palet yeterli.

```tsx
// PhaseTimeline.tsx
const GOAL_COLORS = { lose_weight: COLORS.primary, gain_weight: COLORS.success, gain_muscle: COLORS.purple, maintain: COLORS.warning, health: COLORS.protein, conditioning: COLORS.coral };
// InsightCard.tsx — import METRIC_COLORS veya colors içinde map
```

**Doğrulama:** tsc --noEmit; preview: çok-fazlı hedefi olan kullanıcıda PhaseTimeline'ın marka tonlarıyla render edildiğini; InsightCard pattern çubuklarının düz-koyu/teal estetiğiyle uyumlu olduğunu gör. Aksan-kontrast bulgusunun beyaz-metin hesabı bu yeni renklerle birlikte test edilmeli.

---

### 🟡 MEDIUM — Card primitive tanımlı ama profile.tsx aynı stili elle kopyalıyor (boşluk sapmış)
- **Dosyalar:** `app/(tabs)/profile.tsx`, `src/components/ui/Card.tsx`
- **Efor:** Orta · **Risk:** med · **batch:** `ui-profile (profile.tsx)`

**Kök-neden:** Doğrulandı. profile.tsx Card import etmiyor; :95/:103/:114 kanonik kart stilini (backgroundColor:colors.card + borderRadius:RADIUS.md + borderWidth:0.5 + borderColor:colors.border) üç ham View'da elle yazıyor ve marginBottom:SPACING.xxl (24) kullanıyor; Card primitive marginBottom:SPACING.md (12). Bu View'lar MenuRow listeleri sarmalıyor (başlıksız konteyner kart).

**Düzeltme:** Üç ham View'ı Card primitive ile değiştir. Card title prop'u opsiyonel olduğundan başlıksız konteyner olarak kullanılabilir; ancak Card iç padding:SPACING.lg ekliyor — MenuRow'lar kendi padding'ini taşıyor, bu yüzden Card'ı style override ile padding:0 vererek geçir (style={{ padding:0, marginBottom: SPACING.xxl }}). Boşluk farkını korumak için marginBottom override'ı SPACING.xxl bırak (sayfa ritmi bozulmasın) VEYA standartlaştırmak istiyorsan tüm sayfayı SPACING.md'ye çek (görsel regresyon riski — minimal-doğru için override tercih et). Card overflow:'hidden' MenuRow son satır border-radius'unu doğru keser.

```tsx
import { Card } from '@/components/ui/Card';
<Card style={{ padding: 0, marginBottom: SPACING.xxl }}>
  <MenuRow ... />
  <MenuRow ... last />
</Card>
```

**Doğrulama:** tsc --noEmit; preview: Profil sekmesinde Hedefler/Ayarlar/Veri kartlarının köşe/kenarlık/iç boşluğunun Card kullanan ekranlarla aynı göründüğünü; MenuRow satır ayraçlarının ve son satır radius'unun bozulmadığını gör.

---

### 🟡 MEDIUM — Toggle anahtarı 3 ekranda elle kopyalanmış ve iki farklı boyutta (48x28 vs 40x24)
- **Dosyalar:** `app/settings/notifications.tsx`, `app/settings/if-settings.tsx`, `app/settings/coach-sharing.tsx`, `src/components/settings/ToggleRow.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `ui-toggles (notifications+if-settings+coach-sharing+ToggleRow)`

**Kök-neden:** Doğrulandı. ToggleRow.tsx primitive 48x28 (knob 24). notifications.tsx:76 ana toggle 48x28 AMA :120 tür-toggle'ları 40x24 (knob 20) — TEK ekranda iki boyut. if-settings.tsx ve coach-sharing.tsx da inline toggle çiziyor (coach-sharing 40x24). notifications inline toggle'lar a11ySwitch zaten taşıyor (a11y kısmı tamam), sorun yalnızca boyut/kopyalama.

**Düzeltme:** Tek standart boyut: 48x28 (ToggleRow ile aynı). En küçük-risk: bir paylaşılan ToggleSwitch görsel primitive'i çıkar (sadece kapsül+knob render eden, label içermeyen) — function ToggleSwitch({value}) → 48x28 View. notifications:120 tür-toggle'larındaki inline View'ı bununla değiştir (40x24→48x28). if-settings:99 ve coach-sharing:239 inline toggle'ları da aynı primitive'e geçir. Tam ToggleRow'a geçmek bu ekranların özel layout'unu (Card içinde, açıklama+aksiyon) bozabilir; bu yüzden yalnızca görsel switch'i ortaklaştır. Alternatif minimal: notifications:120 boyutunu 48x28/knob24 yap (tek dosyada tutarlılık), diğer iki ekranı 48x28'e hizala — primitive çıkarmadan da sweep edilebilir.

```tsx
// src/components/ui/ToggleSwitch.tsx (yeni, görsel-only)
export function ToggleSwitch({ value }: { value: boolean }) {
  const { colors } = useTheme();
  return (<View style={{ width:48,height:28,borderRadius:14,backgroundColor:value?colors.primary:colors.surfaceLight,justifyContent:'center',padding:2 }}><View style={{ width:24,height:24,borderRadius:12,backgroundColor:'#fff',alignSelf:value?'flex-end':'flex-start' }} /></View>);
}
```

**Doğrulama:** tsc --noEmit; preview: notifications ekranında ana + tür toggle'larının AYNI boyutta; if-settings ve coach-sharing switch'lerinin de eşit boyutta olduğunu gör.

---

### 🟡 MEDIUM — Özel toggle/onay-kutusu kontrolleri 'switch'/'checkbox' rolü ve durumunu bildirmiyor
- **Dosyalar:** `src/components/settings/ToggleRow.tsx`, `app/settings/health-events.tsx`, `app/settings/household.tsx`, `src/lib/accessibility.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-toggles (notifications+if-settings+coach-sharing+ToggleRow)`

**Kök-neden:** Kısmen doğrulandı / kısmen abartılı. ToggleRow.tsx:16 TouchableOpacity'de accessibilityRole='switch'/state YOK (doğru). health-events.tsx:61-64 onay kutusu '[x]'/'[ ]' düz metin glifi, role='checkbox' yok (doğru). household.tsx:226 alışveriş kutusu role/state yok (doğru). ANCAK audit'in 'notifications.tsx:75 doğru desen' demesi yerinde — notifications inline toggle'ları zaten a11ySwitch taşıyor; sorun spesifik olarak ToggleRow primitive + iki onay kutusunda.

**Düzeltme:** ToggleRow.tsx:16 TouchableOpacity'ye {...a11ySwitch(label, value)} yay (helper accessibility.ts:134 zaten var: role='switch'+state.checked). health-events.tsx:61 onay-kutusu TouchableOpacity'ye accessibilityRole='checkbox' + accessibilityState={{checked: ongoing}} + accessibilityLabel='Devam ediyor' ekle; '[x]'/'[ ]' düz metin yerine Ionicons (checkbox/square-outline) kullanmak okuyucu için daha temiz ama zorunlu değil. household.tsx:226 TouchableOpacity'ye accessibilityRole='checkbox' + accessibilityState={{checked}} + accessibilityLabel={item.ingredient} ekle.

```tsx
// ToggleRow.tsx
import { a11ySwitch } from '@/lib/accessibility';
<TouchableOpacity onPress={() => onToggle(!value)} {...a11ySwitch(label, value)} ...>
// health-events.tsx:61
<TouchableOpacity onPress={() => setOngoing(!ongoing)} accessibilityRole="checkbox" accessibilityState={{ checked: ongoing }} accessibilityLabel="Devam ediyor" ...>
```

**Doğrulama:** tsc --noEmit; TalkBack/VoiceOver ile (veya RN a11y inspector) ToggleRow'un 'açık/kapalı düğme', onay kutularının 'işaretli/işaretsiz onay kutusu' olarak duyurulduğunu doğrula.

---

### 🟡 MEDIUM — Seçilebilir chip/segment kontrollerinde accessibilityState 'selected' eksik
- **Dosyalar:** `app/settings/health-events.tsx`, `app/settings/progress-photos.tsx`, `app/settings/theme.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-chip-a11y (health-events+progress-photos+theme)`

**Kök-neden:** Doğrulandı. health-events.tsx:51 tür-chip'leri sadece renkle seçim gösteriyor, accessibilityState/role yok. progress-photos.tsx:133 poz-chip'leri aynı. theme.tsx:28 tema seçenekleri seçili durumu sadece border/bg ile; accessibilityState yok ve comingSoon (:30 disabled=true var ama) accessibilityState={{disabled}} verilmemiş (yalnızca opacity 0.5 + native disabled). Not: notifications.tsx daily-limit chip'leri ZATEN accessibilityState selected taşıyor (:92) — sweep dışı.

**Düzeltme:** Her seçim chip TouchableOpacity'sine accessibilityRole='radio' (grup seçimi olduğundan) + accessibilityState={{ selected }} + anlamlı accessibilityLabel ekle. health-events:51 → selected: type===t, label: EVENT_LABELS[t]. progress-photos:133 → selected: selectedPose===pose, label: pose. theme.tsx:28 → accessibilityState={{ selected: active, disabled: !!opt.comingSoon }}, label: opt.label (TouchableOpacity zaten disabled={opt.comingSoon} taşıyor; a11yState'e disabled eklemek okuyucu için açık eder). Renk + state birlikte WCAG 1.4.1/4.1.2'yi karşılar.

```tsx
// health-events.tsx:51
<TouchableOpacity ... accessibilityRole="radio" accessibilityState={{ selected: type===t }} accessibilityLabel={EVENT_LABELS[t]}>
// theme.tsx:28
accessibilityState={{ selected: active, disabled: !!opt.comingSoon }}
```

**Doğrulama:** tsc --noEmit; a11y inspector ile chip'lerin 'seçili/seçili değil radyo düğmesi' ve theme comingSoon'un 'devre dışı' duyurulduğunu doğrula.

---

### 🟡 MEDIUM — Gövde başlıkları native header ile çelişiyor; coach-memory için ÜÇ farklı isim
- **Dosyalar:** `app/settings/strength.tsx`, `app/settings/menstrual.tsx`, `app/settings/coach-memory.tsx`, `app/settings/index.tsx`, `app/settings/_layout.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-title-naming (strength+menstrual+coach-memory+settings-index+settings-layout)`

**Kök-neden:** Doğrulandı. strength.tsx:41 'Güç Progresyonu' (gövde) vs _layout.tsx:43 + index.tsx:119 'Güç Progresyon' (header/menü). menstrual.tsx:56 + _layout.tsx:36 'Regl Döngüsü' vs index.tsx:109 'Adet Döngüsü' (menü). coach-memory ÜÇ isim: _layout.tsx:20 'Koç Hafızası' (header), coach-memory.tsx:180/189/263 Stack.Screen override 'Koçkonun Senin Hakkında Bildikleri' (yazım hatalı — 'Koçkonun' → 'Kochko'nun'), profile.tsx:115 + index.tsx 'Kochko'nun Senin Hakkında Bildikleri' (menü).

**Düzeltme:** Her özellik için tek kanonik Türkçe ad belirle ve üç yerde (menü/native/gövde) eşitle. Önerilen kanonikler: 'Güç Progresyonu' (strength: index.tsx:119 ve _layout.tsx:43 'Progresyon'→'Progresyonu'); 'Regl Döngüsü' (menstrual: index.tsx:109 'Adet Döngüsü'→'Regl Döngüsü', header/gövde zaten doğru); coach-memory için tek ad 'Kochko'nun Senin Hakkında Bildikleri' — coach-memory.tsx:180/189/263 override'larını 'Koçkonun'→'Kochko'nun' düzelt, _layout.tsx:20 'Koç Hafızası'→aynı uzun ad (veya tüm yerleri kısa 'Koç Hafızası'na indir; menü+header+override hepsi aynı olmalı). Marka adı tutarlılığı için 'Kochko' yazımını koru.

```tsx
// _layout.tsx:43
<Stack.Screen name="strength" options={{ title: 'Güç Progresyonu' }} />
// index.tsx:109
label="Regl Döngüsü"
// coach-memory.tsx:180/189/263 + _layout.tsx:20 → tek ad
title: 'Kochko\'nun Senin Hakkında Bildikleri'
```

**Doğrulama:** Grep ile her özellik adının tüm geçtiği yerlerde aynı stringi taşıdığını doğrula; preview: menüden ilgili ekrana girince header ve gövde başlığının menü etiketiyle birebir aynı olduğunu gör.

---

### 🟡 MEDIUM — Button 'sm' varyantı 32dp — WCAG 2.5.5 minimum 44dp altında, hitSlop yok
- **Dosyalar:** `src/components/ui/Button.tsx`, `src/lib/accessibility.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-button (Button.tsx)`

**Kök-neden:** Doğrulandı. Button.tsx:36 height = sm?32:lg?48:40 — sm 32, md 40, ikisi de 44 altında ve TouchableOpacity'de hitSlop yok. accessibility.ts:16 TOUCH_TARGET_SIZE=44 ve :278 getTouchTargetStyle var ama Button'da uygulanmıyor. sm gerçek yan-yana aksiyonlarda kullanılıyor (challenges, onboarding 'Atla').

**Düzeltme:** Button.tsx TouchableOpacity'ye boyuta göre hitSlop ekle (görsel yükseklik aynı kalsın): const hitSlop = size==='sm' ? {top:6,bottom:6,left:4,right:4} : size==='md' ? {top:2,bottom:2} : undefined. Bu sm'de efektif dokunma alanını 32+12=44'e, md'de 40+4=44'e çıkarır. Yatay yan-yana butonlarda left/right hitSlop çakışmasın diye sm'de yatay 4 yeterli (gap SPACING.sm=8 var). getTouchTargetStyle minWidth/minHeight uygulamak yerine hitSlop tercih edilir çünkü yükseklik değişimi mevcut layout'ları kaydırmaz.

```tsx
const hitSlop = size==='sm' ? { top:6, bottom:6, left:4, right:4 } : size==='md' ? { top:2, bottom:2 } : undefined;
<TouchableOpacity ... hitSlop={hitSlop}>
```

**Doğrulama:** tsc --noEmit; preview challenges ekranında yan-yana sm butonların (Duraklat/Bırak) dokunma alanının genişlediğini (yanlış-basış azaldığını) elle test et; görsel yüksekliğin değişmediğini doğrula.

---

### 🔵 LOW — Light tema token'ları WCAG AA fail (gated, regresyon riski)
- **Dosyalar:** `src/lib/theme.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-theme-tokens (theme.ts)`

**Kök-neden:** Doğrulandı. LIGHT_COLORS gated (_layout.tsx yalnızca dark yükler, theme.tsx light/system 'Yakında'). theme.ts:99 light textMuted '#94A3B8' beyaz üstünde ~2.56:1, surfaceLight üstünde ~2.29:1 (AA fail). :102 warning '#EF9F27' metin olarak beyaz üstünde ~2.17:1 fail. Bugün etkisiz ama light açılırsa regresyon. (Not: dark textMuted zaten '#8E8EA3'e bumped — düzgün.)

**Düzeltme:** LIGHT_COLORS.textMuted'ı '#64748B'e koyulaştır (beyaz üstünde ~4.8:1, surfaceLight üstünde ≥4.5). warning'i ikiye ayırma yerine minimal: warning dolgu/ikon için kalsın; ancak warning'i METİN renginde kullanan yerler için light'ta daha koyu bir değer gerekir — tek token olduğundan light warning'i '#B26A00'e çek (dolgu/ikon olarak da kabul edilebilir koyu turuncu, metin olarak ~4.6:1). Dark değerleri DOKUNMA. Bu salt gelecek-regresyon önlemi; light şu an render edilmiyor.

```tsx
// LIGHT_COLORS
textMuted: '#64748B',
warning: '#B26A00', warningLight: '#B26A0020',
```

**Doğrulama:** node ile getContrastRatio('#64748B','#FFFFFF')≥4.5 ve getContrastRatio('#B26A00','#FFFFFF')≥4.5 doğrula. Light tema gated olduğundan görsel preview gereksiz; meetsContrastAA helper'ıyla assert et.

---

### 🔵 LOW — Elevation token'ları aynı değere indirgenmiş — kart katmanlaması ayırt edilemiyor
- **Dosyalar:** `src/lib/theme.ts`, `src/lib/constants.ts`, `src/components/profile/InsightCard.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-theme-tokens (theme.ts)`

**Kök-neden:** Kısmen doğrulandı. theme.ts dark card '#1A1A24' / cardElevated '#22222E' (luminans farkı çok küçük ama surfaceLight ile eşit). light card===cardElevated==='#FFFFFF' (sıfır fark). constants.ts CARD_SHADOW=ELEVATED_SHADOW=CARD_BORDER — 'elevated' semantiği anlamsız. Audit 'InsightCard'da elevated kullanımda' diyor; gerçekte InsightCard CARD_SHADOW kullanıyor (ELEVATED_SHADOW değil), light'ta border yerine. Yani ELEVATED_SHADOW deprecated ve fiilen kullanılmıyor olabilir — gerçek kullanımı grep ile teyit edilmeli.

**Düzeltme:** İki seçenek (minimal-doğru): (A) Light cardElevated'ı '#F7F9FB'e ayır ve dark cardElevated'ı surfaceLight'tan biraz ayrıştır (örn '#262631') ki iç içe kartlar ayrışsın. (B) Daha temiz: deprecated ELEVATED_SHADOW/GRADIENTS/HERO_GRADIENTS'i grep ile kullanım 0 ise kaldır ve tek 'card + border' modeline indir. Önce grep: ELEVATED_SHADOW ve cardElevated kullanımlarını say; kullanım yoksa (B), varsa (A) light cardElevated farkını aç. Bu LOW olduğundan kapsamı dar tut: light cardElevated'ı '#F7F9FB' yapmak tek satır ve light açıldığında iç içe kartları kurtarır.

**Doğrulama:** Grep 'cardElevated' ve 'ELEVATED_SHADOW' kullanım sayısı; kullanılıyorsa light tema preview'da iç içe kart ayrımını gör (gated olduğu için kod incelemesi yeterli).

---

### 🔵 LOW — TempoChart 'Gerçekleşen' çizgisi veri olmayan haftalarda carry-forward sahte kilo gösteriyor
- **Dosyalar:** `src/components/plan/TempoChart.tsx`
- **Efor:** Orta · **Risk:** med · **batch:** `ui-tempochart (TempoChart.tsx)`

**Kök-neden:** Doğrulandı. TempoChart.tsx:47-49 veri olmayan haftada son okuma ileri taşınıyor (actualSeries.push(actualSeries[last] ?? startWeight)). Çizgi o haftalarda yatay devam edip ölçülmemiş veriyi ölçülmüş gibi sunuyor. :53 ETA slice(-3) ile carry-forward'lu seriyi kullandığından kısmi boşlukta tempo yanlış olabilir. chart-kit null kabul etmediğinden boşluk doğrudan çizilemiyor.

**Düzeltme:** Veri dürüstlüğü için: gerçek ölçüm haftalarını ayrı bir actualReal[] dizisinde tut (boşluk olanları işaretle). Görsel: chart-kit null almadığından, son gerçek ölçümden sonraki haftaları çizmeyi durdur — actualSeries'i son gerçek ölçümün indeksinde kes (datasets'e kısa dizi ver; chart-kit kısa dataset'i destekler ama x-ekseni hizası bozulur — bu yüzden alternatif: carry-forward'u koru ama o noktaların propsForDots'unu gizle ve ETA'yı yalnızca gerçek ölçümlerden hesapla). Minimal-doğru: (1) ETA'yı carry-forward'lu seri yerine sadece gerçek ölçümü olan haftalardan (actualByWeek dolu olanlar) hesapla — recentWeeks'i gerçek ölçüm dizisinden al. (2) Çizgi için kesik/soluk stil: son gerçek ölçümden sonrası için ikinci bir 'projeksiyon' dataset'i ekleyip soluk renk (colors.textMuted + opacity) ver, ana actual dataset'i son gerçek noktada bitir. Eğer chart-kit kısa dataset hizası sorun çıkarırsa, en az ETA düzeltmesini uygula (S efor, veri güvenilirliği kazancı).

```tsx
// ETA için gerçek ölçüm haftaları
const realWeeks = Object.keys(actualByWeek).map(Number).sort((a,b)=>a-b);
const realVals = realWeeks.map(w => actualByWeek[w][actualByWeek[w].length-1]);
const recent = realVals.slice(-3); // carry-forward'lu actualSeries yerine
```

**Doğrulama:** tsc --noEmit; kk.mjs/q.mjs ile tartı boşluğu olan bir hedef senaryosu kur, preview'da Gerçekleşen çizgisinin son ölçümden sonra yatay-sahte gitmediğini ve ETA metninin sadece gerçek ölçümlere dayandığını gör.

---

### 🔵 LOW — CircularProgress merkez metni maxFontSizeMultiplier sınırlamıyor — büyük fontta ring taşması
- **Dosyalar:** `src/components/ui/CircularProgress.tsx`, `src/lib/constants.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-circularprogress (CircularProgress.tsx)`

**Kök-neden:** Doğrulandı. CircularProgress.tsx:77-95 value/unit/label/sublabel Text'leri maxFontSizeMultiplier almıyor; ring sabit size (varsayılan ~160/170) ile çizildiğinden sistem font ölçeği %130-150'de çok haneli değer ringi taşırır. constants.ts:14-20 MAX_FONT_SCALE=1.3 ve 'progress labels should pass this' yorumu var ama primitive uygulamıyor.

**Düzeltme:** CircularProgress.tsx:77/81/87/92 dört merkez Text'ine maxFontSizeMultiplier={MAX_FONT_SCALE} ekle (import { MAX_FONT_SCALE } from '@/lib/constants'). Ring sabit boyutlu olduğundan bu, ölçeği 1.3'te sınırlayarak taşmayı önler. Tek satır eklemeler.

```tsx
import { MAX_FONT_SCALE } from '@/lib/constants';
<Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{...}}>{value}</Text>
// unit, label, sublabel için de aynı prop
```

**Doğrulama:** tsc --noEmit; preview: cihaz/emülatör font ölçeğini %150'ye al, dashboard hero ringinde çok haneli kalori (ör. 1450) değerinin ring içinde kaldığını ve alt etiketle çakışmadığını gör.

---

### 🔵 LOW — EmptyState CTA'sı Button primitive yerine kendi butonunu elle yazıyor
- **Dosyalar:** `src/components/ui/EmptyState.tsx`, `src/components/ui/Button.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-emptystate (EmptyState.tsx)` · **Bağımlı:** [MEDIUM] Button 'sm' varyantı 32dp — WCAG 2.5.5 minimum 44dp altında, hitSlop yok

**Kök-neden:** Doğrulandı. EmptyState.tsx:34-41 CTA için inline TouchableOpacity + colors.primary + getContrastColor; activeOpacity/disabled/loading yok ve Button'ın boyut/touch-target/ileride eklenecek a11y politikasından bağımsız. role/label var (bu yüzden LOW). Button primitive aynı görsel sonucu verir (variant='primary').

**Düzeltme:** EmptyState.tsx:33-42 inline CTA'yı <Button title={ctaLabel} onPress={onPressCta} /> ile değiştir. Button zaten primary bg + getContrastColor metin + activeOpacity 0.7 veriyor; marginTop:SPACING.xl'i saran View ya da Button style prop'u ile koru. getContrastColor import'u CTA kaldırılınca gerekiyorsa temizle. Bu, Button'a eklenecek hitSlop (sm/md bulgusu) ve a11y düzeltmelerinin CTA'ya otomatik yansımasını sağlar.

```tsx
{ctaLabel && onPressCta ? (
  <View style={{ marginTop: SPACING.xl }}>
    <Button title={ctaLabel} onPress={onPressCta} />
  </View>
) : null}
```

**Doğrulama:** tsc --noEmit; preview: bir boş-durum (örn boş sohbet/plan) ekranında CTA'nın Button görünümüyle (yeşil bg, koyu metin, basış opaklığı) render edildiğini gör.

---

### 🔵 LOW — DateTimeField minimumDate/maximumDate desteklemiyor — gelecek tarih seçilebiliyor (menstrual)
- **Dosyalar:** `src/components/ui/DateTimeField.tsx`, `app/settings/menstrual.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-datetimefield (DateTimeField.tsx+menstrual)`

**Kök-neden:** Doğrulandı. DateTimeField.tsx:13-20 Props min/maxDate almıyor; :64-76 DateTimePicker'a geçirilmiyor. menstrual.tsx 'Son Regl Başlangıcı' (mode='date') için kullanıyor — picker gelecek tarihi serbest bırakıyor; bu değer dayOfCycle/faz tahminlerine hatalı yansır (sessiz veri bozulması).

**Düzeltme:** DateTimeField Props'a minimumDate?: Date; maximumDate?: Date ekle ve :64 DateTimePicker'a {...(minimumDate?{minimumDate}:{})} {...(maximumDate?{maximumDate}:{})} olarak geçir. menstrual.tsx'teki DateTimeField çağrısına maximumDate={new Date()} ekle (son regl gelecekte olamaz). Geriye dönük uyumlu (opsiyonel proplar).

```tsx
// DateTimeField.tsx
interface Props { ...; minimumDate?: Date; maximumDate?: Date; }
<DateTimePicker ... minimumDate={minimumDate} maximumDate={maximumDate} />
// menstrual.tsx
<DateTimeField mode="date" ... maximumDate={new Date()} />
```

**Doğrulama:** tsc --noEmit; preview menstrual ekranında tarih picker'ı açıp gelecek günlerin seçilemez/gri olduğunu doğrula; bugünün seçilebildiğini gör.

---

### 🔵 LOW — Kilo trend grafiği renkleri ekranlar arası ve marka metrik rengiyle tutarsız
- **Dosyalar:** `app/(tabs)/progress.tsx`, `app/reports/monthly.tsx`, `src/lib/theme.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-weight-chart (progress+monthly)`

**Kök-neden:** Doğrulandı. METRIC_COLORS.weight='#D4537E' (pembe) marka kilo rengi; progress.tsx:211 özet ikonu colors.pink kullanıyor AMA :50 chartConfig.color sabit 'rgba(29,158,117)' (teal) ve :227 kilo grafiği bu config'i uyum grafiğiyle PAYLAŞIYOR. monthly.tsx:146 ProgressChart'a color={COLORS.secondary} ('#7F77DD' mor) geçiyor. ProgressChart.tsx:30 default color=COLORS.primary. Aynı 'kilo trendi' üç farklı renkte (teal/mor/pembe-özet).

**Düzeltme:** Kilo grafiklerini METRIC_COLORS.weight'e bağla. monthly.tsx:146 → <ProgressChart ... color={METRIC_COLORS.weight} /> (import METRIC_COLORS). progress.tsx kilo grafiği için ayrı bir weightChartConfig üret (chartConfig'i kopyalayıp color'ı (o=1)=>`rgba(212,83,126,${o})` yap — #D4537E) ve :230 weight LineChart'a weightChartConfig ver; uyum grafiği (:260) mevcut teal config'de kalsın (uyum=success/teal mantıklı). Böylece kilo her yerde pembe, özet ikonuyla (colors.pink) tutarlı.

```tsx
// progress.tsx
const weightChartConfig = { ...chartConfig, color: (o=1)=>`rgba(212,83,126,${o})`, propsForDots:{ r:'3', strokeWidth:'1.5', stroke: colors.pink } };
// :230 chartConfig={weightChartConfig}
// monthly.tsx:146
<ProgressChart ... color={METRIC_COLORS.weight} />
```

**Doğrulama:** tsc --noEmit; preview: progress kilo grafiği + özet ikonu + monthly kilo grafiğinin hepsinin pembe (#D4537E) olduğunu, uyum grafiğinin teal kaldığını gör.

---

### 🔵 LOW — PhaseTimeline currentWeek totalWeeks'i aştığında bozuk metin ('Hafta 20 / 16')
- **Dosyalar:** `src/components/plan/PhaseTimeline.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-accent-contrast (StreakBadge+OfflineBanner+PhaseTimeline)`

**Kök-neden:** Doğrulandı. PhaseTimeline.tsx:118 `Hafta {currentWeek} / {totalWeeks}` clamp'siz. :45 totalWeeks fazların targetWeeks toplamı; kullanıcı süreyi aşarsa 'Hafta 20 / 16' çıkar. Bar'da 'şu an' işaretçisi de yok (:60-94 statik bloklar; :116 sadece nokta+metin).

**Düzeltme:** Minimal: :118 metnini clamp et — `Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}` ve aşım varsa ` (+${currentWeek-totalWeeks} hafta)` ek metni göster. 'Şu an' işaretçisi ekleme (bar üzerinde konum) ayrı/opsiyonel iyileştirme, bu LOW kapsamında yapılmasa da olur — clamp tek satır yeterli.

```tsx
<Text ...>Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}{currentWeek > totalWeeks ? ` (+${currentWeek - totalWeeks} hafta)` : ''}</Text>
```

**Doğrulama:** tsc --noEmit; preview/birim: currentWeek=20, totalWeeks=16 ile render edip metnin 'Hafta 16 / 16 (+4 hafta)' geldiğini doğrula.

---

### 🔵 LOW — Ölü prop'lar: dashboard'da tarih, uyku/kilo hiç render edilmiyor
- **Dosyalar:** `src/components/dashboard/HeroSection.tsx`, `src/components/dashboard/StatStrip.tsx`, `app/(tabs)/index.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `ui-dashboard-props (HeroSection+StatStrip+index)`

**Kök-neden:** Doğrulandı. HeroSection.tsx:16 today prop tanımlı, :73 destructure ediliyor ama JSX'te hiç render edilmiyor (selamlama altında tarih yok). StatStrip.tsx:12-19 Props sleepHours/weightKg tanımlı ama :78 imza yalnızca {waterLiters, waterTarget, steps, onAddWater} destructure ediyor — sleepHours/weightKg ölü; sadece Su+Adım (2 kart) render. index.tsx bu propları geçiriyor.

**Düzeltme:** İki seçenek; ürün kararına göre. Tercih (render et): HeroSection'da selamlamanın altına today'i alt-metin olarak ekle (<Text style={{color:colors.textSecondary, fontSize:FONT.sm}}>{today}</Text>). StatStrip'i 2x2 grid'e çevir: :78 imzaya sleepHours, weightKg ekle ve iki StatCard daha render et (Uyku: icon='moon', color=METRIC_COLORS.sleep, value=sleepHours?`${sleepHours} sa`:'-'; Kilo: icon='scale', color=METRIC_COLORS.weight, value=weightKg?`${weightKg} kg`:'-'). Alternatif (sil): kullanılmayan propları HeroSection/StatStrip imzasından ve index.tsx çağrısından kaldır. Minimal-doğru ve kullanıcı-değeri için render etmeyi öner (veriler zaten geçiriliyor).

```tsx
// HeroSection selamlama altına
{today ? <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{today}</Text> : null}
// StatStrip:78
export function StatStrip({ waterLiters, waterTarget, steps, sleepHours, weightKg, onAddWater }: Props) { ... 2x2 grid }
```

**Doğrulama:** tsc --noEmit; preview dashboard: selamlama altında tarih, StatStrip'te Su/Adım/Uyku/Kilo dört kartının (veya prop kaldırıldıysa lint'te ölü-prop uyarısının kalktığını) göründüğünü doğrula.

---

### 🔵 LOW — accessibility.ts kütüphanesinin yarısı ölü kod — anlamlı <Image>'lar etiketsiz
- **Dosyalar:** `src/lib/accessibility.ts`, `app/settings/progress-photos.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `ui-a11y-images (accessibility.ts+progress-photos)`

**Kök-neden:** Doğrulandı (dosya-dışı kullanım taranmalı). accessibility.ts'te a11yText/a11yImage/a11yLink/a11yTab/getTouchTargetStyle/getAccessibilityProps/formatForScreenReader/complianceDescription/meetsContrastAA tanımlı ama bazıları kullanılmıyor (grep ile teyit gerek). progress-photos.tsx:173/180/204 <Image>'ları accessibilityLabel taşımıyor (foto + karşılaştırma modal). a11yImage hiç kullanılmamış.

**Düzeltme:** İki parça. (1) progress-photos.tsx:173/180/204 <Image>'lara a11yImage(label) yay — örn earliest: a11yImage(`Başlangıç fotoğrafı, ${tarih}`), latest: a11yImage(`Güncel fotoğraf, ${tarih}`), timeline foto: a11yImage(`${pose} pozu`). Dekoratif olanlar yoksa hepsi anlamlı. (2) Ölü export temizliği: önce her export için grep ile dosya-dışı kullanım say; gerçekten 0 kullanılanları (örn formatForScreenReader, complianceDescription, getTouchTargetStyle uygulanmıyorsa) kaldır VEYA en az birini bağla. Minimal-doğru: a11yImage'i progress-photos'a bağla (somut a11y kazancı) ve gerçekten 0-kullanım export'ları kaldır; meetsContrastAA gibi test-yardımcılarını light-token doğrulamasında kullandığımız için koru.

```tsx
import { a11yImage } from '@/lib/accessibility';
<Image source={{ uri }} style={{...}} {...a11yImage(`Başlangıç fotoğrafı, ${tarih}`)} />
```

**Doğrulama:** tsc --noEmit; Grep ile her accessibility export'unun kullanım sayısı (temizlik öncesi); a11y inspector ile progress-photos görsellerinin etiketli okunduğunu doğrula.

---

### ⚪ NIT — RADIUS ölçeğinde xl ve xxl ikisi de 24; SPACING'de 20 adımı yok
- **Dosyalar:** `src/lib/constants.ts`, `src/components/profile/InsightCard.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-theme-tokens (theme.ts)`

**Kök-neden:** Doğrulandı. constants.ts:11 RADIUS = { sm:8, md:12, lg:16, xl:24, xxl:24, pill:99, full:999 } — xl===xxl===24 (ölçek anlamsız). :7 SPACING xl=16 → xxl=24 (20 adımı yok). Kart köşeleri md/lg/xl karışık kullanılıyor (InsightCard RADIUS.xl=24, Card RADIUS.md=12).

**Düzeltme:** Düşük-risk hijyen: RADIUS.xxl'i kaldırmak yerine (kırılma riski — grep ile kullanım kontrol et) gerçek değere ayır: xl:20, xxl:24 (böylece 16→20→24 düzgün ölçek). Kullanım denetimi: RADIUS.xxl kullanan yer varsa o yer 24 beklediği için xxl:24 kalsın, xl:20'ye in. Kart yarıçapı standardı belirle: tek 'kart radius' olarak RADIUS.md (12) ya da RADIUS.lg (16) seç ve InsightCard RADIUS.xl→seçilen kart token'ı (Card ile tutarlı, görsel ufak değişiklik). NIT olduğundan kapsamı dar tut: en az xl/xxl'i ayrıştır, InsightCard'ı Card'ın RADIUS.md'sine hizala.

```tsx
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, pill: 99, full: 999 } as const;
// InsightCard.tsx: borderRadius: RADIUS.md (Card ile tutarlı)
```

**Doğrulama:** tsc --noEmit; Grep 'RADIUS.xl' ve 'RADIUS.xxl' kullanımları; preview: InsightCard köşesinin diğer kartlarla aynı yarıçapta olduğunu gör.

---

### ⚪ NIT — Login ve Register logo/başlık blokları görünür biçimde farklı
- **Dosyalar:** `app/(auth)/login.tsx`, `app/(auth)/register.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-auth-header (login+register)`

**Kök-neden:** Doğrulandı. login.tsx:64-66 logo letterSpacing:2 + alt başlık marginTop:SPACING.xs + blok marginBottom:SPACING.xxl. register.tsx:82-84 letterSpacing yok, alt başlık marginTop yok, blok marginBottom:SPACING.lg. İki ekran yan yana farklı görünüyor.

**Düzeltme:** İki dosyada aynı değerleri kullan (ortak bileşene çıkarmak NIT için fazla). register.tsx:82 blok marginBottom:SPACING.lg → SPACING.xxl; :83 logo Text'e letterSpacing:2 ekle; :84 alt başlık Text'e marginTop:SPACING.xs ekle. Böylece register login'le birebir aynı olur. (İsteğe bağlı ileride AuthBrandHeader bileşeni — bu NIT'in kapsamı dışında.)

```tsx
// register.tsx:82-84
<View style={{ alignItems:'center', marginBottom: SPACING.xxl }}>
  <Text style={{ fontSize: FONT.hero, fontWeight:'800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
  <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Hesap Oluştur</Text>
</View>
```

**Doğrulama:** tsc --noEmit; preview: login↔register arası geçişte logo/başlık bloğunun harf-aralığı ve boşluklarının zıplamadığını gör.

---

### ⚪ NIT — İki ayrı '+' eylemi aynı görsel dilde; Plan sekmesi etiketsiz FAB
- **Dosyalar:** `app/(tabs)/_layout.tsx`, `app/(tabs)/chat.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `ui-chat-icon (chat.tsx)`

**Kök-neden:** Doğrulandı / düşük etki. _layout.tsx:33 merkezi FAB Ionicons name='add' size=28 (log'a gider), accessibilityLabel taşıyor (:31). chat.tsx:221 yeni-sohbet butonu da 'add' (size=22). İki '+' aynı görsel dilde ama farklı bağlamda (tab bar merkez vs chat header) — çakışma riski düşük. Tab bar Plan slotu :78 title:'' (görünür etiket yok, yalnızca accessibilityLabel).

**Düzeltme:** Görsel ayrım için chat.tsx:221 yeni-sohbet ikonunu 'add' → 'create-outline' (veya 'add-circle-outline') yap; merkezi FAB 'add' kalsın. Bu, iki '+' eylemini görsel olarak ayırır. Merkezi FAB için küçük görünür etiket eklemek tab bar layout'unu etkileyeceğinden (ve accessibilityLabel zaten var) NIT kapsamında bırakılabilir; minimal değişiklik yalnızca chat ikon değişimi.

```tsx
// chat.tsx:221
<Ionicons name="create-outline" size={22} color={...} />
```

**Doğrulama:** tsc --noEmit; preview: chat header yeni-sohbet butonunun kalem/oluştur ikonuna döndüğünü, merkezi FAB'ın '+' kaldığını gör.

---

### 🧹 Toplu Süpürmeler — UI

**Türkçe diakritik geri-ekleme süpürmesi (ASCII'ye soyulmuş ekranlar)** _(efor: Orta)_
- Dosyalar: `app/settings/progress-photos.tsx`, `app/settings/data-import.tsx`, `app/settings/debug-mode.tsx`, `app/settings/supplements.tsx`, `app/settings/theme.tsx`
- Birkaç ayar ekranı komşularından farklı olarak ASCII'ye soyulmuş Türkçe metin içeriyor; native header doğru diakritikli, gövde yanlış. Mekanik bul-değiştir ile düzelt. Doğrulanan örnekler: progress-photos.tsx:125 'Ilerleme Fotograflari'→'İlerleme Fotoğrafları', :127 'Fotograflar/cihazinda/saklanir/ucuncu/gonderilmez', :157 'Fotograflari Karsilastir', :165 'Karsilastirma', :177 'Baslangic', :184 'Guncel', :189; data-import.tsx:44 'Veri Iceri Aktar'→'Veri İçeri Aktar', :91 'Iceri Aktar'→'İçeri Aktar'; debug-mode.tsx:47 'Gelistirici Modu'→'Geliştirici Modu', :55 'Hayir'→'Hayır'; supplements.tsx:12/17 '1 olcu'→'1 ölçü', :14 '1 kapsul'→'1 kapsül'; theme.tsx:14 'Goz yorgunlugunu...'→'Göz yorgunluğunu...', :16 'Her Zaman Acik'→'Her Zaman Açık' (ve diğer desc'ler). Her ekranı açıp tüm soyulmuş Türkçe kelimeleri diakritikli haline getir; başka soyulmuş metin kalmadığını grep ile doğrula.
- **Yaklaşım:** Her dosyada elle/Edit ile doğru Türkçe karakterleri geri yaz (otomatik toplu-regex riskli — kelime bazında düzelt). Tamamlandığında Grep ile pattern '\b(Ilerleme|Fotograf|Karsilastir|Iceri|Gelistirici|Hayir|olcu|kapsul|Goz|Acik|cihazinda|ucuncu)\b' app/settings içinde 0 eşleşme verene kadar tekrarla. Yazım/anlam değişmez, sadece diakritik.

**Long-press-only yıkıcı silme → görünür+erişilebilir sil butonu (a11y, KVKK) [HIGH ana, ilişkili MEDIUM/LOW dokunuşları içerir]** _(efor: Küçük)_
- Dosyalar: `src/components/profile/InsightCard.tsx`, `app/settings/progress-photos.tsx`
- NOT: Ana bulgu HIGH (kapsam dışı) ama PhaseTimeline/InsightCard/progress-photos gibi bu görevdeki MEDIUM/LOW dosyalarla AYNI dosyalara dokunuyor — batch çakışmasını önlemek için burada işaretlendi. InsightCard.tsx:47/58/84 ve progress-photos.tsx:202 onLongPress-only silme barındırıyor; bu görevde InsightCard (palet/elevation) ve progress-photos (diakritik/a11yImage) düzenlenirken aynı satırlara dokunulacak. Silme-butonu eklemesi ile bu görevdeki düzenlemeler aynı PR/worktree'de birleştirilirse merge çakışması olur.
- **Yaklaşım:** Bu görev kapsamındaki InsightCard ve progress-photos düzenlemelerini HIGH silme-butonu çalışmasıyla aynı batchKey altında sırala (ui-insightcard ve ui-a11y-images batch'lerini HIGH ile koordine et). Görev kapsamında HIGH'ı UYGULAMA, sadece batch planlamasında çakışmayı not et.

---

## UX / Akış, Etkileşim & İçerik

_26 kart — 🔴 0 · 🟠 7 · 🟡 11 · 🔵 8 · ⚪ 0 · 🧹 3 süpürme_

### 🟠 HIGH — Plan ekranları (diyet & antrenman) ağ hatasında sonsuz spinner'da kalıyor — hata/retry durumu yok
- **Dosyalar:** `app/plan/diet.tsx`, `app/plan/workout.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `plan-screens`

**Kök-neden:** app/plan/diet.tsx:90-108 ve app/plan/workout.tsx:78-93 'teki load() callback'leri try/catch içermiyor. setView('loading'->'empty'/'draft'/'active') geçişi SADECE başarı yolunda yapılıyor. Promise.all([getActive,getDraft,goals]) ağ-katmanı reddiyle (fetch TypeError / Supabase 5xx) reddederse setView hiç çağrılmaz, view kalıcı 'loading' kalır ve render dalı (view==='loading' -> ActivityIndicator, diet.tsx:312-318 / workout.tsx:284-290) süresiz spinner gösterir. Retry/pull-to-refresh yok. ViewState tipi (diet.tsx:54) 'loading'|'empty'|'draft'|'active' — 'error' state yok. reports/daily.tsx:49-101 doğru deseni (try/catch -> setError + 'Tekrar dene' butonu, loadReport ile retry) zaten uyguluyor; net tutarsızlık.

**Düzeltme:** Her iki ekranda ViewState tipine 'error' ekle (type ViewState = 'loading'|'empty'|'draft'|'active'|'error'). load() gövdesini try/catch ile sar: try içinde mevcut Promise.all + setView mantığı; catch içinde mountedRef kontrolünden sonra setView('error') (+ haptics.error opsiyonel). Render kısmına view==='loading' dalından sonra view==='error' dalı ekle: reports/daily.tsx:94-101 ile birebir aynı düzen — cloud-offline-outline ikonu + 'Plan yüklenemedi' başlığı + 'Bağlantını kontrol edip tekrar dene.' + Button title='Tekrar dene' onPress={load}. load zaten useCallback, doğrudan onPress'e bağlanabilir. Stack.Screen options aynı başlıkla korunmalı.

```tsx
const load = useCallback(async () => {
  if (!user?.id) return;
  try {
    if (!profile) await fetchProfile(user.id);
    const [activeRow, draftRow, goalRes] = await Promise.all([...]);
    if (!mountedRef.current) return;
    setActive(activeRow); setDraft(draftRow); setGoal(...);
    if (draftRow) setView('draft'); else if (activeRow) setView('active'); else setView('empty');
  } catch {
    if (mountedRef.current) setView('error');
  }
}, [...]);

// render
if (view === 'error') return (<View center><Ionicons name="cloud-offline-outline"/><Text>Plan yüklenemedi</Text><Button title="Tekrar dene" onPress={load}/></View>);
```

**Doğrulama:** npx tsc --noEmit (yeni 'error' state'in tip uyumu). kk.mjs canlı: uçağ modu / Supabase URL'yi geçersiz kılarak plan/diet ve plan/workout ekranlarını aç; sonsuz spinner yerine 'Plan yüklenemedi' + 'Tekrar dene' görünmeli, bağlantı dönünce buton planları yüklemeli. Preview ekranda her iki view döngüsü manuel test.

---

### 🟠 HIGH — Plan taslak/revizyon ekranında chatSessionId yeniden hidrate edilmiyor — kalıcı taslak ölü uca düşürüyor
- **Dosyalar:** `app/plan/diet.tsx`, `app/plan/workout.tsx`
- **Efor:** Orta · **Risk:** med · **batch:** `plan-screens` · **Bağımlı:** Plan ekranları (diyet & antrenman) ağ hatasında sonsuz spinner'da kalıyor — hata/retry durumu yok

**Kök-neden:** chatSessionId yalnızca bellekteki React state (diet.tsx:75 / workout.tsx benzer) ve sadece startDraftCreation (diet.tsx:124) ve handleStartRevision (diet.tsx:294) içinde set ediliyor. load() (diet.tsx:90-108) getDraft taslak bulunca setView('draft') yapar ama chatSessionId'yi geri yüklemez. Sonraki mount/odakta useFocusEffect->load() taslağı yeniden çizer, chatSessionId null kalır. sendUserMessage (diet.tsx:150), handleAlternative (diet.tsx:171), handleApprove (diet.tsx:212) hepsi 'if (!chatSessionId ...) return' ile sessizce erken çıkar -> composer'a yazıp gönderince HİÇBİR ŞEY olmaz; 'Onayla ve kaydet' / 'Alternatif gör' sessizce yutulur. Tam ölü uç. workout.tsx aynı kusuru taşıyor.

**Düzeltme:** Minimal-doğru: chatSessionId null iken sessiz return yerine kullanıcıya geri-bildirim/oturum türetme. İki seçenek: (A) load() taslak bulunca chatSessionId null ise yeni bir oturum türetip setChatSessionId ile bağla (createSession({title:'Diyet planı revizyonu', topicTags:['plan_diet']})) — taslağa devam edilebilir hale gelir. (B) En azından sendUserMessage/handleAlternative/handleApprove içinde 'if (!chatSessionId)' dalında sessiz return yerine bir assistant balonu/Alert göster ('Bu taslağa devam etmek için yeniden başlatman gerekiyor') VEYA o noktada lazy createSession yap. Önerilen: load()'ta draft varsa ve chatSessionId yoksa createSession ile yeni oturum türet (kalıcı bağ için ileride plan_versions/draft satırına chat_session_id kolonu eklenebilir — ama bu migration finding'i ayrı; şimdilik runtime türetme yeterli). handleApprove/handleAlternative aynı türetilmiş id'yi kullanır.

```tsx
const load = useCallback(async () => {
  ... if (draftRow) {
    setView('draft');
    if (!chatSessionId) {
      const sid = await createSession({ title: 'Diyet planı revizyonu', topicTags: ['plan_diet'] });
      if (sid && mountedRef.current) setChatSessionId(sid);
    }
  } ...
}, [user?.id, fetchProfile, chatSessionId]);
```

**Doğrulama:** kk.mjs canlı: taslak oluştur, uygulamayı kapat/aç (veya tab değiş-dön), plan/diet aç -> taslak çizilir; composer'a mesaj yaz+gönder -> AI yanıt vermeli (sessiz yutma OLMAMALI); 'Alternatif gör' ve 'Onayla ve kaydet' çalışmalı. q.mjs ile chat_sessions'ta plan_diet topic_tag'li yeni oturum oluştuğunu doğrula. tsc --noEmit.

---

### 🟠 HIGH — OAuth (Google/Apple) kullanıcılarında birth_year hiç toplanmıyor — yanlış TDEE, çözülemeyen 'Kendini tanıt' görevi, bloke plan
- **Dosyalar:** `app/onboarding.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `onboarding`

**Kök-neden:** birth_year YALNIZCA e-posta kaydında toplanıyor: register.tsx -> auth.store.ts:59-70 signUp options.data.birth_year -> mig 044 trigger profiles'a kopyalar. auth.store.ts:78-151 signInWithGoogle/signInWithApple hiçbir metadata göndermiyor. OAuth kullanıcısı onboarding'e düşer ama QuickForm (onboarding.tsx:166-348) yalnız 6 alan (boy/kilo/hedef-kilo/cinsiyet/hedef/aktivite) toplar; yaşı ne sorar ne yazar. handleComplete (onboarding.tsx:248-252) yaşı yalnız user_metadata.birth_year'dan okur, yoksa age=30'a düşer ve update()'te (onboarding.tsx:261-276) birth_year HİÇ set edilmez -> profiles.birth_year süresiz NULL. Sonuç: (1) TDEE age=30 ile hesaplanır (calculateBMR satır 253) -> kalori hedefi sapar; (2) introduce_yourself görevi birth_year şartlı (onboarding-tasks.service.ts:41) -> ASLA tamamlanmaz; (3) plan-readiness.ts:74 'Yaş' eksik -> plan bloklanır. Mitigasyon: kullanıcı chat'te yaşını söylerse ai-chat düzeltir, ama varsayılan durumda hata mevcut. DB tarafı hazır: database.ts:50 profiles.birth_year mevcut.

**Düzeltme:** QuickForm'a koşullu doğum yılı alanı ekle. (1) State: const [birthYear, setBirthYear] = useState(initialDraft?.birthYear ?? ''). (2) metaBirthYear'ı handleComplete'ten çıkarıp component üstüne taşı (zaten satır 248'de okunuyor) ve needsBirthYear = !(Number.isFinite(metaBirthYear) && metaBirthYear>1900). (3) Render: needsBirthYear iken boy/kilo Input bloğuna bir Input ekle (label='Doğum Yılı', keyboardType='number-pad', placeholder='1995', value={birthYear}, onChangeText={setBirthYear}). (4) isValid'e dahil et: && (!needsBirthYear || birthYear). missingLabel zincirine 'doğum yılını' ekle. (5) handleComplete'te age hesabını: const by = needsBirthYear ? parseInt(birthYear) : metaBirthYear; ve age = Number.isFinite(by) && by>1900 && by<=nowYear ? Math.max(18, nowYear-by) : 30. (6) update() payload'ına needsBirthYear && birthYear iken birth_year: parseInt(birthYear) ekle. (7) saveOnboardingDraft debounce'una birthYear'ı ekle (OnboardingDraft tipinde alan açmak gerekebilir). 18+ guard'ı da kontrol et: age<18 ise Alert + return (signUp'taki gibi).

```tsx
const metaBirthYear = Number((user as any)?.user_metadata?.birth_year);
const needsBirthYear = !(Number.isFinite(metaBirthYear) && metaBirthYear > 1900);
const [birthYear, setBirthYear] = useState('');
const isValid = heightCm && weightKg && gender && goalType && activity && (!needsTargetWeight||targetWeightKg) && (!needsBirthYear||birthYear);
// render (boy/kilo bloğunda)
{needsBirthYear && <Input label="Doğum Yılı" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="1995"/>}
// handleComplete
const by = needsBirthYear ? parseInt(birthYear) : metaBirthYear;
const age = Number.isFinite(by)&&by>1900&&by<=nowYear ? Math.max(18, nowYear-by) : 30;
await update(user.id, { ..., ...(needsBirthYear && birthYear ? { birth_year: parseInt(birthYear) } : {}) } as never);
```

**Doğrulama:** tsc --noEmit. kk.mjs canlı: OAuth (veya metadata.birth_year'sız) yeni kullanıcıyla onboarding aç -> 'Doğum Yılı' alanı görünmeli, e-posta kullanıcısında (metadata dolu) görünmemeli. Tamamla sonrası q.mjs: SELECT birth_year FROM profiles WHERE id=... -> NULL DEĞİL girilen yıl olmalı; tdee_calculated age=girilen yaşla hesaplanmış olmalı; introduce_yourself görevi tamamlanmış sayılmalı, plan/diet CTA aktif olmalı.

---

### 🟠 HIGH — menstrual.tsx ve goals.tsx Kaydet butonlarında loading/try-catch guard'ı eksik — çift-gönderim + kalıcı buton kilidi
- **Dosyalar:** `app/settings/menstrual.tsx`, `app/settings/goals.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `settings-save-guards`

**Kök-neden:** İki ekran aynı kök kusurun iki farklı semptomu. menstrual.tsx: handleSave (39-51) ARTIK try/catch + Türkçe Alert içeriyor (audit 'hiç try/catch yok' kısmı GÜNCEL DEĞİL — kısmen reassessment), AMA hâlâ 'saving' state'i YOK (grep: 0 eşleşme) ve Button (satır 119) loading/disabled almıyor -> yavaş ağda çift basış iki updateMenstrualSettings + ilk Alert router.back() yaparken ikinci Alert kapalı ekrana asılı kalır. goals.tsx: handleSave (146-180) setSaving(true) diyor ama iki ardışık await'i (supabase.goals.update is_active:false @167 + addPhase @177) try/catch OLMADAN çalıştırıyor; biri throw ederse setSaving(false) (178) ASLA çalışmaz ve Button (299, loading={saving}) kalıcı spinner'da kilitlenir, kullanıcıya hata gösterilmez, hedef sessizce kaydedilmez. edit-profile.tsx doğru deseni (try/catch/finally + loading={saving}) uyguluyor.

**Yeniden değerlendirme:** menstrual.tsx handleSave'de try/catch + Türkçe Alert ZATEN var (audit metni 'hiç saving state tutmuyor' doğru ama 'try/catch yok' kısmı güncel kod ile çelişiyor). Gerçek kalan kusur SADECE eksik saving/loading state (çift-gönderim). goals.tsx tarafı tamamen doğru: try/catch yok, kalıcı kilit gerçek.

**Düzeltme:** menstrual.tsx: const [saving, setSaving] = useState(false) ekle (useState zaten import @5). handleSave'i try{ setSaving(true); await updateMenstrualSettings(...); haptics.success(); Alert(...router.back) } catch { haptics.error(); Alert('Kaydedilemedi',...) } finally { setSaving(false) } yap. Button'a loading={saving} ekle (satır 119). goals.tsx: handleSave'in setSaving(true)'dan sonraki gövdesini (167-179, iki await + Alert) try/catch/finally ile sar: try{ deactivate + addPhase + haptics.success + Alert('Başarılı',...router.back) } catch { haptics.error(); Alert('Kaydedilemedi','Hedef kaydedilemedi, lütfen tekrar dene.') } finally { setSaving(false) }. Erken-return validasyon Alert'leri (153/160) setSaving(true)'dan ÖNCE olduğu için dokunulmaz. haptics zaten import edilmiş mi kontrol (menstrual @43 haptics.success var, import mevcut).

```tsx
// menstrual.tsx
const [saving, setSaving] = useState(false);
const handleSave = async () => {
  if (!user?.id) return;
  try { setSaving(true); await updateMenstrualSettings(...); haptics.success(); Alert.alert('Kaydedildi', ...[{text:'Tamam', onPress:()=>router.back()}]); }
  catch { haptics.error(); Alert.alert('Kaydedilemedi','...'); }
  finally { setSaving(false); }
};
<Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" .../>

// goals.tsx (165 sonrası)
setSaving(true);
try {
  await supabase.from('goals').update({ is_active:false })...;
  await addPhase(user.id, ...);
  haptics.success();
  Alert.alert('Başarılı','Hedef kaydedildi.',[{text:'Tamam',onPress:()=>router.back()}]);
} catch { haptics.error(); Alert.alert('Kaydedilemedi','Hedef kaydedilemedi, lütfen tekrar dene.'); }
finally { setSaving(false); }
```

**Doğrulama:** tsc --noEmit. kk.mjs canlı: menstrual ekranında Kaydet'e hızlı çift bas (yavaş ağ) -> tek update, ikinci basış disabled; tek Alert. goals ekranında RLS/ağ hatası simüle et (geçersiz değer veya offline) -> Button sonsuz spinner'da KALMAMALI, 'Kaydedilemedi' Alert çıkmalı, sonra tekrar denenebilmeli.

---

### 🟠 HIGH — Tüm ayarlar hub'ı (Premium/Güvenlik/Challenge dahil 30+ satır) tek bir gömülü satırdan erişilebilir — keşfedilemez IA
- **Dosyalar:** `app/(tabs)/profile.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `profile-screen`

**Kök-neden:** settings/index.tsx Premium upsell, Hesap Güvenliği, Challenge, Başarımlar, AI Şeffaflık, İlerleme Fotoğrafları, Aile Planı gibi ~30 satır içeren zengin merkez. Ama bu ekrana giden TEK yol profile.tsx:118 'Veri & gizlilik' bölümü altına gömülmüş 'Tüm ayarlar' satırı (settings-outline ikonu, router.push('/settings')). Kod tabanında /settings'e giden başka navigasyon yok (grep teyit). Profil sekmesi yalnız ~12 ayara doğrudan link veriyor (Ayarlar bölümü profile.tsx:102-110 + Veri&gizlilik 113-142). Premium dönüşümü doğrudan etkilenir: ücretsiz kullanıcı Premium ekranına yalnız profil>veri-gizlilik>'Tüm ayarlar'->scroll ile ulaşır.

**Düzeltme:** Minimal-doğru: 'Tüm ayarlar' satırını keşfedilebilir konuma taşı + birinci-sınıf Premium ve Hesap Güvenliği satırları ekle. (A) profile.tsx'te 'Tüm ayarlar' MenuRow'unu 'Veri & gizlilik' bölümünden çıkarıp 'Ayarlar' bölümünün (102-110) en üstüne/altına taşı (semantik olarak doğru yer). (B) En etkili dönüşüm fix'i: 'Ayarlar' bölümüne iki yeni birinci-sınıf MenuRow ekle — Premium (icon='star-outline'/diamond, label='Premium', onPress router.push('/settings/premium')) ve Hesap Güvenliği (icon='shield-checkmark-outline', label='Hesap Güvenliği', onPress router.push('/settings/account-security')). Hedef rotalar zaten mevcut (settings/premium.tsx, settings/account-security.tsx). Tasarım sapması istenmiyorsa minimum: sadece (A) + Premium satırı. Profil başlığına dişli ikon eklemek daha büyük tasarım dokunuşu olur — opsiyonel, bu plan kapsamında MenuRow yaklaşımı yeterli.

```tsx
// profile.tsx 'Ayarlar' bölümü içine:
<MenuRow icon="star-outline" color={colors.warning} label="Premium" onPress={() => router.push('/settings/premium')} colors={colors} />
<MenuRow icon="shield-checkmark-outline" color={colors.primary} label="Hesap Güvenliği" onPress={() => router.push('/settings/account-security')} colors={colors} />
// 'Tüm ayarlar' satırını Veri&gizlilik'ten Ayarlar bölümüne taşı
```

**Doğrulama:** tsc --noEmit. Preview/kk.mjs: profil sekmesi -> 'Premium' ve 'Hesap Güvenliği' birinci-sınıf satırlar görünür ve doğru ekrana gider; 'Tüm ayarlar' Ayarlar bölümünde, scroll gerektirmeden bulunabilir. Premium ekranına 1-tık erişim doğrulanır.

---

### 🟠 HIGH — Deneme süresi bitiş hatırlatması hiç tetiklenmiyor (ölü kod) + iç mantık çelişkisi
- **Dosyalar:** `src/services/notifications.service.ts`, `app/(tabs)/index.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `dashboard-premium`

**Kök-neden:** checkAndScheduleTrialReminder (notifications.service.ts:445) ve scheduleTrialReminder (:421) tanımlı ama grep teyit: tüm kod tabanında hiçbir dış çağrı YOK (yalnız 421/445 export + 451 iç çağrı). usePremium.ts:19-22 yorumu '...trial countdown UI + 2-day reminder'ı re-enable eder' diyor ama HİÇBİR effect/ekran checkAndScheduleTrialReminder'ı çağırmıyor — reminder tarafı ölü. Üstüne mantık çelişkisi: checkAndScheduleTrialReminder trialDaysLeft<=2 && >0 (yani 1 veya 2) için scheduleTrialReminder çağırır AMA scheduleTrialReminder:422 'if (trialDaysLeft !== 2) return;' ile 1-gün-kala durumunda sessizce no-op. Sonuç: deneme biten kullanıcı hiçbir uyarı almıyor -> free->paid dönüşüm fırsatı kaçıyor (gelir etkisi).

**Düzeltme:** İki bağımsız düzeltme. (1) Mantık çelişkisi: scheduleTrialReminder:422'deki 'if (trialDaysLeft !== 2) return;' -> 'if (trialDaysLeft < 1 || trialDaysLeft > 2) return;' yap ki 1-gün-kala da reminder kurulsun; body metnini dinamik yap (`Deneme süren ${trialDaysLeft} gün sonra bitiyor. Premium'a geç!`). (2) Çağrı bağla: dashboard'a (app/(tabs)/index.tsx) bir useEffect/useFocusEffect ekle: usePremium()'dan { isInTrial, trialDaysLeft } al, mount/focus'ta checkAndScheduleTrialReminder(isInTrial, trialDaysLeft).catch(()=>{}) çağır. NOT: bu çağrı, MEDIUM 'dashboard trial banner' bulgusuyla aynı dosya/aynı usePremium tüketimine dokunur — birlikte ele alınabilir. Bildirim izni reddedilirse schedule sessizce fail eder, catch ile yutulur.

```tsx
// notifications.service.ts:422
if (trialDaysLeft < 1 || trialDaysLeft > 2) return;
...
body: `Deneme süren ${trialDaysLeft} gün sonra bitiyor. Premium'a geç!`,

// app/(tabs)/index.tsx
const { isInTrial, trialDaysLeft } = usePremium();
useEffect(() => { checkAndScheduleTrialReminder(isInTrial, trialDaysLeft).catch(()=>{}); }, [isInTrial, trialDaysLeft]);
```

**Doğrulama:** tsc --noEmit. kk.mjs canlı: premium_expires_at'i ~1.5 gün sonraya ayarlanmış (isInTrial=true, trialDaysLeft=2) bir kullanıcıyla dashboard aç -> Notifications.getAllScheduledNotificationsAsync()'te type:'trial_reminder' bir kayıt oluşmalı (önce çoklu kayıt temizleniyor). trialDaysLeft=1 senaryosunda da kayıt oluşmalı (eskiden no-op'tu). q.mjs ile premium_expires_at set edilerek senaryo kurulur.

---

### 🟠 HIGH — İki ekran baştan sona diakritiksiz (ASCII-soyulmuş) Türkçe — marka cilası kırık
- **Dosyalar:** `app/settings/data-import.tsx`, `app/settings/venues.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `i18n-strings`

**Kök-neden:** Veri İçeri Aktar (data-import.tsx) ve Mekanlar (venues.tsx) ekranlarındaki görünür metinlerin neredeyse tamamı Türkçe karakterlerini kaybetmiş. data-import.tsx: 'Veri Iceri Aktar' (44), 'Baska uygulamalardan...disa aktardigin' (46), 'Ogun Verisi' (52), 'Iceri Aktar' (91), 'CSV icerigini buraya yapistirin' (83), 'Basarili' (36), 'kayit iceri aktarildi' (36), 'Import basarisiz' (38), 'Sonuc' (95), 'kayit aktarildi' (97). venues.tsx: 'Sik gittigin mekanlar ve ogrenilen makro tahminleri' (34), 'Disarida Yemek Planliyorum' (38), boş-durum 'Henuz kayitli mekan yok. Kocuna "Simit Sarayi'nda yedim" gibi yazdiginda mekan otomatik ogrenilir.' (42), 'onayli' (61). Nav başlıkları (_layout.tsx:23) doğru aksanlı olduğundan aynı ekranda düzgün+bozuk Türkçe yan yana. 'modern enerjik UI' hedefiyle çelişir.

**Düzeltme:** Saf string düzeltme — mantık değişmez. data-import.tsx: 'Veri İçeri Aktar' (44), 'Başka uygulamalardan (...) dışa aktardığın CSV verisini buraya yapıştır.' (46), 'Öğün Verisi' (52), 'İçeri Aktar' (91), 'CSV içeriğini buraya yapıştırın...' (83), 'Başarılı' (36), '... kayıt içeri aktarıldı.' (36), 'İçe aktarma başarısız. N hata.' (38), 'Sonuç' (95), '... kayıt aktarıldı' (97). venues.tsx: 'Sık gittiğin mekanlar ve öğrenilen makro tahminleri.' (34), 'Dışarıda Yemek Planlıyorum' (38), 'Henüz kayıtlı mekan yok. Koçuna "Simit Sarayı'nda yedim" gibi yazdığında mekan otomatik öğrenilir.' (42), 'onaylı' (61). DİKKAT: data-import.tsx:71 CSV format örneği ('ogun_tipi','yiyecek_adi' vb.) gerçek CSV kolon-anahtarı/parser kontratı olabilir — import.service.ts'in beklediği başlıklarla eşleşmeli; bu satırı SADECE import.service.ts gerçekten aksanlı başlık bekliyorsa değiştir, aksi halde ASCII bırak (kullanıcıya örnek format gösteriyor).

```tsx
// data-import.tsx (örnek)
<Text>Veri İçeri Aktar</Text>
Alert.alert('Başarılı', `${res.recordsImported} kayıt içeri aktarıldı.`);
Alert.alert('Hata', `İçe aktarma başarısız. ${res.errors.length} hata.`);
// venues.tsx
<Text>Henüz kayıtlı mekan yok. Koçuna "Simit Sarayı'nda yedim" gibi yazdığında mekan otomatik öğrenilir.</Text>
```

**Doğrulama:** Grep ile düzeltme sonrası bu iki dosyada 'Iceri|Basarili|Ogun|Sonuc|Sik|Disarida|Henuz|Kocuna|ogrenilir|onayli' kalmadığını doğrula. import.service.ts'i aç ve CSV başlık-anahtarlarının (data-import.tsx:71 örneği) parser ile tutarlı olduğunu kontrol et (kolon adlarını değiştirmediğinden emin ol). tsc --noEmit (string değişikliği tip etkilemez). Preview: iki ekranı aç, tüm metinler doğru aksanlı + nav başlığıyla tutarlı.

---

### 🟡 MEDIUM — Çevrimdışıyken dashboard'da üç ayrı offline göstergesi üst üste biniyor
- **Dosyalar:** `app/(tabs)/index.tsx`, `app/chat/[sessionId].tsx`, `src/components/dashboard/HeroSection.tsx`, `src/components/ui/OfflineBanner.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `offline-banner+dashboard-hero+chat-screen`

**Kök-neden:** Doğrulandı. İki ayrı OfflineBanner bileşeni var: common/OfflineBanner (absolute overlay, zIndex 1000, app/_layout.tsx:84 global mount, NetInfo dinler, doğru aksanlı metin) ve ui/OfflineBanner (inline, useNetworkStatus, aksansız 'Internet yok. Mesaj gonderimi...'). app/(tabs)/index.tsx:33 ui versiyonunu import edip :247 inline render ediyor VE HeroSection.tsx:98-113 isOffline prop'uyla ÜÇÜNCÜ bir çip gösteriyor. app/chat/[sessionId].tsx:44/1038 de ui versiyonunu render ediyor. Global common banner zaten tüm ekranları kapsadığı için inline'lar gereksiz çift/üçlü gösterim üretiyor.

**Düzeltme:** Tek kaynağa indir: global common/OfflineBanner kalsın. (1) app/(tabs)/index.tsx:33 import ve :247 <OfflineBanner/> satırını kaldır. (2) app/chat/[sessionId].tsx:44 import ve :1038 <OfflineBanner/> satırını kaldır. (3) HeroSection.tsx'te isOffline prop'unu ve :97-113 offline çip bloğunu kaldır; index.tsx:312 isOffline={isOffline} geçişini sil (ve HeroSection prop tipinden isOffline'ı çıkar). (4) Artık kullanılmayan ui/OfflineBanner.tsx dosyasını sil (başka import kalmadığını grep ile teyit et). Kaldırma sonrası HeroSection'da Ionicons import'u hâlâ kullanılıyorsa dokunma, yalnız bu blokla geliyorsa temizle.

```tsx
// index.tsx
- import { OfflineBanner } from '@/components/ui/OfflineBanner';
- <OfflineBanner />
- <HeroSection ... isOffline={isOffline} ... />
+ <HeroSection ... />
// HeroSection.tsx — isOffline prop + offline çip bloğu (97-113) silinir
```

**Doğrulama:** npx tsc --noEmit (kullanılmayan isOffline/import hatası kalmadığını doğrula). Preview/emülatörde uçağa al → tek banner (üstte common overlay) görünmeli; dashboard ve chat detayda tekrar yok.

---

### 🟡 MEDIUM — Sohbet sayacı chip/foto LLM turlarını baypas ediyor + sunucunun data.remaining'i istemcide hiç tüketilmiyor
- **Dosyalar:** `app/chat/[sessionId].tsx`, `src/services/message-counter.service.ts`, `src/services/chat.service.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `chat-screen+chat-service`

**Kök-neden:** Doğrulandı. app/chat/[sessionId].tsx:577-589 sayaç YALNIZCA 'if (text && !photo)' metin yolunda incrementAndCheck çağırıyor. handleQuickSelect (:776), handleAskWhy, plan confirm/reject, persona, lowConf yolları sendMessageToSession'ı doğrudan çağırıp sayaç işletmiyor; foto/barkod (:616-617 sendPhotoToSession, en pahalı vision) guard dışı kaldığından hiç sayılmıyor. Ayrıca sunucu data.remaining döndürüyor (chat.service tipinde remaining var) ama istemci yalnız tahmini AsyncStorage sayacına güveniyor; data.remaining hiçbir yerde setRemainingMsgs'e beslenmiyor (grep: :1737 farklı bir simulation.remaining).

**Düzeltme:** Minimal-doğru, iş kararını değiştirmeden istemci rozetini sunucuyla senkronla: handleSend başarı dalında ve handleQuickSelect/handleAskWhy/plan-confirm/reject yollarında 'data' geldikten sonra, eğer data.remaining tip olarak number ise setRemainingMsgs(data.remaining) yap (premium değilse). Böylece chip/foto turları sunucuda sayıldığında rozet gerçekle örtüşür ve sürpriz 'limit doldu' önlenir. data.remaining tipini chat.service.ts dönüş tipine ekle (zaten sunucu gönderiyorsa opsiyonel number olarak). İstemci tahmini incrementAndCheck'i metin yolunda iyimser ön-kontrol olarak bırak ama gerçek sayıyı her zaman sunucu cevabıyla ez (server-authoritative).

```tsx
// her sendMessageToSession/sendPhotoToSession başarı dalında:
if (data) {
  if (!isPremium && typeof data.remaining === 'number') setRemainingMsgs(data.remaining);
  ...
}
```

**Doğrulama:** kk.mjs ile free kullanıcı senaryosu: chip + foto turları gönder, rozetin sunucu kalanına göre düştüğünü gözle; q.mjs ile günlük sayacı doğrula. tsc temiz olmalı (chat.service dönüş tipine remaining eklenince).

---

### 🟡 MEDIUM — Chat mesaj kotası gate'i premium_expires_at'i onurlandırmıyor (ham .premium kullanılıyor)
- **Dosyalar:** `app/chat/[sessionId].tsx`, `src/lib/premium-gate.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `chat-screen+chat-service`

**Kök-neden:** Doğrulandı. app/chat/[sessionId].tsx:333 'const isPremium = !!(profile)?.premium' ham boolean; bu değer :337 getRemainingMessages ve :578 incrementAndCheck'e besleniyor. src/lib/premium-gate.ts:63-69 tam bu durum için isActivePremium(profile) sağlıyor (premium=true ama expires geçmişse false döner — cron grace penceresi). Chat dosyası isActivePremium'ı import etmiyor.

**Düzeltme:** app/chat/[sessionId].tsx:333 satırını 'const isPremium = isActivePremium(profile as any)' ile değiştir; üstte import { isActivePremium } from '@/lib/premium-gate' ekle. Böylece grace penceresindeki süresi-dolmuş kullanıcı sunucu rate-limit'iyle tutarlı şekilde free sayaca tabi olur ve mesaj rozetini görür.

```tsx
import { isActivePremium } from '@/lib/premium-gate';
- const isPremium = !!(profile as Record<string,unknown>|null)?.premium;
+ const isPremium = isActivePremium(profile as {premium?:boolean|null;premium_expires_at?:string|null}|null);
```

**Doğrulama:** tsc temiz. q.mjs ile premium=true & premium_expires_at<now olan test profili kur; kk.mjs chat aç → rozet görünmeli, free limit uygulanmalı.

---

### 🟡 MEDIUM — Deneme geri sayımı yalnızca premium ekranında; ana akışlarda yüzeye çıkmıyor
- **Dosyalar:** `app/(tabs)/index.tsx`, `src/hooks/usePremium.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `dashboard-hero+chat-screen`

**Kök-neden:** Doğrulandı. usePremium() (src/hooks/usePremium.ts:26-29) isInTrial/trialDaysLeft türetiyor ama yalnız app/settings/premium.tsx tüketiyor. app/(tabs)/index.tsx'te premium/trial/usePremium grep eşleşmesi yok. NOT: bağlı ölü-bildirim bulgusu (scheduleTrialReminder hiç çağrılmıyor + !==2 mantık hatası) HIGH olduğu için kapsam dışı; bu MEDIUM yalnız dashboard görünürlüğü.

**Düzeltme:** app/(tabs)/index.tsx'e usePremium() çağrısı ekle; ScrollView başında (returnStatus banner'ından sonra) 'isInTrial && trialDaysLeft <= 3' iken dismiss edilebilir bir banner render et: 'Denemen X gün sonra bitiyor — Premium'a geç', onPress router.push('/settings/premium'). Stil olarak mevcut returnStatus banner kalıbını (card + borderLeft + close) yeniden kullan, token kullan.

```tsx
const { isInTrial, trialDaysLeft } = usePremium();
{isInTrial && trialDaysLeft <= 3 && (
  <TouchableOpacity onPress={() => router.push('/settings/premium')} ...>
    <Text>Denemen {trialDaysLeft} gün sonra bitiyor — Premium'a geç</Text>
  </TouchableOpacity>) }
```

**Doğrulama:** tsc temiz. q.mjs ile created_at<7gün & premium_expires_at=+2gün profil kur; emülatör dashboard'da banner görünmeli, dokununca premium ekranına gitmeli.

---

### 🟡 MEDIUM — Donut başlığı (13-görev) ile gap-ipucu (24-alan) çelişen mesaj verebiliyor
- **Dosyalar:** `src/components/dashboard/ProfileCompletionDonut.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `profile-completion-donut`

**Kök-neden:** Doğrulandı. ProfileCompletionDonut.tsx: pct (:72-74) getOnboardingProgress (13 görev) üzerinden; hintLine (:93-102) bambaşka calculateProfileCompletion (src/lib/profile-completion.ts, 24 ağırlıklı alan) sisteminden. pct=100 olduğunda başlık (:166) 'Profilin hazır' derken hintLine hâlâ result.lowestCategory üzerinden 'X tamamla' diyebilir — çelişki.

**Düzeltme:** hintLine useMemo'sunda en başa pct kontrolü ekle: pct === 100 iken sabit olumlu metin döndür. Minimal: hintLine memo dependency'sine pct ekle ve 'if (pct === 100) return "Profilin tamam — Koçko seni tam tanıyor";' satırını result kontrollerinden önce koy. Böylece headline ile alt-metin asla çelişmez. (Daha kapsamlı alternatif — ipucunu da 13-görev sisteminden türetmek — daha büyük efor; bu minimal düzeltme yeterli.)

```tsx
const hintLine = useMemo(() => {
+  if (pct === 100) return 'Profilin tamam — Koçko seni tam tanıyor';
   if (!result) return 'Profil yükleniyor…';
   ... }, [result, pct]);
```

**Doğrulama:** tsc temiz. q.mjs ile 13 görevi tamamlanmış ama bir weight-2 alanı boş profil kur; dashboard'da başlık 'Profilin hazır' + alt metin 'Profilin tamam' görünmeli (çelişki yok).

---

### 🟡 MEDIUM — Hesap silme için iki tutarsız sürtünme düzeyi (profil tek-tık Alert vs settings 'SIL' typed-confirm)
- **Dosyalar:** `app/(tabs)/profile.tsx`, `app/settings/index.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `profile-tab+settings-index`

**Kök-neden:** Doğrulandı. app/(tabs)/profile.tsx:119-141 tek Alert + tek 'Hesabımı sil' tıkı geri-alınamaz silmeyi (requestAccountDeletion) tetikliyor. app/settings/index.tsx:201-251 ise iyi tasarlanmış typed-confirm modal ('SIL' yazma, canDelete gate, loading state). İkisi de aynı deletion_requested_at/deleted_at sonucunu üretiyor; koruma seviyesi tutarsız ve profil yolu kazara silmeye açık.

**Düzeltme:** Profil sekmesindeki 'Hesabı sil' MenuRow'unun onPress'ini, inline Alert+requestAccountDeletion akışından koparıp settings/index'teki güçlü akışa yönlendir: en basit ve düşük-riskli çözüm — onPress'i router.push('/settings') yapıp typed-confirm modalini orada açtır (veya MenuRow'u tamamen kaldırıp kullanıcıyı settings hesap güvenliği/silme satırına bırak). Tercih: profil satırını 'Hesabı sil' yerine router.push('/settings') yapan bir giriş haline getir; böylece tek paylaşılan, daha korumalı akış kalır. requestAccountDeletion import'u profil dosyasında başka kullanım yoksa temizle.

```tsx
<MenuRow icon="trash-outline" color={colors.error} label="Hesabı sil"
  onPress={() => router.push('/settings')} colors={colors} last />
```

**Doğrulama:** tsc temiz (artık çağrılmayan import/handler kalmadığını doğrula). Emülatör: profil > Hesabı sil → settings'e gitmeli; silme yalnız 'SIL' yazılınca aktif olmalı. Tek silme yolu testi.

---

### 🟡 MEDIUM — prefill akışında router.replace ile açılan sohbette geri tuşu oturum listesini atlıyor
- **Dosyalar:** `app/(tabs)/chat.tsx`, `app/chat/[sessionId].tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `chat-screen+chat-tab`

**Kök-neden:** Doğrulandı. app/(tabs)/chat.tsx:65/74 prefill/openCamera yolunda router.replace ile chat detaya gidiyor (push değil); normal akış :138/147 push kullanıyor. app/chat/[sessionId].tsx:992 geri tuşu koşulsuz router.back() çağırıyor — replace ile gelindiğinde chat-tab yığından çıktığı için kullanıcı oturum listesine değil replace-öncesi ekrana düşer. Aynı ekranın geri davranışı, gelinen yola göre tutarsız.

**Düzeltme:** En düşük-riskli: geri tuşunu hedef-farkındalıklı yap. chat detayda prefill/openCamera/fromPrefill paramı varlığında back yerine router.replace('/(tabs)/chat') ile listeye dön. Bunun için chat.tsx:65/74 replace çağrılarında params'a 'fromPrefill':'1' ekle; [sessionId].tsx'te useLocalSearchParams ile fromPrefill oku ve handleBack = () => fromPrefill ? router.replace('/(tabs)/chat') : router.back(). :992 onPress'i handleBack yap. Böylece normal push akışı bozulmaz.

```tsx
// chat.tsx prefill dalı
params.fromPrefill = '1';
// [sessionId].tsx
const { fromPrefill } = useLocalSearchParams<{fromPrefill?:string}>();
const handleBack = () => fromPrefill ? router.replace('/(tabs)/chat') : router.back();
<TouchableOpacity onPress={handleBack} ...>
```

**Doğrulama:** tsc temiz. Emülatör: dashboard hızlı-kayıt → chat açılır → geri bas → oturum LİSTESİNE dönmeli. Normal akış (sohbet listesinden bir oturum aç → geri) hâlâ listeye dönmeli.

---

### 🟡 MEDIUM — strength.tsx: loading state hiç okunmuyor + .catch yok → ağ hatasında yanlış 'kayıt yok' boş-durumu
- **Dosyalar:** `app/settings/strength.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `strength-screen`

**Kök-neden:** Doğrulandı. app/settings/strength.tsx:20 loading state tanımlı, :25 setLoading(false) yalnız başarı .then'inde; ama JSX (:44) render'ı 'validExercises.length === 0'a bağlı, loading hiç okunmuyor. Promise.all'da .catch yok → ağ hatasında setLoading(false) hiç çağrılmaz AMA önemlisi veri gelmeden ve hata durumunda kullanıcı 'Henüz güç antrenman kaydı yok' boş-durumunu görür (yanlış). NOT: bu, MEDIUM 'ortak sonsuz-spinner deseni' bulgusunun strength alt-parçası; aynı bulgudaki chat loadSessionMessages/dashboard fetchError parçaları HIGH-seviye merkezî ekranlar olduğundan ayrı (kapsam-dışı) ele alınmalı, strength MEDIUM olarak burada.

**Düzeltme:** (1) Promise.all'a .catch ekle: hata yakalandığında setLoading(false) + bir error state set et. (2) JSX'te boş-durumdan ÖNCE 'if (loading) return <skeleton/sade ActivityIndicator>' ekle ki veri gelmeden veya hata anında yanlış 'kayıt yok' flaşlanmasın. (3) İsteğe bağlı küçük: error state varsa 'Yüklenemedi, tekrar dene' + retry. Minimal düzeltme: loading guard + .catch(()=>setLoading(false)).

```tsx
Promise.all(...).then(r=>{setExercises(r);setLoading(false);}).catch(()=>setLoading(false));
...
if (loading) return <ScrollView...><SkeletonCard/></ScrollView>;
{validExercises.length===0 ? <Card>...kayıt yok...</Card> : ...}
```

**Doğrulama:** tsc temiz. Emülatör: uçağa al, strength ekranını aç → boş-durum flaşı yerine skeleton/indicator görünmeli. Veri olan kullanıcıda her açılışta yanlış 'kayıt yok' görünmemeli.

---

### 🟡 MEDIUM — lab-values.tsx: KeyboardAvoidingView yok + 'Değer' alanında sayısal doğrulama yok
- **Dosyalar:** `app/settings/lab-values.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `lab-values-screen`

**Kök-neden:** Doğrulandı. app/settings/lab-values.tsx:54 düz <ScrollView> (KeyboardAvoidingView ve keyboardShouldPersistTaps yok) → :86-89 Ref Min/Max + Kaydet klavyenin altında kalabilir. :30-31 handleAdd yalnız paramName.trim()&&value.trim() boşluk kontrolü, :33 value: parseFloat(value) ile yazıyor; 'yüksek'→NaN, '45 ng'→45 sessizce geçer, inline hata yok. menstrual/edit-profile/food-preferences KeyboardAvoidingView kullanıyor (tutarsızlık).

**Düzeltme:** (1) En dışı KeyboardAvoidingView ile sar (behavior platform-koşullu), ScrollView'a keyboardShouldPersistTaps="handled" ekle — menstrual.tsx:54-55 kalıbıyla birebir. (2) handleAdd başına sayısal doğrulama: const n = parseFloat(value.replace(',', '.')); if (!Number.isFinite(n)) { haptics.error(); Alert.alert('Geçersiz değer','Lütfen sayısal bir değer gir.'); return; } ve insert'te value:n kullan. refMin/refMax için de boş değilken Number.isFinite kontrolü ekle.

```tsx
<KeyboardAvoidingView style={{flex:1,...}} behavior={Platform.OS==='ios'?'padding':'height'}>
 <ScrollView ... keyboardShouldPersistTaps="handled">...
// handleAdd:
const n = parseFloat(value.replace(',','.'));
if (!Number.isFinite(n)) { haptics.error(); Alert.alert('Geçersiz değer','Sayısal bir değer gir.'); return; }
```

**Doğrulama:** tsc temiz (Platform/KeyboardAvoidingView import edilmeli). Emülatör: Yeni Değer Ekle → klavye açıkken Kaydet erişilebilir olmalı; 'abc' girip Kaydet → Alert, DB'ye NaN yazılmamalı (q.mjs lab_values kontrol).

---

### 🟡 MEDIUM — log.tsx Uyku ekranı hâlâ serbest-metin TextInput (DateTimeField'a geçilmemiş)
- **Dosyalar:** `app/log.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `log-screen`

**Kök-neden:** Doğrulandı. app/log.tsx:449-461 iki saat alanı ham TextInput (keyboardType='numbers-and-punctuation'). edit-profile.tsx:234-235 aynı uyku/uyanma alanları için DateTimeField mode="time" kullanıyor. handleSleepSave (:257-269) split(':')+Number.isFinite ile reaktif-olmayan doğrulama + Alert yapıyor; native picker olsa geçersiz biçim baştan imkânsız olurdu. iOS'ta numbers-and-punctuation klavyesi ':' içermeyebilir.

**Düzeltme:** İki TextInput'u (yatış/kalkış) DateTimeField mode="time" ile değiştir: <DateTimeField mode="time" value={sleepTime} onChange={setSleepTime} /> ve wakeTime için aynısı. DateTimeField zaten 'HH:mm' string döndürüyor (menstrual/edit-profile kullanımıyla aynı) → handleSleepSave'in split(':') mantığı dokunulmadan çalışır, güvenlik ağı olarak kalır. log.tsx üstünde DateTimeField import et. Etiketleri (Yatış/Kalkış) DateTimeField label prop'una taşı veya üstteki Text'leri koru.

```tsx
import { DateTimeField } from '@/components/ui/DateTimeField';
- <TextInput ... value={sleepTime} onChangeText={setSleepTime} keyboardType="numbers-and-punctuation" />
+ <DateTimeField mode="time" value={sleepTime} onChange={setSleepTime} />
```

**Doğrulama:** tsc temiz. Emülatör: Quick-Log > Uyku → native saat picker açılmalı; geçersiz biçim girmek imkânsız; kaydet sleep_hours doğru hesaplanmalı (q.mjs daily_metrics).

---

### 🟡 MEDIUM — Ham backend/JS hata mesajları kullanıcıya doğrudan gösteriliyor (İngilizce/teknik sızıntı)
- **Dosyalar:** `app/settings/account-security.tsx`, `app/settings/food-preferences.tsx`, `app/(tabs)/chat.tsx`, `src/lib/error-messages.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `error-messages-sweep`

**Kök-neden:** Doğrulandı. Birçok yerde Supabase/JS error.message ham Alert'e basılıyor: account-security.tsx:94/116/179 (şifre/e-posta/unlink → 'Password should be at least 6 characters' gibi İngilizce Supabase mesajları), food-preferences.tsx:43 (error.message ?? fallback — error.message daima dolu olduğundan fallback ölü), plan/diet.tsx:289 & plan/workout.tsx:266 (ham SQL — bu LOW handleStartRevision bulgusuyla örtüşür), progress-photos.tsx:89, (tabs)/chat.tsx:87. Türkçe uygulamada teknik/İngilizce hata kötü UX.

**Düzeltme:** Küçük bir yardımcı oluştur: src/lib/error-messages.ts içinde toTrErrorMessage(err): string — bilinen desenleri Türkçeye eşle (weak_password/'at least 6'→'Şifre en az 6 karakter olmalı', same_password→'Yeni şifre eskisinden farklı olmalı', email_taken/'already registered'→'Bu e-posta zaten kayıtlı', network→'Bağlantı sorunu'), bilinmeyende sabit 'Bir sorun oluştu, tekrar dene.' döndür; orijinali yalnız console.warn'a yaz. Sonra account-security :94/:116/:179, food-preferences :43 (ölü fallback'i kaldır), chat.tsx:87 çağrılarını Alert.alert(başlık, toTrErrorMessage(error)) ile değiştir. progress-photos:89 da aynı helper. Bu, çapraz dosya ortak süpürme — groupedSweeps ile birleşik (bkz. error-message sweep).

```tsx
// src/lib/error-messages.ts
export function toTrErrorMessage(e:unknown):string{
 const m=(e as any)?.message? String((e as any).message):'';
 if(/at least 6|weak_password/i.test(m))return 'Şifre en az 6 karakter olmalı.';
 if(/should be different|same_password/i.test(m))return 'Yeni şifre eskisinden farklı olmalı.';
 if(/already (registered|in use)|email_taken/i.test(m))return 'Bu e-posta zaten kayıtlı.';
 console.warn('[err]',m); return 'Bir sorun oluştu, lütfen tekrar dene.';
}
```

**Doğrulama:** tsc temiz. kk.mjs/emülatör: yanlış şifre değiştirme dene → Türkçe mesaj; food-preferences'ta RLS reddi simüle et → Türkçe; konsola ham mesaj düşmeli.

---

### 🔵 LOW — handleStartRevision mevcut taslağı kontrol etmeden draft INSERT ediyor — unique index ihlali ham SQL hatası sızdırıyor
- **Dosyalar:** `app/plan/diet.tsx`, `app/plan/workout.tsx`
- **Efor:** Küçük · **Risk:** low · **batch:** `plan-screens`

**Kök-neden:** Doğrulandı. app/plan/diet.tsx:274-285 doğrudan status='draft' INSERT (öncesinde getDraft kontrolü yok; getDraft import edilmiş ama çağrılmıyor), workout.tsx:251-269 aynı. migration 030 (user_id, plan_type) WHERE status='draft' partial unique index tanımlar → mevcut taslakta INSERT 23505 ile patlar ve diet.tsx:289/workout.tsx:266 'content: error?.message' ham Postgres 'duplicate key value violates...' string'ini Türkçe asistan balonu olarak gösterir.

**Düzeltme:** handleStartRevision başında const existing = await getDraft(user.id, 'diet'); if (existing) { setChatSessionId'i türetip mevcut taslağı sürdür veya kullanıcıya 'Zaten devam eden bir revizyon var' Alert göster; return. } INSERT hatasında error.message'ı asla balona basma — sabit Türkçe 'Revizyon başlatılamadı, tekrar dene.' kullan (error?.message ?? ... yerine doğrudan sabit metin); 23505'i yakalarsan mevcut taslağa yönlendir. Bu, error-message sweep ile aynı ham-mesaj sorununu paylaşır ama plan dosyaları ayrı batch (diet/workout).

```tsx
const existing = await getDraft(user.id, 'diet');
if (existing) { /* mevcut taslağı sürdür / uyar */ return; }
...
if (error || !inserted?.[0]) {
  setMessages(prev=>[...prev,{id:'err-'+Date.now(),role:'assistant',content:'Revizyon başlatılamadı, tekrar dene.'}]);
  return; }
```

**Doğrulama:** tsc temiz. q.mjs ile bir kullanıcıya açık diet draft kur; emülatörde aktif plan ekranından 'Revizyon başlat' → ham SQL balonu YOK; mevcut taslağa devam veya net Türkçe uyarı.

---

### 🔵 LOW — Görev kartı her dokunuşta koşulsuz YENİ oturum açıyor — çoğalan yarım oturumlar
- **Dosyalar:** `app/(tabs)/chat.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `chat-tab`

**Kök-neden:** Doğrulandı. app/(tabs)/chat.tsx:144-145 handleTaskPress her seferinde createSession({title, topicTags:[task.key]}) çağırıyor; topic_tags'inde task.key olan açık oturumu kontrol etmiyor. Aynı dosyadaki prefill akışı (:58-67) ise aktif oturumu yeniden kullanıyor — asimetri. Kullanıcı görevi yarıda bırakıp tekrar dokununca ikinci boş oturum açılır.

**Düzeltme:** handleTaskPress'te createSession'dan önce sessions içinde topic_tags'inde task.key olan aktif oturum ara (sessions state zaten yüklü). Bulursa router.push(o oturuma, prefill+taskModeHint paramlarıyla); yoksa mevcut gibi createSession. ChatSessionSummary tipinde topic_tags alanı varsa doğrudan kullan; yoksa loadSessions'ın döndürdüğü alanı teyit et (gerekirse select'e topic_tags ekle — küçük servis dokunuşu).

```tsx
const existing = sessions.find(s => s.is_active && s.topic_tags?.includes(task.key));
if (existing) { router.push({pathname:`/chat/${existing.id}`, params:{prefill:task.prefillMessage, taskModeHint:task.taskModeHint}}); return; }
const id = await createSession({ title: task.title, topicTags:[task.key] });
```

**Doğrulama:** tsc temiz (topic_tags tipini doğrula). Emülatör: bir görev kartına dokun→yarıda bırak→tekrar dokun → ikinci boş oturum açılmamalı, aynı oturuma dönmeli (q.mjs chat_sessions sayısı sabit).

---

### 🔵 LOW — reopenSession import edilmiş ama hiç çağrılmıyor — kapalı oturuma mesaj is_active'i bayatlatıyor
- **Dosyalar:** `app/chat/[sessionId].tsx`, `src/services/chat.service.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `chat-screen+chat-service`

**Kök-neden:** Doğrulandı. chat.service.ts:529-544 reopenSession (is_active=true) export ediyor; app/chat/[sessionId].tsx:28 import ediyor ama hiç çağırmıyor (ölü import). Kullanıcı kapalı oturumu açıp mesaj gönderince mesaj yazılır ama oturum kapalı kalır; (tabs)/chat.tsx 24 saat hareketsizlikte auto-close eder, devam edilse bile 'pasif' görünür.

**Düzeltme:** Niyet: devam edilen kapalı oturum yeniden aktifleşsin. loadSessionMessages sonrası (oturum yüklenince) oturumun is_active=false olduğu durumda VEYA ilk başarılı send öncesinde reopenSession(sessionId) çağır. En düşük-riskli: handleSend'de gerçek bir mesaj gönderilmeden hemen önce, eğer oturum pasifse reopenSession(sessionId) await et (best-effort, .catch yut). Oturumun aktiflik durumunu bilmek için yüklemede bir sessionActive ref/state tut. Eğer ürün kararı 'kapalı oturum salt-okunur' ise import'u kaldır (ölü kod temizliği). Tercih: reopen bağla.

```tsx
// handleSend, send öncesi:
if (sessionWasInactiveRef.current) {
  await reopenSession(sessionId).catch(()=>{});
  sessionWasInactiveRef.current = false;
}
```

**Doğrulama:** tsc temiz (kullanılmayan import uyarısı kalkmalı). q.mjs ile is_active=false oturum kur; emülatörde aç+mesaj gönder → is_active=true olmalı, liste başlığında aktif görünmeli.

---

### 🔵 LOW — deleteSession hataları yutuluyor — iyimser silme tutarsız kalabilir
- **Dosyalar:** `src/services/chat.service.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `chat-service-delete`

**Kök-neden:** Doğrulandı. chat.service.ts:546-549 deleteSession iki ayrı delete (chat_messages sonra chat_sessions) yapıyor; hiçbir error kontrolü/dönüş değeri yok. (tabs)/chat.tsx:167-175 iyimser olarak listeden çıkarıp yalnız throw'da Alert gösterir. Supabase .delete() RLS/ağ reddini error nesnesi olarak döndürür (throw etmez) → kontrol edilmediği için yutulur; oturum UI'dan gider ama DB'de kalır, sonraki yenilemede geri gelir.

**Düzeltme:** deleteSession'ı her iki delete'in error'ünü kontrol edip hata varsa throw eder hale getir: const { error: e1 } = await supabase.from('chat_messages').delete()...; if (e1) throw e1; aynısı chat_sessions için. Böylece chat.tsx:171 catch'i Alert gösterir ve iyimser silme rollback'i (ya da en azından kullanıcı bilgilendirmesi) çalışır. chat.tsx tarafında değişiklik gerekmez (zaten catch var).

```tsx
export async function deleteSession(sessionId:string):Promise<void>{
 const { error: e1 } = await supabase.from('chat_messages').delete().eq('session_id',sessionId);
 if (e1) throw e1;
 const { error: e2 } = await supabase.from('chat_sessions').delete().eq('id',sessionId);
 if (e2) throw e2;
}
```

**Doğrulama:** tsc temiz. q.mjs/RLS ile silme reddi simüle et → emülatörde 'Silinemedi' Alert; oturum listede kalmalı (yenilemede geri gelmemeli çünkü silinmedi).

---

### 🔵 LOW — Foto/tartı/döngü/IF alanlarında inline doğrulama eksik veya sessiz return
- **Dosyalar:** `app/log.tsx`, `app/settings/menstrual.tsx`, `app/settings/if-settings.tsx`
- **Efor:** Orta · **Risk:** low · **batch:** `log-screen+menstrual-screen+if-settings-screen`

**Kök-neden:** Doğrulandı. (1) log.tsx:210-213 handleWeightSave 'if (!w||w<20||w>300||!user?.id) return' ile sessizce çıkar (geri bildirim yok); buton yalnız loading'de disabled; oysa handleSleepSave geçersizde Alert atıyor (tutarsız). (2) menstrual.tsx:36/42/71 Döngü Süresi: parseInt(cycleLength)||28 kullanıldığından '5'/'900' geçer; servis guard'ı yalnız <=0 yakalıyor, ipucu '21–35 gün' doğrulamayla desteklenmiyor. (3) if-settings.tsx:34-49 handleSave eatingStart>=eatingEnd (0 saatlik/mantıksız pencere) uyarısız kaydeder.

**Düzeltme:** Her üçüne edit-profile'daki gibi geri bildirim ekle. (1) handleWeightSave: sessiz return yerine geçersizde haptics.error()+Alert('Geçersiz kilo','20–300 kg arası bir değer gir.'). (2) menstrual handleSave: const cl = parseInt(cycleLength); if (tracking && (!Number.isFinite(cl)||cl<21||cl>45)) { haptics.error(); Alert.alert('Geçersiz süre','Döngü süresi 21–45 gün olmalı.'); return; }. (3) if-settings handleSave: if (active && eatingStart >= eatingEnd) { haptics.error(); Alert.alert('Geçersiz pencere','Başlangıç bitişten önce olmalı.'); return; } (HH:mm string karşılaştırması leksikografik olarak doğru çalışır). Bu üç dosya ayrı batch (log, menstrual, if-settings).

```tsx
// log.tsx
if (!w||w<20||w>300){ haptics.error(); Alert.alert('Geçersiz kilo','20–300 kg arası gir.'); return; }
// menstrual.tsx
if (tracking && (!Number.isFinite(cl)||cl<21||cl>45)){ haptics.error(); Alert.alert('Geçersiz süre','21–45 gün olmalı.'); return; }
// if-settings.tsx
if (active && eatingStart>=eatingEnd){ haptics.error(); Alert.alert('Geçersiz pencere','Başlangıç bitişten önce olmalı.'); return; }
```

**Doğrulama:** tsc temiz. Emülatör: tartıda '5' gir+Kaydet→Alert; menstrual'de süre 900→Alert; IF özel pencerede start=end→Alert. Geçerli değerler sorunsuz kaydedilmeli.

---

### 🔵 LOW — Aksansız tekil dizeler (log.tsx, coach-mode.service.ts, debug-mode.tsx, usePremium.ts) — dağınık Türkçe karakter kaybı
- **Dosyalar:** `app/log.tsx`, `src/services/coach-mode.service.ts`, `app/settings/debug-mode.tsx`, `src/hooks/usePremium.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `accent-sweep`

**Kök-neden:** Doğrulandı + GENİŞLETİLDİ. log.tsx:263 'Saat formati gecersiz' (çevre :269/:283 doğru). coach-mode.service.ts:153 'gecerli...secilmelidir' (UI'a yansıyabilen throw). debug-mode.tsx:47-89 onlarca aksansız ('Gelistirici Modu', 'Kalori Araligi', 'Hayir', 'Tamamlandi', 'AI Ozeti', 'Bugunki Mesaj') ama :48 doğru → iç tutarsızlık. EK BULGU (finder kaçırmış): src/hooks/usePremium.ts:39/42/44/45 'Premium Ozellik','Bu ozellik','Iptal','Premium'a Gec' — kullanıcıya gösterilen premium upsell Alert'i de aksansız; ayrıca ui/OfflineBanner.tsx:28 'Internet yok. Mesaj gonderimi' (bu zaten offline-banner sweep ile dosya siliniyorsa otomatik çözülür).

**Düzeltme:** Mekanik aksan düzeltmesi (groupedSweeps ile birleşik). log.tsx:263 'Saat formatı geçersiz'. coach-mode.service.ts:153 'geçerli...seçilmelidir'. debug-mode.tsx tüm aksansız dizeler ('Geliştirici Modu','Kalori Aralığı','Hayır','Tamamlandı','AI Özeti','Bugünkü Mesaj' vb.). usePremium.ts:39-45 'Premium Özellik','Bu özellik','İptal','Premium'a Geç'. Salt-string değişikliği, mantık dokunulmaz.

```tsx
- 'Saat formati gecersiz. ...'
+ 'Saat formatı geçersiz. ...'
- 'Premium Ozellik' / 'Iptal' / 'Premium'a Gec'
+ 'Premium Özellik' / 'İptal' / 'Premium'a Geç'
```

**Doğrulama:** grep ile düzeltilen dosyalarda kalan aksansız Türkçe kelime taraması (gecersiz/Ozellik/Iptal/Hayir vb. 0 sonuç). tsc temiz. Emülatör: premium upsell Alert'i + debug-mode ekranı doğru Türkçe.

---

### 🔵 LOW — i18n.ts tam tr/en çeviri sistemi ama hiçbir yerde import edilmiyor — ~250 satır ölü kod
- **Dosyalar:** `src/lib/i18n.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `i18n-deadcode`

**Kök-neden:** Doğrulandı. src/lib/i18n.ts 200+ anahtarlı t()/translations sistemi; repo genelinde import/require grep'i 0 dosya döndürdü (yalnız audit .md'de bahis). Tüm metinler ekranlara gömülü. 'language ekranı çalışmıyor' iddiası geçersiz — öyle bir ekran yok; sadece bakımsız ölü kod. Doğrudan kullanıcı etkisi yok, teknik borç.

**Düzeltme:** Ürün kararı tek dil (TR) — MEMORY 'UI Türkçe' diyor. src/lib/i18n.ts dosyasını sil. Silmeden önce son bir kez grep ile (from '...i18n' ve require) hiçbir import olmadığını teyit et (şu an 0). Çok dilli hedef ileride doğarsa ayrı görev olarak ekranlara bağlanır; şimdilik ölü kodu kaldırmak en doğrusu.

```tsx
rm src/lib/i18n.ts  // hiçbir import yok (grep teyitli)
```

**Doğrulama:** Silmeden önce: grep -r "i18n" src/ app/ → yalnız dosyanın kendisi çıkmalı. Silme sonrası npx tsc --noEmit temiz olmalı.

---

### 🔵 LOW — haptics.safe() async reddi yakalamıyor — unhandled promise rejection riski
- **Dosyalar:** `src/lib/haptics.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `haptics-lib`

**Kök-neden:** Doğrulandı. src/lib/haptics.ts:14-16 safe() 'try { void fn(); } catch {}' kullanıyor; fn() async expo-haptics çağrısı (senkron throw etmez), desteklenmeyen cihaz/web'de reddedilmiş Promise döndürür. 'void fn()' reddi beklemediğinden catch hiç çalışmaz → unhandled rejection kaçar. Tüm haptik metodları (tap/success/.../heavy) bu yolu kullanıyor. Fonksiyonel etki yok; dev console kirliliği + prod crash-reporter gürültüsü.

**Düzeltme:** safe()'i promise-reddini yakalayacak şekilde değiştir: function safe(fn){ fn().catch(()=>{}); } (veya void fn().catch(()=>{})). Senkron throw da olası olduğundan ekstra güvenlik için try { fn().catch(()=>{}); } catch {} kullanılabilir. Tek satırlık dokunuş, davranış aynı (sessiz no-op) ama rejection artık tutuluyor.

```tsx
-function safe(fn: () => Promise<unknown>) {
-  try { void fn(); } catch { }
-}
+function safe(fn: () => Promise<unknown>) {
+  try { fn().catch(() => {}); } catch { }
+}
```

**Doğrulama:** tsc temiz. Web/emülatör (taptic yok) ortamında haptics.tap() çağır → konsola unhandled rejection düşmemeli.

---

### 🧹 Toplu Süpürmeler — UX

**Aksansız (ASCII-soyulmuş) Türkçe dizeleri doğru aksanla düzelt — dağınık tekil dizeler** _(efor: Orta)_
- Dosyalar: `app/log.tsx`, `src/services/coach-mode.service.ts`, `app/settings/debug-mode.tsx`, `src/hooks/usePremium.ts`
- HIGH iki-ekran bulgusu (data-import.tsx, venues.tsx) kapsam-dışı; bu süpürme LOW seviyedeki dağınık aksansız dizeleri kapsar. Yalnız string literal değişikliği, mantık dokunulmaz. EK: finder'ın kaçırdığı usePremium.ts premium-upsell Alert dizeleri de dahil edildi.
- **Yaklaşım:** Her dosyada görünür Türkçe metinlerdeki kayıp diakritikleri geri koy: log.tsx:263 'Saat formatı geçersiz'; coach-mode.service.ts:153 'geçerli/seçilmelidir'; debug-mode.tsx:47-89 'Geliştirici Modu/Kalori Aralığı/Hayır/Tamamlandı/AI Özeti/Bugünkü Mesaj' vb.; usePremium.ts:39-45 'Premium Özellik/Bu özellik/İptal/Premium'a Geç'. Sonra grep ile her dosyada kalan aksansız kelime (gecersiz, Ozellik, Iptal, Hayir, Araligi, Ozeti) 0 olana dek tara.

**Ham error.message yerine Türkçe hata eşlemesi — tek yardımcı + çağrı noktaları** _(efor: Orta)_
- Dosyalar: `src/lib/error-messages.ts`, `app/settings/account-security.tsx`, `app/settings/food-preferences.tsx`, `app/(tabs)/chat.tsx`, `app/settings/progress-photos.tsx`, `app/plan/diet.tsx`, `app/plan/workout.tsx`
- Birden çok ekranda Supabase/JS error.message ham Alert'e basılıyor (İngilizce/teknik sızıntı). Tek bir toTrErrorMessage(err) yardımcısı + çağrı noktası değişimi ile süpürülür.
- **Yaklaşım:** src/lib/error-messages.ts içinde toTrErrorMessage(err): bilinen desenleri (weak_password/'at least 6', same_password, email_taken/'already registered', network) Türkçeye eşle; bilinmeyende sabit 'Bir sorun oluştu, lütfen tekrar dene.' döndür ve orijinali console.warn'a yaz. Sonra account-security.tsx:94/116/179, food-preferences.tsx:43 (ölü ?? fallback'i kaldır), (tabs)/chat.tsx:87, progress-photos.tsx:89 ve plan/diet.tsx:289 & plan/workout.tsx:266 (ham SQL balonu) çağrılarını helper ile değiştir / sabit Türkçe metne çevir.

**Sayısal/aralık giriş alanlarına tutarlı inline doğrulama + haptik geri bildirim** _(efor: Orta)_
- Dosyalar: `app/log.tsx`, `app/settings/menstrual.tsx`, `app/settings/if-settings.tsx`, `app/settings/lab-values.tsx`
- Sessiz-return veya doğrulamasız parse içeren giriş alanlarına edit-profile rangeError kalıbındaki haptics.error()+Alert geri bildirimini ekle.
- **Yaklaşım:** log.tsx handleWeightSave sessiz return'ünü Alert'e çevir (20–300 kg); menstrual.tsx handleSave'e döngü süresi 21–45 gün kontrolü; if-settings.tsx handleSave'e eatingStart>=eatingEnd kontrolü; lab-values.tsx handleAdd'e Number.isFinite(value) kontrolü. Hepsi geçersizde return + Türkçe Alert.

---

## DB / Şema, Güvenlik & Bütünlük

_32 kart — 🔴 0 · 🟠 5 · 🟡 11 · 🔵 12 · ⚪ 4 · 🧹 5 süpürme_

### 🟠 HIGH — Sınırsız ücretsiz premium: trial INSERT politikası trial_used kontrolü yapmıyor (her 8 günde yenilenebilir self-grant)
- **Dosyalar:** `supabase/migrations/046_fix_subscriptions_ins_premium_selfgrant.sql`, `src/services/subscription.service.ts`, `supabase/migrations/051_trial_selfgrant_rpc.sql (yeni)`
- **Efor:** Büyük · **Risk:** med · **Migration gerekli** · **batch:** `db-subscriptions`

**Kök-neden:** Canlı subscriptions_ins WITH CHECK doğrulandı: ((auth.uid()=user_id) AND tier='trial' AND status='active' AND provider='manual' AND expires_at IS NOT NULL AND expires_at <= now()+'8 days') — profiles.trial_used kontrolü YOK. Tek koruma idx_subscriptions_user_active kısmi UNIQUE(user_id) WHERE status IN('active','trial','grace_period'); 'expired' kapsam dışı olduğundan deneme bittiğinde index boşalır. trial_used gate'i yalnızca client'ta: subscription.service.ts:63 SELECT trial_used, :81 ayrı UPDATE trial_used=true (insert ile atomik değil). PostgREST üzerinden client baypas edilip her 8 günde yeni trial satırı INSERT edilebilir; tg_sync_profile_premium (SECURITY DEFINER) profiles.premium=true yapar. KÖK-NEDEN TEYİT EDİLDİ.

**Yeniden değerlendirme:** Bulgu doğru ve canlıda birebir teyit edildi (politika WITH CHECK + kısmi index 'expired' kapsam dışı). Ek tespit: subscription.service.ts:81 trial_used UPDATE'i zaten insert'ten ayrı/atomik değil — RPC bunu da düzeltir.

**Düzeltme:** İki katmanlı düzeltme. (1) DB: yeni idempotent migration 051 — subscriptions_ins INSERT politikasını DROP et (client artık trial INSERT yapmayacak) ve start_trial_if_eligible(uid uuid) SECURITY DEFINER plpgsql RPC ekle: tek transaction içinde profiles satırını FOR UPDATE kilitle, trial_used true ise RAISE/return reason, aktif sub varsa return; aksi halde subscriptions trial satırını INSERT + profiles.trial_used=true UPDATE birlikte yap. EXECUTE'u authenticated'a grant et. Defense-in-depth için ayrıca subscriptions tablosuna BEFORE INSERT trigger: tier='trial' AND EXISTS(profiles WHERE id=NEW.user_id AND trial_used) ise RAISE EXCEPTION. (2) Client: subscription.service.ts startTrialIfEligible gövdesini supabase.rpc('start_trial_if_eligible',{uid:userId}) çağrısına indir; manuel SELECT/INSERT/UPDATE bloklarını kaldır, dönen {started,reason} yapısını koru.

```tsx
-- 051
DROP POLICY IF EXISTS subscriptions_ins ON public.subscriptions;
CREATE OR REPLACE FUNCTION public.start_trial_if_eligible(uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used boolean; act int;
BEGIN
  IF uid <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT trial_used INTO used FROM profiles WHERE id=uid FOR UPDATE;
  IF used THEN RETURN jsonb_build_object('started',false,'reason','trial_already_used'); END IF;
  SELECT count(*) INTO act FROM subscriptions WHERE user_id=uid AND status IN('active','trial','grace_period');
  IF act>0 THEN RETURN jsonb_build_object('started',false,'reason','already_active'); END IF;
  INSERT INTO subscriptions(user_id,tier,status,provider,started_at,expires_at)
    VALUES(uid,'trial','active','manual',now(),now()+interval '7 days');
  UPDATE profiles SET trial_used=true WHERE id=uid;
  RETURN jsonb_build_object('started',true);
END;$$;
GRANT EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) TO authenticated;
-- defense-in-depth trigger
CREATE OR REPLACE FUNCTION public.tg_block_trial_reuse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.tier='trial' AND EXISTS(SELECT 1 FROM profiles WHERE id=NEW.user_id AND trial_used) THEN RAISE EXCEPTION 'trial_already_used'; END IF; RETURN NEW; END;$$;
DROP TRIGGER IF EXISTS trg_block_trial_reuse ON subscriptions;
CREATE TRIGGER trg_block_trial_reuse BEFORE INSERT ON subscriptions FOR EACH ROW EXECUTE FUNCTION tg_block_trial_reuse();
```

**Migration taslağı:**
```sql
supabase/migrations/051_trial_selfgrant_rpc.sql — idempotent: DROP POLICY IF EXISTS subscriptions_ins; CREATE OR REPLACE FUNCTION start_trial_if_eligible; GRANT EXECUTE; tg_block_trial_reuse trigger (DROP TRIGGER IF EXISTS önce). Geri-alma: trigger+function DROP, eski subscriptions_ins politikasını yeniden CREATE. Not: schema_migrations drift bulgusuyla koordine et (önce 037-050 repair, sonra 051) — bkz dependsOn DB drift item'ı isteğe bağlı; 051 tek başına da idempotent.
```

**Doğrulama:** 1) q.mjs: SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='subscriptions' — subscriptions_ins kalmamalı. 2) q.mjs SELECT proname FROM pg_proc WHERE proname='start_trial_if_eligible'. 3) kk.mjs ile bir kullanıcıda trial başlat, expired'a düşür, ikinci kez RPC çağır → reason='trial_already_used' dönmeli; doğrudan INSERT denemesi trigger'la patlamalı. 4) tsc: subscription.service.ts derlenir.

---

### 🟠 HIGH — households, household_members, coach_consents tabloları hiçbir migration'da CREATE edilmiyor — canlıda elle açılmış
- **Dosyalar:** `supabase/migrations/039a_baseline_household_coach_tables.sql (yeni, 040'tan önce)`, `supabase/migrations/040_fix_household_rls_recursion.sql`, `supabase/migrations/043_plan_goal_household_hardening.sql`, `supabase/migrations/050_security_hardening_round2.sql`
- **Efor:** Orta · **Risk:** low · **Migration gerekli** · **batch:** `db-migration-baseline`

**Kök-neden:** Repo geneli 'create table ... households/household_members/coach_consents' araması BOŞ (teyit edildi). Canlıda üç tablo da mevcut (pg_class relkind='r' teyit). Migration 040 household_members üzerine POLICY, 043 RPC/index, 050 policy uyguluyor — hepsi tablonun zaten var olduğunu varsayıyor. Sıfırdan migration kurulumu 040'ta relation does not exist ile patlar. KÖK-NEDEN TEYİT EDİLDİ. Canlı DDL çıkarıldı: households(id uuid pk default gen_random_uuid, name text NOT NULL default 'Ailem', owner_id uuid NOT NULL FK profiles ON DELETE CASCADE, invite_code text UNIQUE default substr(md5(random()::text),1,8), created_at timestamptz default now()); household_members(id pk, household_id NOT NULL FK households CASCADE, user_id NOT NULL FK profiles CASCADE, role text default 'member' CHECK in(owner,member), joined_at default now(), UNIQUE(household_id,user_id)); coach_consents(id pk, user_id NOT NULL FK profiles CASCADE, coach_id NOT NULL FK profiles CASCADE, shared_data_types text[] default '{}', is_active bool default true, created_at default now(), revoked_at timestamptz, UNIQUE(user_id,coach_id)).

**Yeniden değerlendirme:** Bulgu doğru; üç tablonun canlı varlığı ve migration CREATE yokluğu teyit edildi. Canlı DDL birebir çıkarıldı, codeSketch bununla uyumlu.

**Düzeltme:** 040'tan ÖNCE çalışacak slot'a idempotent baseline migration ekle (dosya adı 040'tan alfabetik/sayısal önce gelmeli — '039a_...' veya '0395_...'; supabase sıralaması dosya adına göre olduğundan 039 ile 040 arasına yerleştir). Üç CREATE TABLE IF NOT EXISTS bloğu canlı DDL'den birebir, ardından ALTER TABLE ... ENABLE ROW LEVEL SECURITY (IF EXISTS guard'sız ama tablolar artık garanti var). FK/UNIQUE/CHECK tanımlarını tablo gövdesine göm. Mevcut canlıda no-op olur (IF NOT EXISTS), yeni ortamda zinciri tamir eder. 040/043/050 dosyalarına dokunma — onlar zaten policy/index ekliyor.

```tsx
CREATE TABLE IF NOT EXISTS public.households(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Ailem',
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code text UNIQUE DEFAULT substr(md5(random()::text),1,8),
  created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.household_members(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(household_id,user_id));
CREATE TABLE IF NOT EXISTS public.coach_consents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shared_data_types text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(user_id,coach_id));
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_consents ENABLE ROW LEVEL SECURITY;
```

**Migration taslağı:**
```sql
Yeni dosya 039a_baseline_household_coach_tables.sql (040'tan önce sıralanacak ad). Tamamen idempotent (CREATE TABLE IF NOT EXISTS + ENABLE RLS). Geri-alınabilir değil gerekmiyor (yeni ortam dışında no-op). schema_migrations'a uygun version kaydı ekle.
```

**Doğrulama:** 1) Yerel/temiz Postgres'te supabase db reset (veya migration zincirini sırayla psql ile uygula) → 040'ta artık patlamamalı. 2) q.mjs ile canlıda no-op teyidi (tablolar zaten var; migration tekrar uygulanırsa hata vermemeli). 3) Mig içeriğini schema_migrations drift item'ı ile birlikte repair et.

---

### 🟠 HIGH — chat_messages.session_id NOT NULL ama chat_sessions'a FK yok — yetim mesaj riski
- **Dosyalar:** `supabase/migrations/052_chat_messages_session_fk.sql (yeni)`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `db-chat-fk`

**Kök-neden:** Canlı pg_constraint teyit: chat_messages üzerinde yalnız chat_messages_pkey, chat_messages_role_check, chat_messages_user_id_fkey(->profiles). session_id için FK YOK. session_id is_nullable='NO', data_type=uuid teyit. İki AFTER INSERT trigger chat_sessions'ı session_id ile UPDATE ediyor ama geçersiz session_id INSERT'ini engelleyen kısıt yok. Orphan taraması: NOT EXISTS sorgusu 0 satır → latent (henüz sömürülmemiş) bütünlük açığı. KÖK-NEDEN TEYİT EDİLDİ.

**Yeniden değerlendirme:** Bulgu doğru, canlıda birebir teyit (FK yok, session_id NOT NULL, orphan=0). Düşük efor, düşük risk; orphan=0 olduğundan DELETE adımı pratikte no-op ama migration'da güvence olarak kalmalı.

**Düzeltme:** Önce güvenlik için orphan temizliği (canlıda 0, ama migration idempotent olsun): DELETE FROM chat_messages m WHERE session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chat_sessions s WHERE s.id=m.session_id). Sonra ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE. Idempotent için constraint var mı kontrolü (DO bloğu / IF NOT EXISTS yok constraint'te → pg_constraint kontrollü DO bloğu kullan). FK eklenince oturum silindiğinde mesajlar otomatik temizlenir; mevcut deleteSession (chat.service.ts:547 manuel DELETE) çalışmaya devam eder (zararsız çift-silme değil, FK CASCADE ile uyumlu).

```tsx
DELETE FROM public.chat_messages m WHERE m.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id=m.session_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_messages_session_id_fkey') THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;
```

**Migration taslağı:**
```sql
052_chat_messages_session_fk.sql — orphan DELETE (idempotent) + DO bloğuyla koşullu ADD CONSTRAINT. Geri-alma: ALTER TABLE ... DROP CONSTRAINT chat_messages_session_id_fkey. ON DELETE CASCADE seçildi çünkü session-bazlı model ve mevcut deleteSession davranışıyla tutarlı.
```

**Doğrulama:** 1) q.mjs: SELECT conname FROM pg_constraint WHERE conrelid='public.chat_messages'::regclass — chat_messages_session_id_fkey görünmeli. 2) kk.mjs: geçersiz session_id ile chat_messages INSERT denemesi FK violation vermeli. 3) Bir test session'ı sil → bağlı mesajların CASCADE ile silindiğini SELECT count ile doğrula.

---

### 🟠 HIGH — loadChatHistory yanlış yönde sıralıyor + session-scope yok (ve aynı oldest-50 hatası canlı-kullanılan loadSessionMessages'ta da var)
- **Dosyalar:** `src/services/chat.service.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `src-chat-service`

**Kök-neden:** chat.service.ts:273 loadChatHistory: user_id ile filtre, session_id YOK, ascending:true + limit(50) → tüm mesajlar arasından en ESKİ 50. ANCAK kritik tespit: loadChatHistory'nin app/src içinde HİÇBİR çağıranı yok (grep teyit) — ölü kod. Gerçek aktif yol app/chat/[sessionId].tsx:422 → loadSessionMessages(sessionId) (chat.service.ts:484): session_id ile doğru filtreliyor AMA aynı şekilde ascending:true + limit(50) ile session içinde en ESKİ 50 mesajı çekiyor; uzun bir oturumda son mesajlar görünmez. Yani audit'in tanımladığı bug deseni canlı-kullanılan fonksiyonda da mevcut, ama session-scope'lu olduğu için 'tüm sohbet kilitlenir' değil 'tek oturumda son mesajlar kaybolur' şiddetinde. KÖK-NEDEN KISMEN YENİDEN DEĞERLENDİRİLDİ.

**Yeniden değerlendirme:** Bulgunun işaret ettiği loadChatHistory ölü kod (çağıran yok). Asıl etkili sorun aynı oldest-50 deseninin canlı-kullanılan loadSessionMessages'ta tekrar etmesi. Şiddet HIGH'dan effektif olarak HIGH (tek oturumda son mesaj kaybı) seviyesinde kalıyor ama 'tüm sohbet kilitlenir' iddiası ölü koda ait. Düzeltme loadSessionMessages odaklı + ölü kod temizliği.

**Düzeltme:** (1) loadSessionMessages (canlı yol, asıl düzeltme): .order('created_at',{ascending:false}).limit(limit) ile en YENİ 50'yi çek, dönerken client'ta reverse() ile kronolojik sıraya koy. idx_chat_messages_user(user_id,created_at) DESC taramayı karşılar; session_id eşitliği zaten var. (2) loadChatHistory (ölü kod): ya tamamen sil (tercih, çünkü çağıranı yok + getCachedHistory ayrı export'ta kalır) ya da aynı pattern ile düzelt (descending+reverse) ve sessionId opsiyonel parametresi ekle. Minimal-doğru: loadSessionMessages'ı düzelt + loadChatHistory'yi sil (export'u kontrol et: başka import yok, grep teyit etti).

```tsx
// loadSessionMessages
const { data } = await supabase
  .from('chat_messages')
  .select('id, role, content, task_mode, created_at, actions_executed')
  .eq('session_id', sessionId)
  .order('created_at', { ascending: false })
  .limit(limit);
return ((data as ChatMessage[]) ?? []).reverse();
// loadChatHistory: tamamen kaldır (çağıranı yok)
```

**Doğrulama:** 1) tsc: import kalmadığından loadChatHistory silinince derleme temiz olmalı (grep ile tekrar teyit). 2) Preview/emülatör: 60+ mesajlı bir session aç → en son mesajların göründüğünü ve sıranın kronolojik (eski->yeni) olduğunu gözle doğrula. 3) q.mjs: hedef session için son 50 created_at DESC ile beklenen id kümesini karşılaştır.

---

### 🟠 HIGH — loadSessions: oturum listesinde N+1 — her oturum için ayrı son-mesaj sorgusu
- **Dosyalar:** `src/services/chat.service.ts`
- **Efor:** Orta · **Risk:** low · **Migration gerekli** · **batch:** `src-chat-service`

**Kök-neden:** chat.service.ts:399 for(const s of sessions) döngüsünde her oturum için ayrı seri-await chat_messages sorgusu (order desc limit 1). 20 oturum = 1+20 = 21 ardışık round-trip. KÖK-NEDEN TEYİT EDİLDİ (kod birebir görüldü). Ek tespit: chat_sessions'ta updated_at ve message_count kolonları zaten mevcut ve trigger'larla güncel tutuluyor; ama son mesaj İÇERİĞİ (last_message preview) bu kolonlardan türetilemez, dolayısıyla içerik gerçekten gerekli ise toplu sorgu şart.

**Yeniden değerlendirme:** Bulgu doğru ve teyit edildi. RPC yolu hem N+1'i hem RLS izolasyonunu korur. batchKey src-chat-service ile loadSessionMessages düzeltmesiyle aynı dosya — sıralı uygulanmalı (paralel değil).

**Düzeltme:** Döngüyü kaldır, tek toplu sorguyla son mesajları çek. En temiz: SECURITY DEFINER/normal RPC DISTINCT ON (session_id) content ORDER BY session_id, created_at DESC ile her oturumun son mesajını tek sorguda al. RPC istemiyorsak PostgREST ile: tüm session id'ler için .in('session_id', ids).order('created_at',{ascending:false}) çekip client'ta her session için ilk görüleni Map'e koy — ancak bu tüm mesajları çeker, sayfalama gerektirir. Tercih edilen minimal-doğru: yeni RPC get_session_last_messages(ids uuid[]) → setof(session_id, content). Alternatif düşük-efor: last_message preview'i chat_sessions'a denormalize bir last_message_preview kolonuyla taşı (trigger güncellesin) ve ek sorguyu tamamen kaldır.

```tsx
// RPC (migration):
CREATE OR REPLACE FUNCTION public.get_session_last_messages(p_ids uuid[])
RETURNS TABLE(session_id uuid, content text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (m.session_id) m.session_id, m.content
  FROM chat_messages m
  WHERE m.session_id = ANY(p_ids) AND m.user_id = auth.uid()
  ORDER BY m.session_id, m.created_at DESC;
$$;
// client loadSessions:
const ids = sessions.map(s=>s.id);
const { data: lasts } = await supabase.rpc('get_session_last_messages',{p_ids:ids});
const map = new Map((lasts??[]).map(r=>[r.session_id, r.content]));
for (const s of sessions) { const c=map.get(s.id); if(c) s.last_message=c.substring(0,80); }
```

**Migration taslağı:**
```sql
RPC için yeni migration 053_get_session_last_messages.sql — CREATE OR REPLACE FUNCTION (idempotent), GRANT EXECUTE TO authenticated. STABLE, SQL dili; auth.uid() ile satır izolasyonu korunur (SECURITY DEFINER gerekmez). Geri-alma: DROP FUNCTION. Not: idx_chat_messages_user mevcut; DISTINCT ON için (session_id, created_at DESC) index ideal ama tablo küçükken zorunlu değil — istenirse aynı migration'a CREATE INDEX idx_chat_messages_session_created ON chat_messages(session_id, created_at DESC) eklenebilir.
```

**Doğrulama:** 1) tsc temiz. 2) q.mjs: SELECT proname FROM pg_proc WHERE proname='get_session_last_messages'. 3) Network/log: loadSessions çağrısı artık 2 round-trip (sessions + rpc) olmalı, 21 değil. 4) Preview: oturum listesinde son mesaj preview'lerinin doğru göründüğünü gözle doğrula.

---

### 🟡 MEDIUM — Plan/hedef yazımları transaction'sız (delete/archive/deactivate-then-insert) — ara hatada veri kaybı
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/migrations/051_atomic_plan_goal_writes.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `rpc-atomic-writes`

**Kök-neden:** ai-chat/index.ts'te üç sıcak yazım yolu tek-aktif invariant'ı transaction'sız iki ifadeyle koruyor. Teyit: (1) :1351 daily_plans .delete().eq(user_id).gte/lte(date) sonra ayrı .insert(writeRows); delErr OK olsa bile insErr yalnız console.error'lanıyor, silineni geri yazmıyor → o haftanın tüm satırları silinmiş ama yeni yazılmamış kalabilir (dashboard boşalır). (2) :3751 goals .update({is_active:false}) sonra ayrı .insert(); gsErr'de yalnız feedback push edilip break, deaktive edilen eski hedef geri alınmıyor → hiç aktif hedef kalmaz. (3) :1231/:1254 weekly_plans archive→promote (LOW olarak ayrıca listelenmiş, aynı RPC ile çözülür). writeRows version=1 hard-code; canlıda daily_plans_user_id_date_version_key UNIQUE mevcut (teyit edildi) → upsert(onConflict) temiz çalışır.

**Düzeltme:** İki yeni SECURITY DEFINER plpgsql RPC ekle ve ai-chat'ten çağır. (A) project_daily_plans(p_user uuid, p_lower date, p_end date, p_rows jsonb): tek transaction'da BEGIN; her satır için INSERT ... ON CONFLICT (user_id,date,version) DO UPDATE (version=1 sabit) — DELETE-then-insert yerine upsert; range içinde p_rows'ta olmayan eski tarihleri ayrıca temizlemek gerekirse aynı tx içinde DELETE ... WHERE date BETWEEN p_lower AND p_end AND date NOT IN (jsonb tarihleri). Böylece delete ile insert atomik. (B) set_active_goal(p_user uuid, p_goal jsonb): tek tx'te UPDATE goals SET is_active=false WHERE user_id=p_user AND is_active; INSERT INTO goals(...); hata olursa tx rollback → eski hedef aktif kalır. ai-chat:1351 bloğunu supabaseAdmin.rpc('project_daily_plans',...) ile, :3751 bloğunu supabaseAdmin.rpc('set_active_goal',...) ile değiştir; mevcut insErr/gsErr hata-feedback mantığını rpc error'una bağla.

```tsx
-- 051: create or replace function public.set_active_goal(p_user uuid, p_goal jsonb) returns void language plpgsql security definer set search_path=public as $$ begin update goals set is_active=false where user_id=p_user and is_active; insert into goals(user_id,goal_type,target_weight_kg,target_weeks,start_weight_kg,weekly_rate,is_active,created_at) select p_user, p_goal->>'goal_type', (p_goal->>'target_weight_kg')::numeric, (p_goal->>'target_weeks')::int, (p_goal->>'start_weight_kg')::numeric, (p_goal->>'weekly_rate')::numeric, true, now(); end; $$;
// ai-chat: const { error: gsErr } = await supabaseAdmin.rpc('set_active_goal', { p_user: userId, p_goal: {...} });
```

**Migration taslağı:**
```sql
051_atomic_plan_goal_writes.sql — idempotent (create or replace function), geri-alınabilir (drop function ile). Üç fonksiyon: set_active_goal, project_daily_plans, promote_weekly_plan (LOW weekly_plans ayağı için, archive+promote tek tx). GRANT EXECUTE yalnız service_role'a; SECURITY DEFINER + set search_path=public.
```

**Doğrulama:** tsc temiz; kk.mjs canlı: bir hedef varken yeni hedef onayla → eski deaktive + yeni aktif (goals'ta tek is_active=true). Negatif test: insert'i bilerek kıracak değer (geçersiz goal_type) → eski hedef hâlâ aktif (q.mjs SELECT count(*) FROM goals WHERE user_id=X AND is_active). daily_plans: plan onayla → q.mjs ile o hafta satırları version=1 dolu; ikinci onay sonrası satır sayısı tutarlı (orphan yok).

---

### 🟡 MEDIUM — Migration 037–050 canlıya uygulanmış ama schema_migrations'a kayıtlı değil (takip edilmeyen drift)
- **Dosyalar:** `supabase/migrations/037_fix_ai_summary_merge_supplement_notes.sql`, `supabase/migrations/038`, `supabase/migrations/039`, `supabase/migrations/040_fix_household_rls_recursion.sql`, `supabase/migrations/041`, `supabase/migrations/042`, `supabase/migrations/043_plan_goal_household_hardening.sql`, `supabase/migrations/044`, `supabase/migrations/045`, `supabase/migrations/046_fix_subscriptions_ins_premium_selfgrant.sql`, `supabase/migrations/047`, `supabase/migrations/048`, `supabase/migrations/049_weight_history_unique_per_day.sql`, `supabase/migrations/050_security_hardening_round2.sql`
- **Efor:** Büyük · **Risk:** med · **batch:** `migration-idempotency-repair` · **Bağımlı:** [HIGH] households, household_members, coach_consents tabloları hiçbir migration'da CREATE edilmiyor; [MEDIUM] ai_summary.learned_meal_times kolonu hiçbir migration'da eklenmiyor

**Kök-neden:** Canlı supabase_migrations.schema_migrations max version='036' (q.mjs ile teyit: 036,035,034,033,032 son 5). Repo'da 037..050 dosyaları mevcut ve içerikleri canlıda var (049 weight_history_user_date_uniq, 050 hm_select_own teyit edildi) → DDL'ler Management API/SQL editör ile uygulanmış, takip tablosu güncellenmemiş. Bu, diğer tüm 'idempotent yap' önerilerinin (households baseline, ai_summary kolonları, cron, trigger) ön-koşulu: o migration'lar idempotent olmadan repair edilirse db push onları yeniden çalıştırıp kırar.

**Düzeltme:** İki aşama. (1) 037-050'nin her birini idempotent hale getir: CREATE POLICY → DROP POLICY IF EXISTS + CREATE POLICY (veya pg_policy kontrolü); CREATE INDEX → CREATE INDEX IF NOT EXISTS; CREATE FUNCTION → CREATE OR REPLACE; ALTER TABLE ADD COLUMN → ADD COLUMN IF NOT EXISTS. (2) schema_migrations'ı gerçek durumla senkronla — supabase migration repair --status applied 037 ... 050 (her version için). Sonrasında kural: DDL yalnız tracked migration üzerinden, elle SQL editör DDL yasak (MEMORY'ye not).

```tsx
# repair (local CLI, DB yazma DEĞİL planın parçası):
# supabase migration repair --status applied 037 038 039 040 041 042 043 044 045 046 047 048 049 050
# her dosyada: create policy X -> drop policy if exists X on T; create policy X ...
```

**Doğrulama:** Her dosyayı idempotent yaptıktan sonra fresh shadow DB'de (supabase db reset --local) 001..050 hatasız uygulanmalı (bu households/ai_summary baseline bulguları çözülünce mümkün). q.mjs: SELECT count(*) FROM supabase_migrations.schema_migrations = 50 olmalı repair sonrası.

---

### 🟡 MEDIUM — PlanStatus enum drift: database.ts canlı daily_plans.status 'active'/'mvd_suspended' değerlerini içermiyor
- **Dosyalar:** `src/types/database.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `database-ts-types`

**Kök-neden:** database.ts:34 PlanStatus = 'draft'|'approved'|'modified'|'rejected' (teyit edildi). Canlı daily_plans.status CHECK 6 değerli ('active','mvd_suspended' ekstra) ve runtime'da yazılıp okunuyor: ai-chat:3372 .update({status:'mvd_suspended'}), service-contexts:379 plan?.status==='mvd_suspended', ai-proactive:649 .eq('status','mvd_suspended'). database.ts'teki tek PlanStatus iki anlamı karıştırıyor — plan.service.ts'te weekly_plans için ayrı PlanStatus de var (isim çakışması).

**Düzeltme:** database.ts'te daily_plans için ayrı bir DailyPlanStatus tipi tanımla, 6 değeri kapsasın: 'draft'|'approved'|'modified'|'rejected'|'active'|'mvd_suspended'. DailyPlan interface'inin status alanını DailyPlanStatus yap. Mevcut PlanStatus (line 34) weekly/plan.service.ts kullanımına dokunulmayacaksa korunur ama yorumla netleştir. Önce canlı CHECK'i q.mjs ile çekip değer kümesini birebir al.

```tsx
export type DailyPlanStatus = 'draft' | 'approved' | 'modified' | 'rejected' | 'active' | 'mvd_suspended';
// DailyPlan interface: status: DailyPlanStatus;
```

**Doğrulama:** q.mjs: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.daily_plans'::regclass AND contype='c' AND conname ILIKE '%status%' — TS birebir eşleşmeli. tsc: ai-chat/service-contexts/ai-proactive'teki mvd_suspended atamaları as cast olmadan derlenmeli (edge ayrı tsconfig ise client-side okumalar kontrol edilsin).

---

### 🟡 MEDIUM — Migration 014'teki 3 proactive cron canlıda yok — tek kochko-proactive-hourly ile değiştirilmiş
- **Dosyalar:** `supabase/migrations/052_cron_reconcile_proactive_hourly.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `cron-migrations`

**Kök-neden:** Teyit: canlı cron.job'da morning/afternoon/evening YOK; tek kochko-proactive-hourly schedule='7 * * * *' var. 014 morning/afternoon/evening 3 ayrı schedule tanımlar + current_setting('app.settings.supabase_url') GUC kullanır. Yeniden-yapılandırma hiçbir migration'da yok → cron drift. ai-proactive/index.ts hourly pencere bekliyor.

**Düzeltme:** Canlıyı yansıtan idempotent migration ekle: 014'ün 3 eski job'ını cron.unschedule ile kaldır (her birini IF EXISTS güvenli sarmala) ve kochko-proactive-hourly'yi '7 * * * *' ile schedule et (zaten varsa unschedule+reschedule veya pg_catalog kontrolü). URL/auth modelini diğer cron'larla (sabit URL + secret) tek tutarlı kaynağa hizala. Bu yalnız fresh-install/CI tutarlılığı için; canlı zaten doğru.

```tsx
do $$ begin perform cron.unschedule(jobid) from cron.job where jobname in ('proactive-morning','proactive-afternoon','proactive-evening'); exception when others then null; end $$;
-- sonra: select cron.schedule('kochko-proactive-hourly','7 * * * *', $cmd$ ... $cmd$) where not exists (select 1 from cron.job where jobname='kochko-proactive-hourly');
```

**Migration taslağı:**
```sql
052_cron_reconcile_proactive_hourly.sql — idempotent (unschedule IF EXISTS + conditional schedule). Geri-alınamaz cron silme değil; eski job'lar zaten yok. Secret/URL gömme yerine bkz. ayrı LOW (Vault) bulgusu.
```

**Doğrulama:** q.mjs: SELECT jobname,schedule FROM cron.job — yalnız kochko-* set, eski 3 isim yok (zaten böyle). Migration'ı fresh shadow DB'de çalıştır → tek hourly job oluşmalı, GUC hatası vermemeli.

---

### 🟡 MEDIUM — chat_messages'ta iki redundant trigger her mesajı iki kez UPDATE ediyor + update_session_timestamp migration'larda yok
- **Dosyalar:** `supabase/migrations/053_consolidate_chat_session_triggers.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `chat-session-triggers`

**Kök-neden:** Teyit: chat_messages'ta 2 AFTER INSERT trigger canlıda — trg_chat_messages_bump_session (fn bump_chat_session_updated_at, mig 035) ve trg_update_session_on_message (fn update_session_timestamp). İkincinin fonksiyon/trigger'ı hiçbir migration'da yok (grep boş) → out-of-band. İkisi de chat_sessions'ı UPDATE ediyor (biri updated_at, diğeri updated_at+message_count+1) → her mesajda 2 UPDATE, kilit+WAL maliyeti; ayrıca fresh-install message_count'u hiç artırmaz (drift).

**Düzeltme:** Tek idempotent migration: (1) update_session_timestamp fonksiyonunu canlı tanımıyla CREATE OR REPLACE ederek migration'a kaydet (drift kapanır), (2) iki trigger'ı tek fonksiyonda birleştir: bump_chat_session_updated_at'ı UPDATE chat_sessions SET updated_at=now(), message_count=message_count+1 yapacak şekilde genişlet, eski trg_update_session_on_message trigger'ını DROP et (tek UPDATE kalsın). Fonksiyon canlı davranışını korumalı (updated_at + message_count). Önce canlı fn gövdesini pg_get_functiondef ile al.

```tsx
create or replace function bump_chat_session_updated_at() returns trigger language plpgsql as $$ begin update chat_sessions set updated_at=now(), message_count=coalesce(message_count,0)+1 where id=NEW.session_id; return NEW; end; $$;
drop trigger if exists trg_update_session_on_message on chat_messages;
drop function if exists update_session_timestamp();
```

**Migration taslağı:**
```sql
053_consolidate_chat_session_triggers.sql — create or replace fonksiyon (idempotent), drop trigger/function IF EXISTS. Geri-alınabilir: eski iki-trigger düzeni ayrı down-migration ile geri kurulabilir. DİKKAT: birleştirme öncesi canlı message_count davranışının +2'ye değil +1'e döndüğünü doğrula (şu an aslında message_count'u yalnız update_session_timestamp artırıyor; bump sadece updated_at — yani çift sayım YOK, çift UPDATE var).
```

**Doğrulama:** q.mjs: SELECT tgname FROM pg_trigger WHERE tgrelid='public.chat_messages'::regclass AND NOT tgisinternal — tek trigger kalmalı. kk.mjs: bir oturuma mesaj at → chat_sessions.message_count tam +1 artmalı (2 değil), updated_at güncellenmeli.

---

### 🟡 MEDIUM — ai_summary.learned_meal_times kolonu hiçbir migration'da eklenmiyor ama ai_summary_merge referans veriyor
- **Dosyalar:** `supabase/migrations/0036b_ai_summary_phantom_columns.sql`
- **Efor:** Orta · **Risk:** low · **Migration gerekli** · **batch:** `ai-summary-baseline`

**Kök-neden:** Teyit: canlı ai_summary'de learned_meal_times, snacking_hours, extraction_checkpoint, onboarding_tasks_completed kolonları MEVCUT (information_schema). 003 CREATE TABLE bu kolonları içermiyor ve ADD COLUMN aramaları boş → out-of-band. 015:51 ai_summary_merge learned_meal_times=COALESCE(...) içeriyor → fresh-install'da 015 'column does not exist' ile patlar, Layer-2 hafıza yazma yolu kurulamaz. Aynı risk snacking_hours (020) için de geçerli.

**Düzeltme:** 015'ten ÖNCE çalışacak bir baseline migration ekle (numarayı 003-015 arasına; pratikte 037-050 idempotency repair sürecinin parçası olduğundan, 003 dosyasına ADD COLUMN IF NOT EXISTS eklemek en temizi veya 0036b gibi ara slot). ALTER TABLE ai_summary ADD COLUMN IF NOT EXISTS ile 4 kolonu canlı tip+default ile ekle: learned_meal_times jsonb default '[]', snacking_hours jsonb default '[]' (canlı tipi q.mjs ile doğrula), extraction_checkpoint (canlı tip), onboarding_tasks_completed (canlı tip). En düşük riskli: 003'e dahil etmek yerine yeni idempotent migration 015'ten önce.

```tsx
alter table ai_summary add column if not exists learned_meal_times jsonb default '[]'::jsonb;
alter table ai_summary add column if not exists snacking_hours jsonb default '[]'::jsonb;
-- extraction_checkpoint / onboarding_tasks_completed: canlı tipi al
-- q.mjs: SELECT column_name,data_type,column_default FROM information_schema.columns WHERE table_name='ai_summary' AND column_name IN (...)
```

**Migration taslağı:**
```sql
Yeni idempotent migration (015'ten önce slot) — ADD COLUMN IF NOT EXISTS (4 kolon). Geri-alınabilir: down'da DROP COLUMN IF EXISTS ama veri kaybı riski olduğu için down sadece dev. Tipler canlıdan birebir alınmalı.
```

**Doğrulama:** Önce q.mjs ile 4 kolonun data_type+default'unu al, migration tipi birebir eşleştir. Fresh shadow DB'de 001..015 sırayla → ai_summary_merge CREATE hatasız. kk.mjs: Layer-2 extraction tetikle → learned_meal_times dolmalı.

---

### 🟡 MEDIUM — Migration 025 pgsodium at-rest şifrelemesi fiilen inert — sağlık verisi düz metin
- **Dosyalar:** `supabase/migrations/054_cleanup_inert_pgsodium.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `pgsodium-cleanup`

**Kök-neden:** Teyit: lab_values gerçek kolonları parameter_name/value/unit (canlı), 025'in hedeflediği test_name/value_text/note YOK → 025'in IF EXISTS guard'ı hep FALSE, blok ölü. health_events canlıda description (düz metin) + description_nonce + event_type_nonce kolonları var ama yazma-zamanı şifreleme trigger'ı yok; decrypted_health_events view mevcut (asılı). KVKK at-rest iddiası gerçekleşmiyor. MEMORY notu da 'pgsodium şifreleme inert, foto-cleanup ölü' diyor → bilinen borç.

**Düzeltme:** Karar gerektiren bulgu; minimal-doğru seçenek TEMİZLEME (şifreleme şu an ürün gereksinimi değil, inert): yeni migration ile (1) decrypted_health_events view'ı DROP IF EXISTS, (2) health_events.description_nonce ve event_type_nonce ölü kolonlarını DROP COLUMN IF EXISTS, (3) asılı SECURITY LABEL'ları kaldır (security label for pgsodium on column ... is null), (4) lab_values üzerindeki ölü 025 kalıntısı zaten no-op olduğu için ek temizlik gerekmez. Eğer gerçek şifreleme isteniyorsa AYRI bir epik (app yazımını decrypted_* view'a yönlendir, event trigger kalıcı kur, lab_values kolon adlarını düzelt) — bu görev kapsamında değil, not düşülür.

```tsx
drop view if exists public.decrypted_health_events;
security label for pgsodium on column public.health_events.description is null; -- varsa
alter table public.health_events drop column if exists description_nonce;
alter table public.health_events drop column if exists event_type_nonce;
```

**Migration taslağı:**
```sql
054_cleanup_inert_pgsodium.sql — DROP VIEW/COLUMN IF EXISTS + SECURITY LABEL ... IS NULL. Geri-alınabilir ama nonce kolonlarında veri olmadığı doğrulanmalı (canlıda hep NULL — bir satır description_nonce IS NULL teyit edildi). ÜRÜN KARARI: şifreleme gerçekten istenirse bu migration YERİNE şifreleme-tamamlama epiki yapılmalı.
```

**Doğrulama:** Önce q.mjs: SELECT * FROM pg_seclabel WHERE provider='pgsodium' — hangi label'lar asılı. nonce kolonlarında non-null var mı kontrol et (hepsi NULL ise drop güvenli): SELECT count(*) FROM health_events WHERE description_nonce IS NOT NULL. Migration sonrası view ve nonce kolonları yok; app health.service.ts düz description okumaya devam ediyor (kırılma yok).

---

### 🟡 MEDIUM — meal_logs logged_at DESC sıralaması için index yok — büyümeyle seq scan
- **Dosyalar:** `supabase/migrations/055_meal_logs_logged_at_index.sql`
- **Efor:** Küçük · **Risk:** low · **batch:** `index-tuning`

**Kök-neden:** Teyit: meal_logs canlıda yalnız meal_logs_pkey + idx_meal_logs_user_date (user_id, logged_for_date). Sıcak sorgular logged_at (timestamptz) DESC sıralıyor (realtime-sync.service.ts:241, ai-proactive:844/:389); logged_for_date (date) ≠ logged_at → mevcut index bu sıralamaya hizmet etmez. ai-proactive cron kullanıcı başına çalıştığı için fleet ölçeğinde yük.

**Düzeltme:** Kısmi composite index ekle: CREATE INDEX IF NOT EXISTS idx_meal_logs_user_logged_at ON meal_logs(user_id, logged_at DESC) WHERE is_deleted = false. ai-proactive'in is_deleted=false filtresi kısmi index ile tam karşılanır. Önce is_deleted kolonunun varlığını q.mjs ile doğrula (yoksa kısmi olmadan).

```tsx
create index if not exists idx_meal_logs_user_logged_at on public.meal_logs (user_id, logged_at desc) where is_deleted = false;
```

**Doğrulama:** q.mjs: SELECT column_name FROM information_schema.columns WHERE table_name='meal_logs' AND column_name='is_deleted' (kısmi index için). Migration sonrası: EXPLAIN ile son-50-öğün sorgusu Index Scan kullanmalı (canlı veri azken plan görmek için q.mjs EXPLAIN).

---

### 🟡 MEDIUM — getCoachClients: danışan başına 3 ayrı sorgu (N+1)
- **Dosyalar:** `src/services/coach-mode.service.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `coach-mode-service` · **Bağımlı:** [LOW] Koç (B2B) veri-paylaşımı RLS katmanında ölü

**Kök-neden:** Teyit: coach-mode.service.ts:89 for(const consent of consents) döngüsünde her danışan için 3 ardışık await — profiles(:93), daily_reports(:104), goals(:112). N danışan = 1+3N round-trip. NOT: bu özellik şu an RLS katmanında zaten boş dönüyor (aşağıdaki LOW), yani performans düzeltmesi RLS düzeltmesiyle birlikte anlamlı.

**Düzeltme:** Döngüyü toplu sorgulara çevir: clientIds = consents.map(c=>c.user_id). Üç sorgu: profiles .in('id', clientIds).is('deleted_at',null); goals .in('user_id', clientIds).eq('is_active',true); daily_reports için son satır — basit yol .in('user_id', clientIds).order('date',desc) çekip JS'te user_id başına ilk satırı Map'le (veya DISTINCT ON RPC). Sonra clientIds üzerinde map ile CoachClient[] kur. Toplam 3 round-trip (sabit).

```tsx
const clientIds = consents.map(c => c.user_id as string);
const [{data:profiles},{data:goals},{data:reports}] = await Promise.all([
  supabase.from('profiles').select('id,weight_kg').in('id',clientIds).is('deleted_at',null),
  supabase.from('goals').select('user_id,goal_type').in('user_id',clientIds).eq('is_active',true),
  supabase.from('daily_reports').select('user_id,date,compliance_score').in('user_id',clientIds).order('date',{ascending:false})
]);
// Map'ler ile birleştir; reports'tan user başına ilk(=en yeni) al.
```

**Doğrulama:** tsc temiz. RLS düzeltmesi (LOW coach RPC) yapıldıktan sonra kk.mjs ile bir koça consent ver → getCoachClients tek-sefer 3 sorguyla danışanları döndürmeli. Önce RLS düzeltmesi yapılmadan veri boş döner (beklenen).

---

### 🟡 MEDIUM — Tam çift (duplicate) index'ler — yazma maliyeti ve disk israfı (5 tablo)
- **Dosyalar:** `supabase/migrations/056_drop_duplicate_indexes.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `index-cleanup`

**Kök-neden:** Teyit (pg_indexes canlı): weight_history (idx_weight_history_user ↔ weight_history_user_date_uniq), daily_metrics (idx_daily_metrics_user_date ↔ daily_metrics_user_id_date_key), audit_logs (idx_audit_logs_user ↔ idx_audit_logs_user_created), coaching_messages (idx_coaching_user ↔ idx_coaching_messages_user), saved_recipes (idx_recipes_user ↔ idx_saved_recipes_user). Her çiftte non-unique tekrar gereksiz; UNIQUE/constraint olanlar (weight_history_user_date_uniq, daily_metrics_user_id_date_key) korunmalı.

**Düzeltme:** Tek idempotent migration ile her çiftin non-unique/gereksiz tekrarını DROP INDEX IF EXISTS: idx_weight_history_user, idx_daily_metrics_user_date, idx_audit_logs_user, idx_coaching_user, idx_recipes_user. Drop'tan önce her birinin scan istatistiğini ve UNIQUE OLMADIĞINI q.mjs ile doğrula. audit_logs/coaching/recipes çiftlerinde 'hangisi tutulacak' kararı: daha geniş/kullanılan olanı tut (idx_audit_logs_user_created, idx_coaching_messages_user, idx_saved_recipes_user).

```tsx
drop index if exists public.idx_weight_history_user;
drop index if exists public.idx_daily_metrics_user_date;
drop index if exists public.idx_audit_logs_user;
drop index if exists public.idx_coaching_user;
drop index if exists public.idx_recipes_user;
```

**Migration taslağı:**
```sql
056_drop_duplicate_indexes.sql — DROP INDEX IF EXISTS (5 adet). Geri-alınabilir: down'da CREATE INDEX (orijinal tanımlardan). UNIQUE/constraint index'lere DOKUNMA.
```

**Doğrulama:** q.mjs ÖNCE: SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname IN (...) — drop edilecekler düşük/0 scan olmalı. Ayrıca pg_index.indisunique=false doğrula (yanlışlıkla unique drop etme). Migration sonrası ilgili user_id sorguları diğer index ile karşılanmalı (EXPLAIN).

---

### 🟡 MEDIUM — Tip kapsamı drift'i: canlı kolonlar database.ts interface'lerinde yok (Profile 27, AISummary 4)
- **Dosyalar:** `src/types/database.ts`, `src/services/privacy.service.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `database-ts-types`

**Kök-neden:** Teyit: database.ts başlık 'migrations 001-005' (line 3, şema 050'de — yanıltıcı). Profile interface 27 canlı kolonu eksik (trial_used, push_token, notification_prefs, maintenance_*, plans_used_free, daily_msg_count vb.) ve line 137 [key:string]:unknown bunu maskeliyor. AISummary (322-352) aktif okunan learned_meal_times/snacking_hours/extraction_checkpoint/onboarding_tasks_completed'i içermiyor (canlıda kolonlar var, teyit edildi) → privacy.service.ts as cast'e zorlanıyor.

**Düzeltme:** q.mjs ile profiles ve ai_summary'nin TÜM kolon listesini+tiplerini çek; database.ts Profile ve AISummary interface'lerine eksik kolonları doğru TS tipleriyle ekle. Profile'daki [key:string]:unknown'ı kaldır (artık gerekmiyor, yanlış kolon adını derlemede yakalasın). Başlık yorumunu '001-050' yap. AISummary'ye 4 kolonu ekle → privacy.service.ts:113'teki as Record<...> cast'i kaldır. İdeali supabase gen types CI'a bağlamak (not).

```tsx
// AISummary'ye:
learned_meal_times: { meal: string; hour: number }[] | null; // canlı jsonb tipine göre
snacking_hours: ... ; extraction_checkpoint: ... ; onboarding_tasks_completed: ... ;
// Profile'a 27 kolon; [key:string]:unknown sil
```

**Doğrulama:** q.mjs ile kolon listesi referans. tsc: [key:string]:unknown kaldırıldıktan sonra Profile'a erişen tüm kod derlenmeli (yanlış kolon adı varsa şimdi hata verir — bu istenen). privacy.service.ts cast kaldırıldıktan sonra tsc temiz.

---

### 🔵 LOW — Koç (B2B) veri-paylaşımı RLS katmanında ölü: rızalı danışan verisine erişim yok
- **Dosyalar:** `supabase/migrations/057_coach_client_access_rpc.sql`, `src/services/coach-mode.service.ts`
- **Efor:** Büyük · **Risk:** med · **Migration gerekli** · **batch:** `coach-mode-service`

**Kök-neden:** Teyit: coach-mode.service.ts:76+ getCoachClients sıradan RLS'e tabi client ile profiles/daily_reports/goals'u clientId üzerinden sorguluyor; bu tabloların SELECT politikaları yalnız auth.uid()=id/user_id'ye izin veriyor (coach köprüsü/SECURITY DEFINER yok). profiles.single() null → :100 continue her danışanı atlar → dashboard boş. shareDataWithCoach keyfi coach_id kabul ediyor (coach_id'nin geçerli kullanıcı olduğu doğrulanmıyor, :142+).

**Düzeltme:** SECURITY DEFINER RPC ekle: get_coach_clients(p_coach uuid) — EXISTS(coach_consents WHERE coach_id=auth.uid() AND user_id=hedef AND is_active AND <tip>=ANY(shared_data_types)) kontrolüyle profiles/goals/daily_reports'tan izinli kolonları döndürür (auth.uid()=p_coach guard). coach-mode.service.ts:getCoachClients'ı bu RPC'ye çevir (tek çağrı). shareDataWithCoach'ta coach_id'nin profiles'ta var olduğunu doğrula (RPC veya select). Bu MEDIUM N+1 düzeltmesini de kapsar (RPC tek round-trip).

```tsx
create or replace function get_coach_clients() returns table(user_id uuid, weight_kg numeric, goal_type text, last_date date, compliance numeric) language sql security definer set search_path=public as $$ select cc.user_id, p.weight_kg, g.goal_type, dr.date, dr.compliance_score from coach_consents cc join profiles p on p.id=cc.user_id and p.deleted_at is null left join lateral (select goal_type from goals where user_id=cc.user_id and is_active limit 1) g on true left join lateral (select date,compliance_score from daily_reports where user_id=cc.user_id order by date desc limit 1) dr on true where cc.coach_id=auth.uid() and cc.is_active; $$;
```

**Migration taslağı:**
```sql
057_coach_client_access_rpc.sql — create or replace function (idempotent), SECURITY DEFINER + set search_path, GRANT EXECUTE TO authenticated. Geri-alınabilir: drop function. shared_data_types filtresi kolon-bazında uygulanmalı (örn. compliance yalnız 'reports' paylaşımı varsa).
```

**Doğrulama:** kk.mjs: koç A, danışan B consent (is_active) ver → get_coach_clients() B'yi döndürmeli; consent iptal → boş. Güvenlik: başka koç A'nın danışanını GÖREMEMELİ (auth.uid() guard). shareDataWithCoach geçersiz coach_id ile hata vermeli.

---

### 🔵 LOW — execute_pending_account_deletions geri-alınamaz hard-delete — audit izi / üst-sınır / iptal bayrağı yok
- **Dosyalar:** `supabase/migrations/058_account_deletion_audit_safeguards.sql`
- **Efor:** Orta · **Risk:** high · **Migration gerekli** · **batch:** `account-deletion`

**Kök-neden:** Teyit gerekli (q.mjs ile fn gövdesi): 023 fonksiyonu deletion_requested_at < now()-30d satırlar için DELETE FROM profiles (CASCADE) + DELETE FROM auth.users — geri-alınamaz, silmeden önce audit INSERT yok, döngüde üst-sınır/dry-run yok, iptal yalnız deletion_requested_at NULL'lamaya bağlı. 050:42 yalnız EXECUTE grant'ını revoke etti, mantığa dokunmadı.

**Düzeltme:** Fonksiyonu CREATE OR REPLACE ile sertleştir: (1) her silinen kullanıcı için DELETE'ten ÖNCE audit_logs INSERT (event_type='data_delete', user_id, detail=jsonb{requested_at}); (2) döngüye güvenlik üst-sınırı (örn. tek çalıştırmada max 100 satır LIMIT, FOR ... IN SELECT ... LIMIT 100); (3) opsiyonel deletion_cancelled boolean bayrağı yerine mevcut deletion_requested_at NULL mekanizmasını koru ama WHERE'e deletion_requested_at IS NOT NULL ekle (zaten var). Önce canlı fn gövdesini pg_get_functiondef ile al, minimal değişiklik yap.

```tsx
for r in select id from profiles where deletion_requested_at < now()-interval '30 days' limit 100 loop
  insert into audit_logs(user_id,event_type,created_at) values (r.id,'data_delete',now());
  delete from auth.users where id=r.id; -- profiles CASCADE
end loop;
```

**Migration taslağı:**
```sql
058_account_deletion_audit_safeguards.sql — create or replace function (idempotent). RISK: gerçek silme yolu; değişiklik canlı veriyi etkilemez (yalnız fn mantığı) ama test ederken GERÇEK silme yapma, ayrı dev kullanıcıyla doğrula. Geri-alınabilir: eski fn gövdesi down'da.
```

**Doğrulama:** q.mjs: SELECT pg_get_functiondef('public.execute_pending_account_deletions'::regprocedure) — mevcut gövdeyi al. kk.mjs (dikkatli, dev kullanıcı): deletion_requested_at'ı 31 gün geçmişe set et → fn çalıştır → audit_logs'ta data_delete satırı oluşmalı, kullanıcı silinmeli. İptal: NULL'a çekilince silinmemeli.

---

### 🔵 LOW — Cron job komutlarında service_role JWT ve x-cron-secret düz metin gömülü
- **Dosyalar:** `supabase/migrations/059_cron_secrets_via_vault.sql`
- **Efor:** Büyük · **Risk:** high · **Migration gerekli** · **batch:** `cron-migrations` · **Bağımlı:** [MEDIUM] Migration 014'teki 3 proactive cron canlıda yok

**Kök-neden:** Teyit: cron job net.http_post komutları service_role JWT + x-cron-secret'i düz metin taşıyor (014/022). cron.job yalnız postgres'e SELECT açık ama sırlar migration dosyalarında ve DB'de sabit/uzun ömürlü. DB/yedek/log/operatör erişimi olan aktör service_role'ü ele geçirir → tüm RLS baypas. Rotasyon zor.

**Düzeltme:** Sırları Supabase Vault'a taşı (vault.create_secret) ve cron komutunda current_setting/vault.decrypted_secrets ile çöz; JWT'yi command'e gömme. Cron job'ları unschedule+reschedule ile yeni komuta güncelle (komut içinde format() ile vault'tan okunan secret kullanılır). Alternatif minimal: net.http_post yerine DB-içi SECURITY DEFINER fonksiyon çağrısı (HTTP gerekmiyorsa). Rotasyon için Vault tek noktada.

```tsx
-- vault'a koy (bir kez): select vault.create_secret('<jwt>','cron_service_role');
-- cron command: select net.http_post(url, headers:=jsonb_build_object('Authorization','Bearer '|| (select decrypted_secret from vault.decrypted_secrets where name='cron_service_role')), ...);
```

**Migration taslağı:**
```sql
059_cron_secrets_via_vault.sql — Vault secret oluştur + 4 cron job'ı vault-referanslı komutla reschedule. RISK: yanlış komut cron'u kırar (bildirimler durur); shadow/staging'de test et. Geri-alınabilir ama secret rotasyonu manuel. Vault extension'ın projede etkin olduğunu doğrula.
```

**Doğrulama:** q.mjs: SELECT jobname, command FROM cron.job — command'de düz JWT görünmemeli, vault referansı olmalı. Vault gizli olduğundan SELECT vault.secrets sadece postgres'e açık. Cron tetiklenince edge 200 dönmeli (kk.mjs ile manuel net.http_post testi).

---

### 🔵 LOW — household_members SELECT: dar hm_select_own ile geniş Members can view members birlikte aktif (OR'lanıyor)
- **Dosyalar:** `supabase/migrations/060_household_members_select_policy_dedup.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `household-policies` · **Bağımlı:** [HIGH] households, household_members, coach_consents tabloları hiçbir migration'da CREATE edilmiyor

**Kök-neden:** Teyit (pg_policy): household_members'ta iki PERMISSIVE SELECT — hm_select_own (user_id=auth.uid(), mig 050) ve Members can view members (household_id IN (SELECT user_household_ids()), mig 040). İkisi OR'lanır → etkin yüzey geniş olan kadar. 050'nin daraltma niyeti uygulanmamış. Doğrudan sızıntı değil (yalnız üye olunan household içi) ama ileride hassas kolon eklenirse otomatik açılır.

**Düzeltme:** Ürün niyetini netleştir: aile içi görünürlük (üyeler birbirini görsün) İSTENİYORSA hm_select_own'ı DROP et (geniş politika kalsın). Yalnız kendi satırı isteniyorsa Members can view members'ı DROP et. household.service.ts kullanımına bakılarak karar verilmeli — aile planı UI'si muhtemelen üyeleri listeliyor → geniş politika doğru, hm_select_own gereksiz. Idempotent migration: DROP POLICY IF EXISTS.

```tsx
-- aile-içi görünürlük amaçsa:
drop policy if exists hm_select_own on public.household_members;
-- (alternatif) yalnız-kendi amaçsa: drop policy if exists "Members can view members" on public.household_members;
```

**Migration taslağı:**
```sql
060_household_members_select_policy_dedup.sql — DROP POLICY IF EXISTS (bir tanesi). Geri-alınabilir: down'da CREATE POLICY. KARAR: household.service.ts'in üye-listeleme davranışı belirlemeli.
```

**Doğrulama:** household.service.ts'i oku — getHouseholdMembers gibi fn üyeleri listeliyorsa geniş politika gerekli (hm_select_own drop). kk.mjs: aynı household'daki iki kullanıcıdan biri diğerinin satırını görebilmeli (geniş kalırsa) veya görememeli (dar kalırsa) — seçime göre doğrula.

---

### 🔵 LOW — barcode_unfound_counts view'ı postgres (bypassrls) sahipli + security_invoker kapalı
- **Dosyalar:** `supabase/migrations/061_barcode_view_security_invoker.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `barcode-view`

**Kök-neden:** Teyit: barcode_unfound_counts reloptions=null (security_invoker kapalı), owner=postgres (rolbypassrls=true) → alttaki barcode_corrections RLS'ini bypass eder, tüm kullanıcıların _UNFOUND_ barkod kayıtlarını GROUP BY ile agregeler. GROUP BY agregesi olduğundan DML imkânsız (yalnız SELECT). Şu an 0 satır. Düşük hassasiyetli cross-user sızıntı (kimin hangi barkodu aradığı miss sayıları).

**Düzeltme:** Community-geneli miss sayıları kasıtlı paylaşımsa bırak (doküman et). Aksi halde ALTER VIEW barcode_unfound_counts SET (security_invoker = on) ile çağıranın RLS'ini uygula + ACL temizle: REVOKE ALL ON barcode_unfound_counts FROM anon, authenticated; GRANT SELECT TO authenticated. Karar: bu view'ın community özelliği olup olmadığını barcode kullanımından doğrula; muhtemelen admin/analitik amaçlı → security_invoker on + yalnız gerekli role grant.

```tsx
alter view public.barcode_unfound_counts set (security_invoker = on);
revoke all on public.barcode_unfound_counts from anon, authenticated;
grant select on public.barcode_unfound_counts to authenticated;
```

**Migration taslağı:**
```sql
061_barcode_view_security_invoker.sql — ALTER VIEW SET (security_invoker=on) + ACL. Idempotent (ALTER tekrar çalıştırılabilir). Geri-alınabilir: SET (security_invoker=off). KARAR: community paylaşımı isteniyorsa hiç değiştirme.
```

**Doğrulama:** q.mjs ÖNCE: nerede tüketiliyor (kod araması). Migration sonrası: SELECT reloptions FROM pg_class WHERE relname='barcode_unfound_counts' → {security_invoker=on}. Authenticated kullanıcı yalnız kendi miss'lerini görmeli (RLS invoker). 0 satır olduğu için regresyon riski minimal.

---

### 🔵 LOW — idx_daily_plans_user_date kullanılmıyor — daha geniş versioning index'i tarafından gölgeleniyor
- **Dosyalar:** `supabase/migrations/056_drop_duplicate_indexes.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `index-cleanup`

**Kök-neden:** Teyit: daily_plans'ta hem idx_daily_plans_user_date hem idx_daily_plans_version mevcut (pg_indexes). (user_id,date) prefix'i idx_daily_plans_version(user_id,date,version DESC) ve UNIQUE index tarafından karşılanıyor → idx_daily_plans_user_date scan=0 (audit), version index scan=1684. Kullanılmayan üçüncü index.

**Düzeltme:** DROP INDEX IF EXISTS idx_daily_plans_user_date. Bu, MEDIUM duplicate-index migration'ı (056) ile aynı dosyada gruplanabilir (aynı index-cleanup batch). Drop öncesi scan=0 ve prefix'in version index ile karşılandığını q.mjs ile doğrula.

```tsx
drop index if exists public.idx_daily_plans_user_date;
```

**Migration taslağı:**
```sql
056 ile aynı dosya — DROP INDEX IF EXISTS idx_daily_plans_user_date. Geri-alınabilir CREATE INDEX ile.
```

**Doğrulama:** q.mjs: SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE indexrelname='idx_daily_plans_user_date' (0 olmalı). Drop sonrası daily_plans user+date sorgusu EXPLAIN'de idx_daily_plans_version kullanmalı.

---

### 🔵 LOW — coach_consents coach_id+is_active filtresi için kısmi/bileşik index yok
- **Dosyalar:** `supabase/migrations/062_coach_consents_active_index.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `index-tuning`

**Kök-neden:** Teyit: getCoachClients .eq('coach_id').eq('is_active',true) ile sorguluyor (coach-mode.service.ts:79-83). coach_consents index'lerinin hiçbirinde is_active yok → planner coach_id index'inden gelen satırları filtreliyor. Bir koçun çok consent'i (iptal/geçmiş) olunca gereksiz okuma. Özellik az kullanıldığı için düşük.

**Düzeltme:** Kısmi index ekle: CREATE INDEX IF NOT EXISTS idx_coach_consents_coach_active ON coach_consents(coach_id) WHERE is_active = true. Bu, coach RPC (LOW) tarafından da kullanılır. coach-mode-service batch'iyle ilişkili ama ayrı dosya (DDL).

```tsx
create index if not exists idx_coach_consents_coach_active on public.coach_consents (coach_id) where is_active = true;
```

**Migration taslağı:**
```sql
062_coach_consents_active_index.sql — CREATE INDEX IF NOT EXISTS (kısmi). Geri-alınabilir DROP INDEX ile.
```

**Doğrulama:** Migration sonrası q.mjs EXPLAIN: coach_id+is_active sorgusu kısmi index'i kullanmalı. pg_indexes'te yeni index görünmeli.

---

### 🔵 LOW — Sınırsız liste sorguları — sayfalama/limit yok (recipes, venues, health_events, templates, supplements + KVKK export)
- **Dosyalar:** `src/services/recipes.service.ts`, `src/services/venues.service.ts`, `src/services/health.service.ts`, `src/services/templates.service.ts`, `src/services/supplements.service.ts`, `src/services/export.service.ts`
- **Efor:** Büyük · **Risk:** low · **batch:** `list-pagination`

**Kök-neden:** Teyit (recipes.service.ts:44-48, :69-77): getRecipes/searchRecipes .select('*').order(...) limit/range YOK. Aynı desen venues.service.ts:16, health.service.ts:18, templates.service.ts:21, supplements.service.ts:68, export.service.ts:29 (30+ tablo .select('*'), nested meal_log_items(*)/strength_sets(*)). Çoğu index'siz kolona göre sıralıyor. KVKK export tek istekte limitsiz → mobilde OOM riski.

**Düzeltme:** Liste fonksiyonlarına makul .limit() (örn. 100-200) veya .range(offset,offset+pageSize) ekle ve çağıranlara sayfalama parametresi geçir. Sık sıralanan kolonlara kullanıcı-kapsamlı index (saved_recipes(user_id, use_count DESC), venues(user_id, visit_count DESC) vb.) — ayrı index migration. export.service.ts'te büyüyebilen tabloları (meal_logs, chat_messages, daily_metrics) batch/cursor ile çek (örn. .range döngüsü). Bkz. groupedSweeps.

```tsx
// recipes getRecipes: ...select('*').order('created_at',{ascending:false}).limit(200)
// export: büyük tablolar için while(more){ .range(off,off+999); off+=1000 }
```

**Doğrulama:** tsc temiz. kk.mjs ile çok kayıt üret → liste fn'leri limit kadar döndürmeli; export büyük veride OOM olmadan tamamlanmalı (batch). Index migration sonrası EXPLAIN sırada index kullanmalı.

---

### 🔵 LOW — database.ts tip kapsamı: küçük eksik kolonlar (ChatSession/DailyMetrics/SavedRecipe)
- **Dosyalar:** `src/types/database.ts`, `src/services/recipes.service.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `database-ts-types`

**Kök-neden:** Teyit: ChatSession (database.ts:311-320) updated_at YOK (canlıda var, trigger güncelliyor). DailyMetrics (252-270) created_at YOK. SavedRecipe — database.ts'teki interface is_favorite/use_count'u eksik; recipes.service.ts:7-22 kendi yerel mükerrer SavedRecipe tipini tanımlamış (is_favorite?/use_count? opsiyonel) ve :70/:155'te aktif kullanıyor.

**Düzeltme:** database.ts: ChatSession'a updated_at: string; DailyMetrics'e created_at: string; merkezi SavedRecipe interface'ine is_favorite: boolean + use_count: number ekle. recipes.service.ts'teki yerel mükerrer SavedRecipe tanımını sil, database.ts'ten import et (RecipeIngredient da merkezileştirilebilir). Bu database-ts-types batch'iyle aynı dosyaya dokunduğu için birlikte yapılmalı.

```tsx
// database.ts ChatSession: updated_at: string;
// DailyMetrics: created_at: string;
// SavedRecipe (merkezi): is_favorite: boolean; use_count: number;
// recipes.service.ts: import { SavedRecipe } from '@/types/database'; (yerel sil)
```

**Doğrulama:** tsc temiz; recipes.service.ts yerel tip silindikten sonra :70/:155 merkezi tiple derlenmeli. q.mjs ile kolon adları doğrula.

---

### 🔵 LOW — weekly_plans archive-then-promote atomik değil — promote başarısız olursa aktif plan kalmaz
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/migrations/051_atomic_plan_goal_writes.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `rpc-atomic-writes`

**Kök-neden:** Teyit: ai-chat/index.ts:1231/:1254 — uniq_active_plan_per_type (canlıda UNIQUE INDEX (user_id,plan_type) WHERE status='active', teyit edildi) nedeniyle önce aktif plan archived, sonra draft active yapılıyor; iki ifade transaction'sız. promoteErr durumunda archive geri alınmıyor → o plan_type için aktif plan kalmaz. planPersistError doğru set ediliyor (kullanıcıya yanlış 'oldu' denmiyor) ama DB tutarsız, sonraki projeksiyon çalışmaz.

**Düzeltme:** MEDIUM transaction bulgusunun (051 RPC) üçüncü ayağı: promote_weekly_plan(p_user uuid, p_plan_type text, p_draft_id uuid) SECURITY DEFINER plpgsql — tek tx'te UPDATE weekly_plans SET status='archived' WHERE user_id AND plan_type AND status='active'; UPDATE weekly_plans SET status='active' WHERE id=p_draft_id; hata olursa tx rollback → archive geri gelir. ai-chat:1231/:1254 bloğunu bu RPC ile değiştir. uniq_active/uniq_draft index'leri tek tx içinde tutarlı kalır.

```tsx
create or replace function promote_weekly_plan(p_user uuid, p_plan_type text, p_draft_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin update weekly_plans set status='archived' where user_id=p_user and plan_type=p_plan_type and status='active'; update weekly_plans set status='active' where id=p_draft_id and user_id=p_user; end; $$;
```

**Migration taslağı:**
```sql
051 ile aynı dosya (promote_weekly_plan fonksiyonu). Idempotent create or replace. Bkz. MEDIUM transaction bulgusu — aynı RPC seti.
```

**Doğrulama:** kk.mjs: aktif plan varken yeni draft promote → tek aktif kalmalı (q.mjs count WHERE status='active' AND plan_type=X = 1). Negatif: promote'u kıracak senaryo (geçersiz draft_id) → eski plan hâlâ active (rollback). uniq_active_plan_per_type ihlali olmamalı.

---

### 🔵 LOW — ai_feedback.context_type ve profiles.periodic_state için DB CHECK yok — enum yalnız TS'te enforce
- **Dosyalar:** `supabase/migrations/063_enum_check_constraints.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `check-constraints`

**Kök-neden:** Teyit gerekli (q.mjs ile constraint listesi): ContextType ve PeriodicState enum'ları database.ts:40/41'de tanımlı ama canlı DB'de ilgili CHECK yok (audit: yalnız ai_feedback_feedback_check var). Edge/SQL ile geçersiz değer yazılırsa DB kabul eder; TS reader enum sanıp sessizce kaçırır. Tek-yazıcı uygulama olduğundan düşük (savunma derinliği eksik).

**Düzeltme:** Önce q.mjs ile mevcut değerleri tara (geçersiz var mı). İki idempotent CHECK ekle: ai_feedback.context_type ∈ {'meal_suggestion','workout_plan','coaching_message','recipe'} (NULL'a izin), profiles.periodic_state ∈ PeriodicState değerleri + NULL. NOT VALID ile ekleyip sonra VALIDATE (mevcut veriyi bozmadan). Alternatif: edge output-validator ile değer kümesini doğrula (DB CHECK yerine). Risk düşük olduğundan CHECK tercih edilir.

```tsx
alter table ai_feedback add constraint ai_feedback_context_type_check check (context_type is null or context_type in ('meal_suggestion','workout_plan','coaching_message','recipe')) not valid;
alter table ai_feedback validate constraint ai_feedback_context_type_check;
-- profiles.periodic_state için aynı (PeriodicState değerleri)
```

**Migration taslağı:**
```sql
063_enum_check_constraints.sql — ADD CONSTRAINT ... NOT VALID + VALIDATE (idempotent: önce DROP CONSTRAINT IF EXISTS). Geri-alınabilir DROP CONSTRAINT. Mevcut veride geçersiz değer olmadığı doğrulanmalı.
```

**Doğrulama:** q.mjs ÖNCE: SELECT DISTINCT context_type FROM ai_feedback; SELECT DISTINCT periodic_state FROM profiles — geçersiz değer varsa CHECK önce başarısız olur (temizle). VALIDATE sonrası geçersiz INSERT denemesi reddedilmeli.

---

### 🔵 LOW — household_members'ta iki örtüşen UNIQUE index — user_id-tek unique composite'i gereksiz kılıyor
- **Dosyalar:** `supabase/migrations/064_household_members_index_dedup.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `household-policies` · **Bağımlı:** [HIGH] households, household_members, coach_consents tabloları hiçbir migration'da CREATE edilmiyor

**Kök-neden:** Teyit (pg_indexes): household_members'ta uniq_household_member_per_user(user_id) UNIQUE (mig 043), household_members_household_id_user_id_key(household_id,user_id) UNIQUE, ve idx_household_members_user(user_id) non-unique — üçü birden var. user_id-tek unique zaten composite'i ve non-unique'i kapsıyor → ikisi gereksiz. İşlevsel risk yok, fazladan index bakımı.

**Düzeltme:** DROP edilebilecekler: idx_household_members_user (non-unique tekrar, kesin gereksiz). household_members_household_id_user_id_key composite UNIQUE'i değerlendir — eğer (household_id) tek başına başka sorguda kullanılmıyorsa ve user_id-tek unique iş kuralını (bir kullanıcı tek household) zaten enforce ediyorsa drop edilebilir; ancak bu bir FK hedefi/iş kuralı olabilir, dikkatli. Minimal-güvenli: yalnız idx_household_members_user'ı DROP et, composite'i koru (ekstra güvenlik). household-policies batch'iyle ayrı tut (aynı tablo).

```tsx
drop index if exists public.idx_household_members_user;
-- composite UNIQUE'i koru (FK/iş-kuralı olabilir); istenirse ayrıca:
-- drop index if exists public.household_members_household_id_user_id_key;
```

**Migration taslağı:**
```sql
064_household_members_index_dedup.sql — DROP INDEX IF EXISTS idx_household_members_user. Geri-alınabilir CREATE INDEX. composite UNIQUE drop'u ayrı/opsiyonel, FK kontrolü sonrası.
```

**Doğrulama:** q.mjs: pg_stat ile idx_household_members_user scan=0 doğrula. Drop sonrası user_id sorgusu uniq_household_member_per_user'ı kullanmalı. composite drop edilecekse önce ona bağlı FK/constraint olmadığını kontrol et.

---

### ⚪ NIT — audit_logs üzerinde yinelenen (redundant) SELECT politikaları
- **Dosyalar:** `supabase/migrations/065_audit_logs_policy_dedup.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `audit-logs-policies`

**Kök-neden:** Teyit (pg_policy): audit_logs'ta 2 SELECT politikası — 'Users can view own audit logs' ve 'audit_logs_select_own', ikisi de auth.uid()=user_id. INSERT ayrımı doğru (038 forgery düzeltmesi sağlam: 'Service can insert audit logs' + 'audit_logs_insert_own'). Çift SELECT güvenlik açığı değil ama kafa karışıklığı + birini değiştirip diğerini unutma riski.

**Düzeltme:** Yinelenenlerden eski/insansı adlı olanı DROP et, kanonik snake_case'i koru: DROP POLICY IF EXISTS "Users can view own audit logs" ON audit_logs (audit_logs_select_own kalsın). INSERT tarafına dokunma. Idempotent.

```tsx
drop policy if exists "Users can view own audit logs" on public.audit_logs;
```

**Migration taslağı:**
```sql
065_audit_logs_policy_dedup.sql — DROP POLICY IF EXISTS. Geri-alınabilir CREATE POLICY.
```

**Doğrulama:** q.mjs: SELECT polname FROM pg_policy WHERE polrelid='public.audit_logs'::regclass AND polcmd='r' → tek satır (audit_logs_select_own). Kullanıcı hâlâ kendi audit'ini görebilmeli (kk.mjs).

---

### ⚪ NIT — FK kolonları kapsayıcı index'ten yoksun (households.owner_id, scheduled_cleanups.user_id, meal_logs.template_id, weekly_plans.superseded_by)
- **Dosyalar:** `supabase/migrations/066_fk_covering_indexes.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `index-tuning` · **Bağımlı:** [HIGH] households, household_members, coach_consents tabloları hiçbir migration'da CREATE edilmiyor

**Kök-neden:** Teyit gerekli (q.mjs ile FK + index karşılaştırması): 4 FK constraint mevcut ama lider kolonu bu FK kolonu olan index yok. owner_id/user_id RLS qual'larında filtre. İlgili tablolar boş/tiny (households=0, scheduled_cleanups=0, meal_logs=16, weekly_plans=13) → pratik etki şu an sıfır; veri büyüdükçe RLS qual'larında ve ON DELETE CASCADE'de seq-scan.

**Düzeltme:** İleriye dönük idempotent index migration: CREATE INDEX IF NOT EXISTS households(owner_id), scheduled_cleanups(user_id), meal_logs(template_id) WHERE template_id IS NOT NULL (sparse), weekly_plans(superseded_by) WHERE superseded_by IS NOT NULL. Aciliyet yok; index-tuning batch'ine eklenebilir. Önce gerçekten eksik olduklarını q.mjs ile doğrula.

```tsx
create index if not exists idx_households_owner on public.households(owner_id);
create index if not exists idx_scheduled_cleanups_user on public.scheduled_cleanups(user_id);
create index if not exists idx_meal_logs_template on public.meal_logs(template_id) where template_id is not null;
create index if not exists idx_weekly_plans_superseded on public.weekly_plans(superseded_by) where superseded_by is not null;
```

**Migration taslağı:**
```sql
066_fk_covering_indexes.sql — CREATE INDEX IF NOT EXISTS (4 adet, ikisi kısmi). Geri-alınabilir DROP INDEX. households index'i o tablonun baseline CREATE'ine (HIGH bulgu) bağlı.
```

**Doğrulama:** q.mjs ÖNCE: FK kolonları için lider-kolon index var mı (pg_index + pg_constraint). Migration sonrası pg_indexes'te 4 yeni index. Etki düşük (tablolar tiny) — fonksiyonel doğrulama gerekmez.

---

### ⚪ NIT — monthly_reports'ta mükerrer/ölü kolonlar — yazıcı yalnız kanonik adları dolduruyor
- **Dosyalar:** `supabase/migrations/067_drop_dead_monthly_reports_columns.sql`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `monthly-reports-cleanup`

**Kök-neden:** Teyit (information_schema): monthly_reports'ta hem behavioral_patterns hem behavior_patterns, ayrıca weight_change_kg yanında weight_change + total_days_logged + ai_monthly_note mevcut (iki migration neslinin kalıntısı). ai-report upsert (:482-498) yalnız kanonik adları yazıyor → eski adlar HER ZAMAN NULL. Çalışma hatası yok ama behavior_patterns okuyan boş veri alır, tablo şişer.

**Düzeltme:** Ölü/mükerrer kolonları DROP et (hep NULL, veri kaybı yok): behavior_patterns (kanonik behavioral_patterns kalsın), weight_change (kanonik weight_change_kg), ve ai-report'un yazmadığı diğer ölü adlar (total_days_logged/ai_monthly_note — önce ai-report ve okuyucularda kullanılmadığını grep ile doğrula). Önce her kolonun gerçekten hep NULL ve hiçbir yazıcı/okuyucu tarafından kullanılmadığını teyit et.

```tsx
alter table public.monthly_reports drop column if exists behavior_patterns;
alter table public.monthly_reports drop column if exists weight_change;
-- total_days_logged / ai_monthly_note: kullanım yoksa drop
```

**Migration taslağı:**
```sql
067_drop_dead_monthly_reports_columns.sql — DROP COLUMN IF EXISTS (hep NULL kolonlar). Geri-alınabilir ADD COLUMN ama veri yok. Önce hiçbir kod yolunun kolonları okumadığı grep ile doğrulanmalı.
```

**Doğrulama:** Grep: behavior_patterns/weight_change/total_days_logged/ai_monthly_note kullanan kod var mı (yoksa drop güvenli). q.mjs: SELECT count(*) FROM monthly_reports WHERE behavior_patterns IS NOT NULL = 0. Drop sonrası ai-report upsert hatasız çalışmalı.

---

### ⚪ NIT — Migration 006 daily_metrics integer muscle_soreness/recovery_score ekliyor ama 002 text/smallint tanımlı — ADD COLUMN IF NOT EXISTS no-op
- **Dosyalar:** `supabase/migrations/006_feature_extensions.sql`
- **Efor:** Küçük · **Risk:** low · **batch:** `migration-006-doc`

**Kök-neden:** Teyit: canlı daily_metrics.recovery_score=smallint, muscle_soreness=text (information_schema). 002:89 recovery_score SMALLINT + muscle_soreness TEXT tanımlar; 006:19-21 aynı adları integer olarak ADD COLUMN IF NOT EXISTS → kolonlar zaten var, no-op; integer niyeti hiç uygulanmadı, tip değişmedi. ADD COLUMN IF NOT EXISTS'in tip değiştirmediği gizli tuzak. Çalışan davranış 002'ye uygun (doğru).

**Düzeltme:** Yalnız belge/temizlik — yeni migration GEREKMEZ. 006:19-21'deki integer ADD COLUMN satırlarını sil veya yorum ekle: 'gerçek tip 002'de smallint/text; bu satırlar no-op'. Gerçekten integer'a geçilmek istense ALTER COLUMN TYPE gerekirdi ama davranış 002 ile doğru olduğundan dokunma. database.ts'teki MuscleSoreness/recovery_score tipleri canlı (text enum/smallint) ile zaten uyumlu — kontrol et.

```tsx
// 006_feature_extensions.sql içinde:
// (sil veya yorumla) alter table daily_metrics add column if not exists recovery_score integer;
// -- NOOP: recovery_score 002'de smallint, muscle_soreness text olarak mevcut
```

**Doğrulama:** Salt-okunur kaynak düzenlemesi; fresh shadow DB'de 002+006 sonrası daily_metrics.recovery_score=smallint, muscle_soreness=text kalmalı (değişmedi). tsc: database.ts tipleri canlıyla uyumlu.

---

### 🧹 Toplu Süpürmeler — DB

**Çift/kullanılmayan index'leri tek migration'da düşür (6 index, 5+1 tablo)** _(efor: Küçük)_
- Dosyalar: `supabase/migrations/056_drop_duplicate_indexes.sql`
- Canlıda pg_indexes ile teyit edilen tam-çift ve gölgelenen index'ler tek idempotent migration'da DROP INDEX IF EXISTS ile kaldırılır: idx_weight_history_user, idx_daily_metrics_user_date, idx_audit_logs_user, idx_coaching_user, idx_recipes_user (5 çiftin non-unique tekrarı) + idx_daily_plans_user_date (version index'i gölgeliyor, scan=0). UNIQUE/constraint index'lerine dokunulmaz. Her drop öncesi q.mjs ile idx_scan=0/düşük ve indisunique=false doğrulanır.
- **Yaklaşım:** Tek dosya 056_drop_duplicate_indexes.sql; DROP INDEX IF EXISTS x6; down-migration'da orijinal CREATE INDEX tanımları. batchKey=index-cleanup.

**Eksik index'leri tek migration'da ekle (performans + FK kapsama)** _(efor: Küçük)_
- Dosyalar: `supabase/migrations/055_meal_logs_logged_at_index.sql`, `supabase/migrations/062_coach_consents_active_index.sql`, `supabase/migrations/066_fk_covering_indexes.sql`
- Sıcak/RLS yollarını karşılayan eksik index'ler tek idempotent migration'da CREATE INDEX IF NOT EXISTS ile eklenir: meal_logs(user_id, logged_at DESC) WHERE is_deleted=false; coach_consents(coach_id) WHERE is_active=true; ve FK kapsayıcılar households(owner_id), scheduled_cleanups(user_id), meal_logs(template_id) sparse, weekly_plans(superseded_by) sparse. EXPLAIN ile kullanım doğrulanır.
- **Yaklaşım:** Dosya(lar) 055/062/066 tek index-tuning batch'inde toplanabilir; hepsi CREATE INDEX IF NOT EXISTS, ileriye dönük, düşük risk. households index'i HIGH households-baseline bulgusuna bağlı.

**database.ts tip kapsamını canlı şemayla hizala (Profile/AISummary/ChatSession/DailyMetrics/SavedRecipe + PlanStatus)** _(efor: Orta)_
- Dosyalar: `src/types/database.ts`, `src/services/privacy.service.ts`, `src/services/recipes.service.ts`
- Tek dosyada (database.ts) tüm tip-drift düzeltmeleri: başlık '001-050'; Profile'a 27 eksik kolon + [key:string]:unknown kaldır; AISummary'ye learned_meal_times/snacking_hours/extraction_checkpoint/onboarding_tasks_completed; ChatSession.updated_at; DailyMetrics.created_at; SavedRecipe.is_favorite/use_count; DailyPlanStatus (6 değer) tipi. recipes.service.ts'teki yerel mükerrer SavedRecipe tipi merkezi tiple birleştirilir. Kolon adları/tipleri q.mjs ile birebir alınır.
- **Yaklaşım:** batchKey=database-ts-types (4 ayrı bulgu aynı dosyaya dokunuyor — tek seferde yap). Doğrulama: tsc temiz + privacy.service.ts/recipes.service.ts cast'leri kaldırılır.

**37-50 migration'larını idempotent yap + schema_migrations repair (drift kapat)** _(efor: Büyük)_
- Dosyalar: `supabase/migrations/037_fix_ai_summary_merge_supplement_notes.sql`, `supabase/migrations/040_fix_household_rls_recursion.sql`, `supabase/migrations/043_plan_goal_household_hardening.sql`, `supabase/migrations/046_fix_subscriptions_ins_premium_selfgrant.sql`, `supabase/migrations/049_weight_history_unique_per_day.sql`, `supabase/migrations/050_security_hardening_round2.sql`
- Canlıya uygulanmış ama kayıtsız 14 migration (037-050) idempotent edilir: CREATE POLICY→DROP IF EXISTS+CREATE, CREATE INDEX→IF NOT EXISTS, CREATE FUNCTION→OR REPLACE, ADD COLUMN→IF NOT EXISTS. Sonra supabase migration repair ile schema_migrations'a 037-050 işaretlenir. Bu, households-baseline ve ai_summary-baseline yeni migration'larıyla birlikte fresh-install'ın 001..050 hatasız çalışmasını sağlar.
- **Yaklaşım:** batchKey=migration-idempotency-repair. Her dosya tek tek elden geçirilir; shadow DB (db reset) ile doğrulanır. DİKKAT: households/ai_summary CREATE eksikleri (HIGH + MEDIUM baseline) önce çözülmeli.

**Liste sorgularına limit/range + sayfalama ekle (6 servis)** _(efor: Büyük)_
- Dosyalar: `src/services/recipes.service.ts`, `src/services/venues.service.ts`, `src/services/health.service.ts`, `src/services/templates.service.ts`, `src/services/supplements.service.ts`, `src/services/export.service.ts`
- Limitsiz .select('*') liste sorgularına makul .limit()/.range() eklenir ve KVKK export'ta büyüyebilen tablolar batch/cursor ile çekilir. Servisler: recipes, venues, health, templates, supplements, export. Sık sıralanan kolonlara kullanıcı-kapsamlı index ayrıca eklenir (use_count/visit_count/event_date DESC).
- **Yaklaşım:** batchKey=list-pagination (her servis ayrı dosya, çakışmasız). export.service.ts en kritik (OOM riski) — büyük tablolar için .range döngüsü. Index'ler index-tuning migration'ına eklenebilir.

---

## AI Mimarisi / Koç, Bellek, Guardrail & Plan

_44 kart — 🔴 1 · 🟠 14 · 🟡 16 · 🔵 12 · ⚪ 1 · 🧹 3 süpürme_

### 🔴 CRITICAL — Legacy ai-plan haftalık menü yolu chat-onaylı aktif diyet planını uyumsuz şekille EZİYOR
- **Dosyalar:** `supabase/functions/ai-plan/index.ts`, `supabase/functions/shared/plan-projection.ts`, `supabase/functions/ai-chat/task-modes.ts`, `supabase/migrations/*_weekly_menu_isolation.sql`
- **Efor:** Büyük · **Risk:** high · **Migration gerekli** · **batch:** `weekly_plans_schema`

**Kök-neden:** TEYİT EDİLDİ. ai-plan/index.ts generateWeeklyPlan, weekly_plans üzerinde (plan_type='diet' AND status='active') tek aktif diyet satırını bulup (813-819) plan_data=weeklyPlan.days ile UPDATE ediyor (854-863). weeklyPlan.days, WEEKLY_PLAN_SYSTEM çıktısı olan DÜZ DİZİ ({date,is_training_day,meals:[{name,calories}]}). Oysa chat plan_diet yolu (task-modes.ts:322-358) AYNI satıra OBJE yazar: {targets:{kcal,protein,carbs,fat}, days:[{day_index, meals:[{items,total_kcal,total_protein}]}], version}. plan-projection.ts projectDailyPlanRows bu obje şeklini okur: targets (181), d.day_index (198), total_kcal (212). Legacy UPDATE sonrası dietPlanData.targets undefined→{} (186-188 makro fallback'leri 0), Array.isArray(days) true ama elemanlarda day_index/total_kcal yok → caloriePoint KCAL_FLOOR=1000 (213), proteinTarget 0 (222). Tek active diet satırı iki uyumsuz tüketici (projeksiyon vs menü ekranı) tarafından paylaşılıyor.

**Düzeltme:** Legacy haftalık menüyü chat-onaylı diyet planından İZOLE et. Minimal-doğru çözüm: weekly_plans'a plan_subtype TEXT kolonu ekle (migration). generateWeeklyPlan'in existing-lookup'ı (813-819) ve INSERT/UPDATE'i (851-880) plan_type='diet' AND COALESCE(plan_subtype,'')='weekly_menu' satırını hedeflesin (chat-onaylı plan plan_subtype=NULL kalır, ASLA dokunulmaz). uniq_active_plan_per_type partial index'i (plan_type) artık ikiye böleceği için index'i (plan_type, COALESCE(plan_subtype,'core')) bazlı yeniden tanımla — böylece 'core' diyet ve 'weekly_menu' satırları aynı anda active kalabilir. Client getCurrentWeeklyPlan (weekly-plan.service.ts:139) sorgusuna .eq('plan_subtype','weekly_menu') ekle; plan-projection okuyucusu sadece plan_subtype IS NULL satırını okusun (zaten projeksiyon ai-chat plan_diet onayında tetikleniyor, ai-plan menüsü onu beslemiyor).

```tsx
// ai-plan/index.ts existing lookup
.eq('plan_type','diet').eq('status','active').eq('plan_subtype','weekly_menu')
// INSERT'e: plan_subtype:'weekly_menu'
// migration:
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS plan_subtype TEXT;
DROP INDEX IF EXISTS uniq_active_plan_per_type;
CREATE UNIQUE INDEX uniq_active_plan_per_type ON weekly_plans(user_id, plan_type, COALESCE(plan_subtype,'core')) WHERE status='active';
```

**Migration taslağı:**
```sql
NNN_weekly_menu_isolation.sql (idempotent+geri-alınabilir): (1) ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS plan_subtype TEXT; (2) Mevcut legacy menü satırlarını ayırt etmek için: plan_data'sı DÜZ dizi olan (jsonb_typeof(plan_data)='array' AND NOT plan_data @> '[{"day_index":0}]' kabaca) active diet satırlarını UPDATE ... SET plan_subtype='weekly_menu' — veya daha güvenli: kolonu eklemekle yetin, mevcut belirsiz satırları elle ayıklamadan NULL bırak (yeni menüler weekly_menu yazılır). (3) Partial unique index'i COALESCE(plan_subtype,'core') ile yeniden oluştur. DOWN: index'i eski haline al, kolonu DROP et.
```

**Doğrulama:** tsc (ai-plan + plan-projection + weekly-plan.service). q.mjs ile: chat plan_diet onayından sonra weekly_plans active diet satırı kontrol (targets dolu olmalı) → ai-plan weekly menü üret → tekrar SELECT: chat satırının plan_data hâlâ obje + targets dolu, menü ayrı plan_subtype='weekly_menu' satırında olmalı. plan-projection ile daily_plans.calorie_target=hedef (1000 değil), protein>0 doğrula. kk.mjs canlı: önce diyet planı pazarlık+onay, sonra Haftalık Menü üret, dashboard 'kalan kalori' bozulmamalı.

---

### 🟠 HIGH — daily_log / plan_diet / plan_workout retrieval planları HİÇ erişilemiyor — analyzeMessage yanlış taskMode ile besleniyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/retrieval-planner.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_chat_routing`

**Kök-neden:** TEYİT EDİLDİ. ai-chat/index.ts:258 analyzeMessage(message, taskMode) çağrılıyor — taskMode=detectTaskMode çıktısı (248), effectiveMode (253) DEĞİL. detectTaskMode (task-modes.ts:30-80) hiçbir koşulda daily_log/plan_diet/plan_workout döndürmez (bunlar yalnız HINT_MODES'tan effectiveMode'a yansıyor, 252-255). retrieval-planner.ts analyzeMessage switch'inde (92-122) bu üç mod için case YOK → default 'general_coaching' (120). getRetrievalPlan switch'i analysis.taskMode üzerinde (317) olduğundan plan_diet/plan_workout/daily_log case'leri (347-359) — full layer1/layer2 + 14/7 günlük layer3 zengin bağlam tanımları — ASLA çalışmaz, buildCoachingPlan('general_coaching') (363) düşer.

**Düzeltme:** İki dosyada eşgüdümlü düzeltme. (1) ai-chat/index.ts:258 → analyzeMessage(message ?? '', effectiveMode). (2) retrieval-planner.ts analyzeMessage switch'ine (92-122) plan_diet/plan_workout/daily_log için case ekle ki analysis.taskMode bu modu taşısın ve getRetrievalPlan'in mevcut zengin case'leri (347-359) tetiklensin. Bu modlar için subtype'a gerek yok: {taskMode, subtype:'default_subtype', riskLevel:'medium', requiresPersonalization:true, recencyNeed: plan_diet/plan_workout→'month', daily_log→'week'} döndür. greeting/qa fast-path'leri (analyzeMessage başındaki greeting guard) etkilenmediği için doğrula.

```tsx
// index.ts:258
const analysis = analyzeMessage(message ?? '', effectiveMode);
// retrieval-planner.ts switch içine:
case 'plan_diet':
case 'plan_workout':
  return { taskMode, subtype:'default_subtype', riskLevel:'medium', requiresPersonalization:true, recencyNeed:'month' };
case 'daily_log':
  return { taskMode, subtype:'default_subtype', riskLevel:'medium', requiresPersonalization:true, recencyNeed:'week' };
```

**Doğrulama:** tsc. kk.mjs ile task_mode_hint='plan_diet' göndererek çağrı yap; console log'da buildContextFromPlan'a giden retrievalPlan'in layer2='full' ve layer3.daysBack=14 olduğunu doğrula (general_coaching'te layer2 farklı). daily_log hint ile 7 günlük meal/workout bağlamının prompta girdiğini gözle.

---

### 🟠 HIGH — Onboarding sırasında bildirilen öğün/antrenman deterministik güvenlik-ağına takılmaz
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_chat_safety_nets`

**Kök-neden:** TEYİT EDİLDİ. meal-log (599) ve workout-log (625) güvenlik ağları (effectiveMode==='register' || effectiveMode==='daily_log') ile kapılı. isOnboarding=true iken detectTaskMode 'onboarding' döner (task-modes.ts:31); 'onboarding' HINT_MODES'ta (252) olmadığından effectiveMode='onboarding' kalır ve gate'e takılmaz. sleep (668) ve water (684) ağları da aynı register||daily_log gate'inde. Buna karşılık weight ağı (642-663) mode-gateless (yorum #live-L14). Yani onboarding'de öğün+antrenman+uyku+su açıkta, sadece weight korunuyor (audit metni öğün/antrenman dedi; uyku+su da aynı boşlukta — derinleştirme).

**Düzeltme:** Dört safety-net gate'ini (599, 625, 668, 684) pozitif allow-list yerine negatif deny-list yap: (effectiveMode !== 'plan_diet' && effectiveMode !== 'plan_workout'). Böylece onboarding+general_coaching+register+daily_log'da çalışır, yalnız plan-pazarlık modlarında (öğün/antrenman emit edilmemesi gereken yerler) çalışmaz. Tek satırlık sabit ifade olduğu için ortak bir const SAFETY_NET_DISABLED_MODES tanımlayıp dördünde kullan, tutarlılık+ileride bakım için.

```tsx
const NET_OFF = (m: TaskMode) => m === 'plan_diet' || m === 'plan_workout';
// dört gate:
&& !NET_OFF(effectiveMode)) {
```

**Doğrulama:** tsc. kk.mjs onboarding oturumunda 'kahvaltıda 2 yumurta yedim' gönder (model action emit etmese bile) → meal_logs satırı oluşmalı. 'dün 7 saat uyudum', '2 litre su içtim', '4x8 bench yaptım' onboarding'de teste tabi tut; her biri ilgili tabloya düşmeli.

---

### 🟠 HIGH — <simulation> bloğu için extractor yok — JSON ham haliyle kullanıcıya sızıyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_chat_extractors`

**Kök-neden:** TEYİT EDİLDİ. task-modes.ts:229-234 simulation modu modelden yanıt sonuna <simulation>{...}</simulation> bloğu eklemesini ZORUNLU kılıyor. ai-chat/index.ts'te '<simulation>' geçen tek yer 1490 (alakasız yorum); hiçbir extractor (extractActions/stripVerbalAcknowledgements/extractLayer2Updates/extractPlanSnapshot/extractReasoning/extractNavigateTo/extractTaskCompletion) bu bloğu tanımıyor/temizlemiyor. detectTaskMode (task-modes.ts:39) 'yesem/yersem/olur mu/ne olur' ifadelerini erkenden simulation'a yönlendirdiği için sık tetiklenir → ham JSON kullanıcı mesajında kalır.

**Düzeltme:** İki seçenekten minimal olanı: extractSimulation(text) helper'ı extractReasoning kalıbında ekle — /<simulation>([\s\S]*?)<\/simulation>/ ile bloğu yakala, JSON.parse et (hata yutulur), mesajdan g-flag ile strip et, structured 'simulation' alanı olarak respond payload'una koy. extractActions sonrası temizleme zincirine ekle (cleanMessage üzerinde sırayla çalışan yere). Client zaten simulation chip'i gösteriyorsa o alanı tüketir; göstermiyorsa bile en azından ham JSON metinden çıkar (asıl zarar bu). Alternatif (daha az kod): task-modes.ts:229-234'teki blok talimatını kaldırıp simülasyonu prose içinde tutmayı modele bırak — ama o zaman structured veri kaybolur; extractor eklemek tercih edilir.

```tsx
function extractSimulation(text: string){
  const m = text.match(/<simulation>([\s\S]*?)<\/simulation>/);
  let sim=null; if(m){ try{ sim=JSON.parse(m[1]); }catch{} }
  return { clean: text.replace(/<simulation>[\s\S]*?<\/simulation>/g,'').trim(), simulation: sim };
}
```

**Doğrulama:** tsc. kk.mjs ile 'akşam 2 dilim pizza yesem ne olur?' gönder → assistantMessage'da ham <simulation>{...} GÖRÜNMEMELİ; respond.simulation alanı dolu (foodName/calories/remaining) olmalı.

---

### 🟠 HIGH — extractActions yalnızca İLK <actions> bloğunu okur — ikinci blok hem işlenmez hem metne sızar
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_chat_extractors`

**Kök-neden:** TEYİT EDİLDİ. ai-chat/index.ts:1761-1771 extractActions: match (1763) ve replace (1770) TEKİL regex /<actions>([\s\S]*?)<\/actions>/ kullanıyor, g bayrağı yok. task-modes.ts birden çok modda ayrı blok teşvik ediyor (recovery:249 commitment; save_recipe/venue_log modları da). recipe modu aynı mesajda hem save_recipe hem profile_update emit edilmesini ister. Model iki blok üretirse ikinci bloğun eylemleri çalışmaz + ham <actions>[...] metni kullanıcıya sızar.

**Düzeltme:** extractActions'ı tüm blokları toplayacak şekilde yeniden yaz: matchAll + g-flag ile her bloğu parse et, hepsini tek actions dizisinde birleştir (her parse'ı try/catch ile yut, bozuk blok diğerlerini düşürmesin), replace'i replaceAll/g-flag ile yap. Davranış değişimi minimal — tek blok durumunda aynı sonucu verir.

```tsx
function extractActions(text){
  let actions=[];
  const re=/<actions>([\s\S]*?)<\/actions>/g; let m;
  while((m=re.exec(text))){ try{ const p=JSON.parse(m[1]); actions.push(...(Array.isArray(p)?p:[p])); }catch{} }
  return { cleanMessage: text.replace(/<actions>[\s\S]*?<\/actions>/g,'').trim(), actions };
}
```

**Doğrulama:** tsc. Birim senaryo: iki ayrı <actions> bloğu içeren metin → actions.length = iki bloğun toplamı, cleanMessage'da hiç <actions> kalmamalı. kk.mjs recipe modunda tarif kaydetme: hem saved_recipes hem profile_update'in işlendiğini DB'de doğrula.

---

### 🟠 HIGH — learned_tone_preference için üç ayrı kelime dağarcığı — haftalık çıkarım eşleşmeyen değer yazıp ton talimatını bozuyor
- **Dosyalar:** `supabase/functions/shared/memory.ts`, `supabase/functions/shared/repair-handler.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_memory_tone`

**Kök-neden:** TEYİT EDİLDİ. memory.ts:808-822 inferTonePreference (ai-extractor tier-3 haftalık, 771 yorum) concise|conversational|supportive|analytical|balanced yazıyor ve updateLayer2 ile persist (822). system-prompt.ts:321 modele empathetic|data_driven|motivational emit ettiriyor (ai-chat:4156 bunu kaydeder). repair-handler.ts:382-388 getToneContext yalnız empathetic|data_driven|motivational|strict tanıyor; toneInstructions[tone] ?? tone (388) fallback'i eşleşmeyen değerde ham enum'ı prompta basar ('TON TERCIHI: analytical'). Üç küme arası kesişim yok; 'balanced' default'u da map'te yok. Sonuç: haftalık inferTonePreference çalıştığında modelin emit ettiği geçerli ton değerini eşleşmeyen değerle EZER.

**Düzeltme:** Tek kanonik ton sözlüğü = getToneContext'in tanıdığı küme (empathetic|data_driven|motivational|strict). Minimal-doğru: inferTonePreference (memory.ts:808-819) çıktısını yazımdan ÖNCE kanonik kümeye map et: analytical→data_driven, concise→strict, supportive→empathetic, conversational→motivational, balanced→(yazma / null). Böylece sistemde tek vocab kalır, system-prompt'un emit ettiği değerlerle çakışmaz. Ek savunma: repair-handler.ts toneInstructions map'ine bilinmeyen değer gelirse '?? tone' yerine sessizce atla (ham enum prompta hiç düşmesin).

```tsx
// memory.ts inferTonePreference sonu:
const CANON = { analytical:'data_driven', concise:'strict', supportive:'empathetic', conversational:'motivational', balanced:null };
const mapped = CANON[tone];
if (mapped) await updateLayer2(userId, { learned_tone_preference: mapped });
// repair-handler.ts:388
if (toneInstructions[tone]) parts.push(`TON TERCIHI: ${toneInstructions[tone]}`);
```

**Doğrulama:** tsc. q.mjs: bir kullanıcıda inferTonePreference'ı tetikleyip ai_summary.learned_tone_preference'ın yalnız empathetic|data_driven|motivational|strick set'inden bir değer olduğunu doğrula. getToneContext çıktısında ham enum kelimesi ('analytical') GÖRÜNMEMELİ, Türkçe talimat metni gelmeli.

---

### 🟠 HIGH — Atomik append helper ölü — behavioral_patterns yarış-durumuna açık (read-modify-write, son-yazan-kazanır)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/memory.ts`, `supabase/migrations/015_ai_summary_atomic_merge.sql`
- **Efor:** Büyük · **Risk:** med · **Migration gerekli** · **batch:** `ai_memory_patterns`

**Kök-neden:** TEYİT EDİLDİ. memory.ts:441-453 appendBehavioralPatterns (ai_summary_append_patterns FOR UPDATE kilitli RPC, migration 015) yalnız kendi tanımında referans alıyor (grep: 441/451 dışında çağrı YOK) → ölü. Canlı yol ai-chat:4001-4061 processLayer2Updates JS'te diziyi okuyup (4001) mutasyona uğratıp tüm diziyi changes.behavioral_patterns'a koyuyor; updateLayer2→ai_summary_merge merge'i array alanını COALESCE(p_patch->...) ile tamamen REPLACE eder (lost-update). evolvePatternConfidence (memory.ts:496-556) kilidi bypass edip doğrudan .update({behavioral_patterns}) yapar (552-555). ai-extractor tier-2 (günlük) ai-chat ile eşzamanlı koşabilir → 015'in çözdüğü yarış canlı yolda hâlâ açık.

**Düzeltme:** İki adım. (1) ai-chat:3991-4063 new_pattern dalını appendBehavioralPatterns RPC'sine taşı: JS'te dizi okuma/mutasyon/dedup/decay/cap YAPMA; yalnız tek yeni pattern objesini RPC'ye gönder. Dedup (type+trigger), times_observed/confidence boost, 90-gün decay→resolved ve MAX_PATTERNS=20 cap mantığını ai_summary_append_patterns SQL fonksiyonu içine taşı (migration 015'i genişlet). Böylece changes.behavioral_patterns artık merge'e girmez → REPLACE yarışı ortadan kalkar. (2) evolvePatternConfidence'i de SECURITY DEFINER + FOR UPDATE'li bir RPC'ye çevir (ai_summary_evolve_patterns) veya en azından appendBehavioralPatterns ile aynı kilit altında çalıştır. Önce 015 SQL fonksiyonunun mevcut imzasını okuyup mantığı oraya gömmek gerekiyor.

```tsx
// ai-chat new_pattern dalı yerine:
if (updates.new_pattern) {
  if ((updates.new_pattern.confidence ?? 0.5) < 0.5) { /* coaching_notes notu, eskisi gibi */ }
  else { await appendBehavioralPatterns(userId, [updates.new_pattern]); }
}
// changes.behavioral_patterns'a HİÇ yazma
```

**Migration taslağı:**
```sql
NNN_pattern_append_full_lifecycle.sql (idempotent): CREATE OR REPLACE FUNCTION ai_summary_append_patterns(p_user_id, p_new_patterns) — mevcut FOR UPDATE satır kilidini koru, içine dedup(type+trigger)+boost+decay(>90g resolved)+cap(20) mantığını ekle (şu an ai-chat JS'inde olan). Ayrıca CREATE OR REPLACE FUNCTION ai_summary_evolve_patterns(p_user_id) — evolvePatternConfidence mantığını FOR UPDATE altında. DOWN: fonksiyonları 015'teki sade haline geri al.
```

**Doğrulama:** tsc. q.mjs ile ai_summary_append_patterns çağrısını manuel test (aynı type+trigger iki kez → tek satır, times_observed=2). Eşzamanlılık: kk.mjs ile aynı kullanıcıya hızlı iki mesaj (ikisi de pattern üreten) + paralel ai-extractor tier-2 tetikle → behavioral_patterns'ta kayıp olmamalı. evolve sonrası confidence decay doğrulanmalı.

---

### 🟠 HIGH — Alerjen tarama Türkçe çekimli ('yer fıstığı') ve İngilizce yiyecek adlarını kaçırıyor
- **Dosyalar:** `supabase/functions/shared/guardrails.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `guardrails_allergen`

**Kök-neden:** TEYİT EDİLDİ. guardrails.ts:70-76 stripTurkishSuffix yalnız kelimenin SONUNDAKİ tek eki kırpar ($ ankraj) ve ünsüz yumuşamasını (ğ→k/g) ele almaz. checkAllergens (84-121) lowerText.includes(token) + normText üzerinde çalışır. 'fıstığı' (fıstık genitif, ğ) → trailing 'ı' kırpılınca 'fıstığ' kalır, 'fıstık' (k) ile eşleşmez. ALLERGEN_FOODS (44-64) 'yer fıstığı' compound'unu içermiyor; fıstık:['fıstık','fistik'] (51) sadece. İngilizce adlar (peanut, milk, cheese) sözlükte yok. checkAllergens ai-plan:665 öğün filtresi ve ai-chat:1539 çıkış-taraması tarafından kullanılıyor → fıstık alerjisi olan kullanıcının planında 'yer fıstığı ezmesi' kalabilir (anafilaksi riski).

**Düzeltme:** (1) stripTurkishSuffix'i ünsüz-yumuşaması farkındalıklı yap: ek kırptıktan sonra son ünsüzü normalize et (ğ→k, b→p, c→ç, d→t). Daha sağlamı: normalize fonksiyonunu kelime-kelime uygula (tüm metni değil) — checkAllergens'te metni tokenize edip her token'ı normalize et, token'ların hem ham hem normalize formuyla allergen token'larının normalize formunu karşılaştır. (2) ALLERGEN_FOODS'a compound + İngilizce karşılıklar ekle: fıstık:[...,'yer fıstığı','yer fistigi','peanut'], laktoz/süt:[...,'milk','cheese'], yumurta:[...,'egg'], balık:[...,'fish'], gluten:[...,'bread','pasta','wheat']. (3) checkAllergens normal-yön kontrolünü (107) normalize-edilmiş token bazında da yap.

```tsx
function softenLastConsonant(w){ return w.replace(/ğ$/,'k').replace(/b$/,'p').replace(/c$/,'ç').replace(/d$/,'t'); }
function stripTurkishSuffix(word){ const s = word.replace(/(sız|siz|suz|süz)$/u,'').replace(/(lı|li|lu|lü)$/u,'').replace(/(lar|ler)$/u,'').replace(/(ı|i|u|ü)$/u,''); return softenLastConsonant(s); }
// fıstık:[...,'yer fıstığı','yer fistigi','peanut']
```

**Doğrulama:** tsc. Birim (audit'in canlı testi): checkAllergens('yer fıstığı ezmesi öneriyorum',['fıstık']).passed===false; checkAllergens('peanut butter toast',['fıstık']).passed===false; checkAllergens('fındığı ye',['fındık']).passed===false. Regresyon: güvenli öğünler (örn. 'kavun', 'tavuğun') yanlış flag VERMEMELİ (false-positive guard, length<3 kuralı korunmalı).

---

### 🟠 HIGH — Alerjen çıkış-uyarısı alakasız bir 'decline' kelimesiyle veya 2. öneride yanlışlıkla bastırılıyor (yanlış-negatif)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai_chat_allergen_scan`

**Kök-neden:** TEYİT EDİLDİ. ai-chat/index.ts:1550-1557 'addressed' mantığı, her matched alerjen için tokens.some(t => { const i=lowerReply.indexOf(t); return i>=0 && DECLINE.test(slice(i-50, i+len+50)); }) yapıyor. İki yanlış-negatif: (1) indexOf yalnız İLK geçişe bakar — 'peynir yerine badem... ayrıca akşam peynir tabağı harika' → ilk 'peynir' yanında 'yerine' var, addressed=true, ikinci gerçek öneri kaçar. (2) ±50 karakter penceresinde KONUYLA ALAKASIZ decline kelimesi (örn. 'şekerli içecekleri tüketme') bastırır. DECLINE (1537) 'tüketme','yerine','çıkar' gibi geniş kelimeler içeriyor, alerjen token'ına bağlı değil.

**Düzeltme:** addressed mantığını TÜM geçişleri tarayacak şekilde değiştir: her matched alerjen için token'ın TÜM occurrence'larını (while indexOf/matchAll) bul; eğer EN AZ BİR geçiş decline penceresi dışındaysa → o alerjen 'addressed değil' → uyar. Yani 'her geçiş decline yanında' olmalı (any-uncovered → warn). Ayrıca decline eşleşmesini alerjen token'ına BİTİŞİK kalıba bağla: '<token>\s*(yerine|içermez|olmadan|hariç)' veya '(önermiyorum|kaçın|uzak dur)\s*[^.]{0,20}<token>' — geniş ±50 pencere yerine. Bu, alakasız decline kelimesinin bastırmasını engeller.

```tsx
const addressed = matched.length>0 && matched.every(a => {
  const tokens = [...].filter(t=>t.length>=3);
  // her token'ın HER geçişi decline ile kaplı mı?
  return tokens.every(t => {
    let i=lowerReply.indexOf(t), covered=true;
    while(i>=0){ const win=lowerReply.slice(Math.max(0,i-30), i+t.length+30);
      if(!DECLINE.test(win)){ covered=false; break; } i=lowerReply.indexOf(t,i+t.length); }
    return covered; });
});
```

**Doğrulama:** tsc. Birim (audit canlı testleri): addressed('Kahvaltıda peynir öner. şekerli içecekleri tüketme.',['peynir'])===false (alakasız tüketme); addressed('peynir yerine badem öner. ayrıca akşam peynir tabağı harika.',['peynir'])===false (2. öneri). Gerçek decline: 'peynir yerine badem, peynirden uzak dur' → addressed===true (uyarı bastırılır, doğru).

---

### 🟠 HIGH — İntihar/kendine zarar kriz tespiti yaygın Türkçe ifadeleri kaçırıyor
- **Dosyalar:** `supabase/functions/shared/guardrails.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `guardrails_crisis`

**Kök-neden:** TEYİT EDİLDİ. guardrails.ts:339-358 detectCrisis sabit crisisPhrases listesiyle lower.includes(phrase) yapıyor. Liste 'intihar/ölmek istiyorum/canıma kıymak/hayatıma son/kendimi öldürmek' içeriyor ama yöntem-tabanlı ve dolaylı ifadeleri KAÇIRIYOR: 'kendimi asacağım', 'bıçakla bileğimi keseceğim', 'ölüp kurtulmak istiyorum', 'hayata veda etmek istiyorum', 'her şeye son vermek istiyorum', 'kendime kıymak istiyorum'. ai-chat:125 bunu çağırıyor; en yüksek etkili güvenlik açığı (akut krizde kullanıcı 112+profesyonel destek mesajını almaz).

**Düzeltme:** detectCrisis'i sabit-liste + kök-tabanlı regex hibridine çevir (fail-safe yönünde geniş tut, false-positive'in maliyeti düşük: empatik kriz mesajı zaten zararsız). Regex ekle: /(kendi(mi|me)|canı(mı|ma)|hayatı(mı|ma)|yaşamı(mı|ma)|her\s?şeye).*(as|kes|kıy|son ver|öldür|bitir|veda)/ ; /(ölüp kurtul|hayata veda|son vermek isti|yaşamak istemiyorum|yok olmak isti)/ ; yöntem+kendine: /(bilek|damar).*kes/, /(ip|bıçak|hap).*(kendi|canı)/. Mevcut crisisPhrases listesini koru (geri-uyumluluk). Detection BOZUK Türkçe yazımları da yakalasın diye diakritiksiz varyantları da ekle (kiy, son ver vb.). detectED'den ÖNCE çalıştığı sıralama korunur (335 yorum).

```tsx
const CRISIS_RE = [
 /(kendi(mi|me)|canı(mı|ma)|cani(mi|ma)|hayatı(mı|ma)|yaşamı(mı|ma)).*(as[ae]|kes|kıy|kiy|son ver|öldür|oldur|bitir|veda)/,
 /(ölüp kurtul|olup kurtul|hayata veda|son vermek isti|yok olmak isti)/,
 /(bilek|damar).*(kes)|(ip|bıçak|bicak).*(kendi|canı|cani)/
];
if (crisisPhrases.some(p=>lower.includes(p)) || CRISIS_RE.some(r=>r.test(lower))) return { isCrisis:true, message:... };
```

**Doğrulama:** tsc. Birim: audit'in 6 ifadesinin TAMAMI isCrisis===true dönmeli ('kendimi asacağım','bıçakla bileğimi keseceğim','ölüp kurtulmak istiyorum','hayata veda etmek istiyorum','her şeye son vermek istiyorum','kendime kıymak istiyorum'). Mevcut liste ifadeleri hâlâ true. False-positive kontrol: 'şu yemeği bitir' gibi masum ifadeler isCrisis dönmemeli (regex kendi/canı/hayatı ankrajına bağlı olduğu için güvenli). kk.mjs canlı: kriz ifadesinde 112 mesajı dönmeli.

---

### 🟠 HIGH — Cron HTTP çağrıları x-cron-secret göndermiyor — CRON_SECRET tanımlanırsa tüm proaktif/rapor/temizlik sistemi 401 ile sessizce ölür
- **Dosyalar:** `supabase/migrations/014_cron_jobs.sql`, `supabase/migrations/022_scheduled_cleanups_unify.sql`, `supabase/migrations/*_cron_secret_header.sql`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `cron_migrations`

**Kök-neden:** TEYİT EDİLDİ. cron-auth.ts:14-23 denyIfNotCron, CRON_SECRET tanımlıysa x-cron-secret header'ını karşılaştırıp eşleşmezse 401; tanımsızsa fail-open (16). Migration 014'teki tüm net.http_post header'ları yalnız Content-Type + 'Bearer service_role_key' içeriyor (15-18, 47-50, 62-65, 77-80); x-cron-secret YOK. grep migrations: x-cron-secret/cron_secret/CRON_SECRET → 0 eşleşme. Yani biri güvenlik için CRON_SECRET set ederse ai-proactive+ai-extractor+cleanup crons'unun TAMAMI 401 alır, hiçbir nudge/rapor/temizlik üretilmez, hata kullanıcıya görünmez (gizli bomba).

**Düzeltme:** Tüm denyIfNotCron-korumalı edge fonksiyonlarını çağıran net.http_post header'larına x-cron-secret ekle. CRON_SECRET'ı GUC olarak okumak için current_setting('app.settings.cron_secret', true) kullan (missing_ok=true ki ayar yoksa NULL döner ve cron-auth tarafı fail-open kalır). Yeni migration ile etkilenen cron job'larını cron.unschedule + cron.schedule ile yeniden tanımla (header'a satır ekleyerek). Etkilenenler: kochko-tier2/tier3-extraction (ai-extractor), kochko-proactive-morning/afternoon/evening (ai-proactive), 022'deki cleanup-scheduled job(ları). session-cleanup (014:87) edge fonksiyonu çağırmadığı (saf SQL) için dokunma. Alternatif minimal (eğer CRON_SECRET hiç kullanılmayacaksa): cron-auth.ts yorumundaki vaadin migration'larca karşılanmadığını belgele — ama header eklemek doğru ve ucuz.

```tsx
headers := jsonb_build_object(
  'Content-Type','application/json',
  'Authorization','Bearer '||current_setting('app.settings.service_role_key'),
  'x-cron-secret', current_setting('app.settings.cron_secret', true)
)
```

**Migration taslağı:**
```sql
NNN_cron_secret_header.sql (idempotent): her etkilenen job için SELECT cron.unschedule('kochko-tier2-extraction') (IF EXISTS guard'lı) sonra cron.schedule(...) ile aynı schedule + x-cron-secret eklenmiş header. 022'deki cleanup job'ı da aynı şekilde. app.settings.cron_secret GUC'unun set edilme yöntemini yorum olarak belgele. DOWN: header'sız eski tanımları geri schedule et.
```

**Doğrulama:** q.mjs / SQL: SELECT command FROM cron.job WHERE jobname LIKE 'kochko-%' → her komutta x-cron-secret görünmeli. Canlı: CRON_SECRET secret'ını set et + GUC'u ayarla, ai-proactive'i cron'dan tetiklet, 401 DEĞİL 200 dönmeli ve coaching_messages üretmeli. CRON_SECRET unset iken de çalışmaya devam etmeli (fail-open).

---

### 🟠 HIGH — Haftalık raporlar cron tarafından HİÇ otomatik üretilmiyor — tetik penceresi cron saatleriyle çakışmıyor
- **Dosyalar:** `supabase/functions/ai-proactive/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai_proactive_triggers`

**Kök-neden:** TEYİT EDİLDİ. ai-proactive/index.ts:1428 haftalık rapor tetiği yalnız (dayOfWeek===1 && utcHour>=6 && utcHour<=8). 014_cron_jobs.sql ai-proactive crons'unu SADECE UTC 05:00 (43), 10:00 (58), 17:00 (73)'te çalıştırıyor. Hiçbiri 6-8 UTC penceresine düşmez (en yakın Pazartesi 10:00, pencere dışı). Karşılaştırma: günlük rapor tetiği (1390) (utcHour>=4 && utcHour<=6) kullanır ve 05:00 cron'uyla ÇALIŞIR. Yani haftalık rapor hiçbir kullanıcı için otomatik oluşmaz (manuel istek hariç); aylık rapor weekly_reports'u beslediğinden zincirleme etkilenir.

**Düzeltme:** En minimal+doğru: ai-proactive:1428 tetik penceresini günlük blokla aynı (utcHour>=4 && utcHour<=6) yap — böylece mevcut Pazartesi 05:00 cron'u tetikler (yeni cron gerektirmez). Migration değişikliği gerekmez. (Alternatif: 014'e Pazartesi 6-8 arası ek cron — daha fazla yüzey, gereksiz.) Pazartesi 05:00 hem günlük (dün Pazar) hem haftalık raporu aynı invoke'ta üretir; ikisi de existingReport/existingWeekly idempotent guard'ına sahip olduğundan çift üretim olmaz.

```tsx
// index.ts:1428
if (dayOfWeek === 1 && utcHour >= 4 && utcHour <= 6) {
```

**Doğrulama:** tsc. Canlı: ai-proactive'i body {trigger:'morning'} ile UTC ~05:00 Pazartesi'de (veya forceWeekly test flag varsa onunla) tetikle → ilgili kullanıcılarda weekly_reports'a önceki haftaya ait satır oluşmalı. q.mjs ile weekly_reports.week_start kontrol. Salı tetiğinde haftalık ÜRETİLMEMELİ (dayOfWeek guard).

---

### 🟠 HIGH — Günlük ücretsiz mesaj limiti 'register' anahtar kelimesiyle atlatılabiliyor (monetizasyon/maliyet açığı)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/rate-limit.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `rate_limit`

**Kök-neden:** TEYİT EDİLDİ. ai-chat/index.ts:153-155 isRecordParse = detectTaskMode(message,false)==='register'; checkRateLimit(userId, isRecordParse). rate-limit.ts:95 if(isRecordParse) return { allowed:true, remaining:-1 } — register mesajları limite HİÇ sayılmaz. detectTaskMode (task-modes.ts:49-54) saf anahtar-kelime: 'yedim','su iç','antrenman','\d+ kg','uyku','mood'. Limiti dolmuş ücretsiz kullanıcı uzun bir koçluk sorusunun sonuna '...bu arada bugün su içtim' ekleyerek 50/gün tavanını süresiz atlar; register FAST tier'a gitse de tam yanıt üretir ve cap'i saymaz.

**Düzeltme:** Muafiyeti içerik-tespitine değil, GERÇEKTEN kayıt eylemi üretilip üretilmediğine bağla (post-hoc). İki kademeli minimal yaklaşım: (1) Muafiyeti tamamen kaldırmak yerine register'a AYRI ve daha düşük bir günlük tavan ver (örn. saf-kayıt için 30/gün gibi) — checkRateLimit'e recordCap parametresi ekle; isRecordParse'ta unlimited yerine bu cap'i uygula. (2) Daha doğru ama kapsamlı: ön-kontrolde sadece soft-allow et, executeActions sonrası gerçekten meal/water/weight/workout/sleep action üretildiyse o mesajı limit-muaf işaretle (chat_messages'a is_record_exempt kolonu + sayımda hariç tut). Pragmatik öneri: (1)'i uygula (S effort) — register'ı sınırsızdan çıkarıp düşük ayrı tavana çek; bu istismarı pratikte kapatır.

```tsx
// rate-limit.ts: isRecordParse ise unlimited DEĞİL, ayrı düşük cap
if (isRecordParse) {
  const recordCount = /* o güne ait register-mode chat_messages sayısı */;
  const RECORD_CAP = isPremium ? 200 : 30;
  return { allowed: recordCount < RECORD_CAP, remaining: Math.max(0, RECORD_CAP-recordCount), message: '...' };
}
```

**Doğrulama:** tsc. kk.mjs ile ücretsiz kullanıcıda 30+ saf-kayıt mesajı gönder → cap'e ulaşınca reddedilmeli (artık sınırsız değil). Normal koçluk + sonuna 'su içtim' eklenen mesajların da register cap'ine sayıldığını q.mjs ile doğrula. Premium kullanıcı 200 normal cap'ini aşmamalı.

---

### 🟠 HIGH — Servis bağlamları (recovery/eating-out/MVD) gün sınırını yok sayıp ham UTC 'bugün' kullanıyor
- **Dosyalar:** `supabase/functions/shared/service-contexts.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `service_contexts_date`

**Kök-neden:** TEYİT EDİLDİ. ai-chat efektif günü (243) getEffectiveDateForUser(tz, day_boundary_hour) ile hesaplar; tüm meal_logs.logged_for_date yazımları buna göre. Ancak getAllServiceContexts (service-contexts.ts:813-816) options={message,clientTimezone} alıyor, effectiveToday İLETMİYOR. getRecoveryContext (130), getEatingOutContext (301), getMVDContext (372) 'bugün'ü ham new Date().toISOString().split('T')[0] (UTC) ile yeniden hesaplıyor. Aynı dosyada recipe modu (ai-chat:361) effectiveToday kullanıyor — kanıtlı tutarsızlık. İstanbul gece yarısı/UTC dönümünde recovery 'fazlalık', eating-out 'kalan bütçe', MVD aktiflik yanlış güne ait çıkar; geniş offsetli (ABD) TZ'lerde sistematik.

**Düzeltme:** getAllServiceContexts options'ına effectiveToday?: string ekle (gerekirse weekStart de) ve ai-chat:398'de effectiveToday değerini ilet. getRecoveryContext/getEatingOutContext/getMVDContext imzalarına today?: string parametresi ekle; içerideki new Date().toISOString() (130/301/372) yerine (today ?? new Date().toISOString().split('T')[0]) kullan. getAllServiceContexts içinden bu üç fonksiyona effectiveToday'i geçir. Diğer servis fonksiyonları (travel zaten clientTimezone alıyor) etkilenmiyor.

```tsx
export async function getAllServiceContexts(userId, taskMode, options?: { message?:string; clientTimezone?:string; effectiveToday?:string }) {
  ...getRecoveryContext(userId, options?.effectiveToday),
     getEatingOutContext(userId, options?.effectiveToday),
     getMVDContext(userId, options?.effectiveToday)...
}
// her fn: const today = effectiveToday ?? new Date().toISOString().split('T')[0];
// ai-chat:398
getAllServiceContexts(userId, taskMode, { message, clientTimezone, effectiveToday })
```

**Doğrulama:** tsc. kk.mjs ile client_timezone='Europe/Istanbul' ve UTC 22:30 (IST 01:30) civarı recovery/eating_out mesajı gönder; 'bugün yenilen' değerinin efektif güne (meal_logs.logged_for_date ile aynı) ait olduğunu, UTC 'dün'e kaymadığını doğrula. day_boundary_hour set edilmiş kullanıcıda da tutarlı olmalı.

---

### 🟠 HIGH — Sunucu (UTC) ile istemci (cihaz TZ) week_start hesabı ayrışıyor — üretilen haftalık menü ekranda görünmüyor
- **Dosyalar:** `src/services/weekly-plan.service.ts`, `supabase/functions/ai-plan/index.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `week_start_tz`

**Kök-neden:** TEYİT EDİLDİ. Client weekly-plan.service.ts:198-203 getWeekStart cihaz-yerel getDay()/getDate() ile diff hesaplayıp .toISOString() (UTC) döndürür (karışık yerel/UTC); getCurrentWeeklyPlan (139) .eq('week_start', weekStart) TAM EŞİTLİK sorgular. Server ai-plan/index.ts:886-891 getWeekStart de aynı buggy yerel-method mantığını Deno UTC runtime'da çalıştırır; today=new Date().toISOString() (95) UTC. TZ farkında iki taraf ayrışır (Pazartesi 00:30 IST'te client '2026-06-07', server '2026-06-01' → .eq eşleşmez → 0 satır). NOT: ai-chat/index.ts:1746-1752 getWeekStart DOĞRU implementasyon (UTC-noon ankraj, getUTCDay/getUTCDate) — kanonik referans bu.

**Düzeltme:** İki tarafı da ai-chat'in UTC-noon ankrajlı getWeekStart'ına hizala. (1) ai-plan/index.ts:886-891 getWeekStart'ı ai-chat:1746-1752 ile aynı UTC-noon implementasyonla değiştir (T12:00:00Z + getUTCDay/getUTCDate). (2) Client getWeekStart (weekly-plan.service.ts:198-203) aynı UTC-noon mantığına çevir (yerel getDay/getDate yerine). (3) getCurrentWeeklyPlan sorgusunu (139) tam-eşitlik yerine aralık yap: .lte('week_start', today).gte('week_start', addDays(today,-6)) — TZ kenar durumunda bile aktif haftayı yakalar; ya da en azından her iki tarafı aynı kanonik fonksiyona bağladıktan sonra .eq kalabilir. Minimal-doğru: önce her iki getWeekStart'ı kanonik hale getir (eşitlik tutar), aralık sorgusunu ek savunma olarak ekle.

```tsx
// her iki dosyada:
function getWeekStart(dateStr){ const base = dateStr ?? new Date().toISOString().split('T')[0]; const d=new Date(`${base}T12:00:00.000Z`); const day=d.getUTCDay(); const diff=d.getUTCDate()-day+(day===0?-6:1); d.setUTCDate(diff); return d.toISOString().split('T')[0]; }
// getCurrentWeeklyPlan ek savunma:
.lte('week_start', getWeekStart()).gte('week_start', addDays(getWeekStart(),-6))
```

**Doğrulama:** tsc (her iki taraf). Node TZ=Europe/Istanbul, sahte saat 2026-06-08T00:30+03:00 ile client getWeekStart ve server getWeekStart aynı '2026-06-08' (Pazartesi) dönmeli. kk.mjs/preview: Pazartesi sabahı IST'te haftalık menü üret → menü tab'ı DOLU görünmeli (boş kalmamalı). q.mjs ile üretilen weekly_plans.week_start'ın client'ın sorguladığı değerle eşleştiğini doğrula.

---

### 🟡 MEDIUM — İlk-pas plan-snapshot üretimi yüksek sıcaklıkta + JSON-mode zorlanmadan çalışıyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/openai.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai-chat-llm-call`

**Kök-neden:** shared/openai.ts:84 'temperature: options?.temperature ?? 0.5' ve ai-chat sıcaklığı TEMPERATURE[taskMode] (detectTaskMode çıktısı, effectiveMode DEĞİL) ile seçilir; haritada (openai.ts:23-35) plan_diet/plan_workout anahtarı yok → büyük plan JSON'u ilk geçişte 0.5'te üretilir. Ayrıca plan/forced çağrıları jsonMode:true geçmediği için response_format:json_object kullanılmaz, çıktı metinden regex ile ayıklanır. openai.ts'de truncation→retry (122-138) ve jsonMode 'json' kelime enjeksiyonu (61-79) zaten var, yani altyapı hazır; sadece plan akışı kullanmıyor. DOĞRULANDI.

**Yeniden değerlendirme:** Geçerli; ancak abartı değil — openai.ts truncation-retry + jsonMode-word-injection altyapısı zaten eklenmiş, dolayısıyla risk finder'ın ima ettiğinden bir tık düşük. Plan akışını altyapıya bağlamak yeterli.

**Düzeltme:** ai-chat'te ana LLM sıcaklık seçimini effectiveMode üzerinden yap ve TEMPERATURE map'ine plan_diet:0.3 / plan_workout:0.3 ekle (register zaten 0.2). Plan-snapshot üreten ve forced re-generation çağrılarına jsonMode:true ekle; model tag yerine düz JSON döndürecekse parse'ı extractPlanSnapshot regex'ten chatCompletion<...>(...,{jsonMode:true}) JSON dönüşüne çevir. Eğer tag formatı korunacaksa en azından sıcaklığı 0.2-0.3'e indir (mevcut zorunlu re-gen zaten 0.2). Minimal değişiklik: (a) TEMPERATURE'a iki anahtar, (b) sıcaklık seçimini effectiveMode'a bağla.

```tsx
// openai.ts TEMPERATURE map'e ekle
plan_diet: 0.3,
plan_workout: 0.3,
// ai-chat plan çağrısı
const temp = TEMPERATURE[effectiveMode] ?? 0.5;
await chatCompletion(msgs, { temperature: temp, maxTokens: 8000, jsonMode: true });
```

**Doğrulama:** tsc --noEmit (deno check). kk.mjs ile plan_diet modunda uzun bir plan pazarlığı çalıştır; plan_snapshot'ın eksiksiz parse edildiğini ve ham JSON'un mesaja sızmadığını gözle. q.mjs ile son chat_messages.task_mode ve plan satırını kontrol et.

---

### 🟡 MEDIUM — ai-extractor general_summary'yi atomik merge'i bypass ederek yazıyor — lost-update + tutarsız cap
- **Dosyalar:** `supabase/functions/ai-extractor/index.ts`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `memory-l2-writes`

**Kök-neden:** ai-extractor/index.ts:255-258 general_summary'yi 'ai_summary_merge' RPC yerine düz '.upsert({general_summary: next})' ile yazar (FOR UPDATE kilidi alınmaz, mig 015). ai-chat aynı alanı updateLayer2→ai_summary_merge ile read-modify-write yapar. İkisi eşzamanlı çalışırsa lost-update. Ayrıca extractor 3000 char cap (254) uygular, ai-chat tarafı cap'siz (#diğer MEDIUM ile bağlantılı). DOĞRULANDI.

**Düzeltme:** ai-extractor:255-258 upsert'ünü ai_summary_merge RPC çağrısına çevir: önce mevcut özeti okumadan, append+cap mantığını RPC içine taşı VEYA mevcut okuma+birleştirme korunup yazımı 'rpc(ai_summary_merge, {p_user_id, p_patch:{general_summary: next}})' ile yap. ai_summary_merge zaten skalar alanlar için son-yazan değil COALESCE-replace yaptığından, append'i JS'te yapıp merge ile atomik yazmak yeterli (read+merge yarışı kalır ama tek RPC kilidi alır). En temizi: mig'de ai_summary_merge'e general_summary için append+cap dalı eklemek (aşağıda). Eğer mig istenmiyorsa, en azından düz upsert yerine merge RPC kullan ki ai-chat ile aynı yoldan geçsin.

```tsx
// ai-extractor
await supabaseAdmin.rpc('ai_summary_merge', {
  p_user_id: userId,
  p_patch: { general_summary: next } // next zaten 3000-cap'li
});
```

**Migration taslağı:**
```sql
OPSİYONEL 051_ai_summary_merge_general_summary_append.sql: ai_summary_merge fonksiyonuna general_summary için idempotent append+cap dalı ekle — eğer p_patch->>'general_summary' geldiyse mevcut general_summary'ye '\n' ile ekle, son 3000 karakteri tut. CREATE OR REPLACE FUNCTION (geri-alınabilir: önceki tanım yedeklenir). RPC zaten SECURITY DEFINER. Mig istenmezse JS-tarafı append + merge upsert ile çözülür.
```

**Doğrulama:** q.mjs ile ai_summary.general_summary'yi iki eşzamanlı (extractor + chat) yazımdan sonra oku; kayıp olmadığını ve 3000 char'ı aşmadığını doğrula. tsc/deno check.

---

### 🟡 MEDIUM — Layer-2 metin alanları (coaching_notes/general_summary) sınırsız büyüyor — katman token bütçesi zorlanmıyor
- **Dosyalar:** `supabase/functions/shared/context-builders.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `memory-context-builders`

**Kök-neden:** context-builders.ts:350 'if (s.coaching_notes) parts.push(`## KOCLUK NOTLARI\n${s.coaching_notes}`)' — cap yok; 284-287 general_summary minimal'de 500 char kesilir ama full'de TAM basılır. ai-chat coaching_notes'a her aksiyonda '${current}\n[tarih]...' ekler (cap yok). buildLayer4Scoped 6000-token bütçeli ama L2'de bütçe yok. DOĞRULANDI.

**Yeniden değerlendirme:** Geçerli. Yazma cap'i için ai-extractor zaten 3000-cap deseni kullanıyor; aynı sabit kullanılmalı.

**Düzeltme:** buildLayer2Scoped'ta coaching_notes ve general_summary'yi son N satır / ~2500-3000 char ile kırp (prompt'a basarken). coaching_notes için: satırlara böl, son ~30 satır veya son 2500 char'ı al. general_summary full dalında da .slice(-3000) uygula. Ayrıca ai-chat'te coaching_notes yazımına yazma-anında cap koy (extractor general_summary'deki 3000-cap deseniyle simetrik). Yazma+okuma cap'lerini tutarlı tut.

```tsx
// context-builders.ts:350
if (s.coaching_notes) {
  const cn = String(s.coaching_notes);
  const capped = cn.length > 2500 ? cn.slice(-2500) : cn;
  parts.push(`## KOCLUK NOTLARI\n${capped}`);
}
// general_summary full dalı: summary.slice(-3000)
```

**Doğrulama:** Uzun-süreli kullanıcı için ai_summary'yi q.mjs ile çek, buildLayer2Scoped çıktısını kk.mjs preview ile prompt boyutunu ölç; coaching_notes/general_summary'nin ~3000 char altına kırpıldığını doğrula. tsc.

---

### 🟡 MEDIUM — tdee_notes yazılıyor ama hiçbir L2 okuyucu okumuyor — ölü yazma yolu
- **Dosyalar:** `supabase/functions/shared/context-builders.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `memory-context-builders`

**Kök-neden:** ai-chat/index.ts:4400-4404 tdee_notes'u ai_summary_merge ile yazar ('buildLayer2 reads it' yorumu). context-builders.ts:279-408 (buildLayer2Scoped tümü) okundu: 's.tdee_notes' referansı YOK (recovery_pattern/weekly_budget_pattern okunuyor, tdee_notes okunmuyor). repair-handler'da da yok. DOĞRULANDI — yorum yanıltıcı.

**Düzeltme:** İki seçenek; tercih: buildLayer2Scoped'ın isFull dalına (393 civarı, recovery_pattern yanına) 'if (s.tdee_notes) parts.push(`Guncel TDEE: ${s.tdee_notes}`)' ekle ki yazılan veri koça ulaşsın. Alternatif (yazımı kaldırmak) önerilmez çünkü güncel TDEE bağlamı değerli. ai-chat:4400'deki yanıltıcı 'buildLayer2 reads it' yorumunu güncelle.

```tsx
// context-builders.ts isFull dalı
if (s.tdee_notes) parts.push(`Guncel TDEE: ${s.tdee_notes}`);
```

**Doğrulama:** kk.mjs ile bir kilo/TDEE güncellemesi tetikle, sonraki turda full-layer2 prompt'unda 'Guncel TDEE' satırının göründüğünü doğrula. q.mjs ile ai_summary.tdee_notes'u kontrol et. tsc.

---

### 🟡 MEDIUM — micro_nutrient_risks: yazıcısı olmayan salt-okunur bellek + array sütununa hatalı obje merge'i
- **Dosyalar:** `supabase/functions/shared/context-builders.ts`, `supabase/functions/shared/memory.ts`
- **Efor:** Küçük · **Risk:** low · **Migration gerekli** · **batch:** `memory-l2-writes`

**Kök-neden:** context-builders.ts:395-398 micro_nutrient_risks OKUNUYOR ve {nutrient,risk_level}[] bekleniyor (.map(r => r.nutrient/r.risk_level)); export'ta da gösteriliyor. Grep: hiçbir edge fonksiyon bu alana YAZMIYOR → bölüm hep boş. Sütun JSONB DEFAULT '[]' (array). ai_summary_merge skalar/obje alanları '||' ile birleştirir; ileride biri obje patch'i gönderirse array'i bozar (latent). DOĞRULANDI.

**Yeniden değerlendirme:** Kısmen abartılı: aktif bozulma yok (yazıcı yok), risk yalnız ileride yazıcı eklenirse latent. Bu yüzden effort=S/risk=low; öncelik düşük.

**Düzeltme:** Yazıcı kısa vadede planlanmıyorsa: ölü okuma+export yolu kalsın AMA latent merge bozulmasını engellemek için memory.ts'te micro_nutrient_risks'i atomik-array alanları listesine ekle (behavioral_patterns gibi array-aware işlem) ya da ai_summary_merge'in obje-||-merge dalından hariç tut. En düşük-riskli minimal düzeltme: okuma kodu zaten güvenli (boş array→hiç basılmaz), bu yüzden tek somut iş latent merge'i array-aware yapmak veya yorumla 'yazıcı yok, array-merge gerektirir' işaretlemek. Aktif veri bozulması ŞU AN yok.

```tsx
// ai_summary_merge mig: micro_nutrient_risks için
// COALESCE(existing,'[]') || COALESCE(patch,'[]')  -- array-concat, obje '||' değil
```

**Migration taslağı:**
```sql
OPSİYONEL: ai_summary_merge'de micro_nutrient_risks alanını array-aware concat ile ele al (obje '||' yerine '||' jsonb array concat + opsiyonel dedup). İdempotent CREATE OR REPLACE. Yazıcı yoksa düşük öncelik; sadece latent bozulmayı önler.
```

**Doğrulama:** q.mjs ile ai_summary.micro_nutrient_risks tipini doğrula ('[]' array). Migration uygulanırsa bir test patch ile array-concat davranışını SELECT ile teyit et. tsc.

---

### 🟡 MEDIUM — approveDraft / chat-approve archive→promote atomik değil — yarışta 0 aktif plan riski
- **Dosyalar:** `src/services/plan.service.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Orta · **Risk:** med · **Migration gerekli** · **batch:** `plan-approval`

**Kök-neden:** plan.service.ts:233-264 approveDraft iki ayrı statement: önce eski aktifi archive (242-245), sonra draft'ı promote (249-258); transaction yok. Yorum (227-232) bunu açıkça kabul ediyor ('user ends up with 0 active plans; next approve retries'). uniq_active_plan_per_type partial unique index ikinci eşzamanlı promote'u 23505 ile reddeder ve archive geri alınmaz. ai-chat approve yolu da aynı desen. DOĞRULANDI.

**Düzeltme:** Onay+arşivlemeyi tek SECURITY DEFINER RPC'de transaction yap: rpc('approve_plan_atomic', {p_user, p_type, p_draft_id, p_snapshot}) → BEGIN; eski aktifi archive; draft'ı active yap; COMMIT (tek tx içinde unique-index ihlali tüm tx'i geri alır, 0-aktif durumu oluşmaz). plan.service.approveDraft ve ai-chat approve bu RPC'yi çağırsın. Mig istenmezse en az: promote başarısız (23505) olursa archive'ı geri al (status='active' restore) + idempotent retry.

```tsx
-- mig: approve_plan_atomic(...)
UPDATE weekly_plans SET status='archived',... WHERE user_id=p_user AND plan_type=p_type AND status='active';
UPDATE weekly_plans SET status='active', approved_at=now(), approval_snapshot=p_snapshot WHERE id=p_draft_id;
-- tek tx; ihlalde otomatik rollback
```

**Migration taslağı:**
```sql
051_approve_plan_atomic.sql: CREATE OR REPLACE FUNCTION approve_plan_atomic(p_user uuid, p_type text, p_draft_id uuid, p_snapshot jsonb) RETURNS weekly_plans, SECURITY DEFINER, tek transaction içinde archive+promote. Geri-alınabilir (DROP FUNCTION). 047 trigger ile uyumlu (server-side aktivasyon).
```

**Doğrulama:** q.mjs ile çift onay (iki paralel çağrı) simüle et; her durumda tam 1 aktif plan kaldığını SELECT ile doğrula. kk.mjs ile normal onay akışının bozulmadığını test et. tsc.

---

### 🟡 MEDIUM — Projeksiyondaki weekConsumed soft-delete edilmiş öğünleri filtrelemiyor (ai-plan ile tutarsız)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-chat-projection`

**Kök-neden:** ai-chat/index.ts:1308-1313 meal_logs sorgusu '.gte/.lte logged_for_date' yapar ama '.eq(is_deleted,false)' YOK; bu weekConsumed'a girer ve daily_plans.weekly_budget_consumed/remaining'i belirler. ai-plan/index.ts:686-688 aynı hesapta açıkça is_deleted=false filtreler. İki yol aynı metriği farklı hesaplıyor. DOĞRULANDI.

**Düzeltme:** ai-chat:1308-1313 meal_logs sorgusuna '.eq('is_deleted', false)' ekle (ai-plan ile birebir hizalansın).

```tsx
.from('meal_logs').select('id').eq('user_id', userId).eq('is_deleted', false).gte('logged_for_date', weekStart).lte('logged_for_date', weekEnd)
```

**Doğrulama:** q.mjs: bir öğün soft-delete et, plan onayla, daily_plans.weekly_budget_consumed'ın silinen kaloriyi içermediğini doğrula. tsc.

---

### 🟡 MEDIUM — Aylık raporda avg_compliance/weight_change_kg LLM değeriyle kaydedilebiliyor — haftalık yol ile tutarsız
- **Dosyalar:** `supabase/functions/ai-report/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-report`

**Kök-neden:** ai-report/index.ts:478 'Number(report.avg_compliance ?? avgCompliance)' ve 479 'report.weight_change_kg ?? weightChange' — LLM bir sayı döndürürse LLM kazanır, deterministik avgCompliance/weightChange yalnız fallback. Haftalık yol deterministik değeri bilinçle LLM'e tercih eder. DOĞRULANDI.

**Düzeltme:** 478-480'i deterministik değerlerden TÜRET, LLM'i fallback olarak bile kullanma: safeCompliance = clamp(avgCompliance); safeWeightChange = weightChange (null ise null, değilse clamp). report.avg_compliance/report.weight_change_kg referanslarını upsert'ten çıkar. Haftalık yolla simetrik.

```tsx
const safeCompliance = Math.max(0, Math.min(100, Math.round(avgCompliance) || 0));
const safeWeightChange = weightChange == null ? null : Math.max(-999, Math.min(999, Number(weightChange) || 0));
```

**Doğrulama:** kk.mjs ile aylık rapor üret, monthly_reports.avg_compliance'ın daily_reports ortalamasına eşit olduğunu q.mjs ile doğrula (LLM tahmininden bağımsız). tsc.

---

### 🟡 MEDIUM — All-time longest_streak ardışık olmayan günleri seri sayıyor — takvim boşluğu kontrolü yok
- **Dosyalar:** `supabase/functions/ai-report/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-report`

**Kök-neden:** ai-report/index.ts:511-514, 557-564 streak döngüsü compliance_score>=70 olan her daily_reports satırında currentStreak++ yapar; ardışık takvim günü kontrolü yok. daily_reports yalnız rapor üretilen günlerde satır içerir → arada boş günler 'kırılma' sayılmaz. DOĞRULANDI (audit'te belirtilen mantık tutarlı).

**Düzeltme:** Streak döngüsünde önceki sayılan tarihi tut; r.date ile prevDate farkı 1 takvim günü (86400000 ms, UTC-gün karşılaştırması) değilse currentStreak'i 1'e resetle (veya 0). Satırların date'e göre sıralı olduğundan emin ol (order by date asc). compliance>=70 koşulu korunur; boşluk = kırılma.

```tsx
let prev=null;
for (const r of reportsSortedAsc) {
  if (r.compliance_score >= 70) {
    if (prev && diffDays(r.date, prev) === 1) currentStreak++;
    else currentStreak = 1;
    longest = Math.max(longest, currentStreak);
  } else currentStreak = 0;
  prev = r.date;
}
```

**Doğrulama:** q.mjs ile aralıklı daily_reports oluştur (1.gün, 12.gün), longest_streak'in 1 döndüğünü (2 değil) doğrula. tsc.

---

### 🟡 MEDIUM — Tıbbi-ifade sanitizasyonu kelime-sınırı olmadan substring eşleştiriyor — meşru metni bozuyor
- **Dosyalar:** `supabase/functions/shared/guardrails.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `guardrails-text`

**Kök-neden:** guardrails.ts:208-212 sanitizeText FORBIDDEN_PHRASES'i 'new RegExp(phrase, gi)' ile kelime sınırsız replace eder → 'ilac' alt-dizgesi 'kilacı'/'ilaçsız'/'recetesiz'/'tedavi gibi' gibi masum kelimelerde eşleşir, '[yasam tarzi notu]' ile mangle eder. FORBIDDEN_PHRASES'te kısa tokenlar var (ilac, ilaç, tedavi, recete). DOĞRULANDI.

**Yeniden değerlendirme:** Geçerli ve görünür kalite sorunu. Türkçe \b sınırı güvenilir değil; ASCII-olmayan harf karakter-sınıfı (ç,ğ,ı,ö,ş,ü dahil) ile manuel sınır önerilir — bu yüzden M efor.

**Düzeltme:** sanitizeText regex'ini kelime-sınırlı yap: 'new RegExp(`\\b${escapeRegex(phrase)}\\b`, giu)'. Türkçe için \b kısmen sorunlu olabilir (ı/ş vb. ASCII-word değil); alternatif: kısa riskli token'ları ('ilac','ilaç','tedavi','recete','reçete') bağlamsal kalıba bağla ('ilaç al','ilaç öner','tedavi et','reçete yaz') ve uzun spesifik ifadeleri (teşhis koy, tıbbi tavsiye, hastalığınız) olduğu gibi bırak. Önerilen: phrase listesini iki gruba ayır — kelime-sınırlı (kısa) ve serbest (uzun spesifik).

```tsx
const escapeRegex = (s)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
for (const phrase of FORBIDDEN_PHRASES) {
  const re = new RegExp(`(^|[^a-zçğıöşü])${escapeRegex(phrase)}([^a-zçğıöşü]|$)`, 'giu');
  // veya kısa tokenlar için bağlamsal kalıp
}
```

**Doğrulama:** Birim: sanitizeText('kilacı düşür') === 'kilacı düşür' (bozulmamalı); sanitizeText('ilaç al') sanitize edilmeli. kk.mjs ile bir plan focus_message'ın bozulmadan döndüğünü gözle. tsc.

---

### 🟡 MEDIUM — LLM çağrılarında timeout/AbortController yok — askıda kalan sağlayıcı isteği fonksiyonu kilitler
- **Dosyalar:** `supabase/functions/shared/openai.ts`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/ai-extractor/index.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai-llm-fetch`

**Kök-neden:** shared/openai.ts:92 (chat/completions) ve 167 (ai-extractor fetch), ai-chat:91 (Whisper) fetch çağrılarında AbortController/signal yok. Tek setTimeout 429 backoff için (109). Sağlayıcı askıda kalırsa istek platform duvar-saatine kadar bloklanır. DOĞRULANDI.

**Düzeltme:** chatCompletion fetch'ine AbortController + setTimeout(45000) ekle (vision için 60000), fetch'e signal geç, finally'de clearTimeout. Timeout abort'unda transient sayıp fallback modele düş; fallback de timeout olursa Türkçe jenerik hata fırlat. Whisper ve ai-extractor fetch'lerine aynı deseni (30-45s) uygula. Tek yardımcı 'fetchWithTimeout(url, opts, ms)' ekleyip üç yerde kullan.

```tsx
async function fetchWithTimeout(url, opts, ms=45000){
  const ac=new AbortController();
  const t=setTimeout(()=>ac.abort(),ms);
  try{ return await fetch(url,{...opts,signal:ac.signal}); } finally{ clearTimeout(t); }
}
// openai.ts: const response = await fetchWithTimeout(`${OPENAI_BASE_URL}/chat/completions`, {...}, 45000);
// abort → catch'te transient gibi fallback
```

**Doğrulama:** deno check. Yapay yavaş endpoint (OPENAI_BASE_URL'i bekleten bir mock) ile timeout'un ~45s'de tetiklenip jenerik hata döndüğünü gözle. kk.mjs normal akışın bozulmadığını test et.

---

### 🟡 MEDIUM — Whisper transkripsiyon URL'i sabit kodlu — OPENAI_BASE_URL sağlayıcı-değişimini kapsamıyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/openai.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-chat-stt`

**Kök-neden:** ai-chat/index.ts:90-91 Whisper STT 'https://api.openai.com/v1/audio/transcriptions' SABİT kodlanmış, model 'whisper-1' sabit, anahtar OPENAI_API_KEY. openai.ts:14 OPENAI_BASE_URL var ama bu çağrı onu kullanmıyor. Operatör base-URL'i başka sağlayıcıya çevirip anahtarı değiştirirse STT yine OpenAI'ye gider → 401. DOĞRULANDI.

**Düzeltme:** openai.ts'ten OPENAI_BASE_URL'i export et (zaten modül-içi). ai-chat:91 fetch URL'ini `${OPENAI_BASE_URL}/audio/transcriptions` yap; model'i Deno.env.get('KOCHKO_MODEL_STT') ?? 'whisper-1' ile al. Sağlayıcı STT desteklemiyorsa (404/400) sesli girişi zarif devre dışı bırak: respond({error:'Sesli giris su an kullanilamiyor'}, 503) gibi net Türkçe mesaj.

```tsx
import { OPENAI_BASE_URL } from '../shared/openai.ts';
formData.append('model', Deno.env.get('KOCHKO_MODEL_STT') ?? 'whisper-1');
await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {...})
```

**Doğrulama:** deno check. OPENAI_BASE_URL'i test gateway'e çevirip STT çağrısının o URL'e gittiğini network log ile doğrula. kk.mjs ile normal STT (transcribe_only) akışını test et.

---

### 🟡 MEDIUM — Ham sağlayıcı hata gövdesi doğrudan istemciye dönüyor (bilgi sızıntısı + kötü UX)
- **Dosyalar:** `supabase/functions/shared/openai.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-llm-fetch`

**Kök-neden:** openai.ts:114 'throw new Error(`OpenAI error (${model}): ${status} - ${err}`)' (err = tam yanıt gövdesi). ai-chat:1711-1712 üst-catch'te '/openai|quota|.../i.test(msg)' eşleşirse 'respond({error: msg, code:AI_UNAVAILABLE},500)' ile ham mesajı OLDUĞU GİBİ döner. Base-URL OpenAI-dışı sağlayıcıya bakıyorsa org/proje/iç hata sızabilir; kullanıcı İngilizce teknik metin görür. KISMEN düzeltilmiş (DB hataları zaten sanitize, 1714) ama LLM dalı hâlâ ham. DOĞRULANDI.

**Yeniden değerlendirme:** Kısmen çözülmüş (DB hataları sanitize). Kalan: LLM dalı hâlâ ham msg döndürüyor; düzeltme küçük. AI_UNAVAILABLE'ı 503'e çekmek opsiyonel (mevcut 500 de kabul).

**Düzeltme:** ai-chat:1711-1712'de istemciye ham 'msg' yerine sabit Türkçe jenerik mesaj dön ('Koç şu an yanıt veremiyor, birazdan tekrar dene.'), code:'AI_UNAVAILABLE' kalsın; ham 'msg' yalnız console.error'da (1704'te zaten var). Opsiyonel: openai.ts throw'unda err'i .substring(0,300) ile kırp ki log da şişmesin (gövde zaten 200 char log'lanıyor fallback dalında).

```tsx
if (/openai|quota|insufficient|rate.?limit|api key|anthropic|model/i.test(msg)) {
  return respond({ error: 'Koç şu an yanıt veremiyor, lütfen birazdan tekrar dene.', code: 'AI_UNAVAILABLE' }, 503);
}
```

**Doğrulama:** kk.mjs / mock ile bir 4xx provider hatası tetikle; istemci yanıtının jenerik Türkçe olduğunu, ham gövde içermediğini; server log'unda tam detayın kaldığını doğrula. tsc.

---

### 🟡 MEDIUM — Deterministik nudge döngüleri günlük mesaj limitini (dailyLimit) kontrol etmiyor
- **Dosyalar:** `supabase/functions/ai-proactive/index.ts`
- **Efor:** Orta · **Risk:** low · **batch:** `ai-proactive`

**Kök-neden:** ai-proactive/index.ts:130-144 snack_hour_nudge yalnız kendi trigger_type'ı için günlük dedup yapar (133-139), günlük TOPLAM coaching_messages sayısını dailyLimit'e karşı kontrol etmez. motivation_dip/reengagement/diğer deterministik döngüler aynı desende, ana LLM döngüsünden ÖNCE çalışır → dailyLimit'i göremez. DOĞRULANDI.

**Düzeltme:** Ortak helper ekle: 'async function canSendMore(userId, dailyLimit): Promise<boolean>' → o güne ait coaching_messages count >= dailyLimit ise false. Her deterministik insert (snack_hour_nudge, motivation_dip, reengagement vb.) öncesi bu kontrolü çağır. Mevcut trigger-bazlı dedup korunur; üstüne global cap eklenir. dailyLimit zaten tanımlı (ana döngüde okunuyor) — onu döngülerin başına taşı.

```tsx
async function canSendMore(uid, limit){
  const ds=new Date(); ds.setHours(0,0,0,0);
  const {count}=await supabaseAdmin.from('coaching_messages').select('id',{count:'exact',head:true}).eq('user_id',uid).gte('created_at',ds.toISOString());
  return (count??0) < limit;
}
// her insert öncesi: if (!await canSendMore(profile.id, dailyLimit)) continue;
```

**Doğrulama:** q.mjs ile bir kullanıcıya dailyLimit kadar mesaj insert et, sonra ai-proactive'i kk.mjs/cron-sim ile tetikle; ek deterministik nudge eklenmediğini doğrula. tsc.

---

### 🟡 MEDIUM — handleUndo workout kaydını HARD-delete ediyor — is_deleted kolonu var ama kullanılmıyor
- **Dosyalar:** `supabase/functions/shared/repair-handler.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `repair-handler`

**Kök-neden:** repair-handler.ts:184-190 workout undo '.delete()' (HARD); meal 177-182 soft-delete (is_deleted=true + deleted_at). workout_logs'ta is_deleted BOOLEAN DEFAULT FALSE var (mig 002:53, deleted_at yok). Workout fetch (113-119) '.eq(is_deleted,false)' filtresi DE içermiyor → soft-delete'ten sonra bile geri-alınmış kayıt 'son workout' olarak görünebilir. DOĞRULANDI.

**Düzeltme:** 184-190 workout dalını '.update({ is_deleted: true })' yap (deleted_at kolonu yok, eklemezsen sadece is_deleted). Fetch'e (113-119) '.eq('is_deleted', false)' ekle ki soft-delete'li kayıt tekrar undo adayı olmasın. supplement (is_deleted kolonu yok) hard-delete kalabilir.

```tsx
// fetch
.from('workout_logs').select('id, raw_input, logged_at').eq('user_id', userId).eq('is_deleted', false)...
// undo
case 'workout': { const {error}=await supabaseAdmin.from('workout_logs').update({is_deleted:true}).eq('id',target.id); ... }
```

**Doğrulama:** q.mjs: bir workout logla, kk.mjs 'son antrenmanı geri al' → workout_logs satırının silinmediğini, is_deleted=true olduğunu doğrula; ikinci undo'da aynı kaydı tekrar getirmediğini test et. tsc.

---

### 🟡 MEDIUM — Hamilelik kalori ayarı: plan-prompt metni (sabit +300) ile kod-zorlamalı değer (T1:0/T2:+340/T3:+450) çelişiyor
- **Dosyalar:** `supabase/functions/shared/periodic-config.ts`, `supabase/functions/ai-plan/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `periodic-config`

**Kök-neden:** periodic-config.ts:198-203 buildPeriodicPlanContext imzası pregnancy_trimester ALMAZ; 214-216 config.calorieAdjustment'ı basar (pregnancy için sabit 300, satır 103). Oysa getPeriodicCalorieAdjustment (161-174) trimestere göre T1:0/T2:+340/T3:+450 uygular ve ai-plan plana bunu işler. Model prompt'unda +300 derken plana +340/+450 (veya T1'de 0) eklenir. DOĞRULANDI.

**Düzeltme:** buildPeriodicPlanContext imzasına 'pregnancy_trimester?: number|null' ekle (profile'dan zaten var). Kalori satırını pregnancy dalında getPeriodicCalorieAdjustment(state, {pregnancyTrimester}) ile hesapla — config.calorieAdjustment yerine. ai-plan çağrısı zaten profile geçiriyor; trimester'ı buildPeriodicPlanContext'e ilet. Diğer state'lerde config.calorieAdjustment korunur.

```tsx
export function buildPeriodicPlanContext(profile:{ ...; pregnancy_trimester?: number|null }) {
  const adj = getPeriodicCalorieAdjustment(state, { pregnancyTrimester: profile.pregnancy_trimester });
  if (adj !== 0) parts.push(`Kalori: ${adj>0?'+':''}${adj} kcal`);
}
```

**Doğrulama:** Birim/q.mjs: T2 hamile profille plan üret; prompt'ta 'Kalori: +340' (300 değil) göründüğünü ve plana işlenen değerle eşleştiğini doğrula. tsc.

---

### 🔵 LOW — storeMessages ve respond hint-modlarında yanlış task_mode kaydeder/döndürür
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-chat-mode-label`

**Kök-neden:** ai-chat/index.ts:1694 respond'da 'task_mode: taskMode' (detectTaskMode çıktısı); mod talimatları effectiveMode ile hesaplanır. plan_diet/plan_workout/daily_log hint'leri yalnız effectiveMode'a yansır → kaydedilen/dönen task_mode gerçek moddan farklı. storeMessages'a da taskMode geçiliyor. DOĞRULANDI.

**Düzeltme:** storeMessages çağrısı ve respond({task_mode}) değerini effectiveMode'a çevir (en azından hint modlarında). Tek satırlık değişiklik: 'task_mode: effectiveMode'. analitik/QA doğruluğu düzelir, fonksiyonel risk yok.

```tsx
return respond({ ..., task_mode: effectiveMode, ... });
// ve storeMessages(..., effectiveMode, ...)
```

**Doğrulama:** q.mjs: plan_diet hint'li mesaj sonrası chat_messages.task_mode='plan_diet' olduğunu doğrula. tsc.

---

### 🔵 LOW — daily_plans okuyucusu status-filtresiz version desc limit 1 okuyor + legacy daily yazıcı draft yazıyor (latent)
- **Dosyalar:** `src/stores/dashboard.store.ts`, `supabase/functions/ai-plan/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `dashboard-store`

**Kök-neden:** dashboard.store.ts:105-106 daily_plans'ı '.order(version,desc).limit(1)' STATUS FİLTRESİZ okur. Projeksiyon version:1/approved yazar; legacy ai-plan günlük yolu (index.ts:719,740) version=max+1/draft yazar. Legacy yolu çağıran canlı istemci kalmamış → ŞU AN latent. DOĞRULANDI (latent).

**Yeniden değerlendirme:** Latent (canlı tetikleyici yok). Düşük öncelik; tek satır savunma.

**Düzeltme:** Dashboard okuyucusuna '.in('status', ['approved','active'])' filtresi ekle (savunma derinliği). İsteğe bağlı: legacy günlük daily_plans yazımını (ai-plan:719,740) tamamen kaldır (ölü yol). Minimal: yalnız okuyucu filtresi yeterli, latent riski kapatır.

```tsx
.from('daily_plans').select('*').eq('user_id', uid).eq('date', today).in('status',['approved','active']).order('version',{ascending:false}).limit(1)
```

**Doğrulama:** tsc. q.mjs ile aynı güne draft+approved iki satır oluştur; dashboard'ın approved'ı okuduğunu doğrula. preview ile dashboard hedeflerini gözle.

---

### 🔵 LOW — requestMenuModification AI çağrısı başarısız olsa bile modification_request'i kalıcı yazıyor
- **Dosyalar:** `src/services/weekly-plan.service.ts`, `supabase/functions/ai-plan/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `weekly-plan-service`

**Kök-neden:** weekly-plan.service.ts:176-181 önce '.update({modification_request: request})' KOŞULSUZ yazar (176-179), sonra generateWeeklyPlan(request) çağırır. invoke hatasında (155-158) 'Menü oluşturulamıyor' döner ama yazılmış request DB'de kalır; sonraki başarılı regen eski talebi yeniden uygular. DOĞRULANDI.

**Düzeltme:** Sıralamayı değiştir: önce generateWeeklyPlan(request) çağır; başarılı olursa modification_request'i null'a çek (uygulandı), başarısızsa hiç yazma. Mevcut 176-179 koşulsuz update'ini kaldır; ai-plan zaten modification_request'i body'den okuyup uyguluyor (821-824), DB'ye önceden yazmaya gerek yok. Eğer ai-plan DB'den okuyorsa: başarıda null'la, hatada eski değeri geri al.

```tsx
export async function requestMenuModification(planId, request) {
  const res = await generateWeeklyPlan(request);
  if (res.error) return res; // DB'ye yazma
  await supabase.from('weekly_plans').update({ modification_request: null }).eq('id', planId);
  return res;
}
```

**Doğrulama:** kk.mjs: AI'yı düşürüp menü değişiklik talebi gönder; weekly_plans.modification_request'in NULL kaldığını q.mjs ile doğrula. Başarılı akışta talebin uygulanıp null'landığını test et. tsc.

---

### 🔵 LOW — Projeksiyon her zaman mevcut takvim haftasına yazıyor; hafta dönümünde daily_plans yenilenmiyor
- **Dosyalar:** `src/stores/dashboard.store.ts`, `supabase/functions/shared/plan-projection.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `dashboard-store` · **Bağımlı:** [LOW] daily_plans okuyucusu status-filtresiz version desc limit 1 okuyor + legacy daily yazıcı draft yazıyor (latent)

**Kök-neden:** ai-chat/index.ts:1298-1299 projeksiyon weekStart'ı getWeekStart(requestToday) ile mevcut haftaya sabitler; daily_plans yalnız onay haftasına yazılır. ai-proactive yalnız daily_plans okur, re-projeksiyon çağırmaz; dashboard.store.ts:105-106 satır yoksa lazy-fill yapmaz. Hafta dönünce yeni haftaya satır oluşmaz. DOĞRULANDI.

**Yeniden değerlendirme:** Geçerli ama düşük frekanslı (yalnız hafta dönümünde, kullanıcı planı yeniden onaylamazsa). Cron yerine client lazy-fill daha az riskli; aynı dosyaya dokunduğu için status-filtresi bulgusuyla birlikte yapılmalı.

**Düzeltme:** İki seçenek; tercih: dashboard okuyucusuna lazy-fill ekle — daily_plans bu hafta için boşsa, aktif weekly_plans'tan anında re-projecte et (mevcut plan-projection fonksiyonunu bir edge endpoint/RPC üzerinden çağır veya weekly_plans hedeflerinden o günü türet). Daha sağlam: hafta dönümünde aktif weekly_plans'ı re-projecte eden cron (014'e Pazartesi sabahı job). LOW olduğundan minimal: dashboard 'satır yoksa weekly_plans.targets'tan o gün için anlık hedef göster' fallback'i.

```tsx
// dashboard.store: daily_plans boşsa
if (!dailyPlan) {
  const wp = await fetchActiveWeeklyPlan();
  if (wp) dailyPlan = projectDayFromWeekly(wp, today); // client-side lazy fallback
}
```

**Doğrulama:** q.mjs: aktif weekly_plans bırak, mevcut haftaya daily_plans yazma; dashboard'ın hedefleri yine de gösterdiğini preview ile doğrula. tsc.

---

### 🔵 LOW — Plan alerjen filtresi tüm opsiyonları/öğünleri eleyince boş öğün/gün bırakıyor (fallback yok)
- **Dosyalar:** `supabase/functions/ai-plan/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-plan-allergen`

**Kök-neden:** ai-plan/index.ts:662-668 (günlük) ve 837-844 (haftalık) alerjen filtresi bir öğünün tüm opsiyonları (veya günün tüm öğünleri) alerjen içerirse onu BOŞ bırakır; fallback üretimi yok. Boş options[] takip/dashboard akışını bozabilir. DOĞRULANDI.

**Düzeltme:** Filtre bir öğünün TÜM opsiyonlarını eler ve sonuç 0 ise: güvenli alerjensiz varsayılan öğün ekle (ör. sade protein+sebze) VEYA o öğüne 'alerjen nedeniyle çıkarıldı, alternatif öner' notu koy. En azından boş options[] yerine tek güvenli placeholder ekle ki dashboard boş veriyle karşılaşmasın. Tam-yeniden-üretim (LLM'e alerjen-bilinçli re-prompt) L efor olur; LOW için placeholder+not yeterli.

```tsx
if (meal.options.length === 0) {
  meal.options = [{ name: 'Alerjensiz alternatif (koça danış)', calories: meal.target_kcal ?? 0, ... }];
  meal.note = 'Alerjen nedeniyle bazı öğünler çıkarıldı.';
}
```

**Doğrulama:** q.mjs: tüm opsiyonları alerjen içeren bir profil/plan üret; çıktıda hiçbir öğünün boş options[] ile kalmadığını doğrula. tsc.

---

### 🔵 LOW — Periyodik durumun kalori/protein/IF/su ayarlamaları sohbet bağlamına aktarılmıyor
- **Dosyalar:** `supabase/functions/shared/context-builders.ts`, `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `periodic-config` · **Bağımlı:** [MEDIUM] Hamilelik kalori ayarı: plan-prompt metni (sabit +300) ile kod-zorlamalı değer (T1:0/T2:+340/T3:+450) çelişiyor

**Kök-neden:** buildPeriodicPlanContext (somut ayarlamalar) yalnız ai-plan'da kullanılıyor. ai-chat tarafında periyodik durum 'DONEMSEL DURUM: <etiket>' satırı olarak veriliyor (ai-chat:3489 civarı), sayısal ayarlamalar yok; ai-chat buildPeriodicPlanContext'i import etmiyor. system-prompt genel kuralları kısmen telafi ediyor. DOĞRULANDI.

**Düzeltme:** ai-chat bağlam montajında periyodik durum bloğuna buildPeriodicPlanContext(profile) çıktısını (veya IF-uyumu + kalori/protein/su özetini) ekle. periodic-config zaten paylaşımlı; import edip etiketin yanına somut ayarlamaları bas. Hamilelik bulgusuyla bağlantılı (aynı fonksiyon trimester-aware olmalı) — dependsOn olarak işaretlendi.

```tsx
import { buildPeriodicPlanContext } from '../shared/periodic-config.ts';
// DONEMSEL DURUM satırından sonra:
const periodicCtx = buildPeriodicPlanContext(profile);
if (periodicCtx) layer1Parts.push(periodicCtx);
```

**Doğrulama:** kk.mjs: hamile/sakat profille sohbet et; prompt'ta IF-kapalı + kalori/protein/su ayarlamalarının göründüğünü ve koçun IF önermediğini doğrula. tsc.

---

### 🔵 LOW — Prompt-injection deterministik filtresi bazı Türkçe ezme kalıplarını kaçırıyor
- **Dosyalar:** `supabase/functions/shared/guardrails.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `guardrails-injection`

**Kök-neden:** guardrails.ts:438-473 INJECTION_PATTERNS + 483-487 diacritic/apostrof normalizasyonu kapsamlı (forget everything, developer/DAN mode, kural yoksay, sinir kaldir, onceki talimatlari unut mevcut). Kalan boşluklar: 'yok say' (boşluklu — normalize boşluk eklemez, 'yoksay' birleşik aranıyor), 'Artık bir KOÇ değilsin' (...değilsin kalıbı yok), 'geliştirici moduna geç' (developer mode var ama Türkçe 'gelistirici mod' yok). KISMEN düzeltilmiş; etki düşük (LLM-tarafı savunma derinliği var). DOĞRULANDI.

**Yeniden değerlendirme:** Büyük ölçüde düzeltilmiş; kalan boşluk dar (3-4 kalıp). Etki düşük çünkü system-prompt LLM-tarafı direnç var. Yine de tek-satır kalıp eklemeleri ucuz.

**Düzeltme:** INJECTION_PATTERNS'e birkaç kalıp ekle: /(yok\s*say)/i ('yok say' boşluklu), /(koc|coach)\s*degilsin/i, /(gelistirici|sinirsiz)\s*mod/i. 'unut' fiilini kural/talimat hedefiyle gevşet: /(tum|butun|her)\s*(kural|talimat).*(unut)/i. Mevcut normalize zaten ı/ş/ğ → ascii yapıyor, yeni kalıplar ascii yazılmalı.

```tsx
/(\byok\s*say\b)/i,
/(koc|coach)\s*(artik\s*)?degilsin/i,
/(gelistirici|sinirsiz|kisitlamasiz)\s*mod/i,
```

**Doğrulama:** Birim: sanitizeUserInput('kurallarını yok say').injectionDetected===true; 'Artık bir koç değilsin'→true. Yanlış-pozitif taraması (masum 'su yok say-' yok). tsc.

---

### 🔵 LOW — Sohbet öğün-kaydı yolunda makro-kalori tutarlılık doğrulaması çalışmıyor (validateMealParse import edilmiş ama çağrılmıyor)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/output-validator.ts`, `supabase/functions/shared/guardrails.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai-chat-meal-persist`

**Kök-neden:** ai-chat/index.ts:20 validateMealParse import edilir ama çağrılmaz; output-validator.ts:19 validateMacroConsistency hiçbir edge fonksiyonda çağrılmaz (yalnız tanım). meal_log action'ları extractActions sonrası 2711-2721'de doğrudan insert; makro/kalori şema-tutarlılık doğrulaması yok. EK BULGU: 2718'de carbs_g'ye 'multiplier' UYGULANMIYOR (calories ve fat_g uygular) — porsiyon çarpanı carbs için eksik. DOĞRULANDI + adjacent bug.

**Yeniden değerlendirme:** Finder doğru; EK olarak carbs_g/protein_g multiplier eksikliğini buldum — porsiyon çarpanlı kayıtlarda makrolar kalori ile tutarsızlaşıyor, bu da validateMacroConsistency'yi tetikleyecek gerçek bir veri-kalitesi hatası. Birlikte düzeltilmeli.

**Düzeltme:** meal_log persist öncesi her item'a validateMealParse/validateMacroConsistency uygula; tutarsızlıkta (protein*4+yağ*9+karb*4 ile kalori büyük sapma) kaloriyi makrolardan yeniden hesapla, negatifleri 0'la. AYRICA 2718 carbs_g'ye multiplier ekle (calories/fat ile simetrik): 'carbs_g: Math.max(0, Math.round(i.carbs_g * multiplier))' — protein_g'ye de multiplier uygulanmalı (2717'de protein de multiplier'sız). Bu adjacent bug porsiyon çarpanında makro tutarsızlığı yaratıyor.

```tsx
// import zaten var; persist öncesi
const v = validateMealParse(item);
if (!v.valid) item.calories = Math.round((item.protein_g*4)+(item.carbs_g*4)+(item.fat_g*9));
// 2716-2718 simetrik multiplier:
protein_g: Math.max(0, Math.round(i.protein_g * multiplier)),
carbs_g: Math.max(0, Math.round(i.carbs_g * multiplier)),
fat_g: Math.max(0, Math.round(i.fat_g * multiplier)),
```

**Doğrulama:** Birim: tutarsız makro ile item ver, persist sonrası kalori=makro-türevi olduğunu doğrula. q.mjs: 2 porsiyon öğün logla, carbs_g'nin de 2x olduğunu (1x değil) doğrula. tsc.

---

### 🔵 LOW — Inactivity re-engagement döngüsü ile ana-döngü returnFlowInfo aynı cron geçişinde çift geri-dönüş mesajı üretebiliyor
- **Dosyalar:** `supabase/functions/ai-proactive/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-proactive`

**Kök-neden:** ai-proactive/index.ts:426-431 re-engagement döngüsü daysSilent=3/7/30'da reengagement_${tier} insert eder; aynı cron'da ana LLM döngüsü returnFlowInfo (daysSinceChat>=3) besler ve LLM ayrı 'geri dönüş' mesajı üretebilir. Dupe guard içerik ilk 40 char örtüşmedikçe yakalamaz. DOĞRULANDI (dar pencere).

**Düzeltme:** Ana döngüde returnFlowInfo'yu yalnız o gün 'reengagement_' prefix'li mesaj YOKSA besle: insert öncesi/LLM-prompt'a returnFlowInfo eklemeden önce, bugün reengagement_* var mı kontrol et. Alternatif: dupe guard'ı trigger_type prefix ailesi ('reengagement') bazında genişlet. İkincisi daha sağlam.

```tsx
const sentReengage = await hasTriggerToday(uid, 'reengagement'); // prefix LIKE
if (sentReengage) returnFlowInfo = null; // ana döngüye verme
```

**Doğrulama:** q.mjs: daysSilent=3 senaryosu kur, cron-sim ile tek geri-dönüş mesajı üretildiğini (çift değil) doğrula. tsc.

---

### 🔵 LOW — Günlük rapor otomatik tetiği UTC gün sınırını kullanıyor; uzak batı saat dilimlerinde 'dün' yanlış güne denk gelebilir
- **Dosyalar:** `supabase/functions/ai-proactive/index.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai-proactive-report`

**Kök-neden:** ai-proactive/index.ts:68, 1389-1416 günlük rapor auto-trigger server UTC saatini (4-6) ve UTC yesterdayStr'i kullanır; uygulamanın geri kalanı getUserLocalHour ile yerel tz kullanır. UTC-7'de 05:00 UTC önceki günün 22:00'i → yarım gün 'tam gün' sanılır. Hedef kitle TR olduğundan etki sınırlı. DOĞRULANDI.

**Yeniden değerlendirme:** Geçerli ama TR-odaklı kitlede etki çok düşük. getUserLocalHour zaten mevcut olduğundan düzeltme orta-kolay; öncelik düşük.

**Düzeltme:** Tetiği kullanıcı bazında yerel gün sınırına bağla: getUserLocalHour(profile) ~04-06 iken yerel 'dün'ü (day_boundary_hour dahil) hesapla; yesterdayStr'i UTC yerine kullanıcı tz'sinden türet. Mevcut getUserLocalHour helper'ı zaten var (diğer döngüler kullanıyor) — günlük rapor bloğunu da ona bağla.

```tsx
const localHour = getUserLocalHour(profile);
if (localHour >= 4 && localHour <= 6) {
  const yesterdayStr = userLocalYesterday(profile); // tz + boundary
  ...
}
```

**Doğrulama:** q.mjs: home_timezone='America/Los_Angeles' kullanıcı kur; cron-sim farklı UTC saatlerinde çalıştır, rapor 'dün'ünün kullanıcı yerel dününe denk geldiğini doğrula. tsc.

---

### 🔵 LOW — meal_log_items protein_g/carbs_g/fat_g DECIMAL(5,1) sınırına (max 9999.9) karşı clamp edilmiyor
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `ai-chat-meal-persist`

**Kök-neden:** ai-chat/index.ts:2716-2718 calories smallint clamp'li (Math.min(32767,...)) ama protein_g/carbs_g/fat_g yalnız Math.max(0,...) (alt-sınır); üst clamp yok. Şema DECIMAL(5,1) NOT NULL (max 9999.9, mig 002:31-33). 10000+ gram makro → 22003 overflow, tüm item batch reddedilir, parent meal_logs yazılı kaldığından makrosuz boş öğün. Aşırı nadir. DOĞRULANDI (carbs/protein multiplier eksikliği bulgusuyla aynı satırlar — birlikte düzeltilmeli).

**Yeniden değerlendirme:** Aşırı nadir ama düzeltme tek satır ve carbs/protein-multiplier + validateMealParse bulgularıyla aynı satırlarda; üçü tek PR'da birleştirilmeli (aynı batchKey).

**Düzeltme:** calories ile simetrik clamp: protein_g/carbs_g/fat_g'yi Math.min(9999.9, Math.max(0, ...)) ile sınırla. Bu, 'validateMealParse çağrılmıyor + carbs/protein multiplier eksik' bulgusuyla AYNI satırları (2716-2718) değiştirir → aynı batchKey ile tek seferde yapılmalı.

```tsx
protein_g: Math.min(9999.9, Math.max(0, i.protein_g * multiplier)),
carbs_g:   Math.min(9999.9, Math.max(0, i.carbs_g * multiplier)),
fat_g:     Math.min(9999.9, Math.max(0, Math.round(i.fat_g * multiplier))),
```

**Doğrulama:** q.mjs: 10000+ gram makro item logla; insert'in overflow yerine 9999.9 ile başarılı olduğunu doğrula. tsc.

---

### 🔵 LOW — Rate-limit ve effective-date farklı timezone kaynakları kullanıyor (client_timezone rate-limit'e ulaşmıyor)
- **Dosyalar:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/rate-limit.ts`
- **Efor:** Küçük · **Risk:** low · **batch:** `rate-limit-tz`

**Kök-neden:** ai-chat/index.ts:240-243 effectiveToday'i 'client_timezone ?? active_timezone ?? home_timezone' ile hesaplar; checkRateLimit (rate-limit.ts:84-110) yalnız profiles.home_timezone + day_boundary_hour okur (client/active görmez) ve effectiveToday'den ÖNCE (155) çağrılır. Seyahatte/home set değilse 50/200 penceresi öğün gün-sınırından farklı anda sıfırlanır. Çoğu kullanıcıda home=active. DOĞRULANDI (kenar durum).

**Yeniden değerlendirme:** Kenar durum (çoğu kullanıcıda home=active=client). Düzeltme küçük; öncelik düşük.

**Düzeltme:** checkRateLimit imzasına opsiyonel 'effectiveTimezone' parametresi ekle; ai-chat çağrısında 'client_timezone ?? active_timezone ?? home_timezone' geçir. Sıralama sorunu: effectiveTimezone hesabı checkRateLimit'ten önce yapılabilecek hafif bir işlem (body'den client_timezone okumak yeterli), checkRateLimit çağrısını ona göre düzenle. Minimal: en azından active_timezone'u home'a tercih et.

```tsx
const effTz = body.client_timezone ?? profile.active_timezone ?? profile.home_timezone;
await checkRateLimit(userId, { timezone: effTz, dayBoundaryHour });
```

**Doğrulama:** q.mjs: client_timezone'u home'dan farklı kullanıcı kur; rate-limit penceresinin effectiveToday ile aynı anda sıfırlandığını doğrula. tsc.

---

### ⚪ NIT — ai-extractor model/JSON-mode/Vision-maxTokens/cap-DST/extraction pürüzleri (toplu)
- **Dosyalar:** `supabase/functions/ai-extractor/index.ts`, `supabase/functions/shared/model-router.ts`, `supabase/functions/shared/openai.ts`, `supabase/functions/shared/rate-limit.ts`, `supabase/functions/shared/repair-handler.ts`, `supabase/functions/shared/service-contexts.ts`
- **Efor:** Orta · **Risk:** med · **batch:** `ai-extractor` · **Bağımlı:** [MEDIUM] LLM çağrılarında timeout/AbortController yok — askıda kalan sağlayıcı isteği fonksiyonu kilitler

**Kök-neden:** ai-extractor/index.ts:174 model 'gpt-4o-mini' SABİT (KOCHKO_MODEL_FAST yok sayılır), 173-181 response_format ZORLANMAZ (markdown elle soyulur, 193), hata 184 'if(!ok)continue' ile sessiz yutulur. Vision dalı maxTokens=2000 (model-router smart 2500'den düşük). repair-handler confirmation_no 'includes' kullanırken pozitif dal '===/startsWith'; 'sut' (3 harf) substring eşleşmesi. rate-limit cap 'kalan saat' sabit +24h (DST'de sapar, TR DST'siz → etkisiz). _summary_update totalExtracted sayımını şişirir. DOĞRULANDI — hepsi marjinal.

**Yeniden değerlendirme:** Hepsi marjinal/NIT. En değerli adım (a) extractor'ı shared chatCompletion'a taşımak; bu tek hamle model-override + jsonMode + fallback + timeout (MEDIUM uygulanırsa) sorunlarını birden çözer. Diğer alt-maddeler (DST, sut-substring) çok düşük öncelik, isteğe bağlı.

**Düzeltme:** Düşük-öncelikli toplu temizlik: (a) ai-extractor fetch'ini shared chatCompletion(...,{model: Deno.env.get('KOCHKO_MODEL_FAST') ?? 'gpt-4o-mini', jsonMode:true}) ile değiştir — böylece base-URL, fallback, truncation-retry, json-word-injection, AbortController (yukarıdaki MEDIUM uygulanırsa) hepsi ÜCRETSİZ gelir ve 184/193/199 elle-parse + sessiz-yutma kalkar. (b) Vision maxTokens'i 2500-3000'e çıkar; (c) confirmation_no'yu tam-token (split + Set) mantığına çevir, 'sut' eşleşmesini kelime-sınırlı yap; (d) cap gün-sonunu localDayStartIso'dan türet (TR'de kozmetik); (e) _summary_update'i totalExtracted sayımından ayır. En yüksek değerli kısım (a): extractor'ı shared chatCompletion'a taşımak — diğer MEDIUM düzeltmelerini otomatik miras alır.

```tsx
// (a) ai-extractor
import { chatCompletion } from '../shared/openai.ts';
extracted = await chatCompletion<Record<string,unknown>>(
  [{role:'system',content:'...JSON...'},{role:'user',content:EXTRACTION_PROMPT(...)}],
  { model: Deno.env.get('KOCHKO_MODEL_FAST') ?? undefined, temperature:0.1, maxTokens:1000, jsonMode:true }
);
// elle markdown-strip + JSON.parse + if(!ok)continue kalkar
```

**Doğrulama:** deno check. KOCHKO_MODEL_FAST set edip extractor cron'unu kk.mjs/cron-sim ile çalıştır, override modelin kullanıldığını ve JSON parse hatasının kalktığını log ile doğrula. confirmation_no için birim: 'sütlü' yanlış-'hayır' eşleşmemeli.

---

### 🧹 Toplu Süpürmeler — AI Mimarisi

**L2 bellek yazımlarını atomik ai_summary_merge yoluna birleştir** _(efor: Orta)_
- Dosyalar: `supabase/functions/ai-extractor/index.ts`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/shared/memory.ts`
- Layer-2 (ai_summary) skalar/metin alanları iki ayrı yoldan yazılıyor: bir kısmı atomik ai_summary_merge RPC (FOR UPDATE kilitli, mig 015), bir kısmı düz .upsert/.update ile kilidi bypass ediyor → lost-update riski + tutarsız cap. Tüm doğrudan L2 yazımlarını (ai-extractor general_summary upsert'ü, ai-chat updateCheckpoint, evolvePatternConfidence doğrudan .update'i) tek atomik merge yoluna taşı; metin alanlarına tutarlı 3000-char cap uygula.
- **Yaklaşım:** ai-extractor:255-258 general_summary upsert'ünü rpc('ai_summary_merge') ile değiştir; ai-chat updateCheckpoint ve evolvePatternConfidence doğrudan-update'lerini merge/kilitli-RPC'ye al; coaching_notes/general_summary yazımlarına ortak 3000-char cap sabiti kullan (extractor zaten kullanıyor). behavioral_patterns için ölü appendBehavioralPatterns RPC'sini kullan (bu HIGH bulgusu kapsam dışı ama aynı yol). Mig gerekirse 051'de merge'e general_summary append+cap dalı eklenebilir.

**ai-extractor'ı shared chatCompletion'a taşı (model-override + jsonMode + fallback + timeout miras)** _(efor: Orta)_
- Dosyalar: `supabase/functions/ai-extractor/index.ts`, `supabase/functions/shared/openai.ts`, `supabase/functions/shared/model-router.ts`
- ai-extractor kendi ham fetch'ini kullanıyor: model 'gpt-4o-mini' sabit, response_format zorlanmaz, markdown elle soyulur, hata sessiz yutulur, AbortController yok, base-URL kullansa da fallback/truncation-retry yok. Bu yol shared/openai.ts chatCompletion'a taşınırsa tüm bu davranışları (KOCHKO_MODEL_FAST override, jsonMode, fallback model, truncation-retry, json-word-injection, AbortController eklendiğinde timeout) tek hamlede miras alır.
- **Yaklaşım:** ai-extractor:167-197 ham fetch + elle parse bloğunu chatCompletion<Record<string,unknown>>(messages, {model: KOCHKO_MODEL_FAST, temperature:0.1, maxTokens:1000, jsonMode:true}) ile değiştir; if(!ok)continue ve markdown-strip kodunu kaldır (chatCompletion içeride yapıyor). Vision dalı için maxTokens'i 2500-3000'e çıkar.

**Deterministik metni etkileyen guardrail kalıplarını (sanitize + injection) düzelt** _(efor: Orta)_
- Dosyalar: `supabase/functions/shared/guardrails.ts`
- İki ayrı guardrails.ts kusuru aynı dosyada, mekanik düzeltme: (1) sanitizeText FORBIDDEN_PHRASES'i kelime-sınırsız replace ediyor → masum kelimeleri ('kilacı','ilaçsız') mangle ediyor; (2) sanitizeUserInput INJECTION_PATTERNS birkaç Türkçe ezme kalıbını ('yok say' boşluklu, '...değilsin', 'gelistirici mod') kaçırıyor. İkisi de aynı dosyada, birlikte yapılabilir.
- **Yaklaşım:** sanitizeText'i kelime-sınırlı (ASCII-olmayan-harf-aware) regex'e çevir veya kısa tokenları bağlamsal kalıba bağla; INJECTION_PATTERNS'e 3-4 ek kalıp ekle (ascii-normalize'a uygun). Birim testlerle yanlış-pozitif/negatif kontrolü.

---
