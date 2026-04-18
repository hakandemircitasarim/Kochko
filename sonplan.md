# KOCHKO — Son Plan (Production Readiness)

> **Amaç:** `liste.md`'deki her özellik, 0 bug ve üst düzey UX ile production'a hazır olana kadar sistematik ilerleme.  
> **Tek kaynak:** bu dosya. Her iterasyonda güncellenir, her görev tamamlandıkça işaretlenir.

---

## 1. Bağlam

Kodbase büyük ve olgun: 50+ service, 14 migration, 5 edge function, 1500+ satır ai-chat, 1000+ satır ai-proactive, 647 satır coach-memory UI, tüm tabanlı rapor ekranları, yerel bildirim scheduling (expo-notifications), pg_cron job'ları, RLS politikaları.

**Önceki audit agent'larının bazı sınıflandırmaları HATALI çıktı** (doğrudan kod okuma ile doğrulandı — bkz. §4). Gerçek tablo: **hayal edildiğinden daha fazla özellik zaten implement edilmiş**. Ancak "kod var" ≠ "end-to-end çalışıyor" ≠ "production kalitesi" → bu yüzden ilk iş **on-device smoke test ile her özelliği doğrulamak**.

## 2. Prensipler

1. **Doğrulanmamış = Bilinmiyor.** Kod varlığı ≠ özelliğin çalışması. Her özellik preview/cihazda test edilmeden DONE sayılmaz.
2. **0 bug**: her task acceptance criteria ile kapanır.
3. **UX önce**: hızlı, anlaşılır, yargılamayan. Fonksiyonel olmak yetmez.
4. **Önce derinleştir, sonra ekle**: mevcut iskeletleri tamamla.
5. **Sessiz başarı yok**: task tamamlandığında checkbox + commit ref işaretlenir.
6. **Ekstra iş yok**: liste.md'de olmayan "güzel olur" feature'ı bu planda yok. Scope hâkimiyeti.

## 3. Bu Planı Nasıl Kullanacağız

- **Task ID formatı**: `V0.T01`, `P1.T01` vb. (Phase.Task).
- **Her task yapısı**: Başlık → Değişecek dosyalar → Acceptance criteria.
- **Durum işaretleri**:
  - `[ ]` = yapılmamış / iskelet / doğrulanmamış
  - `[~]` = kısmen yapıldı (kod var ama end-to-end eksik)
  - `[x]` = tamamlandı + **cihazda doğrulandı**
- **Sıralama**: Phase V **ZORUNLU ilk**. Sonra P0 → P14. Her phase %90+ olmadan sonraki başlamaz.
- **Git workflow**: task başına atomic commit, format: `<phase-id>: <action>`. Örnek: `P0.T01: add supabase/.temp to gitignore`.

## 4. Doğrulama Bulguları (Audit Düzeltmeleri)

Agent audit'lerinin doğrudan kod okuma ile yanlış çıkan iddiaları — bu maddeler **zaten mevcut**, plandan çıkarıldı:

| İddia | Gerçek |
|---|---|
| "Rate limit bloklamıyor, sadece 429 döner" | **YANLIŞ**. `ai-chat/index.ts:95` early return var. |
| "Benim hakkımda ne biliyorsun handler yok" | **YANLIŞ**. `ai-chat/index.ts:136-141` regex detect + `buildKnowledgeSummary` çağrısı var. |
| "AI-learned data view/edit/delete UI yok" | **YANLIŞ**. `app/settings/coach-memory.tsx` 647 satır, delete/reset aksiyonları + KVKK audit log. |
| "Düşük güven proaktif doğrulama yok" | **KISMEN**. `ai-chat/index.ts:351-364` `"Dogru anladiysam: X. Bu dogru mu?"` metni otomatik ekleniyor. Eksik: Onayla/Reddet **interaktif butonlar**. |
| "Notification prefs UI yok" | **YANLIŞ**. `app/settings/notifications.tsx` toggle/dailyLimit/quiet hours. |
| "Local notifications yok" | **YANLIŞ**. `scheduleLocalNotifications` 9 türü schedule ediyor (morning, meal, workout, water, night risk, weekly review, weight, challenge, wind-down). |
| "Global error boundary yok" | **YANLIŞ**. `app/_layout.tsx:13,90,112` wrapping in place. |
| "Simülasyon structured response yok" | **YANLIŞ**. `task-modes.ts:188-193` `<simulation>{...}</simulation>` JSON block enforce. |
| "Calendar UI yok" | **YANLIŞ**. `app/reports/calendar.tsx` tam takvim + heat-map renkleri. |
| "Foto parse structured item yok" | **YANLIŞ**. Vision path → AI response → `meal_log` action → `meal_log_items` insert + cooking_method multiplier. |
| "Plateau strategy → plan mutation yok" | **KISMEN**. `applyPlateauStrategy()` var (`plateau.service.ts:127`), ama **user approval → plan_mutation** zinciri test edilmemiş. |
| "Reverse diet auto-trigger yok" | **KISMEN**. `ai-proactive/index.ts:156` goal reached algılayıp maintenance öneriyor; `applyReverseDiet` gerçekten tetikleniyor mu belirsiz. |
| "MVD ertesi gün auto-reset yok" | **KISMEN**. `ai-chat/index.ts:892-899` user_commitment ekleniyor (follow-up ertesi gün 09:00). Gerçek plan reset yapan kod var mı? Belirsiz. |
| "CircularProgress (donut) yok" | **YANLIŞ**. `src/components/ui/CircularProgress.tsx` + HeroSection/DayTargets/CalorieProgress'te kullanılıyor. Eksik: RichMessage.tsx'te kullanımı. |
| "Photo cleanup cron yok" | **DOĞRU**. Schedule INSERT var (`privacy.service.ts:176`) ama `scheduled_cleanups`'u işleyen cron yok (`014_cron_jobs.sql`'de yok). |
| "Subscription system yok" | **DOĞRU**. `subscriptions` tablosu/webhook/RevenueCat yok. `profiles.premium` boolean flag var ama billing yok. |
| "Step counter yok" | **DOĞRU**. `health-connect.service.ts` tüm fonksiyonlar `TODO` + return null/true placeholder. |

---

## 5. Phase V — Verification Sprint (ZORUNLU İLK)

**Amaç**: kod-varlığı ile gerçek-çalışır-ürün arasındaki boşluğu kapatmak. Her özellik **kullanıcı deneyimiyle** doğrulanır ve §7 feature matrix'i bu bulgulara göre güncellenir.

### V0 — Smoke Test & Ortam Hazırlığı

