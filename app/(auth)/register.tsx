import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const { signUp, signInWithGoogle, signInWithApple, loading } = useAuthStore();

  const handleRegister = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'Tüm alanları doldurun.'); return; }
    if (password !== confirmPassword) { Alert.alert('Hata', 'Şifreler eşleşmiyor.'); return; }
    if (password.length < 6) { Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.'); return; }
    const year = parseInt(birthYear);
    const currentYear = new Date().getFullYear();
    if (!year || year < 1920 || year > currentYear) { Alert.alert('Hata', 'Geçerli doğum yılı girin.'); return; }
    if (currentYear - year < 18) { Alert.alert('Yaş Sınırı', 'Bu uygulama 18 yaş ve üzeri içindir.'); return; }

    const { error } = await signUp(email.trim(), password, year);
    if (error) Alert.alert('Hata', error);
    else Alert.alert('E-posta Doğrulaması', 'Hesabın oluşturuldu. Lütfen e-posta adresine gönderilen doğrulama linkine tıkla.', [
      { text: 'Tamam', onPress: () => router.replace('/(auth)/login') },
    ]);
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary }}>Hesap Oluştur</Text>
        </View>

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

        <Input label="E-posta" placeholder="ornek@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Input label="Doğum Yılı" placeholder="1990" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" />
        <Input label="Şifre" placeholder="En az 6 karakter" value={password} onChangeText={setPassword} secureTextEntry />
        <Input label="Şifre Tekrar" placeholder="Tekrar girin" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        <Button title="Kayıt Ol" onPress={handleRegister} loading={loading} size="lg" />
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Zaten hesabın var mı? </Text>
          <Link href="/(auth)/login" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Giriş Yap</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
