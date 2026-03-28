/**
 * Internationalization Base
 * Spec 20.2: Çoklu dil desteği, Türkçe öncelikli, İngilizce ikinci
 *
 * Minimal i18n setup - key-value translation with fallback.
 * Full implementation would use react-i18next or similar.
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
    'auth.birth_year': 'Dogum Yili',
    'auth.age_error': 'Bu uygulama 18 yas ve uzeri icindir.',

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

    // Meals
    'meal.breakfast': 'Kahvalti',
    'meal.lunch': 'Ogle',
    'meal.dinner': 'Aksam',
    'meal.snack': 'Ara',

    // Reports
    'report.daily': 'Gun Sonu Raporu',
    'report.weekly': 'Haftalik Rapor',
    'report.compliance': 'Uyum Puani',

    // Settings
    'settings.title': 'Ayarlar',
    'settings.goals': 'Hedef Ayarlari',
    'settings.food_prefs': 'Yemek Tercihleri',
    'settings.health': 'Saglik Gecmisi',
    'settings.lab': 'Lab Degerleri',
    'settings.export': 'Veri Disa Aktar',
    'settings.delete_account': 'Hesabimi Sil',
    'settings.sign_out': 'Cikis Yap',

    // Common
    'common.save': 'Kaydet',
    'common.cancel': 'Iptal',
    'common.delete': 'Sil',
    'common.edit': 'Duzenle',
    'common.loading': 'Yukleniyor...',
    'common.error': 'Hata',
    'common.success': 'Basarili',
    'common.confirm': 'Onayla',
    'common.long_press_delete': 'Uzun bas: sil',

    // Guardrails
    'guardrail.medical_disclaimer': 'Bu bir yasam tarzi onerisidir, tibbi tavsiye degildir.',
    'guardrail.consult_doctor': 'Bir saglik profesyoneline danismanizi oneririz.',
    'guardrail.emergency': 'Ciddi bir saglik belirtisi anlattiniz. Lutfen 112\'yi arayin.',
  },
  en: {
    'app.name': 'Kochko',
    'app.tagline': 'Your Lifestyle Coach',
    'auth.login': 'Log In',
    'auth.register': 'Sign Up',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.birth_year': 'Birth Year',
    'auth.age_error': 'This app is for users 18 and older.',
    'tab.today': 'Today',
    'tab.coach': 'Coach',
    'tab.plan': 'Plan',
    'tab.progress': 'Progress',
    'tab.profile': 'Profile',
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'water',
    'dashboard.sleep': 'sleep',
    'meal.breakfast': 'Breakfast',
    'meal.lunch': 'Lunch',
    'meal.dinner': 'Dinner',
    'meal.snack': 'Snack',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'guardrail.medical_disclaimer': 'This is a lifestyle suggestion, not medical advice.',
    'guardrail.consult_doctor': 'We recommend consulting a healthcare professional.',
    'guardrail.emergency': 'You described serious symptoms. Please call emergency services.',
  },
};

let currentLocale: Locale = 'tr';

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string): string {
  return translations[currentLocale]?.[key] ?? translations.tr[key] ?? key;
}
