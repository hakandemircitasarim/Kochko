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
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import {
  sendMessage,
  loadChatHistory,
  type ChatMessage,
} from '@/services/chat.service';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function ChatScreen() {
  const user = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    async function load() {
      const { data } = await loadChatHistory();
      setMessages(data);
      setLoading(false);
    }
    load();
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    // Optimistic: add user message immediately
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Scroll to bottom
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    const { data, error } = await sendMessage(text);

    if (data) {
      const assistantMsg: ChatMessage = {
        id: `temp-${Date.now()}-reply`,
        role: 'assistant',
        content: data.message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Show action feedback if any
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
        content: 'Bir hata oluştu. Tekrar dene.',
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
            Ben Kochko, yaşam tarzı koçun. Benimle her şeyi paylaşabilirsin -
            ne yediğini, nasıl hissettiğini, hedeflerini, sorularını.
          </Text>
          <Text style={styles.emptyText}>
            Her konuşmamızdan seni daha iyi tanıyorum. Ne kadar çok
            paylaşırsan, o kadar iyi yardımcı olurum.
          </Text>
          <View style={styles.suggestions}>
            <SuggestionChip text="Kendimi tanıtmak istiyorum" onPress={setInput} />
            <SuggestionChip text="Bugün kahvaltıda 2 yumurta yedim" onPress={setInput} />
            <SuggestionChip text="Kilo vermek istiyorum, nereden başlamalıyım?" onPress={setInput} />
            <SuggestionChip text="Evde yapabileceğim bir antrenman öner" onPress={setInput} />
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

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          placeholder="Mesajını yaz..."
          placeholderTextColor={COLORS.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
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
          hour: '2-digit',
          minute: '2-digit',
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
    weight_log: 'Tartı kaydedildi',
    water_log: 'Su kaydedildi',
    mood_note: 'Not kaydedildi',
  };
  return actions.map((a) => `[${labels[a.type] ?? a.type}]`).join(' ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', padding: SPACING.lg },
  emptyTitle: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md },
  emptyText: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, lineHeight: 24, marginBottom: SPACING.sm },
  suggestions: { marginTop: SPACING.lg, gap: SPACING.sm },
  suggestion: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestionText: { color: COLORS.primary, fontSize: FONT_SIZE.sm },

  // Messages
  messageList: { padding: SPACING.md, paddingBottom: SPACING.sm },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  userBubble: {
    backgroundColor: COLORS.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: COLORS.card,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  coachLabel: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    marginBottom: 4,
  },
  bubbleText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
  },
  userBubbleText: {
    color: '#fff',
  },
  timestamp: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: SPACING.sm,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
    gap: SPACING.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
});
