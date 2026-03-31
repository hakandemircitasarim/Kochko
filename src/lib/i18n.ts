/**
 * Internationalization System
 * Spec 20.2: Çoklu dil desteği, Türkçe öncelikli, İngilizce ikinci
 *
 * Key-value translation with fallback. Turkish is the default locale.
 * Full implementation would integrate react-i18next for component-level usage.
 */

export type Locale = 'tr' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  tr: {
    // App
    'app.name': 'Kochko',
    'app.tagline': 'Yasam Tarzi Kocun',

    // Auth
    'auth.login': 'Giris Yap',
    'auth.register': 'Kayit Ol',
    'auth.email': 'E-posta',
    'auth.password': 'Sifre',
    'auth.forgot_password': 'Sifremi Unuttum',
    'auth.reset_password': 'Sifre Sifirla',
    'auth.birth_year': 'Dogum Yili',
    'auth.age_error': 'Bu uygulama 18 yas ve uzeri icindir.',
    'auth.logout': 'Cikis Yap',
    'auth.logout_confirm': 'Cikmak istediginize emin misiniz?',

    // Tabs
    'tab.today': 'Bugun',
    'tab.coach': 'Koc',
    'tab.plan': 'Plan',
    'tab.progress': 'Ilerleme',
    'tab.profile': 'Profil',

    // Dashboard
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'su',
    'dashboard.sleep': 'uyku',
    'dashboard.steps': 'adim',
    'dashboard.mood': 'ruh hali',
    'dashboard.no_logs': 'Kocuna ne yedigini yaz.',
    'dashboard.streak': 'gun seri',
    'dashboard.today_summary': 'Bugunun Ozeti',
    'dashboard.weekly_budget': 'Haftalik Butce',

    // Meals
    'meal.breakfast': 'Kahvalti',
    'meal.lunch': 'Ogle',
    'meal.dinner': 'Aksam',
    'meal.snack': 'Ara',
    'meal.add': 'Ogun Ekle',
    'meal.log': 'Ogun Kaydi',
    'meal.photo': 'Fotograf Cek',
    'meal.barcode': 'Barkod Tara',
    'meal.template': 'Sablondan Ekle',
    'meal.voice': 'Sesli Kayit',

    // Goals
    'goal.title': 'Hedefler',
    'goal.lose_weight': 'Kilo Ver',
    'goal.gain_weight': 'Kilo Al',
    'goal.gain_muscle': 'Kas Kazan',
    'goal.maintain': 'Kilonu Koru',
    'goal.health': 'Saglikli Yasam',
    'goal.progress': 'Hedef Ilerlemesi',
    'goal.target': 'Hedef',
    'goal.current': 'Mevcut',
    'goal.remaining': 'Kalan',

    // Reports
    'report.daily': 'Gun Sonu Raporu',
    'report.weekly': 'Haftalik Rapor',
    'report.monthly': 'Aylik Rapor',
    'report.compliance': 'Uyum Puani',
    'report.export': 'Rapor Indir',
    'report.share': 'Paylas',

    // Settings
    'settings.title': 'Ayarlar',
    'settings.goals': 'Hedef Ayarlari',
    'settings.food_prefs': 'Yemek Tercihleri',
    'settings.health': 'Saglik Gecmisi',
    'settings.lab': 'Lab Degerleri',
    'settings.export': 'Veri Disa Aktar',
    'settings.import': 'Veri Iceriktar',
    'settings.delete_account': 'Hesabimi Sil',
    'settings.sign_out': 'Cikis Yap',
    'settings.notifications': 'Bildirimler',
    'settings.language': 'Dil',
    'settings.theme': 'Tema',
    'settings.dark_mode': 'Karanlik Mod',
    'settings.units': 'Birim Sistemi',
    'settings.privacy': 'Gizlilik',
    'settings.about': 'Hakkinda',
    'settings.version': 'Versiyon',

    // Common Actions
    'common.save': 'Kaydet',
    'common.cancel': 'Iptal',
    'common.delete': 'Sil',
    'common.edit': 'Duzenle',
    'common.add': 'Ekle',
    'common.remove': 'Kaldir',
    'common.close': 'Kapat',
    'common.back': 'Geri',
    'common.next': 'Ileri',
    'common.done': 'Tamam',
    'common.retry': 'Tekrar Dene',
    'common.skip': 'Atla',
    'common.search': 'Ara',
    'common.filter': 'Filtrele',
    'common.sort': 'Sirala',
    'common.refresh': 'Yenile',
    'common.share': 'Paylas',
    'common.copy': 'Kopyala',
    'common.select': 'Sec',
    'common.select_all': 'Tumunu Sec',
    'common.confirm': 'Onayla',
    'common.yes': 'Evet',
    'common.no': 'Hayir',
    'common.ok': 'Tamam',

    // Status Messages
    'common.loading': 'Yukleniyor...',
    'common.error': 'Hata',
    'common.success': 'Basarili',
    'common.saved': 'Kaydedildi',
    'common.deleted': 'Silindi',
    'common.updated': 'Guncellendi',
    'common.no_data': 'Veri bulunamadi',
    'common.no_results': 'Sonuc bulunamadi',
    'common.offline': 'Cevrimdisi',
    'common.online': 'Cevrimici',
    'common.syncing': 'Senkronize ediliyor...',
    'common.long_press_delete': 'Uzun bas: sil',

    // Time
    'time.today': 'Bugun',
    'time.yesterday': 'Dun',
    'time.this_week': 'Bu Hafta',
    'time.last_week': 'Gecen Hafta',
    'time.this_month': 'Bu Ay',
    'time.days': 'gun',
    'time.hours': 'saat',
    'time.minutes': 'dakika',

    // Units
    'unit.kg': 'kg',
    'unit.gram': 'g',
    'unit.liter': 'L',
    'unit.ml': 'ml',
    'unit.kcal': 'kcal',
    'unit.steps': 'adim',
    'unit.cm': 'cm',
    'unit.percent': '%',

    // Profile
    'profile.title': 'Profil',
    'profile.height': 'Boy',
    'profile.weight': 'Kilo',
    'profile.age': 'Yas',
    'profile.gender': 'Cinsiyet',
    'profile.activity_level': 'Aktivite Duzeyi',
    'profile.completion': 'Profil Tamamlanma',

    // Water
    'water.title': 'Su Takibi',
    'water.add': 'Su Ekle',
    'water.target': 'Su Hedefi',
    'water.remaining': 'Kalan',

    // Coach / Chat
    'coach.title': 'AI Kocun',
    'coach.placeholder': 'Mesajini yaz...',
    'coach.thinking': 'Dusunuyor...',
    'coach.feedback_helpful': 'Ise yaradi',
    'coach.feedback_not_for_me': 'Bana gore degil',

    // Onboarding
    'onboarding.welcome': 'Hosgeldiniz!',
    'onboarding.step': 'Adim',
    'onboarding.of': '/',
    'onboarding.complete': 'Tamamla',

    // Premium
    'premium.title': 'Premium',
    'premium.upgrade': 'Premium\'a Yukselt',
    'premium.trial': 'Ucretsiz Dene',
    'premium.features': 'Premium Ozellikler',

    // Guardrails
    'guardrail.medical_disclaimer': 'Bu bir yasam tarzi onerisidir, tibbi tavsiye degildir.',
    'guardrail.consult_doctor': 'Bir saglik profesyoneline danismanizi oneririz.',
    'guardrail.emergency': 'Ciddi bir saglik belirtisi anlattiniz. Lutfen 112\'yi arayin.',

    // Accessibility
    'a11y.increase': 'Artir',
    'a11y.decrease': 'Azalt',
    'a11y.open_menu': 'Menuyu ac',
    'a11y.close_menu': 'Menuyu kapat',
    'a11y.navigate_back': 'Geri don',
    'a11y.progress_of': '/ hedefinden',
  },

  en: {
    // App
    'app.name': 'Kochko',
    'app.tagline': 'Your Lifestyle Coach',

    // Auth
    'auth.login': 'Log In',
    'auth.register': 'Sign Up',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.forgot_password': 'Forgot Password',
    'auth.reset_password': 'Reset Password',
    'auth.birth_year': 'Birth Year',
    'auth.age_error': 'This app is for users 18 and older.',
    'auth.logout': 'Log Out',
    'auth.logout_confirm': 'Are you sure you want to log out?',

    // Tabs
    'tab.today': 'Today',
    'tab.coach': 'Coach',
    'tab.plan': 'Plan',
    'tab.progress': 'Progress',
    'tab.profile': 'Profile',

    // Dashboard
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'water',
    'dashboard.sleep': 'sleep',
    'dashboard.steps': 'steps',
    'dashboard.mood': 'mood',
    'dashboard.no_logs': 'Tell your coach what you ate.',
    'dashboard.streak': 'day streak',
    'dashboard.today_summary': 'Today\'s Summary',
    'dashboard.weekly_budget': 'Weekly Budget',

    // Meals
    'meal.breakfast': 'Breakfast',
    'meal.lunch': 'Lunch',
    'meal.dinner': 'Dinner',
    'meal.snack': 'Snack',
    'meal.add': 'Add Meal',
    'meal.log': 'Meal Log',
    'meal.photo': 'Take Photo',
    'meal.barcode': 'Scan Barcode',
    'meal.template': 'From Template',
    'meal.voice': 'Voice Input',

    // Goals
    'goal.title': 'Goals',
    'goal.lose_weight': 'Lose Weight',
    'goal.gain_weight': 'Gain Weight',
    'goal.gain_muscle': 'Build Muscle',
    'goal.maintain': 'Maintain Weight',
    'goal.health': 'Healthy Living',
    'goal.progress': 'Goal Progress',
    'goal.target': 'Target',
    'goal.current': 'Current',
    'goal.remaining': 'Remaining',

    // Reports
    'report.daily': 'Daily Report',
    'report.weekly': 'Weekly Report',
    'report.monthly': 'Monthly Report',
    'report.compliance': 'Compliance Score',
    'report.export': 'Download Report',
    'report.share': 'Share',

    // Settings
    'settings.title': 'Settings',
    'settings.goals': 'Goal Settings',
    'settings.food_prefs': 'Food Preferences',
    'settings.health': 'Health History',
    'settings.lab': 'Lab Values',
    'settings.export': 'Export Data',
    'settings.import': 'Import Data',
    'settings.delete_account': 'Delete Account',
    'settings.sign_out': 'Sign Out',
    'settings.notifications': 'Notifications',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.dark_mode': 'Dark Mode',
    'settings.units': 'Unit System',
    'settings.privacy': 'Privacy',
    'settings.about': 'About',
    'settings.version': 'Version',

    // Common Actions
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.remove': 'Remove',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.done': 'Done',
    'common.retry': 'Retry',
    'common.skip': 'Skip',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.refresh': 'Refresh',
    'common.share': 'Share',
    'common.copy': 'Copy',
    'common.select': 'Select',
    'common.select_all': 'Select All',
    'common.confirm': 'Confirm',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.ok': 'OK',

    // Status Messages
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.saved': 'Saved',
    'common.deleted': 'Deleted',
    'common.updated': 'Updated',
    'common.no_data': 'No data found',
    'common.no_results': 'No results found',
    'common.offline': 'Offline',
    'common.online': 'Online',
    'common.syncing': 'Syncing...',
    'common.long_press_delete': 'Long press to delete',

    // Time
    'time.today': 'Today',
    'time.yesterday': 'Yesterday',
    'time.this_week': 'This Week',
    'time.last_week': 'Last Week',
    'time.this_month': 'This Month',
    'time.days': 'days',
    'time.hours': 'hours',
    'time.minutes': 'minutes',

    // Units
    'unit.kg': 'kg',
    'unit.gram': 'g',
    'unit.liter': 'L',
    'unit.ml': 'ml',
    'unit.kcal': 'kcal',
    'unit.steps': 'steps',
    'unit.cm': 'cm',
    'unit.percent': '%',

    // Profile
    'profile.title': 'Profile',
    'profile.height': 'Height',
    'profile.weight': 'Weight',
    'profile.age': 'Age',
    'profile.gender': 'Gender',
    'profile.activity_level': 'Activity Level',
    'profile.completion': 'Profile Completion',

    // Water
    'water.title': 'Water Tracking',
    'water.add': 'Add Water',
    'water.target': 'Water Target',
    'water.remaining': 'Remaining',

    // Coach / Chat
    'coach.title': 'AI Coach',
    'coach.placeholder': 'Type a message...',
    'coach.thinking': 'Thinking...',
    'coach.feedback_helpful': 'Helpful',
    'coach.feedback_not_for_me': 'Not for me',

    // Onboarding
    'onboarding.welcome': 'Welcome!',
    'onboarding.step': 'Step',
    'onboarding.of': 'of',
    'onboarding.complete': 'Complete',

    // Premium
    'premium.title': 'Premium',
    'premium.upgrade': 'Upgrade to Premium',
    'premium.trial': 'Start Free Trial',
    'premium.features': 'Premium Features',

    // Guardrails
    'guardrail.medical_disclaimer': 'This is a lifestyle suggestion, not medical advice.',
    'guardrail.consult_doctor': 'We recommend consulting a healthcare professional.',
    'guardrail.emergency': 'You described serious symptoms. Please call emergency services.',

    // Accessibility
    'a11y.increase': 'Increase',
    'a11y.decrease': 'Decrease',
    'a11y.open_menu': 'Open menu',
    'a11y.close_menu': 'Close menu',
    'a11y.navigate_back': 'Go back',
    'a11y.progress_of': 'of target',
  },
};

let currentLocale: Locale = 'tr';

/**
 * Set the active locale for the app.
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Get the current active locale.
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Translate a key to the current locale.
 * Falls back to Turkish, then returns the key itself.
 */
export function t(key: string, locale?: Locale): string {
  const loc = locale ?? currentLocale;
  return translations[loc]?.[key] ?? translations.tr[key] ?? key;
}

/**
 * Get all available locales with display names.
 */
export function getAvailableLocales(): { code: Locale; name: string }[] {
  return [
    { code: 'tr', name: 'Turkce' },
    { code: 'en', name: 'English' },
  ];
}

/**
 * Check if a translation key exists for the given locale.
 */
export function hasTranslation(key: string, locale?: Locale): boolean {
  const loc = locale ?? currentLocale;
  return key in (translations[loc] ?? {});
}

/**
 * Get all keys for a given prefix (e.g., 'meal.' returns all meal-related keys).
 */
export function getKeysForPrefix(prefix: string, locale?: Locale): Record<string, string> {
  const loc = locale ?? currentLocale;
  const dict = translations[loc] ?? translations.tr;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    if (key.startsWith(prefix)) {
      result[key] = value;
    }
  }
  return result;
}
