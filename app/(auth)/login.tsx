import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, TouchableOpacity } from 'react-native';
import { Link, router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, signInWithGoogle, signInWithApple, resetPassword, loading } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'E-posta ve şifre gerekli.'); return; }
    const { error } = await signIn(email.trim(), password);
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleGoogle = async () => {
    const { error } = await signInWithGoogle();
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleApple = async () => {
    const { error } = await signInWithApple();
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      Alert.alert('E-posta Gerekli', 'Şifre sıfırlama linki için e-posta adresinizi girin.');
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
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Yaşam tarzı koçun</Text>
        </View>

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

        <Input label="E-posta" placeholder="ornek@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Input label="Şifre" placeholder="Şifreniz" value={password} onChangeText={setPassword} secureTextEntry />

        {/* Forgot Password (Spec 1.2) */}
        <TouchableOpacity onPress={handleForgotPassword} style={{ alignSelf: 'flex-end', marginBottom: SPACING.md }}>
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
