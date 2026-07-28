import { useState, useRef } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, TouchableOpacity, Linking, TextInput } from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

// Hosted legal documents (KVKK aydınlatma / kullanım koşulları) — same as register.tsx.
// launch 2026-07-29: pages are LIVE on the public legal edge function (source: store/*.html)
const TERMS_URL = 'https://ugoynltxwrkqjwrdxmzt.supabase.co/functions/v1/legal/kullanim-kosullari';
const PRIVACY_URL = 'https://ugoynltxwrkqjwrdxmzt.supabase.co/functions/v1/legal/gizlilik';

// FIX (kullanıcı bulgusu): Google provider'ı Supabase'te henüz yapılandırılmadı
// (Google Cloud client ID/secret gerekiyor — sahibin aksiyonu). Ölü buton tarayıcıda
// bozuk bir sayfaya düşüyordu; kimlikler girilene dek buton GİZLİ (PURCHASE_ENABLED
// deseni). Aktive etmek için: Google Cloud'da OAuth client → Supabase Auth → Google
// provider'a ID+secret → bu bayrağı true yap (register.tsx'te de aynı bayrak var).
const GOOGLE_LOGIN_ENABLED = false;

// FIX (audit UX-FRM-04): basic client-side e-posta format kontrolü — bozuk bir
// e-posta sunucuya ulaşıp İngilizce bir hata döndürmeden önce yakalanır.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (v: string) => EMAIL_RE.test(v);

