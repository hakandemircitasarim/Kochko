import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { exportJSON, exportCSV } from '@/services/export.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const profile = useProfileStore(s => s.profile);

  const handleDelete = () => {
    Alert.alert(
      'Hesabı Sil',
      'Hesabın silinmek üzere işaretlenecek. 30 gün içinde tekrar giriş yaparsan hesabın otomatik olarak yeniden aktif olur. 30 gün sonra tüm verilerin kalıcı olarak silinecek.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Hesabımı Sil', style: 'destructive', onPress: async () => {
          if (user?.id) {
            // Mark for the 30-day cron grace period (Spec 1.4 + migration 023).
            // Both columns set: deletion_requested_at drives the hard-delete cron;
            // deleted_at is the legacy soft-delete flag still read elsewhere in the app.
            const now = new Date().toISOString();
            await supabase.from('profiles').update({
              deletion_requested_at: now,
              deleted_at: now,
            }).eq('id', user.id);
            await signOut();
          }
        }},
      ]
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Ayarlar</Text>

      {/* Premium */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600' }}>
            {profile?.premium ? 'Premium Aktif' : 'Ücretsiz Plan'}
          </Text>
          {!profile?.premium && <Button title="Premium" size="sm" onPress={() => router.push('/settings/premium')} />}
        </View>
      </Card>

      {/* Profile & Goals */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Profil ve Hedefler</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Hedef Ayarları" variant="outline" onPress={() => router.push('/settings/goals')} />
        <Button title="Yemek Tercihleri" variant="outline" onPress={() => router.push('/settings/food-preferences')} />
        <Button title="Favori Öğünler" variant="outline" onPress={() => router.push('/settings/meal-templates')} />
        <Button title="Sağlık Geçmişi" variant="outline" onPress={() => router.push('/settings/health-events')} />
        <Button title="Lab Değerleri" variant="outline" onPress={() => router.push('/settings/lab-values')} />
        <Button title="Supplement Takibi" variant="outline" onPress={() => router.push('/settings/supplements')} />
        <Button title="Mekanlar" variant="outline" onPress={() => router.push('/settings/venues')} />
      </View>

      {/* Tracking & Progress */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Takip ve İlerleme</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Güç Progresyon" variant="outline" onPress={() => router.push('/settings/strength')} />
        <Button title="Challenge'lar" variant="outline" onPress={() => router.push('/settings/challenges')} />
        <Button title="Başarımlar" variant="outline" onPress={() => router.push('/settings/achievements')} />
        <Button title="Tarif Kütüphanesi" variant="outline" onPress={() => router.push('/settings/recipes')} />
        <Button title="Haftalık Menü" variant="outline" onPress={() => router.push('/settings/weekly-menu')} />
        <Button title="İlerleme Fotoğrafları" variant="outline" onPress={() => router.push('/settings/progress-photos')} />
      </View>

      {/* Social */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Sosyal</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Aile Planı" variant="outline" onPress={() => router.push('/settings/household')} />
        <Button title="Koç Paylaşımı" variant="outline" onPress={() => router.push('/settings/coach-sharing')} />
      </View>

      {/* Preferences */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Tercihler</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Koç Tonu" variant="outline" onPress={() => router.push('/settings/coach-tone')} />
        <Button title="Bildirimler" variant="outline" onPress={() => router.push('/settings/notifications')} />
        <Button title="Dönemsel Durum" variant="outline" onPress={() => router.push('/settings/periodic-state')} />
        <Button title="Tema" variant="outline" onPress={() => router.push('/settings/theme')} />
        <Button title="Premium" variant="outline" onPress={() => router.push('/settings/premium')} />
      </View>

      {/* Data */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Veri</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="JSON Export" variant="outline" onPress={exportJSON} />
        <Button title="CSV Export" variant="outline" onPress={exportCSV} />
        <Button title="Sağlık Profesyoneli Raporu" variant="outline" onPress={() => router.push('/settings/health-export')} />
        <Button title="Veri İçeri Aktar" variant="outline" onPress={() => router.push('/settings/data-import')} />
        <Button title="Sohbet Geçmişi" variant="outline" onPress={() => router.push('/settings/chat-history')} />
      </View>

      {/* Privacy & Security */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Güvenlik</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Hesap Güvenliği" variant="outline" onPress={() => router.push('/settings/account-security')} />
        <Button title="Çok Fazlı Hedefler" variant="outline" onPress={() => router.push('/settings/multi-phase-goals')} />
        <Button title="IF Ayarları" variant="outline" onPress={() => router.push('/settings/if-settings')} />
        <Button title="Adet Döngüsü" variant="outline" onPress={() => router.push('/settings/menstrual')} />
        <Button title="Profil Düzenle" variant="outline" onPress={() => router.push('/settings/edit-profile')} />
      </View>

      {/* Privacy */}
      <Card title="Gizlilik ve Güvenlik" style={{ marginTop: SPACING.lg }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          Verilerin şifrelenerek saklanır. Tüm verilerini export alabilir veya hesabını silebilirsin. Kochko'nun senin hakkında bildiklerini Profil {'>'} "Kochko'nun Senin Hakkında Bildikleri" bölümünden görebilir, düzeltebilir veya silebilirsin.
        </Text>
      </Card>

      {/* Developer */}
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' }}>Geliştirici</Text>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Debug Modu" variant="outline" onPress={() => router.push('/settings/debug-mode')} />
      </View>

      {/* Danger */}
      <View style={{ marginTop: SPACING.xl, gap: SPACING.sm }}>
        <Button
          title="Çıkış Yap"
          variant="ghost"
          onPress={() =>
            Alert.alert('Çıkış', 'Emin misin?', [
              { text: 'İptal' },
              { text: 'Çıkış', style: 'destructive', onPress: signOut },
            ])
          }
        />
        <Button title="Hesabımı Sil" variant="ghost" onPress={handleDelete} />
      </View>

      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xxl }}>Kochko v1.0.0</Text>
    </ScrollView>
  );
}
