import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, Linking } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

// Hosted legal documents (KVKK aydınlatma / kullanım koşulları). Domain derives from the
// app bundle id (com.kochko.app); see crossFileNote — these pages must be published before launch.
const TERMS_URL = 'https://kochko.app/kullanim-kosullari';
const PRIVACY_URL = 'https://kochko.app/gizlilik';

// FIX (kullanıcı bulgusu): Google provider yapılandırılana dek buton gizli — login.tsx'teki
// aynı bayrak ve gerekçe (Supabase'te external_google_enabled=false, ölü buton bozuk sayfa açıyordu).
const GOOGLE_LOGIN_ENABLED = false;

// FIX (audit UX-FRM-04): basic client-side e-posta format kontrolü — bozuk bir
// e-posta sunucuya ulaşıp İngilizce bir hata döndürmeden önce yakalanır.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (v: string) => EMAIL_RE.test(v);

// FIX (audit UX-FRM-04): Supabase auth mesajları İngilizce gelir ('User already
// registered', 'Unable to validate email address: invalid format' ...). Türkçe-only
// kitleye Türkçe göster. login.tsx ile birebir aynı eşleme.
function localizeAuthError(message?: string | null): string {
  const m = (message ?? '').toLowerCase();
  if (!m) return 'Bir sorun oluştu. Lütfen tekrar dene.';
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) return 'E-posta veya şifre hatalı.';
  if (m.includes('email not confirmed') || m.includes('not confirmed')) return 'E-postanı henüz doğrulamadın. Lütfen gelen kutunu kontrol et.';
  if (m.includes('user already registered') || m.includes('already registered')) return 'Bu e-posta zaten kayıtlı.';
  if (m.includes('invalid email') || m.includes('invalid format') || m.includes('unable to validate email')) return 'Geçerli bir e-posta gir.';
  if (m.includes('password should be at least') || (m.includes('password') && m.includes('at least'))) return 'Şifre en az 6 karakter olmalı.';
  if (m.includes('rate limit') || m.includes('too many requests')) return 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.';
  if (m.includes('network') || m.includes('fetch')) return 'Bağlantı hatası. İnternetini kontrol et.';
  return message ?? 'Bir sorun oluştu. Lütfen tekrar dene.';
}

