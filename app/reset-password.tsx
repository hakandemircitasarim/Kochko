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
 *
 * Sunum (2026-11-04, Duolingo dili): üç durumun üçü de karakterli — doğrulanırken DÜŞÜNEN
 * Koçko (`thinking`), geçersiz linkte TESELLİ eden Koçko (`cheerup`, halka üstünde), formda
 * yayla giren Koçko. Şifre tekrarı eşleşmiyorsa register.tsx'teki gibi Input `error`'u
 * (türetilmiş değer, yeni state yok); kaydetme/doğrulama akışı aynı.
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
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { MascotStage } from '@/components/ui/EmptyState';

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
  // register.tsx kalıbı: tekrar alanı doluyken anında geri bildirim (submit kontrolü aynen duruyor).
  const mismatch = confirm.length > 0 && password !== confirm;

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
        <KochkoMascot size={112} mood="thinking" animated enter />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ ...TYPE.body, color: colors.textSecondary }}>Bağlantı doğrulanıyor…</Text>
        </View>
      </View>
    );
  }

  if (linkState === 'invalid') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <MascotStage mood="cheerup" size={112} halo={136} />
        <Text style={{ ...TYPE.title2, color: colors.text, marginTop: SPACING.lg, marginBottom: SPACING.sm, textAlign: 'center' }}>
          Bağlantı geçersiz
        </Text>
        <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.xl, textAlign: 'center', maxWidth: 340 }}>
          Sıfırlama bağlantısının süresi dolmuş ya da bağlantı eksik. Sorun değil — giriş ekranından yeni bir bağlantı isteyebilirsin.
        </Text>
        <View style={{ width: '100%', maxWidth: 340 }}>
          <Button title="Giriş ekranına dön" onPress={() => router.replace('/(auth)/login')} size="lg" />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SPACING.xl, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: SPACING.lg }}>
          <KochkoMascot size={88} animated enter />
        </View>
        <Text style={{ ...TYPE.title2, fontWeight: '800', color: colors.text, marginBottom: SPACING.xs, textAlign: 'center' }}>
          Yeni şifre belirle
        </Text>
        <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.xl, textAlign: 'center' }}>
          Hesabın için yeni bir şifre gir.
        </Text>

        <Input label="Yeni Şifre" value={password} onChangeText={setPassword} secureToggle placeholder="En az 6 karakter" />
        <Input
          label="Yeni Şifre (Tekrar)"
          value={confirm}
          onChangeText={setConfirm}
          secureToggle
          placeholder="Tekrar gir"
          error={mismatch ? 'Şifreler eşleşmiyor' : undefined}
        />

        <Button title="Şifreyi güncelle" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.lg }} />
        {/* ux-sweep (RST-EXIT-02): tek butonlu ekranda vazgeçme yolu yoktu. */}
        <Button title="Vazgeç" variant="ghost" onPress={() => router.replace('/')} style={{ marginTop: SPACING.sm }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
