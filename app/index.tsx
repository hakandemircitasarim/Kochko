import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, Text, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';

export default function Index() {
  const { colors } = useTheme();
  const { session, initialized, signOut } = useAuthStore();
  const { profile, fetchError, fetch: fetchProfile, reactivateAccount } = useProfileStore();
  // FIX (audit DB-PRV-05): true while the user is canceling a pending deletion, so the
  // reactivation spinner shows instead of the confirmation screen re-appearing mid-write.
  const [reactivating, setReactivating] = useState(false);
  // FIX (ux-audit device-fix): if the profiles row is momentarily unreadable and the fetch resolves
  // with { data: null, error: null } (no fetchError), the gate below would spin FOREVER with no
  // retry or sign-out. After a grace period, surface a retry + sign-out escape instead.
  const [spinTimedOut, setSpinTimedOut] = useState(false);

  useEffect(() => {
    if (session?.user?.id) fetchProfile(session.user.id);
  }, [session?.user?.id, fetchProfile]);

  useEffect(() => {
    if (profile || fetchError || !session) { setSpinTimedOut(false); return; }
    // review fix: spinTimedOut MUST be a dep — otherwise "Tekrar dene" (which resets it to false)
    // wouldn't re-run this effect on a repeated silent {data:null,error:null} fetch, dropping the
    // user back to a permanent spinner. Guard against re-arming once we've already timed out.
    if (spinTimedOut) return;
    const t = setTimeout(() => setSpinTimedOut(true), 12000);
    return () => clearTimeout(t);
  }, [profile, fetchError, session, spinTimedOut]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Yükleniyor"
        />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  // Wait for the authed user's profile to resolve before routing — otherwise a new
  // user whose profile hasn't loaded yet falls through to /(tabs) and SKIPS the
  // onboarding gate (#R5-5), and an onboarded user would flash the onboarding
  // screen. Spin until the profile is present (mig 044 guarantees a row exists, so
  // a successful fetch always returns one).
  if (!profile) {
    // If the fetch FAILED (transient/network) OR the row stayed unreadable past the grace period
    // ({data:null,error:null}), there's no prior profile to fall back on at cold start — offer a
    // retry AND a sign-out escape instead of spinning forever (#R7-2 + ux-audit device-fix).
    if (fetchError || spinTimedOut) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
          <Text style={{ ...TYPE.title3, color: colors.text, textAlign: 'center' }}>Profilin yüklenemedi</Text>
          <Text style={{ ...TYPE.body, color: colors.textSecondary, textAlign: 'center', marginBottom: SPACING.md }}>
            {fetchError ? 'İnternet bağlantını kontrol et.' : 'Beklenenden uzun sürdü. Tekrar dene ya da çıkış yapıp yeniden gir.'}
          </Text>
          <TouchableOpacity
            onPress={() => { setSpinTimedOut(false); if (session?.user?.id) fetchProfile(session.user.id); }}
            accessibilityRole="button" accessibilityLabel="Tekrar dene"
            style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ ...TYPE.bodyStrong, color: getContrastColor(colors.primary) }}>Tekrar dene</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { signOut(); }} accessibilityRole="button" accessibilityLabel="Çıkış yap" style={{ paddingVertical: SPACING.sm, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ ...TYPE.bodyStrong, color: colors.textSecondary }}>Çıkış yap</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Profilin yükleniyor"
        />
      </View>
    );
  }

  // FIX (audit DB-PRV-05): a re-login no longer SILENTLY reactivates a profile that is
  // pending deletion. Strict KVKK/GDPR practice is to confirm intent before reversing a
  // documented deletion request — a user logging in only to take an export should not have
  // their request quietly canceled. Detect the pending state (BOTH columns: the profile-tab
  // path sets deletion_requested_at, the settings path sets both) and ask explicitly; only
  // an explicit "cancel deletion" choice calls reactivateAccount(). "Keep deleting" signs out
  // so the day-30 cron proceeds as scheduled.
  const pendingProfile = profile as Record<string, unknown>;
  const deletionRequestedRaw =
    (pendingProfile.deletion_requested_at as string | null | undefined) ??
    (pendingProfile.deleted_at as string | null | undefined);
  // Yazım sürerken yorumun vadettiği spinner GERÇEKTEN çizilir (eskiden hiçbir JSX yoktu —
  // onay ekranı kalkıyor, kullanıcı yarı-yazılmış durumda tabs'a düşüyordu).
  if (deletionRequestedRaw && reactivating) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Hesap geri açılıyor" />
      </View>
    );
  }
  if (deletionRequestedRaw && !reactivating) {
    const requestedAt = new Date(deletionRequestedRaw);
    const completesAt = new Date(requestedAt.getTime());
    completesAt.setDate(completesAt.getDate() + 30); // 30-day grace window (Spec 1.4)
    const fmt = (d: Date) =>
      isNaN(d.getTime()) ? '' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    const requestedStr = fmt(requestedAt);
    const completesStr = fmt(completesAt);

    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: SPACING.xl }}>
        <Text style={{ ...TYPE.title2, color: colors.text, textAlign: 'center', marginBottom: SPACING.lg }}>
          Hesap silme talebi bekliyor
        </Text>
        <Text style={{ ...TYPE.body, color: colors.textSecondary, textAlign: 'center', marginBottom: SPACING.xxl }}>
          {requestedStr
            ? `${requestedStr} tarihinde hesabını silmek istedin. Talep ${completesStr} tarihinde tamamlanacak ve tüm verilerin kalıcı olarak silinecek.`
            : `Hesabın silinmek üzere işaretli. Talep tamamlandığında tüm verilerin kalıcı olarak silinecek.`}
        </Text>
        <TouchableOpacity
          onPress={async () => {
            if (!session?.user?.id) return;
            setReactivating(true);
            // ux-sweep (IDX-REACT-01): eski hali await'siz/catch'siz ateşliyordu — yazım ağda
            // ölürse kullanıcı 'iptal ettim' sanıp içeri giriyor, 30. gün cron hesabı yine
            // siliyordu. Redirect ancak yazım BAŞARILI olursa (reactivating açık kalır — store
            // yerelde deletion alanlarını temizler ve akış /(tabs)'a düşer); hatada dürüst uyarı.
            try {
              await reactivateAccount(session.user.id);
            } catch {
              setReactivating(false);
              Alert.alert('Hata', 'Silme talebi iptal edilemedi. İnternet bağlantını kontrol edip tekrar dene.');
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Silmeyi iptal et"
          style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center', alignSelf: 'stretch', alignItems: 'center', marginBottom: SPACING.md }}
        >
          <Text style={{ ...TYPE.bodyStrong, color: getContrastColor(colors.primary) }}>Silmeyi iptal et</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { signOut(); }}
          accessibilityRole="button"
          accessibilityLabel="Silmeye devam et"
          style={{ borderColor: colors.error, borderWidth: 1, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center', alignSelf: 'stretch', alignItems: 'center' }}
        >
          <Text style={{ ...TYPE.bodyStrong, color: colors.error }}>Silmeye devam et</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Spec 15: New users go to structured onboarding flow
  if (!profile.onboarding_completed) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}
