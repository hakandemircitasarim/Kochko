/**
 * Account Security Settings
 * Spec 1.2-1.4: Session management, password change, account linking, email change.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Platform } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { getActiveSessions, terminateSession } from '@/src/services/realtime-sync.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function AccountSecurityScreen() {
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
      'Bu oturumu kapatmak istediginize emin misiniz?',
      [
        { text: 'Iptal', style: 'cancel' },
        {
          text: 'Kapat',
          style: 'destructive',
          onPress: async () => {
            const { error } = await terminateSession(sessionId);
            if (error) {
              Alert.alert('Hata', error);
            } else {
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
      Alert.alert('Hata', 'Yeni sifre en az 6 karakter olmali.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert('Hata', 'Sifreler eslesmiyor.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) Alert.alert('Hata', error.message);
    else {
      Alert.alert('Basarili', 'Sifreniz degistirildi.');
      setNewPassword('');
      setConfirmNewPassword('');
    }
  };

  // ─── Email Change ───

  const handleChangeEmail = async () => {
    if (!newEmail || !newEmail.includes('@')) {
      Alert.alert('Hata', 'Gecerli bir e-posta adresi girin.');
      return;
    }
    setEmailLoading(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setEmailLoading(false);
    if (error) Alert.alert('Hata', error.message);
    else {
      Alert.alert('Basarili', 'Dogrulama e-postasi gonderildi. Yeni adresinizi onaylayin.');
      setNewEmail('');
    }
  };

  // ─── Account Linking ───

  const handleLinkGoogle = async () => {
    const { signInWithGoogle } = useAuthStore.getState();
    const { error } = await signInWithGoogle();
    if (error) Alert.alert('Hata', error);
    else Alert.alert('Basarili', 'Google hesabi baglandi.');
  };

  const handleLinkApple = async () => {
    const { signInWithApple } = useAuthStore.getState();
    const { error } = await signInWithApple();
    if (error) Alert.alert('Hata', error);
    else Alert.alert('Basarili', 'Apple hesabi baglandi.');
  };

  // ─── Provider Unlinking ───

  const handleUnlinkProvider = async (provider: string) => {
    // At least 1 provider must remain active
    if (providers.length <= 1) {
      Alert.alert('Hata', 'En az bir giris yontemi aktif olmali.');
      return;
    }

    Alert.alert(
      'Baglanti Kaldir',
      `${provider} giris yontemini kaldirmak istediginize emin misiniz?`,
      [
        { text: 'Iptal', style: 'cancel' },
        {
          text: 'Kaldir',
          style: 'destructive',
          onPress: async () => {
            const identity = identities.find(
              (i: { provider: string }) => i.provider === provider,
            );
            if (!identity) {
              Alert.alert('Hata', 'Giris yontemi bulunamadi.');
              return;
            }
            const { error } = await supabase.auth.unlinkIdentity(identity as never);
            if (error) Alert.alert('Hata', error.message);
            else Alert.alert('Basarili', `${provider} baglantisi kaldirildi.`);
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Hesap Guvenligi</Text>

      {/* Account Info */}
      <Card title="Hesap Bilgileri">
        <View style={{ marginBottom: SPACING.sm }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>E-posta</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{user?.email ?? '-'}</Text>
        </View>
        <View>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Giris Yontemleri</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md }}>
            {providers.length > 0 ? providers.join(', ') : 'email'}
          </Text>
        </View>
      </Card>

      {/* Email Change (Spec 1.4) */}
      <SectionHeader title="E-posta Degistir" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
          Yeni e-posta adresinize bir dogrulama linki gonderilecektir.
        </Text>
        <Input label="Yeni E-posta" placeholder="yeni@ornek.com" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" />
        <Button title="E-postayi Degistir" onPress={handleChangeEmail} loading={emailLoading} />
      </Card>

      {/* Password Change (Spec 1.4) */}
      <SectionHeader title="Sifre Degistir" />
      <Card>
        <Input label="Yeni Sifre" placeholder="En az 6 karakter" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Input label="Yeni Sifre Tekrar" placeholder="Tekrar girin" value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureTextEntry />
        <Button title="Sifreyi Degistir" onPress={handleChangePassword} loading={loading} />
      </Card>

      {/* Account Linking & Unlinking (Spec 1.4) */}
      <SectionHeader title="Giris Yontemleri" />
      <Card>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md }}>
          Birden fazla giris yontemi baglayabilirsiniz. En az bir yontem aktif olmalidir.
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
          Hesabiniza bagli aktif cihazlar. Tanimlamadiginiz bir oturumu kapatabilirsiniz.
        </Text>
        {sessionsLoading ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.sm }}>Yukleniyor...</Text>
        ) : sessions.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.sm }}>Aktif oturum bulunamadi.</Text>
        ) : (
          sessions.map((session, index) => (
            <View key={session.sessionId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: index < sessions.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{session.deviceInfo}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
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
          <Text style={{ color: COLORS.success, fontSize: FONT.sm }}>Bagli</Text>
          {canUnlink && (
            <Button title="Kaldir" variant="ghost" size="sm" onPress={onUnlink} />
          )}
        </View>
      ) : (
        <Button title="Bagla" variant="outline" size="sm" onPress={onLink} />
      )}
    </View>
  );
}
