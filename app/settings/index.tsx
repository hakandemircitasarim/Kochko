import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function SettingsScreen() {
  const { user, signOut } = useAuthStore();
  const profile = useProfileStore((s) => s.profile);

  const handleDeleteAccount = () => {
    Alert.alert(
      'Hesabı Sil',
      'Bu işlem geri alınamaz. Tüm verileriniz kalıcı olarak silinecek.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Hesabımı Sil',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            // Delete profile (cascades to all user data)
            await supabase.from('profiles').delete().eq('id', user.id);
            await signOut();
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Ayarlar</Text>

      {/* Premium Status */}
      <Card>
        <View style={styles.premiumRow}>
          <Text style={styles.premiumLabel}>
            {profile?.premium ? 'Premium Aktif' : 'Ücretsiz Plan'}
          </Text>
          {!profile?.premium && (
            <Button
              title="Premium'a Geç"
              size="sm"
              onPress={() => router.push('/settings/premium')}
            />
          )}
        </View>
      </Card>

      {/* Navigation */}
      <View style={styles.menuSection}>
        <Button title="Profil Düzenle" variant="outline" onPress={() => router.push('/onboarding/quick-start')} />
        <Button title="Hedef Ayarları" variant="outline" onPress={() => router.push('/settings/goals')} />
        <Button title="Yemek Tercihleri" variant="outline" onPress={() => router.push('/settings/food-preferences')} />
        <Button title="Lab Değerleri" variant="outline" onPress={() => router.push('/settings/lab-values')} />
        <Button title="Veri Dışa Aktar" variant="outline" onPress={() => router.push('/settings/export')} />
      </View>

      {/* Privacy & Danger Zone */}
      <Card title="Gizlilik ve Güvenlik" style={{ marginTop: SPACING.lg }}>
        <Text style={styles.privacyText}>
          Verileriniz şifreli olarak saklanır. Yalnızca siz erişebilirsiniz.
          İstediğiniz zaman tüm verilerinizi dışa aktarabilir veya hesabınızı silebilirsiniz.
        </Text>
      </Card>

      <View style={styles.dangerZone}>
        <Button title="Çıkış Yap" variant="ghost" onPress={signOut} />
        <Button
          title="Hesabımı Sil"
          variant="ghost"
          onPress={handleDeleteAccount}
          style={{ marginTop: SPACING.sm }}
        />
      </View>

      <Text style={styles.version}>Kochko v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  premiumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  premiumLabel: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '600' },
  menuSection: { gap: SPACING.sm, marginTop: SPACING.md },
  privacyText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, lineHeight: 20 },
  dangerZone: { marginTop: SPACING.xl },
  version: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, textAlign: 'center', marginTop: SPACING.xxl },
});
