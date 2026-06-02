# KOCHKO — BİTİRME PLANI v2 (Doğrulanmış)

> **Bu doküman, `bitirme.md` / `plan.md` / `final.md` / `final2.md`'nin yerine geçer.**
> Onlar migration ~010'a kadar olan koda bakıyordu ve "her şey tamam" diyordu — yanlış.
> Bu plan, **güncel koda** (migration 035, yeni edge function'lar, son "audit fixes" commit'leri) karşı
> 12 alan + düşmanca doğrulama ile yeniden denetlenip üretildi. 13 ajan / ~1.5M token / 66 doğrulanmış açık kalem.
>
> Tarih: 2026-05-30 · Toplam tahmini iş: **~1.086 satır** (sıfırdan değil; çoğu 1-30 satırlık düzeltme/wiring)

---

## 1. Uygulamanın Amacı

**KOCHKO** — AI-öncelikli kişisel yaşam tarzı koçu (React Native/Expo + Supabase, TypeScript). Beslenme, antrenman ve yaşam tarzını **kategori formlarıyla değil, sohbetle** yönetir. Farkı: **4 katmanlı hafıza** (L1 sabit profil · L2 AI özeti · L3 son 7-14 gün · L4 sohbet) — her şeyi hatırlar, her konuşmadan öğrenir, planı sürekli revize eder.

## 2. Gerçek Durum: ~%80-85 tamam

