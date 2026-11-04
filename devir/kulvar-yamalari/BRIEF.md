# Kochko UI kulvar brifi (ortak) — 2026-11-04

Sen Kochko (Expo / React Native, Türkçe beslenme-koçluk uygulaması) arayüzünü Duolingo/Yazio
diline getiren paralel kulvarlardan birisin. Kendi git worktree'nde çalışıyorsun. Kullanıcı
"projeyi olabildiğince güzelleştir" dedi; harcama onaylı. Sonucu ana oturum birleştirecek.

## Önce oku (zorunlu)
- `DEVIR_UI_2026-08-04.md` §0-A (görsel dil: Yazio/Duolingo, menekşe marka, yeşil YOK, maskot
  Koçko = koç) ve §0-B (gövdeli tuş + hareket dili — bu oturumda yazıldı). §0-A'daki
  "iz rengi yüzeyden VE temadan bağımsız" tuzağını oku.
- `src/lib/design.ts` (TYPE, MOTION, MOTION.shelf, alpha, mix), `src/lib/theme.ts`.
- Hazır primitifler (DEĞİŞTİRME — yalnız KULLAN; kulvar E hariç bkz. kulvar kuralı):
  `ui/Button` (gövdeli), `ui/ShelfPressable` (raf+yüz iskeleti), `ui/ChoiceTile` + `ChipSelect`,
  `ui/ProgressBar`, `ui/ConfettiBurst`, `ui/Reveal`, `ui/Toast`, `mascot/KochkoMascot`
  (mood: happy|cheer|sleepy, `animated` prop), `hooks/useReduceMotion`, `lib/haptics`.

## Dil kuralları
1. Dokunulabilir kart/kutucuk/çip = GÖVDELİ: `ShelfPressable` (raf + yüz, basınca rafa iner,
   solmaz). Yüz OPAK (pastel için `mix(color, colors.background, a)`). Gri gövde:
   `isDark ? colors.border : colors.progressTrack`, 2px çerçeve + aynı gri raf.
2. Dolu eylem butonları `Button` (elle TouchableOpacity buton yazma). Satırlar, ikon
   düğmeleri, liste öğeleri TouchableOpacity + `activeOpacity={MOTION.pressOpacity}` kalabilir.
3. Doğrusal ilerleme = `ProgressBar`. Elle iz+dolgu View yazma.
4. Boş durumlar karakterli: `EmptyState`'in `mascot` prop'u ya da `KochkoMascot`.
5. Animasyon: native driver (transform/opacity), her yeni animasyon `useReduceMotion`'a uyar,
   döngüler odak dışında durur. Kutlama anları (hedef, rozet, seri) konfeti/yay alabilir —
   ama ölçülü: her ekranı konfetiye boğma.
6. "Az sayı, çok teşvik": sayı ikinci planda, kısa teşvik cümleleri. Uydurma veri YOK.
7. Kontrast: küçük kırmızı metin `colors.errorText`; kehribar/gül dolgu üstünde metin
   mürekkep `#2A2140` (StatStrip PLATE_INK). Türkçe büyük harf `toLocaleUpperCase('tr-TR')`.
8. Mantığa/veri akışına DOKUNMA: yalnız sunum. Servis/store/edge kodu değiştirme.
   Kaldırdığın bir bileşenin a11y özelliklerini (role/label/state/hint) koru.
9. Yorumları Türkçe, kodun mevcut üslubunda (neden yapıldığını yaz). Dosya başı yorumları güncelle.

## Doğrulama (zorunlu — ekranda görmeden "bitti" deme)
- Worktree'de: `npm ci --no-audit --no-fund` (≈20 sn).
- Tip: `npx tsc --noEmit` temiz. Mimari: `npm run -s arch-guards` temiz.
- Web: `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy EXPO_NO_TELEMETRY=1 npx expo start --web --port <KULVAR_PORTU>`
  arka planda (Bash run_in_background). Supabase'e ağ yok → veriler boş/yükleniyor; bu normal.
- Oturum isteyen rotaları görmek için YALNIZ YEREL istisna (ASLA commit etme):
  `sed -i "s/    if (!session \&\& !isPublic) {/    if (!session \&\& !isPublic \&\& !(typeof window !== 'undefined' \&\& (window as any).__KOCHKO_LAB__)) {/" app/_layout.tsx`
  ve Playwright'ta `page.addInitScript(() => { window.__KOCHKO_LAB__ = true })`.
  Sekmelerin ana sayfası `/(tabs)`; diğerleri dosya yoluyla (`/progress`, `/settings/goals`, `/reports/weekly` …).
- Veri gerektiren bileşenleri görmek için geçici `app/(auth)/lab.tsx` (örnek veriyle bileşeni
  render et; `/lab` oturumsuz açılır). `.git/info/exclude`'da zaten var — commit etme.
- Playwright: `require('playwright')` her dizinden çalışır (`NODE_PATH=$(npm root -g)`),
  `chromium.launch()` seçeneksiz. Örnek betik: `/tmp/claude-0/-home-user/aa041286-24fd-58c5-a633-cfe5e4049a30/scratchpad/shot.cjs`
  (kopyala; port'u değiştir). Viewport 390×844, deviceScaleFactor 1. Basılı hâl: mouse.down → screenshot.
  Koyu tema: `addInitScript(() => localStorage.setItem('@kochko_theme_mode','dark'))`.
- Önce/sonra ekran görüntülerini KULVAR_KLASÖRÜNE kaydet (aşağıda) — açık VE koyu tema.
  Kendin Read ile bak; gördüğün kusuru düzelt, tekrar çek.

## Git
- Yalnız KULVARIN DOSYALARINI değiştir. Her commit'te dosyaları TEK TEK `git add <yol>` ile ekle
  (`git add -A` / `.` YASAK — `app/_layout.tsx` yerel istisnası ve lab dosyası girmesin).
- Commit mesajı Türkçe (ASCII'ye yakın, mevcut log üslubu: `feat(ui): ...`), sonunda:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011fitrijpbwq2gTQ1MS4Wyf
  ```
  `git -c user.name=hakandemircitasarim -c user.email=hakandemircitasarim@gmail.com commit ...`
- PUSH ETME. Birden fazla küçük commit tercih. Bitince `app/_layout.tsx`'i `git checkout` ile geri al.
- Ağ yok (Supabase/OpenAI/deno engelli) — deploy, migrasyon, canlı test YOK.

## Bitirince rapor (son mesajın, kısa)
- Worktree yolu + dal adı + commit listesi (`git log --oneline <base>..HEAD`).
- Değişen ekran/bileşen başına bir satır: ne yapıldı.
- Ekran görüntüsü yolları (önce/sonra, açık/koyu) — ana oturum bakacak.
- Doğrulanamayanlar ve ortak primitiflerde gördüğün ama DOKUNMADIĞIN sorunlar (öneri olarak).
