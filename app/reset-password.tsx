/**
 * Şifre Sıfırlama ekranı — kochko://reset-password deep link hedefi (#R5-2).
 *
 * FIX (kullanıcı bulgusu: "reset password çalışmıyor" — iki kök neden):
 * 1) Supabase auth config'te site_url localhost + redirect allowlist BOŞTU →
 *    e-posta linki uygulamaya hiç dönmüyordu (Management API'den düzeltildi:
 *    site_url=kochko://, allowlist=kochko://**).
 * 2) RN'de supabase-js deep-link'teki recovery token'larını OTOMATİK oturuma
 *    çevirmez (detectSessionInUrl:false) — ekran oturumu hazır varsayıyordu ve
 *    updateUser "session yok" ile düşüyordu. Artık gelen URL'den fragment
 *    token'ları (implicit flow) veya ?code= (PKCE) yakalanıp oturum kurulur;
 *    form ancak oturum hazır olunca açılır, geçersiz/bayat linkte dürüst hata.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';

type LinkState = 'checking' | 'ready' | 'invalid';

/** URL'den recovery oturumu kur — fragment token'ları (implicit) ve ?code= (PKCE) desteklenir. */
async function establishRecoverySession(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    const hash = url.split('#')[1] ?? '';
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      return !error;
    }
    const code = new URL(url).searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return !error;
    }
  } catch { /* bozuk URL → invalid'e düş */ }
  return false;
}

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('checking');
  const signOut = useAuthStore((s) => s.signOut);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Zaten oturum varsa (recovery kurulmuş ya da kullanıcı girişli) form açılır.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { if (!cancelled) setLinkState('ready'); return; }
      const initialUrl = await Linking.getInitialURL();
      const ok = await establishRecoverySession(initialUrl);
      if (!cancelled) setLinkState(ok ? 'ready' : 'invalid');
    })();
    // Uygulama açıkken gelen link (sıcak başlangıç).
    const sub = Linking.addEventListener('url', async ({ url }) => {
      const ok = await establishRecoverySession(url);
      if (!cancelled && ok) setLinkState('ready');
    });
    return () => { cancelled = true; sub.remove(); };
  }, []);

  const handleSave = async () => {
    if (password.length < 6) {
      Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Hata', 'Şifreler eşleşmiyor.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        Alert.alert(
          'Şifre değiştirilemedi',
          'Sıfırlama bağlantısının süresi dolmuş olabilir. Lütfen giriş ekranından yeni bir bağlantı iste.',
          [{ text: 'Tamam', onPress: async () => { await signOut().catch(() => {}); router.replace('/(auth)/login'); } }],
        );
        return;
      }
      Alert.alert('Başarılı', 'Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.', [
        { text: 'Tamam', onPress: async () => { await signOut().catch(() => {}); router.replace('/(auth)/login'); } },
      ]);
    } catch {
      Alert.alert('Hata', 'Bir sorun oluştu. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  if (linkState === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: SPACING.md }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textSecondary, fontSize: FONT.md }}>Bağlantı doğrulanıyor…</Text>
      </View>
    );
  }

  if (linkState === 'invalid') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <Text style={{ fontSize: FONT.xl, fontWeight: '700', color: colors.text, marginBottom: SPACING.sm, textAlign: 'center' }}>
          Bağlantı geçersiz
        </Text>
        <Text style={{ fontSize: FONT.md, color: colors.textSecondary, marginBottom: SPACING.xl, textAlign: 'center', lineHeight: 22 }}>
          Sıfırlama bağlantısının süresi dolmuş ya da bağlantı eksik. Giriş ekranından yeni bir bağlantı isteyebilirsin.
        </Text>
        <Button title="Giriş ekranına dön" onPress={() => router.replace('/(auth)/login')} size="lg" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.xl, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: colors.text, marginBottom: SPACING.xs }}>
          Yeni Şifre Belirle
        </Text>
        <Text style={{ fontSize: FONT.md, color: colors.textSecondary, marginBottom: SPACING.xl }}>
          Hesabın için yeni bir şifre gir.
        </Text>

        <Input label="Yeni Şifre" value={password} onChangeText={setPassword} secureToggle placeholder="••••••••" />
        <Input label="Yeni Şifre (Tekrar)" value={confirm} onChangeText={setConfirm} secureToggle placeholder="••••••••" />

        <Button title="Şifreyi Güncelle" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.lg }} />
          {/* ux-sweep (RST-EXIT-02): tek butonlu ekranda vazgeçme yolu yoktu. */}
          <Button title="Vazgeç" variant="ghost" onPress={() => router.replace('/')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
