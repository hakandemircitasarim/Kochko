import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const FREE = [
  'Kayit girisi (ogun, spor, su, tarti)',
  'Barkod okuma',
  'Basit grafikler',
  'Temel hedef takibi',
  'Telefon adim sayaci',
  'Gunluk 5 AI mesaj hakki',
];

const PREMIUM = [
  'Sinirsiz AI sohbet',
  'Kisisellestirilmis gunluk plan',
  'Haftalik/aylik revizyon',
  'Gun sonu raporu',
  'Haftalik koc raporu',
  'Fotograf / sesli giris',
  'Lab modulu',
  'Gelismis raporlar ve export',
  'Alisveris listesi',
  'Haftalik menu',
  'Meal prep plani',
  'Tarif kutuphanesi',
  'Proaktif bildirimler',
  'Donemsel ayarlama',
  'Guc progresyon takibi',
  'Challenge modulu',
  'Bakim modu',
  'Prediktif analitik',
  'Simulasyon modu',
  'Haftalik kalori butcesi',
  'Porsiyon kalibrasyonu',
  'Cok fazli hedefler',
];

export default function PremiumScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();

  const handleSubscribe = () => {
    // TODO: RevenueCat / App Store IAP integration
    Alert.alert('Premium', 'Uygulama magazasi entegrasyonu production\'da aktif olacak.', [
      { text: 'Iptal' },
      { text: 'Simdilik Aktif Et', onPress: async () => {
        if (user?.id) {
          await update(user.id, { premium: true } as never);
          Alert.alert('Tebrikler!', 'Premium aktif.', [{ text: 'Tamam', onPress: () => router.back() }]);
        }
      }},
    ]);
  };

  if (profile?.premium) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg, justifyContent: 'center' }}>
        <Card>
          <Text style={{ color: COLORS.success, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Premium Aktif</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>Tum ozelliklere erisin var.</Text>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Premium'a Gec</Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Yasam tarzi kocunun tam gucunu ac.</Text>

      <Card title="Ucretsiz">
        {FREE.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
      </Card>

      <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
        {PREMIUM.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} />)}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.hero, fontWeight: '800' }}>$9.99</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.lg }}>/ay</Text>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xs }}>7 gun ucretsiz deneme. Istedigin zaman iptal et.</Text>
      </Card>

      <Button title="Premium'u Baslat" onPress={handleSubscribe} size="lg" />
    </ScrollView>
  );
}

function FeatureRow({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: FONT.md, fontWeight: '700', width: 20 }}>+</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>{text}</Text>
    </View>
  );
}
