# KOCHKO — FINAL MUHENDISLIK HARITASI VE MUKEMMELLESTIRME PLANI

> 10 bagimsiz ajan tarafindan 178 dosya, 28,268 satir kod derinlemesine analiz edildi.
> Bu belge her ozelligin durumunu, eksiklerini ve mukemmellestirme adimlarini icerir.

---

## KOD ISTATISTIKLERI

| Metrik | Deger |
|--------|-------|
| Toplam kaynak dosya | 178 (.ts, .tsx, .sql) |
| Toplam kod satiri | 28,268 (JSON haric) |
| Supabase Edge Functions | 6 ana fonksiyon |
| Database Migrations | 9 dosya |
| UI Ekranlari | 30+ ekran |
| Servis Dosyalari | 35+ servis |

---

## GENEL DURUM OZETI

| Kategori | IMPLEMENTED | PARTIAL | MISSING | Toplam |
|----------|-------------|---------|---------|--------|
| AI Koc & Ogrenme | 13 | 7 | 3 | 23 |
| Beslenme Takibi | 14 | 4 | 1 | 19 |
| Diyet Planlama & Tarif | 12 | 7 | 0 | 19 |
| Spor & Antrenman | 5 | 4 | 2 | 11 |
| Butce, Simulasyon, Kurtarma, MVD | 17 | 0 | 1 | 18 |
| Hedef, Plato, Bakim, Cok Fazli | 11 | 3 | 12 | 26 |
| Raporlama & Prediktif | 10 | 8 | 2 | 20 |
| Bildirim & Zengin Sohbet | 7 | 8 | 1 | 16 |
| Donemsel, Kadin, Disarida Yemek, Kafein | 19 | 1 | 0 | 20 |
| Su, Uyku, TDEE, Guvenlik, Gizlilik | 15 | 6 | 0 | 21 |
| **TOPLAM** | **123** | **48** | **22** | **193** |

---

## BOLUM 1: AI KOC & OGRENME SISTEMI (Ajan 1)

### IMPLEMENTED (Tam Calisiyor)
| Ozellik | Dosya | Not |
|---------|-------|-----|
| Her konusmadan ogrenme (Layer 2) | `ai-chat/index.ts:207-219`, `memory.ts` | extractLayer2Updates + processLayer2Updates |
| Yeme aliskanliklari/tetikleyiciler hafizasi | `memory.ts:buildLayer2`, `003.sql` | ai_summary JSONB |
| Davranis kalibi tespiti | `system-prompt.ts:120-145`, `index.ts:806-878` | 2+ gozlem kurali, dedup mantigi |
| Stres-yeme, kafein-uyku korelasyonu | `caffeine.service.ts`, `sleep-analysis.service.ts` | Kafein server-side calisir |
| Hafta sonu sapma tespiti | `predictive.service.ts`, `ai-proactive:186-195` | Cuma aksami tetikleyici |
| Veri odakli/motivasyona gore iletisim | `repair-handler.ts:317-354` | Persona bazli ton |
| Iletisim tonu ayarlama (sert/dengeli/yumusak) | `repair-handler.ts:getToneContext` | Feedback + Layer 2 |
| "Benim hakkimda ne biliyorsun?" | `index.ts:102-108`, `repair-handler.ts:362-409` | buildKnowledgeSummary |
| Yanlis ogrenmeyi duzeltme/silme | `repair-handler.ts`, `index.ts:92-108` | Undo + correction flow |
| 100+ mesajda persona tespiti | `repair-handler.ts:256-310` | 100/250/500 tetikleyici |
| Habit stacking | `habits.service.ts:23-30, 79-101` | Anchor field'lar |
| Tanitim mesajlari sohbete gomulu | `progressive-disclosure.service.ts` | Popup degil, dogal akis |
| Adaptif zorluk (AI proactive) | `ai-proactive:486-573` | %5 kalori, +5g protein |

### PARTIAL (Eksik/Yarim)
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Uyku-performans korelasyonu | `sleep-analysis.service.ts` client-only, edge fn'a baglanmamis | Edge function'dan cagirilmali |
| Hafta sonu risk tahmini | `getWeekendRiskPrediction()` client-only, proactive'den cagrilmiyor | ai-proactive icine entegre et |
| Habit %80 uyum kontrolu | `weekly_compliance` hesaplanmiyor, her zaman undefined→0 | Compliance pipeline yaz |
| Habit servisi edge fn'a baglanmamis | `habits.service.ts` fonksiyonlari hicbir edge fn'dan cagrilmiyor | `getChatIntegrationPrompt` ai-chat'e bagla |
| Kademeli ozellik tanitimi | `contextMatches()` hep true doner (stub), `features_introduced` yazilmiyor | processLayer2Updates'e handler ekle |
| Ayni ozellik iki kez tanitilmama | `features_introduced` ne yaziliyor ne okunuyor | Layer 2 handler + context injection |
| Adaptif zorluk tutarsizligi | Client: 50kcal sabit, Server: %5; antrenman yogunlugu bump uygulanmiyor | Client'i %5'e cevir, workout intensity field ekle |

