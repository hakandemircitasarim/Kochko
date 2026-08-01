import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { trackEvent } from '@/services/analytics.service';
import { flushTelemetry } from '@/services/telemetry.service';
// FIX (audit ui-errorboundary): replace hand-rolled (drifted) hex colors with theme tokens.
// Bu sınır ThemeContext.Provider'ı SARDIĞI için (app/_layout.tsx) hook'a erişemez ve zaten
// sağlayıcı monte olmadan da çökme yakalayabilir. Bu yüzden koyu palet bilinçli sabit
// yedektir — açık tema açıldıktan sonra da geçerli: çökme ekranı tek seferlik bir kurtarma
// yüzeyi, tema tutarlılığı değil okunabilirlik önceliklidir.
import { DARK_COLORS as c } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
// FIX (audit UI-DS-05): consume the numeric scale tokens instead of raw literals.
// (Class component can't call useTheme(), but the SPACING/FONT/RADIUS tokens are
// plain constants and import fine here — only the *colors* need the dark fallback.)
import { SPACING, FONT, RADIUS } from '@/lib/constants';

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
        {/* FIX (audit UI-DS-05): tokenize spacing/font/radius literals. `padding: 32` and
            `minWidth: 200` have no scale token so they stay as layout literals; everything
            with an exact token (18->FONT.xl2, 14->FONT.md, 8->SPACING.sm, 24->SPACING.xxl,
            12->SPACING.md/RADIUS.md, 11->FONT.xs) is replaced. fontSize:10 has no token (xs=11). */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Text style={{ color: c.text, fontSize: FONT.xl2, fontWeight: '700', marginBottom: SPACING.sm }}>
            Bir şeyler ters gitti
          </Text>
          <Text style={{ color: c.textMuted, fontSize: FONT.md, textAlign: 'center', marginBottom: SPACING.xxl }}>
            Beklenmeyen bir hata oluştu. Tekrar deneyebilir ya da hesaptan çıkıp yeniden girebilirsin.
          </Text>
          <TouchableOpacity
            onPress={this.handleRetry}
            style={{ backgroundColor: c.primary, paddingHorizontal: SPACING.xxl, paddingVertical: SPACING.md, borderRadius: RADIUS.md, minWidth: 200, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Tekrar Dene"
          >
            {/* FIX (audit ui-errorboundary): contrast-correct foreground (matches Button primitive). */}
            <Text style={{ color: getContrastColor(c.primary), fontWeight: '600' }}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={this.handleSignOut}
            style={{ marginTop: SPACING.md, paddingHorizontal: SPACING.xxl, paddingVertical: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, minWidth: 200, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Çıkış Yap"
          >
            <Text style={{ color: c.textSecondary, fontWeight: '500' }}>Çıkış Yap</Text>
          </TouchableOpacity>
        </View>
        {devDetails && (
          <ScrollView style={{ maxHeight: 200, backgroundColor: c.surface, padding: SPACING.md }}>
            <Text style={{ color: c.error, fontSize: FONT.xs, fontFamily: 'monospace' }}>
              {this.state.error?.message}
            </Text>
            {this.state.errorInfo && (
              <Text style={{ color: c.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: SPACING.sm }}>
                {this.state.errorInfo}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    );
  }
}
