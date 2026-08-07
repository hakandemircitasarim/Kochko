/**
 * withBrandAccent — natif Android temasına marka menekşesini colorAccent olarak yazar.
 *
 * NEDEN: AppCompat temasında colorAccent tanımsız bırakılınca metin SEÇİM vurgusu ve
 * tutamaçları kütüphanenin varsayılan TURKUAZI ile çiziliyordu (tartı girişinde cihazda
 * ölçüldü, 2026-08-07). Yeşil/turkuaz yasak (görsel dil §0-A); marka menekşe.
 *
 * NEDEN PLUGIN: android/ gitignore'lu ve `expo prebuild` ile yeniden üretiliyor —
 * styles.xml'i elle düzeltmek bir sonraki prebuild'de kaybolur. Kalıcı yol bu dosya.
 * (Mevcut yerel android/ klasörüne aynı değerler elle de uygulandı; bu plugin yalnız
 * gelecekteki prebuild'lerin aynı sonucu üretmesini garanti eder.)
 */
const { withAndroidColors, withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

const ACCENT = '#6D3FE0'; // açık temanın primary'si — theme.ts LIGHT_COLORS.primary

module.exports = function withBrandAccent(config) {
  config = withAndroidColors(config, (c) => {
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, {
      name: 'colorAccent',
      value: ACCENT,
    });
    return c;
  });
  config = withAndroidStyles(config, (c) => {
    c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
      add: true,
      parent: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
      name: 'colorAccent',
      value: '@color/colorAccent',
    });
    return c;
  });
  return config;
};