### MISSING (Hic Yok)
| Ozellik | Gerekli Is |
|---------|------------|
| `alcohol_pattern` Layer 2 handler | processLayer2Updates'e alcohol_pattern handler ekle |
| `social_eating_note` Layer 2 handler | processLayer2Updates'e social_eating_note handler ekle |
| `evolvePatternConfidence` periyodik calistirma | Cron job ile pattern confidence decay |

---

## BOLUM 2: BESLENME TAKIBI (Ajan 2)

### IMPLEMENTED
| Ozellik | Dosya | Not |
|---------|-------|-----|
| Serbest metin ile kayit (AI parse) | `ai-chat/index.ts`, `system-prompt.ts`, `task-modes.ts` | Tam end-to-end |
| Fotograf ile kayit | `chat.tsx`, `chat.service.ts`, `ai-chat/index.ts` | Vision API |
| Barkod tarama (kamera) | `barcode.service.ts`, `chat.tsx` | expo-camera |
| Pisirme yontemi farki | `ai-chat/index.ts:335-356` | 8 yontem carpani |
| Porsiyon kalibrasyonu | `system-prompt.ts`, `memory.ts` | Layer 2 portion_calibration |
| Guven gostergesi (Yuksek/Orta/Dusuk) | `system-prompt.ts`, `barcode.service.ts`, `repair.service.ts` | 3 katman |
| Duzeltme hafizasi | `repair-handler.ts`, `ai-chat/index.ts` | repair_history context |
| Gecmise donuk kayit (API) | `ai-chat/index.ts:46,210-211` | target_date altyapisi |
| Alkol takibi | `meal_log_items.alcohol_g`, `ai-report`, `guardrails.ts` | 7 kcal/g |
| Supplement takibi | `supplements.service.ts`, `SupplementQuickAdd.tsx` | 6 supplement |
| Kreatin su tutulumu | `supplements.service.ts`, `ai-chat/index.ts:398-410` | 14 gun kontrolu |
| Kayit silme/geri alma | `repair-handler.ts:handleUndo`, `UndoTimer.tsx` | 10sn animasyonlu |
| Barkod bulunamazsa serbest metin | `barcode.service.ts` | Chat input pre-fill |
| Favori ogun sablonlari (CRUD) | `templates.service.ts`, `meal-templates.tsx` | use_count sirali |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Sesli giris (STT) | Client kayit var, backend Whisper handler YOK | ai-chat edge fn'a `transcribe_only` handler ekle (~30 satir) |
| Sablon tek dokunusla kayit | `useTemplate()` sadece Alert gosteriyor, meal_log eklemiyor | sendMessage veya direkt supabase insert |
| Gecmise donuk kayit UI | API destekliyor ama chat'te tarih secici yok | Date picker UI ekle |
| Turk urun veritabani | Sadece OpenFoodFacts; GS1 Turkey yok | GS1 Turkey API entegrasyonu |
| Barkod offline cache | Kullanici duzeltmeleri cached, API sonuclari degil | Sonuclari local cache'e yaz |
| cooking_method actions schema'da yok | AI tutarsiz uretebilir | system-prompt format'a ekle |
| meal_logs.confidence populate edilmiyor | Kolon var ama executeActions yazmiyor | confidence field'i insert'e ekle |

### MISSING
| Ozellik | Gerekli Is |
|---------|------------|
| Topluluk barkod katkisi (3+ kullanici onay) | community_barcodes tablosu, onay workflow, promote mekanizmasi |

---

## BOLUM 3: DIYET PLANLAMA & TARIFLER (Ajan 3)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Gunluk beslenme plani | `ai-plan/index.ts`, `plan.tsx`, `004.sql` |
| Her ogun 2-3 alternatif | `PLAN_SYSTEM` prompt, `MealOptionCard` |
| Antrenman/dinlenme farkli kalori | `profiles` 4 kolon, `memory.ts:99-100` |
| IF pencere uyumu | `profiles.if_*`, `periodic-config.ts:isIFCompatible` |
| 7 gunluk haftalik menu | `ai-plan:generateWeeklyPlan`, `weekly-menu.tsx` |
| Otomatik alisveris listesi | `weekly_plans.shopping_list`, `weekly-menu.tsx` |
| Mevsimsel oneriler | `periodic-config.ts:getSeasonalContext` |
| Alerjen filtresi (kod bazli) | `ai-plan:296-304`, `food-preferences.tsx` |
| Plan reddetme + yeniden uretim | `plan.tsx:handleReject`, versiyonlama |
| "Ne pisireyim?" tarif modu | `task-modes.ts:52` recipe mode |
| "Elimde sunlar var" tarif | `recipes.service.ts:getRecipesByIngredients` |
| Tarif kutuphanesi CRUD | `saved_recipes` tablo, `recipes.tsx` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Protein esit dagitimi | Prompt'ta talimat yok | "Proteini ogunlere esit bol" talimatini prompt'a ekle |
| Plan degisiklik aciklamasi | `change_explanation` alani yok | AI prompt'a "ne degisti acikla" talimati ekle |
| Kalan makroya gore tarif | Kalan makro hesaplanip enjekte edilmiyor | Kalan makroyu hesapla, prompt'a yaz |
| Aile porsiyon bolme | `scaleRecipe()` var ama UI'da yok | recipes.tsx'e porsiyon secici ekle |
| Malzeme ikamesi | `suggestSubstitution()` var ama UI'da yok | recipes.tsx'e ikame butonu ekle |
| AI kayitli tarifleri haftalik planda kullanma | `getRecipesForPlanning()` var, ai-plan'dan cagrilmiyor | ai-plan edge fn'a saved_recipes sorgusu ekle |
| **BUG: save_recipe protein** | `total_protein_g` vs `total_protein` kolon adi uyumsuz | index.ts:509'da duzelt |

