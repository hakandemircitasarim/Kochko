export default {
  expo: {
    name: 'Kochko',
    slug: 'kochko',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'kochko',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      // 2026-08-09: koyu lacivert açılış, varsayılan AÇIK temaya koyu→açık flaş yaptırıyordu;
      // zemin açık temanın kendisi, logo da menekşeye boyandı (yeşil yasak — logo yeşilin
      // son sığınağıydı, PNG piksellerini hex grep göremiyor).
      backgroundColor: '#F5F7FA',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.kochko.app',
      infoPlist: {
        NSCameraUsageDescription: 'Kochko ogun ve barkod fotografi cekmen icin kameraya erisir.',
        NSMicrophoneUsageDescription: 'Kochko sesli kayit (yemegini soyleyerek girme) icin mikrofona erisir.',
        NSPhotoLibraryUsageDescription: 'Kochko galeriden ogun fotografi secmen icin galerine erisir.',
        NSPhotoLibraryAddUsageDescription: 'Kochko ilerleme/paylasim gorsellerini galerine kaydeder.',
        NSMotionUsageDescription: 'Kochko gunluk adim sayini okumak icin hareket verisine erisir.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#1a1a2e',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      package: 'com.kochko.app',
      // Play HER yüklemede versionCode'un ARTMASINI şart koşar. Bu alan yokken prebuild
      // build.gradle'a sabit `versionCode 1` yazıyordu — ilk yükleme geçer, İKİNCİSİ
      // "Version code 1 has already been used" ile reddedilirdi ve sebebi üretilmiş,
      // gitignore'lu bir dosyada gizliydi. Artık sürüm kimliği burada, sürüm kontrolünde.
      // ⚠ HER Play yüklemesinden önce 1 artır (RELEASE_CHECKLIST.md).
      versionCode: 1,
      permissions: ['CAMERA', 'RECORD_AUDIO', 'ACTIVITY_RECOGNITION', 'POST_NOTIFICATIONS'],
      // launch: expo-dev-client injects SYSTEM_ALERT_WINDOW; the shipped app never needs it and
      // it triggers Play's sensitive-permission review. Blocked at prebuild (manifest also
      // carries a tools:node="remove" for the current local android/).
      blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    // Native config plugins must be registered or the APK ships without these modules'
    // permissions and crashes on camera/photo/notification access.
    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-camera', { cameraPermission: 'Kochko ogun ve barkod fotografi cekmen icin kameraya erisir.' }],
      ['expo-image-picker', { photosPermission: 'Kochko galeriden ogun fotografi secmen icin galerine erisir.' }],
      // Android bildirim ikonu SİLUET olmak zorunda: sistem saydam olmayan her pikseli
      // beyaza boyar. Yapılandırma yokken expo-notifications uygulama ikonunu kullanıyordu
      // ve renkli/kare logo durum çubuğunda BEYAZ BİR KAREYE dönüşüyordu. Monokrom varlık
      // zaten siluet — onu ver. Tint 2026-08-07'de teal→menekşe: yeşil YASAK (görsel dil
      // §0-A), depodaki son yeşil hex buydu.
      ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#6D3FE0' }],
      // Natif metin-seçim vurgusu markaya çekildi (turkuaz sızıntısı) — bkz. plugin dosyası.
      './plugins/withBrandAccent',
      // Durum/gezinme çubuğu ikon rengini edge-to-edge altında ayarlayabilmek için
      // (app/_layout.tsx → <SystemBars>). Android 15'te edge-to-edge zorunlu olduğundan
      // RN'in kendi StatusBar stil çağrıları yok sayılıyor.
      'react-native-edge-to-edge',
    ],
    updates: {
      // `expo-updates` KURULU DEĞİL (package.json'da yok) ve hiçbir güncelleme URL'i
      // yapılandırılmadı — bu blok `enabled: true` iken bile hiçbir şey yapmıyordu, yalnızca
      // "OTA hotfix yolumuz var" izlenimi veriyordu. Dürüst durum: yok.
      // Açmak için: `npx expo install expo-updates` + `eas update:configure`, sonra enabled: true.
      enabled: false,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: { policy: 'appVersion' },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
      posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST,
      // `eas` block populated by `eas build:configure`. Leave as-is.
      eas: { projectId: process.env.EAS_PROJECT_ID },
    },
  },
};
