import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
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
  const { isActive, isInTrial, trialDaysLeft, isExpired } = usePremium();

  const handleSubscribe = async () => {
    // Production: RevenueCat / App Store IAP entegrasyonu
    // Simdilik: Manual premium aktivasyonu (development)
    if (!user?.id) return;

    Alert.alert(
      'Premium Abonelik',
      'Aylik ($9.99) veya yillik ($79.99, %33 indirim) secin.',
      [
        { text: 'Iptal', style: 'cancel' },
        { text: 'Aylik - $9.99', onPress: () => activatePremium(1) },
        { text: 'Yillik - $79.99', onPress: () => activatePremium(12) },
      ]
    );
  };

  const activatePremium = async (months: number) => {
    if (!user?.id) return;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    await update(user.id, {
      premium: true,
      premium_expires_at: expiresAt.toISOString(),
      trial_used: true,
    } as never);

    Alert.alert('Tebrikler!', `Premium ${months} ay aktif.`, [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  const handleCancel = () => {
    Alert.alert('Iptal', 'Premium aboneliginizi iptal etmek istiyor musunuz? Mevcut donem sonuna kadar erisim devam eder.', [
      { text: 'Vazgec', style: 'cancel' },
      { text: 'Iptal Et', style: 'destructive', onPress: async () => {
        // In production: cancel via RevenueCat/IAP
        // Premium remains until premium_expires_at
        Alert.alert('Iptal Edildi', 'Mevcut donem sonuna kadar Premium devam eder.');
      }},
    ]);
  };

  // Active Premium
  if (isActive && !isInTrial) {
    const expiresDate = (profile as Record<string, unknown>)?.premium_expires_at
      ? new Date((profile as Record<string, unknown>).premium_expires_at as string).toLocaleDateString('tr-TR')
      : null;

    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, justifyContent: 'center' }}>
        <Card>
          <Text style={{ color: COLORS.success, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Premium Aktif</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>Tum ozelliklere erisin var.</Text>
          {expiresDate && (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.sm }}>Gecerlilik: {expiresDate}</Text>
          )}
        </Card>
        <View style={{ marginTop: SPACING.lg }}>
          <Button title="Aboneligi Iptal Et" variant="ghost" onPress={handleCancel} />
        </View>
      </ScrollView>
    );
  }

  // Trial period
  if (isInTrial) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Card>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Deneme Suresi</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>
            {trialDaysLeft} gun kaldi. Tum Premium ozellikler acik.
          </Text>
        </Card>
        <View style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.lg }}>
            Deneme bitmeden abone olarak kesintisiz devam et.
          </Text>
          <Button title="Simdi Abone Ol" onPress={handleSubscribe} size="lg" />
        </View>
      </ScrollView>
    );
  }

  // Expired or never subscribed
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Premium'a Gec</Text>
      {isExpired && (
        <View style={{ backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.sm, marginTop: SPACING.sm }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, textAlign: 'center' }}>Premium sureniz doldu. Yenileyin.</Text>
        </View>
      )}
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Yasam tarzi kocunun tam gucunu ac.</Text>

      <Card title="Ucretsiz">
        {FREE.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
      </Card>

      <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
        {PREMIUM.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} />)}
      </Card>

      {/* Pricing */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <Card style={{ flex: 1 }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', textAlign: 'center' }}>Aylik</Text>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xxl, fontWeight: '800', textAlign: 'center' }}>$9.99</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center' }}>/ay</Text>
        </Card>
        <Card style={{ flex: 1, borderColor: COLORS.primary, borderWidth: 1 }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', textAlign: 'center', marginBottom: 2 }}>%33 INDIRIM</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', textAlign: 'center' }}>Yillik</Text>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xxl, fontWeight: '800', textAlign: 'center' }}>$79.99</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center' }}>$6.67/ay</Text>
        </Card>
      </View>

      <Button title="Premium'u Baslat" onPress={handleSubscribe} size="lg" />
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
        7 gun ucretsiz deneme. Istedigin zaman iptal et.
      </Text>
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
