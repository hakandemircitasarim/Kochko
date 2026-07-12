/**
 * Session Viewer — read-only view of a single chat session.
 * Opened from chat-history rows / search results (which previously dead-ended:
 * sessions could only be deleted, never read). No composer — history is immutable here.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

interface Msg {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

// Machine markers persisted alongside coach turns (plan proposals etc.) — never
// show them in the human-facing transcript (review fix ux-pass2).
function sanitizeTranscript(text: string): string {
  return text
    .replace(/<confirm_reject\s*\/?>/g, '')
    .replace(/<(actions|plan_snapshot|plan_finalize|reasoning|task_completion|simulation|quick_select|recipe|layer2_update|navigate_to|commitment|persona_detected)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

export default function SessionViewerScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || !sessionId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) {
      console.warn('session messages load failed', error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    // Read-only transcript: only the visible conversation (user + coach turns).
    setMessages(
      ((data ?? []) as Msg[])
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ ...m, content: sanitizeTranscript(m.content) }))
        .filter(m => m.content.length > 0),
    );
    setLoading(false);
  }, [user?.id, sessionId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' }}>Sohbet yüklenemedi</Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.lg, textAlign: 'center' }}>Bağlantını kontrol edip tekrar dene.</Text>
        <Button title="Tekrar dene" onPress={load} size="lg" />
      </View>
    );
  }

  // FlatList (review fix ux-pass2): a long legacy session is up to 500 bubbles —
  // a plain ScrollView mounted them all at once and stalled low-end devices.
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}
      data={messages}
      keyExtractor={m => m.id}
      initialNumToRender={20}
      ListHeaderComponent={
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginBottom: SPACING.md }}>
          Salt okunur kayıt — bu sohbete buradan mesaj yazılamaz.
        </Text>
      }
      ListEmptyComponent={
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>
            Bu oturumda mesaj yok.
          </Text>
        </Card>
      }
      renderItem={({ item: m }) => {
        const isUser = m.role === 'user';
        return (
          <View
            style={{
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              backgroundColor: isUser ? COLORS.primary : COLORS.card,
              borderRadius: RADIUS.lg,
              borderWidth: isUser ? 0 : 1,
              borderColor: COLORS.border,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm,
              marginBottom: SPACING.sm,
            }}
            accessibilityLabel={`${isUser ? 'Sen' : 'Kochko'}: ${m.content}`}
          >
            <Text style={{ color: isUser ? getContrastColor(COLORS.primary) : COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>
              {m.content}
            </Text>
            <Text
              style={{
                color: isUser ? getContrastColor(COLORS.primary) : COLORS.textMuted,
                opacity: isUser ? 0.7 : 1,
                fontSize: 10,
                marginTop: 4,
                textAlign: 'right',
              }}
            >
              {new Date(m.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        );
      }}
    />
  );
}