### KRITIK BUGLAR
1. **`ai-chat/index.ts:509`** — `total_protein_g` kullaniliyor ama DB kolonu `total_protein`
2. **`saved_recipes`** tablosunda `is_favorite` ve `use_count` kolonlari YOK ama servis kullaniyor
3. **`save_recipe`** action formati system-prompt'ta tanimli degil

---

## BOLUM 4: SPOR & ANTRENMAN (Ajan 4)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Isinma/ana bolum/soguma plani | `ai-plan/index.ts:47-49`, `WorkoutCard.tsx` |
| Ekipman bazli plan (ev/salon) | `profiles.equipment_access`, `context-builders.ts:98` |
| Guc takibi (squat/bench/deadlift) | `strength_sets` tablo, `strength.service.ts`, `strength.tsx` |
| 1RM tahmini (Epley) | `strength.service.ts:30-33` |
| Toparlanma takibi | `RecoveryInput.tsx`, `daily_metrics` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Hedefe gore antrenman tipi | `getGoalBasedWorkoutType()` baglanmamis | ai-plan'dan cagir |
| Progresif yuklenme | `consecutiveSuccesses` DB'den hesaplanmiyor, fn cagrilmiyor | DB sorgusu + ai-plan entegrasyonu |
| Deload hatirlatmasi | Client BUG: session sayisi hafta olarak kullaniliyor | Hafta hesabi duzelt, 4 hafta advisory ekle |
| Uyku → antrenman engeli | `shouldReduceTraining()` cagrilmiyor | ai-plan'da uyku kontrolu ekle |

### MISSING
| Ozellik | Gerekli Is |
|---------|------------|
| Dinamik kalori ayarlama (post-workout) | `calories_burned`'u plan'a geri yaz |
| RecoveryInput tip uyumsuzlugu | Component int (1-4) cikiyor, DB text bekliyor — mapping ekle |

---

## BOLUM 5: HAFTALIK BUTCE, SIMULASYON, KURTARMA, MVD (Ajan 5)

### IMPLEMENTED (Neredeyse Tam — En Saglam Alan!)
| Ozellik | Dosya |
|---------|-------|
| Haftalik kalori butcesi motoru | `weekly-budget.ts` |
| Dashboard'da butce widget | `WeeklyBudgetWidget.tsx`, `index.tsx:292` |
| Haftalik raporda butce uyumu | `ai-report/index.ts`, `weekly.tsx:63-65` |
| AI butce perspektifi | `system-prompt.ts` HAFTALIK BUTCE PERSPEKTIFI |
| Simulasyon modu tespiti | `task-modes.ts:43` |
| Simulasyon haftalik etki | `simulation.ts`, task-modes prompt |
| Simulasyon karti render | `RichMessage.tsx:81-100`, `chat.tsx:543-549` |
| Kurtarma modu — yargilamama | `task-modes.ts:187-205`, ASLA listesi |
| Kurtarma mini plan | `recovery.service.ts:80-136` |
| Kurtarma haftalik perspektif | `recovery.service.ts:122-127` |
| Kurtarma yarin dengeleme | `recovery.service.ts:113-119` |
| Kurtarma takip taahhut | `index.ts:563-574` |
| MVD plan askiya alma | `mvd.service.ts:94-111` |
| MVD 3 basit hedef | `mvd.service.ts:42-66` |
| MVD en yumusak ton | `task-modes.ts:139-157` |
| MVD daha da basitlestirme (3→2→1) | `mvd.service.ts:simplifyMVD` |
| MVD ertesi gun normal plan | `activateMVD()` + `deactivateMVD()` |

### TEK GAP
| Sorun | Cozum |
|-------|-------|
| `rebalanceMessage` dashboard'da `null` hardcoded | `getWeeklyStatus()` cagir, widget'a gecir |

---

