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
    'app.tagline': 'Yaşam Tarzı Koçun',

    // Auth
    'auth.login': 'Giriş Yap',
    'auth.register': 'Kayıt Ol',
    'auth.email': 'E-posta',
    'auth.password': 'Şifre',
    'auth.forgot_password': 'Şifremi Unuttum',
    'auth.reset_password': 'Şifre Sıfırla',
    'auth.birth_year': 'Doğum Yılı',
    'auth.age_error': 'Bu uygulama 18 yaş ve üzeri içindir.',
    'auth.logout': 'Çıkış Yap',
    'auth.logout_confirm': 'Çıkmak istediğine emin misin?',

    // Tabs
    'tab.today': 'Bugün',
    'tab.coach': 'Koç',
    'tab.plan': 'Plan',
    'tab.progress': 'İlerleme',
    'tab.profile': 'Profil',

    // Dashboard
    'dashboard.calories': 'kcal',
    'dashboard.protein': 'protein',
    'dashboard.water': 'su',
    'dashboard.sleep': 'uyku',
    'dashboard.steps': 'adım',
    'dashboard.mood': 'ruh hali',
    'dashboard.no_logs': 'Koçuna ne yediğini yaz.',
    'dashboard.streak': 'gün seri',
    'dashboard.today_summary': 'Bugünün Özeti',
    'dashboard.weekly_budget': 'Haftalık Bütçe',

    // Meals
    'meal.breakfast': 'Kahvaltı',
    'meal.lunch': 'Öğle',
    'meal.dinner': 'Akşam',
    'meal.snack': 'Ara',
    'meal.add': 'Öğün Ekle',
    'meal.log': 'Öğün Kaydı',
    'meal.photo': 'Fotoğraf Çek',
    'meal.barcode': 'Barkod Tara',
    'meal.template': 'Şablondan Ekle',
    'meal.voice': 'Sesli Kayıt',

    // Goals
    'goal.title': 'Hedefler',
    'goal.lose_weight': 'Kilo Ver',
    'goal.gain_weight': 'Kilo Al',
    'goal.gain_muscle': 'Kas Kazan',
    'goal.maintain': 'Kilonu Koru',
    'goal.health': 'Sağlıklı Yaşam',
    'goal.progress': 'Hedef İlerlemesi',
    'goal.target': 'Hedef',
    'goal.current': 'Mevcut',
    'goal.remaining': 'Kalan',

    // Reports
    'report.daily': 'Gün Sonu Raporu',
    'report.weekly': 'Haftalık Rapor',
    'report.monthly': 'Aylık Rapor',
    'report.compliance': 'Uyum Puanı',
    'report.export': 'Rapor İndir',
    'report.share': 'Paylaş',

    // Settings
    'settings.title': 'Ayarlar',
    'settings.goals': 'Hedef Ayarları',
    'settings.food_prefs': 'Yemek Tercihleri',
    'settings.health': 'Sağlık Geçmişi',
    'settings.lab': 'Lab Değerleri',
    'settings.export': 'Veri Dışa Aktar',
    'settings.import': 'Veri İçe Aktar',
    'settings.delete_account': 'Hesabımı Sil',
    'settings.sign_out': 'Çıkış Yap',
    'settings.notifications': 'Bildirimler',
    'settings.language': 'Dil',
    'settings.theme': 'Tema',
    'settings.dark_mode': 'Karanlık Mod',
    'settings.units': 'Birim Sistemi',
    'settings.privacy': 'Gizlilik',
    'settings.about': 'Hakkında',
    'settings.version': 'Versiyon',

    // Common Actions
    'common.save': 'Kaydet',
    'common.cancel': 'İptal',
    'common.delete': 'Sil',
    'common.edit': 'Düzenle',
    'common.add': 'Ekle',
    'common.remove': 'Kaldır',
    'common.close': 'Kapat',
    'common.back': 'Geri',
    'common.next': 'İleri',
    'common.done': 'Tamam',
    'common.retry': 'Tekrar Dene',
    'common.skip': 'Atla',
    'common.search': 'Ara',
    'common.filter': 'Filtrele',
    'common.sort': 'Sırala',
    'common.refresh': 'Yenile',
    'common.share': 'Paylaş',
    'common.copy': 'Kopyala',
    'common.select': 'Seç',
    'common.select_all': 'Tümünü Seç',
    'common.confirm': 'Onayla',
    'common.yes': 'Evet',
    'common.no': 'Hayır',
    'common.ok': 'Tamam',

    // Status Messages
    'common.loading': 'Yükleniyor...',
    'common.error': 'Hata',
    'common.success': 'Başarılı',
    'common.saved': 'Kaydedildi',
    'common.deleted': 'Silindi',
    'common.updated': 'Güncellendi',
    'common.no_data': 'Veri bulunamadı',
    'common.no_results': 'Sonuç bulunamadı',
    'common.offline': 'Çevrimdışı',
    'common.online': 'Çevrimiçi',
    'common.syncing': 'Senkronize ediliyor...',
    'common.long_press_delete': 'Uzun bas: sil',

    // Time
    'time.today': 'Bugün',
    'time.yesterday': 'Dün',
    'time.this_week': 'Bu Hafta',
    'time.last_week': 'Geçen Hafta',
    'time.this_month': 'Bu Ay',
    'time.days': 'gün',
    'time.hours': 'saat',
    'time.minutes': 'dakika',

    // Units
    'unit.kg': 'kg',
    'unit.gram': 'g',
    'unit.liter': 'L',
    'unit.ml': 'ml',
    'unit.kcal': 'kcal',
    'unit.steps': 'adım',
    'unit.cm': 'cm',
    'unit.percent': '%',

    // Profile
    'profile.title': 'Profil',
    'profile.height': 'Boy',
    'profile.weight': 'Kilo',
    'profile.age': 'Yaş',
    'profile.gender': 'Cinsiyet',
    'profile.activity_level': 'Aktivite Düzeyi',
    'profile.completion': 'Profil Tamamlanma',

    // Water
    'water.title': 'Su Takibi',
    'water.add': 'Su Ekle',
    'water.target': 'Su Hedefi',
    'water.remaining': 'Kalan',

    // Coach / Chat
    'coach.title': 'AI Koçun',
    'coach.placeholder': 'Mesajını yaz...',
    'coach.thinking': 'Düşünüyor...',
    'coach.feedback_helpful': 'İşe yaradı',
    'coach.feedback_not_for_me': 'Bana göre değil',

    // Onboarding
    'onboarding.welcome': 'Hoş geldin!',
    'onboarding.step': 'Adım',
    'onboarding.of': '/',
    'onboarding.complete': 'Tamamla',

    // Premium
    'premium.title': 'Premium',
    'premium.upgrade': 'Premium\'a Yükselt',
    'premium.trial': 'Ücretsiz Dene',
    'premium.features': 'Premium Özellikler',

    // Guardrails
    'guardrail.medical_disclaimer': 'Bu bir yaşam tarzı önerisidir, tıbbi tavsiye değildir.',
    'guardrail.consult_doctor': 'Bir sağlık profesyoneline danışmanı öneririz.',
    'guardrail.emergency': 'Ciddi bir sağlık belirtisi anlattın. Lütfen 112\'yi ara.',

    // Accessibility
    'a11y.increase': 'Artır',
    'a11y.decrease': 'Azalt',
    'a11y.open_menu': 'Menüyü aç',
    'a11y.close_menu': 'Menüyü kapat',
    'a11y.navigate_back': 'Geri dön',
    'a11y.progress_of': '/ hedefinden',

    // Widget
    'widget.title': 'Widget Önizleme',
    'widget.calories': 'Kalori',
    'widget.protein': 'Protein',
    'widget.water': 'Su',
    'widget.steps': 'Adım',
    'widget.streak': 'Seri',
    'widget.focus': 'Bugünün Odağı',
    'widget.budget_remaining': 'Kalan Bütçe',

    // Coach Mode (B2B)
    'coach.mode': 'Koç Modu',
    'coach.clients': 'Danışanlar',
    'coach.share_data': 'Veri Paylaş',
    'coach.revoke_access': 'Erişimi Kaldır',
    'coach.data_shared': 'Veri paylaşımı aktif',
    'coach.no_clients': 'Henüz danışan yok',

    // Household / Family
    'household.title': 'Aile',
    'household.members': 'Aile Üyeleri',
    'household.create': 'Aile Oluştur',
    'household.join': 'Aileye Katıl',
    'household.leave': 'Aileden Ayrıl',
    'household.invite_code': 'Davet Kodu',
    'household.shared_list': 'Ortak Alışveriş Listesi',
    'household.shopping': 'Alışveriş',

    // Analytics
    'analytics.retention': 'Elde Tutma',
    'analytics.engagement': 'Etkileşim',
    'analytics.conversion': 'Dönüşüm',
    'analytics.active_days': 'Aktif Gün',
    'analytics.sessions': 'Oturum',
    'analytics.avg_meals': 'Ortalama Öğün',
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

    // Widget
    'widget.title': 'Widget Preview',
    'widget.calories': 'Calories',
    'widget.protein': 'Protein',
    'widget.water': 'Water',
    'widget.steps': 'Steps',
    'widget.streak': 'Streak',
    'widget.focus': 'Today\'s Focus',
    'widget.budget_remaining': 'Budget Remaining',

    // Coach Mode (B2B)
    'coach.mode': 'Coach Mode',
    'coach.clients': 'Clients',
    'coach.share_data': 'Share Data',
    'coach.revoke_access': 'Revoke Access',
    'coach.data_shared': 'Data sharing active',
    'coach.no_clients': 'No clients yet',

    // Household / Family
    'household.title': 'Family',
    'household.members': 'Family Members',
    'household.create': 'Create Household',
    'household.join': 'Join Household',
    'household.leave': 'Leave Household',
    'household.invite_code': 'Invite Code',
    'household.shared_list': 'Shared Shopping List',
    'household.shopping': 'Shopping',

    // Analytics
    'analytics.retention': 'Retention',
    'analytics.engagement': 'Engagement',
    'analytics.conversion': 'Conversion',
    'analytics.active_days': 'Active Days',
    'analytics.sessions': 'Sessions',
    'analytics.avg_meals': 'Average Meals',
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
    { code: 'tr', name: 'Türkçe' },
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
