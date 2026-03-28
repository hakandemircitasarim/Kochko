import { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { sendMessage, sendMessageWithPhoto, loadChatHistory, type ChatMessage, type ChatResponse } from '@/services/chat.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    loadChatHistory().then(data => { setMessages(data); setLoading(false); });
  }, []);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !photo) || sending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: photo ? `[Foto] ${text}` : text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const img = photo;
    setPhoto(null);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    const { data } = img
      ? await sendMessageWithPhoto(text || 'Bu yemegi analiz et.', img)
      : await sendMessage(text);

    if (data) {
      const reply: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: data.message, task_mode: data.task_mode, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, reply]);

      const executed = data.actions.filter(a => a.feedback);
      if (executed.length > 0) {
        const fb: ChatMessage = { id: `f-${Date.now()}`, role: 'assistant', content: executed.map(a => `[${a.feedback}]`).join(' '), created_at: new Date().toISOString() };
        setMessages(prev => [...prev, fb]);
      }
    } else {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: 'Baglanti hatasi. Tekrar dene.', created_at: new Date().toISOString() }]);
    }

    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: SPACING.lg }}>
          <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Merhaba!</Text>
          <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, lineHeight: 24, marginBottom: SPACING.sm }}>Ben Kochko, yasam tarzi kocun. Seni tanimak istiyorum - biraz kendinden bahset!</Text>
          <View style={{ marginTop: SPACING.lg, gap: SPACING.sm }}>
            {['Kendimi tanitmak istiyorum', '2 yumurta 1 ekmek yedim', 'Kilo vermek istiyorum', 'Evde antrenman oner'].map((s, i) => (
              <TouchableOpacity key={i} style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }} onPress={() => setInput(s)}>
                <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList ref={listRef} data={messages} keyExtractor={m => m.id}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View style={{ maxWidth: '82%', borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.sm, alignSelf: isUser ? 'flex-end' : 'flex-start', backgroundColor: isUser ? COLORS.primary : COLORS.card, borderWidth: isUser ? 0 : 1, borderColor: COLORS.border, borderBottomRightRadius: isUser ? 4 : 16, borderBottomLeftRadius: isUser ? 16 : 4 }}>
                {!isUser && <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', marginBottom: 4 }}>Kochko</Text>}
                <Text style={{ color: isUser ? '#fff' : COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{item.content}</Text>
              </View>
            );
          }}
          contentContainerStyle={{ padding: SPACING.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {photo && (
        <View style={{ padding: SPACING.sm, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <Image source={{ uri: photo }} style={{ width: 60, height: 60, borderRadius: 8 }} />
          <TouchableOpacity onPress={() => setPhoto(null)} style={{ marginLeft: SPACING.sm, width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: SPACING.sm, paddingBottom: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface, gap: SPACING.xs }}>
        <TouchableOpacity onPress={takePhoto} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.inputBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>O</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={pickImage} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.inputBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>+</Text>
        </TouchableOpacity>
        <TextInput style={{ flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 20, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2, color: COLORS.text, fontSize: FONT.md, maxHeight: 120, borderWidth: 1, borderColor: COLORS.border }}
          placeholder="Mesajini yaz..." placeholderTextColor={COLORS.textMuted} value={input} onChangeText={setInput} multiline editable={!sending} />
        <TouchableOpacity style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', opacity: (!input.trim() && !photo) || sending ? 0.4 : 1 }}
          onPress={handleSend} disabled={(!input.trim() && !photo) || sending}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: FONT.lg, fontWeight: '700' }}>{'>'}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
