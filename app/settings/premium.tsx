/**
 * Premium Subscription Screen
 * Spec 16.1-16.5: Üyelik ve premium sistem
 *
 * Free plan: basic logging, 5 AI messages/day, barcode, basic charts
 * Premium: unlimited AI, plans, reports, advanced features
 * Trial: 7 days free, no credit card required
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const FREE_FEATURES = [
  'Kayit girisi (ogun, spor, su, tarti)',
  'Barkod okuma',
  'Basit grafikler ve hedef takibi',
  'Telefon adim sayaci',
  'Gunluk 5 AI mesaj hakki (kayit parse haric)',
];

const PREMIUM_FEATURES = [
  'Sinirsiz AI kocluk sohbeti',
  'Kisisellestirilmis gunluk beslenme ve spor plani',
  'Haftalik ve aylik raporlar',
  'Gun sonu kapanisi',
  'Fotograf ve sesli giris',
  'Simulasyon modu ("sunu yesem?")',
  'Haftalik kalori butcesi',
  'Porsiyon kalibrasyonu',
  'Tarif kutuphanesi ve meal prep',
  'Guc progresyon takibi',
  'Challenge modulu',
  'Bakim modu (hedefe ulasinca)',
  'Prediktif sapma tahmini',
  'Proaktif kocluk bildirimleri',
  'Saglik profesyoneli rapor exportu',
  'Cok fazli hedef planlama (cut/bulk)',
];

type PlanPeriod = 'monthly' | 'yearly';

export default function PremiumScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [selectedPlan, setSelectedPlan] = useState<PlanPeriod>('yearly');
  const [loading, setLoading] = useState(false);

  const prices = {
    monthly: { display: '₺149.99', period: '/ay' },
    yearly: { display: '₺99.99', period: '/ay', total: '₺1.199/yil', savings: '%33 indirimli' },
  };

  const handleSubscribe = async () => {
    // In production: RevenueCat / App Store IAP integration
    // For development: toggle premium flag
    setLoading(true);
    Alert.alert(
      'Premium Abonelik',
      `${selectedPlan === 'yearly' ? 'Yillik' : 'Aylik'} plan baslatilacak. 7 gun ucretsiz deneme ile basla.`,
      [
        { text: 'Iptal', onPress: () => setLoading(false) },
        { text: 'Baslat', onPress: async () => {
          if (user?.id) {
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 7);
            await update(user.id, {
              premium: true,
              premium_expires_at: trialEnd.toISOString(),
            } as never);
            Alert.alert('Hosgeldin!', '7 gunluk premium denemen basladi. Tum ozelliklere erisin var.', [
              { text: 'Baslayalim', onPress: () => router.back() },
            ]);
          }
          setLoading(false);
        }},
      ],
    );
  };

  const handleCancel = () => {
    Alert.alert(
      'Premium Iptali',
      'Aboneligini iptal etmek istedigin icin uzgunuz. Donem sonuna kadar premium ozellikler devam eder.',
      [
        { text: 'Vazgec' },
        { text: 'Iptal Et', style: 'destructive', onPress: async () => {
          if (user?.id) {
            await update(user.id, { premium: false, premium_expires_at: null } as never);
            Alert.alert('Iptal edildi', 'Ucretsiz plana doneceksin. Kayitlarin ve verilerim korunur.');
          }
        }},
      ],
    );
  };

  // Premium active view
  if (profile?.premium) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.lg }}>
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: SPACING.lg }}>
            <Text style={{ color: COLORS.success, fontSize: FONT.xxl, fontWeight: '800' }}>Premium Aktif</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginTop: SPACING.xs }}>
              Tum ozelliklere erisin var.
            </Text>
            {profile.premium_expires_at && (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.sm }}>
                Gecerlilik: {new Date(profile.premium_expires_at as string).toLocaleDateString('tr-TR')}
              </Text>
            )}
          </View>
        </Card>

        <Card title="Premium Ozelliklerin">
          {PREMIUM_FEATURES.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
        </Card>

        <Button title="Abeligi Iptal Et" variant="ghost" onPress={handleCancel} style={{ marginTop: SPACING.lg }} />
      </ScrollView>
    );
  }

  // Upsell view
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Premium'a Gec</Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>
        AI kocunun tam gucunu ac. 7 gun ucretsiz dene.
      </Text>

      {/* Plan Selection */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        {(['yearly', 'monthly'] as PlanPeriod[]).map(plan => (
          <TouchableOpacity key={plan} onPress={() => setSelectedPlan(plan)} activeOpacity={0.8}
            style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md,
              borderWidth: selectedPlan === plan ? 2 : 1,
              borderColor: selectedPlan === plan ? COLORS.primary : COLORS.border,
            }}>
            <View style={{ alignItems: 'center', paddingVertical: SPACING.sm }}>
              {plan === 'yearly' && (
                <View style={{ backgroundColor: COLORS.success, borderRadius: 8, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginBottom: SPACING.xs }}>
                  <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>{prices.yearly.savings}</Text>
                </View>
              )}
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
                {plan === 'yearly' ? 'Yillik' : 'Aylik'}
              </Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '800', marginTop: SPACING.xs }}>
                {prices[plan].display}
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>{prices[plan].period}</Text>
              {plan === 'yearly' && (
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{prices.yearly.total}</Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Free Features */}
      <Card title="Ucretsiz Plan">
        {FREE_FEATURES.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
      </Card>

      {/* Premium Features */}
      <Card title="Premium Plan" style={{ borderColor: COLORS.primary, borderWidth: 1.5 }}>
        {PREMIUM_FEATURES.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} />)}
      </Card>

      {/* CTA */}
      <Button title="7 Gun Ucretsiz Dene" onPress={handleSubscribe} size="lg" loading={loading} style={{ marginTop: SPACING.md }} />
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
        Kredi karti gerekmez. Istedigin zaman iptal et.
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
