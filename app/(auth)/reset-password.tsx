/**
 * Password Reset Screen — Spec 1.2
 * User enters email, receives reset link (1 hour valid).
 */
import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ResetPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Hata', 'Gecerli bir e-posta gir.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', padding: SPACING.lg }}>
        <Text style={{ color: COLORS.success, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center', marginBottom: SPACING.md }}>
          Link gonderildi!
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', lineHeight: 24, marginBottom: SPACING.xl }}>
          {email} adresine sifre sifirlama linki gonderdik. Link 1 saat gecerlidir.
        </Text>
        <Button title="Giris Ekranina Don" variant="outline" onPress={() => router.replace('/(auth)/login')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', padding: SPACING.lg }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>Sifreni Sifirla</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginBottom: SPACING.xl }}>
        E-posta adresini gir, sifirlama linki gonderelim.
      </Text>

      <Input label="E-posta" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="ornek@email.com" />

      <Button title="Sifirlama Linki Gonder" onPress={handleReset} loading={loading} style={{ marginTop: SPACING.md }} />
      <Button title="Geri" variant="ghost" onPress={() => router.back()} style={{ marginTop: SPACING.sm }} />
    </View>
  );
}