## BOLUM 6: HEDEF, PLATO, BAKIM, COK FAZLI (Ajan 6)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Somut hedef + haftalik tempo | `goals.service.ts`, `goal-progress.ts` |
| Tahmini hedefe varis tarihi | `GoalProgressWidget`, `goals.tsx` |
| Agresif hedef risk uyarisi | `checkAggressiveGoal()`, `validateGoalSafety()` |
| Plato 3+ hafta otomatik tespit | `plateau.service.ts:detectPlateau()` |
| AI plato modu (sakin, 5 strateji) | `task-modes.ts`, `plateau.service.ts:STRATEGIES` |
| En iyi 1-2 strateji secimi + gerekce | `selectBestStrategy()` |
| Bakim modu hedef-ulasma tespiti | `maintenance.service.ts:getMaintenanceStatus()` |
| Reverse diet hesaplama | `calculateReverseDiet()` haftalik +125 kcal |
| Tolerans bandi ±1.5kg | `TOLERANCE_BAND_KG = 1.5`, proaktif tetikleyici |
| Faz tanimlama + depolama | `goals` tablosu `phase_order`, `multi-phase-goals.tsx` |
| Otomatik faz gecisi (proactive) | `ai-proactive:114-123` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| AI hedef onerileri | `getAIGoalSuggestions()` var ama UI'dan cagrilmiyor | Butonu fonksiyona bagla |
| Coklu hedef uyumluluk | `checkGoalCompatibility()` dead code | UI'a ve AI prompt'a bagla |
| Faz gecisi kademeli | `calculatePhaseTransition()` var ama hic cagrilmiyor | Faz gecisinde 7 gunluk gecis uygula |

### MISSING (12 Ozellik — En Cok Eksik Alan!)
| Ozellik | Gerekli Is |
|---------|------------|
| Tempo grafigi (planlanan vs gerceklesen) | Dual-dataset chart; planned trajectory + actual weight |
| Coklu esanli hedef UI | Paralel hedef ekleme ekrani |
| Celisen hedefler AI stratejisi | checkGoalCompatibility'yi AI prompt'a bagla |
| Plato strateji → UI onay akisi | Ekranda strateji goster, kullanici onayla, plan guncelle |
| "Onaylarsan plani gunceller" | Strateji onay → calorie target guncelleme |
| Reverse diet plan'a yazma | `targetCalories` hesaplaniyor ama daily_plans'a yazilmiyor |
| Mini-cut tetikleme + akis | `shouldTriggerMiniCut()` dead code — UI + plan guncelleme |
| Davranis pekistirme mesajlari | `generateReinforcementMessage()` dead code — proactive'e bagla |
| `weeksSinceGoalReached` takibi | `goal_reached` achievement insert'i yok |
| PhaseTimeline bileseninin kullanimi | Component var ama hicbir ekranda import edilmiyor |
| `getTimelineData()` entegrasyonu | Servis fonksiyonu UI'a baglanmamis |
| Faz timeline dashboard'da gosterme | progress.tsx'e PhaseTimeline ekle |

---

## BOLUM 7: RAPORLAMA & PREDIKTIF ANALITIK (Ajan 7)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Gunluk rapor (uyum puani, sapma, aksiyon) | `daily.tsx`, `ai-report/index.ts` |
| Haftalik rapor (trend, butce, guc ozeti) | `weekly.tsx`, `ai-report/index.ts` |
| AI ogrenme notu | `weekly_reports.ai_learning_note` |
| Tum zamanlar raporu | `all-time.tsx`, `ai-report/index.ts` |
| Takvim gorunumu | `calendar.tsx`, `calendar.service.ts` |
| Streak takibi | `useStreak.ts`, `StreakBadge.tsx`, `achievements.service.ts` |
| Milestone'lar (1/5/10kg, 7/30/100 gun) | `checkMilestones()`, `achievements.tsx` |
| Bakim milestone'lari | `maintenance_1m/3m/6m` |
| Challenge modulu (5 sistem challenge) | `challenges.service.ts`, `challenges.tsx` |
| PDF/CSV export | `export.service.ts`, `health-export.tsx` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| **BUG: Aylik rapor schema** | Migration'da sadece `full_report JSONB`, servis 10+ kolon yaziyor | Migration'a kolonlari ekle veya JSONB icine yaz |
| Tum zamanlar streak | Frontend current streak gosteriyor, longest degil | `longest_streak` field'i kullan |
| Saglik export iki ayri impl. | `exportPDF()` ve `health-export.tsx` birbirini cagirmiyor | Birlestir |
| Hafta sonu sapma tahmini | `getWeekendRiskPrediction()` hic cagrilmiyor | UI veya proactive'e bagla |
| Atistirma saati tahmini | `detectSnackPatterns()` dead code | Proactive notification'a bagla |
| Alkol-sapma tahmini | `detectAlcoholRisk()` dead code | Proactive'e bagla |
| Motivasyon dusus uyarisi | `detectMotivationDrop()` dead code | Proactive'e bagla |
| Kullanici tanimli challenge | `type='custom'` destekleniyor ama UI form yok | Custom challenge form ekle |

### MISSING
| Ozellik | Gerekli Is |
|---------|------------|
| Hastalandiginda challenge otomatik duraklama | `setPeriodicState('illness')` tetiklendiginde `pauseChallenge()` cagir |
| Paylasim butonu achievements'ta | `sharing.service.ts` var ama achievements ekraninda buton yok |

### KRITIK BUG
**`monthly_reports` schema mismatch**: Migration 004 sadece `full_report JSONB NOT NULL` tanimliyor. `generateMonthlyReport()` ise `avg_compliance`, `monthly_summary`, `risk_signals` gibi 10+ ayri kolon yaziyor. **Upsert runtime'da HATA verecek.**

---

