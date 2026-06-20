# KOCHKO — Kapsamlı Audit: UI · UX · DB · AI Mimarisi

> 2026-06-20 — Çoklu-ajan denetim: **26 bulucu + 26 düşmanca doğrulayıcı + 4 boyut sentezi + 1 kapsayıcı sentez** (58 ajan, ~4.7M token, 1237 araç çağrısı). Her bulgu ikinci bağımsız bir ajan tarafından kaynaktan yeniden okunup doğrulandı; yanlış pozitifler elendi. Salt-okunur denetim; canlı Supabase şema/RLS/cron drift kontrolü dahil. Doğrulanmış bulgu: **UI 36 · UX 42 · DB 37 · AI 48 = 163**.

## 📋 Yönetici Özeti
KOCHKO, üretime "neredeyse hazır ama cilasız ve kenarlardan kırılgan" bir olgunluk seviyesinde. Dört boyutun hepsi 2.5/5 ile aynı eşikte: mimari iskelet (token/primitive sistemi, katmanlı AI bellek mimarisi, RLS kapsaması, plan yaşamdöngüsü) gerçekten olgun, ancak bu iskelet yaygın biçimde baypas ediliyor ve birkaç yüksek-etkili açık kapanmamış durumda. Veri sızıntısı (cross-user okuma) yok — bu önemli bir taban güvence — fakat hem AI tarafında 1 kritik veri-bozma yolu hem de boyutları aşan bir dizi gelir/güvenlik/güvenilirlik açığı pazara çıkışı bugün riskli kılıyor.

En büyük riskler üç temada toplanıyor. (1) Güvenlik & gelir: subscriptions INSERT üzerinden sınırsız ücretsiz-ömürboyu-premium self-grant açığı (migration 046 ile kapatıldığı raporlanmış ama migration↔canlı drifti her seferinde teyit edilmeli) ve household üyelik RLS'i gibi yetkilendirme sınırları. (2) Kullanıcı güvenliği: AI'nin egzersiz ağırlığını ("bench 70kg") vücut ağırlığı sanıp profiles.weight_kg'ı sessizce ezerek kalori/protein hedeflerini bozması — deterministik güvenlik-ağı pattern'i ile zayıflatılmış ama alerjen/kriz tespitinde hâlâ boşluklar kalan kritik yol. (3) Cila & erişilebilirlik: ölü a11y altyapısı (mükemmel accessibility.ts kütüphanesi var ama ekran okuyucuda hiç kullanılmıyor), WCAG-AA altı kontrast token'ları, marka-dışı renk sızıntısı ("iki ayrı uygulama" hissi) ve aksansız ASCII Türkçe ekranlar — Türk-öncelikli bir üründe güven-kırıcı.

