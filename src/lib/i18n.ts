/**
 * Internationalization — Spec 20.2
 * Türkçe öncelikli, İngilizce ikinci.
 * Key-value translation with Turkish fallback.
 * All UI strings should use t() for future localization.
 */

export type Locale = 'tr' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  tr: {
    // App
    'app.name': 'Kochko',
    'app.tagline': 'AI Yasam Tarzi Kocun',

    // Auth
    'auth.login': 'Giris Yap',
    'auth.register': 'Kayit Ol',
    'auth.email': 'E-posta',
    'auth.password': 'Sifre',
    'auth.password_confirm': 'Sifre Tekrar',
    'auth.birth_year': 'Dogum Yili',
    'auth.age_error': 'Bu uygulama 18 yas ve uzeri icindir.',
    'auth.forgot_password': 'Sifremi Unuttum',
    'auth.reset_password': 'Sifreni Sifirla',
    'auth.reset_sent': 'Sifirlama linki gonderildi. E-postani kontrol et.',
    'auth.email_verify': 'E-posta dogrulamasi gerekli.',
    'auth.already_registered': 'Zaten hesabin var mi?',
    'auth.no_account': 'Hesabin yok mu?',
    'auth.google': 'Google ile Giris',
    'auth.apple': 'Apple ile Giris',
    'auth.or': 'veya',
    'auth.privacy_notice': 'Kayit olarak Kullanim Sartlari ve Gizlilik Politikasini kabul etmis olursun.',

    // Tabs
    'tab.today': 'Bugun',
    'tab.coach': 'Koc',
    'tab.plan': 'Plan',
    'tab.progress': 'Ilerleme',
    'tab.profile': 'Profil',

    // Dashboard
    'dashboard.title': 'Bugun',
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'su',
    'dashboard.sleep': 'uyku',
    'dashboard.steps': 'adim',
    'dashboard.mood': 'ruh hali',
    'dashboard.no_meals': 'Kocuna ne yedigini yaz veya + butonuna bas.',
    'dashboard.no_workouts': 'Henuz antrenman yok.',
    'dashboard.quick_input': 'Kocuna yaz... ne yedin, ne yaptin, nasil hissediyorsun',
    'dashboard.long_press': 'Uzun bas: kaydi sil',

    // Meals
    'meal.breakfast': 'Kahvalti',
    'meal.lunch': 'Ogle',
    'meal.dinner': 'Aksam',
    'meal.snack': 'Ara Ogun',

    // Macros
    'macro.protein': 'Protein',
    'macro.carbs': 'Karbonhidrat',
    'macro.fat': 'Yag',
    'macro.alcohol': 'Alkol',
    'macro.calories': 'Kalori',
    'macro.water': 'Su',

    // Plan
    'plan.title': 'Gunun Plani',
    'plan.no_plan': 'Henuz plan olusturulmamis.',
    'plan.generate': 'Plan Olustur',
    'plan.regenerate': 'Plani Yeniden Olustur',
    'plan.training_day': 'Antrenman',
    'plan.rest_day': 'Dinlenme',
    'plan.workout': 'Antrenman',
    'plan.snack_strategy': 'Atistirma Stratejisi',
    'plan.log_meal': 'Bu Ogunu Kaydet',
    'plan.complete_workout': 'Antrenmani Tamamla',

    // Progress
    'progress.title': 'Ilerleme',
    'progress.weight_trend': 'Kilo Trendi',
    'progress.compliance_trend': 'Uyum Puani',
    'progress.calorie_trend': 'Kalori Trendi',
    'progress.protein_trend': 'Protein Trendi',
    'progress.water_trend': 'Su Tuketimi',
    'progress.sleep_trend': 'Uyku Trendi',
    'progress.steps_trend': 'Adim Trendi',
    'progress.mood_trend': 'Ruh Hali Trendi',
    'progress.goal_remaining': 'Hedefe Kalan Yol',
    'progress.best_day': 'En Iyi',
    'progress.worst_day': 'En Kotu',
    'progress.plateau': 'Plateau Tespiti',
    'progress.maintenance': 'Bakim Modu',

    // Reports
    'report.daily': 'Gun Sonu Raporu',
    'report.weekly': 'Haftalik Rapor',
    'report.monthly': 'Aylik Rapor',
    'report.alltime': 'Tum Zamanlar',
    'report.compliance': 'Uyum Puani',
    'report.goals_check': 'Hedef Kontrolu',
    'report.macros': 'Makro Dagilimi',
    'report.tomorrow': 'Yarin Icin Tek Aksiyon',
    'report.evaluation': 'Degerlendirme',
    'report.generate': 'Rapor Olustur',
    'report.share': 'Paylas',

    // Settings
    'settings.title': 'Ayarlar',
    'settings.goals': 'Hedef Ayarlari',
    'settings.food_prefs': 'Yemek Tercihleri',
    'settings.meal_templates': 'Favori Ogunler',
    'settings.health': 'Saglik Gecmisi',
    'settings.lab': 'Lab Degerleri',
    'settings.supplements': 'Supplement Takibi',
    'settings.venues': 'Mekanlar',
    'settings.strength': 'Guc Progresyon',
    'settings.challenges': 'Challenge\'lar',
    'settings.achievements': 'Basarimlar',
    'settings.recipes': 'Tarif Kutuphanesi',
    'settings.weekly_menu': 'Haftalik Menu',
    'settings.coach_tone': 'Koc Tonu',
    'settings.notifications': 'Bildirimler',
    'settings.periodic': 'Donemsel Durum',
    'settings.if_settings': 'IF Ayarlari',
    'settings.menstrual': 'Adet Dongusu',
    'settings.multi_phase': 'Cok Fazli Hedefler',
    'settings.premium': 'Premium',
    'settings.export_json': 'JSON Export',
    'settings.export_csv': 'CSV Export',
    'settings.health_export': 'Saglik Raporu',
    'settings.import': 'Veri Iceri Aktar',
    'settings.chat_history': 'Sohbet Gecmisi',
    'settings.scheduled_export': 'Otomatik Yedek',
    'settings.timezone': 'Saat Dilimi',
    'settings.theme': 'Tema',
    'settings.day_boundary': 'Gun Siniri',
    'settings.sessions': 'Aktif Oturumlar',
    'settings.account_linking': 'Hesap Baglama',
    'settings.change_email': 'E-posta Degistir',
    'settings.change_password': 'Sifre Degistir',
    'settings.photos': 'Ilerleme Fotograflari',
    'settings.debug': 'Debug Modu',
    'settings.edit_profile': 'Profil Duzenle',
    'settings.sign_out': 'Cikis Yap',
    'settings.delete_account': 'Hesabimi Sil',
    'settings.privacy': 'Gizlilik ve Guvenlik',

    // Coach
    'coach.strict': 'Sert Koc',
    'coach.balanced': 'Dengeli',
    'coach.gentle': 'Yumusak Destekleyici',

    // Chat
    'chat.placeholder': 'Mesajini yaz...',
    'chat.typing': 'Kochko yaziyor...',
    'chat.voice': 'Sesli mesaj',
    'chat.photo': 'Fotograf',
    'chat.quota_title': 'Gunluk Limit',
    'chat.quota_msg': 'Ucretsiz planda gunluk 5 mesaj hakkin var.',

    // Goals
    'goal.lose_weight': 'Kilo Ver',
    'goal.gain_weight': 'Kilo Al',
    'goal.gain_muscle': 'Kas Kazan',
    'goal.health': 'Saglikli Yasam',
    'goal.maintain': 'Kilo Koru',
    'goal.conditioning': 'Kondisyon',

    // Common
    'common.save': 'Kaydet',
    'common.cancel': 'Iptal',
    'common.delete': 'Sil',
    'common.edit': 'Duzenle',
    'common.loading': 'Yukleniyor...',
    'common.error': 'Hata',
    'common.success': 'Basarili',
    'common.confirm': 'Onayla',
    'common.back': 'Geri',
    'common.next': 'Devam',
    'common.start': 'Basla',
    'common.close': 'Kapat',
    'common.share': 'Paylas',
    'common.reset': 'Sifirla',
    'common.long_press_delete': 'Uzun bas: sil',
    'common.tap_edit': 'Dokun: duzenle',
    'common.pull_refresh': 'Cekerek yenile',

    // Guardrails
    'guardrail.medical_disclaimer': 'Bu bir yasam tarzi onerisidir, tibbi tavsiye degildir.',
    'guardrail.consult_doctor': 'Bir saglik profesyoneline danismanizi oneririz.',
    'guardrail.emergency': 'Ciddi bir saglik belirtisi anlattiniz. Lutfen 112\'yi arayin.',
    'guardrail.calorie_floor': 'Gunluk kalori alt sinirinin altina inilemez.',
    'guardrail.weight_rate': 'Haftalik 1 kg\'dan fazla kilo kaybi onerilmez.',

    // Premium
    'premium.title': 'Premium\'a Gec',
    'premium.active': 'Premium Aktif',
    'premium.trial': '7 gun ucretsiz dene',
    'premium.monthly': 'Aylik',
    'premium.yearly': 'Yillik',
    'premium.cancel': 'Aboneligi Iptal Et',

    // Periodic states
    'periodic.ramadan': 'Ramazan / Oruc',
    'periodic.holiday': 'Tatil',
    'periodic.illness': 'Hastalik',
    'periodic.busy_work': 'Yogun Is Donemi',
    'periodic.exam': 'Sinav Donemi',
    'periodic.pregnancy': 'Hamilelik',
    'periodic.breastfeeding': 'Emzirme',
    'periodic.injury': 'Sakatlanma',
    'periodic.travel': 'Seyahat',
    'periodic.custom': 'Ozel Donem',
  },

  en: {
    'app.name': 'Kochko',
    'app.tagline': 'Your AI Lifestyle Coach',
    'auth.login': 'Log In',
    'auth.register': 'Sign Up',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.password_confirm': 'Confirm Password',
    'auth.birth_year': 'Birth Year',
    'auth.age_error': 'This app is for users 18 and older.',
    'auth.forgot_password': 'Forgot Password',
    'auth.google': 'Sign in with Google',
    'auth.apple': 'Sign in with Apple',
    'auth.or': 'or',
    'tab.today': 'Today',
    'tab.coach': 'Coach',
    'tab.plan': 'Plan',
    'tab.progress': 'Progress',
    'tab.profile': 'Profile',
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'water',
    'dashboard.sleep': 'sleep',
    'dashboard.steps': 'steps',
    'dashboard.mood': 'mood',
    'meal.breakfast': 'Breakfast',
    'meal.lunch': 'Lunch',
    'meal.dinner': 'Dinner',
    'meal.snack': 'Snack',
    'macro.protein': 'Protein',
    'macro.carbs': 'Carbs',
    'macro.fat': 'Fat',
    'macro.alcohol': 'Alcohol',
    'plan.title': 'Today\'s Plan',
    'plan.generate': 'Generate Plan',
    'plan.training_day': 'Training',
    'plan.rest_day': 'Rest',
    'progress.title': 'Progress',
    'report.daily': 'Daily Report',
    'report.weekly': 'Weekly Report',
    'report.monthly': 'Monthly Report',
    'settings.title': 'Settings',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.share': 'Share',
    'guardrail.medical_disclaimer': 'This is a lifestyle suggestion, not medical advice.',
    'guardrail.consult_doctor': 'We recommend consulting a healthcare professional.',
    'guardrail.emergency': 'You described serious symptoms. Please call emergency services.',
    'goal.lose_weight': 'Lose Weight',
    'goal.gain_weight': 'Gain Weight',
    'goal.gain_muscle': 'Build Muscle',
    'goal.health': 'Health',
    'goal.maintain': 'Maintain',
    'goal.conditioning': 'Conditioning',
    'premium.title': 'Go Premium',
    'premium.active': 'Premium Active',
    'premium.trial': '7-day free trial',
  },
};

let currentLocale: Locale = 'tr';

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get translated string. Falls back to Turkish, then key.
 */
export function t(key: string): string {
  return translations[currentLocale]?.[key] ?? translations.tr[key] ?? key;
}

/**
 * Get all available keys for a prefix.
 * Useful for listing all meals, goals, etc.
 */
export function tPrefix(prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  const dict = translations[currentLocale] ?? translations.tr;
  for (const [key, value] of Object.entries(dict)) {
    if (key.startsWith(prefix + '.')) {
      result[key.replace(prefix + '.', '')] = value;
    }
  }
  return result;
}
