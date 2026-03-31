# KOCHKO BITIRME PLANI

## Durum Ozeti

- Mevcut kod: 14,750 satir
- Hedef: ~73,000 satir
- Eksik: ~58,000 satir
- Toplam paket: 20
- Her paket bagimsiz olarak %100 tamamlanacak

---

## PAKET SIRASI VE BAGIMLILIKLAR

```
Paket 1 (Onboarding) --> Paket 2 (Donemsel) --> Paket 7 (Bildirim)
                    \--> Paket 15 (Coklu Cihaz)

Paket 3 (Hedef) --> Paket 4 (Plan) --> Paket 9 (Tarif/Meal Prep)
              \--> Paket 8 (Raporlama)

Paket 5 (AI Ogrenme) --> Paket 6 (Zengin Sohbet)
                     \--> Paket 10 (Disarida Yemek)
                     \--> Paket 11 (Simulasyon)

Bagimsiz: 12, 13, 14, 16, 17, 18

Paket 17 --> Paket 19 (Widget)

Tumunu gerektirir: Paket 20 (Polish)
```

---

## PAKET 1: ONBOARDING VE HESAP TAMAMLAMA
- **Bagimllik:** Yok (temel)
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 1.2 Oturum Yonetimi: Supheli giris tespiti, "Beni hatirla" toggle UI
- 1.4 Hesap Yonetimi: Hesap silme (30 gun geri alma suresi, KVKK/GDPR), email degistirme, hesap baglama (account linking)
- 15 Onboarding Akisi: Tam kalibrasyon formu, adim adim profil doldurma, ilk sohbet baslangici
- 2.2 Profil Doldurma Stratejisi: Tamamlanma yuzdesi hesaplama, zorunlu vs opsiyonel alan ayirimi

### Spec Referanslari:
- Bolum 1.2 (satirlar 27-31)
- Bolum 1.4 (satirlar 44-53)
- Bolum 2.2 (satirlar 101-110)
- Bolum 15 (satirlar 1654-1693)

---

## PAKET 2: DONEMSEL DURUM VE MEVSIMSEL FARKINDALIK
- **Bagimllik:** Paket 1
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 9.2 Donemsel Durum Akisi: Durum degistiginde AI planlarini otomatik yeniden ayarlama, gecis planlama
- 9.3 Donemsel Durum Hafizasi: Gecmis durumlari Katman 2'ye yazma
- 9.4 IF Donemsel Yonetimi: Gecici IF denemeleri, uyum sureci, pencere disi hatirlatma kaldirma
- 5.17 Mevsimsel Farkindalik: Ramazan, bayram, yaz/kis mevsimsel ogun onerileri

### Spec Referanslari:
- Bolum 9 (satirlar 1354-1394)
- Bolum 5.17 (spec icinde)

---

## PAKET 3: HEDEF MOTORU TAMAMLAMA
- **Bagimllik:** Yok
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 6.1-6.2 Hedef Tanimlama: Hedef uyumluluk matrisi, agresif hedef risk uyarilari, coklu hedef onceliklendirme
- 6.3 Hedef Takibi: Dashboard bileseni, ilerleme gorselleri
- 6.4 Hedef Guncelleme: AI-driven hedef onerileri, otomatik revizyon tetikleyicileri
- 6.6 Bakim Modu: Reverse diet otomasyonu (kademeli kalori artisi), mini-cut tetikleme

### Spec Referanslari:
- Bolum 6 (satirlar 1040-1140)

---

## PAKET 4: PLAN URETIMI DERINLESTIRME
- **Bagimllik:** Paket 3
- **Tahmini:** ~4,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 7.1 Plan Turleri: Haftalik menu plani + alisveris listesi, protein zamanlama optimizasyonu, alkol planlamasi, haftalik butce baglami
- 7.2 Plan Uretim Dongusu: Zamanlanmis (sabah) plan uretimi, plan guncelleme tetikleyicileri, plan reddetme akisi
- 7.3 Plan Versiyon Gecmisi: Versiyon saklama, onceki planlara donme
- Haftalik plan AI edge function olusturma

### Spec Referanslari:
- Bolum 7.1-7.4 (satirlar 1141-1258)

---

