/**
 * Kochko Session List — the chat tab's main screen
 * Shows onboarding task cards + session list
 * Handles prefill param by auto-creating session and redirecting
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import {
  loadSessions, createSession, deleteSession, closeSession,
  type ChatSessionSummary,
} from '@/services/chat.service';
import { getIncompleteTasks, getOnboardingProgress, type OnboardingTask } from '@/services/onboarding-tasks.service';
import { OnboardingTaskCard } from '@/components/chat/OnboardingTaskCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

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
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { prefill, openCamera } = useLocalSearchParams<{ prefill?: string; openCamera?: string }>();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefillHandled, setPrefillHandled] = useState(false);

  // Handle prefill redirect — reuse the active session if one exists, else create.
  useEffect(() => {
    // Wait for sessions to load so the active-session lookup isn't racing an empty
    // initial sessions=[] (otherwise we'd always create a cold new chat).
    if (!(prefill || openCamera) || prefillHandled || loading) return;
    setPrefillHandled(true);
    const active = sessions.find(s => s.is_active);
    if (active) {
      // A dashboard nudge / quick-log should continue the ongoing conversation and
      // its Layer-4 thread, not abandon it for a fresh empty chat (#R3-11/#3).
      // FIX (audit: prefill geri-tuş) — replace ile gelindiğini işaretle ki
      // chat detay geri tuşu listeye dönebilsin (yığından çıkıldığından back yetmez).
      const params: Record<string, string> = { fromPrefill: '1' };
      if (prefill) params.prefill = prefill;
      if (openCamera) params.openCamera = openCamera;
      router.replace({ pathname: `/chat/${active.id}`, params });
      return;
    }
    {
      createSession().then(id => {
        if (id) {
          // FIX (audit: prefill geri-tuş) — replace işaretini new-session yoluna da ekle
          const params: Record<string, string> = { fromPrefill: '1' };
          if (prefill) params.prefill = prefill;
          if (openCamera) params.openCamera = openCamera;
          router.replace({ pathname: `/chat/${id}`, params });
        } else {
          // createSession returned null — surface to user so they aren't stuck on empty view
          Alert.alert(
            'Sohbet başlatılamadı',
            'İnternet bağlantını kontrol et ve tekrar dene.',
            [{ text: 'Tamam', onPress: () => setPrefillHandled(false) }],
          );
        }
      }).catch((err) => {
        // FIX (audit: ham hata sızıntısı) — ham/İngilizce err.message'ı kullanıcıya
        // basma; sabit Türkçe metin göster, orijinali yalnız konsola yaz.
        console.warn('Chat session creation failed:', err);
        Alert.alert(
          'Sohbet başlatılamadı',
          'Bir sorun oluştu, lütfen tekrar dene.',
          [{ text: 'Tamam', onPress: () => setPrefillHandled(false) }],
        );
      });
    }
  }, [prefill, openCamera, prefillHandled, loading, sessions]);

  const fetchSessions = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);

    // Load sessions — tasks may fail if migration not run yet, that's ok
    let incompleteTasks: OnboardingTask[] = [];
    try {
      const [t, p] = await Promise.all([getIncompleteTasks(user.id), getOnboardingProgress(user.id)]);
      incompleteTasks = t;
      setProgress(p);
    } catch (err) {
      console.warn('[chat] onboarding tasks load failed (migration may be pending):', err);
    }
    setTasks(incompleteTasks);

    const data = await loadSessions();

    // Auto-close stale sessions (>24h inactive, use updated_at or started_at as fallback)
    const now = Date.now();
    for (const s of data) {
      if (s.is_active) {
        const lastActivity = new Date(s.updated_at ?? s.started_at).getTime();
        if (now - lastActivity > 24 * 60 * 60 * 1000) {
          await closeSession(s.id).catch((err) => console.warn('Auto-close session failed:', err));
          s.is_active = false;
          s.ended_at = new Date().toISOString();
        }
      }
    }

    setSessions(data);
    setLoading(false);
  }, [user?.id]);

  // Refresh on focus (coming back from session detail)
  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchSessions();
    }, [user?.id, fetchSessions])
  );

  const handleNewSession = async () => {
    const id = await createSession();
    if (id) {
      router.push(`/chat/${id}`);
    } else {
      Alert.alert('Sohbet başlatılamadı', 'İnternet bağlantını kontrol et ve tekrar dene.');
    }
  };

  const handleTaskPress = async (task: OnboardingTask) => {
    // FIX (audit: çoğalan yarım oturumlar) — koşulsuz createSession yerine, bu
    // göreve ait açık oturum varsa onu yeniden kullan (prefill akışıyla simetri).
    const existing = sessions.find(s => s.is_active && s.topic_tags?.includes(task.key));
    if (existing) {
      router.push({
        pathname: `/chat/${existing.id}`,
        params: { prefill: task.prefillMessage, taskModeHint: task.taskModeHint },
      });
      return;
    }
    const id = await createSession({ title: task.title, topicTags: [task.key] });
    if (id) {
      router.push({
        pathname: `/chat/${id}`,
        params: { prefill: task.prefillMessage, taskModeHint: task.taskModeHint },
      });
    } else {
      Alert.alert('Sohbet başlatılamadı', 'İnternet bağlantını kontrol et ve tekrar dene.');
    }
  };

  const handleDeleteSession = (session: ChatSessionSummary) => {
    // Tactile cue so the long-press / delete affordance registers before the Alert.
    haptics.tap();
    Alert.alert(
      'Sohbeti sil',
      'Bu sohbet ve tüm mesajları silinecek. Emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            try {
              await deleteSession(session.id);
              setSessions(prev => prev.filter(s => s.id !== session.id));
              haptics.success();
            } catch (err) {
              console.warn('Delete session failed:', err);
              haptics.error();
              Alert.alert('Silinemedi', 'Sohbet silinirken bir sorun oluştu. Tekrar dene.');
            }
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
      <ScreenHeader
        title="Kochko"
        subtitle={sessions.filter(s => s.is_active).length > 0 ? 'Aktif sohbetin var' : 'Yeni bir sohbet başlat'}
        statusColor={sessions.filter(s => s.is_active).length > 0 ? colors.primary : undefined}
        left={
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: colors.primary + '22',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.primary + '44',
            }}
          >
            <Ionicons name="sparkles" size={17} color={colors.primary} />
          </View>
        }
        right={
          <TouchableOpacity
            onPress={handleNewSession}
            accessibilityRole="button"
            accessibilityLabel="Yeni sohbet"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
            }}
          >
            {/* FIX (audit: iki '+' aynı görsel dil) — chat yeni-sohbet ikonu
                'add' → 'create-outline'; merkezi tab FAB '+' kalır, görsel ayrım sağlanır */}
            <Ionicons name="create-outline" size={22} color={getContrastColor(colors.primary)} />
          </TouchableOpacity>
        }
      />

      {/* Profilini tamamla — onboarding progress + task cards. Rendered ABOVE the
          list/empty-state so the cards show even when there are no sessions yet
          (note #6), and the progress bar tells the user how far along they are
          instead of an open-ended list (note #4). */}
      {tasks.length > 0 && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Profilini tamamla
            </Text>
            {progress && (
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
                {progress.completed}/{progress.total} konu
              </Text>
            )}
          </View>
          {progress && progress.total > 0 && (
            <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', marginBottom: SPACING.md }}>
              <View style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 3 }} />
            </View>
          )}
          <FlatList
            data={tasks}
            keyExtractor={t => t.key}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.sm }}
            renderItem={({ item }) => <OnboardingTaskCard task={item} onPress={handleTaskPress} />}
          />
        </View>
      )}

      {/* Session list */}
      {sessions.length === 0 && !loading ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="Kochko ile tanış"
          subtitle="Beslenme, antrenman, uyku — her konuda sana yardımcı olabilirim."
          ctaLabel="İlk sohbetine başla"
          onPressCta={handleNewSession}
        />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={s => s.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchSessions} tintColor={colors.primary} />}
          contentContainerStyle={{ paddingHorizontal: SPACING.xl, paddingBottom: 100 + insets.bottom }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => handleDeleteSession(item)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${item.title || 'Yeni sohbet'} sohbeti`}
              accessibilityHint="Açmak için dokun, silmek için basılı tut"
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
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '500' }} numberOfLines={1}>
                  {item.title || 'Yeni sohbet'}
                </Text>
                {item.last_message && (
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 3 }} numberOfLines={1}>
                    {item.last_message}
                  </Text>
                )}
              </View>

              {/* Date + count */}
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                  {formatRelativeDate(item.started_at)}
                </Text>
                {item.message_count > 0 && (
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                    {item.message_count} mesaj
                  </Text>
                )}
              </View>

              {/* Visible delete affordance (long-press still works as a shortcut) */}
              <TouchableOpacity
                onPress={() => handleDeleteSession(item)}
                accessibilityRole="button"
                accessibilityLabel="Sohbeti sil"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ padding: SPACING.xs, marginRight: -SPACING.xs }}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
