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
    if (password !== confirmPassword) { haptics.error(); Alert.alert('Hata', 'Şifreler eşleşmiyor.'); return; }
    if (password.length < 6) { haptics.error(); Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.'); return; }
    const year = parseInt(birthYear);
    const currentYear = new Date().getFullYear();
    if (!year || year < 1920 || year > currentYear) { haptics.error(); Alert.alert('Hata', 'Geçerli doğum yılı gir.'); return; }
    if (currentYear - year < 18) { haptics.error(); Alert.alert('Yaş Sınırı', 'Bu uygulama 18 yaş ve üzeri içindir.'); return; }

    const { error, needsConfirmation } = await signUp(email.trim(), password, year);
    if (error) { haptics.error(); Alert.alert('Hata', error); return; }
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
    if (error) { haptics.error(); Alert.alert('Hata', error); }
    else { haptics.success(); router.replace('/'); }
  };

  const handleApple = async () => {
    const { error, cancelled } = await signInWithApple();
    if (cancelled) return;
    if (error) { haptics.error(); Alert.alert('Hata', error); }
    else { haptics.success(); router.replace('/'); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        <View style={{ alignItems: 'center', marginBottom: SPACING.lg }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary }}>Hesap Oluştur</Text>
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

        {/* Social Register Buttons (Spec 1.1) */}
        <Button title="Google ile Kayıt Ol" onPress={handleGoogle} loading={loading} variant="outline" size="lg" />
        <View style={{ height: SPACING.sm }} />
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