// FIX (audit UX-ONB-05): tek bir paylaşılan 18+ doğum yılı doğrulayıcısı. register.tsx ve
// onboarding.tsx aynı 18+ politikası için FARKLI alt sınırlar kullanıyordu (register <1920,
// onboarding <=1900 → 1901 kabul). Bu yardımcı tek kural: min 1920, max currentYear, yaş>=18.
// Dönen 'error' Türkçe ve null ise yıl geçerli. NOT: onboarding.tsx aynı mantığı kendi içinde
// kopyalar (sahip olunan dosyalar arası paylaşılan modül oluşturulamadığı için).
const MIN_BIRTH_YEAR = 1920;
function validateBirthYear(raw: string): { year: number | null; error: string | null } {
  const year = parseInt(raw, 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < MIN_BIRTH_YEAR || year > currentYear) {
    return { year: null, error: 'Geçerli doğum yılı gir.' };
  }
  if (currentYear - year < 18) {
    return { year: null, error: 'Bu uygulama 18 yaş ve üzeri içindir.' };
  }
  return { year, error: null };
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const { signUp, signInWithGoogle, signInWithApple, loading } = useAuthStore();

  // Inline confirm-password feedback so mismatches surface as you type, not after submit.
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const openLink = (url: string) => {
    haptics.tap();
    Linking.openURL(url).catch(() => Alert.alert('Hata', 'Bağlantı açılamadı.'));
  };

  const handleRegister = async () => {
    if (!email.trim() || !password.trim()) { haptics.error(); Alert.alert('Hata', 'Tüm alanları doldurun.'); return; }
    // FIX (audit UX-FRM-04): istemci-tarafı e-posta format kontrolü — bozuk e-posta
    // sunucuya gitmeden Türkçe hata göster.
    if (!isValidEmail(email.trim())) { haptics.error(); Alert.alert('Hata', 'Geçerli bir e-posta gir.'); return; }
    if (password !== confirmPassword) { haptics.error(); Alert.alert('Hata', 'Şifreler eşleşmiyor.'); return; }
    if (password.length < 6) { haptics.error(); Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.'); return; }
    // FIX (audit UX-ONB-05): paylaşılan doğum yılı doğrulayıcısı (min 1920, yaş>=18) —
    // onboarding.tsx ile aynı kural; eski lokal <1920/yaş kontrolünün yerine geçer.
    const { year, error: birthYearError } = validateBirthYear(birthYear);
    if (birthYearError !== null || year === null) {
      haptics.error();
      Alert.alert('Hata', birthYearError ?? 'Geçerli doğum yılı gir.');
      return;
    }

    const { error, needsConfirmation } = await signUp(email.trim(), password, year);
    if (error) { haptics.error(); Alert.alert('Hata', localizeAuthError(error)); return; } // FIX (audit UX-FRM-04)
    haptics.success();
    if (needsConfirmation) {
      // Email confirmation is on → no session yet, user must verify first.
      Alert.alert('E-posta Doğrulaması', 'Hesabın oluşturuldu. Lütfen e-posta adresine gönderilen doğrulama linkine tıkla.', [
        { text: 'Tamam', onPress: () => router.replace('/(auth)/login') },
      ]);
    } else {
      // Session is already active → drop the user straight into the app.
      router.replace('/');
    }
  };

  const handleGoogle = async () => {
    const { error, cancelled } = await signInWithGoogle();
    if (cancelled) return;
    if (error) { haptics.error(); Alert.alert('Hata', localizeAuthError(error)); } // FIX (audit UX-FRM-04)
    else { haptics.success(); router.replace('/'); }
  };

  const handleApple = async () => {
    const { error, cancelled } = await signInWithApple();
    if (cancelled) return;
    if (error) { haptics.error(); Alert.alert('Hata', localizeAuthError(error)); } // FIX (audit UX-FRM-04)
    else { haptics.success(); router.replace('/'); }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      // FIX (audit UI-CHT-01 kalıbı): her iki platformda da 'padding'. Expo SDK 55'in zorunlu
      // edge-to-edge'i altında Android 'height' pencereyi yanlış ölçüyor ve form alanlarını/
      // butonu klavyenin altında bırakabiliyordu (bkz. app/chat/[sessionId].tsx'teki fix notu).
      // İçerik ScrollView'da: 'padding' ile "Kayıt Ol" butonu kaydırılarak erişilebilir kalır.
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: SPACING.lg,
          paddingTop: SPACING.lg + insets.top,
          paddingBottom: SPACING.lg + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* FIX (audit ui-auth-header): login.tsx ile birebir aynı logo/başlık bloğu (letterSpacing/boşluk) */}
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Hesap Oluştur</Text>
        </View>

        {/* KVKK / consent — sits above all signup paths (form + social) so it's visible before any commitment. */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', lineHeight: 19, marginBottom: SPACING.xl }}>
          Kayıt olarak{' '}
          <Text
            style={{ color: COLORS.primary, fontWeight: '600' }}
            onPress={() => openLink(TERMS_URL)}
            accessibilityRole="link"
            accessibilityLabel="Kullanım Koşulları'nı aç"
          >
            Kullanım Koşulları
          </Text>
          {"'nı ve "}
          <Text
            style={{ color: COLORS.primary, fontWeight: '600' }}
            onPress={() => openLink(PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Gizlilik Politikası'nı aç"
          >
            Gizlilik Politikası
          </Text>
          {"'nı kabul edersin."}
        </Text>

        {/* Social Register Buttons (Spec 1.1) — Google, provider yapılandırılana dek gizli. */}
        {GOOGLE_LOGIN_ENABLED && (
          <>
            <Button title="Google ile Kayıt Ol" onPress={handleGoogle} loading={loading} variant="outline" size="lg" />
            <View style={{ height: SPACING.sm }} />
          </>
        )}
        {Platform.OS === 'ios' && (
          <>
            <Button title="Apple ile Kayıt Ol" onPress={handleApple} loading={loading} variant="outline" size="lg" />
            <View style={{ height: SPACING.sm }} />
          </>
        )}

        {/* Divider */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.md }}>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginHorizontal: SPACING.md }}>veya</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
        </View>

        <Input
          label="E-posta"
          placeholder="ornek@email.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          blurOnSubmit={false}
        />
        <Input
          label="Doğum Yılı"
          placeholder="1990"
          value={birthYear}
          onChangeText={setBirthYear}
          keyboardType="numeric"
          returnKeyType="next"
          blurOnSubmit={false}
        />
        <Input
          label="Şifre"
          placeholder="En az 6 karakter"
          value={password}
          onChangeText={setPassword}
          secureToggle
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          blurOnSubmit={false}
        />
        <Input
          label="Şifre Tekrar"
          placeholder="Tekrar gir"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureToggle
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleRegister}
          error={passwordsMismatch ? 'Şifreler eşleşmiyor' : undefined}
          hint={passwordsMatch ? 'Şifreler eşleşiyor' : undefined}
        />
        <Button title="Kayıt Ol" onPress={handleRegister} loading={loading} size="lg" />
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Zaten hesabın var mı? </Text>
          <Link href="/(auth)/login" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Giriş Yap</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