Sağlam ve doğrulanmış olan (yeniden yazılmayacak):
- 4 katmanlı hafıza/öğrenme döngüsü, 11 sunucu-taraflı `service-contexts`
- Guardrail paketi (rate-limit, prompt injection, alerjen/kalori/sakatlık zorlaması)
- KVKK/gizlilik pipeline, TDEE motoru, zengin sohbet render, dönemsel/döngü/alışkanlık mantığı
- **Yeni `plan_snapshot` taslak→onayla→revize yaşam döngüsü** (spec'ten daha ileri mimari)
- `tsc --noEmit` **sıfır hatayla** geçiyor

Kalan iş **greenfield değil, "son kilometre" hataları.** Üç tıkanma kümesi:
1. **`user_id` eksik client insert'leri** — NOT NULL + RLS yüzünden sessizce başarısız (favori öğün, supplement, CSV import).
2. **Edge function ↔ gerçek şema kayması** — yanlış kolon/tablo isimleri (coaching_messages, strength_sets, reports, goals).
3. **2 syntax/load hatası** — `ai-plan` edge function hiç boot etmiyor.

---

## P0 — SHIP BLOCKERS (önce bunlar; çoğu 1-45 satır)

> **DURUM (2026-05-30): 14/14 P0 halledildi.** 12 tam düzeltildi; 2 (#7, #13/household+coach) ship için
> gate'lendi (crash durduruldu; doğru uzlaştırma P3'e ertelendi). Client `tsc --noEmit` sıfır hata.
> Edge function'lar (Deno) yerel tip-kontrol dışı — final review workflow'da doğrulanacak.
> Bonus: `createTemplate` de `user_id` eksiğiyle kırıktı (audit atlamış), düzeltildi; migration `036` eklendi.

Her biri gerçek bir kullanıcı akışını veya bütün bir edge function'ı öldürüyor. Sıra önemlidir (bağımlılıklar var).

| # | Blocker | Dosya(lar) | Düzeltme | ~Satır |
|---|---------|-----------|----------|--------|
| 1 | **`ai-plan` çift `const yesterday` → modül boot etmiyor.** TÜM günlük+haftalık plan üretimi 500 veriyor, dashboard `daily_plans` verisi de aç kalıyor. Repodaki en yüksek kaldıraçlı tek düzeltme. | `ai-plan/index.ts:115` & `:247` | İkinci `yesterday`'i yeniden adlandır (`yesterdayForSleep`) veya tek bir const'a çıkar. | 1 |
| 2 | **Plan-oluşturma sohbeti `<plan_snapshot>` üretmiyor.** `plan_diet/plan_workout/daily_log` mod prompt'ları dead-code; `detectTaskMode` bunları asla döndüremiyor, `task_mode_hint` prompt seçiminde kullanılmıyor. AI plan-müzakere özelliği chat yolundan **tamamen çalışmıyor.** | `ai-chat/index.ts:153,163`; `task-modes.ts:294,369,393`; `chat.service.ts:46`; `app/plan/diet.tsx:124` | `task_mode_hint` Phase modlarındaysa onu (detectTaskMode yerine) kullanıp `getModeInstructions`'a ver. | 12 |
| 3 | **`coaching_messages` baştan sona kırık.** ~15 yeni `ai-proactive` insert'i yanlış kolon (`trigger`/`message`) + NOT NULL `content`/`trigger_type` eksik → satır hiç yazılmıyor. Client okuma da phantom `message`/`is_read` sorguluyor → `[]`. Bütün proaktif-koç yüzeyi ölü. | `ai-proactive/index.ts` (114,163,231,287,338,399,473,510,567,589,627,670,711,763); `coaching-messages.service.ts:25,27,44`; `CoachingNudge.tsx:53`; `(tabs)/index.tsx:253` | Insert'lerde `trigger→trigger_type`, `message→content`; client'ta `message→content`, `is_read→read`. Eski doğru insert'leri (925/987/1274/1374/1536) örnek al. | 38 |
| 4 | **Favori öğün kaydı hep başarısız** (`meal_logs` insert'inde `user_id` yok; NOT NULL + RLS). Tek-dokunuş favori %100 kırık. | `templates.service.ts:62` | `auth.getUser()` ile `user_id` ekle. | 4 |
| 5 | **Supplement kaydı sessizce başarısız** (`supplement_logs` insert'inde `user_id` yok; hata yutuluyor). | `supplements.service.ts:31` | `user_id` ekle + insert hatasını çağırana döndür. | 4 |
| 6 | **CSV import'un tamamı başarısız** (meal_logs + daily_metrics, `user_id` yok). | `import.service.ts:39,85` | İki payload'a da `user_id` ekle. | 6 |
| 7 | **`weekly_plans` ON CONFLICT çakışması** — mig 030 unique key'i DROP etmiş ama `generateWeeklyPlan` hâlâ `onConflict:'user_id,week_start'` (42P10). Ayrıca `getCurrentWeeklyPlan` çok-satır (PGRST116). Legacy weekly-menu + meal-prep ekranlarını kırıyor. | `mig 030:47`; `ai-plan/index.ts:803`; `weekly-plan.service.ts:35` | Legacy menüye `plan_type`/`status` ver, mevcut partial unique index'e göre upsert; `getCurrentWeeklyPlan`'a `plan_type+status` filtresi + `limit(1)`. | 25 |
| 8 | **`ai-plan` progresif yüklenme sorgusu 3 olmayan `strength_sets` kolonu kullanıyor** (`user_id`/`exercise`/`logged_at`) → her plan üretiminde 400. | `ai-plan/index.ts:191`; `mig 002:60` | `strength_sets`'i `workout_logs`'a join'le; `exercise_name`/`reps`/`created_at` kullan. | 8 |
| 9 | **Mini-Cut + goal_suggestion, aktifi deaktive etmeden `is_active` goal insert ediyor** → mig 033 tekil-aktif unique index (23505). Ayrıca goal_suggestion Türkçe enum (`kas_kazanim`) kullanıyor, DB `gain_muscle` bekliyor. | `progress.tsx:132`; `ai-chat/index.ts:1948` | Insert öncesi `update goals set is_active=false ...`; gType'ı DB enum'una map'le. `set_goal` (ai-chat:1545) doğru örnek. | 14 |
| 10 | **Aylık rapor hiç kalıcı olmuyor** — `trend_direction` CHECK sadece `losing/gaining/stable/fluctuating`, AI `yukselis/dusus/stabil` yazıyor; upsert hatası yutuluyor, her ziyaret AI'ı yeniden çağırıyor. | `mig 004:139`; `ai-report/index.ts:62,350`; `monthly.tsx:19` | Upsert öncesi Türkçe→enum map (UI'da geri çevir) **veya** CHECK'i Türkçeye migrate et. Tek doğruluk kaynağı seç. | 6 |
| 11 | **All-time rapor olmayan `report_date` kolonu sorguluyor** → uyum hep %0. (Gerçek kolon: `date`.) | `all-time.tsx:42,46,58` | `report_date`→`date`. | 3 |
| 12 | **`analytics.service` phantom kolonlar** (`daily_metrics.log_date/streak_days`, `meal_log_items.user_id/log_date`) — Progress tab'ında canlı, 42703. | `analytics.service.ts:97,190,205`; `progress.tsx:13` | `daily_metrics.date` kullan; `meal_log_items`'ı `meal_log_id` ile join'le; phantom `user_id` filtresini kaldır. | 12 |
| 13 | **`household.service` 3 olmayan tablo sorguluyor** (`households`, `household_members`, `weekly_plan_shopping`); **`coach-mode.service` `coach_consents`+`profiles.coach_id` (yok)**. "Aile Planı" ve "Koç Paylaşımı" ekranları açılışta crash. | `household.service.ts:61,73,268`; `coach-mode.service.ts:62,103,148`; `settings/index.tsx:81,82` | **Ship için:** iki settings girişini feature-flag/kaldır (crash etmesin). **Ship sonrası:** tabloları + RLS'i migration'la kur. | 60 |
| 14 | **`getEffectiveDate` UTC/local gün-sınırı off-by-one** — UTC+ kullanıcının gece geç kaydı yanlış güne düşüyor (streak/bütçe/IF etkilenir). | `day-boundary.ts:13` | Sınır saatini ve dönen takvim tarihini aynı (kullanıcı/ev) timezone'unda hesapla. | 12 |

**P0 toplam ≈ 205 satır.** — ✅ **HEPSİ TAMAM (2026-05-30).**

> **P1-P4 İLERLEME (2026-05-30, solo, client tsc-green):**
> - **P1 (6/10):** ✅ #2 tarif favori/use-count · #4 addPhase start_weight/weekly_rate · #8 paylaşım kartı · #9 bildirim sessiz saat · #10 ingredient-match. ⏸ #7 (gerekçeyle ertelendi — audit önerisi tekrarlayan-scheduler'a uymaz). 🔲 Kalan: #1 openCamera · #3 KVKK foto temizleme · #5 ConfidenceBadge (cross-layer) · #6 UndoTimer.
> - **P2 (2/5):** ✅ client_timezone · disliked_foods merge. 🔲 Kalan: pregnancy trimester UI · simulation server-validation · stres-yeme korelasyonu.
> - **P3 (2/9):** ✅ monthly Kilo Trendi (daily_metrics'ten) · bildirim daily-limit/quiet-hours persist. ⏸ meal-prep + legacy weekly-menu (P0#7 ile gate'lendi). 🔲 Kalan: dashboard bütçe barı · muscle_soreness log UI · /settings/day-boundary ekranı · challenge ilerleme (cron) · exercise_name normalize.
> - **P4 (5/12):** ✅ ai-proactive achievements kolonu · overload notifier kullanıcı-bazlı · isQuietHour duplicate dedup + timezone · reverse-diet tek-kaynak. ⏸ mig 006 no-op (uygulanmış migration, checksum riski — atlandı). 🔲 Kalan: 'pr' achievement (çok-parçalı) · orphan servis/bileşen silme · ölü helper temizliği · app/weekly-menu.tsx duplicate · subscriptions okuma-yolu birleştirme.
>
> Kalan ~11 kalem taze bir oturumda (daha iyi bağlam) bu punch-list'le yapılmalı.
>
> **REVIEW WORKFLOW (6 ajan) DOĞRULADI:** 5 alandan **4'ü tertemiz**; tüm kolon-yeniden-adlandırmaları (trigger→trigger_type, message→content, is_read→read, strength_sets join, report_date→date, monthly trend Türkçe) tutarlı. Bulunan 2 kusur **düzeltildi**: (1) `ai-report` all-time raporu `strength_sets`'i phantom `user_id`/`logged_for_date` ile sorguluyordu → 500 (önceden vardı, P0#8 ile aynı sınıf; ölü sorgu kaldırıldı); (2) `monthly.tsx` phantom `weight_end` hücresi kaldırıldı. Client `tsc --noEmit` sıfır hata.

---

## P1 — Dead-code Wiring (yazılmış ama bağlanmamış; en yüksek etki/efor)

| Kalem | Dosya | Aksiyon | ~Satır |
|-------|-------|---------|--------|
| `openCamera` deep-link bağla | `chat/[sessionId].tsx:233`; `(tabs)/chat.tsx:55`; `log.tsx:89` | Quick Log "Fotoğraf çek" mount'ta `takePhoto` çağırsın. | 8 |
| Tarif favori + use-count döngüsü | `recipes.service.ts:151,167`; `recipe.tsx`; `settings/recipes.tsx` | Favori toggle + `incrementUseCount`; ai-plan'ın saved-recipes tercihi eşleşsin. | 20 |
| KVKK foto 24s auto-cleanup + `scheduled_cleanups` NOT NULL | `privacy.service.ts:176`; `audit-log.service.ts:81`; `mig 022:9` | `cleanup_type`+`target_table` ver; `schedulePhotoCleanup`'ı upload akışından çağır. | 15 |
| `start_weight_kg` + doğru `weekly_rate` (addPhase) | `goals.service.ts:57`; `goal-progress.ts:69` | Hedef oluşturmada start_weight = mevcut kilo; weekly_rate'i hedef/hafta'dan hesapla (0.5 hardcode değil). | 11 |
| Düşük-güven `ConfidenceBadge` render | `RichMessage.tsx:191`; `chat.service.ts` | Server confidence'ı UI'a taşı, badge göster (spec 3.3). | 30 |
| 10s `UndoTimer` (kayıttan sonra) | `UndoTimer.tsx`; `(tabs)/index.tsx:314` | Log sonrası mount; mevcut soft-delete'i kullan (spec 2.14). | 25 |
| Bildirim önceliklendirme + bundling | `notification-intelligence.service.ts:53,108`; `notifications.service.ts:11` | `scheduleLocalNotifications` içinde `prioritize/bundle` çağır — çok yerine tek nudge. | 40 |
| Görsel milestone paylaşım kartı | `share-card.service.ts:31`; `achievements.tsx:47` | Düz metin yerine `generateMilestoneCard` (1080x1920). | 8 |
| Sessiz saatleri yerel bildirimlere uygula | `notifications.service.ts:378,156` | `isQuietHour()` ile water/night_risk/bedtime'ı bastır/kaydır. | 15 |
| "Elimde şunlar var" tarif modu | `recipes.service.ts:100` | `getRecipesByIngredients`'ı chat action'ı/ekran girişiyle yüzeye çıkar (spec 7.7). | 25 |

**P1 toplam ≈ 197 satır.**

---

## P2 — AI Zeka Tamamlama (koçluk kalitesi)

| Kalem | Dosya | Aksiyon | ~Satır |
|-------|-------|---------|--------|
| Plan müzakeresinden `disliked_foods` yaz | `ai-chat/index.ts:1479`; `task-modes.ts:343` | `executeActions` profile_update'ı reddedilen yemeği `food_preferences`'a yazsın (P0#2'ye bağlı). | 18 |
| Chat'ten `client_timezone` gönder | `chat.service.ts:178,447,209` | Tüm `invokeChat` body'lerine ekle → travel/jet-lag modu aktifleşsin (server zaten okuyor). | 6 |
| Hamilelik trimester UI'ı | `settings/periodic-state.tsx`; `ai-plan/index.ts:134` | `pregnancy_trimester` input → T2/T3 kalori artışları null fallback'e düşmesin. | 25 |
| Simülasyon aritmetiğini server-side doğrula | `simulation.ts:21`; `task-modes.ts:213`; `chat/[sessionId].tsx:83` | `<simulation>` remaining/weeklyImpact'i ham LLM yerine yeniden hesapla/clamp'le. | 30 |
| Stres→aşırı yeme korelasyon analizi → L2 | `service-contexts.ts:388`; `memory.ts:548` | Kafein-uyku'ya paralel adanmış stres-yeme insight'ı ekle. | 35 |

**P2 toplam ≈ 114 satır.**

---

## P3 — UI Tamamlama (yanlış/donuk render)

| Kalem | Dosya | Aksiyon | ~Satır |
|-------|-------|---------|--------|
| Dashboard haftalık-bütçe barı (donuk/karışık taban) | `(tabs)/index.tsx:123,272`; `ai-plan/index.ts:660`; `dashboard.store.ts:91` | Tüketileni gerçek loglanan kaloriden, tek kanonik bütçeye (`profiles.weekly_calorie_budget`) karşı hesapla. | 25 |
| Aylık "Kilo Trendi" yanlış tablo | `monthly.tsx:99,241` | `weight_start/end`'i `monthly_reports`'tan oku (mig 011), ai-report'ta doldur. | 8 |
| `muscle_soreness/recovery_score` log UI + yazma | `RecoveryInput.tsx`; `log.tsx`; `ai-proactive/index.ts:1131` | RecoveryInput'u `log.tsx`'e bağla + persist et → soreness nudge tetiklensin. | 40 |
| `/settings/day-boundary` ekranı | `(tabs)/profile.tsx:93` | Eksik route'u oluştur (`day_boundary_hour`) veya satırı kaldır; şu an 404. | 60 |
| Challenge ilerleme takibi + tamamlama | `challenges.service.ts:49`; `settings/challenges.tsx:75` | Günlük evaluator (cron/edge) `progress`'i ilerletip `status='completed'` yapsın. | 60 |
| Meal-prep doğru şekle bağla | `meal-prep.service.ts:105`; `settings/meal-prep-plan.tsx:32` | ai-chat objesini MealPrepPlan'a cast etme; ya local engine'i çağır ya AI çıktısını dönüştür. | 60 |
| Legacy weekly-menu şekil uyumsuzluğu | `ai-plan/index.ts:73`; `weekly-plan.service.ts:18`; `settings/weekly-menu.tsx:65` | AI çıktısı ↔ UI arayüzü arası transform katmanı. | 30 |
| Bildirim günlük-limit + sessiz saat persist | `settings/notifications.tsx:70,84` | Chip/input değişiminde `updateNotificationPrefs` çağır (toggleType paritesi). | 10 |
| Çok-kelimeli hareket `exercise_name` tutarlılığı | `ai-chat/index.ts:1586`; `system-prompt.ts:89`; `strength.tsx:9` | Yazmada snake_case canonical veya okumada normalize et. | 15 |

**P3 toplam ≈ 308 satır.**

---

## P4 — Bildirim + Migration + Temizlik

| Kalem | Dosya | Aksiyon | ~Satır |
|-------|-------|---------|--------|
| ai-proactive overload notifier'ı kullanıcı-bazlı yap | `ai-proactive/index.ts:722` | `strength_sets`'i `workout_logs`'a join'leyip `profile.id` filtrele (global son set değil). | 20 |
| `isQuietHour` çift tanım + arity/timezone | `ai-proactive/index.ts:1618,1644,1284` | Duplicate'i sil; 3-arg (kullanıcı yerel saati) versiyonu kalsın. | 8 |
| Re-engagement achievements kolonu | `ai-proactive/index.ts:392` | `type`→`achievement_type`. | 1 |
| Reverse-diet çift-yazıcı | `maintenance.service.ts:136`; `ai-proactive/index.ts:1546` | Tek doğruluk kaynağı seç (haftalık +125 iki kez sayılmasın). | 20 |
| 'pr' kişisel rekor achievement'ı | `achievements.service.ts:60`; `achievements.tsx:11` | PR tespit et (is_pr/1RM) → `achievement_type='pr'` insert. | 15 |
| Mig 006 ölü integer kolonları | `mig 006:19`; `mig 002:89` | Yanıltıcı no-op ADD COLUMN'ları kaldır (canlı tip 002'den TEXT). | 3 |
| Orphan client servisleri sil | `recovery/mvd/predictive/sleep-analysis/adaptive-difficulty/caffeine/travel/eating-out/progressive-disclosure/habits.service.ts`, `weekly-budget.ts`, `simulation.ts` | İmport edilmeyen kopyalar (özellikler `service-contexts`'ten geliyor); önce korunacak verileri (fast-food kcal, sosyal-baskı scriptleri, kafein matematiği) server'a taşı. | 30 |
| Orphan UI bileşenleri sil | 16 bileşen (WaterTracker, SleepInput, MoodTracker, StepCounter, SupplementQuickAdd, IFTimerWidget, ChallengeWidget, WeeklyBudgetWidget, CalorieProgress, WidgetPreview, DayTargets, MealOptionCard, WorkoutCard, SmartActions, GradientCard, ProfileCompletion) | 0-import; özellikler `log.tsx`/AI chat'te inline. (UndoTimer/ConfidenceBadge/RecoveryInput'u P1/P3 kabul edilirse tut.) | 0 |
| Kalan ölü goal/maintenance helper'ları | `goals.service.ts:275`; `maintenance.service.ts:212,231`; `goal-progress.ts:147` | `integrateWithPlateau`/`generateReinforcementMessage`/`getRetentionStrategy`/`calculateRequiredDeficit` sil. | 4 |
| Erişilemez `app/weekly-menu.tsx` duplicate'i | `app/weekly-menu.tsx`; `app/_layout.tsx:74` | Route'la ya da sil + Stack.Screen kaydını kaldır (canlı olan settings/weekly-menu). | 5 |
| Premium okuma yolu parçalanması (3 kaynak) | `usePremium.ts:23`; `premium-gate.ts:71`; `subscription.service.ts:32` | Tek doğruluk kaynağına indir (server `profiles.premium` + subscriptions). | 30 |

**P4 toplam ≈ 169 satır.**

---

## Native'e Ertelenenler (kod değil, harici bağımlılık)

- **Gerçek IAP / RevenueCat satın alma** — native App Store/Play build + RevenueCat SDK + store ürünleri gerekli. (Şu an `premium.tsx` dev-mode write yapıyor.)
- **Trial subscription satırı (sunucu-yetkili)** — `subscriptions` SELECT-only RLS; trial satırı webhook/server function ile yazılmalı.
- **Push bildirim teslimi (FCM/APNs)** — sunucu Expo push var ama gerçek teslim prod push credential + imzalı native build ister.
- **GS1 Türkiye / topluluk barkod** — şu an OpenFoodFacts fallback; tam Türk ürün kapsamı GS1 veri kaynağı + kullanıcı tabanı ister.
- **Wearable (Apple Health / Google Fit)** — `steps_source` alanları var ama native HealthKit/Google Fit entegrasyonu device API + native build ister.

---

## Definition of Done (native hariç — bunlar geçince app shippable)

1. `ai-plan` duplicate hatasız boot eder; günlük+haftalık plan üretimi 200 döner ve `daily_plans` yazar.
2. `app/plan/diet.tsx`'ten `[PLAN_INIT]` mesajı `<plan_snapshot>` üretir; taslak satırı oluşur; onayla→aktif→revize uçtan uca çalışır (diyet+antrenman).
3. Proaktif `coaching_messages` satırları kalıcı olur (doğru content/trigger_type/read) ve dashboard `CoachingNudge` onları render eder.
4. Favori öğün, supplement quick-add ve CSV import başarıyla insert eder (user_id var; RLS/NOT NULL hatası yok) ve UI'a yansır.
5. Legacy weekly-menu ve meal-prep ekranları 42P10/PGRST116 olmadan gerçek veriyle yüklenir.
6. `ai-plan` overload + `ai-proactive` notifier `strength_sets`'i doğru (kullanıcı-bazlı, gerçek kolon) sorgular, 400 vermez; çok-kelimeli hareketler eşleşir.
7. Hedef oluşturma (Hedef Ayarları / Mini-Cut / AI goal_suggestion) önceki aktifi deaktive eder (23505 yok), geçerli enum saklar, `start_weight_kg` yazar; GoalProgressWidget gerçek ilerleme gösterir.
8. Aylık rapor kalıcı olur (CHECK geçer), all-time "Ort. Uyum" gerçek % gösterir, Progress-tab metrikleri sıfır değil.
9. Her erişilebilir settings/profil satırı gerçek bir ekrana gider (day-boundary route var veya kaldırıldı); "Aile Planı"/"Koç Paylaşımı" ya çalışır ya gate'lenir (asla "relation does not exist" atmaz).
10. UTC+ kullanıcı için gece geç kayıt doğru takvim gününe düşer.
11. Chat'te "Fotoğraf çek" kamerayı açar; ConfidenceBadge ve 10s UndoTimer kayıttan sonra görünür.
12. Bildirim günlük-limit + sessiz saat persist eder; sessiz saatte yerel bildirim bastırılır; birden çok bildirim varken tek öncelikli nudge atar.
13. Recovery (kas ağrısı) app'ten loglanabilir ve nudge tetiklenebilir; challenge ilerlemesi artıp 'completed'a ulaşır.
14. **`npm run lint` (tsc --noEmit) tüm düzenlemelerden sonra sıfır hata** verir; bundle'da 0-import orphan servis/bileşen kalmaz (veya bilerek bağlanmış).

---

## Önerilen Sıra (sprint, en yüksek kaldıraç önce)

P0'ı `recommendedOrder`'daki sırayla yürüt (1→14), ardından P1, sonra P2/P3 karışık (bağımlılıklara göre), en son P4 temizlik. Tam sıralı liste workflow çıktısında (`recommendedOrder`, 49 kalem).

**İlk üç hamle = en kritik:**
1. `ai-plan` `const yesterday` (1 satır → bütün plan motorunu açar)
2. `task_mode_hint` mod seçimi (12 satır → plan-müzakere özelliğini canlandırır)
3. `coaching_messages` kolon kayması (38 satır → proaktif koçu canlandırır)
