/**
 * Change Password Screen — Spec 1.4
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ChangePasswordScreen() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (newPassword.length < 6) { Alert.alert('Hata', 'Sifre en az 6 karakter olmali.'); return; }
    if (newPassword !== confirm) { Alert.alert('Hata', 'Sifreler uyusmuyor.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      Alert.alert('Basarili', 'Sifren degistirildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.lg, justifyContent: 'center', flexGrow: 1 }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>Sifre Degistir</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xl }}>Yeni sifre en az 6 karakter olmali.</Text>
      <Input label="Yeni Sifre" value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="Yeni sifre" />
      <Input label="Sifre Tekrar" value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Tekrar gir" />
      <Button title="Degistir" onPress={handleChange} loading={loading} style={{ marginTop: SPACING.md }} />
    </ScrollView>
  );
}
