/**
 * Kochko Session List — the chat tab's main screen
 * Shows onboarding task cards + session list
 * Handles prefill param by auto-creating session and redirecting
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert, Platform } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import {
  loadSessions, createSession, deleteSession, closeSession,
  type ChatSessionSummary,
} from '@/services/chat.service';
import { getIncompleteTasks, type OnboardingTask } from '@/services/onboarding-tasks.service';
import { OnboardingTaskCard } from '@/components/chat/OnboardingTaskCard';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Şimdi';
  if (diffMin < 60) return `${diffMin} dk önce`;
  if (diffHours < 24) return `${diffHours} sa önce`;
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) return `${diffDays} gün önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export default function SessionListScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const { prefill, openCamera } = useLocalSearchParams<{ prefill?: string; openCamera?: string }>();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefillHandled, setPrefillHandled] = useState(false);

  // Handle prefill redirect — auto-create session and navigate
  useEffect(() => {
    if ((prefill || openCamera) && !prefillHandled) {
      setPrefillHandled(true);
      createSession().then(id => {
        if (id) {
          const params: Record<string, string> = {};
          if (prefill) params.prefill = prefill;
          if (openCamera) params.openCamera = openCamera;
          router.replace({ pathname: `/chat/${id}`, params });
        }
      });
    }
  }, [prefill, openCamera, prefillHandled]);

  const fetchSessions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [data, incompleteTasks] = await Promise.all([
      loadSessions(),
      getIncompleteTasks(user.id),
    ]);
    setTasks(incompleteTasks);

    // Auto-close stale sessions (>24h inactive)
    const now = Date.now();
    for (const s of data) {
      if (s.is_active && s.started_at) {
        const lastActivity = new Date(s.started_at).getTime();
        if (now - lastActivity > 24 * 60 * 60 * 1000 && !s.last_message) {
          await closeSession(s.id);
          s.is_active = false;
          s.ended_at = new Date().toISOString();
        }
      }
    }

    setSessions(data);
    setLoading(false);
  }, []);

  // Refresh on focus (coming back from session detail)
  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchSessions();
    }, [user?.id, fetchSessions])
  );

  const handleNewSession = async () => {
    const id = await createSession();
    if (id) router.push(`/chat/${id}`);
  };

  const handleTaskPress = async (task: OnboardingTask) => {
    const id = await createSession({ title: task.title, topicTags: [task.key] });
    if (id) {
      router.push({
        pathname: `/chat/${id}`,
        params: { prefill: task.prefillMessage, taskModeHint: task.taskModeHint },
      });
    }
  };

  const handleDeleteSession = (session: ChatSessionSummary) => {
    Alert.alert(
      'Sohbeti sil',
      'Bu sohbet ve tüm mesajları silinecek. Emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            await deleteSession(session.id);
            setSessions(prev => prev.filter(s => s.id !== session.id));
          },
        },
      ]
    );
  };

  // If prefill redirect is happening, show nothing
  if ((prefill || openCamera) && !sessions.length) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: SPACING.xl, paddingTop: Platform.OS === 'web' ? 16 : 60, paddingBottom: SPACING.md,
      }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Kochko</Text>
        <TouchableOpacity
          onPress={handleNewSession}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Session list */}
      {sessions.length === 0 && !loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: colors.primary + '18',
            alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xxl,
          }}>
            <Ionicons name="chatbubble-ellipses" size={32} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: SPACING.sm }}>
            Kochko ile tanış
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: SPACING.xxl, lineHeight: 20 }}>
            Beslenme, antrenman, uyku — her konuda{'\n'}sana yardımcı olabilirim.
          </Text>
          <TouchableOpacity
            onPress={handleNewSession}
            style={{
              backgroundColor: colors.primary, borderRadius: RADIUS.sm,
              paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>İlk sohbetine başla</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={s => s.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchSessions} tintColor={colors.primary} />}
          contentContainerStyle={{ paddingHorizontal: SPACING.xl, paddingBottom: 100 }}
          ListHeaderComponent={tasks.length > 0 ? (
            <View style={{ marginBottom: SPACING.xxl }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
                Yapılacaklar
              </Text>
              <FlatList
                data={tasks}
                keyExtractor={t => t.key}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: SPACING.sm }}
                renderItem={({ item }) => <OnboardingTaskCard task={item} onPress={handleTaskPress} />}
              />
            </View>
          ) : null}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => handleDeleteSession(item)}
              activeOpacity={0.7}
              style={{
                backgroundColor: colors.card,
                borderRadius: RADIUS.md,
                padding: SPACING.lg,
                marginBottom: SPACING.sm,
                borderWidth: 0.5,
                borderColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.md,
              }}
            >
              {/* Active indicator */}
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: item.is_active ? colors.primary : colors.textMuted,
                opacity: item.is_active ? 1 : 0.3,
              }} />

              {/* Content */}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>
                  {item.title || 'Yeni sohbet'}
                </Text>
                {item.last_message && (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                    {item.last_message}
                  </Text>
                )}
              </View>

              {/* Date + chevron */}
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {formatRelativeDate(item.started_at)}
                </Text>
                {item.message_count > 0 && (
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                    {item.message_count} mesaj
                  </Text>
                )}
              </View>

              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