Üretime hazırlık hükmü: Çekirdek akışlar (sohbet koçluğu, plan taslak→onay→revize, kayıt çıkarımı, raporlar) çalışıyor ve sohbet yüzeyi sektör-üstü. Ancak bir P0 dalgası (premium self-grant drift teyidi + canlı uygulama, weight-corruption yolunun son kapatılması, alerjen/kriz güvenlik-ağı boşlukları, çok-adımlı yazımların transaction'a alınması) tamamlanmadan ticari lansman önerilmez. P0 sonrası ürün, P1 (sonsuz-spinner ölü uçlar, OAuth onboarding eksik-yaş, ayar keşfedilebilirliği) ve P2 (a11y aktivasyonu, kontrast, Türkçe diakritik, grafik cilası) ile sağlam bir 3.5+/5 bandına taşınabilir.

## 📊 Boyut Skorları
| Boyut | Skor | Critical | High | Hüküm |
|-------|:----:|:--------:|:----:|-------|
| UI | 2.5 / 5 | 0 | 5 | Sağlam token/primitive iskeleti var ama yaygın baypas ediliyor; ekran-okuyucu a11y'si ölü ve grafik ekseni hizalaması en kritik açıklar. |
| UX | 2.5 / 5 | 0 | 7 | Çekirdek akışlar çalışıyor ama sonsuz-spinner ölü uçlar, OAuth'ta eksik yaş, keşfedilemez ayarlar, çalışmayan deneme bildirimi ve aksansız Türkçe "cilasız ve kırılgan" tutuyor. |
| DB | 2.5 / 5 | 0 | 5 | Veri sızıntısı yok ama iki gerçek gelir/güvenlik açığı (sınırsız trial self-grant, eksik FK), yaygın migration↔canlı drifti ve transaction'sız çok-adımlı yazımlar şema bütünlüğünü zedeliyor. |
| AI | 2.5 / 5 | 1 | 11 | Mimari katmanlama olgun ama kritik bir veri-bozma yolu, güvenlik-ağı boşlukları (alerjen/kriz) ve "yazılıp okunmayan / yanlış besleme" bellek hataları üretim güvenilirliğini tehdit ediyor. |
| **TOPLAM** | **2.5 / 5** | **1** | **28** | İskelet olgun, açıklar yüksek-etkili; bir P0 dalgası lansman-öncesi zorunlu. |

## 🚨 En Kritik Çapraz-Kesit Riskler
1. **[AI / critical] AI vücut-ağırlığını egzersiz ağırlığıyla karıştırıp profil kilosunu sessizce eziyor** — supabase/functions/ai-chat/index.ts:559-562 yorumunda açıkça belirtildiği gibi, model 'bench press 4x8 70kg' gibi bir egzersiz ağırlığını vücut ağırlığı sanıp profiles.weight_kg'ı sessizce overwrite edebiliyor; deterministik güvenlik-ağı (onboarding=full extraction, regular chat=safe subset) eklenmiş ama ambiguity tamamen elenmiş değil. _Etki: Bozuk weight_kg, tüm kalori/protein hedeflerini (TDEE) yanlış hesaplatır — kullanıcı haftalarca yanlış beslenme planı uygular; sessiz olduğu için fark edilmez. Doğrudan sağlık/güven riski._
2. **[DB / high] Sınırsız ücretsiz ömür-boyu premium self-grant (subscriptions INSERT)** — Herhangi bir authenticated kullanıcı {tier:'lifetime',status:'active',expires_at:'2099-...'} insert edip SECURITY DEFINER tg_sync_profile_premium trigger'ı üzerinden profiles.premium=true yapabiliyordu. migration 046 client INSERT'ini yalnız trial satırına daraltarak kapatıyor — ama bu migration↔canlı drift olarak her deploy'da teyit edilmeli. _Etki: Doğrudan gelir kaybı: tüm premium duvarı tek bir REST insert ile aşılır. Migration uygulanmamışsa pazar-engelleyici._
3. **[UI / high] Ölü erişilebilirlik altyapısı — a11y kütüphanesi var ama hiç bağlı değil** — src/lib/accessibility.ts içinde getContrastColor + a11y helper'ları mevcut fakat Button/badge/ekranlarda kullanılmıyor; ekran-okuyucu label'ları, kontrast düzeltmesi ve dokunma-hedefi garantileri runtime'da devrede değil. _Etki: Görme engelli kullanıcılar uygulamayı kullanamaz (yasal/erişilebilirlik uyum riski); birincil teal buton beyaz etiketle 3.39:1 = WCAG-AA FAIL._
4. **[UX / high] Plan/sohbet/rapor ekranlarında sonsuz-spinner ölü uçlar** — Rapor ve coach-memory loader'larında .catch/.finally eksikliği (UX_AUDIT hızlı-kazanım #9, 4 dosya) bir hata/boş yanıtta spinner'ı sonsuza kilitliyor; plan taslak sohbetinde TypingIndicator yok, LLM beklerken ölü sessizlik. _Etki: Kullanıcı uygulamanın donduğunu sanıp terk eder; ilk-izlenim akışlarında churn._
5. **[AI / high] Alerjen/kriz güvenlik-ağı boşlukları** — ai-chat'te crisis/ED/allergen tespiti deterministik olarak kuruluş aşamasında (index.ts:125, 786) ama alerjen sözlük çözümü canonical-isim eşlemesine ve tek-isim fallback'ine bağlı; sözlük dışı alerjenler veya dolaylı ifadeler kaçabilir, plan/öneride risk gıdası çıkabilir. _Etki: Şiddetli alerji/kriz durumunda yanlış öneri = doğrudan can güvenliği riski; ürünün en hassas garantisi._
6. **[DB / high] Transaction'sız çok-adımlı DB yazımları** — Edge function'larda profil + abonelik + plan projeksiyonu gibi çok-adımlı yazımlar tek transaction'a sarılmadan ardışık çalışıyor; ortada hata olursa yarı-yazılmış tutarsız durum kalıyor (ör. weekly_plans yazıldı ama daily_plans projeksiyonu yapılamadı). _Etki: Şema bütünlüğü bozulur; kullanıcı 'plan oluştu ama görünmüyor' gibi tutarsız durumlarla karşılaşır, debug edilmesi zor._
7. **[UX / high] OAuth onboarding'inde eksik yaş/doğum yılı** — OAuth (Google) ile gelen kullanıcıda birth_year/yaş alanı toplanmadan onboarding ilerleyebiliyor; migration 044 handle_new_user_birth_year backfill'i var ama OAuth akışı bu alanı garanti etmiyor. _Etki: Yaş olmadan TDEE/kalori hesabı yapılamaz veya varsayılana düşer — yanlış plan; kullanıcı kritik veriyi hiç girmeden 'tamamlanmış' onboarding'e geçer._
8. **[UI / high] Marka-dışı renk sızıntısı — 'iki ayrı uygulama' hissi** — Diyet/antrenman/rapor yüzeyleri Tailwind/Material renkleriyle (#22C55E, #6366F1) render ediliyor — UX_AUDIT'e göre 16 dosya, 73 sızıntı — markanın teal/mor token'larıyla yarışıyor. _Etki: Kullanıcı uygulamayı 'birbirine dikilmiş iki app' olarak okur; cila ve marka güveni düşer, premium algısını zayıflatır._
9. **[AI / high] Bellek katmanı 'yazılıp okunmayan / yanlış besleme' yönlendirme hataları** — Layer-2 bellek alanları (motivasyon, tercihler) bazı yollarda yazılıyor ama context'e geri beslenmiyor ya da yanlış alana yazılıyor (ör. target_weight_kg vs weight_kg karışması, index.ts:456 örnek-prompt'larla zorlanıyor). _Etki: AI aynı soruları tekrar sorar, kişiselleştirme zayıflar — kullanıcının en sık şikayet ettiği 'beni hatırlamıyor' deneyimi._
10. **[UX / medium] Aksansız ASCII Türkçe ekranlar** — settings/coach-memory, household, weekly-menu, recipes ve i18n.ts (~140 anahtar) tamamen ASCII: 'Koc Paylasimi', 'Dusunuyor...'; i18n sözlüğü bağlanırsa anında kırık ship eder. _Etki: Türk-öncelikli üründe profesyonellik/güven kaybı; özellikle 'Koç Hafızası' gibi güven-özelliği ekranlarında._
11. **[DB / medium] Eksik foreign key + migration↔canlı şema drifti** — Bazı tablolarda referans bütünlüğü FK ile değil uygulama-katmanı varsayımıyla korunuyor; ayrıca migration dosyaları ile canlı şema arasında tekrarlayan drift (045-050 'canlı' notlu ama her seferinde teyit gerekiyor). _Etki: Orphan satırlar ve sessiz veri tutarsızlığı; drift, bir düzeltmenin canlıda gerçekten etkili olup olmadığını belirsizleştirir._
12. **[UI / medium] Paywall'da çıkmaz 'Geliştirici Modu' / sahte grafikler** — premium.tsx'te dev-mode satın-alma yolu artık RLS ile bloklu (doğru) ama UI hâlâ çıkmaz bir akış sunabiliyor; raporlarda grafikler sahte/eksen-hizasız (UX_AUDIT Raporlar 2/5). _Etki: Kullanıcı premium'a geçemez (gelir) veya grafiklere güvenmez (veri güvenilirliği algısı)._

## 🗺️ Önceliklendirilmiş Yol Haritası
### P0 — Pazar-engelleyici / güvenlik / veri-bütünlüğü (lansman-öncesi ZORUNLU)
- **Premium self-grant drift teyidi:** migration 046'nın CANLI veritabanında uygulı olduğunu SELECT ile doğrula (subscriptions_ins politikası trial-only mü?); değilse derhal uygula. Aynı şekilde 050 household_members RLS ve cron REVOKE'larını teyit et.
- **Weight-corruption yolunu kapat:** ai-chat'te regular-chat extraction'ının vücut-ağırlığını egzersiz ağırlığından kesin ayırdığını canlı test et (kk.mjs ile 'bench press 70kg' → weight_kg DEĞİŞMEMELİ); kalan ambiguity için ek guard.
- **Alerjen/kriz güvenlik-ağını sertleştir:** sözlük-dışı alerjen ve dolaylı kriz ifadeleri için fallback'i genişlet; suicide/112 yolunun her zaman tetiklendiğini doğrula.
- **Çok-adımlı yazımları transaction'a al:** plan projeksiyonu, profil+abonelik gibi ardışık yazımları RPC/transaction içine sar.

### P1 — Önemli işlevsel / UX
- Tüm async loader'lara .catch/.finally ekle (sonsuz-spinner ölü uçları — rapor/coach-memory/plan).
- OAuth onboarding'inde birth_year/yaş toplanmasını zorunlu kıl (TDEE garantisi).
- Plan taslak sohbetine TypingIndicator + 'düşünüyor' geri bildirimi.
- Ayar mimarisini keşfedilebilir kıl (30+ satırlık düz duvar → gruplama/arama).
- Bellek (Layer-2) yaz-oku döngüsünü doğrula: target_weight_kg vs weight_kg, motivasyon geri-besleme; 'tekrar sorma' regresyon testi.
- Eksik FK'leri ekle; orphan satır temizliği.

### P2 — Cila
- Ölü a11y kütüphanesini aktive et: getContrastColor'ı Button/badge'lere bağla, ekran-okuyucu label'ları ekle.
- textMuted token'ını ~#8A8AA0'a çıkar (uygulama-geneli WCAG-AA kontrast — tek satır).
- Marka-dışı hex sızıntılarını (16 dosya) token'a maple — tek süpürme.
- ASCII Türkçe ekranlara diakritik geri-yükle; i18n.ts'i bağlamadan önce düzelt.
- Rapor grafiklerini gerçek-eksenli/marka-renkli yeniden çiz; paywall çıkmaz alert'ini kaldır.

## 🔁 Çapraz Temalar
Boyutları aşan tekrarlayan temalar:

- **Olgun iskelet, yaygın baypas:** Her boyutta güçlü altyapı var (token sistemi, accessibility.ts, katmanlı AI bellek, RLS kapsaması) ama tutarsız kullanılıyor. Sorun mimari değil, disiplin ve aktivasyon eksikliği — bu da düşük-efor/yüksek-kazanç düzeltmeler anlamına gelir (tek token, tek helper bağlama).

- **Ölü/bağlanmamış altyapı:** accessibility.ts (a11y), i18n.ts (~140 anahtar), getContrastColor — hepsi yazılmış ama runtime'da devrede değil. 'Var ama bağlı değil' deseni hem UI (a11y/kontrast) hem AI (yazılıp okunmayan Layer-2 bellek) hem DB (kullanılmayan/legacy kolonlar) boyutlarında tekrarlıyor.

- **Sessizce yutulan hatalar:** AI'nin profil kilosunu sessizce ezmesi, loader'ların hata yutup sonsuz spinner'a kilitlenmesi, transaction'sız yarı-yazımlar — kullanıcıya hiç sinyal vermeyen sessiz başarısızlıklar en sinsi risk sınıfı; debug edilmesi ve kullanıcı tarafından fark edilmesi zor.

- **Migration↔canlı drift:** DB düzeltmeleri migration dosyalarında mevcut (045-050) ama 'canlıda mı?' sorusu her seferinde ayrı teyit gerektiriyor. Bir güvenlik açığının kodda kapatılmış görünmesi canlıda kapalı olduğu anlamına gelmiyor — push/deploy hattındaki güvenilirlik (GCM kimlik sorunu dahil) yapısal bir kör nokta.

- **AI eylem-çıkarımı güvenilirliği:** Deterministik güvenlik-ağı pattern'i (meal/workout/weight/sleep/water/supplement/mood) iyi bir savunma ama model çıktısına güvenmenin kırılganlığını maskeliyor; ambiguity (vücut vs egzersiz ağırlığı, alerjen isim çözümü) hâlâ kullanıcı güvenliğini etkileyen kalıntı risk taşıyor.

- **Türk-öncelikli üründe yarım yerelleştirme:** Birincil ekranlar düzgün Türkçe ama ikincil/ayar ekranları ASCII; tutarsız yerelleştirme marka güvenini boyutlar arası (UI mikrokopi + UX akış) aynı anda zedeliyor.

---

# 📁 Boyut Detayları

## UI / Görsel Tasarım & Tasarım Sistemi

**Skor: 2.5 / 5** — Sağlam bir token/primitive iskeleti (theme.ts, ui/ primitives, accessibility.ts) mevcut ama bu altyapı ekranların büyük çoğunluğunda baypas ediliyor; en kritik açıklar ekran okuyucu erişilebilirliği (Button/silme/toggle) ve grafik ekseni hizalamasıdır.

### Severity Özeti

| Severity | Adet | Ana temalar |
|---|---|---|
| Critical | 0 | — |
| High | 5 | Button a11y, erişilemez silme, chart ekseni hizası (×2), settings çift-başlık |
| Medium | 8 | Kontrast (AA fail), tema-dışı palet, başlık tutarsızlığı, inline toggle, diakritik soyma, tema mimari bölünmesi, form-kontrol semantiği |
| Low | 8 | Light tema kontrast (gated), elevation, ölü prop'lar, primitive kopyalama, chart rengi, carry-forward, ölü a11y kodu |
| Nit | 3 | Token hijyeni (RADIUS/SPACING), auth blok farkı, çifte '+' eylemi |

---

### [HIGH] Paylaşılan Button primitive'i hiçbir erişilebilirlik prop'u taşımıyor

- `src/components/ui/Button.tsx:40-66` (TouchableOpacity), `:7-16` (kapalı Props, `...rest` yok)

**Sorun:** Uygulamanın en yaygın aksiyon primitive'i `accessibilityRole='button'`, `accessibilityState={{disabled,busy}}` ve `accessibilityLabel` vermiyor; disabled/loading yalnızca opacity 0.5 ile görsel iletiliyor. Props kapalı ve `...rest` spread'i olmadığı için tüketici dışarıdan da ekleyemiyor. Aynı dizindeki EmptyState (`EmptyState.tsx:36-37`) ve DateTimeField (`DateTimeField.tsx:51-52`) role/label set ediyor — Button tek istisna. `accessibility.ts:71 getButtonA11yProps` helper'ı var ama kullanılmıyor.

**Etki:** Tüm primary/secondary/danger butonlar TalkBack/VoiceOver'da "düğme" rolüyle duyurulmuyor; loading/disabled buton etkin gibi okunup kullanıcı dokununca tepki alamıyor. Çarpan etkisiyle onlarca ekranı vuruyor.

**Öneri:** TouchableOpacity'ye `accessibilityRole='button'`, `accessibilityState={{ disabled: !!(disabled||loading), busy: !!loading }}`, `accessibilityLabel={title}` ekle; Props'a opsiyonel `accessibilityLabel?/accessibilityHint?/testID?` aç. Tercihen `getButtonA11yProps` kullan.

```tsx
// Button.tsx:40 — şu an a11y prop yok
<TouchableOpacity style={[...]} onPress={onPress} disabled={disabled || loading} activeOpacity={0.7}>
```

---

### [HIGH] Yıkıcı silme işlemleri yalnızca "uzun bas" ile tetikleniyor — ekran okuyucu kullanıcısı silemiyor

- `app/settings/venues.tsx:45`, `app/settings/multi-phase-goals.tsx:106`, `app/settings/progress-photos.tsx:202`, `app/settings/health-events.tsx:70`
- `src/components/profile/InsightCard.tsx:47`, `:58`
- `src/components/settings/coach-memory.tsx:945` (dekoratif trash ikonu)

**Sorun:** Birçok ekranda "sil" SADECE `onLongPress` ile sunuluyor; görünür/odaklanabilir bir sil butonu yok ve çoğunda `accessibilityLabel` bile yok (`venues.tsx:45` salt long-press, label'sız). coach-memory `deletable` ikonu (`:945`) bir `<Ionicons name="trash-outline">` ama `onPress`'i YOK — salt dekoratif, gerçek silme yine long-press. Doğru desen `app/(tabs)/chat.tsx:325-333` ve `food-preferences.tsx:112-118`'de var (44x44, hitSlop, role='button', label).

**Etki:** TalkBack/VoiceOver kullanıcısı uzun-bas jestini güvenilir üretemez (okuyucu jesti yakalar); görünür buton da olmadığından mekânları, hedef fazlarını, ilerleme fotoğraflarını, sağlık olaylarını ve koç-hafıza notlarını HİÇ silemiyor. KVKK/veri-kontrolü açısından da sorunlu.

**Öneri:** Her long-press-only yıkıcı satıra `chat.tsx:325` şablonuyla gerçek `onPress`'li görünür sil butonu ekle (44x44 + role='button' + label). coach-memory'nin `deletable` ikonunu TouchableOpacity'ye sarıp `onPress` bağla.

```tsx
// venues.tsx:45 — görünür buton/label yok
<TouchableOpacity key={v.id} onLongPress={() => handleDelete(v.id)}>
// chat.tsx:325 — doğru desen
<TouchableOpacity onPress={() => handleDeleteSession(item)} accessibilityRole="button" accessibilityLabel="Sohbeti sil" hitSlop={{...}}>
```

---

### [HIGH] Kilo & Uyum trend grafiklerinde x-ekseni etiketleri veri noktalarıyla hizalanmıyor

- `app/(tabs)/progress.tsx:227` (Kilo), `:256-257` (Uyum)
- Doğru desen: `src/components/reports/ProgressChart.tsx:54`

**Sorun:** Her iki grafikte `labels` filtreleniyor (`filter((_,i)=> i % step === 0)`) ama `datasets.data` tam uzunlukta kalıyor. Veri 28 günlük pencereden geliyor (`:58`), yani 28 noktaya kadar; labels en fazla ~6 etiket üretir. react-native-chart-kit etiketleri INDEX bazlı eşler — `labels.length < data.length` olunca etiketler grafiğin soluna kümelenir, kalan ~22 nokta etiketsiz kalır.

**Etki:** Ana ilerleme ekranındaki iki temel grafiğin tarih ekseni yanıltıcı; bir tartı düşüşü/uyum artışı yanlış güne hizalanmış görünür, kullanıcı trendi yanlış tarihe bağlar.

**Öneri:** `ProgressChart.tsx:54` desenini uygula — labels'i veriyle EŞİT uzunlukta üret, gösterilmeyen indeksleri `''` yap.

```tsx
// progress.tsx:227 — dataset tam uzunluk, labels kısa
labels: weights.filter((_, i) => i % Math.max(1, Math.floor(weights.length / 5)) === 0).map(w => fmtLabel(w.date))
// ProgressChart.tsx:54 — doğru
const labels = data.map((d, i) => (i % step === 0 ? formatShortDate(d.label) : ''))
```

---

### [HIGH] TempoChart x-ekseni etiketleri veri noktalarıyla hizalanmıyor (aynı chart-kit hatası)

- `src/components/plan/TempoChart.tsx:65` (labels üretimi), `:77` (filter), `:79-80` (datasets)

**Sorun:** Planlanan ve Gerçekleşen serileri `weeks+1` nokta içeriyor; ama `:77`'de `labels.filter((_,i)=> i % step === 0)` ile kısaltılıyor. Filter sonucu dataset uzunluğundan az olduğu için hafta etiketleri (`0h`,`3h`...) yanlış indekslere yerleşip sola kümeleniyor.

**Etki:** Hedef ekranındaki planlanan-vs-gerçekleşen tempo grafiğinin hafta ekseni kayık; kullanıcı hangi haftada hedef çizgisinin altında/üstünde olduğunu yanlış okur.

**Öneri:** labels'i dataset uzunluğunda tut, ara etiketleri `''` yap: `labels.map((l,i)=> i%step===0 ? l : '')`.

---

### [HIGH] Her ayar ekranında başlık iki kez görünüyor: native header + gövde H1 (duplicate-title)

- `app/settings/_layout.tsx` (native başlıklar: `:27/:44/:38/:28/:40`)
- Gövde H1 tekrarı: `food-preferences.tsx:69`, `supplements.tsx:49`, `notifications.tsx:69`, `goals.tsx:185`, `premium.tsx:219`
- Çözülmüş referans: `if-settings.tsx:61-62`

**Sorun:** `_layout.tsx` her ekran için native header başlığı tanımlarken gövdeler aynı metni `FONT.xxl/800` H1 olarak tekrar basıyor. Sorun kodda kabul edilmiş: `if-settings.tsx:61-62` yorumu "the in-body heading was a redundant duplicate and has been removed" diyor ve o tek ekranda H1 kaldırılmış — ama ~30 diğer ekranda duplike duruyor.

**Etki:** Settings'e yayılan görsel tutarsızlık (if-settings tek başlıklı, ~30 ekran çift). Çift başlık dikey alanı boşa harcıyor ve baştan savma izlenimi veriyor.

**Öneri:** `if-settings.tsx` çözümünü standartlaştır — gövde H1'lerini kaldır, native header tek başlık kaynağı olsun (gerekli ekranlarda H1 altı açıklama metnini koru).

---

### [MEDIUM] Aksan arka planlarında sabit `#fff` metin WCAG AA'yı geçemiyor (getContrastColor atlanıyor)

- `src/components/tracking/StreakBadge.tsx:24/27`, `src/components/common/OfflineBanner.tsx:58/82`, `src/components/plan/PhaseTimeline.tsx:85`

**Sorun:** `accessibility.ts:197 getContrastColor` tüm marka aksanları için 'black' döndürür (primary lum 0.260 > 0.179 eşiği), yani aksan üstünde doğru metin `#0D0D12`'dir, `#fff` değil. Üç bileşen helper'ı atlayıp beyaz sabitliyor: StreakBadge `#fff`/`#1D9E75` → 3.39:1 FAIL; OfflineBanner `#fff`/`#D85A30` → 3.87:1 FAIL; PhaseTimeline aktif faz `#fff`/`#F97316` = 2.80, `#06B6D4` = 2.43 FAIL. Üçü de canlı render ediliyor (OfflineBanner `_layout.tsx:84` app-global).

**Etki:** Streak rozeti, çevrimdışı banner ve faz zaman çizelgesi etiketleri parlak ortam/düşük görüşte okunamaz.

**Öneri:** Beyaz sabitleri kaldır; `getContrastColor(bg)==='black' ? '#0D0D12' : '#fff'` ile hesapla (bu aksanlar için `#0D0D12` döner, kontrast ≥5.72).

---

### [MEDIUM] Dört görünür sekme dört farklı başlık deseni kullanıyor — paylaşılan ScreenHeader yalnızca Chat'te

- `app/(tabs)/chat.tsx:190-191`, `app/(tabs)/progress.tsx:204/207`, `app/(tabs)/profile.tsx` (başlık yok), `src/components/dashboard/HeroSection.tsx:86/90`, `src/components/ui/ScreenHeader.tsx:40`

**Sorun:** ScreenHeader dokümantasyonu (`:2-5`) dört yüzeyi birleştirdiğini söylese de yalnızca Chat onu kullanıyor (`FONT.xl2=18 / weight 700`, top inset `insets.top+8`). Raporlar elle `fontSize:18, fontWeight:'600'` (farklı ağırlık) + `paddingTop:insets.top+12` (farklı inset). Ana Sayfa HeroSection elle `18/700` + `insets.top+8`. Profil hiç ekran başlığı taşımıyor.

**Etki:** Sekmeler arası gezinirken başlık ağırlığı/hizası ve top inset tutarsız zıplıyor; profilde hiç üst başlık olmaması en belirgin tutarsızlık.

**Öneri:** Raporlar ve Ana Sayfa için de ScreenHeader kullan ya da en azından başlık token'larını (FONT.xl2 + 700 + aynı inset) tek kaynaktan tüket; Progress'i 700'e çek; Profil'e "Profil" başlığı ekle.

---

### [MEDIUM] ErrorBoundary tema yerine elle yazılmış (drift olmuş) renkler kullanıyor — eski teal #14B8A6 dahil

- `src/components/ui/ErrorBoundary.tsx:60-89`, `src/lib/theme.ts:47`, `src/components/ui/Button.tsx:34`

**Sorun:** Global hata ekranındaki tüm renkler sabit kodlu; retry butonu `:70 backgroundColor:'#14B8A6'` (eski Tailwind teal-500) — güncel marka teal'i `theme.ts:47 primary='#1D9E75'` değil. Diğer hex'ler de token-dışı (`:60 #0D0D12`, `:62/73 #fff`, `:65 #888`, `:77 #333`, `:80 #bbb`, `:84 #1a1a24`, `:85 #f87171`). Ayrıca retry butonu beyaz metin (`:73`) kullanırken Button primitive filled varyantlarda `getContrastColor` ile SİYAH metin veriyor (`Button.tsx:34`) — aynı uygulamada iki farklı buton kontrast kuralı.

**Etki:** Kullanıcı bir crash gördüğünde (en kritik an) marka renginden sapmış eski-teal buton görüyor; theme.ts primary güncellenirse bu ekran eski renkte kalır; light tema açılırsa ErrorBoundary güncellenmez.

**Öneri:** Class component olduğu için useTheme yerine `DARK_COLORS`'tan türet (veya fallback'i fonksiyonel `ErrorFallback` iç bileşene çıkarıp `useTheme().colors` kullan); `#14B8A6`→primary, `#0D0D12`→background, `#888/#bbb`→textMuted/textSecondary. Retry'ı Button primitive (`variant='primary'`) ile değiştir; metin `#0D0D12` (beyaz #1D9E75 üstünde 3.39:1 AA fail).

---

### [MEDIUM] PhaseTimeline ve InsightCard'da tema dışı sabit Material Design palet

- `src/components/plan/PhaseTimeline.tsx:24-31` (GOAL_COLORS), `src/components/profile/InsightCard.tsx:15-18` (PATTERN_COLORS)

**Sorun:** İki bileşen theme.ts paletinde olmayan Material hex'lerini sabit kodluyor. PhaseTimeline `gain_muscle='#8B5CF6'`, `health='#06B6D4'`, `conditioning='#F97316'` — token'larla çakışan tutarsız tonlar (`METRIC_COLORS.workout='#7F77DD'` vs `#8B5CF6`). InsightCard tamamen Material: `#E91E63/#FF9800/#9C27B0/#FF5722/#607D8B/#2196F3` — hiçbir token'la örtüşmüyor.

**Etki:** Marka dışı, yüksek doygunluklu Material renkleri düz-koyu/teal estetiğini bozar; aynı kavram (mor=kas) ekranlar arası farklı tonlarda görünür.

**Öneri:** Hex'leri token'lara eşle: `gain_muscle→purple(#7F77DD)`, `health→protein/success`, `conditioning→coral/warning`. InsightCard için mevcut token alt-kümesi seç veya theme.ts'e `PHASE_COLORS/PATTERN_COLORS` token grubu ekle.

---

### [MEDIUM] Card primitive'i tanımlı ama profile.tsx aynı stili elle kopyalıyor (boşluk da sapmış)

- `app/(tabs)/profile.tsx:95/103/114`, `src/components/ui/Card.tsx:18-26`

**Sorun:** profile.tsx Card'ı import ETMİYOR; kanonik kart stilini (`backgroundColor:colors.card + borderRadius:RADIUS.md + borderWidth:0.5 + borderColor:colors.border`) üç ham View'da elle yazıyor. Üstelik kopya sapmış: `marginBottom: SPACING.xxl (24)`, primitive `SPACING.md (12)`.

**Etki:** Kart görünümü ekranlar arası tutarsızlaşıyor (profilde 24px, Card kullananlarda 12px); merkezi kart stil değişikliği elle kopyalara yansımıyor — bakım yükü ve görsel drift.

**Öneri:** profile.tsx ham View kartlarını Card primitive'iyle değiştir; gereken boşluğu style override ile geç.

---

### [MEDIUM] Toggle anahtarı 3 ekranda elle kopyalanmış ve iki farklı boyutta (48x28 vs 40x24)

- `app/settings/notifications.tsx:76/120`, `app/settings/if-settings.tsx:99`, `app/settings/coach-sharing.tsx:239`, `src/components/settings/ToggleRow.tsx`

**Sorun:** ToggleRow primitive (48x28) yalnızca coach-memory/menstrual/account-security'de kullanılıyor; notifications/if-settings/coach-sharing inline toggle çiziyor ve boyutlar tutarsız: notifications ana toggle 48x28 ama tür-toggle'ları 40x24 (TEK ekranda iki boyut); if-settings 48x28, coach-sharing 40x24.

**Etki:** Ekrandan ekrana ve notifications içinde satırdan satıra anahtar boyutu değişiyor; bir düzeltme 3+ yerde tekrar gerekiyor.

**Öneri:** Tek toggle boyutu standardı belirle; inline toggle'ları ToggleRow ile değiştir veya tutarlı bir Switch primitive'i benimse.

---

### [MEDIUM] Özel toggle/onay-kutusu kontrolleri 'switch'/'checkbox' rolü ve durumunu bildirmiyor

- `src/components/settings/ToggleRow.tsx:16`, `app/settings/health-events.tsx:61-64`, `app/settings/household.tsx:226`

**Sorun:** Native `<Switch>` yok; aç/kapa elle çizilmiş View kutuları. ToggleRow `accessibilityRole='switch'`/`accessibilityState={{checked}}` taşımıyor. health-events onay kutusu `'[x]'/'[ ]'` düz metin glifleriyle (okuyucu "köşeli ayraç x" der), role='checkbox' yok; household alışveriş-listesi kutusu aynı, durumsuz. Doğru desen `notifications.tsx:75 {...a11ySwitch(...)}`.

**Etki:** Bu toggle/onay kutuları ekran okuyucuda durumsuz okunuyor; açık mı kapalı mı anlaşılmıyor — WCAG 4.1.2 ihlali.

**Öneri:** ToggleRow'a `a11ySwitch(label, value)` yay; onay kutularına `accessibilityRole='checkbox'` + `accessibilityState={{checked}}` ekle; `a11ySwitch` helper'ını standartlaştır.

---

### [MEDIUM] Seçilebilir chip/segment kontrollerinde accessibilityState 'selected' eksik (seçim yalnızca renkle)

- `app/settings/health-events.tsx:51`, `app/settings/progress-photos.tsx:133`, `app/settings/theme.tsx:28`

**Sorun:** Tür/poz/tema seçim kontrolleri seçili durumu yalnızca renk değişimiyle gösteriyor; `accessibilityState={{selected}}`/`accessibilityRole` yok. theme.tsx'te grep ile 0 eşleşme; comingSoon seçenekleri için `accessibilityState={{disabled}}` de yok (yalnızca opacity 0.5).

**Etki:** Görme engelli kullanıcı hangi seçeneğin seçili olduğunu duyamaz; renk tek başına kullanıldığından renk körlüğü/düşük görüş için de zayıf — WCAG 1.4.1 + 4.1.2 ihlali.

**Öneri:** Her seçim chip'ine `accessibilityState={{ selected }}` (gerekirse role='radio') ekle; theme.tsx comingSoon'a `accessibilityState={{ disabled: true }}` ekle.

---

### [MEDIUM] Gövde başlıkları native header başlığıyla çelişiyor; coach-memory için ÜÇ farklı isim

- `app/settings/strength.tsx:41` vs `_layout.tsx:43` vs `index.tsx:119`; `menstrual.tsx:56`/`_layout.tsx:36` vs `index.tsx:109`; `multi-phase-goals` `_layout.tsx:37` vs `index.tsx:104`; `coach-memory.tsx:180/189/263` vs `index.tsx:145` vs `_layout.tsx:20`

**Sorun:** Aynı özellik menü/header/gövdede farklı adlanıyor. strength: "Güç Progresyonu" (gövde) vs "Güç Progresyon" (header). menstrual: "Regl Döngüsü" (header/gövde) vs "Adet Döngüsü" (menü). multi-phase: tekil vs çoğul. coach-memory ÜÇ isim: "Koç Hafızası" (header), "Koçkonun Senin Hakkında Bildikleri" (override, yazım hatalı), "Kochko'nun Senin Hakkında Bildikleri" (menü).

**Etki:** Kullanıcı doğru yere mi geldiğini sorgular; marka dili tutarsız görünür.

**Öneri:** Her özellik için tek kanonik Türkçe ad belirle ve üç yerde (menü/native/gövde) aynısını kullan; "Koçkonun" yazımını düzelt.

---

### [MEDIUM] Bazı ekranlarda Türkçe diakritikleri soyulmuş (ı/ç/ö/ü/ş eksik)

- `app/settings/progress-photos.tsx:125/127/157/189`, `app/settings/data-import.tsx:44/91`, `app/settings/debug-mode.tsx:47/55`, `app/settings/supplements.tsx:12/14/17`

**Sorun:** Komşu ekranlar düzgün Türkçe yazarken birkaç ekran ASCII'ye soyulmuş: "Ilerleme Fotograflari", "ucuncu tarafa gonderilmez", "Veri Iceri Aktar", "Gelistirici Modu", "Hayir", "1 olcu/kapsul". Aynı ekranların native header'ı (`_layout.tsx:23/41`) doğru diakritikli — header/gövde uyuşmuyor.

**Etki:** Türk kullanıcıya yarım/aceleye gelmiş izlenimi; "İlerleme Fotoğrafları" (header) altında hemen "Ilerleme Fotograflari" (gövde).

**Öneri:** Diakritikleri geri ekle. (Not: `theme.tsx:14-16` seçenek metinleri — "Goz yorgunlugunu", "Her Zaman Acik" — de soyulmuş; aynı kategoriye dahil.)

---

### [MEDIUM] Button 'sm' varyantı 32dp — WCAG 2.5.5 minimum 44dp altında, hitSlop yok

- `src/components/ui/Button.tsx:36`, `app/settings/challenges.tsx:101-103/136`, `app/onboarding.tsx:158`

**Sorun:** `height = size==='sm' ? 32 : size==='lg' ? 48 : 40` — sm 32px, md 40px, ikisi de `accessibility.ts:16 TOUCH_TARGET_SIZE=44` altında ve TouchableOpacity'de hitSlop yok. sm gerçek yan-yana aksiyon butonlarında (challenges "Duraklat/Devam Et/Bırak", onboarding "Atla") kullanılıyor — 15 sm kullanımı / 7 dosya. `accessibility.ts:278 getTouchTargetStyle` var ama uygulanmıyor.

**Etki:** Motor güçlüğü olan/küçük ekranlı kullanıcılar için 32-40px butonlara isabet zor; yan-yana sm butonlar (challenges) yanlış basışı artırıyor.

**Öneri:** sm/md butonlarda height görsel kalsın ama hitSlop ekle (sm: `{top:6,bottom:6}`) ya da efektif alanı 44dp'ye çıkar; `getTouchTargetStyle`'ı primitive'e içselleştir.

---

### [LOW] Light tema token'ları WCAG AA'yı geçemiyor (gated, regresyon riski)

- `src/lib/theme.ts:99` (textMuted `#94A3B8`), `:102` (warning `#EF9F27`)

**Sorun:** LIGHT_COLORS gated (`_layout.tsx:53-60` yalnızca 'dark' yükler) ama token'lar AA fail: textMuted beyaz üstünde 2.56:1, surfaceLight üstünde 2.29:1; warning metni beyaz üstünde 2.17:1.

**Etki:** Bugün etkisiz; light açılırsa muted metin ve uyarılar okunamaz — gelecek regresyon.

**Öneri:** textMuted'ı ~`#64748B`'e koyulaştır; uyarı METNİ için ayrı koyu ton (`#B26A00`), `#EF9F27`'yi yalnızca dolgu/ikon için kullan.

---

### [LOW] Elevation token'ları aynı değere indirgenmiş — kart katmanlaması ayırt edilemiyor

- `src/lib/theme.ts:55-56/94-95`, `src/lib/constants.ts:29/42`

**Sorun:** Dark card/cardElevated luminans farkı yalnızca 0.006; light `card === cardElevated === '#FFFFFF'` (sıfır fark). `CARD_SHADOW = ELEVATED_SHADOW = CARD_BORDER` — 'elevated' semantiği anlamsız (deprecated ama InsightCard'da hâlâ kullanımda).

**Etki:** Modal/popover/yükseltilmiş kart altındaki yüzeyden ayrışmaz; özellikle light temada iç içe kartlar tamamen düz.

**Öneri:** Katmanı border yoğunluğu/hafif yüzey farkıyla ifade et (light cardElevated `#F7F9FB`, dark farkı aç); alternatif olarak deprecated GRADIENTS/ELEVATED_SHADOW'u kaldırıp tek 'card + border' modeline indir.

---

### [LOW] TempoChart "Gerçekleşen" çizgisi veri olmayan haftalarda sahte sabit kilo gösteriyor (carry-forward)

- `src/components/plan/TempoChart.tsx:47-49/53/82`

**Sorun:** Veri olmayan haftalarda son okuma ileri taşınıyor (`actualSeries.push(actualSeries[last] ?? startWeight)`); "Gerçekleşen" çizgisi o haftalarda yatay devam edip ölçülmemiş veriyi ölçülmüş gibi sunuyor. ETA `slice(-3)` ile carry-forward'lu seriye dayandığından kısmi boşlukta tempo yanlış hesaplanabilir.

**Etki:** Kullanıcı tartılmadığı haftalarda kilosunun "aynı kaldığını" gösteren yanıltıcı düz çizgi görür; veri dürüstlüğü ve ETA güvenilirliği zedelenir.

**Öneri:** Carry-forward yerine son gerçek noktadan sonrasını çizme veya kesik/soluk stil kullan; ETA'yı yalnızca gerçek ölçüm haftalarından hesapla.

---

### [LOW] CircularProgress merkez metni maxFontSizeMultiplier sınırlamıyor — büyük fontta ring taşması

- `src/components/ui/CircularProgress.tsx:77-95`, `src/lib/constants.ts:14-20`

**Sorun:** Ring sabit `size` (varsayılan 160) ile çiziliyor ama value/unit/label/sublabel Text'leri `maxFontSizeMultiplier` almıyor — `constants.ts:14-20 MAX_FONT_SCALE=1.3` ve "progress labels should pass this" yorumu varken primitive kendi yönergesini uygulamıyor.

**Etki:** Sistem font ölçeği %130-150'de çok haneli değer (ör. "1450") ringi taşırır/alt etiketle üst üste biner; hero dashboard'da okunamaz.

**Öneri:** Merkez Text'lere `maxFontSizeMultiplier={MAX_FONT_SCALE}` ekle.

---

### [LOW] EmptyState CTA'sı Button primitive yerine kendi butonunu elle yazıyor

- `src/components/ui/EmptyState.tsx:34-41`

**Sorun:** CTA için Button yerine inline TouchableOpacity + colors.primary + getContrastColor; activeOpacity/disabled yok. Button'ın disabled/loading/variant/touch-target politikasından ve ileride eklenecek a11y düzeltmelerinden bağımsız kalıyor. (Not: role/label var, bu yüzden low.)

**Etki:** Buton stili/erişilebilirliği tek yerden yönetilemiyor; Button iyileştirmeleri (busy, hitSlop) CTA'ya yansımıyor.

**Öneri:** CTA'yı `<Button title={ctaLabel} onPress={onPressCta} accessibilityLabel={ctaLabel} />` ile değiştir.

---

### [LOW] DateTimeField minimumDate/maximumDate desteklemiyor — gelecek tarih seçilebiliyor (menstrual)

- `src/components/ui/DateTimeField.tsx:13-20/64-76`, `app/settings/menstrual.tsx:72`

**Sorun:** Props min/maxDate almıyor ve DateTimePicker'a geçirilmiyor. menstrual "Son Regl Başlangıcı" (mode='date') için kullanıyor ama picker gelecek tarihi serbest bırakıyor.

**Etki:** "Son regl başlangıcı"na gelecek tarih girilebilir; bu değer döngü/faz tahminlerine (dayOfCycle) hatalı yansır — sessiz veri bozulması.

**Öneri:** Props'a `minimumDate?/maximumDate?: Date` ekleyip picker'a geçir; menstrual'da `maximumDate={new Date()}`.

---

### [LOW] Kilo trend grafiği renkleri ekranlar arası ve marka metrik rengiyle tutarsız

- `app/(tabs)/progress.tsx:50/211`, `app/reports/monthly.tsx:146`, `src/lib/theme.ts:132/50`

**Sorun:** Kilo marka rengi `METRIC_COLORS.weight='#D4537E'` (pembe) ve progress özet ikonu `colors.pink`; ama progress kilo grafiği sabit teal (`rgba(29,158,117)`, uyum grafiğiyle paylaşılan config), monthly ise `COLORS.secondary='#7F77DD'` (mor). Aynı "kilo trendi" üç farklı renkte.

**Etki:** Kullanıcı aynı metriği farklı ekranlarda farklı renkte görür; görsel kimlik dağılır.

**Öneri:** Kilo grafiklerini tek kaynağa bağla (`METRIC_COLORS.weight`); progress'te kilo için ayrı chartConfig.color üret, monthly'de `color={METRIC_COLORS.weight}`.

---

### [LOW] PhaseTimeline currentWeek totalWeeks'i aştığında bozuk metin ("Hafta 20 / 16")

- `src/components/plan/PhaseTimeline.tsx:118/45`

**Sorun:** `Hafta {currentWeek} / {totalWeeks}` clamp'siz basılıyor. totalWeeks fazların targetWeeks toplamı; kullanıcı süreyi aşarsa "Hafta 20 / 16" gibi mantıksız ifade çıkar. Bar'da "şu an" işaretçisi de yok (`:60-94` statik bloklar).

**Etki:** Süresi aşmış çok-fazlı hedeflerde tutarsız metin; küçük güven kaybı.

**Öneri:** `Hafta {Math.min(currentWeek, totalWeeks)} / {totalWeeks}` clamp et, aşım varsa "(+N hafta)" göster; opsiyonel "şu an" işaretçisi ekle.

---

### [LOW] Ölü prop'lar: dashboard'da tarih, uyku/kilo hiç render edilmiyor

- `src/components/dashboard/HeroSection.tsx:16/73` (`today`), `src/components/dashboard/StatStrip.tsx:12-19/78` (`sleepHours`/`weightKg`), `app/(tabs)/index.tsx:310/349-356`

**Sorun:** index.tsx HeroSection'a `today` ('Cumartesi, 20 Haziran') geçiyor ama JSX'te render edilmiyor (yalnızca tip+destructure). StatStrip'e `sleepHours`/`weightKg` geçiyor ama imza (`:78`) destructure etmiyor; yalnızca Su+Adım kartı (2 kart) render ediliyor.

**Etki:** Dashboard'da bugünün tarihi ve uyku/kilo metrikleri hiç görünmüyor (bağlanmış sanılıyor); ölü prop'lar bakım yükü.

**Öneri:** today'i selamlama altına alt-metin olarak render et (veya prop'u kaldır); StatStrip'e uyku/kilo kartı ekleyip 2x2 grid yap (veya prop'ları kaldır).

