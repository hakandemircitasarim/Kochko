# KOCHKO — Tam Özellik Spesifikasyonu v10

## Ürün Özeti

Kochko, kullanıcının kişisel geçmişini, fiziksel durumunu, beslenme tercihlerini, kısıtlarını, günlük kayıtlarını ve hedeflerini bilen bir AI yaşam tarzı koçudur. Klinik teşhis yapmaz; kullanıcı verilerini organize eder, trend çıkarır ve yaşam tarzı önerisi üretir.

Temel fark: Kullanıcı aynı şeyi her gün tekrar anlatmaz. Uygulama her şeyi hatırlar, öğrenir ve planı sürekli revize eder.

**Kullanım kısıtı:** 18 yaş altı kullanıcılar kayıt olamaz. Kayıt sırasında doğum yılı doğrulaması yapılır. 18 yaş altı tespit edilirse hesap oluşturulmaz, kullanıcı "bu uygulama 18 yaş ve üzeri içindir" mesajıyla yönlendirilir. Gelecekte ebeveyn onayı ile 16-17 yaş aralığı açılabilir.

---

## BÖLÜM 1: KİMLİK DOĞRULAMA VE HESAP SİSTEMİ

### 1.1 Kayıt Yöntemleri

Üç kayıt seçeneği sunulur:

- Google ile giriş
- Apple ile giriş (iOS öncelikli)
- E-posta + şifre (klasik)

E-posta+şifre tercih edenlere şu anda e-posta doğrulaması gönderilir. Hesap doğrulanmadan tam kullanıma geçilemez; kullanıcı sadece onboarding formunu doldurabilir, plan üretilemez.

### 1.2 Oturum Yönetimi

- Oturum token'ı 30 gün geçerli, her aktif kullanımda yenilenir
- "Beni hatırla" varsayılan olarak açık
- Şüpheli giriş tespitinde e-posta bildirimi
- Şifre sıfırlama: e-posta ile, link 1 saat geçerli

### 1.3 Çoklu Cihaz Desteği

- Kullanıcı aynı hesapla birden fazla cihazdan giriş yapabilir (telefon + tablet + web)
- Aynı anda birden fazla oturum açık olabilir
- Veriler gerçek zamanlı senkronize edilir
- Çakışma yönetimi: Veri tipine göre farklı strateji uygulanır (bkz. Bölüm 11.3)
- Aktif oturumlar Ayarlar > Güvenlik ekranında listelenir, kullanıcı uzaktan oturum kapatabilir
- **Eşzamanlı AI sohbet:** Kullanıcı aynı anda iki cihazdan AI ile sohbet edemez. İlk aktif sohbet oturumu geçerlidir; ikinci cihazdan sohbet açılırsa "Başka cihazda aktif sohbetin var, oradan devam et veya bu cihaza taşı" mesajı gösterilir. Sohbet oturumu hesap bazlıdır, cihaz bazlı değil. **Oturum timeout:** Kullanıcı bir cihazda sohbeti açık bırakıp 15 dakika etkileşim yapmazsa sohbet oturumu otomatik serbest kalır ve diğer cihazdan açılabilir hale gelir. Timeout süresi kullanıcıya gösterilmez, arka planda çalışır.
- **Plan durumu senkronizasyonu:** Plan görüntülenme, onaylanma ve değiştirilme durumları da cihazlar arası senkronize edilir. Telefondan onaylanan plan tabletten açıldığında yeniden üretilmez; onaylı haliyle gösterilir.

### 1.4 Hesap Yönetimi

**Hesap silme:**
- Ayarlar > Hesabımı Sil akışı
- Kullanıcıdan onay istenir: "Bu işlem geri alınamaz. Tüm verileriniz 30 gün sonra kalıcı olarak silinir."
- 30 günlük geri alma süresi: kullanıcı bu süre içinde tekrar giriş yaparsa hesap aktif edilir
- 30 gün sonra tüm veriler kalıcı silinir (KVKK/GDPR gereği)

**Hesap bilgisi değiştirme:**
- Kullanıcı Ayarlar > Hesap ekranından e-posta adresini değiştirebilir. Yeni e-posta doğrulaması gerekir.
- Giriş yöntemi değiştirme/ekleme: Google ile kayıt olan kullanıcı sonradan Apple hesabını da bağlayabilir (account linking). Kullanıcı birden fazla giriş yöntemini aynı hesaba bağlayabilir; istediğini kaldırabilir (en az biri aktif kalmalı).
- Şifre değiştirme: E-posta+şifre kullanıcıları için Ayarlar > Güvenlik ekranında.

---

## BÖLÜM 2: KULLANICI PROFİLİ VE VERİ KATMANI

### 2.1 Sabit Profil Verileri

Aşağıdaki bilgiler kullanıcı profilinde sürekli tutulur ve her biri ayrı ayrı düzenlenebilir:

**Fiziksel veriler:**
- Boy
- Kilo (başlangıç kilosu, profil verisi olarak)
- Doğum yılı (yaş hesaplanır, ham doğum yılı saklanır)
- Cinsiyet
- Yağ oranı — AI nasıl ölçebileceğini açıklar: kaliper, biyoimpedans tartı, görsel yüzde karşılaştırma
- Kas oranı
- Bel çevresi ve diğer opsiyonel ölçümler (kalça, göğüs, uyluk)

**Beslenme tercihleri:**
- Sevdiği yemekler listesi
- Sevmediği/asla yemem dediği yemekler listesi
- Yapabildiği yemekler listesi
- Toleranslar ve alerjiler (laktoz, gluten, fıstık, vb.)
- Bütçe aralığı (düşük / orta / yüksek)
- Yemek yapma becerisi (hiç / basit / iyi)
- Favori öğün şablonları (kullanıcının sık yediği kombinasyonlar, tek dokunuşla tekrar girilebilir)
- Diyet modu: Standart (varsayılan) / Düşük karbonhidrat / Ketojenik / Yüksek protein — kullanıcı seçer, AI buna göre makro dağılımını ayarlar. Onboarding'de sorulmaz; varsayılan Standart olarak başlar, AI ilk sohbette bunu sorar.
- **Yeme penceresi / IF modu:** Kullanıcı aralıklı oruç uyguluyorsa pencere tipi seçilir (16:8, 18:6, 20:4, özel saat aralığı). AI tüm öğün önerilerini bu pencereye sığdırır; pencerenin dışına denk gelen öğün hatırlatmaları gönderilmez. Aktif IF modu profil dashboard'ında her zaman görünür.
- **Meal prep tercihi:** Kullanıcı toplu hazırlık yapıyor mu? Evet ise hangi gün(ler)? (bkz. Bölüm 7.6)
- **Alkol tercihi:** Kullanıcı alkol tüketiyor mu? Sıklığı nedir (hiç / nadiren / haftalık / sık)? Bu bilgi AI'ın hafta sonu sapma analizinde ve kalori planlamasında kullanılır.

**Makro hedef tercihi:**
- Protein hedefi hesaplanır: vücut ağırlığının 1.6-2.2g/kg aralığında, aktivite ve hedefe göre AI belirler
- Karbonhidrat ve yağ: seçilen diyet moduna göre AI varsayılan dağılım önerir, kullanıcı onaylar
- Varsayılan dağılım (Standart modda): Protein %30, Karbonhidrat %40, Yağ %30
- Kullanıcı ileride bu dağılımı özelleştirebilir
- Kalori hedefi tek rakam değil aralık olarak verilir (örn: 1600-1800 kcal)
- **Antrenman/dinlenme günü ayrımı:** AI antrenman günleri için daha yüksek, dinlenme günleri için daha düşük kalori aralığı belirler (bkz. Bölüm 2.4)

**Sağlık geçmişi:**
- Kilo verme geçmişi (zaman çizelgesi: "şu yaşta şu kilodaydım")
- Geçmiş ameliyatlar, sakatlıklar, önemli sağlık olayları (metin + tarih)
- Genel sağlık sorunları
- Fiziksel engeller
- Kullandığı ilaçlar — AI bunlarla etkileşim konusunda genel bilgi verebilir ama kesin yorum yapmaz, doktora yönlendirir
- Kan sonuçları — AI hangi tahlillerin gerekli olduğunu söyleyebilir

**Yaşam tarzı:**
- Genel hayat akışı (çalışma saatleri, vardiyalı mı, öğrenci mi, vb.)
- Uyku düzeni (kaçta yatar, kaçta kalkar)
- Öğün düzeni (günde kaç öğün, hangi saatlerde)
- Hobiler
- Aktivite seviyesi (sedanter / hafif / orta / aktif)
- **Saat dilimi:** Telefonun timezone'u otomatik algılanır. Kullanıcının profil timezone'u (ev) ve aktif timezone'u (anlık) ayrı ayrı saklanır (bkz. Bölüm 2.5)

**Birim ve dil tercihleri:**
- Ölçü birimi tercihi: Metrik (kg, cm, L, g) / Imperial (lb, ft, oz, fl oz) — varsayılan metrik
- Porsiyon dili tercihi: Kullanıcı "gram cinsinden" mi yoksa "su bardağı, çay kaşığı, avuç" gibi günlük ifadelerle mi konuşmak istiyor? AI tüm çıktılarında bu tercihe uyar.
- Bu tercih AI'ın plan çıktısını, kayıt onay mesajlarını ve tarif formatını doğrudan etkiler

**Spor bilgileri:**
- Yapamadığı sporlar (sakatlık, engel nedeniyle)
- Yapmayı sevdiği sporlar
- Ekipman erişimi (ev / spor salonu / ikisi)
- **Antrenman stili tercihi:** Kardiyo ağırlıklı / Ağırlık/güç ağırlıklı / Karma — bu tercih güç takip mekanizmasının aktif olup olmayacağını belirler

