/**
 * Register Screen — Spec 1.1
 * Three registration methods: Email+Password, Google, Apple.
 * Birth year verification (18+ only).
 * Email verification notice after signup.
 */
import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { validateAge } from '@/lib/guardrails-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const { signUp, loading } = useAuthStore();

  // Field-level validation errors
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string; birthYear?: string }>({});

  const validate = (): boolean => {
    const e: typeof errors = {};

    if (!email.trim()) e.email = 'E-posta gerekli.';
    else if (!email.includes('@') || !email.includes('.')) e.email = 'Gecerli bir e-posta gir.';

    const year = parseInt(birthYear);
    if (!birthYear.trim()) e.birthYear = 'Dogum yili gerekli.';
    else if (!year || year < 1920 || year > new Date().getFullYear()) e.birthYear = 'Gecerli bir yil gir (ornek: 1990).';
    else {
      const ageCheck = validateAge(year);
      if (!ageCheck.valid) e.birthYear = ageCheck.message;
    }

    if (!password) e.password = 'Sifre gerekli.';
    else if (password.length < 6) e.password = 'En az 6 karakter olmali.';
    else if (password.length < 8) e.password = 'Guvenlik icin 8+ karakter onerilir.'; // Warning, not blocking

    if (password && confirmPassword && password !== confirmPassword) e.confirm = 'Sifreler eslesmiyor.';
    else if (!confirmPassword) e.confirm = 'Sifre tekrarini gir.';

    setErrors(e);
    // Only birthYear and email errors are blocking
    return !e.email && !e.birthYear && !e.confirm && password.length >= 6;
  };

  const handleRegister = async () => {
    if (!validate()) return;

    const year = parseInt(birthYear);
    const { error } = await signUp(email.trim(), password, year);

    if (error) {
      if (error.includes('already registered') || error.includes('already exists')) {
        setErrors({ email: 'Bu e-posta zaten kayitli. Giris yapmayı dene.' });
      } else {
        Alert.alert('Hata', error);
      }
      return;
    }

    // Spec 1.1: Email verification notice
    setStep('verify');
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    // Birth year still needed for age check — collect first
    const year = parseInt(birthYear);
    if (!year) {
      setErrors({ birthYear: 'Once dogum yilini gir (18 yas kontrolu).' });
      return;
    }
    const ageCheck = validateAge(year);
    if (!ageCheck.valid) {
      setErrors({ birthYear: ageCheck.message });
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) Alert.alert('Hata', error.message);
  };

  // Verification notice screen
  if (step === 'verify') {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', padding: SPACING.lg }}>
        <View style={{ alignItems: 'center', marginBottom: SPACING.xl }}>
          <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>✉</Text>
          <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, textAlign: 'center' }}>
            E-posta Dogrulama
          </Text>
          <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24, marginTop: SPACING.sm }}>
            {email} adresine dogrulama linki gonderdik. Hesabini dogrulamadan tam kullanima gecemezsin.
          </Text>
        </View>

        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 22 }}>
            E-posta gelmedi mi?{'\n'}
            - Spam/gereksiz klasorunu kontrol et{'\n'}
            - Birkaç dakika bekle{'\n'}
            - E-posta adresinin dogru oldugundan emin ol
          </Text>
        </Card>

        <Button title="Giris Ekranina Don" onPress={() => router.replace('/(auth)/login')} style={{ marginTop: SPACING.md }} />
        <Button title="Tekrar Gonder" variant="ghost" onPress={async () => {
          const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
          if (error) Alert.alert('Hata', error.message);
          else Alert.alert('Gonderildi', 'Dogrulama linki tekrar gonderildi.');
        }} style={{ marginTop: SPACING.xs }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={{ alignItems: 'center', marginBottom: SPACING.xl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Hesap Olustur</Text>
        </View>

        {/* Birth year — asked first for age gate (Spec 1.1) */}
        <Input
          label="Dogum Yili *"
          placeholder="1990"
          value={birthYear}
          onChangeText={(v) => { setBirthYear(v); setErrors(e => ({ ...e, birthYear: undefined })); }}
          keyboardType="numeric"
          maxLength={4}
          error={errors.birthYear}
          hint="18 yas alti kullanici kayit olamaz."
        />

        <Input
          label="E-posta *"
          placeholder="ornek@email.com"
          value={email}
          onChangeText={(v) => { setEmail(v); setErrors(e => ({ ...e, email: undefined })); }}
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />

        <Input
          label="Sifre *"
          placeholder="En az 6 karakter (8+ onerilir)"
          value={password}
          onChangeText={(v) => { setPassword(v); setErrors(e => ({ ...e, password: undefined })); }}
          secureTextEntry
          error={errors.password}
        />

        <Input
          label="Sifre Tekrar *"
          placeholder="Tekrar girin"
          value={confirmPassword}
          onChangeText={(v) => { setConfirmPassword(v); setErrors(e => ({ ...e, confirm: undefined })); }}
          secureTextEntry
          error={errors.confirm}
        />

        <Button title="Kayit Ol" onPress={handleRegister} loading={loading} size="lg" />

        {/* OAuth divider */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.lg }}>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, paddingHorizontal: SPACING.md }}>veya</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
        </View>

        <Button title="Google ile Kayit" variant="outline" onPress={() => handleOAuth('google')} />
        <Button title="Apple ile Kayit" variant="outline" onPress={() => handleOAuth('apple')} style={{ marginTop: SPACING.xs }} />

        {/* Login link */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Zaten hesabin var mi? </Text>
          <Link href="/(auth)/login" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Giris Yap</Link>
        </View>

        {/* Privacy notice */}
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.lg, lineHeight: 18 }}>
          Kayit olarak Kullanim Sartlari'ni ve Gizlilik Politikasi'ni kabul etmis olursun.
          Verileriniz KVKK/GDPR uyumlu olarak saklanir.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
