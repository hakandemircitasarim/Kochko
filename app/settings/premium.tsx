import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { initiatePurchase, restorePurchases } from '@/services/subscription.service';
import { supabase } from '@/lib/supabase';

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
  const insets = useSafeAreaInsets();
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

  const handleBuy = () => {
    Alert.alert(
      'Gelistirici Modu',
      'Uygulama icin satin alma (IAP) henuz baglantili degil. Gercek odeme altyapisi App Store / Google Play entegrasyonu ile aktif olacaktir. Simdilik test icin "Abone Ol" butonunu kullanabilirsiniz.',
      [{ text: 'Tamam' }]
    );
  };

  const handleRestorePurchases = async () => {
    const result = await restorePurchases();
    if (result.ok) {
      Alert.alert('Basarili', 'Satin alimlariniz yuklendi.', [{ text: 'Tamam', onPress: () => router.back() }]);
      return;
    }
    // Native SDK wired değil → dev fallback
    Alert.alert(
      'Satin Alimlari Geri Yukle',
      'Uygulama ici satin alma altyapisi henuz aktif edilmedi. Gelistiriciyle iletisime gecin.',
      [{ text: 'Tamam' }]
    );
  };

  const activatePremium = async (months: number) => {
    if (!user?.id) return;

    // Native IAP first (Spec 19.0). Stubbed → dev fallback writes subscription row directly.
    const productId = months === 1 ? 'monthly' : 'yearly';
    const result = await initiatePurchase(productId);
    if (result.ok) {
      Alert.alert('Tebrikler!', 'Premium aktif.', [{ text: 'Tamam', onPress: () => router.back() }]);
      return;
    }

    // DEV fallback — write directly to subscriptions table; trigger syncs profile.premium
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);
    try {
      await supabase.from('subscriptions').insert({
        user_id: user.id,
        tier: months >= 12 ? 'yearly' : 'monthly',
        status: 'active',
        provider: 'manual',
        product_id: productId,
        started_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      });
    } catch { /* non-critical */ }
    await update(user.id, {
      premium: true,
      premium_expires_at: expiresAt.toISOString(),
      trial_used: true,
    } as never);

    Alert.alert('Tebrikler!', `Premium ${months} ay aktif (dev).`, [
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
        {/* Trial expiry countdown banner */}
        <View style={{ backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>
            Deneme sureniz {trialDaysLeft} gun sonra bitiyor
          </Text>
        </View>

        <Card>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Deneme Suresi</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>
            {trialDaysLeft} gun kaldi. Tum Premium ozellikler acik.
          </Text>
        </Card>

        {/* Feature comparison */}
        <View style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', marginBottom: SPACING.sm }}>Ucretsiz vs Premium</Text>
          <Card title="Ucretsiz">
            {FREE.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
          </Card>
          <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
            {PREMIUM.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} />)}
          </Card>
        </View>

        <View style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.lg }}>
            Deneme bitmeden abone olarak kesintisiz devam et.
          </Text>
          <Button title="Satin Al" onPress={handleBuy} size="lg" />
          <View style={{ marginTop: SPACING.sm }}>
            <Button title="Simdi Abone Ol (Test)" onPress={handleSubscribe} size="lg" variant="ghost" />
          </View>
          <View style={{ marginTop: SPACING.sm }}>
            <Button title="Satin Alimlari Geri Yukle" variant="ghost" onPress={handleRestorePurchases} />
          </View>
        </View>
      </ScrollView>
    );
  }

  // Expired or never subscribed
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
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

      <Button title="Satin Al" onPress={handleBuy} size="lg" />
      <View style={{ marginTop: SPACING.sm }}>
        <Button title="Premium'u Baslat (Test)" onPress={handleSubscribe} size="lg" variant="ghost" />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
        7 gun ucretsiz deneme. Istedigin zaman iptal et.
      </Text>
      <View style={{ marginTop: SPACING.md }}>
        <Button title="Satin Alimlari Geri Yukle" variant="ghost" onPress={handleRestorePurchases} />
      </View>
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
