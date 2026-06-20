/**
 * Şifre Sıfırlama ekranı — kochko://reset-password deep link hedefi (#R5-2).
 * resetPassword() e-postası bu yola yönlendirir; Supabase PASSWORD_RECOVERY
 * oturumu kurar (auth.store onAuthStateChange session'ı set eder). Kullanıcı
 * burada yeni şifresini girer; updateUser ile değiştirilir, sonra login'e döner.
 */
import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const signOut = useAuthStore((s) => s.signOut);

  const handleSave = async () => {
    if (password.length < 6) {
      Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Hata', 'Şifreler eşleşmiyor.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        // Most common cause: the recovery link expired or the session isn't a
        // recovery session — guide the user to request a fresh link.
        Alert.alert(
          'Şifre değiştirilemedi',
          'Sıfırlama bağlantısının süresi dolmuş olabilir. Lütfen giriş ekranından yeni bir bağlantı iste.',
          [{ text: 'Tamam', onPress: async () => { await signOut().catch(() => {}); router.replace('/(auth)/login'); } }],
        );
        return;
      }
      Alert.alert('Başarılı', 'Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.', [
        { text: 'Tamam', onPress: async () => { await signOut().catch(() => {}); router.replace('/(auth)/login'); } },
      ]);
    } catch {
      Alert.alert('Hata', 'Bir sorun oluştu. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.xl, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>
          Yeni Şifre Belirle
        </Text>
        <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.xl }}>
          Hesabın için yeni bir şifre gir.
        </Text>

        <Input label="Yeni Şifre" value={password} onChangeText={setPassword} secureToggle placeholder="••••••••" />
        <Input label="Yeni Şifre (Tekrar)" value={confirm} onChangeText={setConfirm} secureToggle placeholder="••••••••" />

        <Button title="Şifreyi Güncelle" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.lg }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