// FIX (audit UX-FRM-04): Supabase auth mesajları İngilizce gelir ('Invalid login
// credentials', 'User already registered', 'Unable to validate email address: invalid
// format' ...). Türkçe-only kitleye Türkçe göster. register.tsx ile birebir aynı eşleme.
function localizeAuthError(message?: string | null): string {
  const m = (message ?? '').toLowerCase();
  if (!m) return 'Bir sorun oluştu. Lütfen tekrar dene.';
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) return 'E-posta veya şifre hatalı.';
  if (m.includes('email not confirmed') || m.includes('not confirmed')) return 'E-postanı henüz doğrulamadın. Lütfen gelen kutunu kontrol et.';
  if (m.includes('user already registered') || m.includes('already registered')) return 'Bu e-posta zaten kayıtlı.';
  if (m.includes('invalid email') || m.includes('invalid format') || m.includes('unable to validate email')) return 'Geçerli bir e-posta gir.';
  if (m.includes('password should be at least') || (m.includes('password') && m.includes('at least'))) return 'Şifre en az 6 karakter olmalı.';
  if (m.includes('rate limit') || m.includes('too many requests')) return 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.';
  if (m.includes('network') || m.includes('fetch')) return 'Bağlantı hatası. İnternetini kontrol et.';
  return message ?? 'Bir sorun oluştu. Lütfen tekrar dene.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  // FIX (ux-round3 #7): keyboard "İleri" jumps e-posta → şifre instead of dismissing.
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, signInWithGoogle, signInWithApple, resetPassword, loading } = useAuthStore();

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Hata', 'Bağlantı açılamadı.'));
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Hata', 'E-posta ve şifre gerekli.'); return; }
    // FIX (audit UX-FRM-04): istemci-tarafı e-posta format kontrolü — bozuk e-posta
    // sunucuya gitmeden Türkçe inline hata göster.
    if (!isValidEmail(email.trim())) { Alert.alert('Hata', 'Geçerli bir e-posta gir.'); return; }
    const { error } = await signIn(email.trim(), password);
    if (error) Alert.alert('Hata', localizeAuthError(error)); // FIX (audit UX-FRM-04): Supabase İngilizce hatasını Türkçeleştir
    else router.replace('/');
  };

  const handleGoogle = async () => {
    const { error, cancelled } = await signInWithGoogle();
    if (cancelled) return;
    if (error) Alert.alert('Hata', localizeAuthError(error)); // FIX (audit UX-FRM-04)
    else router.replace('/');
  };

  const handleApple = async () => {
    const { error, cancelled } = await signInWithApple();
    if (cancelled) return;
    if (error) Alert.alert('Hata', localizeAuthError(error)); // FIX (audit UX-FRM-04)
    else router.replace('/');
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      Alert.alert('E-posta Gerekli', 'Şifre sıfırlama linki için e-posta adresini gir.');
      return;
    }
    // FIX (audit UX-FRM-04): sıfırlama isteğinden önce de e-posta formatını doğrula.
    if (!isValidEmail(email.trim())) { Alert.alert('Hata', 'Geçerli bir e-posta gir.'); return; }
    Alert.alert('Şifre Sıfırlama', `${email.trim()} adresine sıfırlama linki gönderilsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Gönder', onPress: async () => {
        const { error } = await resetPassword(email.trim());
        if (error) Alert.alert('Hata', localizeAuthError(error)); // FIX (audit UX-FRM-04)
        else Alert.alert('Başarılı', 'Şifre sıfırlama linki e-posta adresinize gönderildi. Link 1 saat geçerlidir.');
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      // FIX (audit UI-CHT-01 kalıbı): her iki platformda da 'padding'. Expo SDK 55'in zorunlu
      // edge-to-edge'i altında Android 'height' pencereyi yanlış ölçüyor ve giriş alanlarını/
      // butonu klavyenin altında bırakabiliyordu (bkz. app/chat/[sessionId].tsx'teki fix notu).
      // İçerik ScrollView'da: 'padding' ile "Giriş Yap" butonu kaydırılarak erişilebilir kalır.
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: SPACING.lg,
          paddingTop: SPACING.lg + insets.top,
          paddingBottom: SPACING.lg + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: SPACING.xl }}>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: COLORS.primary, letterSpacing: 2 }}>Kochko</Text>
          <Text style={{ fontSize: FONT.lg, color: COLORS.textSecondary, marginTop: SPACING.xs }}>Yaşam tarzı koçun</Text>
        </View>

        {/* FIX (ux-audit major): a cold-start user landed on a bare returning-user login form with no
            idea what the app does before being asked to commit an account. A concise pre-auth value
            proposition (what you get) sits above the sign-in so the choice is informed. */}
        <View style={{ alignSelf: 'stretch', gap: SPACING.sm, marginBottom: SPACING.xl }}>
          {[
            'Yapay zekâ koçunla konuşarak beslen ve antrenman yap',
            'Öğününü yaz ya da fotoğrafla — kalorin otomatik işlensin',
            'Hedefine özel diyet ve antrenman planı',
          ].map((t, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '800', lineHeight: 20 }}>•</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20, flex: 1 }}>{t}</Text>
            </View>
          ))}
        </View>

        {/* FIX (audit UX-ONB-01/HIGH): social sign-in CREATES an account on first use, so the
            KVKK/Terms consent must be shown here too (not only on the register screen) — it sits
            above the social buttons so it's visible before any account is created. */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', lineHeight: 19, marginBottom: SPACING.lg }}>
          Devam ederek{' '}
          <Text
            style={{ color: COLORS.primary, fontWeight: '600' }}
            onPress={() => openLink(TERMS_URL)}
            accessibilityRole="link"
            accessibilityLabel="Kullanım Koşulları'nı aç"
          >
            Kullanım Koşulları
          </Text>
          {"'nı ve "}
          <Text
            style={{ color: COLORS.primary, fontWeight: '600' }}
            onPress={() => openLink(PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Gizlilik Politikası'nı aç"
          >
            Gizlilik Politikası
          </Text>
          {"'nı kabul etmiş olursun."}
        </Text>

        {/* Social Login Buttons (Spec 1.1) — Google, provider yapılandırılana dek gizli. */}
        {GOOGLE_LOGIN_ENABLED && (
          <>
            <Button title="Google ile Giriş Yap" onPress={handleGoogle} loading={loading} variant="outline" size="lg" />
            <View style={{ height: SPACING.sm }} />
          </>
        )}
        {Platform.OS === 'ios' && (
          <>
            <Button title="Apple ile Giriş Yap" onPress={handleApple} loading={loading} variant="outline" size="lg" />
            <View style={{ height: SPACING.sm }} />
          </>
        )}

        {/* Divider — FIX (ux-readiness): only render when a social button is actually shown above it.
            On Android (no Google/Apple) the "veya" hung over the lone email form like a broken button. */}
        {(GOOGLE_LOGIN_ENABLED || Platform.OS === 'ios') && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginHorizontal: SPACING.md }}>veya</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          </View>
        )}

        <Input
          label="E-posta"
          placeholder="ornek@kochko.app"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          autoComplete="email"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Input
          ref={passwordRef}
          label="Şifre"
          placeholder="Şifreniz"
          value={password}
          onChangeText={setPassword}
          secureToggle
          textContentType="password"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        {/* Forgot Password (Spec 1.2) */}
        {/* FIX (audit a11y): min 44dp dokunma hedefi + erişilebilirlik etiketi */}
        <TouchableOpacity
          onPress={handleForgotPassword}
          style={{ alignSelf: 'flex-end', marginBottom: SPACING.md, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Şifremi unuttum"
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>Şifremi Unuttum</Text>
        </TouchableOpacity>

        <Button title="Giriş Yap" onPress={handleLogin} loading={loading} size="lg" />
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Hesabın yok mu? </Text>
          <Link href="/(auth)/register" style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Kayıt Ol</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