## PAKET 5: AI OGRENME VE ZEKA
- **Bagimllik:** Yok
- **Tahmini:** ~3,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 5.8 Ozel Takip Kriterleri: AI'in kullanici icin ozel metrik belirlemesi
- 5.9 Iletisim Tonu Evrimi: Zaman icinde ton ogrenme mekanizmasi
- 5.10 Celsiski Yonetimi: Profil ile davranis uyumsuzlugu tespiti, cozum onerileri
- 5.12 Duzeltmelerden Ogrenme: Otomatik geri bildirim dongusu
- 5.15 Kullanici Persona Tespiti: Davranissal veriden persona cikarma
- 5.16 Mikro Besin Farkindailigi: Risk sinyali tespiti
- 5.19 Otomatik Ogun Zamani Ogrenme: Yeme aliskanligi analizi
- 5.21 Haftalik Ogrenme Notu: Otomatik uretim
- 5.23 Porsiyon Kalibrasyonu: Onboarding foto + surekli ogrenme dongusu
- 5.28 Dil Tutarliligi: Ingilizce terim esleme, karisik dil toleransi
- 5.31 Beslenme Okuryazarligi: Seviye tespiti ve uyarlama

### Spec Referanslari:
- Bolum 5.8-5.12, 5.15-5.16, 5.19, 5.21, 5.23, 5.28, 5.31

---

## PAKET 6: ZENGIN SOHBET VE SEFFAFLIK
- **Bagimllik:** Paket 5
- **Tahmini:** ~3,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 5.11 Seffaflik Mekanizmasi: "Neden?" butonlari, AI karar aciklamasi
- 5.18 Sohbet Gecmisi Arama: Backend arama motoru, UI
- 5.20 Zengin Sohbet Yanitlari: Mini chart, butonlar, kartlar, ilerleme halkalari, custom message renderer
- 5.32 Sohbet Onarim: Dusuk guven parse tespiti, otomatik yeniden sorma

### Spec Referanslari:
- Bolum 5.11, 5.18, 5.20, 5.32

---

## PAKET 7: BILDIRIM SISTEMI TAMAMLAMA
- **Bagimllik:** Paket 2
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 10.1 Eksik bildirim turleri: Ogun/antreman zamani hatirlatma, gece atiştirma riski, plato uyarisi, prediktif alert, bakim bandi uyarisi, uyku zamani
- 10.3 Bildirim Izni UX: Contextual zamanlama, 3-5 gun retry, "Ayarlar'dan ac" fallback
- 10.4 Re-engagement: Kisisellestirilmis mesajlar (Katman 2 bazli), streak gecmisi kurtarma, email fallback (14/30 gun)

### Spec Referanslari:
- Bolum 10 (satirlar 1395-1460)

---

## PAKET 8: RAPORLAMA GELISTIRME
- **Bagimllik:** Paket 3
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 8.3 Aylik Rapor: AI analizi edge function, risk sinyalleri (asiri kisit, uyku bozuklugu, motivasyon dususu), davranis deseni ozeti, kan degeri trendleri
- 8.5 Gorsel Dashboard: Interaktif zaman serisi grafikleri (charting library), makro trend grafikleri, HRV/stres gorselleri
- 8.7 Profesyonel Export: PDF export (profesyonel layout), secmeli alan dahil etme, saglik profesyoneli formati

### Spec Referanslari:
- Bolum 8.3, 8.5, 8.7 (satirlar 1259-1353)

---

## PAKET 9: TARIF VE MEAL PREP
- **Bagimllik:** Paket 4
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 7.7 Tarif Kutuphanesi: Backend servis, tarif CRUD, malzeme ikamesi, "elimde sunlar var" modu, makro bilgisi, zorluk seviyesi
- 7.6 Meal Prep: Tam AI entegrasyonu, saklama suresi tahmini, mevsimsel ayarlama, toplu hazirlama plani

### Spec Referanslari:
- Bolum 7.6-7.7 (satirlar 1220-1258)

---

## PAKET 10: DISARIDA YEMEK VE MEKAN
- **Bagimllik:** Paket 5
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 7.4 Disarida Yemek Planlama: Restoran plan revizyonu, menu fotografi analizi, en iyi secim onerisi
- Mekan Hafizasi: Venue servis gelistirme, gecmis siparisleri hatirlama
- Sosyal Yeme Baskisi Koclugu: Sosyal ortamda yeme stratejileri

### Spec Referanslari:
- Bolum 7.4 (satirlar 1200-1220)

---

## PAKET 11: SIMULASYON VE ILERI AI
- **Bagimllik:** Paket 5
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- Simulasyon Modu: "Sunu yesem ne olur?" senaryolari, kalori/makro etki hesabi
- 5.3 Karar Oncelik Sirasi: Birlesik oncelik kuyrugu implementasyonu
- 5.14 Prediktif Analitik Genisleme: Duygu-yeme tespiti, uyku-beslenme korelasyonu
- 5.22 Debug/Seffaflik Modu: Token butce gosterimi, mod tespit loglama

