import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function SettingsScreen() {
  const { user, signOut } = useAuthStore();

  const handleDelete = () => {
    Alert.alert('Hesabi Sil', 'Bu islem geri alinamaz. Tum verileriniz 30 gun sonra kalici silinir.', [
      { text: 'Iptal', style: 'cancel' },
      { text: 'Hesabimi Sil', style: 'destructive', onPress: async () => {
        if (user?.id) {
          await supabase.from('profiles').delete().eq('id', user.id);
          await signOut();
        }
      }},
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Ayarlar</Text>
      <Card title="Gizlilik ve Guvenlik">
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>Verileriniz sifrelenerek saklanir. Istediginiz zaman export alabilir veya hesabinizi silebilirsiniz.</Text>
      </Card>
      <View style={{ gap: SPACING.sm }}>
        <Button title="Veri Disa Aktar" variant="outline" onPress={() => {}} />
        <Button title="Bildirim Ayarlari" variant="outline" onPress={() => {}} />
        <Button title="Koc Tonu Ayarlari" variant="outline" onPress={() => {}} />
        <Button title="Cikis Yap" variant="ghost" onPress={signOut} />
        <Button title="Hesabimi Sil" variant="ghost" onPress={handleDelete} style={{ marginTop: SPACING.lg }} />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xxl }}>Kochko v1.0.0</Text>
    </ScrollView>
  );
}
