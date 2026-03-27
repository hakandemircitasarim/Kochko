import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import {
  sendMessage,
  sendMessageWithPhoto,
  loadChatHistory,
  type ChatMessage,
} from '@/services/chat.service';
import { supabase } from '@/lib/supabase';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function ChatScreen() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    async function load() {
      const { data } = await loadChatHistory();

      // If no chat history and onboarding not completed, send intro
      if (data.length === 0 && profile && !profile.onboarding_completed) {
        setMessages([{
          id: 'onboarding-intro',
          role: 'assistant',
          content: 'Merhaba! Ben Kochko, yasam tarzi kocun. Seni tanimak istiyorum.\n\nBiraz kendinden bahseder misin? Kac yasindasin, boyun kilon ne, ne is yapiyorsun? Beslenme veya sporla ilgili hedeflerin var mi?\n\nIstedigin kadar detay ver - ne kadar cok paylasirsan sana o kadar iyi yardimci olurum.',
          created_at: new Date().toISOString(),
        }]);
        setLoading(false);
        return;
      }

      setMessages(data);
      setLoading(false);
    }
    load();
  }, [profile]);

  // Handle prefill from Today screen
  useEffect(() => {
    if (prefill && !loading) {
      setInput(prefill);
    }
  }, [prefill, loading]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !selectedImage) || sending) return;

    const displayText = selectedImage
      ? text ? `[Foto] ${text}` : '[Foto gonderildi]'
      : text;

    // Optimistic: add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: displayText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    const imageUri = selectedImage;
    setSelectedImage(null);
    setSending(true);

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    let response;
    if (imageUri) {
      response = await sendMessageWithPhoto(text || 'Bu fotodaki yemekleri analiz et.', imageUri);
    } else {
      response = await sendMessage(text);
    }

    const { data, error } = response;

    if (data) {
      const assistantMsg: ChatMessage = {
        id: `temp-${Date.now()}-reply`,
        role: 'assistant',
        content: data.message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (data.actions.length > 0) {
        const actionMsg: ChatMessage = {
          id: `temp-${Date.now()}-action`,
          role: 'assistant',
          content: formatActions(data.actions),
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, actionMsg]);
      }
    } else if (error) {
      const errorMsg: ChatMessage = {
        id: `temp-${Date.now()}-error`,
        role: 'assistant',
        content: 'Bir hata olustu. Tekrar dene.',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }

    setSending(false);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Merhaba!</Text>
          <Text style={styles.emptyText}>
            Ben Kochko, yasam tarzi kocun. Benimle her seyi paylasabilirsin -
            ne yedigini, nasil hissettigini, hedeflerini, sorularini.
          </Text>
          <Text style={styles.emptyText}>
            Foto da atabilirsin - yemeginin fotosunu cek, ben analiz edeyim.
          </Text>
          <View style={styles.suggestions}>
            <SuggestionChip text="Kendimi tanitmak istiyorum" onPress={setInput} />
            <SuggestionChip text="Bugun kahvaltida 2 yumurta yedim" onPress={setInput} />
            <SuggestionChip text="Kilo vermek istiyorum, nereden baslamaliyim?" onPress={setInput} />
            <SuggestionChip text="Evde yapabilecegim bir antrenman oner" onPress={setInput} />
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      {/* Selected Image Preview */}
      {selectedImage && (
        <View style={styles.imagePreview}>
          <Image source={{ uri: selectedImage }} style={styles.previewImage} />
          <TouchableOpacity style={styles.removeImage} onPress={() => setSelectedImage(null)}>
            <Text style={styles.removeImageText}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
          <Text style={styles.photoBtnText}>O</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoBtn} onPress={pickImage}>
          <Text style={styles.photoBtnText}>+</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          placeholder="Mesajini yaz..."
          placeholderTextColor={COLORS.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, ((!input.trim() && !selectedImage) || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={(!input.trim() && !selectedImage) || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>{'>'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      {!isUser && <Text style={styles.coachLabel}>Kochko</Text>}
      <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
        {message.content}
      </Text>
      <Text style={styles.timestamp}>
        {new Date(message.created_at).toLocaleTimeString('tr-TR', {
          hour: '2-digit', minute: '2-digit',
        })}
      </Text>
    </View>
  );
}

function SuggestionChip({ text, onPress }: { text: string; onPress: (t: string) => void }) {
  return (
    <TouchableOpacity style={styles.suggestion} onPress={() => onPress(text)}>
      <Text style={styles.suggestionText}>{text}</Text>
    </TouchableOpacity>
  );
}

function formatActions(actions: { type: string; [key: string]: unknown }[]): string {
  const labels: Record<string, string> = {
    meal_log: 'Ogun kaydedildi',
    workout_log: 'Antrenman kaydedildi',
    weight_log: 'Tarti kaydedildi',
    water_log: 'Su kaydedildi',
    mood_note: 'Not kaydedildi',
  };
  return actions.map((a) => `[${labels[a.type] ?? a.type}]`).join(' ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },

  emptyState: { flex: 1, justifyContent: 'center', padding: SPACING.lg },
  emptyTitle: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md },
  emptyText: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, lineHeight: 24, marginBottom: SPACING.sm },
  suggestions: { marginTop: SPACING.lg, gap: SPACING.sm },
  suggestion: {
    backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  suggestionText: { color: COLORS.primary, fontSize: FONT_SIZE.sm },

  messageList: { padding: SPACING.md, paddingBottom: SPACING.sm },
  bubble: { maxWidth: '82%', borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.sm },
  userBubble: { backgroundColor: COLORS.primary, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  assistantBubble: {
    backgroundColor: COLORS.card, alignSelf: 'flex-start', borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  coachLabel: { color: COLORS.primary, fontSize: FONT_SIZE.xs, fontWeight: '700', marginBottom: 4 },
  bubbleText: { color: COLORS.text, fontSize: FONT_SIZE.md, lineHeight: 22 },
  userBubbleText: { color: '#fff' },
  timestamp: { color: COLORS.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },

  imagePreview: {
    padding: SPACING.sm, flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  previewImage: { width: 60, height: 60, borderRadius: 8 },
  removeImage: {
    marginLeft: SPACING.sm, width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center',
  },
  removeImageText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: SPACING.sm,
    paddingBottom: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface, gap: SPACING.xs,
  },
  photoBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.inputBg,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  photoBtnText: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '700' },
  textInput: {
    flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 20,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
    color: COLORS.text, fontSize: FONT_SIZE.md, maxHeight: 120,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: FONT_SIZE.lg, fontWeight: '700' },
});
