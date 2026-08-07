/**
 * Theme System
 * Flat dark design with teal accent — no gradients, no shadows, no glow
 */
import { createContext, useContext } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';

export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceLight: string;
  card: string;
  cardElevated: string;
  inputBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
  error: string;
  errorLight: string;
  border: string;
  divider: string;
  tabBar: string;
  tabBarBorder: string;
  // FIX (audit UI-DS-07): removed unused 'shadow' token (zero `.shadow` consumers
  // app-wide; flat design has no shadows). Use `border` for hairlines.
  progressTrack: string;
  // Macro colors
  protein: string;
  carbs: string;
  fat: string;
  // FIX (audit UI-STA-06): a lighter error tone for SMALL (<=13px) accent text.
  // The base `error` (#E24B4A) is only 4.39:1 on card → fails AA for small text;
  // this tone reaches >=4.5:1 on card/cardElevated/surfaceLight.
  errorText: string;
  /** error'un koyusu — dolu danger butonunun 4px alt rafı (gövdeli buton imzası).
   *  errorText OLMAZ: koyu temada errorText dolgudan AÇIKTIR, raf koyu ister. */
  errorDark: string;
  // Utility colors
  purple: string;
  pink: string;
  coral: string;
}

export const DARK_COLORS: ThemeColors = {
  // MARKA AKSANI (2026-08-06). Uygulamada yesil KALMADI — istek uzerine tamamen cikti.
  // Menekse secildi cunku urunun kimligi "AI koc": bu ton teknoloji/zeka okur ve
  // uygulamanin zaten var olan ikincil moruyla ayni ailede, yani yamali durmuyor.
  // Tek aksan + FARKLI ISLEMLER (dolu buton / tintli cip / duz metin) ilkesi: ayni
  // hue'yu birden fazla anlam icin kullanmak sorun degil, AYNI GORUNMESI sorundu.
  primary: '#8B5CF6',
  primaryDark: '#6D3FE0',
  primaryLight: '#8B5CF61F',
  secondary: '#8B5CF6',
  accent: '#8B5CF6',
  background: '#0D0D12',
  surface: '#1A1A24',
  surfaceLight: '#22222E',
  card: '#1A1A24',
  cardElevated: '#22222E',
  inputBg: '#1A1A24',
  text: '#EEEEF0',
  textSecondary: '#9999A8',
  // #ux-audit: bumped from #66667A (2.8-3.5:1, WCAG AA FAIL for body text on every surface)
  // to #8E8EA3 → ≥4.9:1 on bg/surface/surfaceLight. One global token fix → app-wide legibility.
  textMuted: '#8E8EA3',
  // "Yolunda / tamamlandi" artik gok mavisi: yesilsiz bir sistemde olumlu durumu
  // tasiyabilecek, markadan da ayrisan tek soguk ton.
  success: '#38BDF8',
  successLight: '#38BDF820',
  warning: '#EF9F27',
  warningLight: '#EF9F2720',
  error: '#E24B4A',
  errorLight: '#E24B4A20',
  // DEPTH (08-05): design.ts'in dorduncu ayagi golgeyle gelmiyordu. Android yalniz
  // `elevation` sayisini okur ve #0D0D12 uzerinde siyah golge gorunmez — Card'a
  // elevation(1) ve (2) verilip cihazda olculdu, hicbir fark yok. Koyu temada bir
  // yuzeyi kaldiran sey KENARIDIR. 0.08'de kart sinirlari neredeyse gorunmuyordu ve
  // her sey tek duz yuzey gibi okunuyordu; 0.16'da kart/grup/balon birer nesne oluyor.
  // `divider` bilerek 0.08'de kaldi: grup sinirinin guclu, IC ayraclarin sessiz olmasi
  // hiyerarsinin ta kendisi (ayar listelerinde cihazda dogrulandi).
  border: 'rgba(255,255,255,0.16)',
  divider: 'rgba(255,255,255,0.08)',
  tabBar: '#0D0D12',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  progressTrack: 'rgba(255,255,255,0.08)',
  // Macro colors
  protein: '#378ADD',
  carbs: '#EF9F27',
  fat: '#D85A30',
  // FIX (audit UI-STA-06): lighter error for small text → 5.82:1 on card, 5.30:1 on cardElevated/surfaceLight.
  errorText: '#EE6E6B',
  errorDark: '#B23230',
  // Utility
  purple: '#7F77DD',
  pink: '#D4537E',
  coral: '#D85A30',
};

