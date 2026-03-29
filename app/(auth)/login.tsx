/**
 * Login Screen — Spec 1.1, 1.2
 * Email+Password, Google OAuth, Apple OAuth.
 * Password reset link, registration link.
 */
import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { signIn, loading } = useAuthStore();

  const handleLogin = async () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'E-posta gerekli.';
    else if (!email.includes('@')) e.email = 'Gecerli bir e-posta gir.';
    if (!password) e.password = 'Sifre gerekli.';
    setErrors(e);
    if (e.email || e.password) return;

    const { error } = await signIn(email.trim(), password);
    if (error) {
      setErrors({ password: error });
    } else {
      router.replace('/');
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) Alert.alert('Hata', error.message);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        {/* Brand */}
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>AI Yasam Tarzi Kocun</Text>
        </View>

        {/* Email */}
        <Input
          label="E-posta"
          placeholder="ornek@email.com"
          value={email}
          onChangeText={(v) => { setEmail(v); setErrors(prev => ({ ...prev, email: undefined })); }}
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />

        {/* Password */}
        <Input
          label="Sifre"
          placeholder="Sifreniz"
          value={password}
          onChangeText={(v) => { setPassword(v); setErrors(prev => ({ ...prev, password: undefined })); }}
          secureTextEntry
          error={errors.password}
        />

        {/* Login button */}
        <Button title="Giris Yap" onPress={handleLogin} loading={loading} size="lg" />

        {/* Password reset */}
        <Button title="Sifremi Unuttum" variant="ghost" onPress={() => router.push('/(auth)/reset-password')} style={{ marginTop: SPACING.sm }} />

        {/* OAuth divider */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.lg }}>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, paddingHorizontal: SPACING.md }}>veya</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
        </View>

        {/* OAuth buttons */}
        <Button title="Google ile Giris" variant="outline" onPress={() => handleOAuth('google')} />
        <Button title="Apple ile Giris" variant="outline" onPress={() => handleOAuth('apple')} style={{ marginTop: SPACING.xs }} />

        {/* Register link */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Hesabin yok mu? </Text>
          <Link href="/(auth)/register" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Kayit Ol</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
