import { View, Text, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { initiatePurchase, restorePurchases, startTrialIfEligible, PURCHASE_ENABLED } from '@/services/subscription.service';
import { supabase } from '@/lib/supabase';
import { haptics } from '@/lib/haptics';

import { FREE_LAUNCH } from '@/lib/premium-gate';
const FREE = [
  'Kayıt girişi (öğün, spor, su, tartı)',
  'Barkod okuma',
  'Basit grafikler',
  'Temel hedef takibi',
  'Telefon adım sayacı',
  'Günlük 50 AI mesaj hakkı',
  '1 diyet + 1 antrenman planı',
];

const PREMIUM = [
  'Sınırsız AI sohbet',
  'Kişiselleştirilmiş günlük plan',
  'Haftalık / aylık revizyon',
  'Gün sonu raporu',
  'Haftalık koç raporu',
  'Fotoğraf / sesli giriş',
  'Lab modülü',
  'Gelişmiş raporlar ve export',
  'Alışveriş listesi',
  'Haftalık menü',
  'Meal prep planı',
  'Tarif kütüphanesi',
  'Proaktif bildirimler',
  'Dönemsel ayarlama',
  'Güç progresyon takibi',
  'Challenge modülü',
  'Bakım modu',
  'Prediktif analitik',
  'Simülasyon modu',
  'Haftalık kalori bütçesi',
  'Porsiyon kalibrasyonu',
  'Çok fazlı hedefler',
];

// FIX (ux-ideas #3): loose TR match so a gated feature name ("Güç Progresyon") lights
// up its row in the PREMIUM list even when the label wording differs slightly.
const normTr = (s: string) => s.toLocaleLowerCase('tr-TR').trim();
function matchesFeature(rowText: string, feature?: string): boolean {
  if (!feature) return false;
  const a = normTr(rowText);
  const b = normTr(feature);
  return a.includes(b) || b.includes(a);
}

export default function PremiumScreen() {
  const insets = useSafeAreaInsets();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const user = useAuthStore(s => s.user);
  const { profile, update, fetch: fetchProfile } = useProfileStore();
  const { isActive, isInTrial, trialDaysLeft, isExpired } = usePremium();
  // FIX (ux-pass5): same trial_used read as usePremium.ts — while PURCHASE_ENABLED is false,
  // an expired-trial user's ONLY button ('7 gün ücretsiz dene') was guaranteed to fail with
  // the 'hakkını daha önce kullanmışsın' alert. Gate the CTA on trial eligibility so that
  // state gets an honest disabled message instead of a dead-end button.
  const trialUsed = (profile as Record<string, unknown>)?.trial_used === true;

  const handleSubscribe = async () => {
    // Production: RevenueCat / App Store IAP entegrasyonu
    // Simdilik: Manual premium aktivasyonu (development)
    if (!user?.id) return;

    haptics.tap();
    Alert.alert(
      'Premium Abonelik',
      'Aylık ($9.99) ya da yıllık ($79.99, %33 indirim) seç.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Aylık - $9.99', onPress: () => activatePremium(1) },
        { text: 'Yıllık - $79.99', onPress: () => activatePremium(12) },
      ]
    );
  };

  const handleRestorePurchases = async () => {
    const result = await restorePurchases();
    if (result.ok) {
      haptics.success();
      Alert.alert('Başarılı', 'Satın alımların yüklendi.', [{ text: 'Tamam', onPress: () => router.back() }]);
      return;
    }
    // Native SDK wired değil → kullanıcıya dürüst "yakında" mesajı
    Alert.alert(
      'Satın Alımları Geri Yükle',
      'Premium satın alma çok yakında açılacak. O zaman önceki satın alımların otomatik olarak buradan geri yüklenebilecek.',
      [{ text: 'Tamam' }]
    );
  };

  const activatePremium = async (months: number) => {
    if (!user?.id) return;

    // Native IAP (Spec 19.0). Real purchases flow through the store + RevenueCat
    // webhook (service_role). The old "dev fallback" that wrote subscriptions/
    // profiles.premium directly is now correctly blocked server-side (RLS trial-only
    // + protect_profile_entitlements trigger), so it can no longer self-grant premium
    // for free (#R4-1/#R4-12) — and faking a success alert would be a lie.
    const productId = months === 1 ? 'monthly' : 'yearly';
    const result = await initiatePurchase(productId);
    if (result.ok) {
      haptics.success();
      Alert.alert('Tebrikler!', 'Premium aktif.', [{ text: 'Tamam', onPress: () => router.back() }]);
      return;
    }

    // IAP not wired yet. Rather than a dead-end message, deliver what the copy
    // promises: actually start the real 7-day trial via subscription.service
    // (only for users who haven't used it / aren't already active — the service
    // is idempotent and returns a reason otherwise).
    Alert.alert(
      'Satın alma yakında',
      'Premium satın alma App Store / Google Play üzerinden çok yakında aktif olacak. Şimdilik 7 günlük ücretsiz deneme ile tüm özellikleri kullanabilirsin.',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Ücretsiz denemeyi başlat', onPress: () => startFreeTrial() },
      ],
    );
  };

  const startFreeTrial = async () => {
    if (!user?.id) return;
    const result = await startTrialIfEligible(user.id);
    if (result.started) {
      await fetchProfile(user.id);
      haptics.success();
      Alert.alert('Deneme başladı', '7 günlük ücretsiz denemen aktif. Tüm Premium özellikler açık.', [
        { text: 'Tamam' },
      ]);
      return;
    }
    haptics.error();
    Alert.alert(
      'Deneme başlatılamadı',
      result.reason === 'trial_already_used'
        ? 'Ücretsiz deneme hakkını daha önce kullanmışsın.'
        : result.reason === 'already_active'
          ? 'Zaten aktif bir aboneliğin var.'
          : 'Deneme başlatılamadı. Lütfen daha sonra tekrar dene.',
      [{ text: 'Tamam' }],
    );
  };

  const handleCancel = () => {
    Alert.alert('Aboneliği İptal Et', 'Premium aboneliğini iptal etmek istiyor musun? Mevcut dönem sonuna kadar erişimin devam eder.', [
      { text: 'İptal', style: 'cancel' },
      { text: 'İptal Et', style: 'destructive', onPress: async () => {
        // In production: cancel via RevenueCat/IAP
        // Premium remains until premium_expires_at
        haptics.warning();
        Alert.alert('İptal Edildi', 'Mevcut dönem sonuna kadar Premium devam eder.');
      }},
    ]);
  };

  // FREE LAUNCH: this whole screen is paywall UI. Entry points are hidden, but deep links /
  // old scheduled notifications can still land here — show the honest launch card instead of
  // a fake "Premium Aktif" status.
  if (FREE_LAUNCH) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom, justifyContent: 'center' }}>
        <Card>
          <Text style={{ color: COLORS.success, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Lansman dönemi — her şey ücretsiz</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.sm }}>
            KOCHKO'nun tüm özellikleri şu an herkese açık. Ücretli abonelik ileride açıldığında uygulama içinden duyurulacak.
          </Text>
          <Button title="Devam et" onPress={() => router.back()} style={{ marginTop: SPACING.lg }} />
        </Card>
      </ScrollView>
    );
  }

  // Active Premium
  if (isActive && !isInTrial) {
    const expiresDate = (profile as Record<string, unknown>)?.premium_expires_at
      ? new Date((profile as Record<string, unknown>).premium_expires_at as string).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

    // FIX (audit UI-SET-03): native Stack header already owns the top safe-area inset; the old
    // paddingTop: SPACING.lg + insets.top double-counted it (and the Trial/Expired branches use
    // plain padding: SPACING.md). Match the suite convention — plain padding, bottom inset only.
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom, justifyContent: 'center' }}>
        <Card>
          <Text style={{ color: COLORS.success, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Premium Aktif</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>Tüm özelliklere erişimin var.</Text>
          {expiresDate && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.sm }}>Geçerlilik: {expiresDate}</Text>
          )}
        </Card>
        <View style={{ marginTop: SPACING.lg }}>
          <Button title="Aboneliği İptal Et" variant="ghost" onPress={handleCancel} />
        </View>
      </ScrollView>
    );
  }

  // Trial period
  if (isInTrial) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
        {/* Trial expiry countdown banner */}
        <View style={{ backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>
            Deneme süren {trialDaysLeft} gün sonra bitiyor
          </Text>
        </View>

        <Card>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700', textAlign: 'center' }}>Deneme Süresi</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.xs }}>
            {trialDaysLeft} gün kaldı. Tüm Premium özellikler açık.
          </Text>
        </Card>

        {/* Feature comparison */}
        <View style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', marginBottom: SPACING.sm }}>Ücretsiz vs Premium</Text>
          <Card title="Ücretsiz">
            {FREE.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
          </Card>
          <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
            {PREMIUM.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} />)}
          </Card>
        </View>

        {/* FIX (audit UX-PRM-08): the in-app purchase path (RevenueCat) is not wired yet, so a live
            "Aboneliğe Geç" / "Satın Alımları Geri Yükle" button can only dead-end. While
            PURCHASE_ENABLED is false we show an honest "coming soon" note instead of buttons that
            always fail; once IAP ships we restore the Subscribe + Restore CTAs. */}
        <View style={{ marginTop: SPACING.md }}>
          {PURCHASE_ENABLED ? (
            <>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.lg }}>
                Deneme bitmeden abone olarak kesintisiz devam et.
              </Text>
              <Button title="Aboneliğe Geç" onPress={handleSubscribe} size="lg" />
              <View style={{ marginTop: SPACING.sm }}>
                <Button title="Satın Alımları Geri Yükle" variant="ghost" onPress={handleRestorePurchases} />
              </View>
            </>
          ) : (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>
              Ücretli abonelik App Store / Google Play üzerinden çok yakında açılacak. Deneme süren boyunca tüm Premium özellikler açık kalır.
            </Text>
          )}
        </View>
      </ScrollView>
    );
  }

  // Expired or never subscribed
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (ux-ideas #3): context hero — lead with the exact feature the user tapped. */}
      {feature ? (
        <View style={{ backgroundColor: COLORS.primary + '18', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md, borderLeftWidth: 3, borderLeftColor: COLORS.primary }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', letterSpacing: 0.5 }}>
            {'AÇMAK İSTEDİN'}
          </Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', marginTop: 2 }}>{feature}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>
            {/* FIX (ux-review): only promise "aşağıda işaretledik" when a PREMIUM row actually
                matches — several gated labels don't substring-match the list wording. */}
            {PREMIUM.some(f => matchesFeature(f, feature)) ? 'Bu özellik Premium ile açılır — aşağıda işaretledik.' : 'Bu özellik Premium ile açılır.'}
          </Text>
        </View>
      ) : null}
      {/* FIX (audit duplicate-title): Native header (title "Premium'a Geç") renders the title; in-body H1 removed as redundant. */}
      {isExpired && (
        <View style={{ backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.sm, marginTop: SPACING.sm }}>
          {/* FIX (ux-pass5): 'Yenile.' pointed at an affordance that can't succeed while
              purchases are unwired and the trial is spent — say what's actually possible. */}
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, textAlign: 'center' }}>
            {!PURCHASE_ENABLED && trialUsed ? 'Premium süren doldu. Satın alma yakında aktif olacak.' : 'Premium süren doldu. Yenile.'}
          </Text>
        </View>
      )}
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>Yaşam tarzı koçunun tam gücünü aç.</Text>

      <Card title="Ücretsiz">
        {FREE.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.success} />)}
      </Card>

      <Card title="Premium" style={{ borderColor: COLORS.primary, borderWidth: 2 }}>
        {PREMIUM.map((f, i) => <FeatureRow key={i} text={f} color={COLORS.primary} highlighted={matchesFeature(f, feature)} />)}
      </Card>

      {/* FIX (audit UX-PRM-08): while the native IAP path (RevenueCat) is unwired, showing live
          $9.99/$79.99 pricing + a "Premium'a Geç" Subscribe button + "Satın Alımları Geri Yükle"
          that always dead-end is a misleading monetization UX and an App Store / Play review
          blocker. Until PURCHASE_ENABLED flips true we surface the working 7-day free-trial CTA and
          an honest "paid subscription coming soon" note instead. */}
      {PURCHASE_ENABLED ? (
        <>
          {/* Pricing */}
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Card style={{ flex: 1 }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', textAlign: 'center' }}>Aylık</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.xxl, fontWeight: '800', textAlign: 'center' }}>$9.99</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>/ay</Text>
            </Card>
            <Card style={{ flex: 1, borderColor: COLORS.primary, borderWidth: 1 }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700', textAlign: 'center', marginBottom: 2 }}>%33 İNDİRİM</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', textAlign: 'center' }}>Yıllık</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.xxl, fontWeight: '800', textAlign: 'center' }}>$79.99</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>$6.67/ay</Text>
            </Card>
          </View>

          <Button title="Premium'a Geç" onPress={handleSubscribe} size="lg" />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.sm }}>
            7 gün ücretsiz deneme. İstediğin zaman iptal edebilirsin.
          </Text>
          <View style={{ marginTop: SPACING.md }}>
            <Button title="Satın Alımları Geri Yükle" variant="ghost" onPress={handleRestorePurchases} />
          </View>
        </>
      ) : trialUsed ? (
        // FIX (ux-pass5): expired-trial + purchases unwired — the trial CTA could only error
        // ('hakkını daha önce kullanmışsın'). Honest disabled state instead; the working CTA
        // below stays for trial-eligible users and the PURCHASE_ENABLED branch is untouched.
        <>
          <Button title="Deneme süren kullanıldı" onPress={() => {}} size="lg" disabled />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.sm }}>
            7 günlük ücretsiz denemeni daha önce kullandın. Premium satın alma App Store / Google Play üzerinden çok yakında aktif olacak.
          </Text>
        </>
      ) : (
        <>
          <Button title="7 gün ücretsiz dene" onPress={startFreeTrial} size="lg" />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.sm }}>
            7 günlük ücretsiz deneme ile tüm Premium özellikleri kullan. Ücretli abonelik App Store / Google Play üzerinden çok yakında açılacak.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function FeatureRow({ text, color, highlighted }: { text: string; color: string; highlighted?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3,
      ...(highlighted ? { backgroundColor: COLORS.primary + '18', borderRadius: 6, paddingHorizontal: 6, marginHorizontal: -6 } : null),
    }}>
      <Text style={{ color, fontSize: FONT.md, fontWeight: '700', width: 20 }}>{highlighted ? '★' : '+'}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1, fontWeight: highlighted ? '700' : '400' }}>{text}</Text>
    </View>
  );
}
