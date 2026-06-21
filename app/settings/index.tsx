import { useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Modal, TextInput, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { usePremium } from '@/hooks/usePremium';
import { exportJSON, exportCSV } from '@/services/export.service';
// FIX (audit DB-PRV-04): share the audited deletion path (sets flags + writes the
// KVKK 'account_delete_request' audit event) instead of inlining the profiles UPDATE.
import { requestAccountDeletion } from '@/services/privacy.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

export default function SettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const { isPremium, requirePremium } = usePremium();

  // Typed-confirm gate for account deletion: the destructive call only fires
  // after the user types "SIL" in the second modal.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const canDelete = deleteConfirm.trim().toUpperCase() === 'SIL';

  const closeDeleteModal = () => {
    setDeleteOpen(false);
    setDeleteConfirm('');
  };

  // Route a gated row: premium users go straight in; free users are sent to the
  // paywall with the tapped feature name highlighted instead of hitting a dead end.
  const gated = (path: string, featureName: string) => () =>
    requirePremium(() => router.push(path as never), featureName);

  // Step 1: open the typed-confirm modal (no destructive action yet).
  const handleDelete = () => {
    setDeleteConfirm('');
    setDeleteOpen(true);
  };

  // Step 2: only reachable once "SIL" is typed — runs the original deletion call.
  const confirmDelete = async () => {
    if (!canDelete || deleting) return;
    if (user?.id) {
      setDeleting(true);
      // FIX (audit DB-PRV-04): route through privacy.service.requestAccountDeletion so this
      // (the surviving UI delete path) shares the SAME flag-setting (deletion_requested_at +
      // deleted_at for the 30-day grace cron, Spec 1.4 + migration 023) AND writes the KVKK
      // 'account_delete_request' audit event — previously the inline UPDATE skipped the audit
      // trail entirely. It throws on write failure, so keep the "do NOT sign out" guard.
      try {
        await requestAccountDeletion(user.id);
      } catch {
        setDeleting(false);
        haptics.error();
        Alert.alert('Hata', 'Hesabın silinmek üzere işaretlenemedi. Lütfen tekrar dene.');
        return; // do NOT sign out
      }
      haptics.warning();
      closeDeleteModal();
      setDeleting(false);
      await signOut();
    }
  };

  const handleExport = (fn: () => Promise<void>) => () => {
    fn()
      .then(() => haptics.success())
      .catch(() => {
        haptics.error();
        Alert.alert('Dışa aktarılamadı', 'Verilerin dışa aktarılırken bir sorun oluştu. Lütfen tekrar dene.');
      });
  };

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit UI-SET-01): removed inline "Ayarlar" H1 — the native Stack header
          (settings/_layout.tsx → title:'Ayarlar') is the single source of the screen title,
          matching every other settings screen that dropped its duplicate in-body title. */}

      {/* Premium */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
            <Ionicons name={isPremium ? 'star' : 'star-outline'} size={18} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: FONT.lg, fontWeight: '600' }}>
              {isPremium ? 'Premium Aktif' : 'Ücretsiz Plan'}
            </Text>
          </View>
          {!isPremium && <Button title="Premium" size="sm" onPress={() => { haptics.tap(); router.push('/settings/premium'); }} />}
        </View>
      </Card>

      {/* Profile & Goals */}
      <SectionTitle label="Profil ve Hedefler" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="flag-outline" iconColor={colors.primary} label="Hedef Ayarları" onPress={() => router.push('/settings/goals')} colors={colors} />
        <Row icon="layers-outline" iconColor={colors.primary} label="Çok Fazlı Hedefler" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/multi-phase-goals') : gated('/settings/multi-phase-goals', 'Çok Fazlı Hedefler')} colors={colors} />
        <Row icon="create-outline" iconColor={colors.primary} label="Profil Düzenle" onPress={() => router.push('/settings/edit-profile')} colors={colors} />
        <Row icon="restaurant-outline" iconColor={colors.fat} label="Yemek Tercihleri" onPress={() => router.push('/settings/food-preferences')} colors={colors} />
        <Row icon="heart-outline" iconColor={colors.pink} label="Favori Öğünler" onPress={() => router.push('/settings/meal-templates')} colors={colors} />
        <Row icon="timer-outline" iconColor={colors.purple} label="IF Ayarları" onPress={() => router.push('/settings/if-settings')} colors={colors} />
        <Row icon="calendar-outline" iconColor={colors.pink} label="Adet Döngüsü" onPress={() => router.push('/settings/menstrual')} colors={colors} />
        <Row icon="medkit-outline" iconColor={colors.error} label="Sağlık Geçmişi" onPress={() => router.push('/settings/health-events')} colors={colors} />
        <Row icon="flask-outline" iconColor={colors.carbs} label="Lab Değerleri" onPress={() => router.push('/settings/lab-values')} colors={colors} />
        <Row icon="nutrition-outline" iconColor={colors.success} label="Supplement Takibi" onPress={() => router.push('/settings/supplements')} colors={colors} />
        <Row icon="location-outline" iconColor={colors.protein} label="Mekanlar" onPress={() => router.push('/settings/venues')} colors={colors} last />
      </MenuGroup>

      {/* Tracking & Progress */}
      <SectionTitle label="Takip ve İlerleme" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="barbell-outline" iconColor={colors.purple} label="Güç Progresyon" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/strength') : gated('/settings/strength', 'Güç Progresyon')} colors={colors} />
        <Row icon="trophy-outline" iconColor={colors.warning} label="Challenge'lar" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/challenges') : gated('/settings/challenges', "Challenge'lar")} colors={colors} />
        <Row icon="ribbon-outline" iconColor={colors.warning} label="Başarımlar" onPress={() => router.push('/settings/achievements')} colors={colors} />
        <Row icon="book-outline" iconColor={colors.primary} label="Tarif Kütüphanesi" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/recipes') : gated('/settings/recipes', 'Tarif Kütüphanesi')} colors={colors} />
        {/* Re-enabled after the DoD-5 round: getCurrentWeeklyPlan is scoped
            (plan_type+status, limit 1), plan_data/shopping_list normalize on
            read, generate returns the persisted row, and meal-prep builds
            deterministically with an in-screen activation toggle. */}
        <Row icon="calendar-number-outline" iconColor={colors.primary} label="Haftalık Menü" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/weekly-menu') : gated('/settings/weekly-menu', 'Haftalık Menü')} colors={colors} />
        <Row icon="cube-outline" iconColor={colors.primary} label="Meal Prep Planı" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/meal-prep-plan') : gated('/settings/meal-prep-plan', 'Meal Prep Planı')} colors={colors} />
        <Row icon="camera-outline" iconColor={colors.pink} label="İlerleme Fotoğrafları" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/progress-photos') : gated('/settings/progress-photos', 'İlerleme Fotoğrafları')} colors={colors} last />
      </MenuGroup>

      {/* Social — households/household_members/coach_consents all exist in the live DB and
          their RLS is sound (migration 040 fixed the household_members policy recursion that
          previously 500'd these screens). Verified live: create household + membership + lookup. */}
      <SectionTitle label="Sosyal" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="people-outline" iconColor={colors.protein} label="Aile Planı" onPress={() => router.push('/settings/household')} colors={colors} />
        <Row icon="share-social-outline" iconColor={colors.primary} label="Koç Paylaşımı" onPress={() => router.push('/settings/coach-sharing')} colors={colors} last />
      </MenuGroup>

      {/* Preferences */}
      <SectionTitle label="Tercihler" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="chatbubble-outline" iconColor={colors.primary} label="Koç Tonu" onPress={() => router.push('/settings/coach-tone')} colors={colors} />
        <Row icon="eye-outline" iconColor={colors.purple} label="Kochko'nun Senin Hakkında Bildikleri" onPress={() => router.push('/settings/coach-memory')} colors={colors} />
        <Row icon="notifications-outline" iconColor={colors.carbs} label="Bildirimler" onPress={() => router.push('/settings/notifications')} colors={colors} />
        <Row icon="pulse-outline" iconColor={colors.pink} label="Dönemsel Durum" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/periodic-state') : gated('/settings/periodic-state', 'Dönemsel Durum')} colors={colors} />
        <Row icon="color-palette-outline" iconColor={colors.purple} label="Tema" onPress={() => router.push('/settings/theme')} colors={colors} last />
      </MenuGroup>

      {/* Data */}
      <SectionTitle label="Veri" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="code-download-outline" iconColor={colors.primary} label="JSON Dışa Aktar" onPress={handleExport(exportJSON)} colors={colors} />
        <Row icon="document-text-outline" iconColor={colors.primary} label="CSV Dışa Aktar" onPress={handleExport(exportCSV)} colors={colors} />
        <Row icon="medical-outline" iconColor={colors.error} label="Sağlık Profesyoneli Raporu" premium={!isPremium} onPress={isPremium ? () => router.push('/settings/health-export') : gated('/settings/health-export', 'Sağlık Profesyoneli Raporu')} colors={colors} />
        <Row icon="cloud-upload-outline" iconColor={colors.protein} label="Veri İçeri Aktar" onPress={() => router.push('/settings/data-import')} colors={colors} />
        <Row icon="time-outline" iconColor={colors.textSecondary} label="Sohbet Geçmişi" onPress={() => router.push('/settings/chat-history')} colors={colors} last />
      </MenuGroup>

      {/* Security */}
      <SectionTitle label="Güvenlik" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="shield-checkmark-outline" iconColor={colors.success} label="Hesap Güvenliği" onPress={() => router.push('/settings/account-security')} colors={colors} last />
      </MenuGroup>

      {/* Privacy */}
      <Card title="Gizlilik ve Güvenlik" style={{ marginTop: SPACING.lg }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          Verilerin şifrelenerek saklanır. Tüm verilerini dışa aktarabilir veya hesabını silebilirsin. Kochko'nun senin hakkında bildiklerini Profil {'>'} "Kochko'nun Senin Hakkında Bildikleri" bölümünden görebilir, düzeltebilir veya silebilirsin.
        </Text>
      </Card>

      {/* Transparency */}
      <SectionTitle label="Şeffaflık" colors={colors} />
      <MenuGroup colors={colors}>
        <Row icon="sparkles-outline" iconColor={colors.purple} label="AI Şeffaflık" onPress={() => router.push('/settings/debug-mode')} colors={colors} last />
      </MenuGroup>

      {/* Danger */}
      <View style={{ marginTop: SPACING.xl, gap: SPACING.sm }}>
        <Button
          title="Çıkış Yap"
          variant="ghost"
          onPress={() => {
            haptics.tap();
            Alert.alert('Çıkış', 'Emin misin?', [
              { text: 'İptal' },
              { text: 'Çıkış', style: 'destructive', onPress: signOut },
            ]);
          }}
        />
      </View>
      <View style={{ marginTop: SPACING.lg }}>
        <Button title="Hesabımı Sil" variant="danger" onPress={handleDelete} />
      </View>

      <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xxl }}>Kochko v1.0.0</Text>
    </ScrollView>

    {/* Typed-confirm gate: requires typing "SIL" before the irreversible deletion request. */}
    <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={closeDeleteModal}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: SPACING.xl }}>
        <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Ionicons name="warning-outline" size={22} color={colors.error} />
            <Text style={{ color: colors.text, fontSize: FONT.xl2, fontWeight: '700', flexShrink: 1 }}>Hesabı Sil</Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.lg }}>
            Hesabın silinmek üzere işaretlenecek. 30 gün içinde tekrar giriş yaparsan hesabın otomatik olarak yeniden aktif olur. 30 gün sonra tüm verilerin kalıcı olarak silinecek.
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>
            Onaylamak için <Text style={{ color: colors.error, fontWeight: '700' }}>SIL</Text> yaz
          </Text>
          <TextInput
            value={deleteConfirm}
            onChangeText={setDeleteConfirm}
            placeholder="SIL"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            style={{
              backgroundColor: colors.inputBg,
              borderRadius: RADIUS.md,
              paddingHorizontal: SPACING.xl,
              paddingVertical: SPACING.md,
              color: colors.text,
              fontSize: FONT.sm,
              borderWidth: 0.5,
              borderColor: canDelete ? colors.error : colors.border,
              marginBottom: SPACING.lg,
            }}
          />
          <View style={{ gap: SPACING.sm }}>
            <Button
              title="Hesabımı Sil"
              variant="danger"
              disabled={!canDelete || deleting}
              loading={deleting}
              onPress={confirmDelete}
            />
            <Button
              title="İptal"
              variant="ghost"
              onPress={() => { haptics.tap(); closeDeleteModal(); }}
            />
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

function SectionTitle({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </Text>
  );
}

function MenuGroup({ children, colors }: { children: React.ReactNode; colors: ThemeColors }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

function Row({ icon, iconColor, label, onPress, colors, last, premium }: {
  icon: IconName;
  iconColor: string;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  last?: boolean;
  premium?: boolean;
}) {
  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    minHeight: 48,
    borderBottomWidth: last ? 0 : 0.5,
    borderBottomColor: colors.border,
  };
  return (
    <TouchableOpacity
      style={rowStyle}
      onPress={() => { haptics.tap(); onPress(); }}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={premium ? `${label}, Premium özellik` : label}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 }}>
        <Ionicons name={icon} size={18} color={iconColor} />
        <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '400', flexShrink: 1 }}>{label}</Text>
      </View>
      {premium && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginRight: SPACING.sm }}>
          <Ionicons name="lock-closed" size={11} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '600' }}>Premium</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