---

### [LOW] accessibility.ts kütüphanesinin yarısı ölü kod — anlamlı `<Image>`'lar etiketsiz

- `src/lib/accessibility.ts:83/94/105/146/278` (+ `:60/218/232/268`), `app/settings/progress-photos.tsx:173/180/204`

**Sorun:** a11yText/a11yImage/a11yLink/a11yTab/getTouchTargetStyle/getAccessibilityProps/formatForScreenReader/complianceDescription/meetsContrastAA = dosya dışında 0 kullanım. Özellikle a11yImage hiç kullanılmadığından progress-photos `<Image>`'ları (foto + karşılaştırma modal) accessibilityLabel taşımıyor.

**Etki:** Tutarsız a11y kaplaması; görseller etiketsiz, ölü kod bakımı zorlaştırıyor ve "a11y tamamlandı" yanılgısı yaratıyor.

**Öneri:** a11yImage'i anlamlı `<Image>`'lara yay (dekoratiflere accessibilityElementsHidden), getTouchTargetStyle'ı küçük hedeflere bağla; kalan kullanılmayan export'ları kaldır.

---

### [NIT] RADIUS ölçeğinde xl ve xxl ikisi de 24; SPACING'de 20 adımı yok

- `src/lib/constants.ts:11/7`, `PlanOverviewCards.tsx:165`, `StatStrip.tsx:45`, `HeroSection.tsx:118`

**Sorun:** `RADIUS.xl === RADIUS.xxl === 24` (ölçek anlamsız); SPACING'de `xl=16 → xxl=24` sıçraması, 20 yok. Kart köşeleri tutarsız (md/lg karışık).

**Öneri:** RADIUS.xxl'i kaldır ya da gerçek değere ayır; kartlar için tek "kart yarıçapı" token'ı belirle.

---

### [NIT] Login ve Register logo/başlık blokları görünür biçimde farklı

- `app/(auth)/login.tsx:64-66`, `app/(auth)/register.tsx:82-84`

**Sorun:** login logo `letterSpacing:2` + alt başlık `marginTop:SPACING.xs` + blok `marginBottom:SPACING.xxl`; register'da letterSpacing yok, marginTop yok, marginBottom `SPACING.lg`.

**Öneri:** Logo/başlık bloğunu ortak bileşene çıkar veya iki dosyada aynı stil değerlerini kullan.

---

### [NIT] İki ayrı '+' eylemi aynı görsel dilde; Plan sekmesi etiketsiz FAB

- `app/(tabs)/_layout.tsx:78-81/33`, `app/(tabs)/chat.tsx:221`

