# KOCHKO Arayuz Yeniden Tasarim - Ilerleme Takibi

## Genel Bakis
Detayli tasarim dokumanina gore tum arayuz yeniden tasarlaniyor.
- Flat dark design (gradient/shadow/glow yok)
- Teal accent (#1D9E75)
- 4 tab + center FAB navigasyon

## FAZ 1: Tema Sistemi + Tab Bar + FAB ✅ TAMAMLANDI

### Yapilan Degisiklikler:

**Tema (src/lib/theme.ts):**
- Renk paleti: purple (#6C63FF) → teal (#1D9E75)
- Yeni renkler: protein (#378ADD), carbs (#EF9F27), fat (#D85A30), purple (#7F77DD), pink (#D4537E)
- METRIC_COLORS objesi eklendi (flat renk referanslari)
- GRADIENTS deprecated (geriye uyumluluk icin duz renk olarak kaldi)
- Default tema dark olarak ayarlandi

**Constants (src/lib/constants.ts):**
- SPACING yeniden ayarlandi (md:12, lg:14, xl:16, xxl:24)
- FONT yeniden ayarlandi (md:14, lg:16, xl:20, hero:28)
- RADIUS: pill:99 eklendi
- CARD_SHADOW → CARD_BORDER (flat, 0.5px border)
- ELEVATED_SHADOW → CARD_BORDER

**UI Bilesenleri:**
- Button.tsx: yeni renkler, 8px radius, fontWeight 500
- Card.tsx: flat (12px radius, 0.5px border, padding 14px)
- Input.tsx: yeni stiller
- CircularProgress.tsx: flat (hero variant kaldirildi, text renkleri theme'den)
- GradientCard.tsx: flat card'a donusturuldu (gradient yerine acik arka plan + border)

**Tab Bar (app/(tabs)/_layout.tsx):**
- 4 tab + center FAB: Ana Sayfa | Koc | [+FAB] | Raporlar | Profil
- FAB: 56px teal daire, beyaz + ikonu, -20px margin-top
- plan.tsx tab olarak gizlendi (FAB placeholder)
- progress → Raporlar olarak rename edildi
- Aktif: teal, Pasif: #66667A

**Kayit Modali (app/log.tsx):**
- FAB'dan acilan modal: giris yontemleri, hizli kayit, diger kayitlar
- Flat design, yeni renkler

**Bilesenler guncellendi:**
- HeroSection: flat card, kalori halkasi, 3 makro bari, selamlama mesaji
- StatStrip: 2 sutun grid (su + adim), flat kartlar
- StreakBadge: teal pill, flame ikonu
- WaterTracker: flat, METRIC_COLORS
- SleepInput: METRIC_COLORS, flat borders
- ActivityTimeline: METRIC_COLORS
- SmartActions: flat hero action, flat secondary actions
- Profile: LinearGradient kaldirildi, renkler guncellendi

**Tum dosyalarda eski renk referanslari (#6C63FF, #FF6B6B, #A855F7) yeni palete guncellendi.**

---

## FAZ 2: Ana Sayfa (Dashboard) ✅ TAMAMLANDI

**Ana Sayfa (app/(tabs)/index.tsx) — tamamen yeniden yazildi:**
- SmartActions ("simdi ne yapsak?") ve MoodTracker/SleepInput/GoalProgress KALDIRILDI
- Bilgi odakli tasarim: hero → stats → haftalik butce → plan tablari → aktivite timeline
- HeroSection: selamlama mesaji (saate gore), kullanici adi, kalori halkasi, 3 makro bari
- StatStrip: 2 sutun grid (su + adim)
- Haftalik butce bari: inline (ayri widget yerine)
- Diyet/Spor alt tab secici (pill toggle): aktif plan ozeti gosterir
- Her iki tab'da "Detayli goster" linki → detay sayfasina gider
- Plan yoksa "Plan olustur" butonu → Koc sohbetine yonlendirir
- Tarti kaydi modal korundu (flat redesign)
- Rapor link kartlari KALDIRILDI (artik Raporlar sekmesi var)
- GRADIENTS → METRIC_COLORS kullanimi

**Yeni sayfalar:**
- `app/diet-plan.tsx` — Diyet plan detay sayfasi
  - Guncel plan: focus message, makro hedefleri, ogun listesi (MealOptionCard ile), atistirma stratejisi
  - Ogun secimi: tikla → meal_logs'a kaydet
  - Gecmis planlar: son 14 gun, tarih/kalori/status gosterimi, acilir/kapanir
- `app/workout-plan.tsx` — Spor program detay sayfasi
  - Guncel antrenman: tip/sure/RPE ozeti, isinma, ana bolum, guc hedefleri tablosu, soguma
  - Set tamamlama: checkmark ile isaretleme (lokal state)
  - "Antrenmani tamamla" butonu → Koc sohbetine bildirir
  - Gecmis antrenmanlar: son 14 gun, acilir/kapanir
- `app/_layout.tsx` — diet-plan ve workout-plan route'lari eklendi

## FAZ 3: Kayit Modali (FAB) ✅ TAMAMLANDI

**Kayit modali (app/log.tsx) — tam islevsel hale getirildi:**
- Multi-screen mimari: main | barcode | voice | weight | sleep
- **Yazarak gir:** Koc sohbetine yonlendirme
- **Fotograf cek:** Koc sohbetine yonlendirme (openCamera param)
- **Barkod okut:** CameraView + barkod tarama entegrasyonu
  - lookupBarcode servisi ile OpenFoodFacts API sorgusu
  - Bulunan urun AI kocuna gonderiliyor
  - Bulunamazsa kullaniciya bildirim
- **Sesli giris:** Mikrofon kaydi + Whisper API transkripsiyon
  - startRecording/stopRecording/transcribeAudio servisleri entegre
  - Transkripsiyon sonucu hizli kayit alanina yaziliyor
- **Su:** Tek dokunusta +0.25L, suspicious input kontrolu, router.back()
- **Tarti:** Fullscreen input (kg), decimal-pad, supabase kayit
- **Uyku:** Yatis/kalkis saati girisi, otomatik sure hesaplama, supabase kayit
- **Antrenman:** Koc sohbetine yonlendirme (prefill)

## FAZ 4: Koc (AI Sohbet) UI ✅ TAMAMLANDI

**Chat ekrani (app/(tabs)/chat.tsx) — stil guncellendi:**
- Balon stilleri: AI sol hizali (#1A1A24, 0.5px border, 16/16/16/4 radius), Kullanici sag hizali (teal, 16/16/4/16 radius)
- Max genislik %85
- Header: "AI kocun" basligi eklendi
- Input alani: 24px radius container, ikon butonlari sag tarafta (kamera, barkod, mikrofon, gonder)
- Ikon butonlari: 32px daire, #22222E arka plan
- Gonder butonu: 32px teal daire, arrow-up ikonu
- Typing indicator: flat balon, 0.5px border
- Empty state: flat suggestion pills (pill radius, 0.5px border)
- Undo banner: pill seklinde, warning renk
- CARD_SHADOW referanslari kaldirildi

**RichMessage (src/components/chat/RichMessage.tsx) — tamamen yeniden yazildi:**
- QuickSelectButtons: yatay scroll, pill seklinde, card bg + 0.5px border
- MacroSummary: cardElevated bg, METRIC_COLORS (protein/carbs/fat)
- ConfirmRejectButtons: teal filled "Onayla" + outline "Degistir"
- SimulationCard: flat, coral/teal renkler
- RecipeCard: cardElevated, METRIC_COLORS
- WeeklyBudgetBar: flat, 0.5px border
- ConfidenceBadge: yeni renk paleti (teal/amber/coral)

## FAZ 5: Raporlar Sekmesi ✅ TAMAMLANDI
- Baslik "Ilerleme" → "Raporlar" olarak degistirildi
- CARD_SHADOW kaldirildi, flat border eklendi
- Mevcut is logikleri korundu (plateau, maintenance, mini-cut, timeline)

## FAZ 6: Profil Sekmesi ✅ TAMAMLANDI
**Profil ekrani (app/(tabs)/profile.tsx) — tamamen yeniden yazildi:**
- Avatar: 64px daire, teal acik bg, bas harfleri
- Kullanici adi + streak bilgisi
- Fiziksel bilgiler: 3 sutun grid (mevcut kg, hedef kg, hedef tip) — cardElevated bg
- ProfileCompletion KALDIRILDI
- Hedefler bolumu: kilo/guc/uyku hedefleri, chevron ile ayarlar sayfasina link
- Ayarlar bolumu: bildirim, koc tonu, IF penceresi, gun siniri, alerjenler, donemsel durum
- Veri & gizlilik: AI hafizasi, veri export, profil duzenle, tum ayarlar, hesap silme (kirmizi)
- AI ozeti (InsightCard) korundu
- Cikis butonu alt kisimda
- Flat design: 0.5px border, ikon renkli, metin minimal

## FAZ 7: Ek Sayfalar ✅ TAMAMLANDI

**Tarif sayfasi (app/recipe.tsx) — yeni:**
- Tarif listesi: kayitli tariflerin FlatList'i (ikon, isim, kalori, sure, kategori)
- Tarif detay: makro ozeti (4 sutun), malzeme listesi, yapilis adimlari
- "Malzeme degistir" butonu → Koc sohbetine yonlendirme
- Bos durum: "Kocuna tarif sor" mesaji
- Servis: getRecipes() (recipes.service.ts) entegre

**Haftalik menu planlama (app/weekly-menu.tsx) — yeni:**
- 7 gunluk yatay takvim secici (gun adi + tarih + antrenman gunu nokta)
- Secili gun ogünleri: renkli noktalar (kahvalti=teal, ogle=amber, aksam=coral, ara=mor)
- Her ogun: isim + kalori + protein
- Gun toplami hesaplama
- Alisveris listesi: acilir/kapanir, checkmark ile isaretleme
- Bos durum: "Kocuna haftalik menu planla de" + plan olustur butonu
- Servis: getCurrentWeeklyPlan() (weekly-plan.service.ts) entegre

**Onboarding (app/onboarding.tsx) — stil guncellendi:**
- Emojiler (🎯💬🚀) → Ionicons ikonlari (heart-circle, chatbubble-ellipses, rocket) + 80px teal daire
- ChipSelect: pill radius (99px), 0.5px border
- Renk paleti COLORS uzerinden yeni teal/dark tema otomatik

**Route kayitlari:** recipe ve weekly-menu app/_layout.tsx'e eklendi

---

## TAMAMLANDI — TUM 7 FAZ

| Faz | Kapsam | Durum |
|-----|--------|-------|
| 1 | Tema + Tab Bar + FAB | ✅ |
| 2 | Ana Sayfa + Diyet/Spor detay sayfalari | ✅ |
| 3 | Kayit Modali (foto, barkod, ses, su, tarti, uyku) | ✅ |
| 4 | Koc Chat UI (balonlar, input, RichMessage) | ✅ |
| 5 | Raporlar sekmesi | ✅ |
| 6 | Profil sekmesi | ✅ |
| 7 | Tarif, haftalik menu, onboarding | ✅ |
