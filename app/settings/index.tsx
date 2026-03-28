import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { exportJSON, exportCSV } from '@/services/export.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function SettingsScreen() {
  const { user, signOut } = useAuthStore();
  const profile = useProfileStore(s => s.profile);

  const handleDelete = () => {
    Alert.alert(
      'Hesabi Sil',
      'Bu islem geri alinamaz. Tum verileriniz 30 gun sonra kalici silinir. (Spec 1.4)',
      [
        { text: 'Iptal', style: 'cancel' },
        { text: 'Hesabimi Sil', style: 'destructive', onPress: async () => {
          if (user?.id) {
            await supabase.from('profiles').delete().eq('id', user.id);
            await signOut();
          }
        }},
      ]
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Ayarlar</Text>

      {/* Premium */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600' }}>
            {profile?.premium ? 'Premium Aktif' : 'Ucretsiz Plan'}
          </Text>
          {!profile?.premium && <Button title="Premium" size="sm" onPress={() => router.push('/settings/premium')} />}
        </View>
      </Card>

      {/* Profile & Goals */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Profil ve Hedefler</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Hedef Ayarlari" variant="outline" onPress={() => router.push('/settings/goals')} />
        <Button title="Yemek Tercihleri" variant="outline" onPress={() => router.push('/settings/food-preferences')} />
        <Button title="Favori Ogunler" variant="outline" onPress={() => router.push('/settings/meal-templates')} />
        <Button title="Saglik Gecmisi" variant="outline" onPress={() => router.push('/settings/health-events')} />
        <Button title="Lab Degerleri" variant="outline" onPress={() => router.push('/settings/lab-values')} />
        <Button title="Supplement Takibi" variant="outline" onPress={() => router.push('/settings/supplements')} />
        <Button title="Mekanlar" variant="outline" onPress={() => router.push('/settings/venues')} />
      </View>

      {/* Tracking & Progress */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Takip ve Ilerleme</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Guc Progresyon" variant="outline" onPress={() => router.push('/settings/strength')} />
        <Button title="Challenge'lar" variant="outline" onPress={() => router.push('/settings/challenges')} />
        <Button title="Basarimlar" variant="outline" onPress={() => router.push('/settings/achievements')} />
        <Button title="Tarif Kutuphanesi" variant="outline" onPress={() => router.push('/settings/recipes')} />
        <Button title="Haftalik Menu" variant="outline" onPress={() => router.push('/settings/weekly-menu')} />
      </View>

      {/* Preferences */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Tercihler</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Koc Tonu" variant="outline" onPress={() => router.push('/settings/coach-tone')} />
        <Button title="Bildirimler" variant="outline" onPress={() => router.push('/settings/notifications')} />
        <Button title="Donemsel Durum" variant="outline" onPress={() => router.push('/settings/periodic-state')} />
        <Button title="Premium" variant="outline" onPress={() => router.push('/settings/premium')} />
      </View>

      {/* Data */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Veri</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="JSON Export" variant="outline" onPress={exportJSON} />
        <Button title="CSV Export" variant="outline" onPress={exportCSV} />
        <Button title="Saglik Profesyoneli Raporu" variant="outline" onPress={() => router.push('/settings/health-export')} />
        <Button title="Veri Iceri Aktar" variant="outline" onPress={() => router.push('/settings/data-import')} />
        <Button title="Sohbet Gecmisi" variant="outline" onPress={() => router.push('/settings/chat-history')} />
      </View>

      {/* Privacy */}
      <Card title="Gizlilik ve Guvenlik" style={{ marginTop: SPACING.lg }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          Verileriniz sifrelenerek saklanir. Tum verilerinizi export alabilir veya hesabinizi silebilirsiniz. AI'in hakkınızda bildiklerini Profil {'>'} "Kocun Seni Nasil Taniyor" bolumunden gorebilir, duzeltebilir veya silebilirsiniz.
        </Text>
      </Card>

      {/* Danger */}
      <View style={{ marginTop: SPACING.xl, gap: SPACING.sm }}>
        <Button title="Cikis Yap" variant="ghost" onPress={() => Alert.alert('Cikis', 'Emin misin?', [{ text: 'Iptal' }, { text: 'Cikis', style: 'destructive', onPress: signOut }])} />
        <Button title="Hesabimi Sil" variant="ghost" onPress={handleDelete} />
      </View>

      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xxl }}>Kochko v1.0.0</Text>
    </ScrollView>
  );
}