**Sorun:** Merkezi FAB (`Ionicons name="add" size=28`, log'a gider) ile Chat header yeni-sohbet butonu (`add` size=22) aynı görsel dilde; tab bar'da Plan slotu etiketsiz (yalnızca accessibilityLabel). İki '+' farklı bağlamda olduğundan çakışma riski düşük.

**Öneri:** Chat yeni-sohbet düğmesini farklı ikona al (`create-outline`/`add-circle`); merkezi FAB için küçük etiket düşün.

---

## UX / Akış, Etkileşim & İçerik

**Boyut skoru: 2.5 / 5**

**Tek-cümle hüküm:** Çekirdek akışlar çalışıyor ama plan/sohbet ekranlarında sonsuz-spinner ölü uçları, OAuth onboarding'inde eksik yaş, keşfedilemez ayar mimarisi, çalışmayan deneme bildirimi ve baştan sona aksansız Türkçe ekranlar uygulamayı "neredeyse bitmiş ama cilasız ve kenarlardan kırılgan" seviyesinde tutuyor.

### Severity Özeti

| Severity | Adet |
|---|---|
| Critical | 0 |
| High | 7 |
| Medium | 9 |
| Low | 9 |
| **Toplam** | **25** |

42 ham bulgu, kök-sebep birleştirmesiyle 25 ayrı bulguya indirgendi (yükleme/hata-durumu, aksansız-metin, mesaj-sayacı baypası ve çift-gönderim grupları konsolide edildi).

---

### [HIGH] Plan ekranları (diyet & antrenman) ağ hatasında sonsuz spinner'da kalıyor — hata/retry durumu yok
- `app/plan/diet.tsx:90-108`, `app/plan/diet.tsx:312-318`
- `app/plan/workout.tsx:78-93`, `app/plan/workout.tsx:284-290`

**Sorun:** Her iki ekranın `load()` callback'i try/catch içermiyor; `view`'i `'loading' → 'empty'/'draft'/'active'` geçişini SADECE başarı yolunda yapıyor. `Promise.all([getActive, getDraft, goals...])` bir ağ-katmanı reddiyle (fetch TypeError, DNS, Supabase 5xx) reddederse `setView(...)` hiç çağrılmaz ve `view` kalıcı `'loading'` kalır. Render dalı (`if (view === 'loading')`) süresiz `ActivityIndicator` gösterir; pull-to-refresh/retry yok.

**Etki:** Plan sekmeleri ürünün ana değer önerisi (AI plan). İnternetin anlık kesilmesi veya Supabase timeout'unda kullanıcı planlarına hiç erişemez; tek çıkış ekranı kapatıp açmak. `reports/daily.tsx:92-101` doğru deseni (error + "Tekrar dene") zaten uyguladığı için bu net bir tutarsızlık.

**Öneri:** `load()` gövdesini try/catch ile sar; catch'te `setView('error')` durumu + retry butonu göster (`reports/daily.tsx` deseni). En azından catch'te `setView('empty')` yaparak PlanEmptyState üzerinden yeniden denemeye izin ver.

```ts
// diet.tsx:90 — try/catch yok
const load = useCallback(async () => {
  if (!user?.id) return;
  const [activeRow, draftRow, goalRes] = await Promise.all([...]); // reddederse view kalıcı 'loading'
  if (!mountedRef.current) return;
  if (draftRow) setView('draft'); else if (activeRow) setView('active'); else setView('empty');
}, [...]);
```

---

### [HIGH] Plan taslak/revizyon ekranında `chatSessionId` yeniden hidrate edilmiyor — kalıcı taslak ölü uca düşürüyor
- `app/plan/diet.tsx:90-108` (load), `app/plan/diet.tsx:150/171/212` (guard'lar), `app/plan/diet.tsx:124/294` (set)
- `app/plan/workout.tsx:90` (load), `app/plan/workout.tsx:130/151/190` (guard'lar), `app/plan/workout.tsx:107/271` (set)

**Sorun:** `chatSessionId` yalnızca bellekteki React state'tir ve sadece `startDraftCreation` ile `handleStartRevision` içinde set edilir; `load()` veya hiçbir effect onu kalıcı taslak satırından geri yüklemez. `getDraft` taslak bulunca `view='draft'` olur ve taslak arayüzü çizilir ama `chatSessionId` null kalır. Sonraki mount/odakta `useFocusEffect→load()` taslağı yeniden çizer; `sendUserMessage`, `handleAlternative` ve `handleApprove` ise `if (!chatSessionId) return` ile erken çıkar.

**Etki:** Yarım taslağı/revizyonu olan kullanıcı plan tab'ını yeniden açıp composer'a yazıp gönderdiğinde HİÇBİR ŞEY olmaz; "Onayla ve kaydet", "Alternatif gör" ve öğün-düzenleme tap'leri sessizce yutulur. Tam ölü uç; tek çıkış "Baştan başla" (taslağı discard).

**Öneri:** `load()` taslağı bulduğunda taslağa bağlı/yeni bir oturum türetip `setChatSessionId` ile geri yükle (taslak satırına `chat_session_id` kolonu ekle veya bulunca `createSession`). En azından `chatSessionId` null iken composer'ı "Devam etmek için yeni taslak oluştur" uyarısıyla kilitle, böylece sessiz yutma olmasın.

---

### [HIGH] OAuth (Google/Apple) kullanıcılarında `birth_year` hiç toplanmıyor — yanlış TDEE, çözülemeyen "Kendini tanıt" görevi, bloke plan
- `app/onboarding.tsx:172-177/194/248/250-254/261-276`
- `src/stores/auth.store.ts:69` (e-posta) vs `78-112/114-151` (OAuth, metadata yok)
- `app/(auth)/register.tsx`, `app/index.tsx:84`
- `src/services/onboarding-tasks.service.ts:41`, `src/lib/plan-readiness.ts:74`

**Sorun:** `birth_year` YALNIZCA e-posta kaydında toplanıyor (`register.tsx` → `auth.store.ts:69 options.data.birth_year` → mig 044 trigger). `signInWithGoogle`/`signInWithApple` hiçbir metadata göndermiyor. OAuth kullanıcısı `onboarding_completed=false` ile onboarding'e yönlenir ama QuickForm yalnız 5 alan (boy/kilo/cinsiyet/hedef/aktivite) toplar; yaşı ne sorar ne yazar. Yaş yalnız metadata'dan okunduğu için `age=30`'a düşer ve `update()`'te `birth_year` hiç set edilmez → `profiles.birth_year` süresiz NULL kalır.

**Etki:** (1) TDEE OAuth kullanıcılarında hardcoded `age=30` ile hesaplanır → kalori hedefi sapar. (2) `introduce_yourself` görevi `birth_year` şartı taşır → ASLA tamamlanmaz, ProfileCompletionDonut %100 olamaz, "Kendini tanıt" kartı kalıcı görünür. (3) `plan-readiness.ts:74` planı "Yaş eksik" diye bloklar → diet/workout CTA disabled. Hafifletme: kullanıcı sohbette yaşını söylerse `ai-chat` düzeltir (`index.ts:4275-4280`), ama bu kullanıcı inisiyatifine bağlı; varsayılan durumda hata mevcut.

**Öneri:** Onboarding QuickForm'una doğum yılı/yaş alanı ekle (en az: metadata.birth_year yoksa koşullu göster), `update()` içinde `profiles.birth_year`'a yaz ve `isValid`'e dahil et.

---

### [HIGH] `menstrual.tsx` ve `goals.tsx` Kaydet butonlarında loading/try-catch guard'ı yok — çift-gönderim + kalıcı buton kilidi
- `app/settings/menstrual.tsx:39-51` (handleSave), `app/settings/menstrual.tsx:119` (Button)
- `app/settings/goals.tsx:146-180` (handleSave), `app/settings/goals.tsx:299` (Button)

**Sorun:** İki ekran aynı kök kusuru farklı semptomla taşıyor. `menstrual.tsx` handleSave hiç `saving` state'i tutmuyor ve Button `loading`/`disabled` almıyor → yavaş ağda çift basış iki UPDATE + üst üste iki Alert üretir. `goals.tsx` handleSave `setSaving(true)` diyor ama iki ardışık await'i (`goals.update` + `addPhase`) try/catch OLMADAN çalıştırıyor; biri throw ederse `setSaving(false)`'a hiç ulaşılmaz ve Button (`loading={saving}`) kalıcı spinner'da kilitlenir, kullanıcıya hata gösterilmez. `edit-profile.tsx` doğru deseni (try/catch/finally + `loading={saving}`) uyguluyor.

**Etki:** menstrual'de yinelenen yazma + ilk Alert `router.back()` yapınca ikinci Alert kapalı ekranda asılı kalır. goals'da ağ/RLS hatasında kullanıcı sonsuza dek kilitli "kaydediliyor" butonuyla kalır, hedef sessizce kaydedilmez.

**Öneri:** Her iki handler'ı `edit-profile` kalıbına geçir: `const [saving, setSaving] = useState(false)`, gövdeyi `try { setSaving(true); ... } catch { haptics.error(); Alert.alert('Kaydedilemedi'); } finally { setSaving(false); }`, butona `loading={saving}`.

```ts
// goals.tsx:165-179 — try/catch yok
setSaving(true);
await supabase.from('goals').update({ is_active: false })...; // throw → aşağısı atlanır
await addPhase(user.id, ...);
setSaving(false); // throw olursa buraya hiç gelinmez
Alert.alert('Başarılı', ...);
```

---

### [HIGH] Tüm ayarlar hub'ı (Premium/Güvenlik/Challenge dahil 30+ satır) tek bir gömülü satırdan erişilebilir — keşfedilemez IA
- `app/(tabs)/profile.tsx:118` (tek `/settings` girişi)
- `app/settings/index.tsx:88-177` (19+ premium/güvenlik/sosyal satırı)

**Sorun:** `settings/index.tsx` zengin bir merkez: Premium upsell (96), Hesap Güvenliği (164), Challenge'lar (120), Başarımlar (121), AI Şeffaflık (177), İlerleme Fotoğrafları (129), Aile Planı (137) gibi ~30 satır. Ama bu ekrana giden TEK yol, profil sekmesinde "Veri & gizlilik" altında gömülü duran "Tüm ayarlar" satırıdır (`profile.tsx:118`). Grep ile tüm kod tabanında `/settings`'e giden başka navigasyon yok. Profil sekmesi yalnız ~12 ayara doğrudan link veriyor.

**Etki:** Premium dönüşümünü doğrudan vurur: ücretsiz kullanıcı Premium ekranına yalnız profil > veri-gizlilik > "Tüm ayarlar"a girip kaydırarak ulaşır. Hesap Güvenliği (2FA/şifre), challenge'lar ve birçok premium özellik pratikte keşfedilemez. Kullanıcı "bu özellik nerede?" diye arar, bulamaz.

**Öneri:** "Tüm ayarlar"ı üst seviyeye taşı (profil başlığının yanına dişli ikonu veya kendi "Ayarlar" bölümü). En azından Premium upsell ve Hesap Güvenliği'ni profil sekmesinde birinci-sınıf satır yap.

---

### [HIGH] Deneme süresi bitiş hatırlatması hiç tetiklenmiyor (ölü kod) + iç mantık çelişkisi
- `src/services/notifications.service.ts:421` (scheduleTrialReminder), `:445` (checkAndScheduleTrialReminder)
- `src/hooks/usePremium.ts:21`

**Sorun:** `checkAndScheduleTrialReminder()` ve `scheduleTrialReminder()` tanımlı ama tüm kod tabanında hiçbir dış çağrı yok (grep: yalnız 3 satır — 2 export + 1 iç çağrı). `usePremium.ts:21` yorumu "yeniden etkinleştirildi" ima etse de hiçbir ekran/effect çağırmıyor. Üstüne mantık çelişkisi: `checkAndScheduleTrialReminder` `trialDaysLeft <= 2 && > 0` (yani 1 veya 2) için çağırıyor ama `scheduleTrialReminder:422` `if (trialDaysLeft !== 2) return;` ile 1-gün-kala durumunda sessizce no-op oluyor.

**Etki:** Deneme süresi biten kullanıcı hiçbir uyarı almıyor; trial sessizce bitiyor, free→paid dönüşüm fırsatı kaçıyor. Doğrudan gelir etkisi.

**Öneri:** `checkAndScheduleTrialReminder(isInTrial, trialDaysLeft)`'i uygulama açılışı / dashboard focus effect'inde çağır. Ayrıca `scheduleTrialReminder`'daki `!== 2` koşulunu `> 2` yap ki 1-gün-kala da hatırlatma kurulsun.

---

### [HIGH] İki ekran baştan sona diakritiksiz (ASCII-soyulmuş) Türkçe — marka cilası kırık
- `app/settings/data-import.tsx:36/38/44/46/52/83/91/95/97/106`
- `app/settings/venues.tsx:34/38/42/61`
- (ayrıca nav başlıkları doğru: `app/settings/_layout.tsx:23` → ekran-içi/nav tutarsızlığı)

**Sorun:** Veri İçeri Aktar ve Mekanlar ekranlarındaki neredeyse tüm görünür metinler Türkçe karakterleri kaybetmiş: "Veri Iceri Aktar", "Baska uygulamalardan ... disa aktardigin", "Ogun Verisi", "kayit aktarildi", "Basarili", "Import basarisiz"; venues'te boş-durum "Henuz kayitli mekan yok. Kocuna 'Simit Sarayi'nda yedim' gibi yazdiginda mekan otomatik ogrenilir." Nav başlığı (`_layout.tsx:23 'Veri İçeri Aktar'`) doğru aksanlı olduğu için aynı ekranda hem düzgün hem bozuk Türkçe yan yana görünüyor.

**Etki:** Boş-durum ve ilk-açılış metinleri kullanıcının gördüğü ana içerik; özensiz izlenim verir, marka güvenini düşürür. Bu, "modern enerjik UI" hedefiyle doğrudan çelişir.

**Öneri:** Tüm dizeleri doğru aksanla yaz (Veri İçeri Aktar, Başka uygulamalardan, dışa aktardığın, yapıştır, Öğün Verisi, Sonuç, kayıt aktarıldı, Başarılı, İçe aktarma başarısız; Sık gittiğin, öğrenilen, Dışarıda Yemek Planlıyorum, Henüz kayıtlı, Koçuna, Sarayı'nda, yazdığında, öğrenilir, onaylı).

---

### [MEDIUM] Çevrimdışıyken dashboard'da üç ayrı çevrimdışı göstergesi aynı anda görünüyor
- `app/_layout.tsx:11/84` (global common banner)
- `app/(tabs)/index.tsx:247/312` (inline ui banner + isOffline prop)
- `src/components/dashboard/HeroSection.tsx:98-113` (hero çipi)
- `src/components/common/OfflineBanner.tsx:64-85` (absolute overlay) vs `src/components/ui/OfflineBanner.tsx:14-31` (inline)
- `app/chat/[sessionId].tsx:1038` (chat detayda da çift)

**Sorun:** İki ayrı OfflineBanner bileşeni var (common = absolute overlay zIndex 1000, global mount `_layout.tsx:84`; ui = inline). Dashboard ayrıca ui versiyonunu inline render ediyor (`index.tsx:247`) VE HeroSection'a `isOffline` geçip üçüncü bir çipi gösteriyor. Sonuç: çevrimdışıyken üç farklı metin/renkle üst üste banner ("Çevrimdışısın — internet gelince..." + "Internet yok. Mesaj gonderimi..." + "Çevrimdışı — kayıtların senkronize edilecek").

**Etki:** Görsel kirlilik; aynı bilgi üç kez, overlay banner inline banner'a biner. Chat detayda da çift banner.

**Öneri:** Tek kaynağa indir: global `common/OfflineBanner` zaten tüm ekranları kapsadığı için dashboard ve chat-detaydaki inline `ui/OfflineBanner` çağrılarını ve HeroSection'a `isOffline` geçişini kaldır. İki bileşenden biri elensin.

---

### [MEDIUM] Sohbet sayacı QuickSelect / "Neden?" / plan onay-red / foto yollarını baypas ediyor — "kalan mesaj" rozeti yanlış
- `app/chat/[sessionId].tsx:578-580` (handleSend metin yolu, sayaçlı)
- `app/chat/[sessionId].tsx:776` (handleQuickSelect), `:931` (handleAskWhy), `812-889` (confirm/reject/persona)
- `app/chat/[sessionId].tsx:577/616-618` (foto yolu sayaçsız)
- `src/services/message-counter.service.ts`, `src/services/chat.service.ts:32` (`remaining` okunmuyor)

**Sorun:** `handleSend` ana metin yolu `incrementAndCheck` ile 50/gün limitini uygular ve `remainingMsgs`'i günceller. Ancak chip tabanlı tüm gerçek LLM tur'ları — `handleQuickSelect`, `handlePlanConfirm/RejectReason`, `handleLowConf*`, `handlePersona*`, `handleAskWhy` — `sendMessageToSession`'ı doğrudan çağırır, sayaç yoktur. Aynı şekilde foto/barkod gönderimi (en pahalı vision çağrısı) `if (text && !photo)` guard'ı dışında kaldığı için hiç sayılmaz. Sunucunun döndürdüğü `data.remaining` ise istemcide hiç tüketilmiyor.

**Etki:** Free kullanıcı limitini chip/foto etkileşimleriyle harcamadan geçer; "X mesaj hakkı kaldı" rozeti gerçek maliyetle örtüşmez; sunucu rate-limit'i devreye girince beklenmedik "limit doldu" yaşanır.

**Öneri:** İş kararını netleştir: bu yollar sayılacaksa hepsine `incrementAndCheck`/refund ekle; sayılmayacaksa en azından istemci rozetini sunucunun `data.remaining`'iyle senkronla — tahmini istemci sayacına güvenme.

---

### [MEDIUM] Chat mesaj kotası gate'i `premium_expires_at`'i onurlandırmıyor (grace penceresinde tutarsız)
- `app/chat/[sessionId].tsx:333` (ham `.premium`)
- `src/lib/premium-gate.ts:57-69` (`isActivePremium`)

**Sorun:** `const isPremium = !!(profile)?.premium;` ham boolean'ı kullanılıyor ve `getRemainingMessages`/`incrementAndCheck`'e besleniyor. Oysa tam bu durum için `isActivePremium()` var ve dosyanın kendi yorumu `profiles.premium`'ın expiry'den 1-2 gün sonra (cron grace) true kalabileceğini söylüyor. Chat dosyası `isActivePremium`/`usePremium` import etmiyor.

**Etki:** Premium süresi dolmuş ama cron boolean'ı henüz çevirmemiş kullanıcı (grace) chat'te sınırsız mesaj görür — sunucu rate-limit'iyle tutarsız; mesaj rozeti de bu kullanıcılara hiç gösterilmez.

**Öneri:** Satır 333'ü `isActivePremium(profile)` (veya `usePremium().isPremium`) ile değiştir.

---

### [MEDIUM] Deneme geri sayımı yalnızca premium ekranında görünür — ana akışlarda hiç yüzeye çıkmıyor
- `app/(tabs)/index.tsx` (premium/trial referansı yok)
- `app/settings/premium.tsx:53/175`, `src/hooks/usePremium.ts:27`

**Sorun:** `usePremium()` `trialDaysLeft`/`isInTrial` döndürüyor ama yalnız `premium.tsx` tüketiyor. Dashboard'da premium/trial/paywall/usePremium için grep hiç eşleşme döndürmedi.

**Etki:** Deneme süresi olan kullanıcı kaç günü kaldığını görmek için Ayarlar > Premium'a manuel gitmek zorunda; aciliyet hissi oluşmadan free'ye düşüyor. (Önceki ölü-bildirim bulgusuyla birleşince: kullanıcı ne bildirim ne dashboard uyarısı alıyor.)

**Öneri:** Dashboard'a `isInTrial && trialDaysLeft <= 3` iken "Denemen X gün sonra bitiyor — Premium'a geç" banner'ı ekle; `/settings/premium`'a yönlensin.

---

### [MEDIUM] Donut başlığı (13-görev) ile gap-ipucu (24-alan profile-completion) farklı kaynaklardan çelişen mesaj veriyor
- `src/components/dashboard/ProfileCompletionDonut.tsx:59/72-73/93-102/166`
- `src/lib/profile-completion.ts:14-45`
- `src/services/onboarding-tasks.service.ts`

**Sorun:** Headline yüzdesi `getOnboardingProgress` (13 görev) üzerinden; "eksik" ipucu satırı (`hintLine`) ise bambaşka `calculateProfileCompletion` (24 ağırlıklı alan) sisteminden geliyor. Alan kümeleri farklı: profile-completion `training_style`/`diet_mode`/`meal_count_preference` sayar, 13-görev saymaz.

**Etki:** 13 görev tamamlanıp `pct=100` olduğunda donut "Profilin hazır" derken `hintLine` hâlâ doldurulmamış weight-2 alanlar yüzünden "Yaşam Tarzı tamamla" diyebilir — kullanıcıya çelişen iki gerçek. Dosya yorumu "aynı kaynak" iddia ediyor ama bu yalnız headline için doğru.

**Öneri:** Gap-ipucunu da 13-görev sisteminden türet (ilk eksik görevin başlığı) veya `pct=100`'de `hintLine`'ı zorla "Profilin tamam" yap.

---

### [MEDIUM] Hesap silme için iki ayrı, tutarsız sürtünme düzeyinde UX akışı (Alert tek-tık vs "SIL" yazma)
- `app/(tabs)/profile.tsx:119-141` (tek-tık destructive Alert)
- `app/settings/index.tsx:29/42-71/202-251` ("SIL" yazma typed-confirm modal)

**Sorun:** Aynı geri-alınamaz hesap-silme işlemi iki ekrandan iki farklı sürtünme düzeyiyle tetikleniyor. Profil sekmesinde tek Alert + tek tık yeterli; settings hub'ında ikinci modalda "SIL" yazmak zorunlu (`canDelete = deleteConfirm === 'SIL'`). İkisi de aynı sütunları (`deletion_requested_at` + `deleted_at`) yazar — sonuç birebir aynı, yalnız koruma seviyesi tutarsız.

**Etki:** Yıkıcı işlem (30 gün sonra kalıcı silme) için tutarsız koruma; profil sekmesindeki yol kazara silmeye çok daha açık. Ayrıca aynı eylemin iki yerde olması bakım yükü/davranış sapması riski.

**Öneri:** Her iki girişi tek paylaşılan akışa indir; tercihen profil yolunu da settings'teki "SIL" typed-confirm modaline yönlendir (veya o yolu kaldırıp settings'e link ver).

---

### [MEDIUM] prefill akışında `router.replace` ile açılan sohbette geri tuşu sekme listesini atlıyor
- `app/(tabs)/chat.tsx:65/74` (prefill `router.replace`) vs `:138/147` (normal `router.push`)
- `app/chat/[sessionId].tsx:992` (koşulsuz `router.back()`)

**Sorun:** Dashboard hızlı-eylemi/log modali bir prefill parametresiyle chat'e yönlenince oturum `router.replace` ile açılır (push değil). Sohbet ekranının geri tuşu her zaman `router.back()` çağırır; replace ile chat-tab yığından çıktığı için kullanıcı sohbet OTURUM LİSTESİNE değil, replace öncesindeki ekrana düşer. Normal akış (`router.push`) doğru biçimde listeye döner — aynı ekranın geri davranışı, ona nasıl gelindiğine göre tutarsız.

**Etki:** Kullanıcı hızlı-kayıt/öğün fotoğrafı için sohbete girip geri basınca beklenmedik ekranda bulur; sohbet sekmesinin durumu (oturum listesi) kaybolur, mental model bozulur.

**Öneri:** prefill dalında da `push` kullan ya da geri tuşunu hedef-farkındalıklı yap (prefill ile gelindiyse `router.replace('/(tabs)/chat')`).

---

### [MEDIUM] Birden çok ekran ağ hatasında sonsuz spinner'da kalıyor (catch/finally eksik) — ortak desen
- `app/chat/[sessionId].tsx:422-486` (loadSessionMessages `.catch` yok), `:955-961` (tam ekran spinner)
- `app/settings/strength.tsx:20-25/44` (`loading` state JSX'te hiç okunmuyor + `.catch` yok)
- `app/settings/food-preferences.tsx:31-36/62-64` (load try/finally yok)
- `app/(tabs)/index.tsx:99-106/178/290` + `src/stores/dashboard.store.ts` (`fetchError` bayrağı yok)

**Sorun:** Aynı kök kusur dört ekranda. Chat detay: `loadSessionMessages(...).then(async ...)` zincirinin `.catch`'i yok ve içte korumasız `await sendMessageToSession` var → throw olursa `loading` kalıcı true, tam ekran spinner. Strength: `loading` state tanımlı ama JSX'te hiç okunmuyor (render `validExercises.length===0`'a bağlı) → veri gelmeden "kayıt yok" boş-durumu flaşlanır, `.catch` yokluğunda ağ hatasında kalıcı yanlış boş-durum. food-preferences: `load()` try/finally yok → fetch reddinde `setLoading(false)` atlanır, sonsuz spinner. Dashboard: `fetchToday(...).catch(console.warn)` hatayı yutar, `firstLoad` mantığı başarısız ilk yüklemeyi "boş/sıfır gün" olarak gösterir; `fetchError` bayrağı/retry yok.

**Etki:** Sohbet (AI koç) ve dashboard ürünün merkezi; ağ kesintisi/5xx'te kullanıcı sonsuz spinner'a takılır veya yüklenemeyen veriyi "boş gün" sanır — veri-kaybı gibi okunur. Strength verisi olan kullanıcı her açılışta yanlış "kayıt yok" görür. Hiçbirinde retry yok. `reports/daily.tsx` doğru deseni zaten gösteriyor.

**Öneri:** Tüm load callback'lerini try/catch/finally ile sar; hata durumunda `setLoading(false)` + error/retry görünümü göster. Dashboard'da `dashboard.store`'a `fetchError` bayrağı ekleyip başarısız fetch'i gerçek boş günden ayır. Strength'te `if (loading) return <Skeleton/>` ekle.

---

### [MEDIUM] `lab-values.tsx` KeyboardAvoidingView yok + "Değer" alanında sayısal doğrulama yok
- `app/settings/lab-values.tsx:30-34` (validation), `:54-55` (düz ScrollView), `:86-89` (Ref Min/Max + Kaydet)

**Sorun:** İki kusur aynı ekranda. (1) Ekran düz `<ScrollView>` ile sarılı; KeyboardAvoidingView ve `keyboardShouldPersistTaps` yok → "Yeni Değer Ekle" kartının altındaki Ref Min/Max + Kaydet klavyenin altında kalır, ScrollView otomatik kaydırmaz. (2) `handleAdd` yalnız `paramName.trim() && value.trim()` boşluk kontrolü yapıp `value: parseFloat(value)` ile DB'ye yazar; kopyala-yapıştırla harf girilebilir (`parseFloat('45 ng')=45`, `parseFloat('yüksek')=NaN`), inline hata yok. `edit-profile`/`goals`/`menstrual` hepsi KeyboardAvoidingView kullanıyor.

**Etki:** Ref Min/Max doldururken klavye Kaydet'i kapatır; ayrıca NaN/geçersiz lab değeri sessizce kaydedilir, `is_out_of_range` ve trend bozulur.

**Öneri:** En dışa `KeyboardAvoidingView` + ScrollView'a `keyboardShouldPersistTaps="handled"` ekle (diğer ayar ekranlarındaki gibi). `parseFloat` sonrası `Number.isFinite(n)` kontrolü ekle; geçersizse Input `error` prop'u/Alert ile engelle.

---

### [MEDIUM] `log.tsx` Uyku ekranı hâlâ serbest-metin TextInput kullanıyor — DateTimeField'a geçilmemiş
- `app/log.tsx:449-461` (TextInput + `numbers-and-punctuation`), `:257-269` (handleSleepSave)
- karşılaştırma: `app/settings/edit-profile.tsx:234-235` (DateTimeField `mode="time"`)

**Sorun:** Quick-Log uyku ekranında iki saat alanı ham TextInput; `edit-profile` aynı uyku/uyanma alanları için `DateTimeField mode="time"` kullanıyor. `handleSleepSave` `split(':')` + `Number.isFinite` ile reaktif olmayan doğrulama yapıp Alert atıyor — native picker olsaydı geçersiz giriş baştan imkânsızdı.

**Etki:** iOS'ta `numbers-and-punctuation` klavyesi ':' içermeyebilir; "2300"/"23.00"/"11pm" gibi geçersiz biçim girip Alert ile geri dönmek gerekir. Uygulamanın geri kalanıyla tutarsız UX.

**Öneri:** İki TextInput'u `<DateTimeField mode="time" value={sleepTime} onChange={setSleepTime} />` ile değiştir (`edit-profile:234-235` ile birebir). `handleSleepSave` güvenlik ağı olarak kalabilir.

---

### [MEDIUM] Ham backend/JS hata mesajları kullanıcıya doğrudan gösteriliyor (İngilizce/teknik sızıntı)
- `app/settings/account-security.tsx:94/116/179`
- `app/settings/progress-photos.tsx:89`
- `app/(tabs)/chat.tsx:87`
- `app/plan/workout.tsx:266`, `app/plan/diet.tsx:289`
- `app/settings/food-preferences.tsx:43` (ölü fallback)

**Sorun:** Birçok yerde Supabase/JS `error.message` Alert'e ham basılıyor; bunlar genelde İngilizce/teknik ("Password should be at least 6 characters", "New password should be different from the old password", Postgres mesajları). `food-preferences.tsx:43`'te `error.message ?? 'fallback'` — `error.message` daima dolu olduğu için fallback fiilen ölü, ham mesaj çıkar.

**Etki:** Türkçe uygulamada İngilizce/teknik hata; özellikle şifre/e-posta değiştirme gibi sık akışlarda kafa karıştırıcı ve kalitesiz görünür.

**Öneri:** Bilinen hata kodlarını/desenlerini (`weak_password`, `same_password`, `email_taken` vb.) Türkçe mesaja eşle; bilinmeyenlerde sabit Türkçe fallback göster. `error.message`'ı yalnız `console.warn`'a yaz, kullanıcı alert'ine değil.

---

### [LOW] `handleStartRevision` mevcut taslağı kontrol etmeden draft INSERT ediyor — unique index ihlali ham SQL hatası sızdırıyor
- `app/plan/diet.tsx:274-292`, `app/plan/workout.tsx:251-269`
- `supabase/migrations/030_plan_versioning.sql:54-57`

**Sorun:** `handleStartRevision` doğrudan `status='draft'` INSERT eder, öncesinde `getDraft` kontrolü yok (import edilmiş ama çağrılmıyor). Migration 030 `(user_id, plan_type) WHERE status='draft'` partial unique index tanımlar; mevcut taslak varsa INSERT 23505 ile patlar ve `content: error?.message` ham Postgres "duplicate key value violates unique constraint..." string'ini Türkçe arayüzde asistan balonu olarak gösterir.

**Etki:** Eski taslağı olan kullanıcı revizyon başlatamaz, anlaşılmaz ham SQL mesajı görür; aktif satır da arşivlenmez.

**Öneri:** INSERT öncesi `getDraft(user.id, planType)` ile kontrol et; varsa onu sürdür (`chatSessionId` de set ederek) veya kullanıcıya sor. 23505'i yakalayıp mevcut taslağa yönlendir; ham `error.message`'ı asla balona basma.

---

### [LOW] Görev kartı her dokunuşta koşulsuz YENİ oturum açıyor — çoğalan yarım oturumlar
- `app/(tabs)/chat.tsx:144-145` (handleTaskPress koşulsuz `createSession`) vs `:58-67` (prefill aktif-oturum yeniden-kullanımı)
- `src/services/onboarding-tasks.service.ts`

**Sorun:** `handleTaskPress` her seferinde `createSession({ title, topicTags: [task.key] })` çağırır; `topic_tags`'inde `task.key` olan açık oturumu kontrol etmez. Aynı dosyadaki prefill/quick-log akışı ise aktif oturumu yeniden kullanır — görev kartları bu mantığı kullanmıyor (asimetri).

**Etki:** Kullanıcı görevi yarıda bırakıp tekrar dokununca ikinci boş oturum açılır; aynı `topic_tag`'li birden çok yarım oturum birikir, liste kirlenir.

**Öneri:** `handleTaskPress`'te önce `topic_tags`'inde `task.key` olan aktif oturum ara; varsa ona yönlendir, yoksa oluştur (görev↔oturum 1:1).

---

### [LOW] `reopenSession` import edilmiş ama hiç çağrılmıyor — kapalı oturuma mesaj `is_active`'i bayatlatıyor
- `app/chat/[sessionId].tsx:28` (import, kullanım yok)
- `src/services/chat.service.ts:529-544`, `app/(tabs)/chat.tsx:58/296`

**Sorun:** `chat.service.ts` `reopenSession` (`is_active=true`) export ediyor, `[sessionId].tsx` import ediyor ama hiç çağırmıyor (ölü import). Kullanıcı kapanmış oturumu açıp mesaj gönderince mesaj yazılır ama oturum kapalı kalır. `(tabs)/chat.tsx` 24 saat hareketsizlikte auto-close eder; kullanıcı devam etse bile "pasif" görünür.

**Etki:** Eski oturuma devam edenin oturumu liste başlığında ve aktif-nokta göstergesinde "pasif" kalır; prefill/quick-log yanlışlıkla soğuk yeni sohbet açabilir.

**Öneri:** `loadSessionMessages` sonrası oturum `is_active=false` ise `reopenSession(sessionId)` çağır. Niyet buysa import'u bağla, değilse kaldır.

---

### [LOW] `deleteSession` hataları yutuluyor — iyimser silme tutarsız kalabilir
- `src/services/chat.service.ts:546-549`, `app/(tabs)/chat.tsx:167-175`

**Sorun:** `deleteSession` iki ayrı delete (`chat_messages` sonra `chat_sessions`) yapar; hiçbir hata kontrolü/dönüş değeri yok. `chat.tsx` iyimser olarak listeden çıkarır, yalnız throw olursa Alert gösterir. Supabase `.delete()` RLS/ağ reddini error nesnesi olarak döndürür (throw etmez), kontrol edilmediği için yutulur.

**Etki:** Silme sessiz başarısız olursa oturum UI'dan kaybolur ama DB'de kalır; sonraki yenilemede geri gelir veya yarım silinmiş (mesajsız) oturum kalır.

**Öneri:** `deleteSession` her iki delete'in error'ünü kontrol edip hata varsa throw etsin (böylece `chat.tsx` catch'i Alert gösterir).

---

### [LOW] Foto/barkod gönderiminde, tartı geçersiz girişinde ve birkaç saat/aralık alanında inline doğrulama/sessiz return
- `app/log.tsx:210-213` (handleWeightSave sessiz return) vs `:263/269` (uyku Alert atıyor)
- `app/settings/menstrual.tsx:36/42/71` (Döngü Süresi 21-35 ipucu var ama aralık kontrolü yok)
- `app/settings/if-settings.tsx:34-49/132-133` (Özel pencere start>=end uyarısı yok)

**Sorun:** Ortak desen — sayısal/aralık girişlerinde geri bildirim eksikliği. Tartı: `if (!w || w<20 || w>300 || !user?.id) return;` ile sessizce çıkar, Kaydet butonu yalnız loading'de disabled; kullanıcı "abc"/5 girip basınca hiçbir şey olmaz (oysa `handleSleepSave` geçersiz saatte Alert atıyor — tutarsız). Döngü Süresi: `parseInt(cycleLength) || 28` kullanıldığı için "5"/"900" geçer (servis guard'ı yalnız `<=0`'ı yakalar), ipucu doğrulamayla desteklenmez. IF Özel pencere: `eatingStart==eatingEnd` (0 saatlik) gibi mantıksız pencere uyarısız kaydedilir.

**Etki:** Kullanıcı geçersiz girip butona basınca "donmuş" sanır; aralık-dışı döngü süresi faz/regl tahminlerini, 0-saatlik IF penceresi koçun öğün-zamanlama mantığını bozar.

**Öneri:** Geçersiz/aralık-dışı durumda `haptics.error()` + Alert/inline error göster (`edit-profile` `rangeError` kalıbı); tartıya "20–300 kg", döngüye "21–45 gün", IF'e "Başlangıç ile bitiş aynı olamaz" doğrulaması ekle.

---

### [LOW] Aksansız tekil dizeler (`log.tsx`, `coach-mode.service.ts`) ve karışık-aksanlı `debug-mode.tsx`
- `app/log.tsx:263` ("formati gecersiz" — çevre `:269/:283` doğru)
- `src/services/coach-mode.service.ts:153` ("gecerli ... secilmelidir")
- `app/settings/debug-mode.tsx:47/53/55/56/60/61/62/68/69/89` (karışık: `:48 'iç yapısı'` doğru ama çevresi bozuk)

**Sorun:** İki-ekran bulgusundan (HIGH) daha hafif ama aynı kök: dağınık aksansız dizeler. `log.tsx:263` aynı ekranda doğru ve bozuk mesaj yan yana; `debug-mode.tsx` settings'ten erişilebilen kullanıcı-yüzü ekranda "Gelistirici Modu / Kalori Araligi / Hayir / Tamamlandi / AI Ozeti / Bugunki Mesaj" gibi onlarca aksansız dize; `coach-mode.service.ts:153` UI'a yansıyabilecek throw mesajı.

**Etki:** Gözle görülür yazım hataları genel cila izlenimini zedeler; iç tutarsızlık (aynı dosyada doğru+bozuk) özensizlik hissini artırır.

**Öneri:** Tüm dizeleri doğru aksanla düzelt (Geliştirici Modu, Kalori Aralığı, Hayır, Tamamlandı, AI Özeti, Bugünkü Mesaj, geçerli, seçilmelidir, formatı geçersiz).

---

### [LOW] `i18n.ts` tam bir tr/en çeviri sistemi ama hiçbir yerde import edilmiyor — ~250 satır ölü kod
- `src/lib/i18n.ts:11`

**Sorun:** 200+ anahtarlı tam çift-dilli `t()`/`translations` sistemi var ama repo genelinde hiçbir dosya import etmiyor (`from '...i18n'`/`require` → 0 sonuç). Tüm metinler ekranlara gömülü. NOT: "settings/language çalışmıyor / İngilizce vaat ediliyor" iddiası çürütüldü — böyle bir ekran/seçenek yok; bu sadece bakımsız ölü kod.

**Etki:** Doğrudan kullanıcı etkisi yok; yalnız teknik borç (~250 satır kopuk sözlük).

**Öneri:** Tek dil (TR) kararı kesinse `i18n.ts`'i sil; çok dilli hedef varsa ekranlara gerçekten bağla.

---

### [LOW] `haptics.safe()` async reddi yakalamıyor — unhandled promise rejection riski
- `src/lib/haptics.ts:14-16`

**Sorun:** `safe()` `try { void fn(); } catch {}` ile sarıyor; `fn()` async expo-haptics çağrısı (senkron throw etmiyor), desteklenmeyen cihaz/web'de reddedilmiş Promise döndürüyor. `void fn()` reddi beklemediği için catch hiç çalışmaz; reddedilen promise unhandled rejection olarak kaçar. Tüm haptik metodları bu yolu kullanıyor.

**Etki:** Taptic motoru olmayan cihazlarda her haptik çağrısı unhandled rejection üretebilir; dev'de console kirliliği, prod'da crash-reporter gürültüsü. Fonksiyonel etki yok.

**Öneri:** `safe()`'i `fn().catch(() => {})` ile değiştir (veya `async/await` + try/catch).

---

## DB / Şema, Güvenlik & Bütünlük

**Skor: 2.5 / 5** — Veri sızıntısı yok ama iki gerçek gelir/güvenlik açığı (sınırsız trial self-grant, eksik FK), yaygın migration↔canlı drifti ve transaction'sız çok-adımlı yazımlar şema bütünlüğünü ciddi şekilde zedeliyor.

Pozitif tarafta: RLS sahip-satır izolasyonu sağlam (audit forgery düzeltmesi, free-premium RLS deliği kapalı, coach köprüsü veri sızdırmıyor). Asıl borç **bütünlük ve bakım katmanında**: migration'lar artık tek-doğruluk-kaynağı değil (14 migration kayıtsız, 3 tablo migration'sız, fonksiyon/trigger/kolon drift'leri), ve sıcak yazım yollarının çoğu transaction'sız delete-then-insert.

### Severity Özeti

| Severity | Adet | Özet |
|----------|------|------|
| Critical | 0 | — |
| High | 5 | Sınırsız trial premium baypası; 3 tablo migration'sız; chat_messages FK eksik; 2 N+1/yanlış sorgu (chat) |
| Medium | 10 | Enum/cron/trigger/migration drift'leri; transaction'sız projeksiyon/hedef yazımı; pgsodium inert; eksik index; tip kapsamı |
| Low | 12 | Çift index/politika, sayfalama yokluğu, tip kapsamı, geri-alınamaz silme, view RLS-bypass agrega |

---

### [HIGH] Sınırsız ücretsiz premium: trial INSERT politikası `trial_used` kontrolü yapmıyor (her 8 günde yenilenebilir self-grant)

- `supabase/migrations/046_fix_subscriptions_ins_premium_selfgrant.sql:20`
- `src/services/subscription.service.ts:60` (gate yalnız client'ta, satır 63)
- `supabase/migrations/026_subscriptions.sql:33`

**Sorun:** Canlı `subscriptions_ins` politikası trial satırına daraltıldı ama WITH CHECK'te `profiles.trial_used` kontrolü yok. Tek bariyer `idx_subscriptions_user_active` kısmi UNIQUE index'i; ancak `WHERE status = ANY('active','trial','grace_period')` olduğundan trial dolup `status='expired'` olunca index kapsamaz. `trial_used` gate'i SADECE client'ta.

```
-- canlı subscriptions_ins with_check:
((auth.uid() = user_id) AND (tier = 'trial') AND (status = 'active')
 AND (provider = 'manual') AND (expires_at IS NOT NULL)
 AND (expires_at <= (now() + '8 days'::interval)))   -- trial_used YOK
-- idx_subscriptions_user_active: UNIQUE(user_id) WHERE status IN('active','trial','grace_period') -- 'expired' kapsam dışı
```

**Etki:** Gelir kaybı / premium gate baypası. Authenticated kullanıcı PostgREST üzerinden client'ı baypas ederek deneme `expired` olduktan sonra her 8 günde yeni trial satırı INSERT edip premium'u süresiz yenileyebilir. `tg_sync_profile_premium` (SECURITY DEFINER) `profiles.premium=true` yapar. Tek-seferlik deneme garantisi yok.

**Öneri:** `startTrialIfEligible`'ı SECURITY DEFINER RPC'ye taşı (RPC içinde `trial_used` atomik kontrol+set), client trial INSERT politikasını kaldır. Alternatif: BEFORE INSERT trigger — `tier='trial' AND EXISTS(profiles WHERE id=NEW.user_id AND trial_used)` ise RAISE EXCEPTION. Partial index'e 'expired' eklemek invariantı kurmaz.

---

### [HIGH] `households`, `household_members`, `coach_consents` tabloları hiçbir migration'da CREATE edilmiyor — canlıda elle açılmış

- `supabase/migrations/040_fix_household_rls_recursion.sql:20`
- `supabase/migrations/043_plan_goal_household_hardening.sql:47`
- `supabase/migrations/050_security_hardening_round2.sql:21`
- `src/services/household.service.ts:66`

**Sorun:** Canlı şemada üç tablo da mevcut ama 001..050'nin HİÇBİRİ bunlar için `CREATE TABLE` içermiyor (repo geneli arama boş). Migration 040/043/050 bu tabloların ZATEN VAR olduğunu varsayıp sadece POLICY/RPC/INDEX uyguluyor. Tablolar canlıya out-of-band eklenmiş ve `household.service.ts` ile aktif kullanılıyor.

**Etki:** Migration'lardan sıfırdan kurulan herhangi bir ortam (yeni geliştirici, CI, staging, felaket-kurtarma) 040'taki `create policy ... on public.household_members` satırında `relation "household_members" does not exist` ile patlar; migration zinciri 040'tan itibaren kırılır. Aile Planı ve Koç Paylaşımı yeniden üretilemez. Migration'lar tek-doğruluk-kaynağı değil.

**Öneri:** Üç tablo için `CREATE TABLE IF NOT EXISTS` + index + ENABLE RLS içeren idempotent baseline migration ekle (canlı DDL'den birebir çıkarılarak), 040/043/050'den ÖNCE çalışacak slot'a. `households.owner_id NOT NULL`, `invite_code`, `household_members(household_id,user_id) UNIQUE` dahil.

---

### [HIGH] `chat_messages.session_id` NOT NULL ama `chat_sessions`'a FK yok — yetim mesaj riski

- `supabase/migrations/003_ai_memory_and_chat.sql`
- `supabase/migrations/035_chat_sessions_updated_at_and_single_active.sql`

**Sorun:** `chat_messages`'ta `chat_sessions`'a giden hiçbir FK yok (canlı pg_constraint: yalnız `chat_messages_user_id_fkey → profiles`). `session_id` NOT NULL ve iki AFTER INSERT trigger bu sütunla `chat_sessions`'ı UPDATE etmesine rağmen geçersiz `session_id` INSERT'ini engelleyen kısıt yok. Bir oturum tek başına silinirse mesajlar yetim kalır (trigger var olmayan id'de no-op UPDATE eder).

```
-- canlı: contype='f' on chat_messages => yalnız chat_messages_user_id_fkey → profiles
-- orphan taraması (NOT EXISTS) => 0 (henüz)
```

**Etki:** Yetim `session_id`'li satırlar session-bazlı okumalarda (app/chat/[sessionId]) görünmez, export'ta tutarsızlık yaratır. Şu an orphan=0, latent bütünlük açığı.

**Öneri:** Önce orphan tarayıp temizle, sonra `FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE` ekle — hem geçersiz INSERT'i engeller hem oturum silinince mesajları temizler.

---

### [HIGH] `loadChatHistory` yanlış yönde sıralıyor + session-scope yok: en eski 50 mesaj çekiliyor, en yeniler değil

- `src/services/chat.service.ts:278`

**Sorun:** Sorgu `user_id` ile filtreleniyor (session_id YOK) ve `ascending: true` + `limit(50)` ile kullanıcının TÜM mesajları arasından en ESKİ 50'yi döndürüyor.

```ts
.eq('user_id', session.user.id)
.order('created_at', { ascending: true })
.limit(50);   // session_id filtresi yok; en eski 50
```

**Etki:** Kullanıcı 50 mesajı aştığında sohbet ekranı ilk 50 mesajda takılı kalır; en son AI/kullanıcı konuşmaları HİÇ görünmez — fonksiyonel bozulma.

**Öneri:** `.order('created_at', { ascending: false }).limit(50)` yapıp client'ta ters çevir (veya keyset). DESC tarama mevcut `idx_chat_messages_user(user_id, created_at)` ile karşılanır. Ayrıca `session_id` ile filtrele.

---

### [HIGH] `loadSessions`: oturum listesinde N+1 — her oturum için ayrı son-mesaj sorgusu

- `src/services/chat.service.ts:399`

**Sorun:** En fazla 20 oturum çekildikten sonra `for (const s of sessions)` döngüsünde her oturum için ayrı `chat_messages` sorgusu (son mesaj). Seri await = 1+20 = 21 ardışık round-trip.

```ts
for (const s of sessions) {
  const { data: msgs } = await supabase
    .from('chat_messages').select('content')
    .eq('session_id', s.id).order('created_at',{ascending:false}).limit(1);
}
```

**Etki:** Sohbet sekmesi açılışında 21 ardışık ağ gidiş-dönüşü; mobilde saniyeler sürebilir, oturum sayısıyla doğrusal kötüleşir.

**Öneri:** Tüm `session_id`'ler için `.in('session_id', ids)` ile son mesajları tek sorguda çekip client'ta grupla; veya `chat_sessions.updated_at/message_count` alanlarını kullanarak ek sorguyu kaldır.

---

### [MEDIUM] Plan/hedef yazımları transaction'sız (delete/archive/deactivate-then-insert) — ara hatada veri kaybı

- `supabase/functions/ai-chat/index.ts:1351` (daily_plans projeksiyonu)
- `supabase/functions/ai-chat/index.ts:3751` (goal_suggestion deactivate→insert)
- `supabase/functions/ai-chat/index.ts:1231` ve `:1254` (weekly_plans archive→promote)

**Sorun:** Üç sıcak yazım yolu da tek-aktif invariant'ı korumak için "önce eskiyi pasifle/sil, SONRA yeniyi yaz" desenini transaction'sız iki ifadeyle uyguluyor. İkinci adım (insert/promote) transient/timeout/CHECK hatasıyla patlarsa kullanıcı boş durumda kalır:
- daily_plans: o haftanın tüm satırları DELETE edilmiş ama yeni yazılmamış → **dashboard boşalır** ("planım kayboldu").
- goals: eski hedef `is_active=false` ama yeni yok → **hiç aktif hedef kalmaz**, `validateGoalReadiness` (`index.ts:2406`) goal_type bulamaz, plan üretimi durur.
- weekly_plans: eski `archived`, yeni hâlâ `draft` → aktif plan yok.

```ts
// 1351: .delete()...gte('date',lowerBound).lte('date',weekEnd)  sonra ayrı .insert(writeRows)
// 3751: .update({is_active:false})  sonra ayrı .insert({...})
// insErr/gsErr/promoteErr yalnız log/feedback — silineni geri yazmıyor
```

**Etki:** Düşük olasılıklı ama gerçek veri kaybı; özellikle daily_plans senaryosu "yeni plan onayladım, panom boşaldı" deneyimi yaratır.

**Öneri:** Her birini tek SECURITY DEFINER plpgsql RPC'de (tek transaction) yap. daily_plans için DELETE yerine `upsert` + `onConflict(user_id,date,version)` kullan (`daily_plans_user_id_date_version_key` canlıda mevcut, version=1 hard-code → temiz çalışır).

---

### [MEDIUM] Migration 037–050 canlıya uygulanmış ama `schema_migrations`'a kayıtlı değil (takip edilmeyen drift)

- `supabase/migrations/037_fix_ai_summary_merge_supplement_notes.sql`
- `supabase/migrations/050_security_hardening_round2.sql`

**Sorun:** Canlı `supabase_migrations.schema_migrations` toplam 36 satır, max `version='036'`. Repo'da 050'ye kadar dosya var → 037-050 (14 dosya) kayıtsız. İçerikleri canlıda mevcut (mig 049 `weight_history_user_date_uniq` index'i, mig 050 `hm_select_own` policy'leri doğrulandı) — yani DDL'ler Management API/SQL editörü ile uygulanmış, takip tablosu güncellenmemiş.

**Etki:** `supabase db push`/CI bu 14 migration'ı yeniden uygulamaya çalışabilir; idempotent olmayan ifadeler (`CREATE POLICY` without IF NOT EXISTS) deploy'u kırar. Yeni ortam/restore'da hangi şemanın gerçek olduğu belirsiz, rollback zorlaşır.

**Öneri:** `schema_migrations`'ı gerçek durumla senkronla: 037-050'yi idempotent yapıp kayıt satırlarını ekle (`supabase migration repair`). Sonrasında DDL yalnız tracked migration üzerinden; elle DDL yasak.

---

### [MEDIUM] PlanStatus enum drift: `database.ts`, canlı `daily_plans.status`'taki `active`/`mvd_suspended` değerlerini içermiyor

- `src/types/database.ts:34`
- `supabase/functions/ai-chat/index.ts:3372`
- `supabase/functions/ai-proactive/index.ts:649`
- `supabase/functions/shared/service-contexts.ts:379`

**Sorun:** `database.ts:34` `PlanStatus = 'draft'|'approved'|'modified'|'rejected'` ama canlı CHECK 6 değerli (`+ 'active','mvd_suspended'`). İki ekstra değer runtime'da gerçekten yazılıp okunuyor: `ai-chat:3372` `.update({status:'mvd_suspended'})`, `service-contexts:379` `plan?.status === 'mvd_suspended'`, `ai-proactive:649` `.eq('status','mvd_suspended')`.

**Etki:** `DailyPlan.status` üzerinde exhaustive eşleştirme yapan TS kodu bu vakaları sessizce atlar; MVD-askıya-alma akışı tip sisteminde temsil edilemez, `as` cast'e zorlanır.

**Öneri:** `database.ts:34`'ü CHECK ile hizala (6 değer). Netlik için `daily_plans`'a özel `DailyPlanStatus` adlandırması düşün (plan.service.ts'teki ayrı `PlanStatus` weekly_plans için — isim çakışması var).

---

### [MEDIUM] Migration 014'teki 3 proactive cron canlıda yok — tek `kochko-proactive-hourly` ile değiştirilmiş (cron drift)

- `supabase/migrations/014_cron_jobs.sql:41`, `:56`, `:71`

**Sorun:** 014 morning/afternoon/evening (3 ayrı schedule) tanımlar ve `current_setting('app.settings.supabase_url')` GUC'ü kullanır. Canlı cron.job'da bu 3 isim YOK; yerine tek `kochko-proactive-hourly` (`'7 * * * *'`) ve sabit URL var. Yeniden-yapılandırma hiçbir migration'da yok. `ai-proactive/index.ts` (satır 53/768/1342) hourly pencere bekliyor.

**Etki:** Migration'lardan kurulan ortam 3 eski job'ı schedule eder (GUC tanımsızsa net.http_post başarısız) ama canlı hourly davranışını üretmez; fleet bildirimleri yanlış zamanlanır.

**Öneri:** Canlıyı yansıtan idempotent migration ekle: morning/afternoon/evening'i `cron.unschedule` ile kaldır, hourly'yi schedule et. URL/auth modelini tek tutarlı kaynağa bağla.

---

### [MEDIUM] `chat_messages`'ta iki redundant trigger her mesajı iki kez UPDATE ediyor + `update_session_timestamp` migration'larda yok (drift)

- `supabase/migrations/035_chat_sessions_updated_at_and_single_active.sql`
- `supabase/migrations/003_ai_memory_and_chat.sql`

**Sorun:** Canlıda iki AFTER INSERT trigger: `trg_chat_messages_bump_session → bump_chat_session_updated_at` (sadece `updated_at`, mig 035) ve `trg_update_session_on_message → update_session_timestamp` (`updated_at` + `message_count+1`). İkincinin fonksiyonu/trigger'ı hiçbir migration'da yok (grep boş).

**Etki:** Her mesajda gereksiz ikinci UPDATE (kilit + WAL maliyeti). Daha kritik: sıfırdan migration kurulumu `message_count`'u hiç artırmayan bir kuruluma yol açar — canlı ile dev/yeni ortam sessizce farklılaşır.

**Öneri:** `update_session_timestamp` + trigger'ı migration'a kaydet, iki trigger'ı tek fonksiyonda birleştir (`updated_at` + `message_count` tek UPDATE'te).

---

### [MEDIUM] `ai_summary.learned_meal_times` kolonu hiçbir migration'da eklenmiyor ama `ai_summary_merge` (015'ten beri) referans veriyor

- `supabase/migrations/015_ai_summary_atomic_merge.sql:51`
- `supabase/migrations/020_snacking_hours.sql:40`
- `supabase/migrations/037_fix_ai_summary_merge_supplement_notes.sql:41`
- `supabase/migrations/003_ai_memory_and_chat.sql:39`

**Sorun:** `ai_summary_merge`, 015:51'den beri `learned_meal_times = COALESCE(...)` içeriyor. Canlıda kolon (jsonb) var ama 003 CREATE TABLE bloğu bu kolonu içermiyor ve `ADD COLUMN ... learned_meal_times` araması boş → out-of-band eklenmiş.

**Etki:** Sıfırdan kurulumda 015'teki `CREATE FUNCTION ai_summary_merge` `column "learned_meal_times" does not exist` ile patlar; Layer-2 hafıza yazma yolu kurulamaz.

**Öneri:** 015'ten ÖNCE `ALTER TABLE ai_summary ADD COLUMN IF NOT EXISTS learned_meal_times JSONB DEFAULT '[]'` ekle (veya 003'e dahil et). `onboarding_tasks_completed`/`extraction_checkpoint` için de aynı kontrolü yap.

---

### [MEDIUM] Migration 025 pgsodium at-rest şifrelemesi fiilen inert — sağlık verisi düz metin, phantom view + asılı SECURITY LABEL

- `supabase/migrations/025_at_rest_encryption.sql:47`, `:32`

**Sorun:** 025 `lab_values.test_name/value_text/note`'u şifrelemeye çalışıyor ama bu kolonlar şemada yok (canlı: `parameter_name/value/unit`) → `IF EXISTS` guard'ı her zaman FALSE, blok ölü. `health_events` tarafında yazma-zamanı şifreleme trigger'ı yok (`pg_event_trigger`'da yalnız `pgsodium_trg_mask_update`), tek satırda `description_nonce IS NULL` (düz metin). `decrypted_health_events` view + SECURITY LABEL'lar asılı duruyor.

**Etki:** KVKK/GDPR at-rest sağlık verisi şifrelemesi iddia ediliyor ama hiç uygulanmıyor — `health_events.description` serbest medikal metin düz saklanıyor. "Güvenlik var" algısı + sıfır koruma.

**Öneri:** İki seçenek — (1) Şifreleme gerçekten isteniyorsa app yazımını `decrypted_*` view'a yönlendir, event trigger'ı kalıcı kur, `lab_values` kolon adlarını gerçek şemaya düzelt; (2) İstenmiyorsa temizleyici migration: SECURITY LABEL'ları kaldır, `decrypted_health_events`'i DROP et, ölü nonce kolonlarını düşür.

---

### [MEDIUM] `meal_logs` `logged_at DESC` sıralaması için index yok — büyümeyle seq scan

- `src/services/realtime-sync.service.ts:241`
- `supabase/functions/ai-proactive/index.ts:844`, `:389`

**Sorun:** `meal_logs`'taki tek non-pk index `(user_id, logged_for_date)`. Sıcak sorgular `logged_at` (timestamptz) DESC sıralıyor; `logged_for_date` (date) ≠ `logged_at`, mevcut index bu sıralamaya hizmet etmez.

**Etki:** Tablo büyüdükçe son-öğün/son-50-öğün sorguları tüm kullanıcı satırlarını okuyup sıralar; ai-proactive cron'da kullanıcı başına çalıştığı için fleet ölçeğinde belirgin yük.

**Öneri:** `CREATE INDEX idx_meal_logs_user_logged_at ON meal_logs(user_id, logged_at DESC);` ai-proactive'in `is_deleted=false` filtresi için kısmi index ideal.

---

### [MEDIUM] `getCoachClients`: danışan başına 3 ayrı sorgu (N+1)

- `src/services/coach-mode.service.ts:89`

**Sorun:** Consents çekildikten sonra her danışan için 3 ardışık await (profiles 93, daily_reports 104, goals 112). N danışan = 1+3N round-trip.

**Etki:** Koç danışan listesi danışan sayısıyla doğrusal yavaşlar (10 danışan = 31 sorgu); özellik ölçeklenince ekran donar.

**Öneri:** profiles/goals/daily_reports'u `clientIds` üzerinden `.in('user_id', ...)` ile toplu çek, JS'te Map ile birleştir; daily_reports son satırı için DISTINCT ON RPC ideal. (Not: bu özellik şu an RLS katmanında zaten boş dönüyor — bkz. aşağıdaki low bulgu.)

---

### [MEDIUM] Tam çift (duplicate) index'ler — yazma maliyeti ve disk israfı (5 tablo)

- `supabase/migrations/049_weight_history_unique_per_day.sql`
- `supabase/migrations/002_daily_logs.sql`
- `supabase/migrations/027_audit_logs.sql`
- `supabase/migrations/003_ai_memory_and_chat.sql`
- `supabase/migrations/004_plans_and_reports.sql`

**Sorun:** Canlı pg_indexes/pg_stat ile birebir tekrar eden çiftler: weight_history (`idx_weight_history_user` ↔ `weight_history_user_date_uniq`), daily_metrics (`idx_daily_metrics_user_date` ↔ `daily_metrics_user_id_date_key`), audit_logs (`idx_audit_logs_user` ↔ `idx_audit_logs_user_created`, ilk scan=0), coaching_messages (`idx_coaching_user` ↔ `idx_coaching_messages_user`, ilk scan=0), saved_recipes (`idx_recipes_user` ↔ `idx_saved_recipes_user`, ilk scan=0).

**Etki:** Her INSERT/UPDATE'te gereksiz ikinci index bakımı + disk; scan=0 olanlar hiç kullanılmıyor.

**Öneri:** Her çiftten non-unique tekrarı DROP et: `idx_weight_history_user`, `idx_daily_metrics_user_date`, `idx_audit_logs_user`, `idx_coaching_user`, `idx_recipes_user`. UNIQUE/constraint index'lerine dokunma.

---

### [MEDIUM] Tip kapsamı drift'i: canlı kolonlar `database.ts` interface'lerinde yok (`Profile` 27, `AISummary` 4)

- `src/types/database.ts:3` (başlık "001-005" yanıltıcı; şema 050'de)
- `src/types/database.ts:46` (Profile — 27 kolon eksik)
- `src/types/database.ts:322` + `src/services/privacy.service.ts:89`, `:113` (AISummary — 4 kolon eksik)

**Sorun:** `Profile` interface 27 canlı kolonu (trial_used, push_token, notification_prefs, maintenance_*, plans_used_free, daily_msg_count vb.) tanımlamıyor; satır 137'deki `[key:string]:unknown` derleme hatasını maskeliyor. `AISummary` (322-352), aktif okunan `learned_meal_times`/`snacking_hours`/`extraction_checkpoint`/`onboarding_tasks_completed`'i içermiyor → `privacy.service.ts:113` `as Record<...>` cast'e zorlanıyor.

**Etki:** Bu kolonlara erişen tüm kod `unknown` alıp cast'e zorlanır (TDEE/maintenance/Layer-2 hafıza); yanlış kolon adı derlemede yakalanmaz, regresyon riski artar.

**Öneri:** Eksik kolonları doğru tiplerle ekle, başlığı `001-050` yap. İdeali `supabase gen types`'ı CI'a bağlamak.

---

### [LOW] Koç (B2B) veri-paylaşımı RLS katmanında ölü: rızalı danışan verisine erişim yok, dashboard daima boş

- `src/services/coach-mode.service.ts:76`, `:93`, `:142`

**Sorun:** `getCoachClients()` sıradan (RLS'e tabi) client ile profiles/daily_reports/goals'u clientId üzerinden sorguluyor; ama bu tabloların SELECT politikaları yalnız `auth.uid()=id/user_id`'ye izin veriyor. coach_id köprüsü veya SECURITY DEFINER fonksiyon yok → `profiles.single()` null → satır 100 `continue` her danışanı atlar → dashboard boş. `shareDataWithCoach()` ayrıca keyfi `coach_id` kabul ediyor (doğrulama yok).

**Etki:** B2B koç özelliği sessizce çalışmıyor. Pozitif: veri sızıntısı yok. Risk: ileride RLS gevşetilirse doğrulanmamış `coach_id` istismar yüzeyi.

**Öneri:** Koç erişimini SECURITY DEFINER RPC ile sağla (`EXISTS(coach_consents WHERE coach_id=auth.uid() AND user_id=hedef AND is_active AND <tip> = ANY(shared_data_types))`). `shareDataWithCoach`'ta `coach_id`'nin geçerli kullanıcı olduğunu doğrula.

---

### [LOW] `execute_pending_account_deletions` geri-alınamaz hard-delete — audit izi / üst-sınır / iptal bayrağı yok

- `supabase/migrations/023_account_deletion_cron.sql:17`
- `supabase/migrations/050_security_hardening_round2.sql:42`

**Sorun:** `deletion_requested_at < now()-30d` tüm satırlar için `DELETE FROM profiles` (CASCADE) + `DELETE FROM auth.users` — geri-alınamaz. Canlı fonksiyon 023 ile birebir aynı. 050:42 yalnız EXECUTE grant'ını revoke etti. Fonksiyonda: silmeden önce audit INSERT yok, döngüde üst-sınır/dry-run yok, ayrı iptal bayrağı yok (iptal yalnız `deletion_requested_at` NULL'lemeye bağlı).

**Etki:** `deletion_requested_at` yanlışlıkla geçmişe set edilirse iz bırakmadan kalıcı imha. 30-gün grace iptali tek mekanizmaya bağlı.

**Öneri:** Silmeden önce `audit_logs` INSERT (`event_type='data_delete'`) ekle, döngüye güvenlik üst-sınırı koy, iptal yolunu test ile güvence altına al.

---

### [LOW] Cron job komutlarında service_role JWT ve x-cron-secret düz metin gömülü

- `supabase/migrations/014_cron_jobs.sql`
- `supabase/migrations/022_scheduled_cleanups_unify.sql`

**Sorun:** 4 cron job'ın `net.http_post` komutu tam service_role JWT'sini ve x-cron-secret'ı düz metin taşıyor. cron.job yalnız postgres'e SELECT açık (client'tan okunamaz) ama sırlar migration dosyalarında ve DB'de sabit/uzun ömürlü.

**Etki:** DB/SQL/yedek/log/operatör erişimine sahip aktör service_role'ü tek yerden ele geçirir → tüm RLS baypas. Anahtar gömülü olduğu için rotasyonu zor.

**Öneri:** Sırları Supabase Vault / `current_setting` ile çöz; JWT'yi command'e gömme. Mümkünse net.http_post yerine DB-içi fonksiyon çağrısı.

---

### [LOW] `household_members` SELECT: dar `hm_select_own` ile geniş `Members can view members` birlikte aktif (OR'lanıyor)

- `supabase/migrations/050_security_hardening_round2.sql:23`
- `supabase/migrations/040_fix_household_rls_recursion.sql:28`

**Sorun:** 050 dar per-komut politika ekledi (`hm_select_own: user_id=auth.uid()`) ama 040'taki geniş `Members can view members` (`household_id IN (SELECT user_household_ids())`) hâlâ canlıda. İki PERMISSIVE SELECT OR'lanır → etkin yüzey geniş olan kadar. 050'nin daraltma niyeti ile uygulama arasında tutarsızlık.

**Etki:** Doğrudan sızıntı değil (yalnız üye olunan household içi). İleride hassas kolon eklenirse aynı household üyelerine otomatik açılır.

**Öneri:** İki politikadan hangisinin istendiğini netleştir; aile içi görünürlük amaçsa `hm_select_own`'ı, yalnız kendi satırı amaçsa `Members can view members`'ı DROP et.

---

### [LOW] `barcode_unfound_counts` view'ı postgres (bypassrls) sahipli + security_invoker kapalı → RLS-bypass'lı cross-user agrega

- `supabase/migrations/016_barcode_community.sql:62`

**Sorun:** View `security_invoker` olmadan tanımlı (canlı reloptions=null), sahibi `postgres` (`rolbypassrls=true`) → alttaki `barcode_corrections` RLS'ini gerçekten bypass eder, tüm kullanıcıların `_UNFOUND_` barkod kayıtlarını GROUP BY ile agregeler. GROUP BY agregesi olduğundan DML imkânsız (yalnız SELECT). Şu an 0 satır.

**Etki:** Düşük hassasiyetli cross-user sızıntı: bir kullanıcı diğerlerinin hangi barkodları aradığını (miss sayıları) görebilir. Hassas veri değil, etki minimal.

**Öneri:** Community-geneli isteniyorsa bırak; aksi halde `ALTER VIEW ... SET (security_invoker = on);` + fazla ACL'i temizle (`REVOKE ALL FROM anon, authenticated; GRANT SELECT TO authenticated;`).

---

### [LOW] `idx_daily_plans_user_date` kullanılmıyor — daha geniş versioning index'i tarafından gölgeleniyor

- `supabase/migrations/004_plans_and_reports.sql:41`
- `supabase/migrations/006_feature_extensions.sql:37`

**Sorun:** `(user_id,date)` prefix'i `idx_daily_plans_version(user_id,date,version DESC)` ve UNIQUE index tarafından karşılanıyor. pg_stat: `idx_daily_plans_user_date` scan=0, version index scan=1684.

**Etki:** Hiç kullanılmayan üçüncü index; yazma maliyeti + disk.

**Öneri:** `DROP INDEX idx_daily_plans_user_date;`

---

### [LOW] `coach_consents` `coach_id+is_active` filtresi için kısmi/bileşik index yok

- `src/services/coach-mode.service.ts:80`
- `supabase/migrations/003_ai_memory_and_chat.sql`

**Sorun:** `getCoachClients()` `.eq('coach_id').eq('is_active', true)` ile sorguluyor; canlı index'lerin hiçbirinde `is_active` yok → planner coach_id index'inden gelen satırları filtreliyor.

**Etki:** Bir koçun çok consent'i (iptal/geçmiş dahil) olduğunda gereksiz okuma. Özellik az kullanıldığı için düşük.

**Öneri:** `CREATE INDEX idx_coach_consents_coach_active ON coach_consents(coach_id) WHERE is_active = true;`

---

### [LOW] Sınırsız liste sorguları — sayfalama/limit yok (recipes, venues, health_events, templates, supplements + KVKK export)

- `src/services/recipes.service.ts:45`
- `src/services/venues.service.ts:16`
- `src/services/health.service.ts:18`
- `src/services/templates.service.ts:21`
- `src/services/supplements.service.ts:68`
- `src/services/export.service.ts:29` (30+ tablo `.select('*')`, nested `meal_log_items(*)`/`strength_sets(*)`)

**Sorun:** Liste sorguları `.select('*')` ile tüm kullanıcı satırlarını limit/range olmadan çekiyor, çoğu index'siz kolona göre sıralıyor (created_at/visit_count/event_date/use_count). KVKK export'u tek istekte 30+ tabloyu limitsiz çekiyor.

**Etki:** Kullanıcı çok kayıt biriktirince tüm satırlar çekilir (ağ + bellek) + in-memory sort; export'ta ağır geçmişte mobilde OOM riski.

**Öneri:** Liste ekranlarına `.limit()/.range()` ekle; sık sıralanan kolonlara kullanıcı-kapsamlı index (`saved_recipes(user_id, use_count DESC)` vb.). Export'ta büyüyebilen tabloları batch'le.

---

### [LOW] `database.ts` tip kapsamı: küçük eksik kolonlar (ChatSession/DailyMetrics/SavedRecipe)

- `src/types/database.ts:311` (ChatSession.updated_at yok)
- `src/types/database.ts:252` (DailyMetrics.created_at yok)
- `src/types/database.ts:492` + `src/services/recipes.service.ts:70`, `:155` (SavedRecipe.is_favorite/use_count yok)

**Sorun:** Canlı kolonlar (`chat_sessions.updated_at`, `daily_metrics.created_at`, `saved_recipes.is_favorite`/`use_count`) interface'lerde yok. `recipes.service.ts` `is_favorite`/`use_count`'u aktif kullanıyor (satır 70/155) ve kendi yerel mükerrer tipini tanımlamış (satır 19-20).

**Etki:** Bu alanları okuyan client kodu tipli göremez; mükerrer tip tanımları bakım riski.

**Öneri:** İlgili kolonları interface'lere ekle; `recipes.service.ts`'teki yerel mükerrer tipi merkezi tiple birleştir.

---

### [LOW] weekly_plans archive-then-promote atomik değil — promote başarısız olursa aktif plan kalmaz

- `supabase/functions/ai-chat/index.ts:1231`, `:1254`

**Sorun:** (Yukarıdaki MEDIUM transaction bulgusunun üçüncü ayağı; severity ayrı tutuldu.) `uniq_active_plan_per_type` nedeniyle önce aktif plan `archived`, sonra draft `active` yapılıyor; iki ifade transaction'sız. promoteErr durumunda archive geri alınmıyor.

**Etki:** Transient hatada o plan_type için aktif plan kalmaz. `planPersistError` doğru set edildiğinden kullanıcıya yanlış "oldu" denmiyor (iyi), ama DB tutarsız kalır ve sonraki projeksiyon çalışmaz.

**Öneri:** Archive+promote+projection'ı tek SECURITY DEFINER RPC'de çalıştır; promote patlarsa archive rollback olsun.

---

### [LOW] `ai_feedback.context_type` ve `profiles.periodic_state` için DB CHECK yok — enum yalnız TS'te enforce

- `src/types/database.ts:40`, `:41`, `:98`, `:510`

**Sorun:** ContextType ve PeriodicState enum'ları TS'te tanımlı ama canlı DB'de ilgili CHECK constraint yok (yalnız `ai_feedback_feedback_check` var).

**Etki:** Edge/SQL ile geçersiz değer yazılırsa DB kabul eder; TS reader bunu enum sanıp eşleştirmede sessizce kaçırır. Savunma derinliği eksik (tek yazıcı uygulama olduğundan düşük).

**Öneri:** İki kolona enum-değerli CHECK ekleyen migration, veya edge yazarken output-validator ile değer kümesini doğrula.

---

### [LOW] `household_members`'ta iki örtüşen UNIQUE index — `user_id`-tek unique, composite'i gereksiz kılıyor

- `supabase/migrations/043_plan_goal_household_hardening.sql:105`

**Sorun:** 043 `uniq_household_member_per_user(user_id)` UNIQUE'i ekledi; canlıda ayrıca `household_members_household_id_user_id_key(household_id, user_id)` UNIQUE ve `idx_household_members_user(user_id)` non-unique var. `user_id`-tek unique zaten composite'i kapsadığı için ikisi de gereksiz.

**Etki:** İşlevsel risk yok ama gereksiz çift unique + örtüşen non-unique; her INSERT'te fazladan index bakımı.

**Öneri:** `household_members_household_id_user_id_key` ve `idx_household_members_user`'ı düşürmeyi değerlendir; index setini tek migration'da belgele.

---

### [NIT] `audit_logs` üzerinde yinelenen (redundant) SELECT politikaları

- `supabase/migrations/027_audit_logs.sql:27`
- `supabase/migrations/028_audit_logs_columns.sql`

**Sorun:** Aynı koşullu iki SELECT politikası (`audit_logs_select_own` ve `Users can view own audit logs`, her ikisi `auth.uid()=user_id`) bir arada. INSERT ayrımı doğru (038 forgery düzeltmesi sağlam).

**Etki:** Güvenlik açığı değil; çift politika kafa karışıklığı + birini değiştirip diğerini unutma riski.

**Öneri:** Yinelenenlerden birini DROP ederek tek kanonik politika bırak.

---

### [NIT] FK kolonları kapsayıcı index'ten yoksun (households.owner_id, scheduled_cleanups.user_id, meal_logs.template_id, weekly_plans.superseded_by)

- `supabase/migrations/016_barcode_community.sql`

**Sorun:** 4 FK constraint mevcut ama lider kolonu bu FK kolonu olan index yok. owner_id/user_id RLS qual'larında filtre olarak kullanılıyor.

**Etki:** İlgili tablolar boş/tiny (households=0, scheduled_cleanups=0, meal_logs=16, weekly_plans=13) → mevcut pratik etki sıfır; veri büyüdükçe RLS qual'larında ve ON DELETE CASCADE'de seq-scan.

**Öneri:** İlgili FK kolonlarına index ekle (`CREATE INDEX ON households(owner_id);` vb.) — ileriye dönük, aciliyet yok.

---

### [NIT] `monthly_reports`'ta mükerrer/ölü kolonlar — yazıcı yalnız kanonik adları dolduruyor

- `supabase/functions/ai-report/index.ts:482`

**Sorun:** Canlı şema hem `behavioral_patterns` hem `behavior_patterns`, ayrıca `weight_change_kg` yanında `weight_change/weight_start/weight_end/total_days_logged/ai_monthly_note` içeriyor (iki migration neslinin kalıntısı). ai-report upsert (482-498) yalnız kanonik adları yazıyor → eski adlar HER ZAMAN NULL.

**Etki:** Çalışma hatası yok ama kafa karıştırıcı: `behavior_patterns` okuyan biri boş veri alır; tablo sişiyor.

**Öneri:** Ölü kolonları ayrı migration ile DROP et (veri kaybı yok, hep NULL).

---

### [NIT] Migration 006 `daily_metrics`'e integer `muscle_soreness`/`recovery_score` eklemeye çalışıyor ama 002 onları text/smallint tanımlamış — `ADD COLUMN IF NOT EXISTS` sessizce no-op

- `supabase/migrations/006_feature_extensions.sql:19`
- `supabase/migrations/002_daily_logs.sql:89`

**Sorun:** 002 `recovery_score SMALLINT` + `muscle_soreness TEXT` tanımlar; 006:19-21 aynı adları `integer` olarak `ADD COLUMN IF NOT EXISTS` ediyor. Kolonlar zaten var olduğundan no-op; canlıda text/smallint kalmış, 006'nın integer niyeti hiç uygulanmadı.

**Etki:** Çok düşük; çalışan davranış 002'ye uygun. 006 okuyan biri integer sanır — yanıltıcı ölü satır + `ADD COLUMN IF NOT EXISTS`'in tip değiştirmediği gizli tuzak.

**Öneri:** 006'daki integer satırlarını sil veya gerçek tipin 002 olduğunu yorumla; gerçekten tip değişikliği gerekiyorsa `ALTER COLUMN TYPE` kullan.

---

## AI Mimarisi / Koç, Bellek, Guardrail & Plan

**Boyut Skoru: 2.5 / 5**

**Hüküm:** Katmanlı bellek + retrieval-planner + guardrail mimarisi tasarım olarak olgun, ancak (1) chat-onaylı diyet planını sessizce ezen kritik bir veri-bozma yolu, (2) alerjen ve intihar tespitinde gerçek dünya ifadelerini kaçıran güvenlik-ağı boşlukları, ve (3) yaygın "mod-yönlendirme tutarsızlığı + yazılıp okunmayan / yarış-durumuna açık bellek" hataları, sağlam temel üzerinde üretim güvenilirliğini ve kullanıcı güvenliğini somut biçimde aşındırıyor.

### Severity Özeti

| Severity | Adet | Ana temalar |
|---|---|---|
| Critical | 1 | Legacy ai-plan'in chat diyet planını ezmesi |
| High | 11 | Mod-yönlendirme zinciri, alerjen/kriz güvenliği, bellek yarış-durumu, cron auth/zamanlama, rate-limit istismarı, gün-sınırı |
| Medium | 13 | JSON güvenilirliği, bellek atomikliği/ölü yollar, rapor doğruluğu, plan aktivasyon yarışı, timeout, hata sızıntısı |
| Low | 10 | Analitik etiketleme, prompt-injection boşlukları, dedup, validasyon, latent versiyonlama |

---

### [CRITICAL] Legacy ai-plan haftalık menü yolu chat-onaylı aktif diyet planını uyumsuz şekille EZİYOR

- `supabase/functions/ai-plan/index.ts:813-819, 854-863`
- `supabase/functions/ai-chat/task-modes.ts:326-362`
- `supabase/functions/shared/plan-projection.ts:181, 198, 213`

**Sorun:** Chat `plan_diet` yolu `weekly_plans`'a `{ targets, days:[{day_index, meals:[{total_kcal, items}]}], version }` şeklinde tek bir aktif diyet satırı yazar. Legacy `generateWeeklyPlan` AYNI satırı (`plan_type='diet' AND status='active'`) bulup `plan_data = weeklyPlan.days` ile UPDATE eder — bu ise `WEEKLY_PLAN_SYSTEM` çıktısı olan DÜZ BİR DİZİ (`{date, is_training_day, meals:[{name, calories}]}`), `targets`/`day_index`/`items` YOK. Sonuç: obje → dizi olur, hedef makrolar ve öğün-item içerikleri tamamen kaybolur.

```
// ai-plan/index.ts:854-859
.update({ plan_data: weeklyPlan.days, ... approved_at: null })
// plan-projection.ts:181  const targets = dietPlanData?.targets ?? {};   → {}
// plan-projection.ts:198  dietDays.find(d => d?.day_index === i)         → undefined
// plan-projection.ts:213  caloriePoint → KCAL_FLOOR=1000, proteinTarget → 0
```

**Etki:** Premium kullanıcı sohbette pazarlık edip onayladığı diyet planının üzerine Haftalık Menü üretirse, aktif diyet satırı sessizce bozulur. Sonraki re-projeksiyonda dashboard "kalan kalori" 1000 kcal tabanına düşer, makro hedefleri 0'lanır, öğün önerileri kaybolur. "Chat = source of truth" tek-kaynak modeli ihlal edilir.

**Öneri:** Legacy haftalık menüyü ayrı bir satıra/alt-tipe izole et (`plan_subtype='weekly_menu'` veya ayrı tablo). Tek "active diet" satırı iki uyumsuz tüketici (projeksiyon vs menü ekranı) tarafından paylaşılmamalı.

---

### [HIGH] daily_log / plan_diet / plan_workout retrieval planları HİÇ erişilemiyor — analyzeMessage yanlış taskMode ile besleniyor

- `supabase/functions/ai-chat/index.ts:258`
- `supabase/functions/shared/retrieval-planner.ts:92-121, 317, 347-359`
- `supabase/functions/ai-chat/task-modes.ts:30-80`

**Sorun:** `analyzeMessage(message, taskMode)` çağrısında `taskMode = detectTaskMode()` çıktısıdır (`effectiveMode` DEĞİL). `detectTaskMode` hiçbir koşulda `daily_log`/`plan_diet`/`plan_workout` döndürmez — bunlar yalnız client `task_mode_hint`'inden gelir ve sadece `effectiveMode`'a yansır. `analyzeMessage` switch'inde de bu üç mod için case yoktur → `default` (general_coaching). `getRetrievalPlan` `analysis.taskMode` üzerinde switch yaptığı için `347-359`'daki ilgili case'ler ULAŞILAMAZ.

```
// index.ts:258
const analysis = analyzeMessage(message ?? '', taskMode);  // effectiveMode değil
```

**Etki:** Post-onboarding ana sohbet (daily_log) ve plan-pazarlık ekranları (plan_diet/plan_workout) amaçlanan zengin bağlamı (7-14 günlük öğün/antrenman, full L2) ASLA almaz; dar bir plana (coaching/qa) düşer. Koç geçmiş öğün/kalıp/plan bağlamını göremediği için süreklilik ve kişiselleştirme kaybı.

**Öneri:** `index.ts:258`'i `analyzeMessage(message, effectiveMode)` yap VE `analyzeMessage` switch'ine bu üç mod için case ekle ki `getRetrievalPlan` dalları tetiklensin. greeting/qa fast-path'leri doğrula.

---

### [HIGH] Onboarding sırasında bildirilen öğün/antrenman deterministik güvenlik-ağına takılmaz

- `supabase/functions/ai-chat/index.ts:596-599, 622-625, 248, 252`

**Sorun:** meal-log ve workout-log güvenlik ağları `(effectiveMode === 'register' || effectiveMode === 'daily_log')` ile kapılıdır. `isOnboarding=true` iken `detectTaskMode` 'onboarding' döner; bu `HINT_MODES`'a dahil olmadığından `effectiveMode='onboarding'` kalır ve gate'e takılmaz. Model `<actions>` blogunu atlarsa "kahvaltıda 2 yumurta yedim" gibi bir rapor HİÇBİR ağa düşmez (weight/water/sleep/supplement/mood ağları mode-gate'siz olduğu için korunuyor — sadece öğün ve antrenman açıkta).

**Etki:** Yeni kullanıcı onboarding'deyken bildirdiği öğün/antrenman, model action emit etmezse sessizce kaybolur. Tam da ilk-izlenim anında kötü UX.

**Öneri:** Gate'i diğer ağlar gibi negatif kur: `effectiveMode !== 'plan_diet' && effectiveMode !== 'plan_workout'`.

---

### [HIGH] `<simulation>` bloğu için extractor yok — JSON ham haliyle kullanıcıya sızıyor

- `supabase/functions/ai-chat/task-modes.ts:229-234`
- `supabase/functions/ai-chat/index.ts:540-946`

**Sorun:** `simulation` modu modelden yanıt sonuna `<simulation>{"foodName":...,"calories":...}</simulation>` bloğu eklemesini ZORUNLU kılar. index.ts'teki tüm temizleme zinciri (extractActions, stripVerbalAcknowledgements, extractLayer2Updates, extractPlanSnapshot, extractReasoning, extractNavigateTo, extractTaskCompletion) bu bloğu tanımaz (`grep '<simulation>'` → 0). `detectTaskMode` 'yesem/yersem/olur mu' ifadelerini erken kontrolle (task-modes.ts:39) simulation'a yönlendirdiği için sık tetiklenir.

**Etki:** Kullanıcı "şunu yesem ne olur?" diye sorduğunda yanıtın sonunda ham `<simulation>{...}` JSON metni görünür; koç cevabı kırık/teknik görünür.

**Öneri:** `extractReasoning` kalıbında `extractSimulation(text)` ekleyip bloğu mesajdan ayıkla ve structured `simulation` alanı olarak döndür; ya da bloğu modelden istemeyi bırakıp simülasyonu prose içinde tut.

---

### [HIGH] extractActions yalnızca İLK `<actions>` bloğunu okur — ikinci blok hem işlenmez hem metne sızar

- `supabase/functions/ai-chat/index.ts:1761-1771`

**Sorun:** Regex `/<actions>([\s\S]*?)<\/actions>/` — `g` bayrağı YOK; hem `match` hem `replace` tekil. task-modes.ts birden çok modda ayrı blok teşvik eder (save_recipe:167, venue_log:186, commitment:249), ve recipe modu aynı mesajda hem save_recipe hem profile_update emit edilmesini ister.

```
// index.ts:1763
const match = text.match(/<actions>([\s\S]*?)<\/actions>/);   // g yok
// index.ts:1770
text.replace(/<actions>[\s\S]*?<\/actions>/, '')              // g yok
```

**Etki:** Model iki blok üretirse: ikinci bloktaki eylem (save_recipe/commitment/venue_log) hiç çalıştırılmaz (sessiz veri kaybı) VE ham `<actions>[...]` metni kullanıcı mesajında kalır.

**Öneri:** `matchAll`+`g` ile tüm blokları topla, her birini parse edip birleştir, hepsini `replaceAll`/g-flag ile strip et.

---

### [HIGH] learned_tone_preference için üç ayrı kelime dağarcığı — haftalık çıkarım eşleşmeyen değer yazıp ton talimatını bozuyor

- `supabase/functions/shared/memory.ts:808-822`
- `supabase/functions/shared/repair-handler.ts:382-388`
- `supabase/functions/ai-extractor/index.ts:276`
- `supabase/functions/ai-chat/system-prompt.ts:321`

**Sorun:** `inferTonePreference` (haftalık tier-3'ten canlı çağrılıyor) `concise|conversational|supportive|analytical|balanced` yazar. `getToneContext` yalnız `empathetic|data_driven|motivational|strict` tanır. system-prompt modele üçüncü seti emit ettirir. Üç küme arasında KESİŞİM YOK; eşleşmeyince `toneInstructions[tone] ?? tone` ile ham enum prompt'a düşer ('TON TERCIHI: analytical').

```
// memory.ts:822  updateLayer2(userId, { learned_tone_preference: tone })  // 'analytical' vb.
// repair-handler.ts:388  parts.push(`TON TERCIHI: ${toneInstructions[tone] ?? tone}`)
```

**Etki:** Haftalık tier-3 çalıştığında modelin emit ettiği geçerli ton değerini eşleşmeyen değerle EZER; sonraki her turda koç anlamlı ton talimatı yerine ham enum kelimesi görür. Öğrenilen iletişim tercihi etkisiz/yanıltıcı olur ('balanced' default'u da map'te yok).

**Öneri:** Tek ton sözlüğü belirle; `inferTonePreference` çıktısını `getToneContext` kümesine map et (supportive→empathetic, analytical→data_driven, conversational→motivational, concise→strict) veya map'e beş değeri ekle.

---

### [HIGH] Atomik append helper ölü — behavioral_patterns yarış-durumuna açık (read-modify-write, son-yazan-kazanır)

- `supabase/functions/shared/memory.ts:441-453, 552-555`
- `supabase/functions/ai-chat/index.ts:4001, 4060, 4253`
- `supabase/migrations/015_ai_summary_atomic_merge.sql:49`

**Sorun:** Migration 015 yarışı önlemek için `ai_summary_append_patterns` (FOR UPDATE kilitli) + `appendBehavioralPatterns` ekledi ama HİÇBİR YERDEN ÇAĞRILMIYOR. Canlı yol (`processLayer2Updates`) JS'te diziyi okuyup mutasyona uğratıp tüm diziyi `updateLayer2 → ai_summary_merge` ile geri yazar; merge array alanını `COALESCE(p_patch->'behavioral_patterns', ...)` ile tamamen REPLACE eder. Ayrıca `evolvePatternConfidence` kilidi bypass edip doğrudan `.update({behavioral_patterns})` yapar ve extractor tier-2'de (günlük) ai-chat ile eşzamanlı çalışabilir.

**Etki:** ai-chat, extractor ve ai-proactive eşzamanlı tetiklenince davranışsal kalıplar (gece/duygusal yeme vb.) sessizce kaybolabilir/üzerine yazılabilir; kişiselleştirme hafızası bozulur. 015'in çözdüğü senaryo canlı yolda hâlâ açık.

**Öneri:** `processLayer2Updates` pattern dalını `appendBehavioralPatterns` RPC'sine taşı (yalnız yeni pattern gönder; dedup/decay/cap atomik fonksiyonda). `evolvePatternConfidence`'i kilitli RPC'ye çevir.

---

### [HIGH] Alerjen tarama Türkçe çekimli ('yer fıstığı') ve İngilizce yiyecek adlarını kaçırıyor

- `supabase/functions/shared/guardrails.ts:70, 84`
- `supabase/functions/ai-plan/index.ts:665`
- `supabase/functions/ai-chat/index.ts:1539`

**Sorun:** `checkAllergens` `lowerText.includes(token)` + `stripTurkishSuffix` kullanıyor; `stripTurkishSuffix` yalnız tüm metnin SONUNDAKİ eki kırpar ve 'ğ→k' yumuşamasını ele almaz. 'yer fıstığı' içindeki 'fıstığı' (ğ) ile 'fıstık' (k) eşleşmez. İngilizce adlar (peanut, milk, cheese) sözlükte yok.

```
// Canlı test ile teyit:
checkAllergens('yer fıstığı ezmesi öneriyorum', ['fıstık']).passed === true  // KAÇIRIYOR
checkAllergens('peanut butter toast', ['fıstık']).passed === true
checkAllergens('fındığı ye', ['fındık']).passed === true
```

**Etki:** ai-plan öğün opsiyonları ve ai-chat çıkış-taraması bu fonksiyonla filtreleniyor. Fıstık alerjisi olan kullanıcının planında "yer fıstığı ezmesi" (fıstığın standart Türkçe adı) kalabilir → anafilaktik gıda için ciddi güvenlik riski.

**Öneri:** `stripTurkishSuffix`'i kelime-kelime uygula, son-ünsüz yumuşamasını normalize et (ğ→k/g, b→p, c→ç, d→t); `ALLERGEN_FOODS`'a 'yer fıstığı' + sık İngilizce karşılıkları ekle.

---

### [HIGH] Alerjen çıkış-uyarısı alakasız bir 'decline' kelimesiyle veya 2. öneride yanlışlıkla bastırılıyor (yanlış-negatif)

- `supabase/functions/ai-chat/index.ts:1550-1557`

**Sorun:** "addressed" mantığı, alerjen yiyeceğin İLK geçişinin (`indexOf`) ±50 karakter penceresinde herhangi bir decline kelimesi varsa uyarıyı bastırır. İki yanlış-negatif: (1) pencere içinde konuyla alakasız decline kelimesi → bastırma; (2) `indexOf` yalnız ilk geçişe bakar, ilk geçiş "X yerine" ise gerçek 2. öneri kaçar.

```
// Canlı test:
addressed('Kahvaltıda peynir öner. şekerli içecekleri tüketme.', ['peynir']) === true  // alakasız 'tüketme'
addressed('peynir yerine badem öner. ayrıca akşam peynir tabağı harika.', ['peynir']) === true  // 2. öneri kaçar
```

**Etki:** Kod-zorlamalı alerjen güvenlik ağı, modelin gerçekten alerjeni önerdiği durumlarda susturulabiliyor; kullanıcı uyarı almadan tehlikeli öneriyi görüyor.

**Öneri:** Tüm geçişleri tara; en az BİR geçiş decline penceresi dışındaysa uyar. Decline kelimesini geniş pencere yerine alerjen token'ına bitişik kalıpla eşleştir ('<token> yerine', '<token> içermez').

---

### [HIGH] İntihar/kendine zarar kriz tespiti yaygın Türkçe ifadeleri kaçırıyor

- `supabase/functions/shared/guardrails.ts:339-349`
- `supabase/functions/ai-chat/index.ts:125`

**Sorun:** `detectCrisis` sabit ifade listesiyle çalışır. Gerçek kriz ifadeleri listede yok: 'kendimi asacağım', 'bıçakla bileğimi keseceğim', 'ölüp kurtulmak istiyorum', 'hayata veda etmek istiyorum', 'her şeye son vermek istiyorum', 'kendime kıymak istiyorum'. Canlı testte 6 ifadenin TAMAMI `isCrisis === false` döndü.

**Etki:** Akut psikolojik krizdeki kullanıcı 112+profesyonel destek mesajını alamaz; en kötü ihtimalle model bir intihar imasını diyet sohbeti olarak yanıtlar. En yüksek etkili güvenlik açığı.

**Öneri:** Kök-tabanlı regex: `/(kendimi|canıma|hayatıma|yaşamıma).*(as|kes|kıy|son ver|öldür|bitir)/`, `/(ölüp kurtul|hayata veda|son vermek istiyorum)/`. Yöntem kelimeleri (asmak, kesmek, bilek+kes, bıçak/ip+kendime) ekle.

---

### [HIGH] Cron HTTP çağrıları x-cron-secret göndermiyor — CRON_SECRET tanımlanırsa tüm proaktif/rapor/temizlik sistemi 401 ile sessizce ölür

- `supabase/functions/shared/cron-auth.ts:14-23`
- `supabase/migrations/014_cron_jobs.sql:15-18, 47-50, 62-65, 77-80`
- `supabase/migrations/022_scheduled_cleanups_unify.sql`

**Sorun:** `denyIfNotCron` `x-cron-secret` header'ini `CRON_SECRET` ile karşılaştırır; eşleşmezse 401. CRON_SECRET tanımsızsa fail-open. Ancak hiçbir cron migration'ı bu header'ı GÖNDERMİYOR (`grep x-cron-secret/CRON_SECRET supabase/migrations` → 0 eşleşme; header'larda yalnız Content-Type + Bearer service_role var).

**Etki:** Gizli bomba: biri güvenlik amacıyla CRON_SECRET set ederse ai-proactive, ai-extractor ve cleanup-scheduled crons'unun tamamı 401 alır; hiçbir nudge/rapor/temizlik üretilmez ve hata kullanıcıya görünmez.

**Öneri:** Tüm `net.http_post` header'larına `'x-cron-secret', current_setting('app.settings.cron_secret')` ekle; ya da cron-auth.ts yorumundaki vaadin migration'larda karşılanmadığını belgele.

---

### [HIGH] Haftalık raporlar cron tarafından HİÇ otomatik üretilmiyor — tetik penceresi cron saatleriyle çakışmıyor

- `supabase/functions/ai-proactive/index.ts:1428`
- `supabase/migrations/014_cron_jobs.sql:43, 58, 73`

**Sorun:** Haftalık rapor tetiği yalnızca `dayOfWeek === 1 && utcHour >= 6 && utcHour <= 8` koşulunda çalışır. ai-proactive cron'u ise SADECE UTC 05:00, 10:00, 17:00'da çalışır. Hiçbir cron saati 6-8 UTC penceresine düşmez (en yakını Pazartesi 10:00, pencere dışı). Karşılaştırma: günlük rapor tetiği `4-6` kullanır ve 05:00 cron'uyla çalışır.

**Etki:** Pazartesi sabahı otomatik haftalık rapor hiçbir kullanıcı için oluşmaz; kullanıcı manuel istemedikçe boş kalır. Aylık rapor da weekly_reports'u beslediğinden zincirleme etkilenir.

**Öneri:** Tetik penceresini günlük blokla aynı `4-6`'ya hizala (05:00 Pazartesi cron'u tetiklesin) veya 014'e Pazartesi 6-8 arası ek cron ekle.

---

### [HIGH] Günlük ücretsiz mesaj limiti 'register' anahtar kelimesiyle atlatılabiliyor (monetizasyon/maliyet açığı)

- `supabase/functions/ai-chat/index.ts:153-155`
- `supabase/functions/shared/rate-limit.ts:95`
- `supabase/functions/ai-chat/task-modes.ts:49-54`

**Sorun:** Rate-limit muafiyeti tamamen kullanıcının kontrol ettiği içeriğe bağlı. `isRecordParse = detectTaskMode(message)==='register'` ve `if (isRecordParse) return { allowed:true, remaining:-1 }` ile bu mesajlar limite HİÇ sayılmaz. `detectTaskMode` saf anahtar-kelime tespitidir ('yedim', 'su iç', 'antrenman', '\d+ kg', 'uyku'...). Limiti dolmuş kullanıcı uzun bir koçluk sorusunun sonuna "...bu arada bugün su içtim" ekleyerek 50/gün tavanını süresiz atlatır.

**Etki:** Ücretsiz kullanıcılar günlük sınırı tek anahtar-kelimeyle sınırsız LLM çağrısına çevirebilir; doğrudan AI maliyeti + premium dönüşüm kaybı. (register FAST tier'a — gpt-4o-mini — gider, yine de tam yanıt üretir ve cap'i hiç saymaz.)

**Öneri:** Muafiyeti içerik tespitine değil, gerçekten kayıt eylemi üretilip üretilmediğine bağla (post-hoc). Alternatif: register'ı ayrı ve düşük bir tavanla sınırla.

---

### [HIGH] Servis bağlamları (recovery/eating-out/MVD) gün sınırını yok sayıp ham UTC 'bugün' kullanıyor

- `supabase/functions/shared/service-contexts.ts:130, 301, 372, 816`
- `supabase/functions/ai-chat/index.ts:243, 361, 398`

**Sorun:** ai-chat kullanıcının efektif gününü tz + day_boundary_hour ile hesaplar ve tüm `meal_logs.logged_for_date` yazımları buna göredir. Ancak `getAllServiceContexts` imzası efektif tarihi İLETMEZ; `getRecoveryContext`/`getEatingOutContext`/`getMVDContext` 'bugün'ü ham `new Date().toISOString()` ile yeniden hesaplar. Aynı dosyada recipe modu effectiveToday kullanıyor (361) — tutarsızlık kanıtlı.

**Etki:** İstanbul kullanıcısı gece yarısı/UTC dönümüne yakın konuşursa öğünler efektif tarihe yazılı ama recovery/eating-out/MVD UTC'ye göre sorgular → "bugün yenilen" 0/yanlış güne ait çıkar; recovery'de yanlış "fazlalık", eating-out'ta yanlış "kalan bütçe", MVD'de yanlış aktiflik. Geniş offsetli (ABD) saat dilimlerinde sistematik.

**Öneri:** `getAllServiceContexts` options'ına `effectiveToday` (gerekirse weekStart) ekleyip ai-chat:243 değerini ilet; üç servis bunu kullansın.

---

### [HIGH] Sunucu (UTC) ile istemci (cihaz TZ) week_start hesabı ayrışıyor — üretilen haftalık menü ekranda görünmüyor

- `src/services/weekly-plan.service.ts:139, 198-203`
- `supabase/functions/ai-plan/index.ts:95, 790, 886-891`

**Sorun:** Legacy menü `week_start`'ı sunucuda UTC tarihle hesaplar (`new Date().toISOString()` + local-method `getWeekStart` Deno UTC runtime'da). İstemci `getCurrentWeeklyPlan`'da `getWeekStart`'ı CİHAZ YEREL saatiyle hesaplayıp `.eq('week_start', weekStart)` ile TAM EŞİTLİK sorgular. TZ farkında ayrışır; ayrıca istemci `getWeekStart`'ı da hatalı (Pazartesi 00:30 IST'te Pazar tarihi üretiyor).

```
// Node TZ=Europe/Istanbul, 2026-06-08T00:30+03:00:
// İstemci → '2026-06-07' ; sunucu → '2026-06-01' → .eq eşleşmez → 0 satır
```

**Etki:** Kullanıcı haftalık menüyü başarıyla üretir ama menü tab'ı boş kalır; premium özellik kullanılamaz görünür. Haftanın ilk günleri / TZ farkında tetiklenir.

**Öneri:** Her iki tarafı tek, TZ-tutarlı Pazartesi ankrajına (ai-chat'teki UTC-noon ankrajlı getWeekStart) bağla; istemciyi eşitlik yerine aralık (`week_start <= today <= week_start+6`) ile sorgula.

---

### [MEDIUM] İlk-pas plan-snapshot üretimi yüksek sıcaklıkta + JSON-mode zorlanmadan çalışıyor

- `supabase/functions/ai-chat/index.ts:533, 535-538, 975-988, 2275-2305`
- `supabase/functions/shared/openai.ts:23-35, 88-90`

**Sorun:** İki ayrı kusur tek kök: (1) Ana LLM sıcaklığı `TEMPERATURE[taskMode] ?? 0.5` ile seçilir — `taskMode` (effectiveMode değil), ve haritada `plan_diet`/`plan_workout` anahtarı yok → 7-14 günlük büyük JSON ilk geçişte 0.4-0.5'te üretilir (zorunlu yeniden-üretim 0.2 kullanır). (2) Plan/forced çağrıları `jsonMode` geçmez; `response_format:json_object` altyapısı VAR ama plan akışında kullanılmaz, metinden regex ile ayıklanır.

**Etki:** İlk plan geçişi daha yüksek sıcaklıkta + JSON-mode'suz olduğundan kısaltma/bozuk JSON olasılığı artar; bu pahalı bir ikinci 8000-token çağrıyı tetikler ya da plan sessizce düşer (kullanıcı sadece intro cümlesini görür).

**Öneri:** Sıcaklığı `effectiveMode` üzerinden seç ve plan modlarına 0.2-0.3 ekle; plan/forced çağrılara `jsonMode:true` geçir (tag yerine düz JSON döndüren çağrı şekli gerekebilir).

---

### [MEDIUM] ai-extractor general_summary'yi atomik merge'i bypass ederek yazıyor — lost-update + tutarsız boyut sınırı

- `supabase/functions/ai-extractor/index.ts:254-258, 317-335`
- `supabase/functions/ai-chat/index.ts:3987`

**Sorun:** ai-extractor general_summary'yi `ai_summary_merge` yerine düz `.upsert(...)` ile yazar (015 FOR UPDATE kilidini almaz). ai-chat aynı alanı `updateLayer2 → merge` RPC'siyle read-modify-write yapar. İki yol birbirine atomik değil → lost update. Ayrıca extractor 3000 karakterde kırpar, ai-chat HİÇ kırpmaz. `updateCheckpoint` de aynı kilit-bypass desenini taşır.

**Etki:** Eşzamanlı çalışmada general_summary satırı kaybolabilir; ai-chat yolu sınırsız büyüyüp Layer-2 GENEL ÖZET'i şişirir (token bütçesini yer).

**Öneri:** general_summary yazımını `ai_summary_merge` RPC'ye taşı (append+cap RPC içinde); ai-chat append'ine aynı 3000 cap'i uygula; updateCheckpoint dahil doğrudan-update L2 yazımlarını merge'e al.

---

### [MEDIUM] Layer-2 metin alanları sınırsız büyüyor; katman-başı token bütçesi zorlanmıyor

- `supabase/functions/shared/context-builders.ts:33-50, 350, 447`
- `supabase/functions/ai-chat/index.ts:3987, 4116-4120`

**Sorun:** `coaching_notes` her aksiyonda `${current}\n[tarih]...` eklenir ve `buildLayer2Scoped`'ta TAM basılır — cap yok. `general_summary` de cap-siz. `buildContextFromPlan` `estimatedTokens`'i yalnız HESAPLAR, hiçbir katmana kırpma uygulamaz. `TOKEN_BUDGET`/`compressLayer3` yalnız LEGACY `buildLayer3`'te; canlı `buildLayer3Scoped`'ta bütçe yok. (NOT: `buildLayer4Scoped` zaten 6000-token bütçeli.)

**Etki:** Aylar içinde coaching_notes/general_summary birikip Layer-2'yi şişirir; uzun-süreli kullanıcıda prompt token sınırına yaklaşır, model 400 alabilir veya bağlam sıkışır.

**Öneri:** `buildLayer2Scoped`'ta coaching_notes/general_summary için satır/karakter kapağı (son N satır / ~2-3 hafta) uygula; yazımda da tutarlı cap koy.

---

### [MEDIUM] tdee_notes yazılıyor ama hiçbir L2 okuyucu okumuyor — ölü yazma yolu

- `supabase/functions/ai-chat/index.ts:4400-4404`
- `supabase/functions/shared/context-builders.ts:267-272`
- `supabase/functions/shared/memory.ts:123`
- `supabase/migrations/045_audit_round_db_hardening.sql:48`

**Sorun:** ai-chat tdee_notes'u `ai_summary_merge` ile yazar; yorum "buildLayer2 reads it" der. Grep ile teyit: tdee_notes ne `buildLayer2` ne `buildLayer2Scoped` ne repair-handler'da OKUNMUYOR (`select('*')` yapsa da `s.tdee_notes` referansı yok). (recovery_pattern/weekly_budget_pattern gerçekten okunuyor — yalnız tdee_notes ölü.)

**Etki:** Her TDEE güncellemesinde yazılan veri hiçbir prompt'a girmez; koç güncel TDEE bağlamını hafızadan göremez. Boşa DB yazımı + yanıltıcı yorum.

**Öneri:** `buildLayer2Scoped` isFull dalına `if (s.tdee_notes) parts.push(...)` ekle ya da yazımı kaldır; yanıltıcı yorumları düzelt.

---

### [MEDIUM] micro_nutrient_risks: yazıcısı olmayan salt-okunur bellek + array sütununa hatalı obje merge'i

- `supabase/functions/shared/context-builders.ts:395`
- `supabase/functions/shared/memory.ts:206`
- `supabase/migrations/003_ai_memory_and_chat.sql:71`
- `supabase/migrations/045_audit_round_db_hardening.sql:80`

**Sorun:** (1) micro_nutrient_risks L2'de OKUNUYOR ve export'ta gösteriliyor ama HİÇBİR edge function YAZMIYOR → bölüm hep boş. (2) Sütun `JSONB DEFAULT '[]'` (array) ve okuyucular `{nutrient,risk_level}[]` bekler; merge `COALESCE(..., '{}'::jsonb) || COALESCE(p_patch->...,'{}'::jsonb)` ile OBJE default'u ve `||` kullanır — array sütununa obje merge'i şekli bozar.

**Etki:** Mikro besin riski bağlamı koça ulaşmaz (ölü okuma). İleride yazıcı eklenirse merge array'i bozar (latent veri bozulması; okuyucu `.map(r => r.nutrient)` → undefined).

**Öneri:** Yazıcı planlanıyorsa merge'i array-aware yap (dizi birleştirme/dedup); yoksa okuma+export yolunu kaldırarak ölü yolu temizle.

---

### [MEDIUM] approveDraft / chat-approve archive→promote atomik değil — yarışta 0 aktif plan riski

- `src/services/plan.service.ts:230-263`
- `supabase/functions/ai-chat/index.ts:1231-1262`
- `supabase/migrations/047_weekly_plans_active_edit_with_activation_guard.sql:16-38`

**Sorun:** Hem `approveDraft` hem ai-chat approve iki ayrı statement uygular: önce eski aktifi archive, sonra draft'ı promote. Transaction/kilit yok. `uniq_active_plan_per_type` partial unique index tek active'e izin verir; iki eşzamanlı onayda ikinci promote 23505 alır ve promote başarısız olursa archive geri ALINMAZ → kullanıcı 0 aktif planla kalır. 047 trigger'ı yalnız client-aktivasyonunu engeller, atomiklik sağlamaz.

**Etki:** Nadir ama mümkün: çift onay/ağ retry'ında archive başarılı + promote düşerse kullanıcı aktif planını kaybeder (dashboard/projeksiyon boş kalır). Sonraki onay düzeltir.

**Öneri:** Onay+arşivlemeyi tek SECURITY DEFINER RPC'de transaction yap; veya promote başarısızsa arşivlemeyi geri al; en azından 23505'i yakalayıp idempotent retry uygula.

---

### [MEDIUM] Projeksiyondaki weekConsumed soft-delete edilmiş öğünleri filtrelemiyor (ai-plan ile tutarsız)

- `supabase/functions/ai-chat/index.ts:1308-1313`
- `supabase/functions/ai-plan/index.ts:686-688`

**Sorun:** Chat-approve projeksiyonunda haftalık tüketilen kalori sorgusu `meal_logs`'tan id çekerken `is_deleted=false` filtresi UYGULAMAZ. Bu `weekConsumed` projeksiyona geçer ve `daily_plans.weekly_budget_consumed/remaining`'i belirler. Oysa ai-plan aynı hesapta açıkça `.eq('is_deleted', false)` filtreler (#S19). İki yol aynı metriği farklı hesaplıyor.

**Etki:** Kullanıcı öğün silse bile, plan onaylanırken o öğünün kalorileri haftalık bütçeye sayılır; dashboard "kalan kalori" olduğundan az gösterilir.

**Öneri:** ai-chat:1311 meal_logs sorgusuna `.eq('is_deleted', false)` ekle.

---

### [MEDIUM] Aylık raporda avg_compliance/weight_change_kg LLM değeriyle kaydedilebiliyor — haftalık yol ile tutarsız

- `supabase/functions/ai-report/index.ts:430-435, 445, 478-479`

**Sorun:** Haftalık yol compliance/kilo değerlerini bilinçli deterministik hesaplayıp LLM çıktısını ezerken (`avg_compliance: avgCompliance`), aylık yol `Number(report.avg_compliance ?? avgCompliance)` ve `report.weight_change_kg ?? weightChange` kullanır — LLM bir sayı döndürürse LLM kazanır, deterministik hesap fallback'e düşer.

**Etki:** Aylık raporun ortalama uyum % ve kilo değişimi gerçek günlük verilerden değil LLM tahmininden gelebilir; günlük/haftalık raporlarla çelişen bir aylık % gösterilebilir.

**Öneri:** Aylık upsert'te değerleri doğrudan deterministik `avgCompliance`/`weightChange`'den türet (LLM'i fallback olarak bile kullanma); weekly path gibi API yanıtını da hizala.

---

### [MEDIUM] All-time longest_streak ardışık olmayan günleri seri sayıyor — takvim boşluğu kontrolü yok

- `supabase/functions/ai-report/index.ts:511-514, 557-564`

**Sorun:** Streak döngüsü `compliance_score>=70` olan her `daily_reports` satırında `currentStreak`'i artırır, ardışık takvim günü olup olmadığını kontrol etmez. daily_reports yalnız rapor üretilen günlerde satır içerir; arada rapor üretilmeyen günler "kırılma" sayılmaz (ör. 1. gün, 10 gün boş, 12. gün → seri 2).

**Etki:** Kullanıcıya gerçekte var olmayan uzun bir "streak" gösterilir; şişirilmiş başarı metriği, özellikle düzensiz kayıt yapanlarda yanıltıcı.

**Öneri:** Önceki sayılan tarihi tutup `r.date - prevDate === 86400000` değilse `currentStreak`'i resetle; takvim boşluklarını kırılma say.

---

### [MEDIUM] Tıbbi-ifade sanitizasyonu kelime-sınırı olmadan substring eşleştiriyor — meşru metni bozuyor

- `supabase/functions/shared/guardrails.ts:25-26, 208-209`
- `supabase/functions/ai-chat/index.ts:541`
- `supabase/functions/ai-plan/index.ts:673-676`

**Sorun:** `sanitizeText` FORBIDDEN_PHRASES'i kelime sınırı olmadan `gi` regex ile değiştirir. 'ilac' alt-dizgesi masum kelimelerde eşleşir: 'kilacı düşür' → 'k[yasam tarzi notu]ı düşür'; 'ilaçsız' → '[X]sız'; 'recetesiz' → '[X]siz'; 'tedavi gibi' → '[X] gibi'.

**Etki:** Kullanıcı bozuk/anlamsız koç yanıtları ve plan focus_message/snack_strategy metinleri görür. Güvenlik açığı değil ama görünür kalite/güven kaybı.

**Öneri:** Kelime-sınırı uygula: `new RegExp('\\b'+phrase+'\\b','giu')` veya kısa substring'leri bağlamsal kalıba bağla ('ilaç al', 'tedavi et').

---

### [MEDIUM] LLM çağrılarında timeout/AbortController yok — askıda kalan sağlayıcı isteği edge fonksiyonunu kilitler

- `supabase/functions/shared/openai.ts:92, 109`
- `supabase/functions/ai-chat/index.ts:91`
- `supabase/functions/ai-extractor/index.ts:167`

**Sorun:** Tüm LLM/Whisper fetch çağrıları AbortController/timeout signal'i OLMADAN yapılır (`grep AbortController/signal:` → 0; tek setTimeout 429 backoff). Bağlantı yavaş/askıda kalırsa istek platform duvar-saat limitine kadar bloklanır.

**Etki:** Sağlayıcı yavaşlığında edge fonksiyonu takılır; kullanıcı donmuş UI görür, retry ile maliyet ikiye katlanır.

**Öneri:** chatCompletion ve Whisper/extractor fetch'lerine AbortController + 30-45s timeout ekle; timeout'ta fallback modele veya jenerik Türkçe hataya düş.

---

### [MEDIUM] Whisper transkripsiyon URL'i sabit kodlu — OPENAI_BASE_URL sağlayıcı-değişimini kapsamıyor

- `supabase/functions/ai-chat/index.ts:90-93`
- `supabase/functions/shared/openai.ts:14`

**Sorun:** Sağlayıcı `OPENAI_BASE_URL` ile yapılandırılabilir kılındığı halde Whisper STT çağrısı `https://api.openai.com/v1/audio/transcriptions`'ı SABİT kodlar, modeli `whisper-1` sabitler, anahtarı `OPENAI_API_KEY` kullanır. Operatör base-URL'i başka sağlayıcıya çevirip anahtarı değiştirirse STT hâlâ OpenAI'ye gider → 401.

**Etki:** Sağlayıcı değişiminde (kota kurtarma) Premium sesli giriş sessizce bozulur; "tek secret ile backend swap" garantisi sesli akış için tutmaz.

**Öneri:** `${OPENAI_BASE_URL}/audio/transcriptions` kullan, modeli `KOCHKO_MODEL_STT || 'whisper-1'` yap; sağlayıcı STT desteklemiyorsa sesli girişi zarif devre dışı bırak.

---

### [MEDIUM] Ham OpenAI/sağlayıcı hata gövdesi doğrudan istemciye dönüyor (bilgi sızıntısı + kötü UX)

- `supabase/functions/shared/openai.ts:102, 114`
- `supabase/functions/ai-chat/index.ts:1704, 1711-1712`

**Sorun:** openai.ts 4xx'te `throw new Error('OpenAI error (${model}): ${status} - ${err}')` (err = tam yanıt gövdesi). ai-chat üst-catch'te bu ham mesaj `respond({ error: msg, code:'AI_UNAVAILABLE' }, 500)` ile OLDUĞU GİBİ istemciye döner. Base-URL OpenAI dışı bir sağlayıcıya işaret ediyorsa iç hata/org-proje kimliği sızabilir; kullanıcı teknik İngilizce metin görür.

**Etki:** Altyapı ayrıntıları istemciye sızabilir; UI dili Türkçe iken kullanıcı ham İngilizce hata görür. Operatör görünürlüğü zaten `console.error` ile var.

**Öneri:** İstemciye sabit Türkçe jenerik mesaj dön; ham `err`/`msg` yalnız server log'unda kalsın.

---

### [MEDIUM] Deterministik nudge döngüleri günlük mesaj limitini (dailyLimit) kontrol etmiyor — bir sabah çok sayıda nudge yığılabilir

- `supabase/functions/ai-proactive/index.ts:141, 190, 426, 836-837, 1800-1808`

**Sorun:** `dailyLimit` kapısı yalnız ana LLM nudge döngüsünde ve push fonksiyonunda var. snack_hour_nudge, motivation_dip, reengagement ve diğer deterministik döngüler `coaching_messages`'e doğrudan insert atar; her biri yalnız kendi `trigger_type`'ı için dedup yapar, günlük TOPLAM sayıyı kontrol etmez. Bu döngüler ana döngüden ÖNCE çalıştığı için dailyLimit'i göremez.

**Etki:** Push'lar push-cap ile sınırlı kalsa da uygulama-içi coaching_messages gelen kutusu sınırsız dolar; "günde 2-3 proaktif mesaj" kuralı ihlal edilebilir.

**Öneri:** Her deterministik insert öncesi o güne ait coaching_messages sayısını dailyLimit ile karşılaştıran ortak helper ekle (`canSendMore(userId)`); veya döngüleri tek önceliklendirilmiş kuyruğa topla.

---

### [MEDIUM] handleUndo workout kaydını HARD-delete ediyor — is_deleted kolonu var ama kullanılmıyor

- `supabase/functions/shared/repair-handler.ts:107, 113-119, 177-198`
- `supabase/migrations/002_daily_logs.sql:53`

**Sorun:** `handleUndo` meal için soft-delete (is_deleted=true + deleted_at) uygularken workout ve supplement için `.delete()` HARD-delete yapar. workout_logs'ta `is_deleted BOOLEAN DEFAULT FALSE` kolonu var (deleted_at yok) — soft-delete altyapısı mevcut ama kullanılmıyor. Workout fetch'i de meal'deki `.eq('is_deleted', false)` filtresini içermiyor.

**Etki:** Kullanıcı "geri al" dediğinde son antrenman kaydı kalıcı silinir; yanlışlıkla tetiklenirse kurtarılamaz (meal'de soft-delete ile audit izi korunuyor). Tutarsız davranış.

**Öneri:** workout undo'yu soft-delete yap (`.update({ is_deleted: true })`) ve fetch'e `.eq('is_deleted', false)` ekle. supplement (is_deleted kolonu yok) hard-delete olarak kalabilir.

---

### [MEDIUM] Hamilelik kalori ayarı: plan-prompt metni (sabit +300) ile kod-zorlamalı değer (T1:0/T2:+340/T3:+450) çelişiyor

- `supabase/functions/shared/periodic-config.ts:103, 161-174, 198-216`
- `supabase/functions/ai-plan/index.ts:495-501`

**Sorun:** `buildPeriodicPlanContext` imzası `pregnancy_trimester` ALMAZ ve prompt'a `config.calorieAdjustment` basar; pregnancy için bu sabit +300. Oysa kod-zorlamalı `getPeriodicCalorieAdjustment` trimestere göre T1:0/T2:+340/T3:+450 uygular ve ai-plan plana bunu işler.

**Etki:** Hamile kullanıcının plan prompt'unda modele "+300 kcal" denir ama plana gerçekte +340/+450 eklenir (T1'de prompt +300 derken kod 0). Model ile uygulanan değer uyuşmaz → yanlış kalori varsayımıyla öğün önerileri.

**Öneri:** `buildPeriodicPlanContext`'e trimester geçip pregnancy dalında `getPeriodicCalorieAdjustment` ile aynı değeri göster; ya da config yerine doğrudan o fonksiyonun çıktısını bas.

---

### [LOW] storeMessages ve respond, hint-modlarında yanlış task_mode kaydeder/döndürür

- `supabase/functions/ai-chat/index.ts:275, 533, 1593, 1694`

**Sorun:** Mod talimatları `effectiveMode` üzerinden hesaplanırken (`getModeInstructions(effectiveMode)`), `storeMessages`'a geçilen `taskMode` ve `respond` içindeki `task_mode` `detectTaskMode` çıktısıdır. plan_diet/plan_workout/daily_log hint'leriyle kaydedilen/dönen task_mode gerçekte çalışan moddan farklıdır.

**Etki:** `chat_messages.task_mode` ve client'a dönen değer plan/daily_log akışlarında yanlış etiketlenir; QA/analitik yanıltıcı olabilir. Fonksiyonel bozulma sınırlı.

**Öneri:** `storeMessages` ve `respond`'a `effectiveMode` geçir (ya da en azından hint modlarında tercih et).

---

### [LOW] daily_plans okuyucusu status-filtresiz `version desc limit 1` okuyor + legacy daily yazıcı draft/version+1 yazıyor (latent)

- `src/stores/dashboard.store.ts:105-106`
- `supabase/functions/ai-plan/index.ts:719, 740`
- `supabase/functions/shared/plan-projection.ts:296`

**Sorun:** Dashboard okuyucusu daily_plans'ı `.order('version', desc).limit(1)` ile STATUS FİLTRESİZ okur. Projeksiyon `version:1, status:'approved'` yazar; legacy ai-plan günlük yolu `version=max+1, status:'draft'` yazar. Legacy yol projeksiyondan sonra çalışırsa draft satırı approved'ı gölgeler. ANCAK legacy günlük yolu canlı çağıran istemci kalmamış (periodic auto-invoke kaldırılmış) → şu an latent.

**Etki:** Şu an tetiklenmiyor (latent). Legacy yol herhangi bir doğrudan/eski istemci çağrısıyla çalışırsa dashboard taslak/eski hedefleri gösterir.

**Öneri:** Okuyucuya `status IN ('approved','active')` filtresi ekle ve/veya legacy günlük daily_plans yazımını tamamen kaldır.

---

### [LOW] requestMenuModification AI çağrısı başarısız olsa bile modification_request'i kalıcı yazıyor

- `src/services/weekly-plan.service.ts:155-158, 174-182`
- `supabase/functions/ai-plan/index.ts:821-824`

**Sorun:** `requestMenuModification` önce aktif satıra modification_request'i KOŞULSUZ yazar, sonra `generateWeeklyPlan` çağırır. invoke hatasında "Menü oluşturulamıyor" döner ama yazılmış request DB'de kalır; sonraki başarılı regen bu eski talebi yeniden uygular.

**Etki:** AI kesintisinde değişiklik talebi "asılı" kalır; sonraki üretimde kullanıcının o an istemediği eski talep tekrar uygulanabilir.

**Öneri:** modification_request'i yalnız generateWeeklyPlan başarılı olunca yaz; başarısızlıkta eski değeri geri al / başarıda null'a çek.

---

### [LOW] Projeksiyon her zaman mevcut takvim haftasına yazıyor; hafta dönümünde daily_plans'ı yenileyen cron/lazy-fill yok

- `supabase/functions/ai-chat/index.ts:1298-1299`
- `supabase/functions/shared/plan-projection.ts:178-196`
- `src/stores/dashboard.store.ts:105-106`

**Sorun:** Projeksiyon weekStart'ı `getWeekStart(requestToday)` ile mevcut haftaya sabitler. daily_plans yalnız onay anındaki haftaya yazılır; takvim haftası dönünce yeni haftaya satır OLUŞMAZ. ai-proactive yalnız daily_plans okur, re-projeksiyon çağırmaz; dashboard satır yoksa lazy-fill YAPMAZ.

**Etki:** Bir hafta sonra dashboard boş daily_plans görebilir; weekly_plans aktif kalsa da kullanıcı planı tekrar açıp onaylamadıkça hedefler kaybolur.

**Öneri:** Hafta dönümünde aktif weekly_plans'tan otomatik re-projecte eden cron ekle, VEYA dashboard okuyucusunu "satır yoksa aktif weekly_plans'tan anında lazy-fill" yap.

---

### [LOW] Plan alerjen filtresi tüm opsiyonları/öğünleri eleyince boş öğün/gün bırakıyor (fallback yok)

- `supabase/functions/ai-plan/index.ts:662-668, 837-844`

**Sorun:** Hem günlük hem haftalık alerjen filtresi, bir öğünün tüm opsiyonları (veya bir günün tüm öğünleri) alerjen içerirse onu BOŞ bırakır; fallback üretimi yok. Boş `options[]` takip/dashboard akışını bozabilir.

**Etki:** Agresif filtre kullanıcıya öğünsüz/seçeneksiz öğün bırakabilir; dashboard boş veriyle karşılaşır.

**Öneri:** Filtre bir öğünü/günü boşaltırsa güvenli varsayılan ekle veya alerjen-bilinçli tekrar dene; en azından kullanıcıya "alerjen nedeniyle bazı öğünler çıkarıldı" notu döndür.

---

### [LOW] Periyodik durumun kalori/protein/IF/su ayarlamaları sohbet bağlamına aktarılmıyor — chat AI sadece etiketi görüyor

- `supabase/functions/shared/context-builders.ts:199-207`
- `supabase/functions/ai-chat/index.ts:36`

**Sorun:** `buildPeriodicPlanContext` (somut ayarlamalar dahil) yalnız ai-plan'da kullanılır. ai-chat tarafında periyodik durum yalnız "DONEMSEL DURUM: <etiket>" satırı olarak verilir; sayısal ayarlamalar yok (ai-chat `buildPeriodicPlanContext`'i import etmez).

**Etki:** Sohbet koçu "sakatlık"/"hamilelik" döneminde olduğunu bilir ama protein/su çarpanı, IF kapalı, antrenman tavanı gibi somut ayarlamaları görmez → plan ile sohbet rehberliği tutarsızlık riski (IF uyumsuzken sohbette IF önerme). system-prompt genel kuralları kısmen telafi ediyor.

**Öneri:** ai-chat bağlam montajına `buildPeriodicPlanContext(profile)` çıktısını (veya IF-uyumu + kalori/protein/su özetini) ekle.

---

### [LOW] Prompt-injection deterministik filtresi yaygın Türkçe ezme kalıplarını kaçırıyor

- `supabase/functions/shared/guardrails.ts:438, 469, 472, 475`

**Sorun:** `sanitizeUserInput` INJECTION_PATTERNS ile eşleşir ama doğal Türkçe ezme kaçar: 'tüm talimatları unut' ('onceki' öneki isteniyor), 'kurallarını yok say' ('yoksay' bitişik ararken 'yok say' boşluklu kaçar), 'DAN/geliştirici moduna geç', 'Artık bir KOÇ değilsin'. Canlı testte 7 ifade `detect()===false`.

**Etki:** Düşük — system-prompt'ta LLM-tarafı injection direnci var (savunma derinliği). Deterministik kapıdaki boşluklar onu zayıflatır ama kritik değil.

**Öneri:** 'onceki' önekini opsiyonel yap; 'unut' fiilini kural/talimat hedefiyle ara; 'yok\s*say' boşluğa izin ver; 'gibi davran|... değilsin' ve 'DAN|developer|geliştirici|sınırsız mod' karşılıklarını ekle.

---

### [LOW] Sohbet öğün-kaydı yolunda makro-kalori tutarlılık doğrulaması çalışmıyor (validateMealParse import edilmiş ama çağrılmıyor)

- `supabase/functions/ai-chat/index.ts:20`
- `supabase/functions/shared/output-validator.ts:19`
- `supabase/functions/shared/guardrails.ts:236`

**Sorun:** `validateMealParse` ai-chat'te import edilir ama HİÇ çağrılmaz; `validateMacroConsistency` hiçbir edge fonksiyonunda çağrılmaz (yalnız tanım). Sohbetten gelen meal_log action'ları extractActions sonrası doğrudan saklanır; makro/kalori şema-tutarlılık doğrulaması yok.

**Etki:** Model tutarsız makro (protein*4+yağ*9 ≠ kalori) veya negatif değer ürettiğinde kullanıcının kalori takibi bozulabilir. Güvenlik değil veri-kalitesi sorunu.

**Öneri:** meal_log persist öncesi her item'a `validateMealParse`/`validateMacroConsistency` uygula; tutarsızlıkta kaloriyi makrolardan yeniden hesapla.

---

### [LOW] Inactivity re-engagement döngüsü ile ana-döngü returnFlowInfo aynı cron geçişinde çift geri-dönüş mesajı üretebiliyor

- `supabase/functions/ai-proactive/index.ts:426-431, 1057-1063, 1343-1349`

**Sorun:** Re-engagement döngüsü yerel 10-12'de, daysSilent tam 3/7/30'da `reengagement_${tier}` insert eder. Aynı cron'da sonra çalışan ana LLM döngüsü `returnFlowInfo`'yu (daysSinceChat>=3) besler ve LLM ayrı bir "geri dönüş" mesajı üretebilir. Dupe guard trigger'ı normalize eder ama LLM'in serbest-metin trigger'ı (`30+ GUN SESSIZ`) `reengagementlong` ile eşleşmez; yalnız içerik ilk 40 karakterde örtüşürse yakalanır.

**Etki:** Aynı sabah kullanıcı hem deterministik hem LLM geri-dönüş mesajı alabilir. Düşük frekanslı (tam 3/7/30. gün + 10-12 penceresi) ama spam algısı yaratır.

**Öneri:** Ana döngüde `returnFlowInfo`'yu yalnız o gün `reengagement_*` trigger'lı mesaj YOKSA ekle; ya da dupe guard'ı `reengagement` prefix ailesi bazında genişlet.

---

### [LOW] Günlük rapor otomatik tetiği UTC gün sınırını kullanıyor; uzak batı saat dilimlerinde 'dün' yanlış güne denk gelebiliyor

- `supabase/functions/ai-proactive/index.ts:68, 1389-1416`

**Sorun:** Günlük rapor auto-trigger bloğu server UTC saatini (4-6) ve UTC `yesterdayStr`'i kullanır; uygulamanın geri kalanı kullanıcı yerel tz'sini (getUserLocalHour) titizlikle kullanırken bu blok fleet-geneli UTC mantığı uygular. Çok batıda (UTC-7) 05:00 UTC hâlâ önceki günün 22:00'i → yarım günün verisi "tam gün raporu" sanılır.

**Etki:** TR dışı (özellikle Amerika) kullanıcılar için günlük rapor yanlış gün sınırında/eksik veriyle üretilebilir. Hedef kitle TR olduğundan etki sınırlı.

**Öneri:** Tetiği kullanıcı bazında yerel gün sınırına bağla (getUserLocalHour/day-boundary ile yerel ~04-06'da yerel "dün").

---

### [LOW] meal_log_items protein_g/carbs_g/fat_g DECIMAL(5,1) sınırına (max 9999.9) karşı clamp edilmiyor

- `supabase/functions/ai-chat/index.ts:2716-2718`
- `supabase/migrations/002_daily_logs.sql:31-33`

**Sorun:** Insert'te calories smallint olarak clamp edilirken (`Math.min(32767,...)`) protein_g/carbs_g yalnız `Math.max(0,...)` ile alt-sınırlanır, üst clamp yok; fat_g de yalnız `Math.max(0,...)`. Şema bunları `DECIMAL(5,1) NOT NULL` (max 9999.9) tanımlar.

**Etki:** Model bir item için 10000+ gram makro üretirse 22003 numeric overflow tüm item batch'ini reddeder; parent meal_logs yazılmış olduğundan makrosuz boş öğün oluşur. Gerçek dünyada aşırı nadir.

**Öneri:** calories ile simetrik olarak protein_g/carbs_g/fat_g'yi `Math.min(9999.9, Math.max(0, ...))` ile clamp et.

---

### [LOW] Rate-limit ve effective-date farklı timezone kaynakları kullanıyor (client_timezone rate-limit'e ulaşmıyor)

- `supabase/functions/ai-chat/index.ts:155, 240-243`
- `supabase/functions/shared/rate-limit.ts:84-110`

**Sorun:** Ana akış effectiveToday'i `client_timezone ?? active_timezone ?? home_timezone` ile hesaplar. `checkRateLimit` ise yalnız `profiles.home_timezone` + day_boundary_hour okur (client/active görmez) ve effectiveToday hesaplanmadan ÖNCE çağrılır.

**Etki:** Seyahatte veya home_timezone hiç set edilmemişse günlük 50/200 mesaj penceresi, öğün loglarının gün sınırından farklı anda sıfırlanır. Kenar durum (çoğu kullanıcıda home=active).

**Öneri:** `checkRateLimit`'e efektif tz'yi parametre olarak geçir veya en azından active_timezone'u home'a tercih et.

---

### [NIT] ai-extractor modeli sabit 'gpt-4o-mini' + JSON modu zorlanmıyor; Vision max_tokens (2000) < smart (2500), düz-metin kesilmesinde retry yok; günlük-cap DST sapması; çıkarım/onarım pürüzleri

- `supabase/functions/ai-extractor/index.ts:174, 184, 193, 200-210, 245`
- `supabase/functions/shared/model-router.ts:44, 46-49`
- `supabase/functions/shared/openai.ts:122-137`
- `supabase/functions/shared/rate-limit.ts:125-126`
- `supabase/functions/shared/repair-handler.ts:81, 86`
- `supabase/functions/shared/service-contexts.ts:671, 686`

**Sorun:** Düşük-etkili çeşitli pürüzler tek başlık altında: (a) ai-extractor `model:'gpt-4o-mini'` sabit, `KOCHKO_MODEL_FAST` override'ını yok sayar; `response_format` zorlanmaz (markdown elle soyulur); hata `if(!ok)continue` ile sessizce yutulur. (b) Vision `maxTokens=2000 < smart 2500`; düz-metin truncation'da (jsonMode dışı) retry yok, `throw` ile 500. (c) Günlük-cap "kalan saat" mesajı sabit +24h ekler (DST'de 1 saat sapar; TR DST'siz olduğundan etkisiz). (d) `confirmation_no` `includes` kullanırken pozitif dal `=== || startsWith` kullanır; laktoz 'sut' (3 harf) substring eşleşmesi; `_summary_update` totalExtracted sayımını şişirir.

**Etki:** Her biri tek başına marjinal: arka plan cron sessiz bozulma riski, kalabalık tabak fotoğrafında nadiren 500, DST'li bölgede yılda 2 gün kozmetik mesaj kayması, nadir yanlış 'hayır' tespiti / telemetri şişmesi.

**Öneri:** ai-extractor modelini `KOCHKO_MODEL_FAST || 'gpt-4o-mini'` üzerinden al + `response_format:json_object` (veya shared chatCompletion jsonMode:true); Vision maxTokens'i 2500-3000'e çıkar ve düz-metin truncation'da da retry uygula; cap gün-sonunu `localDayStartIso` ile türet; `confirmation_no`'yu tam-token mantığına çevir, 'sut' eşleşmesini kelime-sınırlı yap.

---
