# Kochko Çalışma Senaryosu — Detaylı Mimari Akış

## 1. Kullanıcı Uygulamayı İlk Açtığında

### 1.1 Kayıt & Giriş
- Kullanıcı email/şifre veya Google ile kayıt olur
- Supabase Auth session oluşturur (ES256 JWT token)
- `profiles` tablosuna kayıt eklenir (`onboarding_completed: false`)
- Uygulama `/(tabs)` ana sayfaya yönlendirir

### 1.2 Kochko Sekmesi — İlk Karşılama
- Kullanıcı Kochko sekmesine gelir
- **Session listesi boş** — "Kochko ile tanış" butonu görünür
- **Yapılacaklar kartları** üstte horizontal scroll:
  1. "Kendini tanıt" (boy, kilo, yaş, cinsiyet)
  2. "Hedefini belirle" (ne istiyorsun, neden)
  3. "Günlük rutinini anlat" (meslek, saatler)
- İlk 2 kart her zaman görünür (zorunlu), 3. kart progressive disclosure ile

---

## 2. Kart Tıklama Akışı (Onboarding)

### 2.1 Kullanıcı "Kendini tanıt" kartına tıklar

**Frontend:**
1. `createSession({ title: "Kendini tanıt", topicTags: ["introduce_yourself"] })` çağrılır
2. Mevcut aktif session varsa kapatılır (`is_active: false, ended_at: now`)
3. Yeni session oluşturulur (`is_active: true`)
4. `/chat/{sessionId}?taskModeHint=onboarding_intro` sayfasına yönlendirilir

**Session Detail Ekranı:**
1. `taskModeHint` parametresi algılanır
2. Kullanıcı hiçbir şey yazmaz — AI ilk mesajı atar
3. `sendMessageToSession(sessionId, "[SYSTEM_INIT]...", "onboarding_intro")` çağrılır

**Edge Function (ai-chat):**
1. `body.task_mode_hint = "onboarding_intro"` algılanır
2. System prompt'a özel talimat enjekte edilir:
   ```
   === ONBOARDING KART OTURUMU ===
   Bu sohbet kullanıcının kendini tanıtması için açıldı.
   Boy, kilo, yaş, cinsiyet bilgilerini öğren.
   
   KURALLAR:
   1. İLK MESAJDA: Bu konu hakkında bildiklerini özetle ve eksikleri sor
   2. Başka konularda da bilgi çıkarsa kaydet
   3. Yeterli bilgi topladığında: <layer2_update>{"onboarding_task_completed": "introduce_yourself"}</layer2_update>
   4. "Bu konuda yeterli bilgi aldım, teşekkürler!" de
   5. Kullanıcı bilmiyorsa zorlama
   ```