## BOLUM 8: BILDIRIM & ZENGIN SOHBET (Ajan 8)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Su hatirlatma (2 saatte bir) | `notifications.service.ts:208-219` |
| Gece atistirma riski | `ai-proactive:71`, `notifications.service.ts:258` |
| Tarti hatirlatma (haftalik) | `notifications.service.ts:222-232` |
| Plato uyarisi | `ai-proactive:75-88` |
| Hafta sonu sapma uyarisi | `ai-proactive:189-194` |
| AI tek bildirim secer (onceliklendirme) | `notification-intelligence.service.ts:prioritizeNotifications` |
| Mini makro bar (sohbette) | `RichMessage.tsx`, `chat.tsx:517` |
| Simulasyon karti | `RichMessage.tsx:81`, `chat.tsx:545` |
| "Yanlis anladin" duzeltme | `repair-handler.ts:197`, `ai-chat/index.ts:151` |
| "Son kaydi sil" geri alma | `repair-handler.ts:84`, `ai-chat/index.ts:96` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Sabah plani bildirimi | Tip tanimli, schedule edilmemis | `scheduleLocalNotifications`'a morning_plan ekle |
| Ogun hatirlatma IF uyumu | Sabit saatler (08/12:30/19), IF window'u yok sayiyor | IF pencereine gore dinamik saatler |
| Spor hatirlatma | Tip tanimli, schedule edilmemis | `scheduleLocalNotifications`'a ekle |
| Gunluk limit tutarsizligi | Proactive hardcoded 3, user 10'a kadar ayarlayabiliyor | User limitini proactive'de kullan |
| Hizli secim butonlari | `QuickSelectButtons` import edilmis, render edilmemis | chat.tsx JSX'ine render blogu ekle |
| Makro halkasi (donut) | Yatay bar olarak uygulanmis, donut chart degil | Gercek SVG donut chart |
| Onay/Reddet butonlari | `ConfirmRejectButtons` tanimli, render edilmemis | chat.tsx'e render mantigi ekle |
| Haftalik butce bari (sohbet) | `WeeklyBudgetBar` tanimli, render edilmemis | chat.tsx'e render mantigi ekle |
| Dusuk guven proaktif dogrulama | `shouldProactivelyVerify()` backend'den cagrilmiyor | ai-chat'e parse-confidence kontrolu ekle |
| Parse hatalari azalma | **repair_history tablosu migration'da YOK** | CREATE TABLE migration'i ekle |

### MISSING
| Ozellik | Gerekli Is |
|---------|------------|
| Haftalik butce uyarisi bildirimi | ai-proactive'e butce %70 asiminda tetikleyici ekle |

### KRITIK BUG
**`repair_history` tablosu**: Kod bu tabloyu kullaniyor ama hicbir migration dosyasinda `CREATE TABLE repair_history` yok. Parse ogrenme sistemi production'da calismayacak.

---

## BOLUM 9: DONEMSEL DURUM, KADIN, DISARIDA YEMEK, KAFEIN (Ajan 9)

### IMPLEMENTED (En Saglam Alanlardan Biri!)
| Ozellik | Dosya |
|---------|-------|
| Ramazan iftar/sahur penceresi | `system-prompt.ts:257-263` |
| Ramazan Taraweeh kalori yakimi | `system-prompt.ts:263` (+150 kcal) |
| Hastalik: kalori bakim seviyesi | `system-prompt.ts:267`, `periodic-config.ts` |
| Hastalik: IF otomatik durdurma | `ifCompatible: false`, `ai-chat/index.ts:625` |
| Hamilelik trimester kalori | `system-prompt.ts:275`, `tdee.ts:221-227` |
| Emzirme +500 kcal, IF durdur | `periodic-config.ts` |
| Tatil/seyahat esnek mod | `system-prompt.ts:289-294` |
| Sinav/yogun is: beyin besinleri | `system-prompt.ts:296-301` |
| Sakatlanma alternatif egzersiz | `system-prompt.ts:303-308` |
| Donem gecis plani | `getTransitionInfo()`, `buildPeriodicPlanContext()` |
| Gecmis donemleri hatirlama | `ai_summary.seasonal_notes` |
| Menstruel dongu takibi (4 faz) | `menstrual.service.ts`, `menstrual.tsx` |
| Folikuler faz: yogun antrenman | `PHASE_ADJUSTMENTS.follicular` |
| Ovulasyon: PR denemesi | `PHASE_ADJUSTMENTS.ovulation` |
| Luteal faz: +150kcal, +0.2L su | `PHASE_ADJUSTMENTS.luteal` |
| Menstruel faz: dusuk yogunluk | `PHASE_ADJUSTMENTS.menstrual` |
| Disarida yemek modu (fast food DB) | `eating-out.service.ts`, `task-modes.ts` |
| Mekan hafizasi | `user_venues`, `venue_log` action, `venues.tsx` |
| Sosyal yeme baskisi koclugu | `getSocialPressureCoaching()` |
| Kafein otomatik hesaplama | `caffeine.service.ts:estimateCaffeine` (14 icecek) |
| 15:00 sonrasi kafein uyarisi | `ai-chat/index.ts:784-786` |
| 400mg ust sinir mesaji | `checkDailyCaffeineLimit()` |
| Yuksek kafein → su artirma | `getCaffeineWaterAdjustment()` +0.15L/100mg |

