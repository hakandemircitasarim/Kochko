/**
 * Chat History Search Screen
 * Spec 5.17: Sohbet geçmişi arama
 * - Date range + keyword + topic tag search
 * - Session-level listing
 * - Selective/bulk delete
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { getPlanSessionIds } from '@/services/chat.service';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

interface ChatSession {
  id: string;
  title: string | null;
  topic_tags: string[] | null;
  started_at: string;
  message_count: number;
}

interface SearchResult {
  id: string;
  content: string;
  role: string;
  created_at: string;
  session_id: string;
}

/** Parse DD.MM.YYYY to ISO date string (YYYY-MM-DD) */
function parseTurkishDate(input: string): string | null {
  const parts = input.trim().split('.');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year || year.length !== 4) return null;
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (isNaN(d) || isNaN(m) || isNaN(y) || d < 1 || d > 31 || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function ChatHistoryScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // FIX (audit empty-vs-error): distinguish "loading" and "fetch failed" from the confident
  // 'Henüz sohbet geçmişi yok' empty state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // FIX (audit search-0-results): without this flag, 0 results was indistinguishable from
  // "never searched" — the results card simply didn't render.
  const [hasSearched, setHasSearched] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      // FIX (final sweep): plan üretiminin görünmez makine oturumları (topic_tags
      // plan_diet/plan_workout) burada listeleniyor, "[PLAN_INIT] …" satırları kullanıcı
      // mesajı gibi görünüyordu — koç thread'inin kullandığı aynı oturum-seviyesi
      // dışlamayla süz.
      const planIds = await getPlanSessionIds(user.id);
      let q = supabase.from('chat_sessions').select('*').eq('user_id', user.id)
        .order('started_at', { ascending: false }).limit(20);
      if (planIds.length > 0) q = q.not('id', 'in', `(${planIds.join(',')})`);
      const { data, error } = await q;
      if (error) {
        console.warn('chat_sessions load failed', error);
        setLoadError(true);
      } else {
        setSessions((data ?? []) as ChatSession[]);
      }
    } catch (e) {
      console.warn('chat_sessions load failed', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // FIX (audit dead-end): rows previously had only onLongPress (delete) — a session could not
  // be OPENED at all. Route to the read-only session viewer.
  const openSession = (sessionId: string) => {
    router.push(`/settings/session-viewer?sessionId=${sessionId}` as never);
  };

  // Collect unique topic tags from all sessions
  const allTags = Array.from(
    new Set(sessions.flatMap(s => s.topic_tags ?? []))
  ).sort();

  // Filter sessions by selected tag
  const filteredSessions = selectedTag
    ? sessions.filter(s => s.topic_tags?.includes(selectedTag))
    : sessions;

  const handleSearch = async () => {
    if (!user?.id || (!searchQuery.trim() && !dateFrom && !dateTo)) return;
    setSearching(true);

    let query = supabase
      .from('chat_messages')
      .select('id, content, role, created_at, session_id')
      .eq('user_id', user.id);

    if (searchQuery.trim()) {
      query = query.ilike('content', `%${searchQuery.trim()}%`);
    }

    // Date range filters
    const isoFrom = dateFrom ? parseTurkishDate(dateFrom) : null;
    const isoTo = dateTo ? parseTurkishDate(dateTo) : null;
    if (isoFrom) {
      query = query.gte('created_at', `${isoFrom}T00:00:00`);
    }
    if (isoTo) {
      query = query.lte('created_at', `${isoTo}T23:59:59`);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(30);

    setSearching(false);
    // FIX (audit empty-vs-error): a failed search must not silently render as "no results".
    if (error) {
      console.warn('chat search failed', error);
      haptics.error();
      Alert.alert('Arama yapılamadı', 'Bir sorun oluştu, lütfen tekrar dene.');
      return;
    }
    setHasSearched(true);
    setSearchResults((data ?? []) as SearchResult[]);
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert(
      'Sohbet Sil',
      'Bu sohbet oturumunu silmek istediğine emin misin? Not: Koçun seni tanıma notları (Katman 2) silinmez, sadece sohbet kaydı kaldırılır.',
      [
        { text: 'İptal' },
        {
          text: 'Sil', style: 'destructive',
          onPress: async () => {
            // FIX (audit silent-delete): check the delete errors BEFORE wiping local state —
            // previously a failed delete still removed the row from the list (ghost data).
            const { error: msgError } = await supabase.from('chat_messages').delete().eq('session_id', sessionId);
            const { error: sessionError } = await supabase.from('chat_sessions').delete().eq('id', sessionId);
            if (msgError || sessionError) {
              console.warn('session delete failed', msgError ?? sessionError);
              haptics.error();
              Alert.alert('Silinemedi', 'Sohbet silinemedi, tekrar dene.');
              return;
            }
            haptics.success();
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            setSearchResults(prev => prev.filter(r => r.session_id !== sessionId));
          },
        },
      ]
    );
  };

  const handleClearAll = () => {
    Alert.alert(
      'Tüm Sohbetleri Sil',
      'Tüm sohbet geçmişin silinecek. Koçun seni tanıma notları (Katman 2) korunur. Bu işlemi geri alamazsın.',
      [
        { text: 'İptal' },
        {
          text: 'Hepsini Sil', style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            // FIX (audit silent-delete): verify both deletes succeeded before clearing the UI.
            const { error: msgError } = await supabase.from('chat_messages').delete().eq('user_id', user.id);
            const { error: sessionError } = await supabase.from('chat_sessions').delete().eq('user_id', user.id);
            if (msgError || sessionError) {
              console.warn('clear-all failed', msgError ?? sessionError);
              haptics.error();
              Alert.alert('Silinemedi', 'Sohbet geçmişi silinemedi, tekrar dene.');
              return;
            }
            haptics.success();
            setSessions([]);
            setSearchResults([]);
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {/* Search */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Ara... (yemek, spor, hedef...)" value={searchQuery} onChangeText={setSearchQuery} />
        </View>
        <Button title="Ara" size="sm" onPress={handleSearch} loading={searching} />
      </View>

      {/* Date range filters */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Başlangıç (GG.AA.YYYY)" value={dateFrom} onChangeText={setDateFrom} />
        </View>
        <View style={{ flex: 1 }}>
          <Input placeholder="Bitiş (GG.AA.YYYY)" value={dateTo} onChangeText={setDateTo} />
        </View>
      </View>

      {/* Topic tag chips */}
      {allTags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.md }} contentContainerStyle={{ gap: SPACING.xs }}>
          {allTags.map(tag => (
            <TouchableOpacity
              key={tag}
              onPress={() => setSelectedTag(prev => prev === tag ? null : tag)}
              accessibilityRole="button"
              accessibilityLabel={`Konu: ${tag}`}
              accessibilityState={{ selected: selectedTag === tag }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{
                paddingVertical: 4,
                paddingHorizontal: SPACING.sm,
                borderRadius: 12,
                backgroundColor: selectedTag === tag ? COLORS.primary : COLORS.surfaceLight,
                borderWidth: 1,
                borderColor: selectedTag === tag ? COLORS.primary : COLORS.border,
              }}
            >
              {/* FIX (audit accent-contrast): selected chip text via getContrastColor instead of hardcoded #fff. */}
              <Text style={{ color: selectedTag === tag ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.xs }}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Search Results — rows are tappable and open the containing session. */}
      {searchResults.length > 0 && (
        <Card title={`Sonuçlar (${searchResults.length})`}>
          {searchResults.map(r => (
            <TouchableOpacity
              key={r.id}
              onPress={() => { haptics.tap(); openSession(r.session_id); }}
              accessibilityRole="button"
              accessibilityLabel="Sonucun bulunduğu sohbeti aç"
              style={{ paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ color: r.role === 'user' ? COLORS.primary : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
                  {r.role === 'user' ? 'Sen' : 'Kochko'}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                  {new Date(r.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }} numberOfLines={3}>{r.content}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {/* FIX (audit search-0-results): explicit 'Sonuç bulunamadı' card after a real search. */}
      {hasSearched && !searching && searchResults.length === 0 && (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>
            Sonuç bulunamadı. Farklı bir kelime veya tarih aralığı dene.
          </Text>
        </Card>
      )}

      {/* Session List */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.md, marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>Sohbet Oturumları</Text>
        {filteredSessions.length > 0 && <Button title="Hepsini Sil" variant="ghost" size="sm" onPress={handleClearAll} />}
      </View>

      {/* FIX (audit empty-vs-error): loading and fetch-error render their own states — the
          'Henüz sohbet geçmişi yok' copy only appears when the fetch genuinely returned 0 rows. */}
      {loading ? (
        // FIX (ux-polish): session-shaped skeletons instead of a bare spinner that jumps to a list.
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : loadError ? (
        <Card>
          <LoadErrorState embedded title="Sohbet geçmişi yüklenemedi" onRetry={loadSessions} />
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Henüz sohbet geçmişi yok.</Text></Card>
      ) : (
        filteredSessions.map(s => (
          <TouchableOpacity
            key={s.id}
            onPress={() => { haptics.tap(); openSession(s.id); }}
            onLongPress={() => handleDeleteSession(s.id)}
            accessibilityRole="button"
            accessibilityLabel={`${s.title ?? new Date(s.started_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}, ${s.message_count} mesaj — açmak için dokun, silmek için uzun bas`}
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '500' }}>
                    {s.title ?? new Date(s.started_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
                    {s.message_count} mesaj
                    {s.topic_tags && s.topic_tags.length > 0 ? ` | ${s.topic_tags.join(', ')}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                    {new Date(s.started_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Dokun: sohbeti aç · Uzun bas: sohbeti sil</Text>
      {/* Spec note: Sohbet silme Katman 2'yi etkilemez */}
    </ScrollView>
  );
}