3. Layer 1/2/3 context normal şekilde oluşturulur (profil, AI özeti, son veriler)
4. Layer 4 session bazlı filtrelenir (sadece bu session'ın mesajları)
5. AI yanıt üretir: "Merhaba! Seni tanımak istiyorum. Şu ana kadar profilde boy, kilo gibi bilgilerin yok. Boyun kaç cm, kilon kaç kg, kaç yaşındasın?"

**AI Yanıtı Geri Dönünce:**
1. Mesaj `chat_messages` tablosuna yazılır (session_id ile)
2. Session başlığı ilk kullanıcı mesajından oluşturulur
3. Frontend'de AI mesajı balon olarak gösterilir

### 2.2 Kullanıcı Cevap Yazar: "191 boy 130 kilo 25 yaşında erkeğim"

**Edge Function:**
1. AI mesajı parse eder
2. `<actions>` tag'ı ile profil güncelleme çıkarır:
   ```json
   [{"type": "profile_update", "height_cm": 191, "weight_kg": 130, "birth_year": 2001, "gender": "male"}]
   ```
3. `executeActions` çalışır → `profiles` tablosu güncellenir
4. AI yanıt verir: "Harika! 191 cm, 130 kg, 25 yaş. Başka eklemek istediğin bir şey var mı?"

**Eğer kullanıcı ek bilgi verirse:**
- "Masa başı çalışıyorum 9-6 arası" → AI bunu da `profile_update` ile kaydeder:
  ```json
  [{"type": "profile_update", "occupation": "masa başı", "work_start": "09:00", "work_end": "18:00"}]
  ```
- **Cross-topic extraction:** Ana konu "kendini tanıt" olsa bile başka konulardaki bilgiler de kaydedilir

### 2.3 AI "Yeterli Bilgi Aldım" Kararı

AI en az 2-3 mesaj alıp ana soruların çoğu cevaplandığında:
1. Son mesajında: "Bu konuda yeterli bilgi aldım, teşekkürler!"
2. `<layer2_update>{"onboarding_task_completed": "introduce_yourself"}</layer2_update>` emit eder
3. `memory.ts` → `ai_summary.onboarding_tasks_completed` array'ine `"introduce_yourself"` eklenir

### 2.4 Kullanıcı Geri Döner

1. Kullanıcı ← butonu ile Kochko session listesine döner
2. `useFocusEffect` tetiklenir → `fetchSessions()` + `getIncompleteTasks()` çalışır
3. "Kendini tanıt" kartı artık `checkCompletion` → `true` döner (profil alanları dolu VEYA `onboarding_tasks_completed` array'inde var)
4. Kart kaybolur
5. Sıradaki kartlar görünür: "Hedefini belirle", "Günlük rutinini anlat", "Beslenme alışkanlıklarını anlat"

---

## 3. Normal Sohbet Akışı (Kart Dışı)

### 3.1 Kullanıcı + Butonuna Basar
1. Yeni session oluşturulur
2. Boş chat ekranı açılır (EmptyState + suggestion pills)
3. Kullanıcı istediği konuyu yazar veya suggestion'a tıklar

### 3.2 Kullanıcı Mesaj Yazar: "Bugün kahvaltıda 2 yumurta yedim"

**Frontend:**
1. `sendMessageToSession(sessionId, "Bugün kahvaltıda 2 yumurta yedim")` çağrılır
2. Mesaj optimistic olarak ekranda gösterilir
3. "Kochko yazıyor..." gösterilir

**Edge Function:**
1. Auth doğrulama (`getUserId` → `auth.getUser(token)`)
2. Güvenlik kontrolleri (injection, rate limit, emergency, ED risk)
3. Task mode algılama: `detectTaskMode("Bugün kahvaltıda 2 yumurta yedim")` → `"register"`
4. Message analizi: `analyzeMessage(...)` → retrieval plan oluşturulur
5. 4 katmanlı context oluşturulur:
   - **Layer 1:** Profil (boy, kilo, yaş, hedefler, alerjiler, meslek, uyku, stres...)
   - **Layer 2:** AI özeti (davranış kalıpları, porsiyon kalibrasyonu, persona)
   - **Layer 3:** Son 7-14 gün verileri (öğünler, antrenmanlar, metrikler, kan tahlili→diyet etkisi)
   - **Layer 4:** Bu session'ın mesajları (session_id ile filtrelenmiş)
6. System prompt oluşturulur (base + mode instructions + context)
7. OpenAI API çağrılır
8. AI yanıtı parse edilir:
   - `<actions>` → meal_log oluşturulur
   - `<layer2_update>` → AI özeti güncellenir (async)
9. Mesajlar `chat_messages`'a yazılır (session_id ile)
10. Dashboard refresh tetiklenir

**Frontend'e Dönen Yanıt:**
```json
{
  "message": "2 yumurta kaydettim! 🥚 Toplam ~156 kcal, 12g protein.",
  "actions": [{"type": "meal_log", "feedback": "Kahvaltı kaydedildi"}],
  "task_mode": "register"
}
```

### 3.3 Dashboard Güncellenir
- `refreshDashboard(userId)` → bugünün kalori, makro, su verileri yenilenir
- Ana sayfa kalori halkası güncellenir
- Aktivite timeline'a yeni öğün eklenir

---

## 4. Veri Çıkarsama Mimarisi (3 Katman)

### 4.1 Tier 1 — ANLIK (Her Mesajda)
- AI zaten her mesajda `<actions>` ile veri çıkarır
- `profile_update` action'ı 45+ profil alanını yazabilir
- Maliyet: $0 ek (ana chat modeli zaten yapıyor)

**Örnek:** Kullanıcı "ben vegan'ım" derse:
```json
<actions>[{"type": "profile_update", "dietary_restriction": "vegan"}]</actions>
```

### 4.2 Tier 2 — GÜNLÜK CRON (GPT-4o-mini)
- Her gece 03:00'te `ai-extractor` edge function çalışır
- Son checkpoint'ten bu yana olan mesajları tarar
- 20 orta-öncelikli veri başlığını kontrol eder:
  - Meslek, çalışma saatleri, uyku, öğün sayısı, bütçe, stres...
- Bulunan verileri `profiles` tablosuna yazar
- Checkpoint günceller (son kontrol edilen mesaj ID)
- Maliyet: ~$0.01-0.02/kullanıcı/gün

**Akış:**
1. `ai_summary.extraction_checkpoint` okunur
2. `checkpoint.tier2_last` zamanından sonraki mesajlar çekilir
3. GPT-4o-mini'ye gönderilir: "Bu mesajlardan şu bilgileri çıkars..."
4. JSON döner: `{"occupation": "yazılım mühendisi", "stress_level": "orta"}`
5. Non-null değerler profile yazılır
6. Checkpoint güncellenir

### 4.3 Tier 3 — HAFTALIK CRON (GPT-4o-mini)
- Haftada 1 kez (Pazar gece) çalışır
- 15 düşük-öncelikli veri başlığını kontrol eder:
  - Eski diyetler, spor geçmişi, duygusal yeme, gece yeme, mutfak ekipmanı...
- Daha derin çıkarsama (davranış kalıpları, stres ilişkisi)
- Maliyet: ~$0.02-0.05/kullanıcı/hafta

---

## 5. AI Context'in Nasıl Oluştuğu

### 5.1 Layer 1 — Profil (Her Zaman)
```
## ZAMAN
Pazartesi, 14:30 | 2026-04-07

## PROFİL
Cinsiyet: erkek | Yaş: 25 | Boy: 191cm | Kilo: 130kg

## GÜNLÜK RUTİN
Meslek: yazılım mühendisi
Çalışma: 09:00-18:00
Uyku: 23:30-07:00
Stres: orta (iş kaynaklı)

## MOTİVASYON
Kaynak: sağlık, özgüven
En büyük zorluk: gece atıştırması
Geçmiş diyetler: keto 3 ay denedim, 5kg verdim ama geri aldım

## ANTRENMAN
Deneyim: 3 yıldır düzensiz salon
Tercih: güç ağırlıklı, kardiyo olarak yürüyüş
Sevmediği: koşu, burpee
Saatler: akşam 19-21

## BESLENME PROFİLİ
Öğün sayısı: 3
Dışarıda yeme: haftada 2-3
Duygusal yeme: stresli olunca çikolata
Diyet kısıtlama: yok
Sindirim: reflü

## MUTFAK
Pişirme: temel
Bütçe: orta
Ekipman: fırın, airfryer, tartı
Kim pişiriyor: eşim

## SAĞLIK GEÇMİŞİ
Aktif:
- [surgery] Tüp mide ameliyatı (2023)
- [medication] Tiroid ilacı günlük
Geçmiş:
- [injury] Diz sakatlığı (2022, iyileşti)
Sindirim: reflü
Hormon: tiroid

## KAN TAHLİLİ → DİYET ETKİSİ
- Kolesterol: 240 mg/dL → Doymuş yağ azalt, lif artır
- D vitamini: 15 ng/mL → D vitamini takviyesi öner

## HEDEFLER
Kilo Ver: 90kg | sustainable | 0.5kg/hafta

## ASLA ÖNERME
Fıstık, karides
ALERJENLER: Fıstık (CİDDİ)

## SEVDİKLERİ
Tavuk, yumurta, pirinç
```

### 5.2 Layer 2 — AI Özeti (Persistent Memory)
```
## GENEL ÖZET
Kullanıcı disiplinli ama gece atıştırma sorunu var. Tüp mide geçmişi nedeniyle porsiyonlar küçük tutulmalı.

## DAVRANIŞLAR
- gece_atistirma: Gece 23:00-01:00 arası çikolata/bisküvi (yüksek güven)
  Tetik: stres, yalnızlık
  Müdahale: erken yatış + protein ağırlıklı akşam yemeği
  
- hafta_sonu_bozulma: Cumartesi/Pazar dışarıda yeme (orta güven)
  Müdahale: haftalık bütçe esnetme

## PORSİYON KALİBRASYONU
1_tabak_pilav: 180g
1_dilim_ekmek: 25g
1_porsiyon_et: 120g

## KAS KAYITLARI
bench_press: { 1rm: 60, son_ağırlık: 50, son_tekrar: 8 }
squat: { 1rm: 80, son_ağırlık: 65, son_tekrar: 6 }

## PERSONA
motivasyon_bağımlısı (100+ mesajdan sonra tespit)

## ALIŞTIRMALAR
protein_artırma: aktif, 8 gün seri
su_takibi: oturtulmuş, 21 gün
```

### 5.3 Layer 3 — Son Veriler
```
## BUGÜN
Kahvaltı: 2 yumurta (156 kcal, 12g P)
Toplam: 156/2200 kcal
Su: 0.5/3.0L
Adım: 2,340

## DÜN
Toplam: 2,150 kcal | Uyum: %85
Protein: 120g/150g | Su: 2.8L

## HAFTALIK TREND
Ort. kalori: 2,100 | Ort. uyum: %78
Kilo: 129.8 → 129.5 (haftalık -0.3kg)

## KAN TAHLİLİ → DİYET ETKİSİ
- Kolesterol: 240 → Doymuş yağ azalt, lif artır
- D vitamini: 15 → Takviye öner
```

### 5.4 Layer 4 — Session Mesajları
```
[user]: Bugün kahvaltıda 2 yumurta yedim
[assistant]: Kaydettim! 156 kcal, 12g protein. Öğle ne düşünüyorsun?
[user]: Öğlen dışarıda yiyeceğim, ne yesem?
```

---

## 6. Kart Tamamlama Mantığı

### 6.1 Çift Kontrol Sistemi
Her kart iki yoldan kapanabilir:

**Yol 1 — Profil Alanları Dolduğunda (Otomatik):**
```typescript
checkCompletion: (d) =>
  !!(d.profile?.height_cm && d.profile?.weight_kg && d.profile?.birth_year && d.profile?.gender)
```
- Kullanıcı karta tıklamadan bile, normal sohbette bu bilgileri verirse kart kapanır
- Tier 2/3 extractor cron da dolduğunda kapanır

**Yol 2 — AI Kararı (Explicit):**
```
<layer2_update>{"onboarding_task_completed": "introduce_yourself"}</layer2_update>
```
- AI "yeterli bilgi aldım" dediğinde kart kapanır
- `ai_summary.onboarding_tasks_completed` array'ine eklenir
- Bazı konular (kilo geçmişi, stres) sadece bu yolla kapanır (sayısal alan yok)

### 6.2 Kart Görünürlük Kuralları
- İlk 2 kart (kendini tanıt + hedef belirle) → **her zaman görünür** (tamamlanana kadar)
- Sonraki kartlar → **max 3 tane** gösterilir (progressive disclosure)
- Tüm kartlar tamamlandığında → "Yapılacaklar" bölümü kaybolur
- Yeni session açıldığında kartlar yenilenir (`useFocusEffect`)

---

## 7. Session Yaşam Döngüsü

### 7.1 Session Oluşturma
- Kart tıklama: `createSession({ title, topicTags })` → prefill + taskModeHint ile açılır
- + butonu: `createSession()` → boş session açılır
- Prefill redirect: `/(tabs)/chat?prefill=...` → otomatik session açılıp yönlendirilir

### 7.2 Session Sırasında
- Her mesaj `session_id` ile gönderilir
- Layer 4 sadece bu session'ın mesajlarını içerir
- Diğer layerlar (1/2/3) user-scoped kalır (tüm bilgi mevcut)
- Session başlığı ilk kullanıcı mesajından oluşturulur

### 7.3 Session Kapanma
- **Otomatik:** 24+ saat inaktif session'lar → `is_active: false, ended_at: now`
- **Manuel:** Yeni session açıldığında eski aktif session kapanır
- **Silme:** Uzun basma → onay → mesajlar + session silinir

### 7.4 Session Yeniden Açma
- Kapalı session'a tıklanınca mesajlar görünür
- İlk mesaj gönderildiğinde session reopen edilir
- Diğer aktif session'lar kapatılır (tek aktif session kuralı)

---

## 8. Diğer Ekranlar

### 8.1 Ana Sayfa (Dashboard)
- Kalori halkası (hedef yoksa "Henüz hedef belirlenmedi")
- Su + adım grid
- Haftalık bütçe barı
- Diyet/Spor tab toggle → detay sayfalarına link
- Aktivite timeline (bugünün öğünleri + antrenmanları)

### 8.2 Kayıt (FAB Modal)
- Ortadaki + butonu → modal açılır
- Yazarak gir → Kochko sohbetine yönlendirir
- Fotoğraf çek → Kochko sohbetine yönlendirir
- Barkod okut → kamera + OpenFoodFacts API
- Sesli giriş → mikrofon + Whisper API
- Su (+0.25L) → tek dokunuş
- Tartı → sayısal input
- Uyku → yatış/kalkış saati

### 8.3 Raporlar
- Günlük/Haftalık/Aylık raporlar
- Kilo trendi grafiği
- Uyum puanı
- AI gözlem kartları

### 8.4 Profil
- Avatar + kullanıcı bilgileri
- Fiziksel bilgiler (3 sütun)
- Hedefler bölümü
- Ayarlar (bildirim, koç tonu, IF, gün sınırı, alerjenler, dönemsel durum)
- Veri & gizlilik (AI hafızası, veri export, hesap silme)

---

## 9. Veri Akış Diyagramı

```
Kullanıcı Mesaj Yazar
    ↓
[Frontend] sendMessageToSession(sessionId, text, taskModeHint?)
    ↓
[Supabase Gateway] JWT doğrulama (--no-verify-jwt, kendi auth var)
    ↓
[Edge Function: ai-chat]
    ├─ getUserId(token) → Supabase Auth API ile doğrulama
    ├─ Güvenlik kontrolleri (injection, rate limit, emergency)
    ├─ Task mode algılama (register, plan, coaching, recipe...)
    ├─ task_mode_hint varsa → özel system prompt enjeksiyonu
    ├─ 4 katmanlı context oluşturma:
    │   ├─ Layer 1: Profil (45+ alan, hedefler, alerjiler, sağlık, rutin, mutfak...)
    │   ├─ Layer 2: AI özeti (davranışlar, porsiyon, persona, alışkanlıklar...)
    │   ├─ Layer 3: Son veriler (öğünler, metrikler, kan tahlili→diyet etkisi...)
    │   └─ Layer 4: Session mesajları (session_id ile filtrelenmiş)
    ├─ OpenAI API çağrısı
    ├─ Yanıt parse:
    │   ├─ <actions> → executeActions (meal_log, profile_update, weight_log...)
    │   └─ <layer2_update> → AI özeti güncelleme (async)
    ├─ Mesajları kaydet (chat_messages, session_id ile)
    └─ Yanıt dön
    ↓
[Frontend]
    ├─ AI mesajını göster
    ├─ Action feedback göster ("Kahvaltı kaydedildi")
    ├─ Dashboard yenile (kalori, makro, su...)
    └─ Rich content render (simülasyon, quick select, confirm/reject...)
```

---

## 10. Maliyet Modeli

| Bileşen | Sıklık | Model | Tahmini Maliyet |
|---------|--------|-------|-----------------|
| Chat mesajı | Her mesajda | GPT-4o / GPT-4o-mini (model router) | ~$0.01-0.05/mesaj |
| Tier 1 çıkarsama | Her mesajda | Ana model (zaten yapıyor) | $0 ek |
| Tier 2 extractor | Günde 1 | GPT-4o-mini | ~$0.01-0.02/kullanıcı/gün |
| Tier 3 extractor | Haftada 1 | GPT-4o-mini | ~$0.02-0.05/kullanıcı/hafta |
| Proactive nudge | Günde 2-3 | GPT-4o-mini | ~$0.005/nudge |

**Aylık kullanıcı başı tahmini:** ~$1-3 (aktif kullanıcı, günde 10-20 mesaj)

---

## 11. 73 Veri Başlığı — Toplama Yöntemi Özeti

| Kategori | Başlık Sayısı | Toplama Yöntemi |
|----------|--------------|-----------------|
| Fiziksel ölçümler | 6 | Tier 1 (anlık) + kart |
| Hedef & motivasyon | 6 | Tier 1 (anlık) + kart |
| Tıbbi geçmiş | 8 | Kart + Tier 2 |
| Günlük yaşam | 7 | Kart + Tier 2 |
| Beslenme alışkanlıkları | 15 | Kart + Tier 2 + Tier 3 |
| Mutfak & lojistik | 7 | Kart + Tier 3 |
| Spor & hareket | 12 | Kart + Tier 2 |
| Vücut kompozisyonu | 6 | Tier 3 (nadir) |
| Dönemsel durumlar | 6 | Tier 1 (anlık, kullanıcı bildirir) |

---

## 12. Güvenlik Katmanları

1. **Supabase Auth:** Email/şifre veya OAuth ile giriş, JWT token
2. **Edge Function Auth:** `getUserId` → `auth.getUser(token)` ile doğrulama
3. **Prompt Injection:** `sanitizeUserInput` ile tespit
4. **Rate Limiting:** `checkRateLimit` ile dakika/saat bazlı limit
5. **Emergency Detection:** İntihar, kendine zarar verme tespiti → acil mesaj
6. **ED Risk Detection:** Yeme bozukluğu riski → güvenli mod
7. **Allergen Check:** Plan üretiminde alerjen kontrolü
8. **Medical Guardrails:** Tıbbi dil sanitizasyonu, teşhis koymama
9. **RLS (Row Level Security):** Supabase tablolarında kullanıcı bazlı erişim
