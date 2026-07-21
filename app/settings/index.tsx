import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, type ViewStyle } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { coachToneLabelTR } from '@/lib/labels';
import { usePremium } from '@/hooks/usePremium';
import { exportJSON, exportCSV } from '@/services/export.service';
// FIX (audit DB-PRV-04): share the audited deletion path (sets flags + writes the
// KVKK 'account_delete_request' audit event) instead of inlining the profiles UPDATE.
import { requestAccountDeletion } from '@/services/privacy.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SyncStatusCard } from '@/components/common/SyncStatusCard';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

// FIX (ux-ideas #13): the 35-screen settings menu is data-modelled so a single search
// box can filter it. `aliases` are Turkish synonyms so "oruç"→IF, "adet"→Regl, etc.
interface SettingRowDef {
  key: string;
  icon: IconName;
  iconColor: string;
  label: string;
  route?: string;          // navigation target
  premiumFeature?: string; // presence → gated for free users (feature name for the paywall)
  action?: () => void;     // non-route rows (exports)
  aliases?: string[];      // extra search terms
  value?: string;          // FIX (ux-round4 #25): current value shown on the right (discoverability)
}
interface SettingSectionDef { title: string; rows: SettingRowDef[] }

const normTr = (s: string) => s.toLocaleLowerCase('tr-TR');

