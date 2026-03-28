/**
 * Chat History Search Screen
 * Spec 5.17: Sohbet geçmişi arama
 * - Date range + keyword + topic tag search
 * - Session-level listing
 * - Selective/bulk delete
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
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

export default function ChatHistoryScreen() {
  const user = useAuthStore(s => s.user);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('chat_sessions').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(20)
      .then(({ data }) => setSessions((data ?? []) as ChatSession[]));
  }, [user?.id]);

  const handleSearch = async () => {
    if (!user?.id || !searchQuery.trim()) return;
    setSearching(true);

    const { data } = await supabase
      .from('chat_messages')
      .select('id, content, role, created_at, session_id')
      .eq('user_id', user.id)
      .ilike('content', `%${searchQuery.trim()}%`)
      .order('created_at', { ascending: false })
      .limit(30);

    setSearchResults((data ?? []) as SearchResult[]);
    setSearching(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert(
      'Sohbet Sil',
      'Bu sohbet oturumunu silmek istediginize emin misiniz? Not: Kocun seni tanima notlari (Katman 2) silinmez, sadece sohbet kaydi kaldirilir.',
      [
        { text: 'Iptal' },
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
      'Tum Sohbetleri Sil',
      'Tum sohbet gecmisiniz silinecek. Kocun seni tanima notlari (Katman 2) korunur. Bu islemi geri alamazsiniz.',
      [
        { text: 'Iptal' },
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
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Sohbet Gecmisi</Text>

      {/* Search */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Ara... (yemek, spor, hedef...)" value={searchQuery} onChangeText={setSearchQuery} />
        </View>
        <Button title="Ara" size="sm" onPress={handleSearch} loading={searching} />
      </View>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card title={`Sonuclar (${searchResults.length})`}>
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
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>Sohbet Oturumlari</Text>
        {sessions.length > 0 && <Button title="Hepsini Sil" variant="ghost" size="sm" onPress={handleClearAll} />}
      </View>

      {sessions.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Henuz sohbet gecmisi yok.</Text></Card>
      ) : (
        sessions.map(s => (
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
    </ScrollView>
  );
}