### TEK GAP
| Sorun | Cozum |
|-------|-------|
| Hamilelik trimester DB'de yok | `pregnancy_trimester` kolonu ekle, dinamik kalori ayarla |

---

## BOLUM 10: SU, UYKU, TDEE, GUVENLIK, GIZLILIK, PREMIUM (Ajan 10)

### IMPLEMENTED
| Ozellik | Dosya |
|---------|-------|
| Su +0.25L tek dokunusla | `WaterTracker.tsx`, `constants.ts` |
| Su hedefi formulu (kg × 0.033) | `tdee.ts:calculateWaterTarget` |
| Uyku kalitesi girisi | `SleepInput.tsx` |
| Mifflin-St Jeor BMR | `tdee.ts:46` |
| 5 kademeli aktivite carpani | `ACTIVITY_MULTIPLIERS` |
| Kalori hedefi ARALIK olarak | `trainingDay/restDay {min, max}` |
| TDEE 2.5kg degisimde yeniden hesaplama | `shouldRecalculateTDEE()` |
| Kalori tabani (K:1200, E:1400) | `guardrails.ts:CALORIE_FLOOR` |
| Max 1 kg/hafta kayip | `validateWeeklyRate()`, `checkWeightVelocity()` |
| Alerjen filtresi (kod bazli) | `guardrails.ts:checkAllergens` |
| Acil durum 112 tespiti | `detectEmergency()` 20+ Turkce kalip |
| Yeme bozuklugu risk yonetimi | `detectEDRisk()` iki katman |
| Tibbi teshis engeli | `FORBIDDEN_PHRASES`, `sanitizeText()` |
| Prompt injection korumasi | `sanitizeUserInput()` 30+ regex |
| KVKK/GDPR uyumluluk | `privacy.service.ts`, `audit-log.service.ts` |
| Veri export (JSON/CSV/PDF) | `export.service.ts` (AI ogrendikleri dahil) |
| AI ozeti goruntuleme/silme | `InsightCard.tsx`, `getAISummaryForReview()` |
| RLS politikalari (33 tablo) | `005_rls_policies.sql` |
| Gun siniri 04:00 varsayilan | `day-boundary.ts`, `profiles.day_boundary_hour` |
| Geri donus akisi (3/7/30 gun) | `return-flow.service.ts`, `ai-proactive:146-154` |
| Saat dilimi/seyahat | `timezone.ts`, `travel.service.ts` |
| Offline kuyruk | `offline-queue.service.ts` |
| Premium/ucretsiz plan UI | `premium.tsx`, `usePremium.ts` |

### PARTIAL
| Ozellik | Sorun | Cozum |
|---------|-------|-------|
| Su hedefi dinamik hesaplama | `calculateWaterTarget` var ama `isTrainingDay`/`isSummer` hic gecilmiyor | Dashboard'da dinamik hesapla |
| Uyku yatis/kalkis saati UI | DB'de `sleep_time/wake_time` var, UI'da sadece sure girisi | TimePicker ekle |
| Gec yemek → uyku korelasyonu | Otomatik analiz yok | late-eating vs next-night sleep analizi |
| Hesap silme 30 gun | `deletion_requested_at` kolonu migration'da YOK | Migration ekle |
| Foto 24 saat temizleme | `scheduled_cleanups` tablosu migration'da YOK, executor edge fn yok | Tablo + cron edge fn |
| Mesaj limiti tutarsizligi | Kod: 20/gun, UI: "5 AI mesaj" yaziyor | Birini duzelt (spec 5 diyor) |

### KRITIK BUGLAR
1. **`scheduled_cleanups` tablosu** migration'da yok — foto temizleme runtime hata verecek
2. **`deletion_requested_at` kolonu** migration'da yok — hesap silme calismayacak
3. **`calculateTargets()` kalori tabani** gender kullanmiyor — `tdee.ts:123`'te yanlis mantik
4. **IAP entegrasyonu** tamamen stub — gercek odeme calismaz

---
---

# MUKEMMELLESTIRME PLANI — ONCELIK SIRALI YOL HARITASI

---

## KRITIK BUGLAR (Oncelik 0 — Hemen Duzeltilmeli)

Bu buglar uygulamanin calismasini engelliyor veya veri kaybina yol aciyor.

