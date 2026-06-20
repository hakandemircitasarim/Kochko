import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { trackEvent } from '@/services/analytics.service';
// FIX (audit ui-errorboundary): replace hand-rolled (drifted) hex colors with theme tokens.
// Class component can't call useTheme(); use DARK_COLORS directly (light theme is gated, so
// dark is the correct fallback even if the crash happens before ThemeProvider mounts).
import { DARK_COLORS as c } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';

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
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
            Bir şeyler ters gitti
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            Beklenmeyen bir hata oluştu. Tekrar deneyebilir ya da hesaptan çıkıp yeniden girebilirsin.
          </Text>
          <TouchableOpacity
            onPress={this.handleRetry}
            style={{ backgroundColor: c.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, minWidth: 200, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Tekrar Dene"
          >
            {/* FIX (audit ui-errorboundary): contrast-correct foreground (matches Button primitive). */}
            <Text style={{ color: getContrastColor(c.primary), fontWeight: '600' }}>Tekrar Dene</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={this.handleSignOut}
            style={{ marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, minWidth: 200, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="Çıkış Yap"
          >
            <Text style={{ color: c.textSecondary, fontWeight: '500' }}>Çıkış Yap</Text>
          </TouchableOpacity>
        </View>
        {devDetails && (
          <ScrollView style={{ maxHeight: 200, backgroundColor: c.surface, padding: 12 }}>
            <Text style={{ color: c.error, fontSize: 11, fontFamily: 'monospace' }}>
              {this.state.error?.message}
            </Text>
            {this.state.errorInfo && (
              <Text style={{ color: c.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: 8 }}>
                {this.state.errorInfo}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    );
  }
}
