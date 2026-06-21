import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, TouchableOpacity, Linking } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

// Hosted legal documents (KVKK aydınlatma / kullanım koşulları) — same as register.tsx.
const TERMS_URL = 'https://kochko.app/kullanim-kosullari';
const PRIVACY_URL = 'https://kochko.app/gizlilik';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, signInWithGoogle, signInWithApple, resetPassword, loading } = useAuthStore();

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Hata', 'Bağlantı açılamadı.'));
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'E-posta ve şifre gerekli.'); return; }
    const { error } = await signIn(email.trim(), password);
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleGoogle = async () => {
    const { error, cancelled } = await signInWithGoogle();
    if (cancelled) return;
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleApple = async () => {
    const { error, cancelled } = await signInWithApple();
    if (cancelled) return;
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      Alert.alert('E-posta Gerekli', 'Şifre sıfırlama linki için e-posta adresini gir.');
      return;
    }
    Alert.alert('Şifre Sıfırlama', `${email.trim()} adresine sıfırlama linki gönderilsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Gönder', onPress: async () => {
        const { error } = await resetPassword(email.trim());
        if (error) Alert.alert('Hata', error);
        else Alert.alert('Başarılı', 'Şifre sıfırlama linki e-posta adresinize gönderildi. Link 1 saat geçerlidir.');
      }},
    ]);
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
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Yaşam tarzı koçun</Text>
        </View>

        {/* FIX (audit UX-ONB-01/HIGH): social sign-in CREATES an account on first use, so the
            KVKK/Terms consent must be shown here too (not only on the register screen) — it sits
            above the social buttons so it's visible before any account is created. */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', lineHeight: 19, marginBottom: SPACING.lg }}>
          Devam ederek{' '}
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
          {"'nı kabul etmiş olursun."}
        </Text>

        {/* Social Login Buttons (Spec 1.1) */}
        <Button title="Google ile Giriş Yap" onPress={handleGoogle} loading={loading} variant="outline" size="lg" />
        <View style={{ height: SPACING.sm }} />
        {Platform.OS === 'ios' && (
          <>
            <Button title="Apple ile Giriş Yap" onPress={handleApple} loading={loading} variant="outline" size="lg" />
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
          placeholder="ornek@kochko.app"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          autoComplete="email"
          returnKeyType="next"
        />
        <Input
          label="Şifre"
          placeholder="Şifreniz"
          value={password}
          onChangeText={setPassword}
          secureToggle
          textContentType="password"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        {/* Forgot Password (Spec 1.2) */}
        {/* FIX (audit a11y): min 44dp dokunma hedefi + erişilebilirlik etiketi */}
        <TouchableOpacity
          onPress={handleForgotPassword}
          style={{ alignSelf: 'flex-end', marginBottom: SPACING.md, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Şifremi unuttum"
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>Şifremi Unuttum</Text>
        </TouchableOpacity>

        <Button title="Giriş Yap" onPress={handleLogin} loading={loading} size="lg" />
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Hesabın yok mu? </Text>
          <Link href="/(auth)/register" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Kayıt Ol</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