**Hedefler (ayrıca bkz. Bölüm 6: Hedef Motoru):**
- Hedefin genel ne olduğu
- Kısıt modu seçimi (sürdürülebilir / agresif)
- Hedef önceliği (hızlı kilo kaybı / sürdürülebilir disiplin / güç-kondisyon / kas kazanımı / sağlık marker'ları)

**Sık gidilen yemek mekanları:**
- Kullanıcının kaydettiği restoran, kafeterya veya fast food mekanları listesi
- Her mekan için kullanıcı tarafından onaylanan veya AI tarafından öğrenilen makro tahminleri saklanır
- AI sohbet sırasında "Simit Sarayı'na gittim" denildiğinde bu hafızayı otomatik kullanır
- Kullanıcı bir mekana ilk kez gittiğinde AI tahmini verir ve onay ister; onaylanan değer o mekana atanır

**Kadın kullanıcılara özel:**
- Menstrüel döngü takibi (opsiyonel)
- Döngü fazına göre beslenme ve antrenman ayarlaması:
  - **Foliküler faz (menstrüasyon sonu → ovülasyon):** Enerji seviyesi yüksek, karbonhidrat toleransı daha iyi. AI bu dönemde yoğun antrenmanları ve karbonhidrat ağırlıklı öğünleri ön plana çıkarır.
  - **Ovülasyon civarı:** Güç performansı zirve yapabilir. AI ağırlık antrenmanında PR denemesi gibi yoğun hedefler koyabilir.
  - **Lüteal faz (ovülasyon → menstrüasyon):** İştah artar, su tutulumu olabilir, enerji düşer. AI kalori tabanını 100-200 kcal yükseltebilir, tartı artışını su tutulumu olarak değerlendirir, kullanıcıyı tartı artışıyla ilgili sakinleştirir.
  - **Menstrüel faz (ilk birkaç gün):** Enerji en düşük seviyede olabilir. AI antrenman yoğunluğunu düşürür, minimum viable day moduna daha kolay geçer.
- AI bu ayarlamaları döngü verisi girildiğinde otomatik yapar; kullanıcıya neden ayarlama yaptığını kısaca açıklar.

**İletişim tercihi:**
- Koçun iletişim tonu: Sert koç / Dengeli / Yumuşak destekleyici
- Bu tercih kullanıcı tarafından seçilebilir veya AI kullanıcının tepkilerinden otomatik öğrenebilir
- Kullanıcı istediği zaman Ayarlar > Koç Tonu ekranından tonu manuel olarak sıfırlayabilir. AI'ın otomatik öğrendiği ton ayarı, manuel sıfırlamadan sonra sıfırdan başlar (bkz. Bölüm 4.2)

### 2.2 Profil Doldurma Stratejisi

- Kullanıcıya "ne kadar doldurursan o kadar iyi sonuç alırsın" açıkça söylenmeli
- Minimum zorunlu veri: boy, kilo, doğum yılı, cinsiyet, hedef — bunlar olmadan ilk plan üretilemez
- Diğer tüm alanlar zaman içinde yavaş yavaş doldurulabilir
- AI sohbet sırasında bu bilgileri agresif olarak öğrenmeye çalışır ve kendisi doldurur
- Kullanıcı "diz ameliyatı oldum 2022'de" dediğinde AI bunu otomatik profil verisine yazar
- Profil tamamlanma yüzdesi kullanıcıya gösterilmeli

### 2.3 Profil Erişimi ve Düzenleme

- Tüm profil verileri kullanıcının erişiminde olur
- Kullanıcı her bilgiyi tek tek düzenleyebilir, ekleyebilir, çıkarabilir
- AI de konuşma sonrasında profil verisini değiştirebilir/güncelleyebilir
- AI bir profil verisi değiştirdiğinde kullanıcıya bildirim gider: ne değişti, neden değişti
- Kullanıcı AI'ın yaptığı değişikliği onaylayabilir veya geri alabilir
- **Katman 2 düzeltme/silme hakkı:** Kullanıcı "benim hakkımda ne biliyorsun?" diye sorduğunda AI, Katman 2 özetini anlaşılır formatta paylaşır. Kullanıcı bu özetteki spesifik bir notu düzeltme veya silme hakkına sahiptir: "Hafta sonu disiplinim zayıf değil, bunu sil" diyebilir. AI itiraz etmez, notu siler veya düzeltir ve bunu Katman 2'ye kaydeder. Bu KVKK/GDPR "düzeltme hakkı" (Madde 16) ve "silinme hakkı" (Madde 17) kapsamındadır.

### 2.4 TDEE ve Kalori Hesaplama Metodolojisi

**BMR (Bazal Metabolizma Hızı) hesabı — Mifflin-St Jeor formülü:**

- Erkek: BMR = (10 x kilo kg) + (6.25 x boy cm) - (5 x yaş) + 5
- Kadın: BMR = (10 x kilo kg) + (6.25 x boy cm) - (5 x yaş) - 161

**Aktivite çarpanları (TDEE = BMR x çarpan):**

- Sedanter (masa başı, spor yok): 1.2
- Hafif aktif (hafta 1-3 gün hafif aktivite): 1.375
- Orta aktif (hafta 3-5 gün orta aktivite): 1.55
- Aktif (hafta 6-7 gün yoğun aktivite): 1.725
- Çok aktif (fiziksel iş + yoğun spor): 1.9

**Dinamik aktivite çarpanı:** AI zamanla kullanıcının adım verileri, antrenman kayıtları ve genel aktivite kalıbından gerçek aktivite çarpanını refine eder. Profildeki statik seçim (sedanter/hafif/orta/aktif) başlangıç değeridir; AI 2-4 haftalık veri topladıktan sonra bunu kişiselleştirir.

**Antrenman/dinlenme günü kalori ayrımı:**

Tek bir sabit günlük kalori aralığı yerine AI iki farklı aralık belirler:
- **Antrenman günü aralığı:** TDEE bazlı hesaplanan aralık (hedefe göre açık veya fazla)
- **Dinlenme günü aralığı:** Antrenman günü aralığından yaklaşık 200-400 kcal düşük
- Her iki aralığın haftalık toplamı, haftalık kalori bütçesini oluşturur (bkz. Bölüm 2.6)
- Kullanıcı bu ayrımı istemiyorsa tek aralık moduna geçebilir

**TDEE yeniden hesaplama tetikleyicileri:**

AI aşağıdaki durumlarda TDEE'yi otomatik yeniden hesaplar:
- Her 2-3 kg kilo değişiminde (kullanıcı 90 kg'dan 87 kg'a düştüğünde günlük ~70 kcal fark oluşur, bu birikerek platoya neden olabilir)
- Aktivite seviyesi önemli ölçüde değiştiğinde (sedanterden aktife geçiş gibi)
- Plateau tespitinde (bkz. Bölüm 6.5)
- Dönemsel durum değiştiğinde (ramazan, hastalık, vb.)
- AI son TDEE hesaplama tarihini ve o andaki kiloyu Katman 2'ye yazar

**Hamilelik ve emzirme dönemi TDEE ayarlaması:**
- Hamile kullanıcılar için standart kalori açığı formülü uygulanmaz. AI kalori tabanını ve makro hedeflerini hamilelik trimesterine göre ayarlar:
  - 1. trimester: ek kalori gerekmez, standart TDEE
  - 2. trimester: TDEE + ~340 kcal/gün
  - 3. trimester: TDEE + ~450 kcal/gün
- Emzirme döneminde: TDEE + ~400-500 kcal/gün
- Hamilelik/emzirmede agresif kilo kaybı hedefi seçilemez; guardrail devreye girer (bkz. 12.1)
- Bu dönemlerde AI her zaman doktor/diyetisyen takibi önerir ve tıbbi sınır uyarısını daha sık gösterir

**Kalori aralığı genişliği:**

Kalori hedefi tek rakam değil aralık olarak verilir. Aralık genişliği dinamiktir:
- Varsayılan genişlik: TDEE'nin yaklaşık %10'u (1800 TDEE ise 1620-1800 gibi)
- Yeni kullanıcı (ilk 2 hafta): daha geniş aralık (adaptasyon kolaylığı)
- Tutarlı kullanıcı (4+ hafta yüksek uyum): aralık daraltılabilir (hassasiyet artırma)
- Agresif mod: daha dar aralık
- Sürdürülebilir mod: daha geniş aralık
- AI aralık genişliğini kullanıcının davranış tutarlılığına göre zamanla ayarlar

### 2.5 Saat Dilimi ve Seyahat Yönetimi

- Kullanıcının profil timezone'u (ev) ve aktif timezone'u (anlık, telefondan algılanan) ayrı ayrı saklanır
- Telefon timezone'u değiştiğinde AI bunu otomatik algılar
- Timezone değişiminde etkilenen her şey otomatik ayarlanır: öğün saatleri, bildirim zamanlamaları, IF penceresi, uyku kaydı, gün başlangıç/bitiş saati
- **IF modu + timezone çakışması:** Timezone değişiminde IF yeme penceresi kullanıcının hedef timezone'una göre kademeli geçiş yapar. Aynı gün içinde 6+ saat fark oluşursa o gün IF penceresi esnetilir (kullanıcıya bildirilir: "Saat dilimi değişikliği nedeniyle bugün yeme pencerenizi 2 saat genişlettim"). Ertesi günden itibaren yeni timezone'a göre normal pencere uygulanır. Kullanıcı bu geçiş süresini "hemen uygula" veya "kademeli geç" olarak seçebilir.
- Jet lag durumunda: AI ilk 2-3 gün uyku kaydını ve öğün saatlerini geçici olarak esnetir, katı saatlere zorlamaz
- Farklı saat dilimindeki kullanıcı "öğle yemeği" dediğinde yerel saate göre parse edilir
- Seyahat tespitinde AI kısa bir sorgulama yapar: "Seyahatte misin?" Onaylarsa dönemsel durum olarak kaydedilir, plan buna göre ayarlanır
- **Seyahatte bağlamsal mutfak bilgisi:** Seyahat tespit edildiğinde AI, kullanıcının bulunduğu bölgenin mutfak kültürüne göre besin bilgisi kapsamını genişletir. Türkiye'den Japonya'ya giden kullanıcıya ramen, sushi, yakitori gibi yerel yemeklerin makro tahminleri sunulur. AI bu tahminlerde güven göstergesini "Orta" olarak işaretler (yerel mutfak AI'ın birincil uzmanlık alanı olan Türk mutfağına kıyasla daha düşük güvenilirlik). Kullanıcı düzeltme yaptıkça seyahat lokasyonuna özel porsiyon öğrenimi de çalışır.

### 2.6 Haftalık Kalori Bütçesi

Günlük hedef önemlidir ama gerçek hayatta her gün aynı gitmez. Haftalık kalori bütçesi, kullanıcının günlük sapmalarını haftalık perspektiften dengelemesini sağlar:

- **Haftalık bütçe:** Günlük hedef aralığının ortalaması x 7 = haftalık bütçe (örn: günlük 1700 kcal hedefi olan kullanıcının haftalık bütçesi 11.900 kcal)
- **Dengeleme mantığı:** Bir günde 500 kcal fazla yenildiğinde hafta batmaz. AI kalan günlerde 100-150'şer kcal eksilterek haftalık bütçeyi dengeleyebilir. Bu dengeleme AI tarafından otomatik önerilir ama kullanıcı onaylamadan uygulanmaz.
- **Psikolojik değer:** "Bugün bozdum, haftam gitti" düşüncesini kırar. AI bu mesajı aktif olarak verir: "Bugün fazla yedin ama haftalık bütçende hâlâ 800 kcal marjın var, rahat ol."
- **Haftalık raporda:** Günlük uyum puanının yanı sıra haftalık bütçe uyumu da gösterilir
- **Görsel gösterim:** Dashboard'da haftalık bütçe barı, günlük barın yanında ikincil gösterge olarak yer alır
- AI antrenman ve dinlenme günlerinin farklı kalori aralıklarını haftalık bütçe içinde otomatik dengeler

### 2.7 Su Hedefi Hesaplama

Su hedefi sabit bir rakam değil, kişiye ve güne göre dinamik hesaplanır:

**Temel formül:** Vücut ağırlığı (kg) x 0.033 = günlük minimum litre (örn: 70 kg = 2.3L, 90 kg = 3.0L)

**Dinamik ayarlamalar:**
- Antrenman günlerinde: +0.5-1.0L (antrenman yoğunluğuna göre)
- Sıcak mevsimde (yaz aylarında): AI otomatik +0.3-0.5L ekler
- Kafein tüketimi yüksekse (supplement kaydından tespit): ek su önerisi
- IF modu aktifse: yeme penceresi dışında su tüketiminin önemini AI hatırlatır

**Kullanıcı override:** Kullanıcı su hedefini manuel olarak da ayarlayabilir. AI hesaplaması varsayılan/önerilen değerdir, zorunlu değil.

**Yemekten gelen su katkısı:** Çorba, meyve, salata gibi yüksek su içerikli gıdalar günlük su ihtiyacına katkıda bulunur. AI bu yiyecekleri tespit ettiğinde su hedefini biraz aşağı çekebilir veya "bugün çorba ve meyve yemişsin, su ihtiyacın biraz daha düşük" gibi bağlamsal bilgi verebilir. Bu kesin bir hesaplama değil, yaklaşık bir farkındalıktır.

### 2.8 Gün Sınırı Tanımı (Day Boundary)

Gece geç saatlerde yapılan kayıtların hangi güne ait olduğu tüm sistemi etkiler (gün sonu raporu, haftalık bütçe, IF penceresi, streak):

- **Varsayılan gün sınırı:** 04:00 — bu saatten önce yapılan kayıtlar önceki güne, sonrakiler yeni güne aittir
- **Kişisel gün sınırı:** Kullanıcının uyku saatine göre AI bu sınırı kişiselleştirebilir. Gece 3'te yatan kullanıcı için gün sınırı 05:00'e kayabilir.
- **Kullanıcı override:** Kullanıcı her zaman bir kaydın hangi güne ait olduğunu manuel seçebilir: "Bu dünkü kayıt" veya "bu bugünkü"
- **Etkilenen sistemler:** Gün sonu raporu bu sınıra göre tetiklenir, IF yeme penceresi bu sınıra göre sıfırlanır, streak hesabı bu sınıra göre yapılır, haftalık bütçe günlük dilimleri bu sınırla ayrılır
- Gün sınırı profil verisinde saklanır ve Katman 1'e dahil edilir

---

## BÖLÜM 3: GÜNLÜK KAYIT SİSTEMİ

### 3.1 Kayıt Türleri

**Öğün kaydı:**
- Serbest metin girişi: "Yedim: 2 yumurta, 60g hindi füme, 1 dilim ekmek"
- Barkod okuma: kamera ile paketli ürünün barkodu okutulur, ürün bilgileri ve makrolar otomatik çekilir. Türk ürünleri öncelikli. Barkod sonucu bulunamazsa serbest metin girişine yönlendirilir; bulunamayan barkod arka planda kaydedilir ve ileride veritabanı büyütmek için kullanılır (bkz. Bölüm 19.3).
- Fotoğraf ile giriş: AI fotoğrafı analiz edip öğeleri, porsiyon tahminini ve kalori/makro tahminini çıkarır. Fotoğraf analizi sırasında AI kullanıcının Katman 2'deki porsiyon kalibrasyonunu girdi olarak kullanır (bkz. 5.23).
- Sesli giriş: kullanıcı söyler, AI metne çevirip parse eder
- Favori öğün şablonundan tek dokunuşla giriş
- **Fotoğraf + metin birlikte gönderim:** Kullanıcı fotoğrafla birlikte metin gönderebilir: "bunu yedim ama yarısını bıraktım", "bu 2 kişilikti ben yarısını yedim". Bu durumda AI fotoğrafı analiz eder ve metni bağlam olarak kullanır. Metin fotoğrafın çıktısını override etmez, tamamlar: fotoğraftan içerik, metinden porsiyon/bağlam bilgisi alınır. Çelişki varsa (fotoğraf 1 tabak gösteriyor ama metin "3 tabak yedim" diyor) AI kullanıcının metnini esas alır çünkü fotoğraf tek bir anı temsil eder.
- **Aile/ortak yemek senaryosu:** Kullanıcı "evde güveç yaptım, herkesle birlikte yedim" dediğinde AI tarif bazlı toplam kalori hesaplayıp porsiyon bölmesi yapabilir. "Kaç kişilikti, sen ne kadar yedin?" sorusuyla kişisel porsiyonu belirler. Bu hesaplama tarif modunun uzantısıdır (bkz. Bölüm 5.2 Tarif Modu).
- AI tüm tahminlerin tahmini olduğunu belirtir, kullanıcı her zaman düzeltebilir
- **Pişirme yöntemi farkı:** AI öğün parse ederken pişirme yöntemini de tespit eder veya sorar. Haşlama, ızgara, kızartma, fırın arasında ciddi kalori farkı vardır (ör: 100g haşlama tavuk ~165 kcal, kızartma ~250+ kcal). Kullanıcı sadece "tavuk yedim" derse AI "nasıl pişirilmişti?" diye sorar; cevap yoksa en yaygın pişirme yöntemini varsayar ve güven göstergesi "Orta" olarak işaretler.
- **Fotoğraf analizi fallback:** Fotoğraf bulanık, karanlık veya tanınmaz ise AI "Fotoğrafı net analiz edemedim, metin olarak girer misin?" akışına geçer. Yarı tanınabilir fotoğraflarda AI tahminini düşük güven göstergesiyle sunar ve onay ister.
- **Geçmişe dönük kayıt (batch entry):** Kullanıcı "dün kayıt giremedim" veya "önceki günün öğünlerini gireyim" dediğinde AI geçmişe kayıt ekleme akışını başlatır. Kullanıcı tarih seçer, kayıtları girer. Geçmişe eklenen kayıtlar o günün raporunu ve haftalık bütçeyi geriye dönük günceller. AI "dün de aynısını yedim" gibi kısayolları destekler. **Geçmişe dönük kayıt + haftalık bütçe etkileşimi:** Geçmiş bir haftaya kayıt eklendiğinde o haftanın raporları ve bütçe uyumu geriye dönük güncellenir. Ancak o haftada AI'ın yapmış olduğu dengeleme önerileri yeniden hesaplanmaz (geçmişe müdahale edilmez). AI durumu fark eder ve yorum yapabilir: "Geçen haftanın kayıtları güncellendi, gerçekte haftalık bütçeyi tutturmuşsun."

**Spor kaydı:**
- Serbest metin: "Yaptım: yürüyüş bandı 35 dk, orta tempo"
- Tip, süre, yoğunluk otomatik parse edilir
- **Güç/ağırlık antrenmanı kaydı:** Kullanıcı set-rep-ağırlık kaydedebilir. Örnek: "squat 3x8 70kg", "bench press 4x6 60kg". AI her hareketi ayrı ayrı takip eder. Kullanıcı antrenman stili tercihinde "ağırlık ağırlıklı" seçmişse bu kayıt tipi ön plana çıkar.
- **Antrenman sonrası dinamik kalori ayarı:** Kullanıcı planlananın üstünde veya altında egzersiz yaptığında AI günlük kalori aralığını buna göre revize eder (fazla spor yapıldıysa kalori tavanı yukarı çekilir, planlanan spor yapılmadıysa gün sonu kapanışta bu dikkate alınır)
- Kullanıcı her kaydı düzenlemeye açık

**Tartı/ölçüm kaydı:**
- Hızlı sayısal giriş (tek dokunuşla kilo girme)
- Bel çevresi ve diğer ölçümler opsiyonel
- Tartı geçmişi grafik olarak görünür
- 1 haftadır girilmemişse AI hatırlatma yapar
- **Saçma giriş kontrolü:** Önceki kayıttan %10+ sapma varsa doğrulama istenir ("85 kg'dan 77 kg'a düşmüşsün, bu doğru mu?"). Bu kontrol tüm sayısal kayıt türlerine uygulanır (bkz. 12.6).

**Su takibi:**
- Ana ekranda her zaman görünür, tek dokunuşla +0.25L buton
- Günlük su hedefi kişisel formülle hesaplanır (bkz. Bölüm 2.7)
- Gün içinde ilerleme barı
- Su azlığında AI uyarı gönderir

**Uyku kaydı:**
- Yatış ve kalkış saati girişi
- Toplam uyku süresi hesaplanır
- Uyku kalitesi opsiyonel (iyi / orta / kötü)
- İleride wearable entegrasyonu ile otomatik çekilebilir

**Supplement/takviye kaydı:**
- Protein tozu, kreatin, vitamin, omega-3, BCAA vb.
- Hatırlatma ve takip
- Diyet planıyla entegrasyon: AI protein tozundan gelen makroları hesaba katar
- **Supplement parse detayları:** AI her supplement türüne göre makro etkisini ayrı değerlendirir:
  - Protein tozu: tam makro etkisi (kalori, protein, karb, yağ) günlük toplama eklenir
  - BCAA: kalori etkisi vardır (~4 kcal/g), günlük toplama eklenir
  - Omega-3 kapsülleri: 2-3g yağ = 18-27 kcal, günlük toplama eklenir
  - Kreatin: kalori etkisi ihmal edilebilir ama sıvı tutulumu tartıyı etkiler. AI kreatin kullanımını Katman 2'ye yazar ve tartı artışını değerlendirirken bunu hesaba katar: "Kreatin kullanmaya başladın, ilk 1-2 haftada 1-2 kg su tutulumu normal"
  - Vitamin/mineral: kalori etkisi yok, sadece takip amaçlı kaydedilir
- Kullanıcı "kreatin aldım" dediğinde AI doğru supplement türünü parse eder ve yukarıdaki kurala göre işler
- **Supplement-ilaç etkileşim farkındalığı:** Kullanıcının hem ilaç kaydı (profilde) hem aktif supplement kaydı varsa, AI bu ikisinin birlikte kullanımı hakkında genel farkındalık sunar. AI kesin etkileşim yorumu yapmaz ama "Hem kreatin hem böbrek ilacı kullandığını görüyorum, bu kombinasyonu doktorunla konuşmanı öneririm" gibi uyarılar verir. Bu kontrol, yeni bir supplement veya ilaç kaydedildiğinde otomatik tetiklenir.

**Stres/ruh hali kaydı:**
- Hızlı mood tracker: 1-5 skala veya emoji seçimi
- Opsiyonel serbest metin notu: "bugün çok stresliydim"
- AI stres-yeme korelasyonunu bu veriden çıkarır

**Toparlanma/recovery kaydı (opsiyonel):**
- Güç antrenmanı yapan kullanıcılar için: kas ağrısı seviyesi (yok / hafif / orta / şiddetli) ve genel toparlanma hissi (1-5 skala)
- AI bu veriyi antrenman planlama kararlarında kullanır: şiddetli kas ağrısı varsa aynı kas grubuna yoğun antrenman planlamaz, hafif mobilite/aktif dinlenme önerir
- Wearable bağlandığında HRV (kalp atış değişkenliği) verisi otomatik çekilir ve toparlanma durumu objektif olarak değerlendirilir (bkz. 14.1)
- Bu kayıt türü antrenman stili tercihi "ağırlık/güç ağırlıklı" veya "karma" olan kullanıcılara gösterilir; diğerlerine görünmez
- AI toparlanma-performans korelasyonunu izler ve Katman 2'ye yazar

**Alkol kaydı:**
- Serbest metin: "İçtim: 2 bira, 1 kadeh şarap"
- AI alkol türü ve miktarından kalori hesaplar (alkol gram başına 7 kcal, ayrıca içecek türüne göre karbonhidrat eklenir)
- Alkol kalorisi günlük kalori toplamına dahil edilir ancak makro dağılımında ayrı gösterilir (protein/karbonhidrat/yağ/alkol olarak 4'lü gösterim)
- AI alkol-yeme korelasyonunu izler: alkol tüketimi sonrası plansız atıştırma kalıbı varsa tespit eder
- Haftalık raporda alkol kaynaklı kalori ayrı bir satır olarak raporlanır
- AI asla ahlaki yargıda bulunmaz; sadece veri temelli olarak günlük hedefe etkisini gösterir

**İlerleme fotoğrafı:**
- Kullanıcı opsiyonel olarak vücut fotoğrafı ekleyebilir
- Fotoğraflar sadece kullanıcının cihazında veya şifreli bulut depolamada tutulur, AI analizine gönderilmez
- NOT: Bu, öğün kaydındaki fotoğraf ile girişten farklıdır. Öğün fotoğrafları AI'a gönderilip analiz edilir; ilerleme fotoğrafları ise yalnızca kullanıcının kendi görsel takibi içindir ve hiçbir zaman AI'a veya üçüncü tarafa iletilmez.
- Kullanıcı aynı açıdan karşılaştırmalı görüntüleme yapabilir (tarih seçerek yan yana)
- Yüz otomatik bulanıklaştırma seçeneği paylaşım öncesi sunulur
- Fotoğraflar hiçbir zaman üçüncü tarafla paylaşılmaz

**Adım kaydı:**
- Telefon yerleşik sensöründen (akselerometre/pedometre) otomatik adım verisi çekilir — wearable gerekmez
- iOS'ta Core Motion, Android'de Activity Recognition / Sensor API kullanılır
- Wearable bağlıysa wearable verisi öncelikli olur
- Kullanıcı adım hedefi koyabilir, AI bu veriyi günlük aktivite hesabında kullanır
- Manuel giriş de desteklenir (örn: telefonsuz yürüyüş sonrası)

**Genel not:**
- Serbest metin: "bugün çok yorgunum", "iş toplantısı uzadı", vb.
- AI bu notları bağlam olarak kullanır

### 3.2 Kayıt Düzenleme ve Silme

- Kullanıcı tüm kayıtlarını kendisi düzenleyebilir, ekleyebilir, çıkarabilir
- AI de kayıt ekleyebilir/düzenleyebilir
- AI yaptığı her değişimde kullanıcıya değişim sebeplerini ve ne değiştirdiğini yazar
- Değişiklik geçmişi tutulur
- **Kayıt silme ve geri alma:** Kayıt silme işlemi anında gerçekleşmez; kullanıcıya 10 saniyelik "Geri Al" penceresi gösterilir (toast notification). Bu sürede tıklanmazsa silme kesinleşir. Silinen kaydın günlük/haftalık toplamları ve raporlar otomatik güncellenir. AI silme işlemini fark eder ve gerekirse yorum yapar ("Öğle kaydını sildin, günlük kalori toplamı güncellendi").

### 3.3 Besin Verisi ve Kalori Tahmini

**Tahmin sırası (öncelik sırasına göre):**

1. Barkod veri tabanı eşleşmesi (en güvenilir)
2. Kullanıcının geçmiş düzeltmeleri (ikinci en güvenilir)
3. Kayıtlı mekan verisi (kullanıcının o mekana atanmış önceki onaylı değerleri)
4. AI tahmini (serbest metin veya fotoğraf)

**Güven göstergesi:** Her tahmin bir güven seviyesiyle birlikte gösterilir — Yüksek / Orta / Düşük. Barkod eşleşmesi her zaman "Yüksek", AI fotoğraf tahmini "Düşük" veya "Orta" olarak işaretlenir. Güven seviyesi düşükse kullanıcıdan onay istenir. Bu gösterge kullanıcı arayüzünde basit bir ikon veya renk koduyla ifade edilir; modal açmaz.

- Tüm tahminlerin tahmini olduğu her zaman belirtilir
- Kullanıcı düzeltme yaptığında AI bunu öğrenir: "karnıyarık 350 değil 500 kalori" diye her düzelttiğinde AI bir sonraki seferde 500 baz alır
- Kullanıcının "1 tabak" dediği şeyin porsiyon büyüklüğü zamanla kullanıcı düzeltmelerinden öğrenilir
- İleride topluluk kaynaklı Türk yemekleri veritabanı entegrasyonu — bkz. Bölüm 19
- **Alkol kalorisi hesabı:** Alkol saf olarak 7 kcal/g'dır. AI içecek türüne göre hem alkol hem karbonhidrat kalorisini ayrı hesaplar: bir bira ~150 kcal (alkol + karb), bir kadeh şarap ~120 kcal, bir tek rakı ~100 kcal (neredeyse tamamı alkol). Bu hesaplar AI'ın yerleşik bilgisinden yapılır, barkod gibi kesin kaynak varsa o öncelikli olur.

**AI belirsizlik yönetimi:** Egzotik yemekler, bölgesel/yöresel tarifler veya çok karmaşık yemekler için AI güvenilir tahmin üretemeyebilir. Bu durumda AI dürüstçe "Bu yemeğin kalorisini güvenilir şekilde tahmin edemiyorum" der ve kullanıcıya şu seçenekleri sunar: (a) yaklaşık gram ve malzeme bilgisi verirsen hesaplarım, (b) benzer bildiğim bir yemeğe kıyasla tahmin yapabilirim, (c) sen biliyorsan manuel gir. Güven göstergesi "Düşük" olarak işaretlenir. AI kesin bilmediği bir şeyi kesinmiş gibi sunmaz.

### 3.4 Favori Öğün Şablonları

- Kullanıcı sık yediği kombinasyonları kaydedebilir: "Kahvaltı klasiğim", "İş yemeği standart", vb.
- Tek dokunuşla tekrar girebilir
- AI de sık tekrar eden öğünleri tespit edip şablon önerebilir: "Her sabah aynısını mı yedin?" diye sorabilir

### 3.5 Kayıt Sürtünmesini Azaltma Prensipleri

- Her kayıt türü maksimum 1 dakikada girilebilmeli
- Serbest metin, barkod, fotoğraf ve sesli giriş seçenekleri her zaman mevcut
- Su takibi tek butonla
- Favori öğünler tek dokunuşla
- Offline kayıt her zaman mümkün (bkz. Bölüm 11)

---

## BÖLÜM 4: KOCHKO KOÇUN KİMLİĞİ VE PERSONASI

### 4.1 Kim/Ne Olduğu

Kochko bir AI koçtur. Uygulama bunu kullanıcıdan gizlemez; aksine onboarding'de açıkça belirtir. Persona şu ilkelere dayanır:

- Koçun adı uygulamada görünmez; kullanıcı "Koç" veya "Kochko" olarak adresleyebilir
- Ton: doğrudan, veri temelli, abartısız. Ne aşırı sevecen ne de robotik
- Motivasyon dilinde abartı yok: "Harika!" yerine "Bugün proteini tutturmuşsun, iyi."
- Koç kendini insan olarak tanıtmaz; "Ben Kochko, yapay zeka destekli koçun" der
- Emoji kullanımı minimumda tutulur, sohbet diline göre ayarlanır

### 4.2 Ton Seçenekleri

Kullanıcı üç ton arasından seçer; AI bu tercihe göre yanıt stilini değiştirir:

- **Sert koç:** kısa, direkt, "haydi, bugün neden spor yapmadın?" tarzı
- **Dengeli:** veri temelli, ama insani. Varsayılan bu.
- **Yumuşak/destekleyici:** daha uzun, daha empati içeren yanıtlar

AI zamanla kullanıcıyı tanıdıkça tonu ince ayarlar — bkz. Bölüm 5.9.

**Manuel sıfırlama:** AI'ın öğrendiği ton, kullanıcının başta seçtiği tondan sapabilir. Kullanıcı bu durumu fark ettiğinde Ayarlar > Koç Tonu ekranında "Tonu sıfırla" butonu bulunur. Sıfırlama sonrası AI başlangıç tercihine döner ve öğrenme sıfırdan başlar. AI bu sıfırlamayı Katman 2 özetine yazar: "Kullanıcı tonu [tarih] itibarıyla manuel olarak sıfırladı."

### 4.3 İlk Tanışma

Onboarding'de AI şu şekilde tanışır:
"Merhaba. Ben Kochko, yapay zeka destekli koçun. Sana özel beslenme ve antrenman planları üreteceğim. Ne kadar çok bilgi verirsen önerilerim o kadar isabetli olur. Başlayalım."

Kısa, özlü, gereksiz selamlama yok.

---

## BÖLÜM 5: AI SİSTEMİ — MİMARİ VE DAVRANIŞ

### 5.1 Hafıza Mimarisi

AI her sohbette tüm geçmişi okuyamaz (context window sınırı). Katmanlı hafıza sistemi:

**Katman 1 — Sabit Profil (her zaman gönderilir):**
- Bölüm 2'deki tüm profil verileri
- Aktif hedefler ve tempo
- Aktif dönemsel durum (tatil, ramazan, hastalık, vb.)
- İletişim tonu tercihi
- Makro mod ve hedef dağılımı
- IF modu ve yeme penceresi (aktifse)
- Aktif timezone

**Katman 2 — AI Özeti (her zaman gönderilir):**
- AI'ın kullanıcı hakkında yazdığı genel özet
- Tespit edilen kalıplar ve davranış paternleri
- Önemli olaylar (büyük kilo değişimleri, dönemsel değişimler, sapma dönemleri, plateau dönemleri)
- AI'ın o kullanıcı için belirlediği özel takip kıstasları (bkz. 5.8)
- Geçmiş dönemsel durumlar özeti (tatil notları, ramazan deneyimi, vb.)
- Koçluk stili notları: hangi mesaj tarzı bu kullanıcıda işe yarıyor
- Kullanıcıya özel kalori/porsiyon düzeltme geçmişi özeti
- **Porsiyon kalibrasyonu:** Kullanıcının "1 tabak" = yaklaşık X gram bilgisi (bkz. 5.23)
- Ton sıfırlama geçmişi (manuel override yapılmışsa tarih ve bağlamı)
- Güç antrenmanı yapıyorsa son onaylı 1RM tahminleri ve progresyon özeti
- Kullanıcı segment/persona notu (bkz. 5.15)
- Temel mikro besin risk sinyalleri (bkz. 5.16)
- Alkol tüketim kalıbı özeti (varsa): sıklık, korelasyonlar, toplam kalori etkisi
- Son TDEE hesaplama tarihi ve o andaki kilo
- **Haftalık kalori bütçe performans özeti:** Son 4 haftanın haftalık bütçe uyumu
- **Supplement notları:** Aktif kullanılan supplementler ve etkileri (kreatin = sıvı tutulumu, vb.)
- **Supplement-ilaç etkileşim notları:** Aktif supplement ve ilaç kombinasyonlarına dair farkındalık notları
- **Beslenme okuryazarlık seviyesi:** AI'ın kullanıcının temel beslenme kavramlarını ne kadar bildiğine dair tespiti (bkz. 5.31)
- **Kafein-uyku korelasyon notu:** Kafein tüketim kalıbı, son kafein saati ile uyku kalitesi ilişkisi (bkz. 5.34)
- **Sosyal yeme kalıpları:** Hangi sosyal ortamlar sapma tetikliyor, sıklık ve bağlam (bkz. 5.2 Dışarıda Yemek Modu)
- **Alışkanlık ilerleme durumu:** Hangi mikro-alışkanlıklar oturtuldu, sıradaki hedef (bkz. 5.35)
- **Sohbet onarım sıklığı:** Hangi yemek/ifade türlerinde sık parse hatası oluşuyor (bkz. 5.32)
- **Tanıtılan özellikler listesi:** AI'ın progressive disclosure kapsamında kullanıcıya tanıttığı özellikler (bkz. 5.33)
- **Toparlanma kalıbı:** Güç antrenmanı yapan kullanıcılarda kas ağrısı ve toparlanma süresi kalıpları

**Katman 3 — Son 7-14 gün verileri (her zaman gönderilir):**
- Öğün kayıtları ve makro trend
- Antrenman kayıtları (kardiyo ve güç ayrı ayrı)
- Tartı/ölçüm kayıtları
- Su, uyku, stres kayıtları
- Toparlanma/recovery kayıtları (aktifse)
- Alkol kayıtları
- Adım verileri
- Son plan ve revizyonlar

**Katman 4 — Aktif sohbet geçmişi:**
- Mevcut oturumdaki mesajlar

**Özet güncelleme mekanizması:**
- AI her konuşmadan sonra Katman 2'yi güncellemeye karar verebilir
- Önemli bilgi öğrendiğinde, kalıp tespit ettiğinde veya dönemsel değişim olduğunda özeti yazar
- Özet kullanıcıya doğrudan gösterilmez ama kullanıcı "benim hakkımda ne biliyorsun?" diye sorabilir; AI bu özeti dönüştürerek anlaşılır formatta paylaşır
- Kullanıcı Katman 2'deki spesifik notları düzeltme veya silme hakkına sahiptir (bkz. 2.3)
- **Sohbet silme ve Katman 2 ilişkisi:** Kullanıcı sohbet geçmişini sildiğinde (bkz. 5.18) Katman 2 notları silinmez. Sohbet ve AI özeti farklı veri katmanlarıdır; sohbet silinse bile AI'ın o sohbetten öğrendiği profil çıkarımları, kalıplar ve notlar Katman 2'de kalır. Kullanıcı Katman 2'den spesifik bir notu silmek istiyorsa bunu ayrıca talep etmelidir (bkz. 2.3). Bu davranış kullanıcıya sohbet silme ekranında açıkça belirtilir: "Sohbet geçmişi silinir ancak koçun senden öğrendikleri korunur."

**Token bütçeleme ve budama stratejisi:**

Context window sınırlı olduğu için her katmanın token bütçesi oran bazlı belirlenir. Bu sayede model değiştiğinde bütçeler otomatik ölçeklenir:

- **Toplam bütçe:** Kullanılan LLM'in context window'unun %65'i (geri kalan %35 AI yanıtı, tool call overhead'leri ve güvenlik marjı için ayrılır)
- **Katman 1 (Profil):** Toplam bütçenin %15'i — profil verisi yapılandırılmış formatta (JSON benzeri) gönderilir, serbest metin değil
- **Katman 2 (AI Özeti):** Toplam bütçenin %10'u — AI özeti belirli bir uzunluk sınırı içinde tutulur, özet büyüdükçe AI eski/düşük öncelikli notları sıkıştırır veya siler (bkz. Katman 2 yaşam döngüsü aşağıda)
- **Katman 3 (Son 14 gün):** Toplam bütçenin %25'i — çok aktif kullanıcılarda veri hacmi bunu aşabilir; bu durumda: (a) 14 gün yerine 7 güne düşürülür, (b) detaylı öğün kayıtları yerine günlük özet kullanılır, (c) AI tarafından yapılmış günlük makro toplamları gönderilir, teker teker öğün değil
- **Katman 4 (Sohbet):** Kalan bütçe kadar — uzun sohbetlerde eski mesajlar özetlenip sıkıştırılır

Bütçeyi aşma riski olduğunda Katman 3 ilk budanan katmandır çünkü özeti Katman 2'de zaten mevcuttur.

**Katman 2 yaşam döngüsü ve sıkıştırma stratejisi:**

Uzun vadeli kullanıcılarda Katman 2 sürekli büyür. Bu büyümeyi yönetmek için:
- **Kalıcı notlar (asla silinmez):** Profil çıkarımları, alerjenler, temel davranış kalıpları, porsiyon kalibrasyonu, 1RM değerleri, sağlık kısıtları
- **Dönemsel notlar (sıkıştırılır):** Geçmiş dönemlerin detayları zamanla özetlenir. "Ramazan 2025'te ilk hafta 2kg aldı, sonraki 3 haftada geri verdi, iftar öğünlerinde protein düşük kaldı" → 6 ay sonra: "Ramazanda kilo kontrolü orta düzeyde, protein dikkat gerektiriyor"
- **Güncel notlar (aktif tutulur):** Son 4 haftanın kalıp tespitleri, aktif dönemsel durum, aktif hedefle ilgili gözlemler
- **Sıkıştırma tetikleyicisi:** Katman 2 token bütçesinin %90'ına ulaştığında AI en eski dönemsel notları sıkıştırır
- **Yıllık özet:** 1 yıl+ kullanıcılar için AI yıllık macro-level özet yazar ("2025 genel görünüm: 8kg verildi, 2kg geri alındı, hafta sonu disiplini zayıf...") ve o yılın detay notlarını siler

**Referans değerler (Claude 200k context için, %65 bütçeyle):**
- Katman 1: ~19.500 token
- Katman 2: ~13.000 token
- Katman 3: ~32.500 token
- Katman 4: kalan (~65.000 token)
- AI yanıtı + overhead için: ~70.000 token

### 5.2 AI Görev Modları

AI farklı durumlarda farklı davranır. Her mod için LLM parametreleri (temperature vb.) ayrıca tanımlanmıştır (bkz. 5.24).

**Kayıt Asistanı Modu:**
- Tetikleyici: "yedim:", "yaptım:", "içtim:", fotoğraf gönderme, barkod okutma
- Davranış: kısa ve hızlı, kaydı al, kalori/makro tahminini göster, tek cümle yorum
- Yapmaması gereken: 3 paragraf motivasyon konuşması, uzun analiz
- Örnek çıktı: "Kaydettim: 420 kcal, 32g protein. Bugünkü proteinin şu an 65g, hedefe yakınsın."
- **Sessizlik kuralı:** Basit, sorunsuz kayıtlarda AI sadece onay verir ve günlük durumu özetler. Ek yorum ancak dikkat çeken bir durum varsa yapılır: günlük bütçenin %80'ine ulaşılmışsa, protein hedefinin çok gerisindeyse, bir guardrail tetiklenmişse, ya da bir kalıp tespiti yapılmışsa. Aksi halde kısa onay yeterlidir.

**Plan Yapıcı Modu:**
- Tetikleyici: günlük plan üretimi, haftalık revizyon, kullanıcının plan istemesi
- Davranış: profil + son 14 gün verisi + hedef motoru verisiyle detaylı plan üretir
- Öğün seçenekleri (2-3 alternatif), antrenman planı, günlük hedefler
- Her önerinin kısa gerekçesi erişilebilir olmalı (sebep butonu)
- **Alerjen filtresi:** Plan üretimi sırasında kullanıcının profildeki alerji/intolerans bilgisi guardrail olarak uygulanır — AI asla alerjen içeren yemek/tarif önermez (bkz. 12.4)
- **Besin zamanlaması (Nutrient Timing):** AI plan üretirken sadece günlük toplam makroyu değil, öğünlere dağılımı da optimize eder. Özellikle güç antrenmanı yapan kullanıcılar için: antrenman öncesi (1-2 saat) karbonhidrat ağırlıklı öğün, antrenman sonrası (30-60 dk) protein ağırlıklı öğün planlanır. Protein dağılımı öğünlere mümkün olduğunca eşit bölünür (3x30g, 1x90g'dan daha etkilidir). AI bu zamanlama optimizasyonunu kullanıcının antrenman saatine ve öğün düzenine göre otomatik yapar; kullanıcıya karmaşık tablo değil basit öğün önerileri olarak sunar.

**Koçluk Modu:**
- Tetikleyici: proaktif mesajlar, gün sonu kapanış, motivasyon anları
- Davranış: insani, bağlamsal, kullanıcının ton tercihine göre
- Veri temelli ve operasyonel: "Şu an protein hedefinin altında gidiyorsun, akşama şunu koy"
- Abartı motivasyon dili yok

**Analist Modu:**
- Tetikleyici: rapor isteme, trend sorma, "bu hafta nasıl gitti?" gibi sorular
- Davranış: sayısal, grafiklerle destekli, net
- Sapma nedenlerini sınıflandırır: stres, açlık yönetimi, dışarıda yemek, plansız atıştırma, alkol

**Soru-Cevap Modu:**
- Tetikleyici: "avokadoda kaç kalori var?", "kreatin ne işe yarar?" gibi bilgi soruları
- Davranış: direkt ve kısa cevap
- Tıbbi sınırı bilir (bkz. 5.6)

**Tarif Modu:**
- Tetikleyici: "akşama ne pişireyim?", "protein ağırlıklı tarif ver"
- Davranış: kullanıcının sevdiği/sevmediği yemekleri, yapabilme becerisini, bütçeyi ve günlük kalan makro hedefini dikkate alarak tarif verir
- **Aile/ortak yemek desteği:** "Ailem için pişiriyorum" senaryosunda AI toplam tarif kalorisini hesaplayıp porsiyon bazlı bölme önerir
- **Alerjen filtresi aktif:** Tarif önerileri her zaman profildeki alerji/intolerans bilgisine göre filtrelenir — guardrail seviyesinde (bkz. 12.4)
- **Malzeme ikamesi (substitution):** Kullanıcı "evde tavuk yok, ne koyabilirim?" dediğinde AI mevcut tarifin malzemesine uygun ikame önerir (tavuk → hindi, tofu, balık vb.) ve ikame sonrası makro değerlerini yeniden hesaplar. AI ikame önerirken kullanıcının profildeki sevdiği/sevmediği yemekleri ve alerjileri dikkate alır.
- **"Elimde şunlar var" modu:** Kullanıcı "buzdolabımda tavuk, pirinç ve brokoli var, bunlarla ne yapabilirim?" dediğinde AI mevcut malzemelerden kalan makro hedefine en uygun tarifi önerir. Tarif modunun bu alt akışında AI malzeme listesini alır, profildeki tercih ve becerilere göre 1-2 tarif sunar, eksik temel malzemeler varsa (tuz, yağ gibi) bunları ekler ve tarif modunun tüm kurallarını (alerjen filtresi, porsiyon hesabı) uygular.
- Malzeme listesi çıkarır
- Kullanıcı tarifi beğenirse kaydetme seçeneği sunar (bkz. Bölüm 7.7)

**Dışarıda Yemek Modu:**
- Tetikleyici: "restorandayım", "McDonald's'tayım", "akşam dışarıda yemeğe çıkıyorum"
- Davranış: mevcut seçeneklere göre en az hasarlı önerileri sunar; kayıtlı mekan varsa hafızasındaki makro tahminini kullanır
- Gün planını proaktif ayarlar: "akşam dışarıda yiyeceksen gün içinde şunu yap ki akşam rahat et"
- **Menü fotoğrafı analizi:** Kullanıcı restoran menüsünü fotoğraflayıp "bunlardan hangisini yemeliyim?" diyebilir. AI menüdeki yemek isimlerini okur, profil ve günlük kalan bütçeye göre en uygun 2-3 seçeneği işaretler. Bu, fotoğraf analizi altyapısının genişletilmiş kullanımıdır; öğün fotoğrafından farklı olarak burada parse değil öneri verilir.
- **Sosyal yeme baskısı koçluğu:** Kullanıcı "iş yemeğindeyim herkes yiyor", "annem ısrar etti", "doğum günü pastası var" gibi sosyal baskı senaryoları bildirdiğinde AI özel bir koçluk stratejisi uygular: (a) yargılamadan durumu kabul eder, (b) hasar minimizasyonu önerir ("pasta al ama küçük dilim, yanına bir şey daha alma"), (c) haftalık bütçe perspektifinden rahatlatır, (d) Katman 2'ye sosyal yeme kalıplarını yazar (hangi ortamlar, sıklık). AI asla "hayır demelisin" demez; gerçek hayat koşullarıyla çalışır.

**Minimum Viable Day Modu:**
- Tetikleyici: "bugün hiç istemiyorum", "yorgunum, yapamam", "bugün kötü bir günüm", benzer motivasyon kaybı ifadeleri veya mood kaydında alt sınır (1-2) skoru
- Davranış: AI normal günlük planı askıya alır. Kullanıcıya o gün için üç basit hedef sunar. Ton otomatik olarak en yumuşak hale geçer, bu geçiş o gün için geçerlidir. Kullanıcı "bunu da yapamam" derse AI bir adım daha basitleştirir. Ertesi gün normal plana döner.
- Örnek çıktı: "Tamam, bugün üç şey yeter: su iç, bir şeyler ye, 10 dakika yürü. Hepsi bu."
- Yapmaması gereken: motivasyon konuşması, veri analizi, plan hatırlatmaları

**Plateau Yönetimi Modu:**
- Tetikleyici: 3 hafta ve üzeri kilo durağanlığı (ölçüm verisine göre AI otomatik tespit eder) veya kullanıcı "neden kilom değişmiyor?" diye sorarsa
- Davranış: AI plateau'yu kullanıcıya net şekilde tanımlar, panikletmez. Birkaç adımlık strateji seçeneği sunar (bkz. Bölüm 6.5)
- Kullanıcı strateji seçer, AI planı buna göre günceller

**Simülasyon Modu:**
- Tetikleyici: "şunu yesem ne olur?", "pizza yesem?", "akşam lahmacun yesem günüm nasıl etkilenir?"
- Davranış: AI henüz yenmemiş bir yemeği günlük plana simüle eder. Günün geri kalanının nasıl değişeceğini gösterir:
  - Kalan kalori bütçesi
  - Protein/karbon/yağ dengesine etkisi
  - Günün geri kalanında ne yenmesi gerektiği
  - Alternatif senaryo: "Bunun yerine şunu yersen akşam daha rahat edersin"
  - **Haftalık bütçe etkisi:** Simülasyon sadece günlük değil haftalık bütçeye etkisini de gösterir
- Örnek çıktı: "Bu pizzayı yersen (tahmini 680 kcal, 22g protein) akşama 420 kcal kalır, sadece salata + tavuk yiyebilirsin. Haftalık bütçende hâlâ 1200 kcal marjın var. Alternatif: yarım pizza + yanında protein shake, akşam daha esnek olursun."
- Kullanıcı kararını verdikten sonra normal kayıt akışına geçer

**Hızlı Kurtarma Modu:**
- Tetikleyici: "bugün çok yedim", "diyetimi bozdum", "kurtarılabilir mi?"
- Davranış: AI günün kalan kısmına bakıp mini kurtarma planı sunar. Ayrıca haftalık bütçe perspektifinden değerlendirir.
- Örnek çıktı: "Bugün ~500 kcal fazla yedin. Ama haftalık bütçende 800 kcal marjın var. Yarın ve öbür gün 250'şer eksik gidersen haftalık ortalan tutmuş olur. Bugünün geri kalanında hafif bir akşam yemeği ye, 2-3 bardak su iç."
- Yapmaması gereken: yargılama, dramatize etme, "bozma" kelimesini normalleştirme

### 5.3 AI Karar Öncelik Sırası

AI birden fazla söyleyecek şey olduğunda şu önceliği takip eder:

1. Sağlık riskleri (guardrail ihlalleri, doktora yönlendirme)
2. Günlük hedef uyumu (kalan kalori, protein açığı, su eksikliği)
3. Haftalık bütçe uyumu (günlük sapma haftalık perspektifle değerlendirilir)
4. Haftalık trend etkisi (3 gündür sapma, uyku bozukluğu trendi)
5. Uzun vadeli hedef etkisi (hedefe göre tempoda mısın)
6. Genel öneri ve bilgilendirme

Kural: AI her durumda en önemli 1-2 şeyi söyler, kullanıcıyı bilgi yağmuruna tutmaz.

### 5.4 AI Reaktif Mod

- "Şunu yesem olur mu?" — AI simülasyon moduna geçer, günün geri kalanına etkisini hesaplar ve alternatif senaryo sunar (bkz. 5.2 Simülasyon Modu)
- "Şunu yedim, ne yapmam gerekiyor?" — AI günün kalan planını revize eder
- "Diyetimi bozdum" / "Bugün çok yedim" — AI hızlı kurtarma moduna geçer (bkz. 5.2 Hızlı Kurtarma Modu)
- "Bu hafta nasıl gitti?" — AI analiz moduna geçer
- "Akşama ne pişireyim?" — AI tarif moduna geçer
- "Bugün hiç istemiyorum" — AI minimum viable day moduna geçer

### 5.5 AI Proaktif Mod

**Tetikleyiciler:**
- Sabah plan sunumu: her gün belirlenen saatte veya uygulamayı ilk açtığında
- Öğün saati hatırlatma: belirlenen öğün saatlerinde kayıt yoksa (IF modundaysa pencere dışına denk gelen hatırlatmalar gönderilmez)
- Spor saati hatırlatma: planlanan antrenman saatinde
- Su hatırlatma: hedefin gerisindeyse
- Gece atıştırma riski: kullanıcının profilde belirlenmiş risk saatlerinde
- Öğün atlama: beklenen öğün saatinden X dakika geçmişse
- 3 gündür spor kaydı yok
- Tartı kaydı 1 haftadır girilmemiş
- Uyku verisi eksik
- Haftalık koç raporu zamanı
- Dönemsel durum sorgulama: "tatilin ne zaman bitiyor?"
- Yeni kan sonuçları girildiğinde trend analizi
- Plateau tespiti: 3 hafta durağanlık → AI proaktif mesaj gönderir
- **Hafta sonu sapma riski:** AI geçmiş 4+ haftadaki hafta sonu verilerini analiz edip perşembe/cuma günü proaktif uyarı gönderebilir (bkz. 5.14)
- **Mevsimsel/bağlamsal farkındalık:** AI mevsime göre otomatik öğün önerisi tonu ayarlar (bkz. 5.17)
- **Uyku zamanı hatırlatma:** Uyku saatine yakın app kullanımında AI "yatma saatin yaklaşıyor" diye hatırlatma yapabilir; gece atıştırma riski saatiyle birleştirilir
- **Haftalık bütçe uyarısı:** Hafta ortasında bütçenin %70'i tüketilmişse AI hafifçe uyarır
- **Proaktif sağlık tahlili önerisi:** AI şu durumlarda kan tahlili yaptırmayı proaktif önerir: (a) önemli diyet değişikliğinden 3 ay sonra (ör: ketojenik moda geçiş), (b) uzun süreli kısıtlama dönemi sonrası (3+ ay kalori açığı), (c) mikro besin risk sinyali tespit edildiğinde (bkz. 5.16), (d) kilo hedefine ulaşıldığında ("hedefe ulaştın, bir kontrol tahlili yaptırmak iyi olur"), (e) kullanıcı 6+ aydır tahlil yaptırmamışsa ve aktif kilo verme sürecindeyse. Öneri koçluk mesajı formatında gelir, tıbbi bir yönlendirme değildir: "3 aydır yoğun kalori açığındasın, değerlerini kontrol ettirmenin tam zamanı." Bu öneri sıklığı yılda 2-3 kez ile sınırlıdır; AI her ay tahlil hatırlatmaz.

Her tetikleyicinin bir öncelik skoru vardır; AI aynı anda birden fazla bildirim göndermez, önceliklendirip birini seçer. Günlük bildirim üst sınırı belirlenir.

**"Bugünün tek odak noktası" mekanizması:**
- AI her sabah tüm verileri analiz edip en yüksek etkili tek hamleyi seçer
- "Bugün tek odağın: protein hedefini tuttur" veya "Bugün en önemli şey: 2.5L su"
- Bu, kullanıcının 15 metrikle boğulmasını engeller

### 5.6 AI Bilgi Sınırları

AI yapabilir:
- Yaşam tarzı önerisi vermek
- Besin değerleri hakkında bilgi vermek
- Genel sağlıklı yaşam bilgileri vermek
- Trend analizi yapmak
- Davranış kalıpları tespit etmek

AI yapamaz:
- Tıbbi teşhis koymak
- İlaç önerisi yapmak
- İlaç-besin etkileşimi hakkında kesin yorum yapmak
- Kan değerlerini teşhis diliyle yorumlamak
- Psikolojik teşhis veya tedavi önerisi yapmak
- Alkol bağımlılığı teşhisi koymak veya tedavi önerisi yapmak (sık alkol kalıbı tespit ederse profesyonele yönlendirir)

Sınıra geldiğinde standart yanıt: "Bu konuda doktorunla/diyetisyeninle konuşmanı öneririm. Ben yaşam tarzı önerisi yapabilirim ama bu tıbbi bir konu."

**Acil durum tespiti ve yönlendirme:**
Kullanıcı sohbette ciddi sağlık belirtileri bildirirse (göğüs ağrısı, nefes darlığı, şiddetli alerjik reaksiyon, ciddi baş dönmesi, bayılma, şiddetli karın ağrısı gibi) AI koçluk modundan çıkar ve:
- "Bu ciddi bir belirti olabilir, lütfen hemen 112'yi ara veya en yakın acil servise git" mesajı gösterir
- Koçluk önerisi vermez, plan konuşmaz
- Kullanıcı "sorun değil geçti" dese bile AI o oturum için ihtiyatlı kalır ve doktora görünmeyi tekrar hatırlatır
- Bu tespit hem keyword bazlı (acil tetikleyici kelimeler listesi) hem AI bağlam anlayışıyla çalışır

**Yeme bozukluğu risk yönetimi (detaylı):**
Kochko kalori takibi odaklı bir uygulama olduğu için ortorexia, anorexia ve bulimia tetikleme riski taşır. Bu risk aktif olarak yönetilir:
- **Kırmızı bayrak tespiti:** BMI 17'nin altında + agresif kilo verme hedefi, sürekli mutlak taban kaloriye yapışma, kayıt takıntısı (günde 15+ mikro kayıt), aşırı egzersiz kalıbı (dinlenme günü kabul etmeme), yeme sonrası pişmanlık/suçluluk ifadeleri
- **Tespit durumunda:** AI asla teşhis koymaz ama dikkatli bir şekilde gözlemini paylaşır ve profesyonel destek önerir: "Beslenme alışkanlıklarında bazı kalıplar dikkatimi çekiyor. Bu konuda bir uzmana danışmanı öneririm."
- **Uygulama sınırı mesajı:** Gerektiğinde AI "Bu uygulama senin için şu an doğru araç olmayabilir. Bir uzmanla konuştuktan sonra birlikte devam edebiliriz" diyebilir.
- Bu değerlendirme Katman 2'ye yazılır ve koçluk stratejisini etkiler (agresif kalori kısıtı önerilmez, daha yumuşak ton kullanılır)
- **Hamilelik + yeme bozukluğu riski kesişimi:** Hamile kullanıcılarda yeme bozukluğu kırmızı bayrakları tespit edilirse bu en yüksek risk senaryosudur. Bu durumda: (a) AI kalori takibi özelliklerini devre dışı bırakmayı önerir — takıntılı takip davranışını tetiklememek için, (b) hamilelik guardrail'leri (12.1) ve yeme bozukluğu protokolü aynı anda devreye girer, agresif kalori açığı planı kesinlikle sunulmaz, (c) AI her iki durumu Katman 2'ye ayrı ayrı yazar, (d) profesyonele yönlendirme mesajı standart "önerebilirim" tonundan daha güçlüdür: "Hamilelikte beslenme hassas bir süreç. Gördüğüm kalıplar seni bir uzmana yönlendirmemi gerektiriyor — bu hem senin hem bebeğin sağlığı için kritik." Bu senaryoda AI koçluk önerisi yapmayı minimize eder ve kullanıcıyı profesyonele yönlendirmeyi ön plana alır.

**Supplement-ilaç etkileşim farkındalığı:**
Kullanıcının hem aktif ilaç kaydı hem aktif supplement kaydı varsa AI bunların birlikte kullanımına dikkat çeker. AI teşhis koymaz ve kesin etkileşim bilgisi vermez, ancak şu seviyede farkındalık sağlar:
- "Hem [ilaç] hem [supplement] kullandığını görüyorum. Bu ikisinin etkileşimi konusunda doktorunla konuşmanı öneririm."
- Bu uyarı her supplement eklenmesinde değil, ilk kez eşleşme tespit edildiğinde bir kez verilir ve Katman 2'ye not düşülür: "Kullanıcı [ilaç] + [supplement] kullanıyor, etkileşim uyarısı verildi."
- AI bilinen yaygın etkileşimler hakkında çok genel bilgi verebilir (ör: "omega-3 kan sulandırıcılarla etkileşebilir") ama kesin yorum yapmaz.

### 5.7 AI Kalıp Tespiti ve Öğrenme

AI sürekli olarak şunları izler:

- Hangi öğün önerileri gerçekten uygulanıyor
- Hangi saatlerde sapma oluyor
- Hangi gıdalar atıştırma tetikleyicisi oluyor
- Hangi antrenmanlar sürdürülebilir geliyor
- Stres-yeme korelasyonu
- Uyku-performans korelasyonu
- **Uyku-beslenme zamanlama korelasyonu:** AI geç yemenin (uyku saatine 2 saatten az kala) uyku kalitesine etkisini ve erken/geç kahvaltının enerji seviyesine etkisini izler. Tekrarlayan kalıp tespit edilirse proaktif bildirir: "Gece geç yediğin günlerde uyku kalitenin düştüğünü görüyorum, akşam yemeğini 1 saat öne çekmeyi deneyelim mi?"
- Hafta içi vs hafta sonu davranış farkı
- Dışarıda yemek günlerindeki sapma kalıpları
- Menstrüel döngü ve beslenme/enerji ilişkisi (kadın kullanıcılar)
- Hangi koçluk mesajı stiline kullanıcı pozitif tepki veriyor
- Mood kaydı ile yeme davranışı korelasyonu — stres, düşük enerji, motivasyon kaybı dönemlerinde tetiklenen yeme kalıpları
- **Alkol-sapma korelasyonu:** Alkol tüketim günlerinde plansız atıştırma, kalori aşımı ve ertesi gün performans düşüşü kalıpları
- **Haftalık bütçe yönetim kalıbı:** Kullanıcı hafta başında mı yoksa sonunda mı aşıyor, hangi günler tampon oluşturuyor

**Duygusal yeme tespiti ve akışı:**
AI üst üste şu koşulları tespit ettiğinde duygusal yeme uyarısı devreye girer: düşük mood kaydı + plansız atıştırma + hedefin üzerinde kalori alımı. Tek bir kötü gün tetiklemez; en az 2-3 günlük örüntü aranır.

Tespit durumunda AI:
- "Son birkaç gündür stresli görünüyorsun, bu beslenme alışkanlıklarını etkiliyor olabilir" gibi bir gözlem paylaşır
- Yargılamaz, veri temelli konuşur
- "Bu konuyu konuşmak ister misin?" diye sorar; kullanıcı istemiyorsa AI geçer
- Kullanıcı onaylarsa kısa bir konuşma başlatır; bu sohbet planı değiştirmez, sadece bağlam sağlar
- Duygusal destek için profesyonele yönlendirme seçeneği sunar (terapist, psikolog) — zorunlu tutmaz, sadece var olduğunu belirtir
- Bu akış Katman 2'ye not düşer: "Kullanıcı duygusal yeme dönemlerinde sohbete açık/kapalı"

Öğrenme mekanizması model fine-tune değil; basit skorlarla yapılır:
- Tercih puanı
- Sürdürülebilirlik puanı
- Başarı korelasyonu

**Kullanıcı geri bildirimi ile öğrenme (doğrudan):**
AI'ın koçluk önerileri, plan önerileri ve tarif önerilerinin yanında iki buton: "İşe yaradı" / "Bana göre değil". Bu butonlar sadece öneri/plan/koçluk mesajlarında gösterilir; kayıt parse onaylarında, bilgi sorusu yanıtlarında ve analiz/rapor çıktılarında gösterilmez.
- "İşe yaradı" tıklaması: AI o öneri türünün ağırlığını artırır
- "Bana göre değil" tıklaması: AI neden değil diye kısaca sorabilir (opsiyonel), ardından o öneri türünü azaltır
- Bu geri bildirimler Katman 2 özetine yansır: "Kullanıcı kahvaltıda sıcak tarif önerilerini tercih etmiyor"

### 5.8 AI Özel Takip Kıstasları Oluşturma

AI kullanıcı bazlı özel takip mekanizmaları oluşturabilir:

- Stres takibi, uyku kalitesi, duygusal yeme sıklığı, kafein tüketimi, spesifik besin eksikliği, alkol tüketim sıklığı, vb.
- AI bu kıstası kendi context'ine (Katman 2) yazar
- Kullanıcıya bu takibi neden başlattığını açıklar
- Takip verileri diğer kayıtlarla birlikte raporlara yansır

### 5.9 AI İletişim Tonu Evrimi

- Başlangıçta kullanıcının seçtiği ton (sert / dengeli / yumuşak)
- İlk hafta daha destekleyici
- Kullanıcı disiplin kurdukça daha direkt
- Kullanıcı motivasyon kaybettiğinde tekrar destekleyici
- AI hangi mesaj stilinin işe yaradığını takip edip otomatik öğrenir
- Koçluk mesajlarında asla abartı motivasyon dili yok; veri temelli ve operasyonel
- Kullanıcı tonu istediği zaman manuel sıfırlayabilir (bkz. Bölüm 4.2)

### 5.10 AI Çelişki Yönetimi

- Profilde "gluten yiyemem" yazıyor ama kullanıcı "makarna yedim" dediğinde: AI sorar — "profilinde gluten intoleransı var, bu değişti mi yoksa bugün istisna mı yaptın?"
- Kullanıcı "haftada 1 kg vermek istiyorum" diyor ama 3-5 gündür aşırı kalori alımı var: AI sorar — "hedefin ve davranışın uyuşmuyor, hedefi mi ayarlayalım yoksa planı mı sıkılaştıralım?"
- Kullanıcı bir gün kısıt beyan edip ertesi gün yiyorsa: AI profili güncellemeden önce doğrulama yapar
- Profilde "alkol kullanmıyorum" yazıyor ama alkol kaydı girilmişse: AI aynı çelişki yönetimi akışını uygular

**AI kendisiyle tutarlılık:**
AI farklı oturumlarda kendisiyle çelişebilir (salı: "makarna 400 kcal", perşembe: aynı makarna "350 kcal"). Bu riski azaltmak için:
- Kullanıcı düzeltmeli değerler Katman 2'de kesin kayıt olarak tutulur ve her oturumda referans alınır
- AI bir yemeğe kalori tahmini verdiğinde, aynı yemeğin geçmiş tahminleri context'te varsa tutarlılık kontrol edilir
- Tutarsızlık tespit edilirse AI daha önceki değeri baz alır ve farkı açıklar: "Daha önce bunu 400 kcal olarak kaydetmiştik, onu baz alıyorum"
- Guardrail katmanı (12.5) aynı yemek için oturumlar arası %20'den fazla sapma tespit ederse AI'ın önceki onaylı değeri kullanmasını zorlar

### 5.11 AI Şeffaflık Mekanizması

- Her öneri veya planda "Neden?" butonu veya açılır açıklama alanı
- Örnek: "Bugün hafif antrenman öneriyorum" → Neden? → "Dün sadece 5 saat uyumuşsun ve son 3 günde yoğun antrenman yapmışsın"
- AI planı değiştirdiğinde kullanıcıya ne değişti ve neden değişti detaylı yazılır
- Kalori tahminlerinin tahmini olduğu her zaman belirtilir

### 5.12 AI Kullanıcı Düzeltmelerinden Öğrenme

- Kullanıcı kalori/makro düzeltmesi yaptığında AI bunu hafızasına kaydeder
- Aynı yemek bir daha girildiğinde düzeltilmiş değer baz alınır
- Porsiyon büyüklüğü de kullanıcıya göre öğrenilir: Ali'nin "1 tabak"ı 500g, Ayşe'nin "1 tabak"ı 300g
- Bu veriler Katman 2 özetine yazılır

### 5.13 AI Servis Hatası ve Fallback

- AI servisi cevap vermiyorsa veya hata veriyorsa kullanıcıya şeffaf mesaj gösterilir: "Şu an koça bağlanamıyorum, biraz sonra tekrar dene."
- AI bağlanamadığında şunlar çalışmaya devam eder: kayıt girişi, geçmiş görüntüleme, mevcut planı görme
- Günlük plan üretilemiyorsa kullanıcıya bir önceki günün veya önceki haftanın planı gösterilir: "Bugün plan üretilemedi, dünün planını devam ettiriyorum."
- Fallback planı kullanıldığında kullanıcıya açıkça belirtilir
- Servis geri döndüğünde AI offline dönemde girilen kayıtları okuyup gerekirse güncelleme yapar
- **Model fallback:** Birincil AI modeli yanıt vermiyorsa ikincil (daha hafif/ucuz) modele düşülür. Bu geçiş kullanıcıya şeffaf belirtilir (bkz. 5.25).

### 5.14 Prediktif Analitik (Pattern-Based Risk Prediction)

AI geçmiş verilerdeki tekrarlayan kalıpları tespit edip geleceğe yönelik risk uyarısı verir:

- **Hafta sonu sapma tahmini:** Geçmiş 4+ haftadaki hafta sonu verileri analiz edilir. Eğer tekrarlayan bir sapma kalıbı varsa (ör: her cumartesi akşamı aşırı kalori, alkol kaynaklı sapma) AI perşembe veya cuma günü proaktif uyarı gönderir: "Son 4 hafta sonunda sapma olmuş, bu hafta sonu için bir plan yapalım mı?"
- **Atıştırma saati tahmini:** Kullanıcının hangi saat dilimlerinde plansız atıştırma yaptığı tespit edilip o saatten önce uyarı gönderilir
- **Dönemsel risk:** Kadın kullanıcılarda döngü fazına göre iştah artışı tahmin edilip proaktif kalori yönetimi sunulur
- **Motivasyon düşüş erken uyarısı:** Streak'in kırılmaya başladığı, kayıt sıklığının azaldığı, mood puanlarının düştüğü dönemlerde AI daha erken devreye girer
- **Alkol-sapma tahmini:** Kullanıcıda alkol tüketimi sonrası tekrarlayan kalıp varsa (ör: cuma akşamı içki → cumartesi sabah öğün atlama → öğlen aşırı yeme) AI cuma günü proaktif strateji sunar
- Bu tahminler Katman 2 özetine yazılır: "Kullanıcı cumartesi akşamları yüksek sapma riski taşıyor"

### 5.15 Kullanıcı Persona/Segment Tespiti

AI kullanıcıyı zaman içinde bir davranış profiline oturtur ve koçluk stratejisini buna göre şekillendirir:

- **Hafta içi disiplinli / hafta sonu kaotik:** Hafta sonu planlarına ekstra odaklanılır, hafta içi motivasyon yerine hafta sonu strateji konuşulur
- **Veri odaklı:** Daha çok grafik, sayısal detay, trend analizi sunulur
- **Motivasyon bağımlı:** Streak'ler ve başarımlar daha fazla ön plana çıkarılır
- **Minimalist:** En az müdahale, en az bildirim, sadece kritik anlar
- **Yemek odaklı vs spor odaklı:** Kullanıcının daha çok hangi alana ilgi gösterdiği tespit edilip o alan ön plana çıkarılır

AI bu segment tespitini Katman 2'ye yazar. Kullanıcıya doğrudan "sen şu tipsin" demez; davranışını sessizce ayarlar. Kullanıcı "benim hakkımda ne biliyorsun?" dediğinde bu bilgi de paylaşılabilir.

### 5.16 Temel Mikro Besin Farkındalığı

Tam mikro besin takibi karmaşık ve güvenilmez olduğu için Kochko bunu detaylı mikro analiz olarak yapmaz. Bunun yerine AI, makro kayıtlardan çıkarımla temel eksiklik sinyallerini tespit eder:

- "Son 2 haftadır neredeyse hiç süt ürünü yememişsin, kalsiyum alımın düşük olabilir"
- "Kırmızı et ve yeşil yapraklı sebze az tüketiyorsun, demir düşük olabilir"
- "Güneşe çıkma fırsatın azmış, D vitamini takviyesi düşünebilirsin — doktorunla konuş"

Bu, teşhis değil farkındalık seviyesindedir. AI mikro besin tahmini vermez, eksiklik riski sinyali verir ve gerektiğinde tahlil yaptırmayı önerir. Tespit edilen risk sinyalleri Katman 2'ye yazılır.

### 5.17 Mevsimsel ve Bağlamsal Farkındalık

AI öğün önerileri ve koçluk mesajlarını mevsimlere ve bağlama göre otomatik ayarlar:

- **Kış:** Sıcak yemek, çorba, güveç önerileri ağırlıkta. Dış mekan antrenmanı azaltılıp salon/ev alternatifleri öne çıkar.
- **Yaz:** Salata, hafif öğünler, soğuk içecek alternatifleri. Su hatırlatmaları sıklaştırılır. Dış mekan aktiviteleri önerilir.
- **Ramazan yaklaşırken:** AI ramazandan 1-2 hafta önce proaktif sorgulama yapar: "Ramazan yaklaşıyor, oruç tutacak mısın?" Onaylarsa dönemsel durum otomatik başlatılır.
- **Bayram dönemi:** AI bayramdan önce uyarı gönderir, bayram süresince esnek mod önerir.

Bu ayarlama kullanıcının lokasyonuna (Türkiye) ve takvime göre tetiklenir. Kullanıcı tarafından aktif edilmesi gerekmez.

### 5.18 Sohbet Geçmişi Arama

- Kullanıcı tüm AI sohbet geçmişini arayabilir
- Arama ekranı: Sohbet > Geçmiş > Ara
- Arama kriterleri: tarih aralığı, anahtar kelime, konu etiketi (beslenme / antrenman / hedef / sağlık)
- Arama sonuçları mesaj seviyesinde değil sohbet oturumu seviyesinde listelenir; kullanıcı ilgili oturumu açar
- AI de geçmişe referans verebilir: "geçen ay bu konuyu konuşmuştuk" ve kullanıcı o konuşmaya atlayabilir
- Sohbet geçmişi kullanıcı tarafından seçici olarak veya toplu silinebilir
- **Sohbet silme vs Katman 2 ilişkisi:** Sohbet geçmişi silindiğinde Katman 2 notları silinmez. Sohbet ve Katman 2 ayrı katmanlardır; bir sohbette AI'ın öğrendiği kalıplar, alerji tespitleri, porsiyon kalibrasyonu gibi bilgiler Katman 2'de bağımsız olarak yaşar. Kullanıcı Katman 2'deki bilgileri ayrıca düzeltme/silme hakkına sahiptir (bkz. 2.3) ama sohbet silmek Katman 2'yi otomatik etkilemez. Bu ayrım kullanıcıya açıkça belirtilir: "Sohbet geçmişini silmek istiyorsun. Bu, koçun seni tanıma notlarını silmez; sadece sohbet kaydını kaldırır. Notları da sıfırlamak istersen Ayarlar > Katman 2'den yapabilirsin."

### 5.19 Otomatik Öğün Zamanı Öğrenme

- Kullanıcı profilinde öğün saatlerini kendisi girer ama AI kayıt geçmişinden gerçek öğün zamanlarını öğrenir
- Kullanıcı profilde "öğle 12:00" yazmış ama hep 13:15'te kayıt giriyorsa AI hatırlatma saatini buna göre ayarlar
- Hafta içi ve hafta sonu öğün saatleri ayrı ayrı öğrenilir
- Bu bilgi Katman 2'ye yazılır: "Kullanıcı hafta içi öğleyi ~13:15'te, hafta sonu ~14:00'te yiyor"
- AI öğrendiği saatleri kullanıcıya bildirmez, sessizce uygular. Kullanıcı profil saatlerini manuel değiştirirse manuel ayar öncelikli olur.

### 5.20 Zengin Sohbet Yanıtları

AI sohbet ekranında sadece düz metin değil, zengin içerik formatları kullanabilir:

- **Mini chart:** "Bugün proteinin nasıl?" sorusuna günlük makro barı ile yanıt
- **Hızlı seçim butonları:** "Akşam ne yiyelim?" sorusuna 2-3 seçenek butonu
- **Makro halkası:** Kayıt sonrası günlük ilerlemenin donut chart'ı (alkol ayrı dilim olarak gösterilir)
- **Onay butonu:** AI bir değişiklik önerdiğinde "Onayla / Reddet" butonları
- **Kaydırılabilir tarif kartı:** Tarif modunda malzeme listesi ve adımlar kartı
- **Simülasyon kartı:** "Şunu yesem ne olur?" sorusuna günün kalan bütçesini gösteren before/after karşılaştırma kartı
- **Haftalık bütçe barı:** Günlük ve haftalık perspektifi birlikte gösteren mini görsel

Bu formatlar sohbet deneyimini zenginleştirir ve kullanıcının bilgiyi daha hızlı tüketmesini sağlar. Teknik olarak sohbet mesajları içinde gömülü UI bileşenleri olarak uygulanır.

### 5.21 Haftalık Öğrenme Notu

AI her haftalık raporda 1-2 cümlelik "bu hafta seni daha iyi tanıdım" notu paylaşır:

- "Bu hafta fark ettim ki öğle yemeklerinde dışarıda yediğin günlerde akşam daha az atıştırıyorsun — planı buna göre ayarlıyorum."
- "Hafta sonları kahvaltıyı atladığını gördüm, öğle öğününü buna göre büyüttüm."
- "Squat'ta 2 haftadır aynı ağırlıktasın, deload önerebilirim."

Bu not, kullanıcıya AI'ın gerçekten öğrendiğini ve dikkat ettiğini hissettirmek içindir. Her hafta zorunlu değil — AI yeni bir şey öğrenmişse yazar, öğrenmemişse yazmaz.

### 5.22 Debug/Şeffaflık Modu (Power User)

Ayarlar > Geliştirici Modu altında opsiyonel olarak açılabilen bir görünüm:

- AI'ın o anki yanıtta hangi katmanlardan hangi veriyi çektiğini gösterir
- Her katmanın token kullanımını gösterir (Katman 1: 18.500/24.000, Katman 2: 12.000/16.000, vb.)
- AI'ın hangi görev moduna geçtiğini ve neden geçtiğini gösterir
- Guardrail tetiklenmişse hangisinin tetiklendiğini gösterir
- Hangi AI modeli ve versiyonunun kullanıldığını gösterir
- Bu mod varsayılan olarak kapalıdır ve normal kullanıcılara gösterilmez
- Geliştirme sürecinde hata ayıklama için kritik; ileri kullanıcılar için de güven artırıcı

### 5.23 Porsiyon Kalibrasyonu

Kullanıcıların "1 porsiyon", "1 tabak", "biraz" gibi ifadeleri kişiden kişiye çok farklı anlamlar taşır. Kochko bunu kalibre eder:

**Onboarding kalibrasyonu (ilk hafta):**
- AI kullanıcıya 5-10 standart yemek porsiyon fotoğrafı gösterir
- "Senin normal bir tabak pilav hangisine yakın?" gibi sorularla kullanıcının porsiyon algısını ölçer
- Bu kalibrasyon Katman 2'ye yazılır: "Kullanıcının '1 tabak' ifadesi yaklaşık 350g"

**Sürekli kalibrasyon:**
- Kullanıcı kalori düzeltmeleri yaptıkça AI porsiyon büyüklüğü öğrenimini günceller
- Zamanla düzeltme ihtiyacı azalır çünkü AI kullanıcının porsiyon algısını tanır

**Fotoğraf analizi entegrasyonu:**
- Fotoğraf ile öğün kaydında AI, Katman 2'deki porsiyon kalibrasyonunu girdi olarak kullanır
- "Bu kullanıcı genelde büyük tabak kullanıyor" bilgisi fotoğraf tahmininin doğruluğunu artırır

### 5.24 LLM Parametre Ayarları (Mod Bazlı)

Her AI görev modunun farklı LLM parametrelerine (özellikle temperature) ihtiyacı vardır. Bu, yanıt kalitesi ve tutarlılığı için kritik:

- **Kayıt parse modu:** temperature 0.1-0.3 (kesin ve tutarlı sonuç gerekli, "2 yumurta" her seferinde aynı kaloriyi vermeli)
- **Plan yapıcı modu:** temperature 0.3-0.5 (yapılandırılmış ama alternatif sunan)
- **Koçluk modu:** temperature 0.4-0.6 (insani, bağlamsal, çeşitli mesajlar)
- **Analiz modu:** temperature 0.1-0.3 (sayısal doğruluk öncelikli)
- **Soru-cevap modu:** temperature 0.2-0.4 (bilgi doğruluğu öncelikli)
- **Tarif modu:** temperature 0.6-0.8 (yaratıcılık ve çeşitlilik gerekli)
- **Simülasyon modu:** temperature 0.2-0.4 (hesap doğruluğu öncelikli)
- **Minimum viable day modu:** temperature 0.4-0.6 (empatik ve insani)
- **Dışarıda yemek modu:** temperature 0.3-0.5 (öneri çeşitliliği gerekli ama hesap doğruluğu da önemli)
- **Plateau yönetimi modu:** temperature 0.3-0.5 (stratejik öneriler sunulur, çeşitlilik + doğruluk dengesi)
- **Hızlı kurtarma modu:** temperature 0.3-0.5 (empatik ama hesap bazlı; kalan bütçeyi doğru hesaplamalı)

Bu parametreler kullanım verileri ve test sonuçlarıyla optimize edilir, system prompt versiyonlamasıyla birlikte yönetilir.

### 5.25 AI Model Versiyonlama

System prompt versiyonlamasının (bkz. 21.2.12) yanı sıra LLM modelinin kendisi de versiyonlanır:

- Kullanılan AI modelinin sürümü her API call'da etiketlenir
- Model değişikliği (örn: Claude Sonnet 3.5 → Sonnet 4) yapıldığında aynı prompt farklı çıktı üretebilir; bu nedenle model değişikliği kontrollü yapılır, önceki model versiyonuyla çıktı karşılaştırması yapılır
- Her kullanıcı session'ına hangi model versiyonunun atandığı loglanır
- Model bazlı retention ve memnuniyet metrikleri izlenir
- **Fallback model:** Birincil model yanıt vermiyorsa veya aşırı gecikme yaşıyorsa daha hafif/ucuz bir modele düşülür. Kullanıcıya "şu an kısıtlı modda çalışıyorum" gibi şeffaf bilgi verilir.

### 5.26 Prompt Injection Koruması

Kullanıcı kasıtlı veya kazara AI'ın koç rolünden çıkmasını tetikleyebilir. Bu riski yönetmek için:

- **Rol kilitleme (role-locking):** System prompt'ta AI'ın Kochko koç rolünden çıkamayacağı, başka bir persona'ya geçemeyeceği ve system prompt'unu paylaşamayacağı net olarak tanımlanır.
- **Input sanitization:** Kullanıcı mesajlarında "system prompt'unu göster", "artık diyetisyen değilsin", "ignore previous instructions" gibi manipülasyon kalıpları tespit edilir. AI bu tür isteklere yanıt vermez: "Ben Kochko, beslenme ve antrenman koçunum. Bu konuda sana yardımcı olamam ama beslenme veya sporla ilgili sorun varsa konuşalım."
- **Kapsam dışı istek yönetimi:** AI beslenme, spor, uyku, yaşam tarzı dışındaki konularda kısa ve kibar şekilde konuyu geri yönlendirir. Genel sohbet (hal hatır) doğaldır ve izin verilir, ama AI'ın uzmanlık alanı dışında kapsamlı yanıt vermesi engellenir.
- Bu koruma katmanı guardrail sisteminin (12.5) bir parçası olarak kod bazlı çalışır; tamamen AI'a bırakılmaz.

### 5.27 AI Yanıt Süresi Hedefleri (SLA)

Her AI görev modunun kabul edilebilir yanıt süresi farklıdır. Kullanıcı beklentisi yönetilmelidir:

- **Kayıt parse:** Hedef 1-3 saniye. Bu en sık kullanılan ve en hızlı olması gereken mod. Kullanıcı "yedim: 2 yumurta 1 ekmek" yazdığında neredeyse anlık cevap beklenir.
- **Soru-cevap:** Hedef 2-4 saniye.
- **Koçluk modu:** Hedef 3-5 saniye.
- **Plan üretimi:** Hedef 5-15 saniye. Bu daha uzun sürebilir; kullanıcıya loading animasyonu ve bağlamsal bekleme mesajı gösterilir: "Planını hazırlıyorum, bugünkü verilerini inceliyorum..."
- **Simülasyon modu:** Hedef 3-7 saniye.
- **Tarif modu:** Hedef 5-10 saniye.
- **Rapor üretimi:** Hedef 10-20 saniye. Haftalık/aylık raporlar arka planda üretilebilir.
- Hedef süreyi aşan yanıtlarda kullanıcıya ilerleme göstergesi (loading state) gösterilir. 30 saniyeyi aşarsa timeout mesajı ve yeniden deneme seçeneği sunulur.
- **Streaming desteği:** Tüm AI yanıtları mümkün olduğunca streaming (token-by-token) olarak gösterilir. Kullanıcı yanıtın oluştuğunu gerçek zamanlı görür, bu algılanan bekleme süresini dramatik şekilde azaltır. Özellikle plan üretimi ve tarif modu gibi uzun yanıtlarda streaming UX açısından kritiktir. Kayıt parse gibi kısa yanıtlarda streaming farkı az olsa da tutarlılık için tüm modlarda aktif olur.

### 5.28 AI Dil Tutarlılığı

- AI tüm çıktılarını kullanıcının dil tercihine göre verir (varsayılan: Türkçe)
- Türkçe yanıtlarda gereksiz İngilizce terim kullanılmaz. Teknik terimlerin Türkçe karşılıkları tanımlanır ve system prompt'ta listelenir: protein (protein kalır), carbs → karbonhidrat, fat → yağ, calorie → kalori, rep → tekrar, set → set (yaygın kullanım), deload → deload (yaygın kullanım), bulk → hacim dönemi, cut → kesim dönemi, refeed → yeniden besleme günü
- AI yanıtlarında dil karışımı tespit edilirse guardrail katmanı düzeltir
- Kullanıcı İngilizce terim kullandığında AI bunu anlar ama yanıtını Türkçe verir (kullanıcı "carbs"ı sorabilir, AI "karbonhidrat" olarak yanıtlar)
- **Girdi dil toleransı:** Kullanıcı tamamen İngilizce ("I ate 2 eggs"), Türkçe-İngilizce karışık ("bugün 2 slice ekmek yedim"), veya yazım hatalı girdi yapabilir. AI tüm bu varyasyonları doğru parse edebilmeli ve kayıt oluşturabilmelidir. Parse sonucu her zaman kullanıcının tercih ettiği dilde (varsayılan: Türkçe) gösterilir. Bu davranış system prompt'ta ve kayıt parse modunun talimatlarında açıkça tanımlanır.

### 5.29 Structured Output Validation (Yapısal Çıktı Doğrulama)

AI'ın kayıt parse ettiğinde, plan ürettiğinde veya rapor oluşturduğunda döndürdüğü yapısal veri (JSON) her zaman tutarlı ve geçerli olmalıdır:

- **Şema validasyonu:** Her AI çıktı tipi için beklenen JSON şeması tanımlanır. AI'ın döndürdüğü veri bu şemaya uymuyorsa hata yakalanır ve retry mekanizması devreye girer.
- **Zorunlu alan kontrolü:** Kayıt parse sonucunda kalori, protein, karbonhidrat, yağ alanlarının hepsi dolu olmalıdır. Eksik alan varsa AI'a tekrar sorulur.
- **Mantıksal tutarlılık:** Parse sonucundaki makro toplamı kaloriyle tutarlı mı? (protein x 4 + karb x 4 + yağ x 9 + alkol x 7 ≈ toplam kalori, %10 toleransla)
- **Retry stratejisi:** İlk denemede geçersiz çıktı gelirse aynı model ile 1 kez retry yapılır. İkinci denemede de başarısız olursa fallback modele düşülür. Üçüncü denemede de başarısız olursa kullanıcıya "Bunu işleyemedim, farklı şekilde girer misin?" mesajı gösterilir.

### 5.30 Kademeli Zorluk Artışı (Adaptive Difficulty)

Kullanıcı başarılı olduğunda AI proaktif olarak çıtayı yükseltir:

- **Tetikleyici:** Kullanıcı 2+ hafta boyunca uyum puanı %85+ tutturuyorsa AI planı biraz daha zorlayıcı hale getirir.
- **Zorluk artışı örnekleri:** Kalori aralığını %5 daraltma, protein hedefini 5g artırma, antrenman yoğunluğunu bir kademe yükseltme, su hedefini 0.2L artırma
- **Uygulama:** AI bu artışı kullanıcıya açıkça bildirir: "Son 2 hafta çok iyi gitti, çıtayı biraz yükseltiyorum: protein hedefini 130g'dan 135g'a çıkarıyorum."
- **Geri alma:** Kullanıcı yeni hedefi tutturamıyorsa AI 1 hafta sonra eski seviyeye döner
- Bu mekanizma plateau yönetiminden farklıdır: plateau kilo durağanlığı için, adaptive difficulty genel performans optimizasyonu için çalışır

### 5.31 Beslenme Okuryazarlığı Desteği

AI ilk haftalarda kullanıcının beslenme kavramlarını ne kadar bildiğini ölçer ve buna göre davranır:

- **Tespit:** Kullanıcının sohbette kullandığı terimler, sorduğu sorular ve kayıt detay seviyesinden AI beslenme okuryazarlık seviyesini tahmin eder ("makro nedir?" diyen kullanıcı ile "bugün 40/40/20 gideyim" diyen kullanıcı farklı seviyelerdedir).
- **Düşük okuryazarlık:** AI ilk 2 haftada temel kavramları sohbet akışına doğal şekilde serpiştirerek öğretir. Ayrı bir eğitim modülü değil, koçluk mesajlarının içine gömülü kısa açıklamalar: "Protein doygunluk hissi veren ve kas yapıcı besin — bu yüzden her öğünde olması önemli." Bu açıklamalar tekrarlanmaz; AI hangi kavramları açıkladığını Katman 2'ye yazar.
- **Yüksek okuryazarlık:** AI jargon kullanabilir, kısa ve direkt konuşur, açıklama yapmadan makro hedef verir.
- Bu seviye Katman 2'ye yazılır ve zamanla güncellenir.

### 5.32 Sohbet Onarım Mekanizması (Conversation Repair)

AI kullanıcıyı yanlış anlayabilir veya hatalı parse yapabilir. Bu durumlar için onarım akışı:

- **Yanlış parse tespiti:** Kullanıcı "öyle demedim", "yanlış anladın", "bu doğru değil" gibi ifadeler kullandığında AI hata moduna geçer: önceki parse'ı geri alır, kullanıcıdan doğru bilgiyi ister, düzeltilmiş kaydı oluşturur.
- **Otomatik hata tespiti:** AI kendi parse sonucundan emin değilse (düşük güven) proaktif doğrulama ister: "Doğru anladıysam: 2 dilim pizza ve ayran, toplam ~650 kcal. Bu doğru mu?" Onay gelmeden kayıt kesinleşmez.
- **Kayıt geri alma:** Kullanıcı "son kaydı sil" veya "bunu iptal et" dediğinde AI son eklenen kaydı geri alır. Birden fazla ardışık geri alma desteklenir.
- **Bağlam karışıklığı:** Kullanıcı sohbet modunda bilgi sorusu sorup sonra kayıt girmek istediğinde veya tam tersi durumda AI mod geçişini net yapar: "Şimdi bunu kayıt olarak mı ekleyeyim, yoksa sadece bilgi mi istiyordun?"
- Onarım sıklığı Katman 2'ye yazılır; belirli bir yemek veya ifade sürekli parse hatası üretiyorsa AI o kalıbı öğrenir.

### 5.33 Kademeli Özellik Tanıtımı (Progressive Disclosure)

Yeni kullanıcı uygulamanın tüm yeteneklerini bilmez. AI ilk haftalarda özellikleri kademeli olarak tanıtır:

- **İlk gün:** Sadece temel kayıt ve plan görüntüleme. AI karmaşık özelliklerden bahsetmez.
- **3-5. gün:** AI ilk bağlamsal özellik tanıtımı yapar: kullanıcı "dışarıda yemek yiyeceğim" dediğinde ilk kez dışarıda yemek modunu aktif gösterir; "bu pizzayı yesem?" dediğinde simülasyon modunu tanıtır.
- **2. hafta:** Porsiyon kalibrasyonu, favori şablonlar, haftalık bütçe gibi derinlik özellikleri tanıtılır.
- **3-4. hafta:** Challenge modülü, tarif kütüphanesi, rapor export gibi ileri özellikler.
- Tanıtım mesajları koçluk mesajlarının doğal akışına gömülüdür; ayrı bir "öğretici" pop-up değildir.
- AI hangi özellikleri tanıttığını Katman 2'ye yazar; aynı özellik iki kez tanıtılmaz.
- Kullanıcı kendi keşfedip kullandığı özellikler tanıtım listesinden otomatik çıkar.

### 5.34 Kafein-Uyku Korelasyon Takibi

Kafein tüketimi uyku kalitesini, iştahı ve enerji seviyesini doğrudan etkiler. AI bunu aktif olarak izler:

- **Kafein tespiti:** Kullanıcı "kahve", "çay", "enerji içeceği" gibi kayıtlar girdiğinde AI kafein miktarını tahmini hesaplar (1 fincan kahve ~80-100mg, 1 çay ~30-50mg, enerji içeceği ~80-150mg). Bu hesap supplement kaydından ayrıdır; günlük öğün kayıtlarından otomatik çıkarılır.
- **Kafein-uyku korelasyonu:** AI son kafein alım saati ile uyku kalitesi arasındaki ilişkiyi izler. Tekrarlayan kalıp tespit edilirse bildirir: "Öğleden sonra 3'ten sonra kahve içtiğin günlerde uyku kaliten düşük çıkıyor."
- **Kafein-iştah etkisi:** Yüksek kafein tüketiminin iştahı bastırma etkisi nedeniyle öğün atlama kalıbı oluşuyorsa AI bunu tespit eder.
- **Günlük toplam kafein uyarısı:** 400mg/gün (yaklaşık 4 fincan kahve) üstüne çıkıldığında AI genel bir farkındalık mesajı verir.
- Bu veriler Katman 2'ye yazılır ve su hedefi ayarlamasında da kullanılır (yüksek kafein = daha fazla su önerisi).

### 5.35 Alışkanlık Bazlı Koçluk (Habit Stacking)

Adaptive difficulty (5.30) performans bazlı çıta yükseltme yapar; bu mekanizma ise davranış alışkanlığı inşasına odaklanır:

- **Mikro-alışkanlık hedefleri:** AI ilk haftalarda kullanıcıya tek bir mikro-alışkanlık hedefi koyar: "Bu hafta sadece kahvaltı kaydını her gün gir." Günlük kayıt, günlük plan, günlük su gibi temelleri teker teker oturtmayı hedefler.
- **Alışkanlık zinciri (habit stacking):** Bir alışkanlık 2 hafta boyunca %80+ uyumla tutturulduğunda AI ikinci bir alışkanlık ekler: "Kahvaltı kaydını artık düzenli giriyorsun, şimdi su takibini de ekleyelim."
- **Tetikleyici bağlama:** AI mevcut alışkanlıklara yeni davranışları bağlar: "Her kahvaltı kaydından sonra su hedefine bir bardak ekle."
- **Challenge modülü ile farkı:** Challenge'lar kısa süreli ve somut hedeflidir (30 gün X yap); alışkanlık koçluğu kalıcı davranış değişikliği için uzun vadeli, kademeli bir mekanizmadır.
- Alışkanlık ilerleme durumu Katman 2'ye yazılır: "Kullanıcı kahvaltı kaydı alışkanlığını oturtmuş, su takibini ekledik."

---

## BÖLÜM 6: HEDEF MOTORU

### 6.1 Hedef Tanımlama

- Kullanıcı somut hedef koyar: "85 kilodan 75 kiloya inmek istiyorum 4 ayda"
- Sistem bunu haftalık tempoya çevirir: haftada ~0.625 kg
- Hedef aşırı agresifse (haftada 1 kg'dan fazla) sistem risk uyarısı gösterir ve alternatif önerir
- Hedef türleri: kilo verme, kilo alma, kas kazanımı, sağlık marker'ları iyileştirme, sürdürülebilir disiplin

### 6.2 Çoklu Hedef Yönetimi

- Kullanıcının aynı anda birden fazla hedefi olabilir: kilo ver + kas kazan + uyku düzelt
- AI bu hedefleri önceliklendirir
- Çelişen hedefler varsa (kalori açığı vs kas kazanımı) AI dönemsel strateji belirler: "Şu an kalori açığındasın, kas kazanımı için önce hedef kiloya ulaş, sonra bulk dönemine geçelim"
- Hedef öncelik sırası kullanıcıyla birlikte belirlenir

**Hedef uyumluluk matrisi (AI referansı):**
- Kilo ver + Kas kazan = çelişki (dönemsel strateji gerekli: önce cut, sonra bulk)
- Kilo ver + Kondisyon = uyumlu (kalori açığı + kardiyo sinerjik)
- Kas kazan + Kondisyon = kısmen çelişki (aşırı kardiyo kas kazanımını yavaşlatır, kontrollü kardiyo mümkün)
- Kilo ver + Uyku düzelt = uyumlu ve sinerjik (iyi uyku metabolizmayı destekler)
- Kas kazan + Kilo al = uyumlu (kalori fazlası + ağırlık antrenmanı)
- AI bu matrise göre kombinasyona uygun strateji belirler ve kullanıcıya çelişkiyi açıkça anlatır

### 6.3 Hedef Takibi

- Her hafta hedefe ne kadar yakın/uzak olduğu gösterilir
- Tempo grafiği: planlanan vs gerçekleşen
- Tahmini hedefe varış tarihi (mevcut trend devam ederse)
- Tempo çok yavaşsa veya çok hızlıysa AI uyarır ve plan revizyonu önerir
- Hedefe ulaşıldığında bakım moduna geçiş başlar (bkz. Bölüm 6.6)

### 6.4 Hedef Güncelleme

- Kullanıcı hedefini istediği zaman değiştirebilir
- AI de hedef revizyonu önerebilir: "2 aydır haftada 0.3 kg kaybediyorsun, hedef süreyi uzatalım mı?"
- Hedef değiştiğinde günlük plan otomatik yeniden şekillenir

**AI-driven hedef önerisi:**
AI sadece mevcut hedefleri revize etmekle kalmaz, gözlemlediği kalıplardan yeni hedef önerebilir:
- "Son 1 aydır uyku kaliten sürekli düşük. Uyku düzenleme hedefi ekleyelim mi? İyi uyku metabolizmayı ve kilo kaybını doğrudan destekler."
- "Protein hedefini tutturma oranın çok yüksek ama su tüketimin zayıf — su hedefini öncelikli yapalım mı?"
- "Güç antrenmanlarında iyi ilerliyorsun, kondisyon hedefi de eklemek ister misin?"
- AI bu önerileri Katman 2'deki davranış kalıplarından ve hedef uyumluluk matrisinden (bkz. 6.2) çıkarır.
- Öneri sıklığı: ayda en fazla 1-2 yeni hedef önerisi. AI sürekli yeni hedef bombardımanı yapmaz.

### 6.5 Plateau Yönetimi

**Plateau tespiti:** AI 3 hafta ve üzeri kilo durağanlığını (±0.3 kg bandında kalma) otomatik olarak tespit eder. Tespitte şunları kontrol eder: kilo verisinin düzenli girilip girilmediği, kalori alımında gerçek bir değişim olup olmadığı, kas kütlesi artışı ihtimali (özellikle güç antrenmanı yapıyorsa).

**Plateau stratejileri — AI kullanıcıya şu seçenekleri sunar:**

1. **Kalori döngüsü (calorie cycling):** Hafta içi ve hafta sonu kalori aralıklarını farklılaştırma. Metabolik adaptasyonu kırmak için standart yaklaşım.
2. **Refeed günü:** Haftada 1 gün kaloriyi bakım seviyesine çıkarma. AI hangi günün en uygun olduğunu önerir (genellikle en yoğun antrenman günü).
3. **TDEE yeniden hesaplama:** Kilo değiştikçe günlük kalori ihtiyacı da değişir. AI mevcut kiloya göre yeni TDEE hesaplayıp hedef açığını yeniden belirler.
4. **2 hafta bakım modu:** Kalori açığını kapatıp bakım kalorilerinde iki hafta geçirme. Metabolik hız sıfırlanması için zaman zaman gerekli olabilir.
5. **Antrenman değişikliği:** Aynı programa alışma ihtimali varsa AI antrenman çeşitliliği veya yoğunluk değişikliği önerir.

AI kullanıcıya tüm seçenekleri listelemez; profil verisine göre en uygun 1-2 stratejiyi önerir, kısa gerekçesiyle birlikte. Kullanıcı onaylar, AI planı günceller.

### 6.6 Hedefe Ulaşma ve Bakım Modu (Maintenance)

Hedefe ulaşmak sürecin yarısıdır. Kullanıcıların çoğunluğu hedefe ulaştıktan sonraki 6 ayda geri alır. Bakım modu bu riski yönetir:

**Geçiş süreci (Reverse Diet):**
- Hedefe ulaşıldığında AI kalori açığını ani kapatmaz. 2-4 haftalık kademeli artış planı oluşturur (reverse diet).
- Her hafta kalori aralığı ~100-150 kcal yukarı çekilir, ta ki bakım kalorilerine ulaşılana dek.
- Geçiş sırasında AI tartı verisini yakından izler; beklenenden fazla artış olursa artış hızını yavaşlatır.

**Bakım kalori aralığı:**
- TDEE bazlı bakım kalorisi hesaplanır (ne açık ne fazla)
- Bu yeni hedef aralığı olarak kullanıcıya sunulur
- Kullanıcı bakım modunda olduğunu her zaman görebilir

**Tolerans bandı:**
- Hedef kilodan +/- 1.5 kg tolerans bandı belirlenir (kullanıcı ayarlayabilir)
- AI tartı verilerini bu banda göre izler
- Band aşılırsa AI proaktif uyarı gönderir: "Hedefinden 2 kg uzaklaştın, mini cut planlayalım mı?"
- Mini cut: 2-4 haftalık kısa kalori açığı dönemi, tam diyete dönüş değil

**Koçluk odağı değişimi:**
- Bakım modunda AI'ın odağı kilo kaybından kilo korumaya kayar
- Davranış pekiştirme ön plana çıkar: "3 aydır hedef kilonda tutunuyorsun, alışkanlıkların oturmuş"
- Streak ve motivasyon metrikleri farklılaşır: kalori uyumu yerine kilo stabilite günleri

**Retention değeri:**
- Bakım modu kullanıcıyı uygulamada tutar. Hedefe ulaşan kullanıcı uygulamayı silmez çünkü bakım aktif olarak yönetiliyor.
- AI hedefe ulaşmayı kutlar ama "şimdi asıl süreç başlıyor" mesajını verir

### 6.7 Çok Fazlı Hedef Planlaması (Cut/Bulk Döngüsü)

Özellikle güç sporcuları ve vücut kompozisyonu hedefi olan kullanıcılar için sıralı hedef fazları desteklenir:

- **Faz tanımlama:** Kullanıcı birden fazla ardışık hedef fazı tanımlayabilir: "Önce 75 kg'a in (cut), sonra 3 ay bulk yapıp 80 kg'a çık, sonra tekrar 77 kg'a in (mini cut)."
- **Otomatik faz geçişi:** AI bir faz tamamlandığında (hedefe ulaşıldığında veya süre dolduğunda) otomatik olarak sonraki faza geçer. Geçişler ani değil kademeli yapılır: cut → bulk geçişinde reverse diet, bulk → cut geçişinde kademeli kalori azaltma.
- **Faz arası görünürlük:** Kullanıcı tüm fazları ve mevcut konumunu bir zaman çizelgesinde görebilir.
- **Esneklik:** Kullanıcı bir faz ortasında plan değiştirebilir, faz ekleyebilir veya çıkarabilir. AI yeni plana göre kalori ve makro hedeflerini yeniden hesaplar.
- Her fazın ayrı TDEE hesabı, makro dağılımı ve hedef temposu olur. AI faz geçişlerinde Katman 2'ye not düşer.

---

## BÖLÜM 7: PLAN ÜRETİMİ VE YÖNETİMİ

### 7.1 Plan Türleri

**Günlük beslenme planı:**
- Günün hedefleri: kalori aralığı (antrenman/dinlenme gününe göre ayrı aralık), protein alt sınırı, karbonhidrat/yağ hedefi, su hedefi
- IF modu aktifse tüm öğün önerileri yeme penceresine sığdırılır
- Öğün önerileri: her öğün için 2-3 seçenek
- Atıştırma yönetimi: tatlı krizi senaryosu, gece atıştırma alternatifi
- "Bugünün tek kritik odağı" (1 cümle)
- **Alerjen kontrolü:** Plan üretim aşamasında profildeki alerji/intolerans listesi guardrail olarak uygulanır — bu filtreyi geçemeyen hiçbir yemek plana giremez (bkz. 12.4)
- **Alkol planlaması:** Kullanıcı "akşam içki içeceğim" derse AI günün kalan bütçesini buna göre revize eder, önceki öğünlerde kalori tamponları oluşturur
- **Haftalık bütçe bağlamı:** Günlük plan, haftalık bütçe durumunu da gösterir ("Bu hafta şu ana kadar bütçende X kcal marjın var")

**Günlük antrenman planı:**
- O günün enerji durumuna ve önceki gün performansına göre
- Isınma, ana bölüm, soğuma
- Süre, RPE (zorlanma skoru) veya nabız aralığı
- Kullanıcının ekipman erişimine göre (ev / salon)
- Hedefe göre: yağ yakımı, kondisyon, güç, mobilite
- Sakatlık/risk limitleri dikkate alınır
- Mümkünse görsel tarif (egzersiz görselleri/animasyonları)
- **Güç antrenmanı varsa:** set-rep-ağırlık hedefleri planın içinde yer alır (bkz. 7.5)

**Haftalık menü planı (proaktif planlama):**
- Kullanıcı "bu haftanın menüsünü planla" diyebilir
- AI 5-7 günlük öğün listesi üretir, kullanıcı onaylar veya değiştirir
- Onaylanan menüden otomatik alışveriş listesi üretilir
- Kullanıcı menüdeki öğünleri sürükle-bırakla yer değiştirebilir
- Yarın ne pişireceğini bugünden planlama: "yarın akşam şunu pişireceğim" kaydı alınır, AI ertesi günün planına entegre eder

**Harici listeler:**
- Alışveriş listesi: haftalık/günlük diyet planına göre otomatik üretilir
- Supplement hatırlatma listesi

### 7.2 Plan Üretim Döngüsü

**Tetikleyiciler:**
- Zaman bazlı: her sabah belirlenen saatte veya uygulamayı ilk açtığında
- Olay bazlı: kullanıcı yeni hedef girdiğinde, profil önemli ölçüde değiştiğinde, dönemsel durum değiştiğinde
- Periyodik: her hafta başı haftalık revizyon

**Plan üretirken AI şu verileri çeker:**
- Tam kullanıcı profili (Katman 1)
- AI özeti (Katman 2): kalıplar, tercihler, geçmiş performans
- Son 14 gün kayıtları (Katman 3): öğün, antrenman, kilo, uyku, stres, alkol
- Aktif hedef ve mevcut tempo
- Aktif dönemsel durum
- Haftalık kalori bütçesi durumu

**Güncelleme kuralları:**
- Büyük değişim yoksa plan haftalık güncellenir
- Büyük değişim varsa anında güncellenir: hedef değişikliği, dönemsel durum, ciddi sapma, sağlık durumu değişikliği
- Her güncelleme kullanıcıya bildirilir: ne değişti, neden değişti

**Plan reddetme akışı:**
Kullanıcı üretilen planı beğenmeyebilir: "Bu planı beğenmedim, başka bir şey yap." Bu durumda AI kısa bir iterasyon başlatır:
- AI neden beğenmediğini sorar: "Neresini beğenmedin — yemek seçenekleri mi, porsiyon büyüklüğü mü, yoksa genel yaklaşım mı?"
- Kullanıcı sebep verirse AI o eksene göre yeni plan üretir.
- Kullanıcı sebep vermeden "komple farklı" derse AI tamamen farklı yemek/antrenman kombinasyonuyla yeni plan oluşturur, aynı makro hedeflerini koruyarak.
- Ardışık 3 reddetmede AI daha geniş bir soru sorar: "Sana daha uygun plan yapabilmem için sevdiğin/sevmediğin yemekleri güncelleyelim mi?" — profil güncelleme akışına yönlendirir.

### 7.3 Plan Versiyon Geçmişi ve Geri Alma

- Plan değişikliği geçmişi tutulur
- En az son 5 versiyon saklanır
- Kullanıcı önceki versiyona dönebilir
- Her versiyon: tarih, değişen maddeler, değişim sebebi

### 7.4 Dışarıda Yemek Planlama

- Kullanıcı "akşam dışarıda yemeğe çıkıyorum" dediğinde AI gün planını proaktif revize eder
- Restoran/fast food senaryosunda en az hasarlı seçenekleri önerir
- "McDonald's'tayım" → "Big Mac yerine Grilled Chicken Salad al, yanında su, toplam ~450 kcal"
- Kayıtlı mekansa AI hafızasındaki onaylı makro tahminini kullanır

### 7.5 Güç Antrenmanı Progresyon Planı

Kullanıcı antrenman stilini "ağırlık/güç ağırlıklı" veya "karma" seçmişse bu modül aktif olur.

**Hareket takibi:**
- AI kullanıcının yaptığı temel hareketleri takip eder (squat, deadlift, bench press, overhead press, row ve kullanıcı tanımlı hareketler)
- Her hareket için son 4 haftanın set-rep-ağırlık geçmişi Katman 3'te tutulur
- AI tahminî 1RM değerlerini hesaplar ve Katman 2'de saklar

**Progresif aşırı yüklenme (progressive overload):**
- AI her antrenman için bir öncekine göre ilerleyen hedefler belirler: ağırlık artışı, rep artışı veya set artışı
- Kullanıcı bir harekette 2 ardışık seansta hedefi tutturmuşsa AI bir sonraki seans için yük artışı önerir
- Kullanıcı hedefi tutturamadıysa AI aynı ağırlıkta kalmayı veya deload seçeneğini sunar

**Deload haftası:**
- AI 4-6 haftalık yoğun antrenman döneminin ardından otomatik olarak deload önerir
- Deload: aynı hareketler, %60-70 ağırlıkla, düşük set sayısıyla — tamamen durma değil
- Kullanıcı onaylamazsa AI deload yapmadan devam eder ama riski not eder

**Güç progresyon raporu:**
- Haftalık raporda ayrı bir bölüm: hangi harekette ne kadar güçlenildi
- "Squat'ında 4 haftada 10kg ilerledi" gibi somut ilerleme göstergesi

### 7.6 Meal Prep / Toplu Hazırlık Planı

- Kullanıcı profilde meal prep yapıp yapmadığını ve hangi gün(ler) hazırladığını belirtebilir
- AI haftalık menü üretirken bunu dikkate alır: "Bu 7 yemeğin 4'ünü pazar günü hazırlayabilirsin"
- Meal prep planı ayrı bir çıktı olarak verilir: hazırlık sırası, saklama talimatları, hangi yemek kaç gün dayanır
- AI mevsime göre saklama süresini ayarlar (yazın daha kısa)
- Kullanıcı meal prep yapmıyorsa bu özellik gizli kalır, zorlanmaz

### 7.7 Tarif Kütüphanesi

- AI'ın sohbet içinde verdiği her tarif kaydedilebilir
- Kayıt: "Bu tarifi kaydet" butonu veya sohbette "bunu kaydet" komutu
- Kaydedilen tarifler ayrı bir ekranda listelenir, filtrelenebilir (kahvaltı/öğle/akşam, protein ağırlıklı, hızlı, vb.)
- AI haftalık menü planlarken kayıtlı tarifleri de dikkate alır
- Kullanıcı kayıtlı tarifi düzenleyebilir (malzeme değişikliği, porsiyon ayarı)
- AI "bu tarifi en son 3 hafta önce yapmışsın, tekrar koyalım mı?" diye önerebilir

---

## BÖLÜM 8: RAPORLAMA VE ANALİTİK

### 8.1 Günlük Rapor (Gün Sonu Kapanış)

Her günün sonunda otomatik üretilir veya ertesi gün ilk girişte gösterilir:

- Bugün hedefe uyum puanı (0-100)
- Kalori/makro hedefi ne kadar tuttu (kalori, protein, karbonhidrat, yağ ayrı ayrı)
- Alkol kaynaklı kalori (varsa, ayrı satırda)
- Spor hedefi tuttu mu
- Su hedefi tuttu mu
- Uyku etkisi
- Adım sayısı (telefon sensöründen veya wearable'dan)
- Sapma nedeni — AI sınıflandırır: stres, açlık yönetimi, dışarıda yemek, plansız atıştırma, sosyal etkinlik, alkol
- **Haftalık bütçe durumu:** Bugünkü tüketim sonrası haftalık bütçeden ne kadar kaldı
- Yarın için tek aksiyon (en yüksek etkili hamle)
- Kapanış raporu hem metin hem basit grafiklerle gösterilir

### 8.2 Haftalık Rapor (Koç Raporu)

Her hafta sonu otomatik üretilir:

- Kilo trendi (7 gün)
- Uyum ortalaması
- **Haftalık kalori bütçesi uyumu:** Haftalık toplam tüketim vs haftalık bütçe
- En çok sapılan konu
- En başarılı gün / en kötü gün analizi
- Protein trendi
- Karbonhidrat ve yağ trendi
- Alkol kaynaklı toplam kalori (varsa, ayrı satır)
- Su tüketim trendi
- Uyku trendi
- Adım trendi
- **Güç progresyon özeti** (antrenman stili güç ağırlıklıysa): hangi harekette ne kadar ilerlendi
- **Mikro besin farkındalık notu** (varsa): "Bu hafta kalsiyum kaynağı az tüketildi" gibi kısa uyarı
- **AI öğrenme notu** (varsa): "Bu hafta seni daha iyi tanıdım" formatında 1-2 cümlelik gözlem (bkz. 5.21)
- Bir sonraki hafta stratejisi
- Plan revizyonu önerisi (kalori aralığı, antrenman hacmi, öğün sayısı değişikliği)

### 8.3 Aylık Rapor

- Hedefe ne kadar yaklaşıldı
- Tahmini trend devam ederse hedefe varış tarihi
- Kilo ve bel çevresi trendi
- Risk sinyalleri: aşırı kısıt, aşırı yorgunluk, uyku bozukluğu, motivasyon düşüşü, plateau
- Davranış kalıpları özeti
- Kan değerleri trendi (varsa)

### 8.4 Tüm Zamanlar Raporu

- Başlangıçtan bugüne toplam ilerleme
- En uzun uyum serisi (streak)
- Kilometre taşları
- Davranış evrimi: "3 ay önce haftada 2 gün sapıyordun, şimdi haftada 0.5"

### 8.5 Görsel Dashboard

Aşağıdaki veriler ayrı ayrı ekranlarda gösterilir:

- Kilo grafiği (zaman serisi)
- Bel ölçüsü grafiği
- İlerleme fotoğrafları zaman çizelgesi (varsa)
- Uyum grafiği (günlük puanlar)
- Kalori trendi
- Protein trendi
- Karbonhidrat ve yağ trendi
- Alkol kalori trendi (varsa)
- Su tüketim trendi
- Uyku trendi
- Adım trendi
- Stres/ruh hali trendi (varsa)
- En iyi günler / en kötü günler analizi
- Hedefe kalan yol göstergesi
- **Haftalık bütçe uyum grafiği** (hafta hafta bütçe performansı)
- **Güç antrenmanı grafiği** (aktifse): hareket bazlı 1RM trendi

### 8.6 Takvim/Zaman Çizelgesi Görünümü

- Kullanıcı geçmiş günlere takvim üzerinden bakabilir
- Her günün özeti: ne yedi, ne kadar spor yaptı, uyum puanı
- AI de bu görünümü referans alabilir: "geçen salı da aynı saatte sapma yapmıştın"

### 8.7 Sağlık Profesyoneli Rapor Exportu

Kullanıcı diyetisyenine, doktoruna veya PT'sine göstermek için yapılandırılmış rapor alabilir:

- **PDF export:** Seçilen tarih aralığında kalori trendi, makro dağılımı, kilo trendi, antrenman özeti, uyku trendi
- **Kan değerleri trendi** (varsa)
- **Format:** Profesyonele hitap eden düz veri formatı, sadece sayılar ve grafikler. AI yorumları opsiyonel olarak dahil edilebilir veya çıkarılabilir.
- **Gizlilik:** Kullanıcı raporda hangi verilerin yer alacağını seçer
- Bu özellik B2B modu (Bölüm 20.1) devreye girmeden önce bile kullanıcının kendi inisiyatifiyle kullanılabilir
- Export formatları: PDF (varsayılan), CSV (ham veri)

---

## BÖLÜM 9: DÖNEMSEL DURUM YÖNETİMİ

### 9.1 Desteklenen Dönemsel Durumlar

- Ramazan / oruç
- Bayram
- Tatil
- Hastalık
- Yoğun iş dönemi
- Sınav dönemi
- Hamilelik
- Emzirme dönemi
- Sakatlanma / iyileşme dönemi
- Seyahat (farklı timezone, farklı mutfak)
- Kullanıcının tanımladığı özel dönem

### 9.2 Dönemsel Durum Akışı

- Kullanıcı "bu hafta tatildeyim" veya "oruç tutuyorum" diyebilir
- AI planları buna göre tamamen yeniden ayarlar
- AI tatilin/dönemin ne zaman biteceğini sorar
- Bitiş zamanına göre geçiş planı hazırlar: tatilden dönüş planı, ramazan sonrası plan
- Dönem bittiğinde AI normal plana geçiş yapar — ani değil kademeli

### 9.3 Dönemsel Durum Hafızası

- AI geçmiş dönemsel durumları özetleyip Katman 2'ye yazar
- "Geçen ramazanda 3 kg almıştın, bu ramazan daha kontrollü geçirelim" gibi bağlam sağlar
- Tatil dönüşlerinde geçmiş dönüş performansını referans alır

### 9.4 Aralıklı Oruç (IF) Dönemsel Yönetimi

IF, sürekli bir yaşam tarzı tercihi olarak profil verisine işlenir (bkz. Bölüm 2.1). Ancak kullanıcı IF'i dönemsel olarak da başlatıp durdurabilir.

- "Bu hafta 16:8 deneyeceğim" → AI o haftanın planını pencereye göre düzenler
- IF denemesi ilk kez yapılıyorsa AI kısa bir uyum süreci tanımlar: ilk 3-5 gün yeme penceresi 1 saat daha geniş tutulur, sonra hedefe ulaşılır
- AI pencerenin dışındaki öğün/atıştırma önerilerini ve hatırlatmalarını o süre için kaldırır
- Kullanıcı IF'ten çıkıyorsa normal öğün düzenine kademeli geçiş planı sunar

---

## BÖLÜM 10: BİLDİRİM SİSTEMİ

### 10.1 Bildirim Türleri ve Tetikleyicileri

- Sabah planı: her gün belirlenen saatte günün planı ve "bugünün tek odağı"
- Öğün saati hatırlatma: belirlenen öğün saatlerinde kayıt yoksa (IF modunda pencereye göre)
- Spor saati hatırlatma: planlanan antrenman saatinde
- Öğün atlama uyarısı: beklenen öğün saatinden X dakika geçmişse kayıt yoksa
- Su hatırlatma: hedefin gerisindeyse gün içinde
- Gece atıştırma riski: kullanıcının profilde belirlenmiş risk saatlerinde
- Gün sonu kapanış daveti: akşam belirlenen saatte "günü kapatalım mı?"
- Tartı hatırlatma: 1 haftadır tartı kaydı girilmemişse
- Haftalık rapor: hafta sonu
- Dönemsel sorgulama: "tatilin ne zaman bitiyor?"
- Motivasyon/başarı: streak, milestone, kişisel rekor
- **Plateau uyarısı:** 3 hafta durağanlık tespitinde
- **Challenge hatırlatması:** aktif challenge varsa ilgili günlük bildirim (bkz. Bölüm 13.5)
- **Prediktif uyarı:** Hafta sonu sapma riski, atıştırma saati, alkol-sapma tahmini gibi tahmini tetikleyiciler (bkz. 5.14)
- **Bakım bandı uyarısı:** Bakım modundayken tolerans bandı aşılırsa (bkz. 6.6)
- **Uyku zamanı hatırlatma:** Uyku saatine yakın app kullanımında

### 10.2 Bildirim Kuralları

- Günlük bildirim üst sınırı kullanıcı tarafından ayarlanabilir (varsayılan: 5)
- Her bildirim türü ayrı ayrı açılıp kapatılabilir
- Sessiz saatler ayarlanabilir
- AI aynı anda birden fazla bildirim göndermez, önceliklendirip birini seçer
- Bildirim spam'i en büyük retention düşmanı; az ama isabetli bildirim prensibi

### 10.3 Bildirim İzni UX Akışı

Bildirim izni stratejik zamanda istenir:

- İlk açılışta hemen istemez (kullanıcıların çoğu reddeder)
- İlk bildirim tetiklenme gereksinimi doğduğunda contextual olarak istenir: "Sabah planını göndermemi ister misin?" sorusuna "Evet" dendikten sonra sistem bildirim izni ister
- Reddedildiyse 3-5 gün sonra farklı bir bağlamda tekrar teklif edilir (ör: "Spor saatini hatırlatmamı ister misin?")
- 2 kez reddedildiyse tekrar sorulmaz; Ayarlar'dan kullanıcı istediği zaman açabilir
- İzin durumu profilde saklanır

### 10.4 Re-engagement (Geri Dönüş) Akışı

Kullanıcı uygulamayı açmayı bıraktığında kademeli geri dönüş stratejisi:

- **3 gün sessizlik:** Hafif push notification: "Bir süredir görüşmedik, bugün nasılsın?" (basit, yargılamayan)
- **7 gün sessizlik:** Daha kişisel bildirim, AI Katman 2'den veri kullanarak: "Son hafta protein hedefini tutturma rekoru kırmıştın, devam edelim mi?" veya "Streak'in 23 gündeydi, kaldığın yerden devam edebiliriz"
- **14 gün sessizlik:** E-posta ile geri dönüş (uygulama içi bildirim yetersiz kaldığında)
- **30 gün sessizlik:** Son e-posta denemesi
- **30+ gün sessizlik:** Bildirim gönderilmez, kullanıcı kendi gelirse geri dönüş akışı devreye girer

**Geri döndüğünde:**
- AI yargılamaz: "Hoş geldin, nereden devam edelim?" tonu
- Streak sıfırlanmış olsa bile yeni başlangıç tonu kullanılır
- İlk 3 gün plan hafifletilir (uzun süredir kullanmayan kullanıcı direkt agresif planla karşılaşmaz)
- AI geri dönüş sebebini sorabilen ama zorlamayan bir sohbet başlatır
- Kullanıcının eski verileri korunur, önceki ilerleme gösterilir: "Son kaldığında 82 kg'daydın, şu an kendini nerede hissediyorsun?"

**Uzun süreli yokluk sonrası re-onboarding (6+ ay):**
Uzun süredir kullanmayan kullanıcı geri döndüğünde fiziksel verileri tamamen değişmiş olabilir. AI standart geri dönüş akışına ek olarak:
- Kritik profil verilerini güncelleme isteği: "Uzun süredir görüşmedik. Seni güncelleyelim — şu anki kilondan başlayalım, değişen bir şey var mı?" Minimum güncelleme: mevcut kilo, aktivite seviyesi, hedef.
- TDEE yeniden hesaplanır; eski verilere dayalı plan üretilmez.
- Katman 2 özeti gözden geçirilir: AI "bu bilgiler hâlâ geçerli mi?" diye sorar (özellikle ilaçlar, sağlık durumu, yaşam tarzı).
- İlk 1 hafta adaptasyon dönemi olarak işlenir: daha geniş kalori aralığı, daha az bildirim, daha yumuşak ton.
- AI bu re-onboarding akışını Katman 2'ye yazar: "Kullanıcı [tarih] itibarıyla 7 ay aradan sonra döndü, profil güncellendi."

---

## BÖLÜM 11: OFFLINE VE SENKRON

### 11.1 Offline Çalışan Özellikler

- Tüm kayıt girişleri (öğün, spor, su, tartı, alkol, not)
- **Barkod tarama (kısıtlı):** Daha önce taranan ve cihazda cache'lenmiş ürünler offline çalışır. Yeni/bilinmeyen barkodlar çevrimdışıyken taranabilir, barkod numarası kaydedilir ve internet geldiğinde veritabanı lookup yapılır. Kullanıcıya "bu ürün çevrimiçi olduğunda eşleştirilecek, şimdilik metin olarak gir" mesajı gösterilir.
- Form doldurma ve veri ekleme/düzenleme
- Profil görüntüleme ve düzenleme
- Geçmiş kayıtları görüntüleme
- Mevcut plan görüntüleme
- Grafikler ve raporlar (son senkron verileriyle)

### 11.2 Online Gerektiren Özellikler

- AI ile sohbet
- Plan üretimi ve revizyonu
- Fotoğraf analizi
- Sesli giriş işleme
- AI özel takip kıstası oluşturma
- Yeni rapor üretimi
- Yeni barkod veritabanı lookup (cache'de olmayan ürünler)

### 11.3 Senkronizasyon

- Offline girilen kayıtlar internet bağlantısı geldiğinde otomatik senkronize olur
- AI senkron sonrası değişimleri görür ve gerekirse mesaj yazar, plan günceller

**Çakışma yönetimi (veri tipine göre farklı strateji):**
- **Kayıt verileri (öğün, spor, tartı, su, uyku, alkol):** Append stratejisi. Her iki cihazdaki kayıtlar da saklanır, hiçbir kayıt silinmez. Aynı zaman damgalı çakışan kayıtlarda her iki veri korunur ve kullanıcıya "iki farklı kayıt var, hangisi doğru?" sorulur. Sağlık verisinde kayıp kabul edilemez.
- **Profil değişiklikleri:** Last-write-wins. Son tercih geçerli olur çünkü profil verisi kullanıcının güncel kararını yansıtır.
- **Plan verileri:** Sunucu versiyonu öncelikli. Plan AI tarafından üretildiği için sunucu versiyonu her zaman geçerlidir. Plan durumu (onaylanmış/görülmüş) da senkronize edilir.

- Senkron hatası kullanıcıya bildirilir, veri kaybı önlenir: cihaz yerel verisi korunur

---

## BÖLÜM 12: GÜVENLİK VE GUARDRAIL SİSTEMİ

### 12.1 Beslenme Guardrail'leri

- **Mutlak alt taban (hiçbir koşulda altına inilmez):** Kadınlar için 1.200 kcal/gün, erkekler için 1.400 kcal/gün. Bu sınır agresif modda bile aşılamaz. Bu rakamlar sabit güvenlik tabanıdır, dinamik hesaplamadan bağımsızdır. **İstisna:** Hamile ve emziren kullanıcılar için mutlak taban daha yüksektir (bkz. 2.4 hamilelik TDEE ayarlaması). Hamile kullanıcılara kalori açığı planı sunulmaz.
- **Dinamik önerilen minimum:** Kullanıcının kilosuna, boyuna, yaşına ve aktivite seviyesine göre hesaplanan kişisel alt sınır (bkz. Bölüm 2.4 TDEE hesabı). Bu değer mutlak tabandan her zaman yüksektir. Örneğin 90 kg, aktif bir erkek için dinamik minimum 1.800 kcal olabilir — AI bu değerin altına düşmez.
- Protein alt sınırı her zaman korunur
- Uzun açlık önerisi engellenir — özellikle mide ameliyatı geçmişi olan kullanıcılar için
- Aşırı agresif kilo kaybı temposu (haftada 1 kg'dan fazla) uyarıyla engellenir
- Öneriler her zaman aralık verir, tek rakama kilitlemez
- **Gerçekleşen kilo değişim hızı guardrail'i:** AI sadece hedef tempoyu değil, gerçekleşen kilo değişim hızını da izler. Haftada 1.5 kg'dan fazla kilo kaybı (2+ hafta üst üste) tespit edilirse AI uyarı verir ve kalori tabanını yukarı çeker — bu, kullanıcı kayıtlarının planla uyumlu olduğu durumlarda bile geçerlidir. Ani hızlı kilo kaybı su kaybı/kas kaybı riski taşır ve sağlık açısından izlenmesi gereken bir sinyaldir. Aynı mekanizma hızlı kilo alımı için de çalışır (haftada 1 kg+ alım 3+ hafta). AI bu durumları Katman 2'ye yazar ve gerekirse doktora yönlendirir.

### 12.2 Egzersiz Guardrail'leri

- Riskli yoğunluk engellenir
- Sakatlık/engel bilgisi olan kullanıcılara uygun olmayan egzersizler önerilmez
- Uyku eksikliğinde yoğun antrenman önerilmez
- Ard arda yoğun antrenman günleri sınırlandırılır
- **Güç antrenmanı progresyon guardrail'i:** Kullanıcı deload önerisini reddedip 8 haftadan uzun süre yüksek yoğunlukta devam ederse AI tekrar uyarı gönderir, risk notunu Katman 2'ye yazar

### 12.3 Tıbbi Guardrail'ler

- AI hiçbir zaman klinik teşhis dili kullanmaz
- Kan değerlerinde ciddi sapma gördüğünde "doktora git" uyarısı tetiklenir
- İlaç etkileşimi soruları direkt doktora yönlendirilir
- Aşırı hızlı kilo kaybı/alımı uyarısı
- Yeme bozukluğu belirtileri tespit edilirse dikkatli yaklaşım ve profesyonele yönlendirme (detaylı akış: bkz. 5.6 Yeme Bozukluğu Risk Yönetimi)
- **Acil durum tespiti:** Ciddi sağlık belirtileri bildirildiğinde AI koçluk modundan çıkar ve acil servise yönlendirir (detaylı akış: bkz. 5.6 Acil Durum Tespiti)

### 12.4 Alerjen Guardrail'i

Profildeki alerji ve intolerans bilgisi guardrail seviyesinde uygulanır — bu, AI'ın "dikkatli olmasını" beklemek değil, kod bazlı filtredir:

- AI plan üretirken, tarif önerirken ve haftalık menü oluştururken profildeki alerjen listesi zorla uygulanır
- Alerjen içeren yemek/tarif önerisi guardrail tarafından engellenir, AI çıktısına ulaşmaz
- Fıstık alerjisi olan kullanıcıya fıstıklı tarif, gluten intoleransı olana makarna tarifi asla önerilmez
- Bu kontrol 12.5'teki genel AI çıktı doğrulama katmanının bir parçasıdır
- Kullanıcı alerjisini profile eklediğinde veya güncellediğinde mevcut planlar otomatik kontrol edilir; ihlal varsa plan yeniden üretilir
- **Çapraz kontaminasyon farkındalığı:** Ciddi alerjilerde (anafilaksi riski: fıstık, kabuklu yemiş, deniz ürünleri vb.) AI sadece malzeme filtresi değil, çapraz kontaminasyon riski konusunda da farkındalık sağlar. Tarif önerirken "aynı tavada fıstıklı yemek pişirdiysen dikkat et" gibi uyarılar verir. Dışarıda yemek modunda ciddi alerjisi olan kullanıcıya "restoranda mutfağa alerjenini bildirmeyi unutma" hatırlatması yapar. Bu, kesin güvenlik garantisi değil farkındalık katmanıdır.

### 12.5 AI Çıktı Doğrulama

- AI çıktısı kullanıcıya ulaşmadan önce kural motorundan geçer
- Kural ihlali varsa AI çıktısı revize edilir veya engellenir
- Bu katman AI'dan bağımsız, kod bazlı çalışır
- Kontrol edilen kurallar: beslenme guardrail'leri (12.1), egzersiz guardrail'leri (12.2), tıbbi guardrail'ler (12.3), alerjen guardrail'i (12.4), saçma giriş kontrolü (12.6)

### 12.6 Saçma Giriş Kontrolü (Data Validation)

Kullanıcı veya AI'ın girdiği/parse ettiği veriler mantıksal kontrolden geçirilir:

**Sayısal kayıtlar:**
- Kilo girişinde önceki kayıttan %10+ sapma varsa doğrulama istenir: "85 kg'dan 77 kg'a düşmüşsün, bu doğru mu?"
- Kalori tahmini tek öğün için 3.000+ kcal ise doğrulama istenir
- Su kaydı tek seferde 2L+ ise doğrulama istenir
- Uyku süresi 14+ saat veya 2 saatten az ise doğrulama istenir

**Metin kayıtlar:**
- "50 yumurta yedim" gibi aşırı miktarlar AI tarafından yakalanır ve sorulur
- Birbiriyle çelişen kayıtlar (aynı saatte iki farklı öğün) tespit edilir

**Kural:** Bu kontroller kullanıcıyı engellemez, sadece doğrulama ister. Kullanıcı "evet doğru" derse kayıt olduğu gibi kaydedilir.

---

## BÖLÜM 13: BAŞARI VE MOTİVASYON SİSTEMİ

### 13.1 Streak Takibi

- Ardışık kayıt girilen gün sayısı
- "47 gündür her gün kayıt giriyorsun" mesajı
- Streak kırılma riski olduğunda hatırlatma
- **Bakım modunda:** Streak metriği kalori uyumu yerine kilo stabilite günlerine kayar (bkz. 6.6)

### 13.2 Milestone'lar

- İlk 1 kg
- İlk 5 kg
- Hedefin yarısı
- 7 gün tam uyum
- 30 gün streak
- 100 gün streak
- Hedefe ulaşma
- **Bakım milestone'ları:** 1 ay bakımda, 3 ay bakımda, 6 ay bakımda (hedefe ulaşanlar için)

### 13.3 Kişisel Rekorlar

- En yüksek uyum puanı haftası
- En uzun streak
- En iyi protein ortalaması haftası
- **Güç rekoru:** Bir harekette kişisel 1RM rekoru (ağırlık antrenmanı yapıyorsa)

### 13.4 Paylaşım

- İlerleme grafiği, haftalık rapor veya milestone paylaşılabilir
- Instagram story, WhatsApp, vb. export formatları
- Arkadaş davet etme mekanizması (viral büyüme kanalı)
- Gizlilik kontrolü: kullanıcı neyi paylaşacağını seçer, hassas veriler otomatik gizlenir
- İlerleme fotoğrafı paylaşımında yüz bulanıklaştırma seçeneği tekrar gösterilir

### 13.5 Challenge Modülü

Kısa süreli, somut hedefli meydan okumalar. Hem kullanıcı bağlılığını artırır hem de belirli alışkanlıkları pekiştirmek için araç olarak kullanılır.

**Challenge türleri:**
- Sistem tarafından sunulan challenge'lar: "7 günde şeker yok", "30 günde her gün 10.000 adım", "2 hafta protein hedefini tut", "14 günde her gün su hedefini tamamla"
- Kullanıcı tanımlı challenge: "kendime 21 günlük koşu challenge'ı atıyorum"

**Challenge akışı:**
- AI kullanıcının profiline ve mevcut zayıf noktalarına göre uygun challenge önerir: protein tutturma oranı düşükse protein challenge önceliklenir
- Kullanıcı kabul eder, süre başlar
- Her gün challenge ilerleme durumu dashboard'da görünür (mini bir bar veya ikon)
- Challenge bitişinde sonuç raporu: kaç günü başardı, genel uyum
- Başarıyla tamamlanan challenge'lar başarım bölümüne eklenir

**Challenge kuralları:**
- Aynı anda en fazla 2 aktif challenge
- Bir challenge ortasında bırakılabilir; bırakılma geçmişe not düşülür ama yargılanmaz
- **Challenge duraklatma:** Dönemsel durum devreye girdiğinde (hastalık, sakatlanma, seyahat vb.) aktif challenge otomatik olarak duraklatılır. AI kullanıcıya bildirir: "Hasta olduğun için 10.000 adım challenge'ını duraklattım, iyileşince devam ederiz." Dönemsel durum bittiğinde challenge kaldığı yerden devam eder. Kullanıcı duraklanan challenge'ı manuel olarak da bırakabilir veya devam ettirebilir.
- Challenge bildirimleri ayrıca açılıp kapatılabilir

---

## BÖLÜM 14: WEARABLE VE ENTEGRASYON

### 14.1 İleride Planlanacak Entegrasyonlar

- Apple Health / Google Fit / Samsung Health: adım, nabız, uyku verisi çekme
- Apple Watch / Garmin / Fitbit: egzersiz verisi
- **HRV (Kalp Atış Değişkenliği) ve antrenman hazırlığı:** Wearable'dan çekilen HRV verisi toparlanma durumunun objektif göstergesidir. AI düşük HRV gününde yoğun antrenman yerine hafif aktivite/mobilite önerir, yüksek HRV gününde zor antrenmanları planlar. Bu veri toparlanma kaydıyla (bkz. 3.1) birlikte değerlendirilir: subjektif his (kullanıcının kas ağrısı kaydı) + objektif veri (HRV) birlikte daha iyi karar verir.
- Akıllı tartı entegrasyonu
- Kan şekeri monitörleri (CGM) — uzak gelecek

### 14.2 Telefon Yerleşik Sensör Entegrasyonu

Wearable gerektirmeden telefonun kendi sensöründen çekilebilecek veriler:

- **Adım sayacı:** iOS Core Motion / Android Activity Recognition API. Arka planda çalışır, pil dostu. Kullanıcıdan izin alınır.
- Bu veri günlük aktivite hesabında, TDEE tahmininde ve antrenman planlamasında kullanılır
- Wearable bağlandığında wearable verisi otomatik olarak telefon verisinin yerini alır (daha doğru)
- Bu entegrasyon erken aşamada eklenebilir çünkü harici bağımlılığı yoktur

### 14.3 Veri Modeli Hazırlığı

- Veri modeli baştan bu entegrasyonları destekleyecek şekilde tasarlanmalı
- Her veri kaynağı etiketlenmeli: manuel giriş vs Apple Health vs Garmin vs barkod vs AI tahmini vs telefon sensörü
- Çakışma yönetimi: aynı veri iki kaynaktan gelirse hangisi geçerli (kullanıcı tercihine göre)

### 14.4 Data Import (Başka Uygulamadan Geçiş)

- Kullanıcı MyFitnessPal, Fatsecret, Samsung Health vb. uygulamalardan CSV/JSON export almışsa bunu Kochko'ya import edebilir
- Import edilen veriler geçmiş kayıt olarak kaydedilir; AI bu veriyi Katman 2 özeti oluştururken referans alır
- Başlangıçta basit CSV import yeterli; yapılandırılmış format belgelenir
- İleri aşamada popüler uygulamalar için hazır import template'leri sunulabilir

---

## BÖLÜM 15: ONBOARDING AKIŞI

### 15.1 Katman 1 — Kayıt ve Hızlı Başlangıç (2-3 dakika)

1. Kayıt yöntemi seçimi: Google / Apple / E-posta
2. **Yaş doğrulaması**: doğum yılı girişi — 18 yaş altı engellenir
3. Minimum profil girişi:
   - Boy
   - Kilo
   - Cinsiyet
   - Hedef (kilo vermek / kas kazanmak / sağlıklı yaşam / kondisyon)
   - Aktivite seviyesi
4. Bu bilgilerle ilk plan üretilir (TDEE hesabı bkz. Bölüm 2.4)
5. Diyet modu bu aşamada sorulmaz; varsayılan "Standart" olarak başlar. AI ilk sohbette diyet modunu sorar ve cevaba göre makro dağılımını günceller.

### 15.2 Katman 2 — AI Tanışma Sohbeti

İlk plan üretildikten sonra AI sohbet başlatır:
- Kendini kısa tanıtır (bkz. Bölüm 4.3)
- Temel birkaç soru sorar: yemek tercihleri, spor geçmişi, günlük rutin, bütçe, antrenman stili tercihi, IF kullanıp kullanmadığı, diyet modu tercihi
- **Porsiyon kalibrasyonu:** İlk sohbette veya ilk hafta içinde AI porsiyon büyüklüğü kalibrasyonu yapar (bkz. 5.23)
- Her cevabı otomatik profile yazar
- Agresif bilgi toplama başlar ama zorlamadan, doğal sohbet akışıyla

### 15.3 Katman 3 — Kademeli Profil Doldurma

- Sonraki günlerde AI sohbet sırasında eksik bilgileri öğrenmeye çalışır
- Profil tamamlanma yüzdesi kullanıcıya gösterilir
- "Profilini %40 daha doldurursan önerilerim çok daha isabetli olur" gibi teşvik

### 15.4 İlk Açılışta Ne Görüyor

- Kısa tanıtım (3-4 ekran, geçilebilir) — ne olduğu, nasıl çalıştığı, AI koç konsepti
- Hızlı başlangıç formu (yaş dahil)
- İlk plan üretimi
- AI sohbet ekranı açılır, koç kendini tanıtır
- **Bildirim izni bu aşamada istenmez** — ilk gerçek tetikleyici anında istenir (bkz. 10.3)

---

## BÖLÜM 16: ÜYELİK VE PREMIUM

### 16.1 Ücretsiz Plan

- Kayıt girişi (öğün, spor, su, tartı, alkol)
- **Barkod ile kayıt** (kayıt sürtünmesini azaltan temel araç, ücretsiz tutulur)
- Basit grafikler (kilo trendi, kalori trendi)
- **Basit hedef takibi:** Kullanıcı hedef koyabilir, kilo grafiğinde hedefe kalan mesafeyi görebilir, haftalık tartı trendi ve basit uyum yüzdesi gösterilir. Plan üretimi yapılmaz, ancak kullanıcı kendi kayıtlarının hedefle uyumunu görebilir.
- Profil yönetimi
- **Sınırlı AI erişimi:** Günde 5 mesaj hakkı. Kayıt parse mesajları (yedim/yaptım/içtim gibi kayıt girişleri) bu sayaçtan düşmez; sayaç sadece serbest sohbet, tarif isteme, analiz sorma gibi koçluk etkileşimleri için geçerlidir. Bu sayede kullanıcı kayıt girmekten korkup uygulamayı bırakmaz, aynı zamanda AI'ın tam koçluk değerini görerek premium'a geçmek ister. **Kötüye kullanım önlemi:** Bir mesajın kayıt parse olarak sayılması için AI'ın o mesajdan gerçekten bir kayıt (öğün, spor, su, tartı, alkol) oluşturması gerekir. AI kayıt parse sonucu boş dönerse veya kayıt oluşturmadıysa o mesaj serbest sohbet sayacından düşer.
- 7 günlük deneme süresi: tüm premium özellikler açık (kredi kartı gerekmez)
- **Telefon adım sayacı** (ek maliyet yaratmaz, temel aktivite takibi sağlar)

**Ücretsiz plan felsefesi:** Kullanıcı ücretsiz planda bile uygulamayı kullanabilir hissetmeli. Tamamen boş bırakılmış bir ücretsiz plan kullanıcıyı silmeye iter, sınırlı ama değerli bir ücretsiz plan ise premium'a geçme motivasyonu yaratır.

### 16.2 Premium Plan

- AI sohbet (sınırsız günlük koçluk)
- Günlük plan üretimi
- Haftalık/aylık revizyon
- Gün sonu kapanış raporu
- Haftalık koç raporu (AI öğrenme notu dahil)
- Lab modülü (kan değerleri)
- Gelişmiş raporlar ve analizler
- **Sağlık profesyoneli rapor exportu** (bkz. 8.7)
- Fotoğraf ile kayıt
- Sesli giriş
- Alışveriş listesi
- Haftalık menü planlama
- Meal prep planı
- Tarif kütüphanesi
- AI özel takip kıstasları
- Proaktif koçluk bildirimleri
- Dönemsel plan ayarlaması
- İlerleme fotoğrafı takibi
- Güç antrenmanı progresyon takibi
- Challenge modülü
- Plateau yönetimi stratejileri
- **Bakım modu (maintenance)** (bkz. 6.6)
- Prediktif analitik (sapma tahmini)
- Simülasyon modu ("şunu yesem ne olur?")
- **Haftalık kalori bütçe takibi** (bkz. 2.6)
- **Porsiyon kalibrasyonu** (bkz. 5.23)
- **Çok fazlı hedef planlaması** (bkz. 6.7)

### 16.3 Ödeme ve Abonelik Akışı

- 7 günlük ücretsiz deneme: kayıt sırasında veya herhangi bir premium özelliğe ilk dokunuşta tetiklenir
- Deneme süresi dolmadan 2 gün önce hatırlatma bildirimi: "Deneme süren 2 gün içinde bitiyor"
- Ödeme ekranı: aylık / yıllık seçenek (yıllık ~30% indirimli)
- Upsell trigger noktaları:
  - Kullanıcı AI sohbet limitine ulaştığında (ücretsiz kullanıcılar için)
  - Haftalık rapor ekranında "detaylı raporu gör" butonu
  - Plan üretimi isteğinde
  - Fotoğraf ile kayıt denemesinde
  - Simülasyon modu denemesinde
- Fatura geçmişi: Ayarlar > Abonelik ekranında
- İptal akışı: kullanıcı neden iptal ettiğini seçer (opsiyonel), iptal sonrası dönem sonuna kadar premium devam eder

### 16.4 API Maliyet Yönetimi

- Premium'un değer önerisi tamamen AI plan üretimine dayanıyor = API maliyeti
- Kullanıcı başına günlük tahmin: 3-4 API call (sabah plan + kayıt parse + gün sonu rapor + mikro koçluk)
- Her call context-heavy (profil + son 14 gün verisi)
- Kullanıcı başına aylık API maliyeti fiyatlamadan önce hesaplanmalı
- Gereksiz API call'ları minimize edilmeli: sık tekrar eden kısa kayıtlar (su takibi, tartı girişi) AI'a gönderilmeden yerel parse edilir, sadece kompleks sohbet/plan AI'a iletilir
- **Yerel vs AI parse kuralı:** Su kaydı, tartı kaydı, uyku kaydı ve favori şablon tekrarı gibi yapısal kayıtlar client-side işlenir, AI'a gönderilmez. Serbest metin öğün kaydı, fotoğraf, sesli giriş ve sohbet mesajları AI'a gönderilir. Makro toplamları client-side güncellenir (AI parse sonucundaki değerler lokal toplama eklenir), dashboard anlık güncelleme için AI'a bağımlı değildir.
- Ücretsiz kullanıcılar günde 5 mesaj (kayıt parse hariç) = düşük API maliyeti, premium dönüşüm teşviki
- Token bütçeleme (bkz. 5.1) API maliyetini doğrudan etkiler; Katman 3 budaması gereksiz token harcamasını önler
- **Mod bazlı LLM parametreleri** (bkz. 5.24) maliyet verimliliği sağlar: basit kayıt parse işleri düşük token tüketen parametrelerle yapılır
- **Premium rate limiting:** Premium "sınırsız" demek saatte 1000 mesaj demek değildir. Makul kullanım sınırları uygulanır: saatte 30 mesaj, günde 200 mesaj üst sınırı. Bu sınırlar normal kullanıcıyı etkilemez (tipik günlük kullanım 10-20 mesaj) ama bot/abuse'u engeller. Sınıra ulaşılırsa kullanıcıya "biraz mola verelim" mesajı gösterilir.

### 16.5 Premium İptal ve Downgrade Akışı

Premium aboneliğini iptal eden kullanıcının deneyimi tanımlı olmalıdır:

**İptal anında:**
- Kullanıcıya "Aboneliğin [tarih]'e kadar aktif, o tarihe kadar tüm premium özellikler kullanılabilir" bilgisi gösterilir

**Premium süresi dolduğunda (downgrade):**
- **Mevcut planlar:** Son üretilen plan salt okunur olarak görüntülenebilir, yeni plan üretimi durdurulur
- **Katman 2 (AI Özeti):** Korunur ancak güncellenmez. Kullanıcı tekrar premium olursa AI kaldığı yerden devam eder. Ücretsiz plandaki 5 mesaj hakkı içindeki etkileşimlerden de öğrenme yapılmaz (Katman 2 dondurulur).
- **Güç progresyon verileri:** Geçmiş verileri görüntülenebilir, yeni progresyon planı üretilmez
- **Raporlar:** Geçmiş raporlar görüntülenebilir, yeni detaylı rapor üretilmez. Basit günlük kalori/makro özeti ücretsiz planda devam eder.
- **Bakım modu:** Bakım modundaki kullanıcı downgrade olursa bakım bandı takibi durur, kullanıcı ücretsiz plan özelliklerine döner. Premium'a tekrar geçerse AI bakım modunu kaldığı yerden sürdürür.
- **Challenge'lar:** Aktif challenge'lar dondurulur. Premium'a dönülürse devam edebilir.
- **Kayıt özellikleri:** Metin bazlı kayıt ve barkod ücretsiz olduğu için devam eder. Fotoğraf ve sesli giriş durdurulur.
- **Bildirimler:** Proaktif koçluk bildirimleri durdurulur, sadece temel hatırlatmalar (tartı, su) kalır.

**Geri dönüş teşviki:**
- Downgrade sonrası ilk 7 gün: "Premium'u özlüyor musun?" tarzında bir e-posta gönderilmez; kullanıcı uygulamayı kullanmaya devam ettiğinde premium kilitlenen özelliklere dokunduğunda soft upsell gösterilir.
- 30 gün sonra: indirimli geri dönüş teklifi gönderilebilir (opsiyonel, agresif pazarlama yapılmaz).

---

## BÖLÜM 17: EKRANLAR (MİNİMUM)

1. Onboarding (hızlı başlangıç formu + AI tanışma + porsiyon kalibrasyonu)
2. Ana ekran — "Bugün" dashboard'u (günlük hedefler, su barı, bugünün tek odağı, hızlı kayıt butonları, makro halkası, adım sayacı, IF penceresi göstergesi eğer aktifse, haftalık bütçe barı)
3. AI Sohbet ekranı (koçla konuşma, zengin yanıt formatları destekli)
4. Sohbet geçmişi ve arama ekranı
5. Kayıt ekle (öğün / spor / tartı / su / uyku / alkol / not — sekmeli veya butonlu)
6. Bugünün planı (beslenme planı + spor planı + alışveriş listesi)
7. Haftalık menü planlama ekranı
8. Gün sonu rapor
9. Haftalık rapor
10. Aylık rapor / tüm zamanlar
11. İlerleme grafikleri ve dashboard'lar
12. Takvim/zaman çizelgesi (geçmiş günlere bakma)
13. Profil ve tercihler (yaşayan dosya — her bilgi düzenlenebilir)
14. Sevilen/sevilmeyen yemek listesi
15. Favori öğün şablonları
16. **Tarif kütüphanesi** (kaydedilen tarifler)
17. Kayıtlı mekanlar ve makro hafızası
18. Hedef ayarları ve hedef takip ekranı (çok fazlı hedef görünümü dahil)
19. Kan değerleri ve lab modülü (opsiyonel)
20. Supplement takibi
21. Tartı/ölçüm geçmişi
22. İlerleme fotoğrafları (before/after karşılaştırma)
23. Güç antrenmanı hareket geçmişi ve progresyon grafiği
24. Challenge ekranı (aktif ve tamamlanan challenge'lar)
25. Bildirim ayarları
26. Başarılar ve streak'ler
27. Abonelik ve ödeme
28. **Rapor export ekranı** (sağlık profesyoneli raporu dahil — bkz. 8.7)
29. Ayarlar (veri silme, export, zamanlanmış export, import, gizlilik, koç tonu sıfırlama, offline ayarlar, aktif oturumlar, tema seçimi, birim/dil tercihi, gün sınırı ayarı, debug modu, timezone, Katman 2 görüntüleme/düzenleme, hesap/giriş yöntemi değişikliği)

---

## BÖLÜM 18: VERİ SAKLAMA, GİZLİLİK VE GÜVENLİK MİMARİSİ

### 18.1 Veri Saklama

- Kullanıcı verisi bulutta saklanır
- Tüm veriler şifreli (at rest ve in transit)
- Kullanıcı verisi hassas sağlık verisi olarak ele alınır
- İlerleme fotoğrafları ayrı, daha kısıtlı erişimle saklanır
- **Özel nitelikli kişisel veri (KVKK Madde 6):** Menstrüel döngü verisi, sağlık geçmişi ve kan değerleri KVKK kapsamında "özel nitelikli kişisel veri" kategorisindedir. Bu veriler standart profil verisinden ayrı, ek erişim kontrolüyle saklanır. Bu verilere erişim audit loglanır.
- **Öğün fotoğrafları retention politikası:** AI'a gönderilen öğün fotoğrafları parse işlemi tamamlandıktan sonra sunucuda tutulmaz. AI parse sonucunu (yapısal veri: kalori, makro, yemek adı) kaydeder, fotoğraf kendisi 24 saat içinde sunucudan silinir. Kullanıcı isterse fotoğrafı kendi cihazında saklayabilir. Bu politika KVKK kapsamında "amaçla sınırlı veri saklama" ilkesine uygundur.
- **Aktif kullanıcı veri saklama süresi:** Aktif hesap verileri süresiz saklanır. Detaylı kayıtlar (teker teker öğün logları) 2 yıldan eski olanlar için özetlenip arşivlenebilir (günlük toplam kalori/makro saklanır, teker teker öğün detayı kaldırılır). Kilo trendi, haftalık/aylık raporlar ve Katman 2 özeti süresiz tutulur. "Tüm zamanlar raporu" (8.4) arşivlenmiş özetlerden çalışır.

### 18.2 Veri Sahipliği

- Kullanıcı tüm verilerinin sahibidir
- Export alabilir: JSON, CSV, PDF rapor
- **Katman 2 export:** Veri export'una AI'ın öğrendiği Katman 2 notları da dahildir (kullanıcı tercihine göre). Kullanıcı uygulamadan ayrılıp geri döndüğünde veya başka bir platforma geçmek istediğinde AI'ın öğrendikleri kaybolmaz. Export formatı: JSON (yapılandırılmış profil çıkarımları, kalıp notları, porsiyon kalibrasyonu, 1RM değerleri). Bu, veri taşınabilirliği hakkının (GDPR Madde 20) kapsamındadır.
- **Zamanlanmış otomatik export:** Kullanıcı isterse haftalık veya aylık otomatik veri yedeği alabilir (e-posta ile gönderim veya bulut depolama bağlantısı). KVKK kapsamında "verilerimi düzenli al" ihtiyacını karşılar.
- Hesabını silerse veriler 30 gün sonra kalıcı silinir
- KVKK/GDPR uyumluluğu sağlanır
- **Katman 2 düzeltme/silme hakkı:** Kullanıcı AI'ın hakkında yazdığı notları görüntüleme, düzeltme ve silme hakkına sahiptir (bkz. 2.3). Bu GDPR Madde 16 (düzeltme hakkı) ve Madde 17 (silinme hakkı) kapsamındadır.

### 18.3 Gizlilik Kontrolleri

- Paylaşım sırasında hassas veriler otomatik gizlenir
- Kullanıcı neyin paylaşılacağını seçer
- AI sohbet geçmişi kullanıcı tarafından seçici veya toplu olarak silinebilir
- İlerleme fotoğrafları hiçbir zaman AI analizine veya üçüncü tarafa gönderilmez

### 18.4 Backend API Güvenlik Mimarisi

- **API proxy zorunluluğu:** Tüm AI (LLM) çağrıları backend proxy sunucu üzerinden yapılır. API anahtarları hiçbir zaman client-side kodda (web, mobil, PWA) bulunmaz. Client uygulama → Backend API → LLM servisi akışı uygulanır.
- **Backend sorumlulukları:** Kullanıcı kimlik doğrulaması (auth token kontrolü), rate limiting (bkz. 16.4), guardrail katmanının uygulanması (12.5), context (Katman 1-4) montajı ve token bütçeleme, AI çıktısının structured output validasyonu (5.29), API anahtarı yönetimi ve rotasyonu
- **Neden önemli:** Client-side API key konulursa herhangi biri ağ trafiğini izleyerek anahtarı çalabilir ve sınırsız API çağrısı yapabilir. Bu hem maliyet hem güvenlik felaketidir.
- Bu mimari karar 21.3'teki teknoloji seçimiyle doğrudan ilişkilidir: Supabase Edge Functions veya ayrı bir backend servisi bu proxy rolünü üstlenir.

---

## BÖLÜM 19: TÜRK BESİN VERİTABANI STRATEJİSİ

### 19.1 Sorun

Türk yemeklerinin (ev yemekleri, sokak yemekleri, zincir restoranlar) kalori ve makro verileri ne uluslararası veri tabanlarında düzgünce yer alıyor ne de standart bir açık Türkçe kaynak var. AI tahmini bu boşluğu kısmen kapatıyor ama tutarsızlık yaratıyor.

### 19.2 Strateji (Aşamalı)

**İlk aşama:**
- AI tahmini + kullanıcı düzeltmesi
- Düzeltmeler kullanıcının kişisel hafızasına kaydedilir (başka kullanıcılarla paylaşılmaz)
- Barkod tarayıcı ile paketli Türk ürünleri için çoklu kaynak entegrasyonu:
  - OpenFoodFacts (açık kaynak, uluslararası, Türk ürünleri sınırlı ama başlangıç noktası)
  - GS1 Türkiye barkod veritabanı (resmi barkod registry, ürün adı ve üretici bilgisi)
  - Market API araştırması: Migros, A101, Trendyol Market gibi büyük zincirlerin ürün verileri API veya scraping ile erişilebilirse entegre edilir
  - Kaynak önceliği: resmi veritabanı > market API > OpenFoodFacts > kullanıcı katkısı > AI tahmini

**Büyüme aşaması:**
- Kullanıcıların yaptıkları düzeltmeler anonim olarak toplanır
- "Karnıyarık" için kullanıcıların girdiği 1000 farklı değerin medyanı hesaplanır
- Bu median değer tüm kullanıcılara önerilen default olarak sunulur
- Kullanıcı hâlâ kişisel düzeltmesini saklayabilir
- Kayıtlı mekan verileri de anonim olarak toplanabilir: "Simit Sarayı Bal Kaymak" için topluluk onaylı makro değeri oluşturulabilir

**Uzun vadeli:**
- Türk Gıda Kodeksi kaynaklı resmi veri tabanı araştırması
- İşlenmiş ürünler için marka ortaklıkları

### 19.3 Barkod Bulunamadığında Topluluk Katkısı

Barkod tarayıcıyla okutulan ama veritabanında bulunmayan ürünler:

- Bulunamayan barkod numarası arka planda kaydedilir (ürün bilgisi olmadan sadece barkod)
- Kullanıcı serbest metin ile girişini tamamladıktan sonra: "Bu ürünü veritabanına eklemek ister misin?" diye sorulur
- Kullanıcı ürün adını ve makro bilgilerini girerse bu veri topluluk veritabanına aday olarak eklenir
- Aynı barkod 3+ farklı kullanıcı tarafından onaylanırsa doğrulanmış veri olarak veritabanına girer
- **Manipülasyon koruması:** Topluluk katkısında kötü niyetli veya hatalı veri girişine karşı ek kontroller uygulanır:
  - Girilen makro değerleri mantıksal tutarlılık kontrolünden geçer (protein x 4 + karb x 4 + yağ x 9 ≈ kalori, %15 tolerans)
  - Ürün kategorisine göre makul aralık kontrolü: bir bisküvi 0 kalori olamaz, bir su 500 kalori olamaz
  - Aynı barkod için birden fazla kullanıcıdan gelen değerler arasında aşırı uçtaki girişler (median'dan 2 standart sapma uzakta) outlier olarak elenir
  - Doğrulanmış veri sonrası kullanıcı şikayetleri (düzeltme oranı) izlenir; yüksek düzeltme oranı olan verilere tekrar doğrulama uygulanır
- Bu mekanizma Bölüm 19.2'deki büyüme aşaması stratejisinin bir parçasıdır

---

## BÖLÜM 20: VERİ MODELİ VE GELECEĞİN GENİŞLEMESİ

### 20.1 B2B / Koç Modu — Gelecek Genişleme, Veri Modeli Hazır

Başlangıçta B2B özelliği yok. Ancak veri modeli baştan şu genişlemeye hazır tasarlanmalıdır:

- `coach_id` alanı kullanıcı tablosuna baştan eklenir (null varsayılan)
- Bir diyetisyen veya PT, kendi müşteri listesini ve onların verilerini okuyabilecek bir rol sistemi
- Müşteri, koça veri paylaşımını onaylar/iptal eder
- **Özel nitelikli veri paylaşım kontrolü:** Menstrüel döngü verisi, sağlık geçmişi gibi KVKK Madde 6 kapsamındaki veriler koça varsayılan olarak kapalıdır; kullanıcı bu verileri açıkça paylaşmayı seçmelidir.
- Bu genişleme B2B talebi net görüldüğünde aktifleştirilir
- Sağlık profesyoneli rapor exportu (bkz. 8.7) bu modele geçişin doğal köprüsüdür

Bu, başlangıçta ekstra maliyet yaratmaz ama sonradan yeniden yazımı engeller.

### 20.2 Çoklu Dil

- Türkçe öncelikli, İngilizce ikinci
- i18n altyapısı baştan kurulır, hard-coded string bırakılmaz

### 20.3 AI Sesli Yanıt (İleri Aşama)

- Kullanıcı sesli soru soruyor (mutfakta elleri meşgul, sporda, vb.) ve AI sesli yanıt veriyor
- Teknik olarak TTS (text-to-speech) entegrasyonu gerektirir
- Başlangıçta sesli giriş metin olarak işlenip metin olarak yanıtlanır; sesli yanıt ileri aşamada planlanır
- Koçun ses tonu da iletişim tercihi ile uyumlu olmalı

### 20.4 Aile Planı / Household Desteği (İleri Aşama)

Aynı evde yaşayan birden fazla Kochko kullanıcısı olduğunda değer katan özellikler:

- **Ortak alışveriş listesi:** Aynı household'daki kullanıcıların haftalık menülerinden birleştirilmiş tek alışveriş listesi
- **Ortak meal prep:** Aile için pişirilen yemeğin her kullanıcının planına ayrı porsiyon olarak dağıtılması
- **Paylaşılan tarif kütüphanesi:** Aile içinde kaydedilen tariflerin diğer üyelere görünmesi
- **Veri modeli hazırlığı:** `household_id` alanı kullanıcı tablosuna baştan eklenir (null varsayılan). Bu, sonradan yeniden yazımı engeller. Household üyeliği davet bazlıdır; her kullanıcı kendi verilerinin household içinde ne kadarının görüneceğini kontrol eder.
- Bu özellik bireysel kullanıcı deneyimi olgunlaştıktan sonra geliştirilir

---

## BÖLÜM 21: TEKNİK NOTLAR VE ÖZELLİK SIRASI

### 21.1 Önerilen Geliştirme Sıralaması

Aşağıdaki sıra, özelliklerin birbirine bağımlılık sırasını ve kullanıcı değerini yansıtır. Bu bir MVP listesi değil, tam ürünün inşa sırasıdır.

**Faz 1 — Temel Altyapı (ürün çalışmadan olmaz):**
1. Auth sistemi (Google/Apple/E-posta) + yaş doğrulaması + hesap/giriş yöntemi değişikliği
2. Backend API proxy mimarisi (18.4) + API key yönetimi
3. Profil + günlük kayıt sistemi (tüm kayıt türleri) + saçma giriş kontrolü (12.6) + veri saklama
4. TDEE hesaplama motoru + antrenman/dinlenme günü kalori ayrımı
5. AI sohbet + kayıt parse etme (serbest metin → yapılandırılmış veri) + structured output validation (5.29) + sohbet onarım mekanizması (5.32)
6. Prompt injection koruması (5.26) + guardrail sistemi (12.1-12.6, çapraz kontaminasyon farkındalığı dahil)
7. Plan üretimi (günlük beslenme + spor planı + makro takibi)
8. Basit dashboard (günlük hedefler, su barı, makro halkası)
9. Premium abonelik akışı (ödeme, trial, upsell trigger noktaları) + rate limiting (16.4) + downgrade akışı (16.5)
10. Gün sonu kapanış raporu
11. Hedef motoru

**Faz 2 — Koçluk Derinliği (ürünü farklılaştıran katman):**
12. Haftalık kalori bütçesi mekanizması
13. Haftalık rapor
14. Favori öğün şablonları + su takibi (formül bazlı hedef dahil)
15. Barkod okuma (çoklu kaynak entegrasyonu + offline cache)
16. IF modu ve yeme penceresi
17. Bildirim sistemi (bildirim izni UX akışı dahil)
18. Minimum viable day modu
19. Re-engagement akışı (3/7/14/30 gün bildirimleri + 6+ ay re-onboarding)
20. Telefon adım sayacı entegrasyonu
21. Fotoğraf ile öğün kaydı + fotoğraf fallback akışı + fotoğraf+metin birlikte gönderim
22. Porsiyon kalibrasyonu (onboarding + sürekli öğrenme)
23. AI öneri geri bildirimi (işe yaradı/yaramadı butonu)
24. Simülasyon modu ("şunu yesem ne olur?")
25. Hızlı kurtarma modu ("bugün çok yedim")
26. Kademeli zorluk artışı (adaptive difficulty)
27. Beslenme okuryazarlığı desteği (5.31)
28. Kademeli özellik tanıtımı (progressive disclosure — 5.33)
29. Alışkanlık bazlı koçluk (habit stacking — 5.35)
30. AI-driven hedef önerisi (6.4)

**Faz 3 — İleri Özellikler:**
31. Haftalık menü planlama + alışveriş listesi
32. Tarif kütüphanesi + malzeme ikamesi + "elimde şunlar var" modu
33. Meal prep planı
34. Plateau yönetimi
35. Bakım modu / Maintenance (hedefe ulaşanlar için)
36. Çok fazlı hedef planlaması (cut/bulk döngüsü — bkz. 6.7)
37. Güç antrenmanı progresyon takibi + toparlanma kaydı (3.1)
38. Alkol takibi (ayrı kayıt türü + makro entegrasyonu)
39. Lab modülü (kan değerleri)
40. Dönemsel durum yönetimi (ramazan, hamilelik, tatil vb.)
41. Challenge modülü (challenge duraklatma dahil)
42. Kayıtlı mekan hafızası + menü fotoğrafı analizi + sosyal yeme baskısı koçluğu
43. Prediktif analitik (sapma tahmini)
44. Kafein-uyku korelasyon takibi (5.34)
45. Sohbet geçmişi arama

**Faz 4 — Genişleme ve Polish:**
46. Sesli giriş
47. İlerleme fotoğrafı takibi
48. Sağlık profesyoneli rapor exportu
49. Data import (MyFitnessPal, Fatsecret vb.)
50. Saat dilimi / seyahat yönetimi (bağlamsal mutfak bilgisi dahil)
51. Wearable entegrasyonları (HRV/toparlanma verisi dahil)
52. Sosyal/paylaşım özellikleri
53. Zengin sohbet yanıtları (mini chart, butonlar)
54. AI sesli yanıt
55. Widget desteği (mobil geçişte)
56. Debug/şeffaflık modu
57. Zamanlanmış otomatik veri export + Katman 2 export (18.2)
58. Aile planı / household desteği

### 21.2 En Kritik Teknik Zorluklar

1. **Backend API proxy ve güvenlik mimarisi**: tüm LLM çağrılarının backend üzerinden yapılması, API key'in client'ta bulunmaması, auth token doğrulaması ve rate limiting (bkz. 18.4)
2. **AI hafıza mimarisi**: katmanlı context yönetimi olmadan uzun vadeli koçluk mümkün değil. Katman 2 yaşam döngüsü ve sıkıştırma stratejisi (bkz. 5.1) uzun vadeli kullanıcılar için kritik.
3. **Token bütçeleme**: her katmanın oran bazlı token bütçesinin belirlenmesi (bkz. 5.1), Katman 3 budama stratejisi, bütçe aşım fallback'i — bu olmadan API maliyeti kontrolsüz büyür ve context window taşması riski oluşur
4. **Besin verisi tutarlılığı**: AI tahminlerinin her seferinde farklı çıkmaması için düzeltme hafızası, porsiyon kalibrasyonu (bkz. 5.23), AI kendisiyle tutarlılık mekanizması (bkz. 5.10), ileride barkod + topluluk veritabanı
5. **Kayıt sürtünmesi**: her kayıt 1 dakikadan az sürmeli, bu UX'in 1 numaralı önceliği
6. **Offline sync**: veri tipine göre farklılaştırılmış çakışma stratejisi (kayıtlar için append, profil için last-write-wins — bkz. 11.3), barkod için offline cache stratejisi
7. **AI maliyet yönetimi**: context-heavy call'lar pahalı, gereksiz API call'ları minimize edilmeli, mod bazlı LLM parametreleri (bkz. 5.24) maliyet verimliliği sağlar, premium rate limiting (bkz. 16.4)
8. **Guardrail katmanı**: AI çıktısını kod bazlı filtreleyen güvenlik katmanı (alerjen filtresi + saçma giriş kontrolü + prompt injection koruması + kilo değişim hızı guardrail'i dahil), AI'a bırakılmaz
9. **Structured output validation**: AI parse/plan çıktısının şema doğrulaması, makro-kalori tutarlılık kontrolü, retry mekanizması (bkz. 5.29)
10. **Güç progresyon hafızası**: set-rep-ağırlık geçmişinin verimli saklanması ve context'e taşınması; tüm hareket geçmişini her seferinde göndermek yerine özet 1RM değerleri kullanılmalı
11. **Zengin sohbet formatı**: sohbet mesajları içine gömülü UI bileşenleri (chart, buton, kart) teknik olarak custom message renderer gerektirir
12. **AI system prompt versiyonlama**: koçun davranışını belirleyen system prompt'un versiyonlanması ve rollback mekanizması. Her prompt versiyonu etiketli saklanır, prompt değişikliği sonrası retention ve memnuniyet metrikleri izlenir, sorun tespitinde önceki versiyona anında rollback yapılabilir.
13. **AI model versiyonlama** (bkz. 5.25): model değişikliğinin çıktı kalitesine etkisi, fallback model stratejisi, model bazlı performans karşılaştırması
14. **TDEE dinamik hesaplama**: kilo değişikliğinde otomatik yeniden hesaplama tetikleyicisi, aktivite çarpanının zamanla kişiselleştirilmesi (bkz. 2.4)
15. **Saat dilimi yönetimi**: timezone değişikliğinin tüm zaman bazlı özelliklere etkisi (bildirimler, IF penceresi, öğün saatleri — bkz. 2.5), IF penceresi timezone geçiş kuralı
16. **Gün sınırı yönetimi**: gece yarısı geçişi problemi — geç saatlerde yapılan kayıtların doğru güne atanması, tüm zaman bazlı sistemlerin (rapor, bütçe, streak) bu sınıra göre çalışması (bkz. 2.8)
17. **AI yanıt süresi optimizasyonu**: farklı modlar için farklı SLA hedefleri (bkz. 5.27), özellikle kayıt parse modunda 1-3 saniye hedefi — bu, context boyutunu minimize etmeyi ve gerekirse daha hafif model kullanmayı gerektirebilir. Streaming desteği algılanan süreyi kısaltır.
18. **Multimodal input yönetimi**: fotoğraf + metin birlikte gönderimde parse sırası ve çelişki çözümleme mantığı (bkz. 3.1), karışık dil girdisi toleransı (bkz. 5.28)

### 21.3 Önerilen Teknoloji Başlangıcı

- İlk web app: React + Supabase + Claude API
- **Mimari:** Client (React) → Supabase Edge Functions (auth, rate limit, guardrail, context montajı) → Claude API. API key yalnızca Edge Functions ortamında bulunur (bkz. 18.4).
- Kendin kullan, veri modeli oturup oturmadığını gör
- Sonra mobil: React Native veya Flutter
- Sonra bildirim sistemi, sonra entegrasyonlar

---

## BÖLÜM 22: ERİŞİLEBİLİRLİK VE GÖRSEL TERCİHLER

### 22.1 Erişilebilirlik (Accessibility)

Temel a11y prensipleri baştan gözetilir:

- **Renk körlüğü uyumu:** Grafikler ve göstergeler sadece renge bağlı olmaz; desen, ikon veya etiketle desteklenir. Güven göstergesi (Yüksek/Orta/Düşük) hem renk hem ikon ile gösterilir.
- **Yazı boyutu:** Sistem font ayarlarına saygı gösterilir; kullanıcı büyük font kullanıyorsa arayüz buna adapte olur.
- **Ekran okuyucu uyumu:** Tüm butonlar ve etkileşimli öğeler anlamlı etiketlere sahip olur (aria-label). Grafikler için metin alternatifi sunulur.
- **Dokunma alanları:** Mobilde minimum 44x44px dokunma alanı; tek dokunuşla erişilebilir butonlar (su, kayıt) yeterli büyüklükte olur.
- **Kontrast oranı:** WCAG AA standardı minimum karşılanır.

Bu, detaylı bir a11y audit'i değil başlangıç prensipleridir. İleri aşamada kapsamlı erişilebilirlik testi planlanmalıdır.

### 22.2 Tema ve Görsel Tercihler

- **Koyu tema (dark mode):** Baştan desteklenir. Gece kullanımı (uyku kaydı, gece atıştırma anı, gün sonu kapanış) düşünüldüğünde olmazsa olmaz. Koyu tema hem göz yorgunluğunu azaltır hem pil tüketimini düşürür (OLED ekranlarda).
- **Tema tercihi:** Sistem temasını takip et (varsayılan) / Her zaman açık / Her zaman koyu — üç seçenek
- **Grafikler ve chart'lar:** Her iki temada da okunabilir olmalı; renkler tema bazlı CSS değişkenleriyle yönetilir
- Koyu temada güven göstergesi renkleri (yeşil/sarı/kırmızı) yeterli kontrastla ayarlanır

---

## BÖLÜM 23: MOBİL WİDGET DESTEĞİ

Mobil uygulamaya geçildiğinde ana ekran widget'ları kullanıcı bağlılığını artırır:

- **Günlük özet widget'ı:** Bugünkü kalori durumu (tüketilen/kalan), protein barı, su barı
- **Bugünün tek odağı widget'ı:** AI'ın o gün için belirlediği tek hedef
- **Hızlı kayıt widget'ı:** Su ekle butonu, hızlı öğün kaydı kısayolu
- **Streak widget'ı:** Ardışık gün sayacı
- **Adım widget'ı:** Günlük adım ilerlemesi
- **Haftalık bütçe widget'ı:** Haftalık kalori bütçesinden kalan

Widget'lar offline veriden çalışır; son senkron verileriyle güncellenir.

---

## BÖLÜM 24: BAŞARI KRİTERLERİ

- Kullanıcı 30 gün içinde uygulamayı bırakmıyorsa ürün çalışıyor demektir
- En kritik metrik: günlük kayıt sürtünmesi ve kapanış raporu okunma oranı
- Plan uygulanma oranı: önerilen öğünlerin kaç tanesi seçildi
- Haftalık trend: kilo ve uyum puanı korelasyonu
- AI memnuniyeti: kullanıcı AI önerilerini ne sıklıkta "işe yaradı" olarak işaretliyor
- Bildirim etkileşim oranı: bildirimlere tıklanma vs kapatılma
- Streak ortalaması: kullanıcıların ortalama ardışık gün sayısı
- Minimum viable day kullanım oranı: bu modun devreye girdiği günlerde kaç kullanıcı uygulamada kaldı
- Challenge tamamlama oranı
- Trial-to-paid dönüşüm oranı
- Aylık churn oranı
- **Ücretsiz kullanıcı retentionu:** Ücretsiz plandaki kullanıcılar uygulamayı kullanmaya devam ediyor mu yoksa siliyor mu — bu, ücretsiz planın yeterliliğini ölçer
- **Barkod kullanım oranı:** Ücretsiz kullanıcılarda barkodun kayıt sürtünmesini ne kadar azalttığını ölçer
- **Simülasyon modu kullanım oranı:** "Şunu yesem ne olur?" özelliğinin ne sıklıkta kullanıldığı — yüksek kullanım, kullanıcının karar anında koça güvendiğini gösterir
- **AI öğrenme notu etkileşimi:** Haftalık rapordaki öğrenme notuna kullanıcı tepkisi (rapor tıklanma oranı ile korelasyon)
- **Bakım modu retentionu:** Hedefe ulaşan kullanıcıların kaçı bakım modunda kalmaya devam ediyor vs uygulamayı siliyor — bakım modunun etkinliğini ölçer
- **Haftalık bütçe uyum oranı:** Kullanıcıların haftalık bütçeyi ne sıklıkta tutturduğu — günlük uyumdan daha anlamlı bir uzun vadeli metrik
- **Re-engagement başarı oranı:** Geri dönüş bildirimlerine tıklayan kullanıcıların kaçı 7 gün daha aktif kaldı
- **Porsiyon kalibrasyon etkisi:** Kalibrasyon yapan kullanıcıların kalori düzeltme sıklığı vs yapmayanlara kıyasla azalma oranı
- **Saçma giriş tespit oranı:** Kaç saçma girişin doğrulama ile yakalandığı ve düzeltildiği
- **AI yanıt süresi SLA uyumu:** Her mod için belirlenen hedef sürelerin (bkz. 5.27) kaçta kaçında tutulduğu — kayıt parse için %95+ 3 saniye altı hedeflenmeli
- **Structured output başarı oranı:** AI parse/plan çıktılarının kaçta kaçı ilk denemede geçerli şema ürettiği — retry'a düşme oranı %5'in altında olmalı
- **Prompt injection blok oranı:** Kapsam dışı/manipülatif isteklerin kaçta kaçının başarıyla engellendiği
- **Yeme bozukluğu risk tespit hassasiyeti:** Kırmızı bayrak tespitlerinin ne kadarının gerçek risk senaryosuna karşılık geldiği (false positive oranı düşük tutulmalı)
- **AI tutarlılık oranı:** Aynı yemek için farklı oturumlarda verilen kalori tahminlerinin tutarlılığı — %20'den fazla sapma oranı ne kadar
- **Geçmişe dönük kayıt kullanım oranı:** Batch entry özelliğinin ne sıklıkta kullanıldığı — yüksek kullanım, kayıt sürtünmesinin hâlâ sorun olduğunu gösterebilir
- **Pişirme yöntemi parse başarısı:** AI'ın pişirme yöntemini doğru tespit etme oranı
- **Plan reddetme oranı:** Kullanıcıların üretilen planı ne sıklıkta reddettiği — yüksek oran planın kişiselleştirme kalitesinin düşük olduğunu gösterir
- **Rate limit tetiklenme oranı:** Premium kullanıcılarda rate limit'e çarpma sıklığı — yüksek oran ya sınırın düşük olduğunu ya da abuse olduğunu gösterir
- **Güven göstergesi kalibrasyon oranı:** "Yüksek" güvenle verilen tahminlerin gerçek doğruluk oranı, "Orta" güvenle verilenlerin doğruluk oranı — güven göstergesinin gerçekten kalibre olup olmadığını ölçer. Yüksek güvenli tahminler %90+ doğruluk, orta güvenli %60-80 doğruluk beklenir.
- **Kilo değişim hızı guardrail tetiklenme oranı:** Haftada 1.5 kg+ değişim guardrail'inin ne sıklıkta tetiklendiği — yüksek oran planların yeterince koruyucu olmadığını gösterebilir
- **Downgrade sonrası geri dönüş oranı:** Premium iptal eden kullanıcıların kaçı 60 gün içinde tekrar abone oluyor
- **Re-onboarding tamamlama oranı:** 6+ ay sonra dönen kullanıcıların kaçı re-onboarding akışını tamamlıyor vs uygulamayı tekrar bırakıyor
- **Sohbet onarım oranı:** Kullanıcının "yanlış anladın" / parse düzeltmesi yapma sıklığı — yüksek oran kayıt parse kalitesinin düşük olduğunu gösterir, zamanla azalması beklenir
- **Alışkanlık oturtma oranı:** Mikro-alışkanlık hedeflerinin kaçta kaçı 2+ hafta %80+ uyumla tutturuluyor — habit stacking mekanizmasının etkinliğini ölçer
- **Progressive disclosure etkisi:** Kademeli tanıtımla keşfedilen özellik kullanım oranı vs tanıtım yapılmadan keşfedilen özellikler — tanıtımın feature adoption'ı artırıp artırmadığını ölçer
- **Besin zamanlama uyumu:** Antrenman öncesi/sonrası öğün zamanlaması önerilerine uyum oranı (güç antrenmanı yapan kullanıcılar için)
- **Kafein-uyku korelasyon tespit oranı:** AI'ın tespit ettiği kafein-uyku korelasyonlarına kullanıcının "doğru" deme oranı
- **AI hedef önerisi kabul oranı:** AI'ın proaktif olarak önerdiği yeni hedeflerin kullanıcı tarafından kabul edilme oranı — düşük oran önerilerin isabetsiz olduğunu gösterir
