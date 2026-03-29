/**
 * Change Email Screen — Spec 1.4
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ChangeEmailScreen() {
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) {
      Alert.alert('Hata', 'Gecerli bir e-posta gir.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setLoading(false);

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      Alert.alert('Basarili', 'Yeni e-posta adresine dogrulama linki gonderildi. Onayladiktan sonra degisiklik aktif olacak.',
        [{ text: 'Tamam', onPress: () => router.back() }]);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.lg, justifyContent: 'center', flexGrow: 1 }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>E-posta Degistir</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xl }}>
        Yeni e-posta adresine dogrulama linki gonderilir. Onaylayana kadar eski e-posta gecerli kalir.
      </Text>
      <Input label="Yeni E-posta" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" placeholder="yeni@email.com" />
      <Button title="Degistir" onPress={handleChange} loading={loading} style={{ marginTop: SPACING.md }} />
    </ScrollView>
  );
}
