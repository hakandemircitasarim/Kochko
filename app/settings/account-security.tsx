/**
 * Account Security Settings
 * Spec 1.2-1.4: Session management, password change, account linking, email change.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { getActiveSessions, terminateSession } from '@/services/realtime-sync.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

export default function AccountSecurityScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // Active sessions
  const [sessions, setSessions] = useState<{ sessionId: string; deviceInfo: string; lastActiveAt: string }[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const providers = user?.app_metadata?.providers as string[] ?? [];
  const identities = user?.identities ?? [];

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await getActiveSessions();
      setSessions(data);
    } catch {
      // silently ignore
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    Alert.alert(
      'Oturumu Kapat',
      'Bu oturumu kapatmak istediğine emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Kapat',
          style: 'destructive',
          onPress: async () => {
            const { error } = await terminateSession(sessionId);
            if (error) {
              haptics.error();
              // FIX (audit raw-error): servisten gelen ham (İngilizce) hata metni yerine kullanıcı-dostu Türkçe mesaj.
              Alert.alert('Oturum kapatılamadı', 'Oturum kapatılırken bir sorun oluştu. Lütfen tekrar dene.');
            } else {
              haptics.success();
              setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
            }
          },
        },
      ]
    );
  };

  // ─── Password Change ───

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      haptics.error();
      Alert.alert('Hata', 'Yeni şifre en az 6 karakter olmalı.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      haptics.error();
      Alert.alert('Hata', 'Şifreler eşleşmiyor.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      haptics.error();
      // FIX (audit raw-error): Supabase ham (İngilizce) hata metni yerine kullanıcı-dostu Türkçe mesaj.
      Alert.alert('Şifre değiştirilemedi', 'Şifren güncellenirken bir sorun oluştu. Lütfen tekrar dene.');
    } else {
      haptics.success();
      Alert.alert('Başarılı', 'Şifren değiştirildi.');
      setNewPassword('');
      setConfirmNewPassword('');
    }
  };

  // ─── Email Change ───

  const handleChangeEmail = async () => {
    if (!newEmail || !newEmail.includes('@')) {
      haptics.error();
      Alert.alert('Hata', 'Geçerli bir e-posta adresi gir.');
      return;
    }
    setEmailLoading(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setEmailLoading(false);
    if (error) {
      haptics.error();
      // FIX (audit raw-error): ham (İngilizce) hata metni yerine kullanıcı-dostu Türkçe mesaj.
      Alert.alert('E-posta değiştirilemedi', 'E-posta adresin güncellenirken bir sorun oluştu. Lütfen tekrar dene.');
    } else {
      haptics.success();
      Alert.alert('Başarılı', 'Doğrulama e-postası gönderildi. Yeni adresini onayla.');
      setNewEmail('');
    }
  };

  // ─── Account Linking ───

  const handleLinkGoogle = async () => {
    const { signInWithGoogle } = useAuthStore.getState();
    const { error } = await signInWithGoogle();
    if (error) {
      haptics.error();
      Alert.alert('Hata', error);
    } else {
      haptics.success();
      Alert.alert('Başarılı', 'Google hesabı bağlandı.');
    }
  };

  const handleLinkApple = async () => {
    const { signInWithApple } = useAuthStore.getState();
    const { error } = await signInWithApple();
    if (error) {
      haptics.error();
      Alert.alert('Hata', error);
    } else {
      haptics.success();
      Alert.alert('Başarılı', 'Apple hesabı bağlandı.');
    }
  };

  // ─── Provider Unlinking ───

  const handleUnlinkProvider = async (provider: string) => {
    // At least 1 provider must remain active
    if (providers.length <= 1) {
      haptics.error();
      Alert.alert('Hata', 'En az bir giriş yöntemi aktif olmalı.');
      return;
    }

    Alert.alert(
      'Bağlantı Kaldır',
      `${provider} giriş yöntemini kaldırmak istediğine emin misin?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: async () => {
            const identity = identities.find(
              (i: { provider: string }) => i.provider === provider,
            );
            if (!identity) {
              Alert.alert('Hata', 'Giriş yöntemi bulunamadı.');
              return;
            }
            const { error } = await supabase.auth.unlinkIdentity(identity as never);
            if (error) {
              haptics.error();
              // FIX (audit raw-error): ham (İngilizce) hata metni yerine kullanıcı-dostu Türkçe mesaj.
              Alert.alert('Bağlantı kaldırılamadı', 'Giriş yöntemi kaldırılırken bir sorun oluştu. Lütfen tekrar dene.');
            } else {
              haptics.success();
              Alert.alert('Başarılı', `${provider} bağlantısı kaldırıldı.`);
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {/* Account Info */}
      <Card title="Hesap Bilgileri">
        <View style={{ marginBottom: SPACING.sm }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>E-posta</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{user?.email ?? '-'}</Text>
        </View>
        <View>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Giriş Yöntemleri</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>
            {providers.length > 0 ? providers.join(', ') : 'email'}
          </Text>
        </View>
      </Card>

      {/* Email Change (Spec 1.4) */}
      <SectionHeader title="E-posta Değiştir" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
          Yeni e-posta adresine bir doğrulama linki gönderilecek.
        </Text>
        <Input label="Yeni E-posta" placeholder="yeni@ornek.com" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" />
        <Button title="E-postayı Değiştir" onPress={handleChangeEmail} loading={emailLoading} />
      </Card>

      {/* Password Change (Spec 1.4) */}
      <SectionHeader title="Şifre Değiştir" />
      <Card>
        <Input label="Yeni Şifre" placeholder="En az 6 karakter" value={newPassword} onChangeText={setNewPassword} secureToggle />
        <Input label="Yeni Şifre Tekrar" placeholder="Tekrar gir" value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureToggle />
        <Button title="Şifreyi Değiştir" onPress={handleChangePassword} loading={loading} />
      </Card>

      {/* Account Linking & Unlinking (Spec 1.4) */}
      <SectionHeader title="Giriş Yöntemleri" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md }}>
          Birden fazla giriş yöntemi bağlayabilirsin. En az bir yöntem aktif olmalı.
        </Text>

        {/* Google */}
        <ProviderRow
          name="Google"
          linked={providers.includes('google')}
          canUnlink={providers.length > 1}
          onLink={handleLinkGoogle}
          onUnlink={() => handleUnlinkProvider('google')}
        />

        {/* Apple (iOS only) */}
        {Platform.OS === 'ios' && (
          <ProviderRow
            name="Apple"
            linked={providers.includes('apple')}
            canUnlink={providers.length > 1}
            onLink={handleLinkApple}
            onUnlink={() => handleUnlinkProvider('apple')}
          />
        )}

        {/* Email */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>E-posta</Text>
          <Text style={{ color: providers.includes('email') ? COLORS.success : COLORS.textMuted, fontSize: FONT.sm }}>
            {providers.includes('email') ? 'Aktif' : '-'}
          </Text>
        </View>
      </Card>

      {/* Active Sessions (Spec 1.2) */}
      <SectionHeader title="Aktif Oturumlar" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
          Hesabına bağlı aktif cihazlar. Tanımlamadığın bir oturumu kapatabilirsin.
        </Text>
        {sessionsLoading ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.sm }}>Yükleniyor...</Text>
        ) : sessions.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.sm }}>Aktif oturum bulunamadı.</Text>
        ) : (
          sessions.map((session, index) => (
            <View key={session.sessionId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: index < sessions.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{session.deviceInfo}</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
                  Son aktif: {new Date(session.lastActiveAt).toLocaleString('tr-TR')}
                </Text>
              </View>
              {index !== 0 && (
                <Button title="Kapat" variant="ghost" size="sm" onPress={() => handleTerminateSession(session.sessionId)} />
              )}
              {index === 0 && (
                <Text style={{ color: COLORS.success, fontSize: FONT.xs, marginLeft: SPACING.sm }}>Mevcut</Text>
              )}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Provider Row ───

function ProviderRow({
  name,
  linked,
  canUnlink,
  onLink,
  onUnlink,
}: {
  name: string;
  linked: boolean;
  canUnlink: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{name}</Text>
      {linked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Text style={{ color: COLORS.success, fontSize: FONT.sm }}>Bağlı</Text>
          {canUnlink && (
            <Button title="Kaldır" variant="ghost" size="sm" onPress={onUnlink} />
          )}
        </View>
      ) : (
        <Button title="Bağla" variant="outline" size="sm" onPress={onLink} />
      )}
    </View>
  );
}
