/**
 * CHAT SCREEN - The heart of Kochko
 * Spec 5.1-5.33: AI sohbet, the primary interaction point.
 *
 * Integrates:
 * - Text + photo messaging
 * - ActionFeedback (inline action confirmations)
 * - FeedbackButtons (ise yaradi / bana gore degil)
 * - Onboarding awareness (new user intro)
 * - Dashboard refresh after actions
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useAuthStore } from '@/stores/auth.store';
import {
  sendMessage, sendMessageWithPhoto, loadChatHistory,
  type ChatMessage, type ChatResponse,
} from '@/services/chat.service';
import { lookupBarcode, calculateServing } from '@/services/barcode.service';
import { ActionFeedback } from '@/components/chat/ActionFeedback';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';
import { COLORS, SPACING, FONT } from '@/lib/constants';

// Extended message type for UI state
interface UIMessage extends ChatMessage {
  actions?: { type: string; feedback: string | null }[];
  showFeedback?: boolean; // show ise yaradi / bana gore degil
}

export default function ChatScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const refreshDashboard = useDashboardStore(s => s.fetchToday);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const listRef = useRef<FlatList>(null);

  const isOnboarding = profile && !profile.onboarding_completed;

  // Barcode scan handler (T2.12-T2.13)
  const handleBarcodeScan = async (barcode: string) => {
    setShowBarcodeScanner(false);
    setSending(true);
    const result = await lookupBarcode(barcode);
    if (result.found) {
      const serving = calculateServing(result, result.serving_size_g ?? 100);
      const msg = `Barkod: ${result.product_name} (${result.brand ?? ''}) - ${serving?.calories ?? '?'} kcal, ${serving?.protein_g ?? '?'}g protein (100g bazinda)`;
      setInput(msg);
    } else {
      setInput(`Barkod ${barcode} bulunamadi. Bu urunu metin olarak girebilirsin.`);
    }
    setSending(false);
  };

  const openBarcodeScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setShowBarcodeScanner(true);
  };

  // Load chat history
  useEffect(() => {
    loadChatHistory().then(data => {
      if (data.length === 0 && isOnboarding) {
        setMessages([{
          id: 'onboard-intro',
          role: 'assistant',
          content: 'Merhaba! Ben Kochko, yasam tarzi kocun.\n\nSeni tanimak istiyorum - biraz kendinden bahseder misin? Kac yasindasin, boyun ve kilon ne kadar? Beslenme veya sporla ilgili hedeflerin var mi?',
          created_at: new Date().toISOString(),
        }]);
      } else {
        setMessages(data.map(m => ({ ...m })));
      }
      setLoading(false);
    });
  }, [isOnboarding]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
  }, []);

  // Image pickers
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

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !photo) || sending) return;

    // Add user message optimistically
    const userMsg: UIMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: photo ? (text ? `[Foto] ${text}` : '[Foto gonderildi]') : text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const img = photo;
    setPhoto(null);
    setSending(true);
    scrollToBottom();

    // Call AI
    const { data, error } = img
      ? await sendMessageWithPhoto(text || 'Bu yemegi analiz et.', img)
      : await sendMessage(text);

    if (data) {
      // Determine if this message type should show feedback buttons
      // Show feedback for: plan suggestions, coaching advice, recipes (not for simple confirmations)
      const showFeedback = data.task_mode === 'plan' || data.task_mode === 'coaching'
        || data.task_mode === 'recipe' || data.task_mode === 'simulation'
        || data.task_mode === 'eating_out' || data.task_mode === 'plateau';

      const reply: UIMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        task_mode: data.task_mode,
        created_at: new Date().toISOString(),
        actions: data.actions,
        showFeedback,
      };
      setMessages(prev => [...prev, reply]);

      // Refresh dashboard if actions were executed (meal logged, weight updated, etc.)
      if (data.actions.some(a => a.feedback) && user?.id) {
        refreshDashboard(user.id);
      }
    } else {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: error ?? 'Baglanti hatasi. Tekrar dene.',
        created_at: new Date().toISOString(),
      }]);
    }

    setSending(false);
    scrollToBottom();
  };

  // Quick suggestion handler
  const handleSuggestion = (text: string) => {
    setInput(text);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Messages or empty state */}
      {messages.length <= 1 && !sending ? (
        <EmptyState
          messages={messages}
          isOnboarding={!!isOnboarding}
          onSuggestion={handleSuggestion}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.sm }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Typing indicator */}
      {sending && (
        <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.xs }}>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.sm, alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.border }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Kochko yaziyor...</Text>
          </View>
        </View>
      )}

      {/* Barcode Scanner Overlay (T2.12) */}
      {showBarcodeScanner && (
        <View style={{ height: 250, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            onBarcodeScanned={(result) => {
              if (result.data) handleBarcodeScan(result.data);
            }}
          />
          <TouchableOpacity
            onPress={() => setShowBarcodeScanner(false)}
            style={{ position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.error, borderRadius: 16, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Photo preview */}
      {photo && (
        <View style={{ padding: SPACING.sm, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.surface }}>
          <Image source={{ uri: photo }} style={{ width: 60, height: 60, borderRadius: 8 }} />
          <TouchableOpacity
            onPress={() => setPhoto(null)}
            style={{ marginLeft: SPACING.sm, width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>X</Text>
          </TouchableOpacity>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginLeft: SPACING.sm, flex: 1 }}>Foto eklendi. Mesajla birlikte gonderilebilir.</Text>
        </View>
      )}

      {/* Input bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        padding: SPACING.sm, paddingBottom: SPACING.md,
        borderTopWidth: 1, borderTopColor: COLORS.border,
        backgroundColor: COLORS.surface, gap: SPACING.xs,
      }}>
        <TouchableOpacity onPress={takePhoto} style={styles.iconBtn}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>O</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={pickImage} style={styles.iconBtn}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openBarcodeScanner} style={styles.iconBtn}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700' }}>BC</Text>
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
          style={[styles.sendBtn, ((!input.trim() && !photo) || sending) && { opacity: 0.4 }]}
          onPress={handleSend}
          disabled={(!input.trim() && !photo) || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={{ color: '#fff', fontSize: FONT.lg, fontWeight: '700' }}>{'>'}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Sub-components ---

function EmptyState({ messages, isOnboarding, onSuggestion }: {
  messages: UIMessage[];
  isOnboarding: boolean;
  onSuggestion: (text: string) => void;
}) {
  const onboardingSuggestions = [
    '30 yasinda, 80 kilo, 175 boy erkeğim',
    'Kilo vermek istiyorum',
    'Kendimi tanitmak istiyorum',
  ];
  const regularSuggestions = [
    'Bugun kahvaltida 2 yumurta yedim',
    'Bugunku planımı olustur',
    'Kilo vermek istiyorum, nereden baslayalim?',
    'Evde yapabilecegim antrenman oner',
  ];
  const suggestions = isOnboarding ? onboardingSuggestions : regularSuggestions;

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: SPACING.lg }}>
      {/* Show onboarding intro message if present */}
      {messages.length === 1 && messages[0].role === 'assistant' && (
        <View style={{ maxWidth: '90%', backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', marginBottom: 4 }}>Kochko</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{messages[0].content}</Text>
        </View>
      )}

      {/* Welcome text for truly empty state */}
      {messages.length === 0 && (
        <>
          <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Merhaba!</Text>
          <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, lineHeight: 24, marginBottom: SPACING.sm }}>
            Ben Kochko, yasam tarzi kocun.
          </Text>
        </>
      )}

      {/* Suggestion chips */}
      <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
        {suggestions.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}
            onPress={() => onSuggestion(s)}
          >
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{
        maxWidth: '82%', borderRadius: 16, padding: SPACING.md,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? COLORS.primary : COLORS.card,
        borderWidth: isUser ? 0 : 1, borderColor: COLORS.border,
        borderBottomRightRadius: isUser ? 4 : 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
      }}>
        {/* Coach label */}
        {!isUser && (
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', marginBottom: 4 }}>Kochko</Text>
        )}

        {/* Message content */}
        <Text style={{ color: isUser ? '#fff' : COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>
          {message.content}
        </Text>

        {/* Timestamp */}
        <Text style={{ color: isUser ? 'rgba(255,255,255,0.6)' : COLORS.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' }}>
          {new Date(message.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Action feedback (below the bubble) */}
      {!isUser && message.actions && message.actions.length > 0 && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs }}>
          <ActionFeedback actions={message.actions} />
        </View>
      )}

      {/* Feedback buttons for coaching/plan/recipe messages */}
      {!isUser && message.showFeedback && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs }}>
          <FeedbackButtons
            contextType={message.task_mode === 'recipe' ? 'recipe' : message.task_mode === 'plan' ? 'meal_suggestion' : 'coaching_message'}
            contextId={message.id}
          />
        </View>
      )}
    </View>
  );
}

// --- Styles ---
const styles = {
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.inputBg,
    justifyContent: 'center' as const, alignItems: 'center' as const,
    borderWidth: 1, borderColor: COLORS.border,
  },
  textInput: {
    flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 20,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
    color: COLORS.text, fontSize: FONT.md, maxHeight: 120,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
};
