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
      backgroundColor: '#1a1a2e',
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
      permissions: ['CAMERA', 'RECORD_AUDIO', 'ACTIVITY_RECOGNITION', 'POST_NOTIFICATIONS'],
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
      'expo-notifications',
    ],
    updates: {
      // Set EXPO_PUBLIC_UPDATES_URL after running `eas update:configure`.
      // Channels: 'preview' for TestFlight/Play Internal, 'production' for public.
      enabled: true,
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
