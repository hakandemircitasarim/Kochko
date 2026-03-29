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
  const { signIn, loading } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'E-posta ve sifre gerekli.'); return; }
    const { error } = await signIn(email.trim(), password);
    if (error) Alert.alert('Hata', error);
    else router.replace('/');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: SPACING.xxl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Yasam Tarzi Kocun</Text>
        </View>
        <Input label="E-posta" placeholder="ornek@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Input label="Sifre" placeholder="Sifreniz" value={password} onChangeText={setPassword} secureTextEntry />
        <Button title="Giris Yap" onPress={handleLogin} loading={loading} size="lg" />

        {/* OAuth — Spec 1.1 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.md }}>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, paddingHorizontal: SPACING.md }}>veya</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
        </View>
        <Button title="Google ile Giris" variant="outline" onPress={async () => {
          const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
          if (error) Alert.alert('Hata', error.message);
        }} />
        <Button title="Apple ile Giris" variant="outline" onPress={async () => {
          const { error } = await supabase.auth.signInWithOAuth({ provider: 'apple' });
          if (error) Alert.alert('Hata', error.message);
        }} style={{ marginTop: SPACING.xs }} />

        <Button title="Sifremi Unuttum" variant="ghost" onPress={() => router.push('/(auth)/reset-password')} style={{ marginTop: SPACING.sm }} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Hesabin yok mu? </Text>
          <Link href="/(auth)/register" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Kayit Ol</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