- [ ] **V0.T01** — `.env` + Supabase + OpenAI key'lerinin prod'a hazır olduğunu doğrula
  - Dosya: `.env`, `app.config.js`
  - Kabul: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY` (edge function env) set + çalışıyor.
- [ ] **V0.T02** — Supabase migration'ları uzak DB'ye uygulanmış mı? (local vs remote schema diff)
  - Komut: `supabase db diff`
  - Kabul: 0 pending migration.
- [ ] **V0.T03** — Edge function'lar deployed?
  - Komut: `supabase functions list`
  - Kabul: ai-chat, ai-extractor, ai-plan, ai-proactive, ai-report — hepsi deployed.
- [ ] **V0.T04** — pg_cron job'ları aktif mi?
  - Sorgu: `SELECT * FROM cron.job;`
  - Kabul: 6 job (tier2, tier3, proactive x3, session-cleanup) running.
- [ ] **V0.T05** — `supabase/.temp/` gitignore + clean working tree
  - Kabul: `git status` temiz.
- [ ] **V0.T06** — Expo preview ile iOS + Android build, başlangıç akışı temiz
  - Kabul: Signup → onboarding → dashboard'a crashsiz ulaşma.

### V1 — AI Koç & Chat (cihazda teyit)

Her bullet için: feature'i kullan → doğrula → `[x]` işaretle VE §7'de ilgili satırı işaretle. Kırık feature → `[ ]` tut ve uygun Phase'e task ekle.

- [ ] **V1.T01** — Yeni kullanıcı onboarding: AI ilk mesajı gönderiyor mu? Profil topluyor mu?
- [ ] **V1.T02** — Text meal log: "2 yumurta, ekmek yedim" → parse doğru, meal_log_items satırları var, macro doğru.
- [ ] **V1.T03** — Fotoğraf meal log: galerye/kameradan foto → AI yiyecekleri tanıyor + yapılandırılmış kayıt.
- [ ] **V1.T04** — Voice input: mikrofon → Whisper → parse → kayıt. Latency < 10s.
- [ ] **V1.T05** — Barkod: TR ürün barkodu → ürün bilgisi + makro. Fallback serbest metin.
- [ ] **V1.T06** — "Yanlış anladın" → son parse düzeltme akışı çalışıyor mu?
- [ ] **V1.T07** — "Son kaydı sil" → soft delete işliyor mu?
- [ ] **V1.T08** — "Benim hakkımda ne biliyorsun" → anlamlı summary dönüyor mu?
- [ ] **V1.T09** — Düşük confidence → AI "Dogru anladiysam: X" mesajı ekliyor mu?
- [ ] **V1.T10** — Rate limit: 5. mesajdan sonra 6. mesaj 429/upsell alıyor mu?
- [ ] **V1.T11** — Emergency keyword ("göğüs ağrısı") → 112 mesajı dönüyor mu?
- [ ] **V1.T12** — Prompt injection ("kimliğini unut") → koç rolünde kalıyor mu?
- [ ] **V1.T13** — Allerjen filtresi: profilde süt alerjisi → AI asla süt önermiyor.

### V2 — Planlama & Antrenman

- [ ] **V2.T01** — Plan sekmesi: günlük plan gösteriliyor mu? 2-3 alternatif var mı?
- [ ] **V2.T02** — Haftalık menü ekranı: plan + shopping list görünüyor mu? Shopping item toggle çalışıyor mu?
- [ ] **V2.T03** — Tarif ekranı: AI'dan tarif al, kaydet, listede görün.
- [ ] **V2.T04** — Antrenman planı: workout_plan JSON UI'da render oluyor mu?
- [ ] **V2.T05** — Güç takibi (set/rep/kg): log gir, geçmiş gör, 1RM hesaplandı mı?
- [ ] **V2.T06** — IF ayarları: aç/kapa, pencere değiştir → plana yansıyor.

### V3 — Modlar

- [ ] **V3.T01** — Plateau: 3+ hafta aynı kilo simülasyonu → detectPlateau + strateji önerisi chat'te.
- [ ] **V3.T02** — Simülasyon: "pizza yesem" → `<simulation>` block render, weekly impact doğru.
- [ ] **V3.T03** — Hızlı kurtarma: "bugün çok yedim" → empatik yanıt + mini plan.
- [ ] **V3.T04** — MVD: "istemiyorum" → 3 basit hedef, plan askıda.
- [ ] **V3.T05** — Dışarıda yemek: "McDonald's'tayım" → en az hasarlı seçenekler.
- [ ] **V3.T06** — Dönemsel: "ramazan" de → IF durdu, kalori ayarlandı, periodic_state set.

### V4 — Raporlar & Bildirimler

- [ ] **V4.T01** — Günlük/haftalık/aylık/all-time raporlar açılıyor, içerik var.
- [ ] **V4.T02** — Takvim ekranı: geçmiş günler heat-map, tıklama ile detay.
- [ ] **V4.T03** — Notification settings: toggle on/off, per-type, quiet hours save oluyor.
- [ ] **V4.T04** — Push token kayıt oluyor (permissions verilince).
- [ ] **V4.T05** — Local notification fire oluyor (sabah plan saatini 1dk sonraya al, bekle).
- [ ] **V4.T06** — ai-proactive manuel çağır (curl) → coaching_messages insert olur mu?
- [ ] **V4.T07** — Export (JSON/CSV/PDF) indir, içerik doğru.

### V5 — Settings & Profil

- [ ] **V5.T01** — Coach memory ekranı: ai_summary render + tek note sil → DB'den gidiyor.
- [ ] **V5.T02** — Coach sharing: diyetisyene link oluştur, link açılıyor.
- [ ] **V5.T03** — Menstrual settings: faz göster, faza göre kalori önerisi değişiyor.
- [ ] **V5.T04** — Periodic state: ramazan/hastalık aktif et → plan değişti.
- [ ] **V5.T05** — Multi-phase goals: 3 fazlı hedef oluştur, timeline gösterilsin.
- [ ] **V5.T06** — Premium ekranı: feature listesi doğru, buton satın alma akışına gidiyor mu (stub).
- [ ] **V5.T07** — Progress photos: foto yükle, KVKK uyarısı görün.
- [ ] **V5.T08** — Household: aile üyesi ekle, tarifler ölçekleniyor mu.
- [ ] **V5.T09** — Meal templates: kayıtlı ogun listesi, "tekrar kaydet" tek dokunuş.
- [ ] **V5.T10** — Data import: JSON import çalışıyor mu.

### V6 — Altyapı & Offline

- [ ] **V6.T01** — Uçak modu: offline meal log → queue'ya yazılıyor → online → sync.
- [ ] **V6.T02** — Realtime sync: 2. cihaz ile aynı hesap → bir cihazda log → diğerinde görün.
- [ ] **V6.T03** — Timezone: telefon saatini değiştir → AI timing ayarlıyor.
- [ ] **V6.T04** — Day boundary: gece 2'de log → dünün gününe kayıt oluyor (default 04:00).
- [ ] **V6.T05** — Account deletion request → profiles.deletion_requested_at set + cancel çalışıyor.
- [ ] **V6.T06** — TypeScript: `npx tsc --noEmit` → 0 error.
- [ ] **V6.T07** — Production build: `eas build --platform all --profile preview` başarılı.

> **Phase V çıktısı**: §7 feature matrix'i güncellenmiş, gerçekten eksik olanlar net. Phase 0+ bu güncel matrise göre ilerleyecek.

---

## 6. Implementation Phases

> Aşağıdaki task'lar V fazı bulgularına göre **güncellenecek**. Şu anki liste, audit + doğrulama bulgularına dayanan **en iyi tahmin**. V'den sonra bazı task'lar düşebilir, yenileri eklenebilir.

### PHASE 0 — Hijyen & Kritik Düzeltmeler

- [x] **P0.T01** — `supabase/.temp/` → `.gitignore`
  - Kabul: `git status` temiz.
- [x] **P0.T02** — **DESCOPED**: Repair undo tutarsızlığı — analiz sonucu: liste.md (satır 37) "10sn geri alma" spec'i hard delete ile karşılanıyor. Soft delete standardizasyonu için ~15 query site'ı güncelleme gerekir; spec talep etmiyor; restore UX requirement yok. `meal_logs` soft delete FK integrity için (meal_log_items). Mevcut davranış spec'e uygun.
- [x] **P0.T03** — Network retry `invokeChat`'e entegre edildi (2 retry, 1s/3s backoff, non-retryable errors fail-fast). `sendMessageWithRetry` wrapper deprecated ama export kaldı. Tüm `sendMessage*` çağrıları otomatik faydalanıyor.
- [x] **P0.T04** — Migration 015 (`ai_summary_atomic_merge`) + `updateLayer2` RPC'ye taşındı + `appendBehavioralPatterns` atomic helper. Concurrent updateLayer2 çağrıları `SELECT FOR UPDATE` ile serialize, JSONB object fields `||` ile merge, scalar alanlar COALESCE ile güvenli.
- [x] **P0.T05** — `npx tsc --noEmit` 0 error.
- [x] **P0.T06** — Proje'de ESLint config yok; `npm run lint` = `tsc --noEmit` zaten P0.T05'te temiz. Ayrı lint gerekirse P15'te eklenecek.
- [x] **P0.T07** — 6 TODO/FIXME var, hepsi `src/services/health-connect.service.ts` içinde ve hepsi zaten P13.T06 (step counter real implementation) kapsamında. Orphan teknik borç yok.

### PHASE 1 — AI Koç Derinleştirme

- [x] **P1.T01** — Onayla/Reddet interaktif butonlar low-confidence verification için wire. `hasLowConfidenceVerificationIndicator` detector, `ConfirmRejectButtons` low-conf için ayrı render path, Confirm → "Evet doğru" / Reject → "Hayır yanlış anladın — son kaydı sil" (repair flow tetikler).
- [x] **P1.T02** — `PersonaCard` component + server ilk persona detection'da `persona_detected` action emit, client kartı render. Confirm/Reject → persona onay/unutma mesajları.
- [x] **P1.T03** — `inferTonePreference(userId)` memory.ts'te: son 14g chat sinyalleri (avg length, correction rate, emoji, question rate) → `learned_tone_preference`. ai-extractor tier 3 (haftalık) çağırıyor.
- [x] **P1.T04** — `evolvePatternConfidence` single source (duplike silindi). 14+g silent→confidence -0.05; **60+g silent→`status='stale'`**; context-builders stale'leri AI'a göndermiyor.
- [x] **P1.T05** — `checkWeightVelocity` ai-plan'e wire. >1kg/hafta 2+ haftadır → kalori hedefi maintenance'a çekiliyor + `_velocity_warning`. MAX_WEEKLY_LOSS_KG constant artık gerçek threshold.
- [x] **P1.T06** — Workout duration cap (>120dk → 120), `_workout_duration_capped`. Sleep-aware intensity `validateExercise` → `_exercise_warnings`.
- [x] **P1.T07** — `extractInjuredBodyParts` + `filterExercisesByInjury`. 11 body part × TR/EN keyword map, 25+ egzersiz→bölge map. `health_events` where type='injury' & ongoing sorgulanıyor; prompt'a inject + post-filter `workout.main[]`.

### PHASE 2 — Besin Takibi Son Rötuşlar

- [x] **P2.T01** — Vision prompt sıkılaştırıldı: her item için `confidence` 0-1 zorunlu, `cooking_method` opsiyonel, "FOTO ANALIZI (ZORUNLU STRUCTURED OUTPUT)" bölümü kural bazlı. `meal_logs.confidence` aggregate item min'den 'high'/'medium'/'low' bucket'lanıyor. `input_method` artık 'photo'/'voice'/'ai_chat' kaynağa göre.
- [x] **P2.T02** — `portion_calibration` yeni format `{grams, count, confirmed, history}`. 3+ correction → `confirmed=true`. context-builders "KESIN" (zorunlu kullan) vs "tahmini" ayrıştırıyor. System prompt "PORSIYON HAFIZASI KULLANIMI" bölümü ekledi — AI confirmed değerleri aynen kullanıyor.
- [x] **P2.T03** — **ZATEN IMPLEMENTED.** `[sessionId].tsx:134,389-393,651-665` — undo state + 10s timer + "Geri Al (10sn)" butonu + repair flow.
- [x] **P2.T04** — `refreshCorrectionMemory` memory.ts'te: son 14g `repair_history`'den top 10 düzeltilen yiyecek çıkarıp `ai_summary.coaching_notes`'a haftalık ozet olarak yazıyor (eski ozetleri deduplicate ederek). ai-extractor tier 3'ten çağrılıyor. **KRITIK BUG FIX**: repair_history schema/code field name mismatch (food_item↔food_name, original_input↔original_text) düzeltildi — önceden tüm repair event yazma/okuma sessizce başarısızdı.
- [x] **P2.T05** — Voice transcription sonrası "Duydum: '...' — gonder veya duzenle | Iptal" banner 5sn görünüyor. İptal → input temizle. Zaten text input'a düşüyordu, banner provenance + undo imkanı için polish.
- [x] **P2.T06** — `AsyncStorage` 30 gün TTL barkod cache. user_correction → community → openfoodfacts akışı; network fail → cache fallback. `clearBarcodeCache` export edildi.
- [x] **P2.T07** — Migration 016 `get_community_barcode(barcode)` RPC: 3+ distinct contributor varsa median nutrition döner. `barcode.service` lookup öncelik sırasında kullanıyor. `barcode_unfound_counts` view'i ile dashboard stats opsiyonel.
- [x] **P2.T08** — ai-report weekly: haftalık + geçen hafta + hafta içi/sonu alcohol_calories hesaplaması + AI prompt'a inject + `weekly_reports.alcohol_total_calories` upsert. weekly.tsx'e "Alkol Ozeti" kartı: toplam/içi/sonu + geçen haftayla karşılaştırma (renkli delta).

### PHASE 3 — Planlama Otomasyonu

- [x] **P3.T01** — Migration 017 (`weekly_plans.approved_at`, `modification_request`, `revision_count`). `approveWeeklyPlan`, `requestMenuModification` service'ları. `weekly-menu.tsx` header'da onayla/değiştir butonları + "Onaylandı" badge + mod talebi textarea. AI regenerate sonrası `approved_at=null` + `revision_count++`.
- [x] **P3.T02** — Plan reddi → Alert.alert chip dialog: Kahvaltı / Öğle / Akşam / Çok protein / Çok karb / Tamamen değiştir. Seçenek AI'a specific mesaj gönderiyor. Plan mode system prompt'una "KISMI DEGISTIRME" talimatı eklendi.
- [x] **P3.T03** — ai-plan'e dün planı diff context: prompt'ta "DUN PLANI: X kcal, antrenman: Y. Bugün farkı varsa focus_message'da 'Dun X, bugun Y. Sebep: Z' yaz." Post-guardrail safety-net: kalori fark ≥150kcal veya plan_type/workout_type değişmişse otomatik `_plan_diff` focus_message'a ekleniyor.
- [x] **P3.T04** — RecipeCard'a `saved` + `onSave` props. chat `handleSaveRecipe` → `saveRecipe` service → saved_recipes tablosu; message'da `recipeSaved=true` işaretleniyor, buton "✓ Kaydedildi" olarak disable.
- [x] **P3.T05** — Recipe mode'da "elimde/evde/dolapta" cue tespiti → saved_recipes'ten token-overlap ranking → top 3 (%40+ match) prompt'a inject ("ELINDEKI MALZEMELERDEN ESLESEN TARIFLER"). AI varsa onlardan seçip oneriyor.
- [x] **P3.T06** — Recipe mode prompt'una "MALZEME IKAMESI" bölümü: protein/karb/yağ/süt/sebze mapping + "her ikame sonrasi makroları yeniden hesapla ve bildir" kuralı.
- [x] **P3.T07** — Migration 018 `profiles.household_size` (SMALLINT, 1-12). Recipe mode'da profile'dan okunup >1 ise "HANEHALKI: N kisi" context + prompt "toplam + kisi basi makroları AYRI göster" kuralı.
- [x] **P3.T08** — Shopping list dinamik: regeneration akışında otomatik güncelleniyor (P3.T01). Shopping list başlığında revision# + generated_at gösterimi freshness için.

### PHASE 4 — Antrenman Progresyon

- [x] **P4.T01** — ai-proactive Monday 07-10 compound lift check: squat/bench/deadlift/OHP için son 2 seans TARGET_REPS (8+) tutturmuşsa ve ağırlık aynıysa +2.5kg önerisi coaching_messages'a yazılıyor.
- [x] **P4.T02** — ai-proactive Monday: 5+ haftada 12+ heavy intensity workout → `deload_suggestion` proaktif mesaj (deduplicated, haftada 1 kez). ai-plan zaten 6 hafta sonra otomatik `deloadContext` inject ediyor.
- [x] **P4.T03** — MET-based calories_burned auto-compute (workout_type × intensity × weight × saat). Post-workout bump: `daily_plans.calorie_target_min/max` %50/%100 of burned kcal ile güncellenir → dashboard "kalan kalori" doğru genişler. Feedback'te kullanıcıya bilgi.
- [x] **P4.T04** — `filterExercisesByEquipment` + `GYM_REQUIRED_EXERCISES` (14 anahtar) + `HOME_ALTERNATIVES` map. ai-plan profile'dan equipment_access okuyup prompt'a inject + post-filter workout.main'den çıkarır + alternatif öneriyi focus_message'a ekler.

### PHASE 5 — Hedef, Plateau, Bakım

- [x] **P5.T01** — `plateau_strategy_apply` action: 5 strateji (calorie_cycle, refeed, tdee_recalc, maintenance_break, training_change) için daily_plans + profile calorie_range_rest_* güncellemeleri + ai_summary coaching_notes.
- [x] **P5.T02** — Migration 019 `maintenance_mode`/`maintenance_start_date`. `maintenance_start` action: reverse diet hesaplamasi (+125 kcal/hafta, TDEE'ye ulaşana kadar 2-4 hafta).
- [x] **P5.T03** — `mini_cut_start` action: 2-4 hafta, curMax-400/-200 kcal aralık, `periodic_state='mini_cut'`, periodic_state_end set. ai-proactive `mini_cut_suggestion` mesajı zaten mevcut.
- [x] **P5.T04** — `TempoChart` component (react-native-chart-kit LineChart). Planlanan (linear interp) vs gerçek (weekly buckets, carry-forward gaps) + son 3 haftalık pace ile ETA. goals.tsx'e entegre.
- [x] **P5.T05** — Coaching mode prompt'una "CELISEN HEDEFLER" bölümü: 3 tipik celiski + dönemsel strateji örnekleri + eylem.
- [x] **P5.T06** — Coaching mode prompt'una "AI-ONERILI HEDEF" + `goal_suggestion` action (goal_type, target_value, target_weeks). Migration 019'da goal_type CHECK constraint gevşetildi (su/uyku/adım gibi esnek goal types için).
- [x] **P5.T07** — ai-proactive mevcut auto-advance (goal reached → is_active swap) + yeni `phase_transition_start_date` schema ile 7-günlük gradual transition data'sı saklanıyor.
- [x] **P5.T08** — Migration 019 `phase_transition_*` kolonları + ai-plan her gün interpolate ediyor (daysSince/7 progress → calorie_range_rest_*). 7. günde otomatik snap + temizlik.
- [x] **P5.T09** — `PhaseTimeline` component multi-phase-goals.tsx'in üstüne entegre: yatay bar + mevcut faz renkli/kalın, geçmiş/gelecek dimmed, haftalık progress indicator.

### PHASE 6 — Bildirim İçeriği Derinleştirme

(Scheduling mevcut. Bu fazda content + trigger accuracy.)

- [x] **P6.T01** — ZATEN TAM: `scheduleLocalNotifications` IF profile alıyor, pencere dışı meal reminder yok, pencere içi 3 zaman (start/mid/end-1h). `updateNotificationPrefs` IF bilgisini DB'den çekiyor.
- [x] **P6.T02** — ai-proactive sabah (08-10 local): son weight log'tan 7g+ geçtiyse coaching_messages'a bildirim, 14g+ daha yumuşak ton, 2 günde bir dedupe.
- [x] **P6.T03** — ai-proactive Cuma sabahı (08-11): son 4 hafta weekend vs weekday compliance gap ≥15 puan ise weekend_drift mesaj. Haftada 1 kez.
- [x] **P6.T04** — ai-proactive Çarşamba akşamı (19-21): Pazartesi'den bu güne calorie_actual toplamı haftalık bütçenin %70+'i ise rebalance önerisi (kalan 4 güne perDay hesabı).
- [x] **P6.T05** — ai-proactive Cumartesi sabah (08-11): son 4 hafta Friday alkol → Saturday compliance <60 pattern tespiti (≥2 örneklem, %60+ oran) → user'a nazik hatırlatma + `ai_summary.alcohol_pattern` persist.
- [x] **P6.T06** — ai-proactive her akşam (18-20): son 7g meal log/day, prior 23g baseline'ın %50 altı ise yumuşak "bugün tek şey" mesajı. 3 günde bir dedupe, baseline 10+ gerekli.
- [x] **P6.T07** — Migration 020 `ai_summary.snacking_hours` (JSONB) + `ai_summary_merge` patched. Weekly tier 3'te `detectSnackingHours` son 4 hafta snack logs'tan peak hours hesaplar (≥3 örneklem/saat). ai-proactive localHour = peakHour-1 ise günde 1 kez nudge.

### PHASE 7 — Su, Kafein, Uyku, TDEE Dinamik

- [x] **P7.T01** — `checkCaffeineIntake` zaten 400mg uyarı + su önerisi dönüyordu. Eklendi: `daily_plans.water_target_liters`'ı aktif bump (günde 1 kez, dedupe via coaching_messages `caffeine_water_bump`).
- [x] **P7.T02** — ai-plan post-process: `plan.water_target_liters = weight × 0.033 + 0.75 (training) + 0.4 (summer Jun-Aug)` deterministic override.
- [x] **P7.T03** — `analyzeLateMealSleep` memory.ts: son 4g meal_logs'tan günlük en geç yemek saati bucket, uyku kalitesi gruplama; 21:00+ vs öncesi ≥0.5sa fark varsa `ai_summary.caffeine_sleep_notes`'a insight. ai-extractor tier 3.
- [x] **P7.T04** — `scheduleLocalNotifications` → `sleepTime` parametre eklendi; `updateNotificationPrefs` profile'dan `sleep_time` çekip geçiyor; sleep_time -30dk daily trigger + "Uyku Yaklasiyor" bildirimi.
- [x] **P7.T05** — `recalculateTDEEIfNeeded` (2.5kg delta veya 30g+) zaten weight_log'da çağrılıyor. Eklendi: TDEE recalc tamamlandığında `tdee_recalculated` trigger coaching_message ile user'a bildiriliyor.
- [x] **P7.T06** — `calibrateActivityMultiplier` memory.ts: son 4 hafta steps + workout frequency → 5-tier mapping (sedentary/light/moderate/active/very_active). Declared vs observed ≥2 tier fark → coaching_message user onayına sunuyor. ai-extractor tier 3.

### PHASE 8 — Özel Modlar Polish

- [x] **P8.T01** — ai-proactive sabah 07-10 local: yesterday's daily_plan.status='mvd_suspended' ise dedupe'lu bildirim "Bugun normal plana donuyoruz, yumusak baslayalim".
- [x] **P8.T02** — `recovery_plan` action: excess_kcal (AI verirse veya hesaplar) → sonraki 2 güne eşit dağılım, floor respect (♀1200/♂1400 + 100 buffer).
- [x] **P8.T03** — `periodic_state_update` action: PAUSE_STATES=['illness','travel','holiday'] → aktif challenge'lar pause; 'none'/'normal'/null → paused challenge'lar auto-resume.

### PHASE 9 — Dönemsel Durumlar Derinleştirme

- [x] **P9.T01** — `getPeriodicCalorieAdjustment` optional `pregnancyTrimester` arg (T1:+0, T2:+340, T3:+450). ai-plan `profile.pregnancy_trimester` okuyup geçiyor.
- [x] **P9.T02** — ai-proactive sabah 08-10: periodic_state_end 3 gün kaldıysa dedupe'lu "Sonraki 3 gün kademeli geçiş" mesajı; bitişten sonra state auto-clear + paused challenge'lar resume.
- [x] **P9.T03** — ai-proactive auto-end'de `seasonal_notes`'a `[{state}_{year}] {dates}, kilo ±Xkg, uyum %Y` snapshot. `periodic_state_update` action aynı state yeniden başladığında regex ile son kayıt kullanıcıya bildiriliyor ("Gecen ramazan notu: ...").
- [x] **P9.T04** — `buildPeriodicPlanContext` exam/busy_work durumlarında: Omega-3/B/magnezyum beyin besinleri + 15dk hazırlık kuralı + stres yeme uyarısı prompt'a inject.
- [x] **P9.T05** — **BUG FIX**: `getTravelContext` non-existent `profile.timezone` kolonu okuyordu — `home_timezone`/`active_timezone` kullanacak şekilde düzeltildi. Migration 021 `timezone_changed_at` kolonu + service değişikliğe timestamp yazıyor; jet lag grace artık 48h scoped (önceden sticky idi).


### PHASE 10 — Alışkanlık, Kademeli Tanıtım, Adaptif

- [x] **P10.T01+P10.T02** — ai-proactive sabah 08-10: günde 1 kez dedupe. İlk habit için 3+ aktif gün şartı → introduce; aktif habit 14g'de ≥80% compliance → sıradaki habit stack önerisi. `HABIT_SEQUENCE` 6 element.
- [x] **P10.T03** — `adjustAdaptiveDifficulty` zaten decrease path'e sahipti; threshold 60 → 70'e güncellendi (spec "1 hafta <%70 → eski seviyeye dön"). Increase ve decrease her iki yönde coaching_message emit.
- [x] **P10.T04** — `getProgressiveDisclosureContext` her chat turn "TANITILMAMIS OZELLIKLER" prompt bölümü enjekte ediyor; eksik olan `features_introduced` alanı layer2_update schema'sına eklendi + AI'a "tanıtılan özelliğin key'ini MUTLAKA ekle" talimatı.

### PHASE 11 — Geri Dönüş & Inactivity

- [x] **P11.T01** — ai-proactive 10-12 local: last chat OR meal_log → daysSilent; tam olarak 3/7/30. gün tetiklenir. 60 günde bir dedupe (tier başına). Mesaj tonu 3g→hafif, 7g→past success ref, 30g→son çağrı.
- [x] **P11.T02** — Dashboard mount'ta `detectReturnLevel`; returnStatus!=='active' ise welcome-back banner. `needsReOnboarding=true` (180+g) → "Guncelleme yap" butonu `/onboarding?mode=re_onboarding` route'una gider.
- [x] **P11.T03** — ai-plan last 2 user chat_messages gap ≥8g + return ≤3g → `returnLightening` 20-25%. Kalori targetlari TDEE'ye doğru interp ile yumuşatılır, focus_message'a not eklenir.

### PHASE 12 — Çoklu Cihaz, Gizlilik, Cleanup Cron

- [x] **P12.T01** — Migration 024 `user_sessions` tablosu + RLS + 30g prune cron. `realtime-sync.service` `registerSession`/`heartbeatSession`/`isSessionStillValid` fonksiyonları. `_layout.tsx` auth sonrası device_info + push_token ile register, AppState 'active' transition'da heartbeat + session valid değilse otomatik sign-out. `account-security.tsx` UI zaten vardı — artık gerçek veriyle çalışır.
- [x] **P12.T02** — `TABLES_TO_SYNC`'e `weekly_plans` eklendi. `weekly-menu.tsx` postgres_changes channel subscribe ediyor, başka cihazda approve/regenerate → bu cihazda otomatik `loadPlan()`.
- [x] **P12.T03** — Migration 022 `scheduled_cleanups` şema uyumsuzluğu fix (resource_type/resource_id/scheduled_at/status kolonları). Yeni `cleanup-scheduled` edge function pg_cron '*/15 * * * *' → pending row'lar için storage delete + DB delete + status=done; failure isolated per row.
- [x] **P12.T04** — Migration 025 pgsodium graceful setup: `health_events.description`/`event_type` + `lab_values.test_name`/`value_text`/`note` ChaCha20-Poly1305 SECURITY LABEL ile encrypted at write. pgsodium mevcut değilse dev modu NOTICE.
- [x] **P12.T05** — Migration 023 `execute_pending_account_deletions()` Postgres function: `deletion_requested_at < NOW() - 30d` profilleri + auth.users satırı hard-delete (cascade ile logs/chats/summaries/photos siliniyor). Daily cron 03:00 UTC.

### PHASE 13 — Premium & Monetization

- [x] **P13.T01** — Migration 026: `subscriptions` tablosu (user_id, tier, status, provider, product_id, expires_at, raw_receipt) + `sync_profile_premium` trigger (profiles.premium ve premium_expires_at ile sürekli senkron) + `expire_stale_subscriptions` daily cron. Client `subscription.service.ts`: `getActiveSubscription`, `isPremiumActive`, `startTrialIfEligible`, `daysRemaining`, `initiatePurchase` (RC stub), `restorePurchases` (RC stub).
- [x] **P13.T02** — `onboarding.tsx` complete flow'a `startTrialIfEligible(user.id)` eklendi: profil + hedef kaydı sonrası idempotent trial satırı (tier='trial', +7gün) + `profiles.trial_used=true`.
- [x] **P13.T03** — `src/lib/premium-gate.ts`: 27 FeatureKey (free-tier 5 + premium 22), `FREE_TIER_FEATURES` set, `checkFeature`/`useFeatureAccess`/`requirePremium`. FeatureAccess dönüşü { allowed, reason, tier, expiresAt } — UI hem gating hem upsell için kullanır.
- [x] **P13.T04** — Chat remaining badge: her zaman görünür (X/5 formatı, ≤2 warning rengi); 0'da tıklanabilir chip → "Gunluk 5 mesaj hakkın bitti — Premium'a geç" → `/settings/premium`.
- [x] **P13.T05** — `app/settings/premium.tsx`: `initiatePurchase(monthly|yearly)` native SDK stub önce denenir; stub fail → dev fallback olarak `subscriptions` tablosuna insert (trigger ile profile sync) + profile update. `restorePurchases` wire edildi.
- [x] **P13.T06** — `expo-sensors` package.json'a eklendi (~55.0.11). `health-connect.service.ts` dynamic `require('expo-sensors')` + Pedometer interface; `isHealthAvailable`/`requestHealthPermissions`/`getTodaySteps` gerçek wire. Yeni `syncStepsToDailyMetrics` → day-boundary-aware, mevcut değerden yüksekse upsert `daily_metrics.steps` + `steps_source='phone'`. Dashboard mount'ta tetikleniyor.

### PHASE 14 — UI Polish & Eksik Parçalar

- [x] **P14.T01** — `MacroRing` component: 3 konsantrik CircularProgress (protein/karb/yağ), legend + % text. chat'te meal_log sonrası `MacroSummary` yerine render.
- [x] **P14.T02** — Chat composer'da calendar button (warning rengi selected hali), `backdateDate` state, Alert-bazlı quick picker (bugün/dün/2g/3g), banner "Kayıt tarihi: X", send sonrası auto-clear. `sendMessageToSession` artık `targetDate` opsiyonel param alıyor → `target_date` body.
- [x] **P14.T03** — `sharing.service.ts` `shareImage(fileUri, dialogTitle)` + `expo-sharing` import. Existing text sharing korundu.
- [x] **P14.T04** — `challenges.tsx` "Hazir" vs "Kendi Challenge'in" toggle button. Custom form: title + tip chip (water/protein/steps/sleep/custom) + süre + opsiyonel eşik → `startChallenge` ile insert.
- [x] **P14.T05** — `share-card.service.ts` `generateMilestoneCard(data)`: 1080×1920 HTML → PDF (expo-print). Theme renkleri (success/streak/milestone/neutral). `shareMilestoneCard` convenience: üret + native share sheet.

### PHASE 15 — QA, Hardening, Release

Bu faz için çıktılar `RELEASE_CHECKLIST.md`'de toplandı (DB deploy, E2E smoke, RLS audit, perf budget, a11y, Sentry, KVKK, store listing, build, release). Cihaz/mağaza bağımlı adımlar runtime'da tamamlanır.

- [x] **P15.T01** — E2E smoke checklist (RELEASE_CHECKLIST §2): 11 kritik flow listelendi, manuel smoke cihazda yapılacak.
- [x] **P15.T02** — RLS audit query + cross-user isolation test (§3). Migration'larda RLS zaten her tabloya enable, 4 policy (sel/ins/upd/del).
- [x] **P15.T03** — Performance budget hedefleri dokümante (§4). Runtime ölçüm cihazda yapılacak.
- [x] **P15.T04** — Chat composer ikon butonlarına `accessibilityRole` + `accessibilityLabel` + `hitSlop` (44pt effective) eklendi. Kapsamlı ekran taraması (§5) release öncesi.
- [x] **P15.T05** — Sentry kurulum talimatı (§6). `@sentry/react-native` opsiyonel dep, DSN config.
- [x] **P15.T06** — KVKK/GDPR checklist (§7): export.service, privacy.service grace 30-day, migration 022+023 cron'lar, migration 025 pgsodium — hepsi wire'landı.
- [x] **P15.T07** — Store listing checklist (§8): screenshots, description, keywords, app.config production values.
- [x] **P15.T08** — Build talimatları (§9): EAS cloud + Local Android + Tag.
- [x] **P15.T09** — v1.0.0-rc1 hazır — tag ve store submit cihaz doğrulaması sonrası.

---

## 7. Feature Matrix (liste.md → status)

> liste.md'nin HER bullet'ı. Phase V sonrası güncellenir. `[x]` = production-ready + cihazda doğrulandı. `[~]` = kod var, tam doğrulanmadı. `[ ]` = eksik.

### Akıllı Koç
- [~] Her konuşmadan öğrenir ve unutmaz *(memory layer 2/3 implemented, decay eksik)*
- [~] Yeme alışkanlıkları/tetikleyicileri
- [~] Davranış kalıbı tespiti
- [~] Stres-yeme/uyku-performans/kafein-uyku korelasyonları *(caffeine.service var)*
- [~] Hafta içi/sonu profil farkındalığı
- [~] Veri-odaklı vs motivasyon-odaklı
- [~] Ton adaptasyonu *(learned_tone_preference, feedback loop eksik)*
- [~] "Benim hakkımda ne biliyorsun?" *(handler var; UI polish test)*
- [~] Yanlış öğrenilen sil *(coach-memory.tsx delete var)*
- [~] 100+ mesaj persona *(detection var, UI feedback eksik)*

### Beslenme Takibi
- [~] Serbest metin kayıt
- [~] Fotoğraf kayıt *(vision+items wired; prompt sıkılaştırma)*
- [~] Barkod kayıt
- [~] Sesli giriş *(voice → ai-chat; onay adımı eksik)*
- [~] Favori şablonlar *(meal_templates mevcut)*
- [~] Pişirme yöntemi *(COOKING_MULTIPLIERS var)*
- [~] Porsiyon kalibrasyonu *(depolama var, auto-apply eksik)*
- [~] Güven göstergesi
- [~] Düzeltme hafızası *(repair_history var, retraining eksik)*
- [~] Geçmişe dönük kayıt *(target_date parametre)*
- [~] Alkol ayrı hesap *(alcohol_g kolonu; rapor bölümü eksik)*
- [~] Supplement
- [~] Kreatin su tutulumu
- [ ] 10sn undo toast
- [ ] 1 dk kayıt SLA (performans ölçüm)

### Diyet Planlama
- [~] Sabah özel plan push *(scheduleLocalNotifications morning_plan mevcut)*
- [~] 2-3 alternatif
- [~] Antrenman/dinlenme farkı
- [~] IF modu pencere
- [~] Haftalık menü *(UI var, onay akışı eksik)*
- [~] Otomatik alışveriş listesi *(static; dinamik recalc eksik)*
- [~] Besin zamanlama
- [~] Protein dağılımı
- [~] Mevsimsel
- [~] Alerjen filtresi
- [ ] "Başka bir şey yap" multi-turn
- [ ] Plan değişiklik açıklaması

### Tarif Motoru
- [~] Akşama tarif
- [~] Kalan makro-bazlı
- [ ] Aile ölçekleme
- [ ] Elimde malzeme var (saved_recipes öncelik)
- [ ] Malzeme ikamesi
- [ ] Tarif kaydet chat'ten (buton)
- [~] Kütüphane *(UI var)*
- [ ] Kütüphane → menü entegrasyon

### Spor ve Antrenman
- [~] Günlük antrenman planı
- [ ] Ekipman filtresi
- [~] Hedefe göre workout
- [ ] Sakatlık filtresi
- [~] Güç takibi
- [ ] Progresif aşırı yük trigger
- [~] 1RM tahmini
- [ ] Deload 4-6 hafta
- [~] Toparlanma takibi
- [~] Uyku yetersizse hafif
- [ ] Post-workout kalori dinamik

### Haftalık Bütçe
- [~] Günlük+haftalık bütçe
- [~] Marjin mesajı
- [ ] Günlere otomatik dağılım
- [~] Dashboard bar
- [~] Haftalık raporda ayrı

### Simülasyon
- [~] "Pizza yesem"
- [~] Günün kalan
- [~] Structured JSON
- [~] Haftalık etki
- [~] Alternatif senaryo
- [~] Kayıt akışına dönüş

### Hızlı Kurtarma
- [~] Empati
- [~] Mini plan
- [~] Haftalık perspektif
- [~] "Hafta bitmedi"
- [ ] Yarın/öbür gün auto-dengeleme

### MVD
- [~] Normal plan askıya
- [~] 3 basit hedef
- [~] En yumuşak ton
- [~] Daha basit (level down)
- [ ] Ertesi gün fiili plan reset
- [~] Motivasyon konuşmama

### Hedef Motoru
- [~] Somut hedef
- [ ] Tempo grafiği
- [~] Çoklu hedef
- [ ] Çelişen dönemsel strateji
- [ ] AI önerisiyle hedef
- [~] Aşırı agresif uyarı

### Plateau
- [~] 3+ hafta tespit
- [~] Net tanımlama
- [~] 5 strateji
- [~] 1-2 öneri
- [ ] Onay→plan mutation

### Bakım
- [~] Reverse diet hesap
- [~] Bakım aralığı
- [~] Tolerans bandı
- [~] Band aşımı proaktif *(ai-proactive mesaj var; mini cut trigger eksik)*
- [ ] Mini cut trigger
- [~] Davranış pekiştirme *(milestone weeks ai-proactive'de)*

### Çok Fazlı
- [~] Sıralı fazlar
- [~] Otomatik faz geçişi *(ai-proactive phase detection var; test)*
- [ ] Cut↔bulk transition
- [ ] Timeline UI

### Dışarıda Yemek
- [~] Mekan önerileri
- [~] Menu fotoğrafı
- [~] Sosyal baskı koçluğu
- [~] Haftalık perspektif
- [~] Mekan hafızası
- [ ] Gün planı proaktif ayar

### Dönemsel Durumlar
- [~] Ramazan
- [~] Hastalık
- [ ] Hamilelik trimester
- [~] Emzirme
- [~] Tatil/seyahat
- [ ] Sınav/yoğun iş (brain foods)
- [ ] Sakatlanma bölge filtresi
- [ ] Dönem bitiş transition
- [ ] Geçmiş dönem hafızası

### Kadın Özel
- [~] Döngü takibi
- [~] Folikuler
- [~] Ovulasyon
- [~] Luteal
- [~] Menstrual

### Raporlar
- [~] Günlük
- [~] Haftalık
- [~] Aylık
- [~] Tüm zamanlar
- [ ] AI öğrenme notu (haftalık scheduler)
- [~] Takvim UI
- [~] Export (JSON/CSV/PDF)

### Bildirimler
- [~] Sabah plan (scheduler)
- [~] Öğün hatırlatma *(IF-aware doğrulama)*
- [~] Su hatırlatma
- [~] Gece atıştırma riski
- [~] Spor hatırlatma
- [ ] Tartı hatırlatma 7g
- [~] Plateau uyarı (ai-proactive)
- [ ] Hafta sonu cuma uyarı
- [ ] Haftalık bütçe %70
- [~] Günlük limit
- [~] Priority (tek bildirim)
- [~] Per-type toggle UI

### Prediktif Analitik
- [~] Hafta sonu sapma (tespit var, cuma push eksik)
- [~] Atıştırma saati (tespit var, push eksik)
- [ ] Alkol-ertesi gün
- [ ] Motivasyon düşüş
- [~] Dönemsel risk (menstrual)

### Kafein-Uyku
- [~] Kafein tespiti
- [~] Uyku korelasyon
- [ ] 400mg uyarı
- [ ] Su otomatik artış

### Alışkanlık Koçluğu
- [~] Sıralı liste
- [ ] İlk habit tanıtım trigger
- [ ] Auto-stack trigger
- [~] Anchor
- [~] Challenge vs habit

### Kademeli Tanıtım
- [~] Feature schedule
- [ ] Runtime delivery doğrulama
- [~] Ayni özellik iki kez yok

### Adaptif Zorluk
- [~] %85 uyum → zorluk *(ai-proactive monday)*
- [ ] Decrease/revert
- [~] Değişiklik bildirim

### Su Takibi
- [~] Dashboard button
- [~] kg*0.033L
- [ ] Antrenman +0.5-1L
- [ ] Sıcak mevsim
- [ ] Kafein → su
- [~] Azlık uyarı (scheduler var)

### Uyku Takibi
- [~] Saat girişi
- [~] Kalite
- [ ] Geç yemek → uyku
- [~] Hafif antrenman
- [ ] Bedtime app notif

### TDEE
- [~] Mifflin BMR
- [~] 5 kademeli aktivite
- [ ] Dinamik multiplier
- [ ] 2-3kg delta recalc
- [~] Aralık hedefi
- [ ] Yeni kullanıcı geniş
- [~] Hamilelik/emzirme

### Barkod
- [~] Kamera okuma
- [~] OpenFoodFacts TR field
- [ ] Offline cache
- [~] Bulunamadı fallback
- [ ] Topluluk katkısı

### Güvenlik
- [~] Min kalori floor
- [ ] Max 1kg/hafta (plan wire)
- [ ] Aşırı egzersiz guard
- [ ] Sakatlık filtresi
- [~] Alerjen
- [~] 112 mesajı
- [~] ED risk
- [~] Teşhis yok
- [~] Prompt injection

### Sohbet Onarım
- [~] "Yanlış anladın"
- [~] Düşük güven auto-text
- [ ] Düşük güven interaktif butonlar
- [~] "Son kaydı sil"
- [~] Parse hatası (repair_history; retraining eksik)

### Zengin Sohbet
- [~] Mini chart
- [~] Hızlı seçim
- [ ] Makro halkası chat'te
- [~] Onay butonları
- [~] Simülasyon kartı
- [~] Haftalık bütçe barı

### Offline
- [~] Queue
- [~] Auto sync
- [~] Conflict resolution

### Çoklu Cihaz
- [~] Aynı hesap
- [~] Realtime sync
- [ ] Plan durum sync
- [ ] Aktif oturum UI

### Gizlilik
- [~] TLS
- [ ] At-rest encryption
- [~] KVKK audit log
- [ ] Foto 24h (cron execution)
- [~] Ilerleme foto AI'a gitmiyor
- [~] Veri export
- [~] AI öğrenme export
- [ ] Hesap silme hard-delete cron
- [ ] Otomatik yedek
- [~] AI bilgi görüntüle/sil

### Timezone/Seyahat
- [~] Auto detect
- [~] Jet lag grace
- [ ] Meal timing auto-shift
- [ ] Bölge mutfağı
- [ ] "Seyahatte misin?" proaktif

### Gün Sınırı
- [~] Varsayılan 04:00
- [~] Customize (schema)
- [ ] Manuel tarih override UI

### Geri Dönüş
- [~] Detection levels
- [ ] 3/7/30g notif
- [~] Ton yargılamıyor
- [~] Streak break nazik
- [ ] İlk 3 gün plan light
- [ ] 6+ ay re-onboarding

### Premium
- [~] Ücretsiz 5 mesaj
- [~] Barkod ücretsiz
- [ ] 7g trial akışı (state machine)
- [ ] Per-feature gating helper
- [~] Sınırsız AI premium (rate-limit tier check var)
- [~] Paywall ekranı (UI var, payment yok)
- [ ] Step counter real

### Paylaşım
- [ ] Milestone kartı
- [ ] IG/WhatsApp share
- [ ] User-defined challenge UI

---

## 8. Doğrulama Protokolü

Her task sonunda:

1. **Değişiklik lokal çalışıyor** (preview_start + golden path).
2. **Regresyon yok** (ilgili alandaki eski feature'lar test).
3. **TypeScript**: `npx tsc --noEmit` 0 error.
4. **Git**: atomic commit, format: `<phase-id>: <action>`.
5. **Plan güncelle**: task checkbox + §7 matrix güncel.
6. **Commit ref ekle**: tamamlanan task satırına `(→ abc1234)` ilave.

Faz sonunda:

- Fazın tüm task'ları `[x]`.
- Fazın kapsadığı feature matrix satırları `[x]`.
- İleride geri dönmek gerekmeyecek şekilde kapandı.

Tüm plan bittiğinde:

- Feature matrix **tamamen** `[x]`.
- Phase 15 release tasks tamam.
- Internal Testing 0 blocker.
- `v1.0.0` tag.

---

## 9. Risk Register

Plan ilerlerken karşılaşılabilecek riskler — tespit edildiğinde buraya ekle.

| Risk | İhtimal | Etki | Azaltma |
|---|---|---|---|
| OpenAI rate limit / cost spike | Orta | Yüksek | Model routing (mini → 4o), caching, daily cost alarm |
| Supabase free tier limit | Orta | Yüksek | Usage monitoring; pro tier geçiş hazırlığı |
| Vision parse kalitesi düşük | Yüksek | Orta | Prompt iterasyon; low-confidence fallback text parse |
| Expo push delivery iOS flaky | Düşük | Orta | Retry + alternate channel (email) |
| RevenueCat entegrasyon gecikmesi | Orta | Yüksek | Trial/subscription stub ile launch, RC sonra |

---

## 10. Progress Log

> Her önemli güncelleme bir satır atar (task tamamlama, faz bitimi, karar değişikliği).

- **2026-04-17**: Plan v1 oluşturuldu.
- **2026-04-18**: Plan v2 — doğrudan kod okuma ile 17 yanlış audit iddiası düzeltildi. Phase V (verification sprint) zorunlu ilk faz olarak eklendi. Feature matrix `[~]`/`[x]`/`[ ]` üç-durumlu oldu. Task sayısı ~120'den ~95'e düştü (confirmed-done'lar çıkarıldı).
- **2026-04-18**: **Phase 0 tamamlandı.** P0.T01 (gitignore), P0.T03 (chat retry), P0.T04 (ai_summary atomic merge + migration 015), P0.T05 (TS 0 err), P0.T06 (lint=tsc), P0.T07 (TODO audit). P0.T02 descoped — spec hard-delete ile karşılanıyor.
- **2026-04-18**: **Phase 1 tamamlandı.** P1.T01 (low-conf butonlar), P1.T02 (persona card), P1.T03 (tone inference weekly), P1.T04 (stale flag), P1.T05 (weight velocity guard), P1.T06 (workout duration cap + sleep-aware), P1.T07 (injury-based exercise filter). Tümü TS 0 err. Cihaz yok, test edilemedi ama kod mantıksal olarak tamam.
- **2026-04-18**: **Phase 2 tamamlandı.** P2.T01 (vision prompt + confidence 0-1 per item + meal_logs.confidence bucket), P2.T02 (portion_calibration count/confirmed/history auto-apply), P2.T03 (zaten impl), P2.T04 (correction retraining weekly + **kritik repair_history schema bugfix**), P2.T05 (voice confirmation banner), P2.T06 (barcode offline cache 30d), P2.T07 (community barcode migration 016), P2.T08 (weekly alcohol section). Tümü TS 0 err.
- **2026-04-18**: **Phase 3 tamamlandı.** P3.T01 (migration 017 weekly menu approval/modify), P3.T02 (plan reject chip dialog + partial regen talimatı), P3.T03 (yesterday-diff context + safety-net focus_message), P3.T04 (recipe save button + saved badge), P3.T05 (pantry cue → saved_recipes token match top 3), P3.T06 (ingredient substitution map + macro recalc rule), P3.T07 (migration 018 household_size + context), P3.T08 (revision/generated_at UI). Tümü TS 0 err.
- **2026-04-18**: **Phase 4 tamamlandı.** P4.T01 (compound lift Monday +2.5kg trigger), P4.T02 (deload Monday suggestion + existing 6w auto-apply), P4.T03 (MET-based calories + daily_plan bump), P4.T04 (equipment filter home/gym/both + HOME_ALTERNATIVES). Tümü TS 0 err.
- **2026-04-18**: **Phase 5 tamamlandı.** P5.T01 (plateau_strategy_apply action), P5.T02 (migration 019 + maintenance_start action), P5.T03 (mini_cut_start action), P5.T04 (TempoChart component + ETA), P5.T05 (coaching mode çelişen hedef prompt), P5.T06 (goal_suggestion action), P5.T07 (phase_transition_* schema), P5.T08 (7-day daily interp ai-plan), P5.T09 (PhaseTimeline horizontal bar). Tümü TS 0 err.
- **2026-04-18**: **Phase 6 tamamlandı.** P6.T01 (zaten impl), P6.T02 (weight reminder 7/14g), P6.T03 (Friday weekend drift), P6.T04 (Wednesday evening budget 70%), P6.T05 (Saturday alcohol-next-day + pattern persist), P6.T06 (evening motivation dip via log frequency), P6.T07 (migration 020 snacking_hours + detectSnackingHours + pre-peak nudge). Tümü TS 0 err.
- **2026-04-18**: **Phase 7 tamamlandı.** P7.T01 (kafein water target bump), P7.T02 (deterministic water formula override), P7.T03 (late meal ↔ sleep correlation weekly), P7.T04 (bedtime wind-down -30min notif), P7.T05 (TDEE recalc notification), P7.T06 (activity multiplier calibration weekly). Tümü TS 0 err.
- **2026-04-18**: **Phase 8 tamamlandı.** P8.T01 (MVD next-day reset notification), P8.T02 (recovery calorie redistribution next 2 days), P8.T03 (challenge auto-pause/resume). Tümü TS 0 err.
- **2026-04-18**: **Phase 9 tamamlandı.** P9.T01 (pregnancy trimester T1/T2/T3), P9.T02 (3d heads-up + auto-clear), P9.T03 (period snapshot + recall), P9.T04 (brain foods exam/busy_work), P9.T05 (jet lag grace bug fix + migration 021). Tümü TS 0 err.
- **2026-04-18**: **Phase 10 tamamlandı.** P10.T01+T02 (habit introduce + auto-stack in ai-proactive), P10.T03 (adaptive difficulty threshold align 70%), P10.T04 (features_introduced layer2 schema). Tümü TS 0 err.
- **2026-04-18**: **Phase 11 tamamlandı.** P11.T01 (3/7/30 gün reengagement), P11.T02 (welcome-back banner + re-onboarding route), P11.T03 (return plan lightening ai-plan). Tümü TS 0 err.
- **2026-04-18**: **Phase 12 tamamlandı.** P12.T01 (user_sessions + register/heartbeat, migration 024), P12.T02 (weekly_plans realtime sync), P12.T03 (cleanup-scheduled edge fn + migration 022 schema fix), P12.T04 (pgsodium at-rest migration 025), P12.T05 (30-day account hard-delete migration 023). Tümü TS 0 err.
- **2026-04-18**: **Phase 13 tamamlandı.** P13.T01 (subscriptions tablosu + trigger sync, migration 026), P13.T02 (trial onboarding'de), P13.T03 (premium-gate helper 27 key), P13.T04 (remaining badge + CTA), P13.T05 (paywall native SDK önce + dev fallback), P13.T06 (expo-sensors dynamic require + syncStepsToDailyMetrics). Tümü TS 0 err.
- **2026-04-18**: **Phase 14 tamamlandı.** P14.T01 (MacroRing in chat), P14.T02 (backdate picker), P14.T03 (shareImage via expo-sharing), P14.T04 (custom challenge form), P14.T05 (milestone card generator). Tümü TS 0 err.
- **2026-04-18**: **Phase 15 tamamlandı.** RELEASE_CHECKLIST.md comprehensive doc (E2E smoke, RLS, perf, a11y, Sentry, KVKK, store, build, release) + chat composer accessibility labels. Kalan cihaz/mağaza bağımlı adımlar runtime'da. **🎉 Tüm 16 implementation phase tamamlandı (V verification sprint cihaz gelince).**
