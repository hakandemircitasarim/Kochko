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
import { useLocalSearchParams } from 'expo-router';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useAuthStore } from '@/stores/auth.store';
import {
  sendMessage, sendMessageWithRetry, sendMessageWithPhoto, loadChatHistory,
  type ChatMessage, type ChatResponse,
} from '@/services/chat.service';
import { lookupBarcode, calculateServing } from '@/services/barcode.service';
import { startRecording, stopAndTranscribe, isRecording as checkIsRecording } from '@/services/voice.service';
import { ActionFeedback } from '@/components/chat/ActionFeedback';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';
import {
  MacroSummary, SimulationCard, WeeklyBudgetBar, QuickSelectButtons,
  RecipeCard, ConfirmRejectButtons,
} from '@/components/chat/RichMessage';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

// Simulation data parsed from AI responses
interface SimulationData {
  foodName: string;
  calories: number;
  remaining: number;
  weeklyImpact: string;
}

// Extended message type for UI state
interface UIMessage extends ChatMessage {
  actions?: { type: string; feedback: string | null }[];
  showFeedback?: boolean;
  simulationData?: SimulationData | null;
  quickSelectOptions?: string[] | null;
  hasPlanSuggestion?: boolean;
}

function parseSimulationData(content: string): { cleanContent: string; data: SimulationData | null } {
  const match = content.match(/<simulation>([\s\S]*?)<\/simulation>/);
  if (!match) return { cleanContent: content, data: null };
  try {
    const data = JSON.parse(match[1]) as SimulationData;
    const cleanContent = content.replace(/<simulation>[\s\S]*?<\/simulation>/, '').trim();
    return { cleanContent, data };
  } catch {
    return { cleanContent: content, data: null };
  }
}

function parseQuickSelect(content: string): { cleanContent: string; options: string[] | null } {
  const match = content.match(/<quick_select>([\s\S]*?)<\/quick_select>/);
  if (!match) return { cleanContent: content, options: null };
  try {
    const options = JSON.parse(match[1]) as string[];
    const cleanContent = content.replace(/<quick_select>[\s\S]*?<\/quick_select>/, '').trim();
    return { cleanContent, options };
  } catch {
    return { cleanContent: content, options: null };
  }
}

function hasConfirmRejectIndicator(content: string, taskMode?: string): boolean {
  return !!content.match(/<confirm_reject\s*\/?>/) ||
    taskMode === 'plan_suggestion' ||
    (taskMode === 'plan' && (content.includes('plan') || content.includes('öneriyorum')));
}

