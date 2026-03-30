/**
 * Account Security Settings
 * Spec 1.2-1.4: Session management, password change, account linking.
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function AccountSecurityScreen() {
  const user = useAuthStore(s => s.user);
  const { resetPassword } = useAuthStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Hata', 'Yeni sifre en az 6 karakter olmali.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert('Hata', 'Sifreler eslesmiyor.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) Alert.alert('Hata', error.message);
    else {
      Alert.alert('Basarili', 'Sifreniz degistirildi.');
      setNewPassword('');
      setConfirmNewPassword('');
    }
  };

  const handleLinkGoogle = async () => {
    const { signInWithGoogle } = useAuthStore.getState();
    const { error } = await signInWithGoogle();
    if (error) Alert.alert('Hata', error);
    else Alert.alert('Basarili', 'Google hesabi baglandi.');
  };

  const providers = user?.app_metadata?.providers as string[] ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Hesap Guvenligi</Text>

      {/* Account Info */}
      <Card title="Hesap Bilgileri">
        <View style={{ marginBottom: SPACING.sm }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>E-posta</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{user?.email ?? '-'}</Text>
        </View>
        <View>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Giris Yontemleri</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>
            {providers.length > 0 ? providers.join(', ') : 'email'}
          </Text>
        </View>
      </Card>

      {/* Password Change (Spec 1.4) */}
      <SectionHeader title="Sifre Degistir" />
      <Card>
        <Input label="Yeni Sifre" placeholder="En az 6 karakter" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Input label="Yeni Sifre Tekrar" placeholder="Tekrar girin" value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureTextEntry />
        <Button title="Sifreyi Degistir" onPress={handleChangePassword} loading={loading} />
      </Card>

      {/* Account Linking (Spec 1.4) */}
      <SectionHeader title="Hesap Baglama" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md }}>
          Baska bir giris yontemi baglayin. Birden fazla yontemle girebilirsiniz.
        </Text>
        {!providers.includes('google') && (
          <Button title="Google Hesabi Bagla" variant="outline" onPress={handleLinkGoogle} />
        )}
        {providers.includes('google') && (
          <Text style={{ color: COLORS.success, fontSize: FONT.sm }}>Google bagli</Text>
        )}
      </Card>
    </ScrollView>
  );
}