export const LIGHT_COLORS: ThemeColors = {
  // Ayni marka ailesi, ZEMINE gore ayarli: koyu temadaki parlak menekse beyaz
  // uzerinde yeterli kontrast vermiyor. getContrastColor buton metnini dinamik seciyor.
  primary: '#6D3FE0',
  primaryDark: '#5A32BD',
  primaryLight: '#6D3FE01F',
  secondary: '#6D3FE0',
  accent: '#6D3FE0',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceLight: '#F0F2F5',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  inputBg: '#F0F2F5',
  text: '#1A1A24',
  textSecondary: '#5A6478',
  // FIX (audit: light textMuted WCAG-AA) #94A3B8 ~2.56:1 on white (AA FAIL) → #64748B ~4.8:1.
  textMuted: '#64748B',
  success: '#0EA5E9',
  successLight: '#0EA5E920',
  // FIX (audit: light warning WCAG-AA) #EF9F27 ~2.17:1 as text on white (AA FAIL) → darker #B26A00 ~4.6:1.
  warning: '#B26A00',
  warningLight: '#B26A0020',
  error: '#E24B4A',
  errorLight: '#E24B4A20',
  border: '#E8ECF0',
  divider: '#F0F2F5',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E8ECF0',
  progressTrack: '#D8DCE4',
  // Macro colors
  protein: '#378ADD',
  carbs: '#EF9F27',
  fat: '#D85A30',
  // FIX (audit UI-STA-06): darker error for small text → 5.17:1 on white card, 4.61:1 on surfaceLight (base #E24B4A was only 3.93:1).
  errorText: '#C93634',
  errorDark: '#B23230',
  // Utility
  purple: '#7F77DD',
  pink: '#D4537E',
  coral: '#D85A30',
};

/** Flat accent colors for metric cards (replaces gradients) */
export const METRIC_COLORS = {
  // Kalori = gunun MANSET figuru, o yuzden marka tonunu tasir: kahraman halka
  // uygulamanin imzasi. Kalan metrikler uc ayirt edilebilir tona indirildi
  // (mavi / kehribar / gul) — once alti farkli hue vardi ve ekran karnaval gibiydi.
  calories: '#8B5CF6',
  protein: '#4C8DFF',
  carbs: '#FFB020',
  fat: '#FF5C7A',
  water: '#4C8DFF',
  sleep: '#8B5CF6',
  mood: '#FF5C7A',
  // 2x2 stat ızgarası bölüm başına DOLGULU renkli kart oldu (§0-A): su mavi, uyku
  // mor, kilo gül — adım morda kalsaydı ızgarada iki mor kart yan yana dururdu.
  // Kehribar mevcut 3-hue paletinin içinden (yeni hue eklenmedi); tek tüketicisi StatStrip.
  steps: '#FFB020',
  weight: '#FF5C7A',
  streak: '#FFB020',
  workout: '#8B5CF6',
  challenge: '#8B5CF6',
} as const;

// FIX (audit UI-DS-07): removed no-op GRADIENTS/HERO_GRADIENTS exports — they were
// deprecated tuples repeating the same color (flat design has no gradients) and had
// zero consumers app-wide. Use METRIC_COLORS for flat metric accents.

export interface ThemeContextType {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  colors: DARK_COLORS,
  isDark: true,
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