### Spec Referanslari:
- Bolum 5.3, 5.14, 5.22

---

## PAKET 12: GUVENLIK VE GUARDRAIL DERINLESTIRME
- **Bagimllik:** Yok
- **Tahmini:** ~2,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 12.2 Egzersiz Guardrail: Sakatlik onleme kontrolu, uyku kalitesine gore yogunluk kisitlama, arka arkaya agir gun limiti, deload zorunlulugu
- 12.3 Tibbi Guardrail: Kan degeri anomali tespiti, ilac etkilesim yonlendirmesi, yeme bozuklugu risk tespiti
- 5.10 Celiskit Yonetimi: Kod bazli celsiski tespiti ve cozum

### Spec Referanslari:
- Bolum 12.2-12.3 (satirlar 1497-1561)

---

## PAKET 13: TURK BESIN VERITABANI VE BARKOD
- **Bagimllik:** Yok
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 19.1 Barkod: GS1 Turkiye entegrasyonu, market API baglantilari
- 19.2 Kullanici Duzeltmeleri: Kisisel porsiyon hafizasi UI, duzeltme akisi
- 19.3 Topluluk Katkisi: Bulunamayan barkod loglama, kullanici katki akisi, manipulasyon korumasi

### Spec Referanslari:
- Bolum 19 (satirlar 1861-1905)

---

## PAKET 14: ODEME VE PREMIUM
- **Bagimllik:** Yok
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 16.3 Odeme Akisi: RevenueCat / App Store IAP entegrasyonu, odeme UI, trial-to-paid gecisi
- 16.5 Iptal/Downgrade: Mevcut planlarin read-only korunmasi, bildirim durdurma, grace period
- Upsell Trigger Noktalari: Premium ozelliklere erisim engeli UI, contextual upsell

### Spec Referanslari:
- Bolum 16.3, 16.5 (satirlar 1694-1788)

---

## PAKET 15: COKLU CIHAZ VE SENKRONIZASYON
- **Bagimllik:** Paket 1
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 1.3 Coklu Cihaz: Aktif oturum listesi, uzaktan oturum kapatma
- Eszamanli AI Sohbet: Sohbet oturum kilidi, 15 dk timeout, cihazlar arasi tasima
- Plan Durumu Senkronizasyonu: Onay/goruntuleme durumu cihazlar arasi sync
- 11.3 Sync Genisletme: Plan verisi icin server oncelik stratejisi

### Spec Referanslari:
- Bolum 1.3 (satirlar 32-41)
- Bolum 11.3 (satirlar 1497-1496)

---

## PAKET 16: SES VE MEDYA
- **Bagimllik:** Yok
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- Sesli Giris: STT server implementasyonu, transkripsiyon backend
- 20.3 AI Sesli Yanit (TTS): expo-speech entegrasyonu, sesli yanit oynatma
- Fotograf UI: Ogun fotografi cekim/galeri UI tamamlama, fallback akisi
- Ilerleme Fotografi: Yuz bulaniklastirma opsiyonu, zaman cizgisi iyilestirme

### Spec Referanslari:
- Bolum 20.3, 3.1 (foto kismi)

---

## PAKET 17: WEARABLE VE SENSORLER
- **Bagimllik:** Yok
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 14.1 Wearable: Apple Health entegrasyonu, Google Fit/Health Connect, Garmin/Fitbit API
- 14.2 Telefon Sensoru: iOS Core Motion / Android Activity Recognition gercek entegrasyonu
- HRV/Recovery: Wearable'dan HRV verisi cekme, toparlanma skoru hesaplama

### Spec Referanslari:
- Bolum 14 (satirlar 1620-1653)

---

## PAKET 18: ERISILEBILIRLIK VE COKLU DIL
- **Bagimllik:** Yok
- **Tahmini:** ~3,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 22 Erisilebilirlik: Tam a11y audit, ekran okuyucu destegi (aria-label), renk korlugu desenleri, WCAG AA kontrast, buyuk font adaptasyonu
- 20.2 Coklu Dil: i18n framework kurulumu (react-intl veya i18next), Turkce key cikarma, Ingilizce ceviri

### Spec Referanslari:
- Bolum 22 (satirlar 2048-2070)
- Bolum 20.2

---

## PAKET 19: MOBIL WIDGET
- **Bagimllik:** Paket 17
- **Tahmini:** ~2,500 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 23 Widget Destegi: Gunluk ozet widget, bugunun odagi widget, hizli kayit widget, streak widget, adim widget, haftalik butce widget
- Offline calisma: Widget'larin offline veriyle calismasi

### Spec Referanslari:
- Bolum 23 (satirlar 2086-2100)