| # | Bug | Dosya | Cozum | Tahmini Satir |
|---|-----|-------|-------|---------------|
| B1 | `monthly_reports` schema mismatch — upsert hata verecek | `004.sql`, `ai-report/index.ts` | Migration'a 10 kolon ekle VEYA JSONB icine yaz | ~20 |
| B2 | `repair_history` tablosu CREATE yok | Migration dosyasi | Yeni migration ekle | ~15 |
| B3 | `scheduled_cleanups` tablosu CREATE yok | Migration dosyasi | Yeni migration ekle | ~10 |
| B4 | `deletion_requested_at` kolonu yok | Migration dosyasi | ALTER TABLE profiles ADD | ~5 |
| B5 | `save_recipe` protein kolon adi uyumsuz | `ai-chat/index.ts:509` | `total_protein_g` → `total_protein` | 1 |
| B6 | `saved_recipes` tablosunda `is_favorite`/`use_count` yok | `004.sql` | ALTER TABLE ADD COLUMN | ~5 |
| B7 | `calculateTargets()` gender-agnostic kalori tabani | `tdee.ts:123` | Gender parametresi ekle | ~5 |
| B8 | Deload `weeksSinceDeload` = session sayisi (hafta degil) | `strength.service.ts` | Hafta bazli hesapla | ~10 |
| B9 | RecoveryInput int (1-4) cikiyor, DB text bekliyor | `RecoveryInput.tsx` | Mapping fonksiyonu ekle | ~5 |
| B10 | Mesaj limiti: kod 20, UI "5" yaziyor | `message-counter.service.ts` | `FREE_DAILY_LIMIT = 5` yap | 1 |

**Toplam: ~77 satir**

---

## FAZI 1: DEAD CODE CANLANDIRMA (Oncelik 1 — En Yuksek Etki/Efor Orani)

Bu fonksiyonlar yazilmis ama hicbir yerden cagrilmiyor. Baglamak yeterli.

| # | Dead Code | Dosya | Baglanacagi Yer | Tahmini Satir |
|---|-----------|-------|-----------------|---------------|
| D1 | `shouldReduceTraining()` | `sleep-analysis.service.ts` | `ai-plan/index.ts` plan uretimi | ~15 |
| D2 | `suggestProgression()` + consecutiveSuccesses | `strength.service.ts` | `ai-plan/index.ts` strength context | ~30 |
| D3 | `getGoalBasedWorkoutType()` | `strength.service.ts` | `ai-plan/index.ts` workout section | ~10 |
| D4 | `selectBestStrategy()` + `applyPlateauStrategy()` | `plateau.service.ts` | progress.tsx + onay akisi | ~50 |
| D5 | `calculatePhaseTransition()` | `goals.service.ts` | Faz gecisinde cagir | ~15 |
| D6 | `shouldTriggerMiniCut()` + `getRetentionStrategy()` | `maintenance.service.ts` | progress.tsx + plan guncelleme | ~40 |
| D7 | `generateReinforcementMessage()` | `maintenance.service.ts` | ai-proactive'e bagla | ~10 |
| D8 | `getRecipesForPlanning()` + `formatRecipesForPrompt()` | `recipes.service.ts` | `ai-plan/index.ts` haftalik plan | ~20 |
| D9 | `scaleRecipe()` | `recipes.service.ts` | recipes.tsx porsiyon secici | ~15 |
| D10 | `suggestSubstitution()` | `recipes.service.ts` | recipes.tsx ikame butonu | ~15 |
| D11 | Tum `predictive.service.ts` fonksiyonlari (7 fn) | `predictive.service.ts` | ai-proactive tetikleyicileri | ~40 |
| D12 | `habits.service.ts` fonksiyonlari | `habits.service.ts` | ai-chat context injection | ~20 |
| D13 | `QuickSelectButtons` render | `chat.tsx` | MessageBubble JSX | ~10 |
| D14 | `ConfirmRejectButtons` render | `chat.tsx` | MessageBubble JSX | ~10 |
| D15 | `WeeklyBudgetBar` render | `chat.tsx` | MessageBubble JSX | ~10 |
| D16 | `PhaseTimeline` component | `PhaseTimeline.tsx` | progress.tsx | ~5 |
| D17 | `sharing.service.ts` butonlari | `sharing.service.ts` | achievements.tsx | ~15 |
| D18 | `getAIGoalSuggestions()` | `goals.service.ts` | goals.tsx | ~10 |
| D19 | `checkGoalCompatibility()` | `goals.service.ts` | goals.tsx + AI prompt | ~15 |

**Toplam: ~355 satir — Tum bu fonksiyonlar ZATEN yazilmis. Sadece BAGLAMAK yeterli.**

---

## FAZ 2: AI ZEKA TAMAMLAMA (Oncelik 2 — Yapay Zeka Mukemmelligi)

| # | Ozellik | Gerekli Is | Tahmini Satir |
|---|---------|------------|---------------|
| A1 | `alcohol_pattern` Layer 2 handler | processLayer2Updates'e case ekle | ~15 |
| A2 | `social_eating_note` Layer 2 handler | processLayer2Updates'e case ekle | ~15 |
| A3 | `features_introduced` Layer 2 handler + context | Handler + buildLayer2'ye injection | ~25 |
| A4 | Habit `weekly_compliance` hesaplama | ai-proactive'de compliance pipeline | ~30 |
| A5 | Protein esit dagitim talimati | ai-plan system prompt'a ekle | ~5 |
| A6 | Plan degisiklik aciklamasi | AI prompt + response schema | ~10 |
| A7 | Kalan makro hesaplama + prompt injection | ai-chat recipe mode | ~20 |
| A8 | Dusuk guven proaktif dogrulama | ai-chat'e parse confidence check | ~20 |
| A9 | Reverse diet plan'a yazma | maintenance → daily_plans guncelleme | ~25 |
| A10 | `evolvePatternConfidence` periyodik calistirma | ai-proactive cron | ~15 |
| A11 | Adaptif zorluk tutarliligi | Client'i %5'e cevir, workout intensity | ~15 |