export default function SettingsScreen() {
  const { colors, isDark } = useTheme();
  // FIX (ux-round4 #25): surface the current value on key rows so the user doesn't have to open
  // each screen to see what's set (the Profil tab already does this; the main list didn't).
  const profile = useProfileStore(s => s.profile);
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const { isPremium, isInTrial, trialDaysLeft, requirePremium } = usePremium();
  // FIX (ux-round2 #17): focusSearch=1 (e.g. from the profile-tab search icon) auto-focuses the box.
  const { openDelete, focusSearch } = useLocalSearchParams<{ openDelete?: string; focusSearch?: string }>();
  // FIX (ux-ideas #13): live filter over the settings rows (label + TR aliases).
  const [search, setSearch] = useState('');

  // Typed-confirm gate for account deletion: the destructive call only fires
  // after the user types "SİL" in the second modal.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  // FIX (ux-pass5): the forced-caps TR keyboard (autoCapitalize="characters") emits 'SİL'
  // (dotted İ, U+0130), which the old ASCII `toUpperCase() === 'SIL'` never matched — the
  // KVKK deletion flow was a silent dead-end on the default Turkish keyboard. Uppercase
  // with tr-TR, then fold İ→I so both 'SİL' and 'SIL' (and lowercase 'sil') pass; the
  // typed-confirm friction stays intact.
  const canDelete = deleteConfirm.trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I') === 'SIL';

  // FIX (audit dead-drop): profile's 'Hesabı sil' row lands here with ?openDelete=1 —
  // open the shared typed-confirm modal directly instead of dropping the user at the
  // top of a 30-row list whose delete button is the last row.
  useEffect(() => {
    if (openDelete === '1') {
      setDeleteConfirm('');
      setDeleteOpen(true);
    }
  }, [openDelete]);

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

  // Step 2: only reachable once "SİL" is typed — runs the original deletion call.
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

  // FIX (ux-ideas #13): single data model for every settings row → one search box can
  // filter all 35 screens. Behaviour per row (gated vs plain push vs export action) is
  // preserved exactly by rowOnPress below.
  const SECTIONS: SettingSectionDef[] = [
    { title: 'Profil ve Hedefler', rows: [
      { key: 'goals', icon: 'flag-outline', iconColor: colors.primary, label: 'Hedef Ayarları', route: '/settings/goals', aliases: ['hedef', 'kilo hedefi', 'goal'] },
      { key: 'multi-phase', icon: 'layers-outline', iconColor: colors.primary, label: 'Çok Fazlı Hedefler', route: '/settings/multi-phase-goals', premiumFeature: 'Çok Fazlı Hedefler', aliases: ['faz', 'phase', 'multi'] },
      { key: 'edit-profile', icon: 'create-outline', iconColor: colors.primary, label: 'Profil Düzenle', route: '/settings/edit-profile', aliases: ['boy', 'kilo', 'yaş', 'profil'] },
      { key: 'food-prefs', icon: 'restaurant-outline', iconColor: colors.fat, label: 'Yemek Tercihleri', route: '/settings/food-preferences', aliases: ['alerji', 'sevmediğim', 'tercih'] },
      { key: 'meal-templates', icon: 'heart-outline', iconColor: colors.pink, label: 'Favori Öğünler', route: '/settings/meal-templates', aliases: ['şablon', 'template', 'favori'] },
      { key: 'if', icon: 'timer-outline', iconColor: colors.purple, label: 'IF Ayarları', route: '/settings/if-settings', value: profile?.if_active ? (profile?.if_window === 'Ozel' ? 'Özel' : String(profile?.if_window ?? 'Açık')) : 'Kapalı', aliases: ['oruç', 'aralıklı', 'intermittent', 'fasting'] },
      { key: 'menstrual', icon: 'calendar-outline', iconColor: colors.pink, label: 'Regl Döngüsü', route: '/settings/menstrual', aliases: ['adet', 'menstrual', 'period', 'döngü'] },
      { key: 'health-events', icon: 'medkit-outline', iconColor: colors.error, label: 'Sağlık Geçmişi', route: '/settings/health-events', aliases: ['hastalık', 'ameliyat', 'sağlık'] },
      { key: 'lab', icon: 'flask-outline', iconColor: colors.carbs, label: 'Lab Değerleri', route: '/settings/lab-values', aliases: ['tahlil', 'kan', 'lab'] },
      { key: 'supplements', icon: 'nutrition-outline', iconColor: colors.success, label: 'Supplement Takibi', route: '/settings/supplements', aliases: ['takviye', 'vitamin'] },
      { key: 'venues', icon: 'location-outline', iconColor: colors.protein, label: 'Mekanlar', route: '/settings/venues', aliases: ['restoran', 'yer', 'venue'] },
    ] },
    { title: 'Takip ve İlerleme', rows: [
      { key: 'strength', icon: 'barbell-outline', iconColor: colors.purple, label: 'Güç Progresyon', route: '/settings/strength', premiumFeature: 'Güç Progresyon', aliases: ['antrenman', '1rm', 'kuvvet', 'strength'] },
      { key: 'challenges', icon: 'trophy-outline', iconColor: colors.warning, label: "Challenge'lar", route: '/settings/challenges', premiumFeature: "Challenge'lar", aliases: ['meydan', 'yarış'] },
      { key: 'achievements', icon: 'ribbon-outline', iconColor: colors.warning, label: 'Başarımlar', route: '/settings/achievements', aliases: ['rozet', 'madalya', 'achievement'] },
      { key: 'recipes', icon: 'book-outline', iconColor: colors.primary, label: 'Tarif Kütüphanesi', route: '/settings/recipes', premiumFeature: 'Tarif Kütüphanesi', aliases: ['tarif', 'recipe'] },
      { key: 'weekly-menu', icon: 'calendar-number-outline', iconColor: colors.primary, label: 'Haftalık Menü', route: '/settings/weekly-menu', premiumFeature: 'Haftalık Menü', aliases: ['menü', 'yemek listesi'] },
      { key: 'meal-prep', icon: 'cube-outline', iconColor: colors.primary, label: 'Meal Prep Planı', route: '/settings/meal-prep-plan', premiumFeature: 'Meal Prep Planı', aliases: ['hazırlık', 'prep'] },
      { key: 'progress-photos', icon: 'camera-outline', iconColor: colors.pink, label: 'İlerleme Fotoğrafları', route: '/settings/progress-photos', premiumFeature: 'İlerleme Fotoğrafları', aliases: ['foto', 'resim', 'progress'] },
    ] },
    { title: 'Sosyal', rows: [
      { key: 'household', icon: 'people-outline', iconColor: colors.protein, label: 'Aile Planı', route: '/settings/household', aliases: ['aile', 'ev', 'household'] },
      { key: 'coach-sharing', icon: 'document-text-outline', iconColor: colors.primary, label: 'Koç Özeti (PDF)', route: '/settings/coach-sharing', aliases: ['pdf', 'özet', 'paylaş', 'doktor'] },
    ] },
    { title: 'Tercihler', rows: [
      { key: 'coach-tone', icon: 'chatbubble-outline', iconColor: colors.primary, label: 'Koç Tonu', route: '/settings/coach-tone', value: profile?.coach_tone ? coachToneLabelTR(profile.coach_tone as string) : undefined, aliases: ['ton', 'üslup'] },
      { key: 'coach-memory', icon: 'eye-outline', iconColor: colors.purple, label: 'Kochko Seni Nasıl Tanıyor', route: '/settings/coach-memory', aliases: ['hafıza', 'bellek', 'memory'] },
      { key: 'notifications', icon: 'notifications-outline', iconColor: colors.carbs, label: 'Bildirimler', route: '/settings/notifications', aliases: ['uyarı', 'hatırlatma', 'notification'] },
      { key: 'periodic', icon: 'pulse-outline', iconColor: colors.pink, label: 'Dönemsel Durum', route: '/settings/periodic-state', premiumFeature: 'Dönemsel Durum', aliases: ['ramazan', 'tatil', 'hastalık', 'seyahat'] },
      { key: 'theme', icon: 'color-palette-outline', iconColor: colors.purple, label: 'Tema', route: '/settings/theme', value: isDark ? 'Koyu' : 'Açık', aliases: ['koyu', 'dark', 'renk', 'görünüm'] },
    ] },
    { title: 'Veri', rows: [
      { key: 'export-json', icon: 'code-download-outline', iconColor: colors.primary, label: 'JSON Dışa Aktar', action: handleExport(exportJSON), aliases: ['export', 'yedek', 'dışa'] },
      { key: 'export-csv', icon: 'document-text-outline', iconColor: colors.primary, label: 'CSV Dışa Aktar', action: handleExport(exportCSV), aliases: ['export', 'yedek', 'excel'] },
      { key: 'health-export', icon: 'medical-outline', iconColor: colors.error, label: 'Sağlık Profesyoneli Raporu', route: '/settings/health-export', premiumFeature: 'Sağlık Profesyoneli Raporu', aliases: ['doktor', 'pdf', 'rapor'] },
      { key: 'data-import', icon: 'cloud-upload-outline', iconColor: colors.protein, label: 'Veri İçeri Aktar', route: '/settings/data-import', aliases: ['import', 'içe aktar'] },
      { key: 'chat-history', icon: 'time-outline', iconColor: colors.textSecondary, label: 'Sohbet Geçmişi', route: '/settings/chat-history', aliases: ['geçmiş', 'history'] },
    ] },
    { title: 'Güvenlik', rows: [
      { key: 'account-security', icon: 'shield-checkmark-outline', iconColor: colors.success, label: 'Hesap Güvenliği', route: '/settings/account-security', aliases: ['şifre', 'parola', 'password', '2fa'] },
    ] },
    { title: 'Şeffaflık', rows: [
      { key: 'debug', icon: 'sparkles-outline', iconColor: colors.purple, label: 'AI Şeffaflık', route: '/settings/debug-mode', aliases: ['debug', 'ai', 'şeffaf'] },
    ] },
  ];

  const q = normTr(search.trim());
  const searching = q.length > 0;
  const rowVisible = (r: SettingRowDef) => !searching || normTr([r.label, ...(r.aliases ?? [])].join(' ')).includes(q);
  const rowOnPress = (r: SettingRowDef): (() => void) => r.action
    ? r.action
    : r.premiumFeature
      ? gated(r.route as string, r.premiumFeature)
      : () => router.push(r.route as never);
  const visibleSections = SECTIONS
    .map(s => ({ ...s, rows: s.rows.filter(rowVisible) }))
    .filter(s => s.rows.length > 0);

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit UI-SET-01): removed inline "Ayarlar" H1 — the native Stack header
          (settings/_layout.tsx → title:'Ayarlar') is the single source of the screen title,
          matching every other settings screen that dropped its duplicate in-body title. */}

      {/* Premium — FIX (ux-ideas #4): a trial user used to see a flat "Premium Aktif" with
          no sense of the ticking clock. Surface the countdown + a soft "Kalıcı yap" CTA. */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexShrink: 1 }}>
            <Ionicons
              name={isInTrial ? 'time' : isPremium ? 'star' : 'star-outline'}
              size={18}
              color={isInTrial ? colors.warning : colors.primary}
            />
            <Text style={{ color: isInTrial ? colors.warning : colors.primary, fontSize: FONT.lg, fontWeight: '600', flexShrink: 1 }}>
              {isInTrial ? `Deneme • ${trialDaysLeft} gün kaldı` : isPremium ? 'Premium Aktif' : 'Ücretsiz Plan'}
            </Text>
          </View>
          {isInTrial
            ? <Button title="Kalıcı yap" size="sm" onPress={() => { haptics.tap(); router.push('/settings/premium'); }} />
            : !isPremium
              ? <Button title="Premium" size="sm" onPress={() => { haptics.tap(); router.push('/settings/premium'); }} />
              : null}
        </View>
      </Card>

      {/* FIX (ux-round2 #5): surface any un-synced offline writes with a manual retry. */}
      <SyncStatusCard />

      {/* Search — FIX (ux-ideas #13): one box to filter all 35 settings screens */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: SPACING.md, marginTop: SPACING.lg }}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Ayarlarda ara"
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, color: colors.text, fontSize: FONT.sm, paddingVertical: SPACING.md }}
          autoCorrect={false}
          autoFocus={focusSearch === '1'}
          returnKeyType="search"
          accessibilityLabel="Ayarlarda ara"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Data-driven settings groups (filtered by search) */}
      {visibleSections.map(section => (
        <View key={section.title}>
          <SectionTitle label={section.title} colors={colors} />
          <MenuGroup colors={colors}>
            {section.rows.map((r, i) => (
              <Row
                key={r.key}
                icon={r.icon}
                iconColor={r.iconColor}
                label={r.label}
                premium={!isPremium && !!r.premiumFeature}
                value={r.value}
                onPress={rowOnPress(r)}
                colors={colors}
                last={i === section.rows.length - 1}
              />
            ))}
          </MenuGroup>
        </View>
      ))}

      {searching && visibleSections.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: SPACING.xxl }}>
          <Ionicons name="search-outline" size={28} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.sm }}>"{search.trim()}" için sonuç yok</Text>
        </View>
      )}

      {!searching && (
        <>
          {/* Privacy */}
          <Card title="Gizlilik ve Güvenlik" style={{ marginTop: SPACING.lg }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
              Verilerin şifrelenerek saklanır. Tüm verilerini dışa aktarabilir veya hesabını silebilirsin. Kochko'nun senin hakkında bildiklerini Profil {'>'} "Kochko Seni Nasıl Tanıyor" bölümünden görebilir, düzeltebilir veya silebilirsin.
            </Text>
          </Card>

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
        </>
      )}
    </ScrollView>

    {/* Typed-confirm gate: requires typing "SİL" before the irreversible deletion request. */}
    <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={closeDeleteModal}>
      {/* FIX (safe-area pass): autoFocus klavyesi küçük ekranlarda kartın alt yarısını
          (Sil/İptal butonlarını) örtüyordu — KAV kartı klavye üstüne kaldırır. Review fix:
          daralan alanda uzun kartın ÜSTÜ (uyarı metni) kırpılabilir — ScrollView geri
          dönüşü sayesinde kullanıcı geri dönüşsüz onay sözünü uyarıyı görmeden yazmaz. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <Ionicons name="warning-outline" size={22} color={colors.error} />
            <Text style={{ color: colors.text, fontSize: FONT.xl2, fontWeight: '700', flexShrink: 1 }}>Hesabı Sil</Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.lg }}>
            Hesabın silinmek üzere işaretlenecek. 30 gün içinde tekrar giriş yaparsan hesabın otomatik olarak yeniden aktif olur. 30 gün sonra tüm verilerin kalıcı olarak silinecek.
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>
            {/* FIX (ux-pass5): display the correct Turkish spelling 'SİL' — the copy told users
                to type an ASCII string the forced-caps TR keyboard can't naturally produce. */}
            Onaylamak için <Text style={{ color: colors.error, fontWeight: '700' }}>SİL</Text> yaz
          </Text>
          <TextInput
            value={deleteConfirm}
            onChangeText={setDeleteConfirm}
            placeholder="SİL"
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
      </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

function SectionTitle({ label, colors }: { label: string; colors: ThemeColors }) {
  // FIX (ux-pass5): textTransform:'uppercase' uppercases locale-blind (i→I), misspelling the
  // dotted-i labels ('PROFIL', 'TAKIP VE ILERLEME', 'TERCIHLER'...); pre-uppercase with
  // tr-TR instead (same fix class as PlanOverviewCards #11e).
  return (
    <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 }}>
      {label.toLocaleUpperCase('tr-TR')}
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

function Row({ icon, iconColor, label, onPress, colors, last, premium, value }: {
  icon: IconName;
  iconColor: string;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  last?: boolean;
  premium?: boolean;
  value?: string;
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
      {/* FIX (ux-round4 #25): current value (hidden when the row is premium-locked). */}
      {!premium && value ? (
        <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: FONT.xs, marginRight: SPACING.xs, maxWidth: 120 }}>{value}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