---

## PAKET 20: B2B, AILE, POLISH VE METRIKLER
- **Bagimllik:** Tum paketler
- **Tahmini:** ~4,000 satir
- **Durum:** [ ] Planlanmadi

### Kapsam:
- 20.1 B2B Koc Modu: Rol/izin sistemi, veri paylasim onayi, koc dashboard
- 20.4 Aile Plani: Household destegi, ortak alisveris listesi, paylasilan tarif
- 5.25 AI Model Versiyonlama: A/B test altyapisi, model performans karsilastirmasi
- 5.27 Yanit Suresi (SLA): Timeout zorunlulugu, streaming destegi
- 24 Basari Kriterleri: Analitik endpoint'leri, metrik toplama, KPI dashboard
- Zamanlanmis otomatik export + Katman 2 export
- AI system prompt versiyonlama ve rollback

### Spec Referanslari:
- Bolum 20.1, 20.4, 24, 5.25, 5.27

---

## PAKETLERE GIRMEYEN EKSIKLER (Mevcut paketlere dagitilacak)

Asagidaki ozellikler analizde PARTIAL/STUB cikmis ama hicbir pakete atanmamisti:

### Paket 1'e eklenecek:
- 2.5 Saat Dilimi ve Seyahat: Timezone degisim tespiti, jet lag uyumu, seyahat tespiti (Faz 4 item 50)

### Paket 3'e eklenecek:
- 3.2 Kayit Duzenleme/Silme: 10 sn geri alma (undo) penceresi, degisiklik gecmisi

### Paket 5'e eklenecek:
- AI oneri geri bildirimi: "ise yaradi/yaramadi" butonu (Faz 2 item 23)
- 5.24 eksik: Hizli kurtarma modu - "bugun cok yedim" (Faz 2 item 25)
- MVD (Minimum Viable Day) modu tamamlama (Faz 2 item 18)

### Paket 6'ya eklenecek:
- AI feedback butonlari: FeedbackButtons.tsx bileseni mevcut ama backend entegrasyonu eksik

### Paket 7'ye eklenecek:
- Uyku zamani hatirlatmasi
- Commitment followup bildirimleri

### Paket 8'e eklenecek:
- 8.5 Dashboard: Compliance score trendi, streak gorseli iyilestirme

### Paket 12'ye eklenecek:
- Fotograf retansiyon (24 saat sonra otomatik silme job'u)
- Aşırı porsiyon tespiti ("50 yumurta yedim" gibi metin kontrolu)

### Paket 13'e eklenecek:
- JSON import destegi (su an sadece CSV var)

### Paket 14'e eklenecek:
- Trial-to-paid conversion tracking analitik

---

## ILERLEME TAKIBI

| Paket | Plan | Uygulama | Test | Durum |
|-------|------|----------|------|-------|
| 1. Onboarding & Hesap | [x] | [x] | [ ] | Tamamlandi |
| 2. Donemsel Durum | [ ] | [ ] | [ ] | Bekliyor |
| 3. Hedef Motoru | [ ] | [ ] | [ ] | Bekliyor |
| 4. Plan Uretimi | [ ] | [ ] | [ ] | Bekliyor |
| 5. AI Ogrenme | [ ] | [ ] | [ ] | Bekliyor |
| 6. Zengin Sohbet | [ ] | [ ] | [ ] | Bekliyor |
| 7. Bildirim | [ ] | [ ] | [ ] | Bekliyor |
| 8. Raporlama | [ ] | [ ] | [ ] | Bekliyor |
| 9. Tarif & Meal Prep | [ ] | [ ] | [ ] | Bekliyor |
| 10. Disarida Yemek | [ ] | [ ] | [ ] | Bekliyor |
| 11. Simulasyon | [ ] | [ ] | [ ] | Bekliyor |
| 12. Guvenlik | [ ] | [ ] | [ ] | Bekliyor |
| 13. Turk Besin DB | [ ] | [ ] | [ ] | Bekliyor |
| 14. Odeme & Premium | [ ] | [ ] | [ ] | Bekliyor |
| 15. Coklu Cihaz | [ ] | [ ] | [ ] | Bekliyor |
| 16. Ses & Medya | [ ] | [ ] | [ ] | Bekliyor |
| 17. Wearable | [ ] | [ ] | [ ] | Bekliyor |
| 18. Erisilebilirlik & i18n | [ ] | [ ] | [ ] | Bekliyor |
| 19. Mobil Widget | [ ] | [ ] | [ ] | Bekliyor |
| 20. B2B, Aile, Polish | [ ] | [ ] | [ ] | Bekliyor |
