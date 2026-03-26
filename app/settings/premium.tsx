import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

const FREE_FEATURES = [
  'Günlük kayıt (öğün, spor, tartı, su)',
  'Basit grafikler',
  'Temel hedef takibi',
];

const PREMIUM_FEATURES = [
  'AI destekli günlük plan üretimi',
  'Kişiselleştirilmiş öğün önerileri',
  'Kişiselleştirilmiş antrenman planı',
  'Gün sonu performans raporu',
  'Haftalık koç raporu ve plan revizyonu',
  'Mikro koçluk mesajları',
  'Lab değerleri modülü',
  'Gelişmiş grafikler ve trendler',
  'Veri dışa aktarma (JSON/CSV)',
  'Öncelikli destek',
];

/**
 * Premium paywall screen.
 * In production, this would integrate with RevenueCat or
 * expo-in-app-purchases for App Store / Play Store subscriptions.
 *
 * For MVP, we show the features and a placeholder purchase flow.
 */
export default function PremiumScreen() {
  const user = useAuthStore((s) => s.user);
  const { profile, updateProfile } = useProfileStore();

  const handleSubscribe = async () => {
    // TODO: Replace with actual IAP integration
    // - iOS: StoreKit via expo-in-app-purchases or RevenueCat
    // - Android: Google Play Billing via same

    Alert.alert(
      'Premium',
      'Uygulama mağazası entegrasyonu production\'da aktif olacak. Şimdilik premium aktif ediliyor.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Aktif Et',
          onPress: async () => {
            if (!user?.id) return;
            await updateProfile(user.id, { premium: true });
            Alert.alert('Tebrikler!', 'Premium hesabınız aktif edildi.', [
              { text: 'Tamam', onPress: () => router.back() },
            ]);
          },
        },
      ]
    );
  };

  if (profile?.premium) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Premium</Text>
          <Card>
            <Text style={styles.activeText}>Premium hesabınız aktif!</Text>
            <Text style={styles.activeDesc}>
              Tüm özelliklere erişiminiz var.
            </Text>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Premium'a Geç</Text>
      <Text style={styles.subtitle}>
        Yaşam tarzı koçunun tam gücünü aç.
      </Text>

      {/* Free */}
      <Card title="Ücretsiz">
        {FREE_FEATURES.map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <Text style={styles.featureCheck}>+</Text>
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </Card>

      {/* Premium */}
      <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
        {PREMIUM_FEATURES.map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <Text style={[styles.featureCheck, { color: COLORS.primary }]}>+</Text>
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </Card>

      {/* Pricing */}
      <Card>
        <View style={styles.priceContainer}>
          <Text style={styles.priceAmount}>$9.99</Text>
          <Text style={styles.pricePeriod}>/ay</Text>
        </View>
        <Text style={styles.priceNote}>
          7 gün ücretsiz deneme. İstediğin zaman iptal et.
        </Text>
      </Card>

      <Button
        title="Premium'u Başlat"
        onPress={handleSubscribe}
        size="lg"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg },
  activeText: { color: COLORS.success, fontSize: FONT_SIZE.xl, fontWeight: '700' },
  activeDesc: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md, marginTop: SPACING.xs },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3 },
  featureCheck: { color: COLORS.success, fontSize: FONT_SIZE.md, fontWeight: '700', width: 20 },
  featureText: { color: COLORS.text, fontSize: FONT_SIZE.sm, flex: 1 },
  priceContainer: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  priceAmount: { color: COLORS.primary, fontSize: FONT_SIZE.hero, fontWeight: '800' },
  pricePeriod: { color: COLORS.textSecondary, fontSize: FONT_SIZE.lg },
  priceNote: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, textAlign: 'center', marginTop: SPACING.xs },
});
