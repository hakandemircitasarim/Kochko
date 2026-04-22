/**
 * Chat History Search Screen
 * Spec 5.17: Sohbet geçmişi arama
 * - Date range + keyword + topic tag search
 * - Session-level listing
 * - Selective/bulk delete
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('chat_sessions').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(20)
      .then(({ data }) => setSessions((data ?? []) as ChatSession[]));
  }, [user?.id]);

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

    const { data } = await query
      .order('created_at', { ascending: false })
      .limit(30);

    setSearchResults((data ?? []) as SearchResult[]);
    setSearching(false);
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
            await supabase.from('chat_messages').delete().eq('session_id', sessionId);
            await supabase.from('chat_sessions').delete().eq('id', sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
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
            await supabase.from('chat_messages').delete().eq('user_id', user.id);
            await supabase.from('chat_sessions').delete().eq('user_id', user.id);
            setSessions([]);
            setSearchResults([]);
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Sohbet Geçmişi</Text>

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
              style={{
                paddingVertical: 4,
                paddingHorizontal: SPACING.sm,
                borderRadius: 12,
                backgroundColor: selectedTag === tag ? COLORS.primary : COLORS.surfaceLight,
                borderWidth: 1,
                borderColor: selectedTag === tag ? COLORS.primary : COLORS.border,
              }}
            >
              <Text style={{ color: selectedTag === tag ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card title={`Sonuçlar (${searchResults.length})`}>
          {searchResults.map(r => (
            <View key={r.id} style={{ paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ color: r.role === 'user' ? COLORS.primary : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
                  {r.role === 'user' ? 'Sen' : 'Kochko'}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                  {new Date(r.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }} numberOfLines={3}>{r.content}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Session List */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.md, marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>Sohbet Oturumları</Text>
        {filteredSessions.length > 0 && <Button title="Hepsini Sil" variant="ghost" size="sm" onPress={handleClearAll} />}
      </View>

      {filteredSessions.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Henüz sohbet geçmişi yok.</Text></Card>
      ) : (
        filteredSessions.map(s => (
          <TouchableOpacity key={s.id} onLongPress={() => handleDeleteSession(s.id)}>
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
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                  {new Date(s.started_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Uzun bas: sohbet oturumunu sil</Text>
      {/* Spec note: Sohbet silme Katman 2'yi etkilemez */}
    </ScrollView>
  );
}