export default function ChatScreen() {
  const { colors, isDark } = useTheme();
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const refreshDashboard = useDashboardStore(s => s.fetchToday);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<{ type: string; messageId: string; expiresAt: number } | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
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
      const msg = `Barkod: ${result.product_name} (${result.brand ?? ''}) - ${serving?.calories ?? '?'} kcal, ${serving?.protein_g ?? '?'}g protein (100g bazında)`;
      setInput(msg);
    } else {
      setInput(`Barkod ${barcode} bulunamadı. Bu ürünü metin olarak girebilirsin.`);
    }
    setSending(false);
  };

  // Voice recording handler (T4.1 / U1)
  const handleVoiceToggle = async () => {
    if (isRecordingVoice) {
      setIsRecordingVoice(false);
      const { text, audioUri } = await stopAndTranscribe();
      if (text) {
        setInput(text);
      } else if (audioUri) {
        setInput('[Ses kaydedildi ama yazılamadı - metin olarak yazın]');
      }
    } else {
      const started = await startRecording();
      if (started) setIsRecordingVoice(true);
    }
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
          content: 'Merhaba! Ben Kochko, yaşam tarzı koçun.\n\nSeni tanımak istiyorum - biraz kendinden bahseder misin? Kaç yaşındasın, boyun ve kilon ne kadar? Beslenme veya sporla ilgili hedeflerin var mı?',
          created_at: new Date().toISOString(),
        }]);
      } else {
        setMessages(data.map(m => ({ ...m })));
      }
      setLoading(false);
    });
  }, [isOnboarding]);

  // Pre-fill from dashboard quick actions
  useEffect(() => {
    if (prefill && !prefillApplied && !loading) {
      setInput(prefill);
      setPrefillApplied(true);
    }
  }, [prefill, prefillApplied, loading]);

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
      content: photo ? (text ? `[Foto] ${text}` : '[Foto gönderildi]') : text,
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
      ? await sendMessageWithPhoto(text || 'Bu yemeği analiz et.', img)
      : await sendMessage(text);

    if (data) {
      // Determine if this message type should show feedback buttons
      // Show feedback for: plan suggestions, coaching advice, recipes (not for simple confirmations)
      const showFeedback = data.task_mode === 'plan' || data.task_mode === 'coaching'
        || data.task_mode === 'recipe' || data.task_mode === 'simulation'
        || data.task_mode === 'eating_out' || data.task_mode === 'plateau';

      // Parse simulation data if in simulation mode
      let messageContent = data.message;
      let simulationData: SimulationData | null = null;
      if (data.task_mode === 'simulation') {
        const parsed = parseSimulationData(data.message);
        messageContent = parsed.cleanContent;
        simulationData = parsed.data;
      }

      // Parse quick_select options from AI response
      const quickSelectParsed = parseQuickSelect(messageContent);
      messageContent = quickSelectParsed.cleanContent;
      const quickSelectOptions = quickSelectParsed.options;

      // Detect confirm/reject plan suggestion
      const hasPlanSuggestion = hasConfirmRejectIndicator(messageContent, data.task_mode);
      messageContent = messageContent.replace(/<confirm_reject\s*\/?>/g, '').trim();

      const reply: UIMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: messageContent,
        task_mode: data.task_mode,
        created_at: new Date().toISOString(),
        actions: data.actions,
        showFeedback,
        simulationData,
        quickSelectOptions,
        hasPlanSuggestion,
      };
      setMessages(prev => [...prev, reply]);

      // Refresh dashboard AND profile if actions were executed
      if (data.actions.some(a => a.feedback) && user?.id) {
        refreshDashboard(user.id);
        // Refresh profile if profile_update or weight_log action
        if (data.actions.some(a => a.type === 'profile_update' || a.type === 'weight_log')) {
          useProfileStore.getState().fetch(user.id);
        }

        // 10-second undo window for meal/workout logs (Spec 3.2)
        const undoableAction = data.actions.find(a =>
          a.feedback && (a.type === 'meal_log' || a.type === 'workout_log' || a.type === 'supplement_log')
        );
        if (undoableAction) {
          const expiresAt = Date.now() + 10000;
          setUndoAction({ type: undoableAction.type, messageId: reply.id, expiresAt });
          setTimeout(() => setUndoAction(prev => prev?.expiresAt === expiresAt ? null : prev), 10000);
        }
      }
    } else {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: error ?? 'Bağlantı hatası. Tekrar dene.',
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

  // QuickSelectButtons handler — user picks an option from AI's inline choices
  const handleQuickSelect = useCallback((option: string) => {
    setInput(option);
    // Auto-send after a short delay
    setTimeout(async () => {
      const userMsg: UIMessage = {
        id: `u-${Date.now()}`, role: 'user', content: option, created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setSending(true);
      scrollToBottom();
      const { data, error } = await sendMessage(option);
      if (data) {
        let content = data.message;
        const qsParsed = parseQuickSelect(content);
        content = qsParsed.cleanContent;
        const hasPlan = hasConfirmRejectIndicator(content, data.task_mode);
        content = content.replace(/<confirm_reject\s*\/?>/g, '').trim();
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant', content, task_mode: data.task_mode,
          created_at: new Date().toISOString(), actions: data.actions, showFeedback: false,
          quickSelectOptions: qsParsed.options, hasPlanSuggestion: hasPlan,
        }]);
        if (data.actions.some(a => a.feedback) && user?.id) refreshDashboard(user.id);
      } else {
        setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: error ?? 'Bağlantı hatası.', created_at: new Date().toISOString() }]);
      }
      setSending(false);
      scrollToBottom();
    }, 0);
  }, [scrollToBottom, user?.id, refreshDashboard]);

  // Confirm/Reject plan suggestion handlers
  const handlePlanConfirm = useCallback(() => {
    handleQuickSelect('Evet, bu planı onayla');
  }, [handleQuickSelect]);

  const handlePlanReject = useCallback(() => {
    handleQuickSelect('Hayır, değiştir');
  }, [handleQuickSelect]);

  // Dashboard macros for real-time MacroSummary after meal_log
  const totalProtein = useDashboardStore(s => s.totalProtein);
  const totalCarbs = useDashboardStore(s => s.totalCarbs);
  const totalFat = useDashboardStore(s => s.totalFat);
  const totalCalories = useDashboardStore(s => s.totalCalories);
  const weeklyBudgetRemaining = useDashboardStore(s => s.weeklyBudgetRemaining);
  const dashboardMacros = { protein: totalProtein, carbs: totalCarbs, fat: totalFat };

  // Compute macro gram targets from profile
  const macroTargets = (() => {
    const tdee = profile?.tdee_calculated ?? 2000;
    const pPct = profile?.macro_protein_pct ?? 30;
    const cPct = profile?.macro_carb_pct ?? 40;
    const fPct = profile?.macro_fat_pct ?? 30;
    return {
      protein: Math.round((tdee * pPct / 100) / 4),
      carbs: Math.round((tdee * cPct / 100) / 4),
      fat: Math.round((tdee * fPct / 100) / 9),
    };
  })();

  // "Neden bu öneriyi yaptın?" handler
  const handleAskWhy = useCallback((messageContent: string) => {
    setInput('Neden bu öneriyi yaptın?');
    // Trigger send after state update
    setTimeout(async () => {
      const text = 'Neden bu öneriyi yaptın?';
      const userMsg: UIMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setSending(true);
      scrollToBottom();

      const { data, error } = await sendMessage(text);
      if (data) {
        const reply: UIMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.message,
          task_mode: data.task_mode,
          created_at: new Date().toISOString(),
          actions: data.actions,
          showFeedback: false,
        };
        setMessages(prev => [...prev, reply]);
      } else {
        setMessages(prev => [...prev, {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: error ?? 'Bağlantı hatası. Tekrar dene.',
          created_at: new Date().toISOString(),
        }]);
      }
      setSending(false);
      scrollToBottom();
    }, 0);
  }, [scrollToBottom]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const sendDisabled = (!input.trim() && !photo) || sending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={{ paddingHorizontal: SPACING.xl, paddingTop: 60, paddingBottom: SPACING.md }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>AI kocun</Text>
      </View>

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
          renderItem={({ item }) => <MessageBubble message={item} onAskWhy={handleAskWhy} dashboardMacros={dashboardMacros} macroTargets={macroTargets} onQuickSelect={handleQuickSelect} onConfirm={handlePlanConfirm} onReject={handlePlanReject} totalCalories={totalCalories} weeklyBudgetRemaining={weeklyBudgetRemaining} />}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.sm }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Typing indicator */}
      {sending && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{
            backgroundColor: colors.card,
            borderRadius: 16,
            borderBottomLeftRadius: 4,
            padding: SPACING.md,
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.sm,
            borderWidth: 0.5,
            borderColor: colors.border,
          }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Kochko yaziyor...</Text>
          </View>
        </View>
      )}

      {/* Barcode Scanner Overlay (T2.12) */}
      {showBarcodeScanner && (
        <View style={{ height: 250, borderTopWidth: 1, borderTopColor: colors.border }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            onBarcodeScanned={(result) => {
              if (result.data) handleBarcodeScan(result.data);
            }}
          />
          <TouchableOpacity
            onPress={() => setShowBarcodeScanner(false)}
            style={{ position: 'absolute', top: 8, right: 8, backgroundColor: colors.error, borderRadius: RADIUS.full, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Photo preview */}
      {photo && (
        <View style={{
          padding: SPACING.sm,
          flexDirection: 'row',
          alignItems: 'center',
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <Image source={{ uri: photo }} style={{ width: 60, height: 60, borderRadius: RADIUS.md }} />
          <TouchableOpacity
            onPress={() => setPhoto(null)}
            style={{ marginLeft: SPACING.sm, width: 24, height: 24, borderRadius: RADIUS.full, backgroundColor: colors.error, justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="close" size={14} color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginLeft: SPACING.sm, flex: 1 }}>Foto eklendi. Mesajla birlikte gönderilebilir.</Text>
        </View>
      )}

      {/* Undo banner */}
      {undoAction && Date.now() < undoAction.expiresAt && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <TouchableOpacity
            onPress={async () => {
              const undoText = `Son ${undoAction.type === 'meal_log' ? 'ogun' : undoAction.type === 'workout_log' ? 'antrenman' : 'supplement'} kaydini geri al`;
              setUndoAction(null);
              await sendMessageWithRetry(undoText);
            }}
            style={{
              backgroundColor: colors.warning, borderRadius: RADIUS.pill,
              paddingVertical: 6, paddingHorizontal: SPACING.xl, alignSelf: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '500' }}>Geri Al (10sn)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input bar */}
      <View style={{
        paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, paddingBottom: SPACING.xl,
        borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.background,
      }}>
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end',
          backgroundColor: colors.card, borderRadius: 24,
          borderWidth: 0.5, borderColor: colors.border,
          paddingHorizontal: SPACING.md, paddingVertical: 6,
          gap: 4,
        }}>
          {/* Text input */}
          <TextInput
            style={{
              flex: 1, color: colors.text, fontSize: 13,
              paddingVertical: 6, maxHeight: 120,
            }}
            placeholder="Mesajini yaz..."
            placeholderTextColor={colors.textMuted}
            value={input} onChangeText={setInput}
            multiline maxLength={2000} editable={!sending}
          />

          {/* Icon buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
            <TouchableOpacity onPress={takePhoto} style={{
              width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardElevated,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Ionicons name="camera-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={openBarcodeScanner} style={{
              width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardElevated,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Ionicons name="barcode-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleVoiceToggle} style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: isRecordingVoice ? colors.error : colors.cardElevated,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Ionicons name={isRecordingVoice ? 'stop' : 'mic-outline'} size={16}
                color={isRecordingVoice ? '#fff' : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: colors.primary,
                justifyContent: 'center', alignItems: 'center',
                opacity: sendDisabled ? 0.4 : 1,
              }}
              onPress={handleSend} disabled={sendDisabled}
            >
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="arrow-up" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
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
  const { colors, isDark } = useTheme();

  const onboardingSuggestions = [
    '30 yaşında, 80 kilo, 175 boy erkeğim',
    'Kilo vermek istiyorum',
    'Kendimi tanıtmak istiyorum',
  ];
  const regularSuggestions = [
    'Bugün kahvaltıda 2 yumurta yedim',
    'Bugünkü planımı oluştur',
    'Kilo vermek istiyorum, nereden başlayalım?',
    'Evde yapabileceğim antrenman öner',
  ];
  const suggestions = isOnboarding ? onboardingSuggestions : regularSuggestions;

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: SPACING.xl }}>
      {/* Onboarding intro */}
      {messages.length === 1 && messages[0].role === 'assistant' && (
        <View style={{
          maxWidth: '90%',
          backgroundColor: colors.card,
          borderRadius: 16, borderBottomLeftRadius: 4,
          padding: SPACING.lg, marginBottom: SPACING.xxl,
          borderWidth: 0.5, borderColor: colors.border,
        }}>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{messages[0].content}</Text>
        </View>
      )}

      {/* Empty state */}
      {messages.length === 0 && (
        <>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: SPACING.sm }}>AI kocun</Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginBottom: SPACING.md }}>
            Beslenme, antrenman, uyku — her konuda yardimci olabilirim.
          </Text>
        </>
      )}

      {/* Suggestion pills */}
      <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
        {suggestions.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={{
              backgroundColor: colors.card, borderRadius: RADIUS.pill,
              paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl,
              borderWidth: 0.5, borderColor: colors.border,
            }}
            onPress={() => onSuggestion(s)}
          >
            <Text style={{ color: colors.primary, fontSize: 13 }}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function MessageBubble({ message, onAskWhy, dashboardMacros, macroTargets, onQuickSelect, onConfirm, onReject, totalCalories, weeklyBudgetRemaining }: {
  message: UIMessage;
  onAskWhy: (content: string) => void;
  dashboardMacros: { protein: number; carbs: number; fat: number };
  macroTargets: { protein: number; carbs: number; fat: number };
  onQuickSelect: (option: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  totalCalories: number;
  weeklyBudgetRemaining: number | null;
}) {
  const { colors, isDark } = useTheme();
  const isUser = message.role === 'user';

  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{
        maxWidth: '85%',
        padding: SPACING.lg,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? colors.primary : colors.card,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomRightRadius: isUser ? 4 : 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
        ...(isUser ? {} : { borderWidth: 0.5, borderColor: colors.border }),
      }}>
        {/* Message content */}
        <Text style={{ color: isUser ? '#fff' : colors.text, fontSize: 13, lineHeight: 20 }}>
          {message.content}
        </Text>

        {/* Inline rich content for AI responses (Spec 5.20) */}
        {!isUser && message.actions?.some(a => a.type === 'meal_log' && a.feedback) && (
          <MacroSummary
            protein={dashboardMacros.protein}
            carbs={dashboardMacros.carbs}
            fat={dashboardMacros.fat}
            targets={macroTargets}
          />
        )}

        {/* Recipe card for recipe task_mode */}
        {!isUser && message.task_mode === 'recipe' && (message as any).recipe && (
          <RecipeCard
            title={(message as any).recipe.title}
            prepTime={(message as any).recipe.prepTime}
            servings={(message as any).recipe.servings}
            ingredients={(message as any).recipe.ingredients}
            macros={(message as any).recipe.macros}
          />
        )}

        {/* Quick select buttons (D13) */}
        {!isUser && message.quickSelectOptions && message.quickSelectOptions.length > 0 && (
          <QuickSelectButtons options={message.quickSelectOptions} onSelect={onQuickSelect} />
        )}

        {/* Confirm/Reject buttons for plan suggestion (D14) */}
        {!isUser && message.hasPlanSuggestion && (
          <ConfirmRejectButtons onConfirm={onConfirm} onReject={onReject} />
        )}

        {/* Timestamp */}
        <Text style={{ color: isUser ? 'rgba(255,255,255,0.6)' : colors.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' }}>
          {new Date(message.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Simulation card */}
      {!isUser && message.simulationData && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs, marginTop: SPACING.xs }}>
          <SimulationCard
            foodName={message.simulationData.foodName}
            calories={message.simulationData.calories}
            remaining={message.simulationData.remaining}
            weeklyImpact={message.simulationData.weeklyImpact}
          />
        </View>
      )}

      {/* Weekly budget bar after meal_log (D15) */}
      {!isUser && message.actions?.some(a => a.type === 'meal_log' && a.feedback) && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs, marginTop: SPACING.xs }}>
          <WeeklyBudgetBar consumed={totalCalories} total={weeklyBudgetRemaining != null ? totalCalories + weeklyBudgetRemaining : 0} />
        </View>
      )}

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
          {/* Transparency: ask why this suggestion */}
          <TouchableOpacity
            onPress={() => onAskWhy(message.content)}
            style={{ marginTop: SPACING.xs, paddingVertical: 4, paddingHorizontal: SPACING.sm }}
          >
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, textDecorationLine: 'underline' }}>
              Neden bu öneriyi yaptın?
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