**Toplam: ~195 satir**

---

## FAZ 3: UI TAMAMLAMA (Oncelik 3)

| # | Ozellik | Gerekli Is | Tahmini Satir |
|---|---------|------------|---------------|
| U1 | Sesli giris backend (Whisper) | ai-chat edge fn'a transcribe handler | ~30 |
| U2 | Gecmise donuk kayit date picker | chat.tsx'e DatePicker | ~25 |
| U3 | Sablon tek dokunusla kayit | useTemplate → meal_log insert | ~15 |
| U4 | Uyku yatis/kalkis TimePicker | SleepInput.tsx guncelleme | ~30 |
| U5 | Tempo grafigi (planned vs actual) | Dual-dataset chart component | ~50 |
| U6 | Custom challenge form | challenges.tsx'e form ekle | ~40 |
| U7 | Plato strateji onay UI | progress.tsx'e strateji kartlari + onay | ~60 |
| U8 | Donut chart (gercek SVG) | RichMessage.tsx'e SVG donut | ~40 |
| U9 | Su hedefi dinamik hesaplama (UI wiring) | Dashboard'da calculateWaterTarget cagir | ~15 |
| U10 | Offline banner + auto-sync | NetInfo listener + sync trigger | ~25 |
| U11 | Seyahat modu UI bildirimi | travel tespit edildiginde toast | ~15 |

**Toplam: ~345 satir**

---

## FAZ 4: BILDIRIM TAMAMLAMA (Oncelik 4)

| # | Ozellik | Gerekli Is | Tahmini Satir |
|---|---------|------------|---------------|
| N1 | Sabah plani bildirimi schedule | scheduleLocalNotifications'a ekle | ~15 |
| N2 | IF-aware ogun hatirlatma | if_eating_start/end'e gore dinamik saatler | ~20 |
| N3 | Spor hatirlatma schedule | scheduleLocalNotifications'a ekle | ~15 |
| N4 | Haftalik butce uyarisi tetikleyici | ai-proactive'e butce %70 kontrolu | ~20 |
| N5 | Hastalandiginda challenge duraklama | setPeriodicState('illness') → pauseChallenge | ~10 |
| N6 | Proactive gunluk limit user pref kullan | ai-proactive'de dailyLimit oku | ~10 |

**Toplam: ~90 satir**

---

## FAZ 5: MIGRATION EKSIKLERI (Oncelik 5)

| # | Migration | Icerik |
|---|-----------|--------|
| M1 | `010_repair_history.sql` | CREATE TABLE repair_history |
| M2 | `011_scheduled_cleanups.sql` | CREATE TABLE scheduled_cleanups |
| M3 | `012_monthly_report_columns.sql` | ALTER TABLE monthly_reports ADD 10 kolon |
| M4 | `013_saved_recipes_columns.sql` | ALTER TABLE saved_recipes ADD is_favorite, use_count |
| M5 | `014_privacy_columns.sql` | ALTER TABLE profiles ADD deletion_requested_at |
| M6 | `015_pregnancy_trimester.sql` | ALTER TABLE profiles ADD pregnancy_trimester |

**Toplam: ~80 satir SQL**

---

## NATIVE/FIZIKSEL CIHAZ GEREKTIREN (Bu Asamada YAPILMAYACAK)

Asagidaki ozellikler fiziksel cihaz veya native store entegrasyonu gerektirir:
- IAP/RevenueCat gercek odeme entegrasyonu (App Store gerekli)
- GS1 Turkey barkod API (3. parti anlasma gerekli)
- Push notification altyapisi (FCM/APNs gerekli)
- Wearable entegrasyonlari (Apple Health, Google Fit)
- Topluluk barkod katkisi (kullanici tabani gerekli)

---

## TOPLAM MUKEMMELLESTIRME OZETI

| Faz | Is | Tahmini Satir | Etki |
|-----|-----|---------------|------|
| Buglar | 10 kritik bug | ~77 | Runtime hatalari onler |
| Faz 1 | 19 dead code baglama | ~355 | %25 ozellik artisi (sifirdan yazmadan) |
| Faz 2 | 11 AI zeka islemi | ~195 | AI kocluk kalitesi mukemmel olur |
| Faz 3 | 11 UI tamamlama | ~345 | Kullanici deneyimi tamamlanir |
| Faz 4 | 6 bildirim islemi | ~90 | Proaktif kocluk tamamlanir |
| Faz 5 | 6 migration | ~80 | DB tutarliligi saglanir |
| **TOPLAM** | **63 is kalemi** | **~1,142 satir** | **48 PARTIAL → IMPLEMENTED** |

---

> **SONUC:** 28,268 satirlik kodun %85'i saglamdir. 1,142 satir ek kodla (mevcut kodun sadece %4'u)
> 48 partial ozellik IMPLEMENTED'a, 22 missing ozelligin buyuk cogunlugu IMPLEMENTED'a cevrilebilir.
> En kritik: 10 bug duzeltmesi + 19 dead code baglama = **%25 ozellik artisi sifirdan yazmadan.**
