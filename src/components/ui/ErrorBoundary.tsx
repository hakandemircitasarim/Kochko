import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { trackEvent } from '@/services/analytics.service';
import { flushTelemetry } from '@/services/telemetry.service';
// FIX (audit ui-errorboundary): replace hand-rolled (drifted) hex colors with theme tokens.
// Bu sınır ThemeContext.Provider'ı SARDIĞI için (app/_layout.tsx) hook'a erişemez ve zaten
// sağlayıcı monte olmadan da çökme yakalayabilir. Bu yüzden koyu palet bilinçli sabit
// yedektir — açık tema açıldıktan sonra da geçerli: çökme ekranı tek seferlik bir kurtarma
// yüzeyi, tema tutarlılığı değil okunabilirlik önceliklidir.
import { DARK_COLORS as c } from '@/lib/theme';
// FIX (audit UI-DS-05): consume the numeric scale tokens instead of raw literals.
// (Class component can't call useTheme(), but the SPACING/FONT/RADIUS tokens are
// plain constants and import fine here — only the *colors* need the dark fallback.)
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
// 2026-11-04: elle yazılmış iki TouchableOpacity buton yerine gövdeli Button + teselli eden
// Koçko. İkisi de useTheme() kullanır; sağlayıcının DIŞINDA oldukları için bağlamın
// varsayılanı (DARK_COLORS) gelir — bu sınırın bilinçli koyu yedeğiyle aynı palet.
import { Button } from '@/components/ui/Button';
import { MascotStage } from '@/components/ui/EmptyState';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

/**
 * Top-level crash catcher. When a render-tree error reaches this boundary we
 * show a recovery UI with three escape hatches: retry (re-render children),
 * sign-out (nuke the session, often fixes stale-state crashes), and — in
 * dev — the raw stack so we can see what broke.
 *
 * Sunum (§0-A/§0-B): Koçko `cheerup` (kalp uzatan koç) + koç ağzından teselli kopyası; TEK net
 * eylem dolu "Tekrar dene", çıkış ikincil (ghost — gövdesiz, dikkat çekmez). a11y etiketleri
 * eski butonlarla aynı ("Tekrar Dene" / "Çıkış Yap").
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // Push into the analytics buffer so the crash is recoverable from logs
    // even if the user immediately retries and the render succeeds.
    try {
      trackEvent('render_error', {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      });
      // Render çökmesi, kullanıcının uygulamayı KAPATMA ihtimalinin en yüksek olduğu an —
      // tamponlar yalnızca RAM'de olduğu için "arka plana geçince göndeririz" burada
      // yetmez. Hemen yolla (best-effort, hiçbir zaman throw etmez).
      const uid = useAuthStore.getState().user?.id;
      if (uid) void flushTelemetry(uid);
    } catch { /* analytics is best-effort */ }
    this.setState({ errorInfo: info.componentStack ?? null });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleSignOut = async () => {
    try {
      await useAuthStore.getState().signOut();
    } catch { /* if signOut itself fails, we can't do much more */ }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const devDetails = __DEV__ && (this.state.error || this.state.errorInfo);

    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {/* FIX (audit UI-DS-05): tokenize spacing/font/radius literals. `padding: 32` and the
            320 reading width have no scale token so they stay as layout literals. Metinler
            TYPE olceginde; 10 -> TYPE.footnote. Butonlar artik Button primitifi (raf/hitSlop/a11y). */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <MascotStage mood="cheerup" size={112} halo={136} />
          <Text style={{ ...TYPE.title2, color: c.text, marginTop: SPACING.lg, marginBottom: SPACING.sm, textAlign: 'center' }}>
            Bir şeyler ters gitti
          </Text>
          <Text style={{ ...TYPE.body, color: c.textSecondary, textAlign: 'center', marginBottom: SPACING.xxl, maxWidth: 320 }}>
            Sorun değil, bir daha deneyelim. Düzelmezse çıkış yapıp yeniden girmek çoğu zaman işe yarar.
          </Text>
          <View style={{ width: '100%', maxWidth: 320, gap: SPACING.sm }}>
            <Button title="Tekrar dene" onPress={this.handleRetry} size="lg" accessibilityLabel="Tekrar Dene" />
            <Button title="Çıkış yap" onPress={this.handleSignOut} variant="ghost" accessibilityLabel="Çıkış Yap" />
          </View>
        </View>
        {devDetails && (
          <ScrollView style={{ maxHeight: 200, backgroundColor: c.surface, padding: SPACING.md }}>
            <Text style={{ ...TYPE.caption, color: c.error, fontFamily: 'monospace' }}>
              {this.state.error?.message}
            </Text>
            {this.state.errorInfo && (
              <Text style={{ ...TYPE.footnote, color: c.textMuted, fontFamily: 'monospace', marginTop: SPACING.sm }}>
                {this.state.errorInfo}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    );
  }
}
