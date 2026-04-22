/**
 * SESSION DETAIL SCREEN - Chat within a specific session
 * Based on the main chat screen, but scoped to a single session.
 *
 * Integrates:
 * - Text + photo messaging
 * - ActionFeedback (inline action confirmations)
 * - FeedbackButtons (ise yaradi / bana gore degil)
 * - Onboarding awareness (new user intro)
 * - Dashboard refresh after actions
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, Keyboard, Share, Vibration, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useAuthStore } from '@/stores/auth.store';
import {
  sendMessageToSession, sendPhotoToSession, loadSessionMessages,
  reopenSession, createSession,
  type ChatMessage, type ChatResponse,
} from '@/services/chat.service';
import { getTaskByKey } from '@/services/onboarding-tasks.service';
import { lookupBarcode, calculateServing } from '@/services/barcode.service';
import { saveRecipe, type RecipeIngredient } from '@/services/recipes.service';
import { startRecording, stopAndTranscribe, isRecording as checkIsRecording } from '@/services/voice.service';
import { incrementAndCheck, getRemainingMessages } from '@/services/message-counter.service';
import { speak, stopSpeaking, isSpeaking } from '@/services/tts.service';
import { detectRepairIntent, type RepairDetection } from '@/services/repair.service';
import { ActionFeedback } from '@/components/chat/ActionFeedback';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import {
  MacroSummary, MacroRing, SimulationCard, WeeklyBudgetBar, QuickSelectButtons,
  RecipeCard, ConfirmRejectButtons, PersonaCard,
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

// Recipe data parsed from AI responses
interface RecipeData {
  title: string;
  prepTime: number;
  servings: number;
  ingredients: { name: string; amount: string }[];
  macros: { calories: number; protein: number; carbs: number; fat: number };
}

// Extended message type for UI state
interface UIMessage extends ChatMessage {
  actions?: { type: string; feedback: string | null }[];
  showFeedback?: boolean;
  simulationData?: SimulationData | null;
  recipeData?: RecipeData | null;
  quickSelectOptions?: string[] | null;
  hasPlanSuggestion?: boolean;
  hasLowConfidenceVerification?: boolean;
  personaDetected?: string | null;
  recipeSaved?: boolean;
  taskCompletion?: { completed: string; summary: string; next_suggestions: string[] } | null;
  navigateTo?: string | null;
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

// Defensive sanitizer — belt-and-suspenders for any structured XML block that somehow
// slipped through server-side stripping. Never render these in the user-facing bubble.
function sanitizeAssistantText(text: string): string {
  return text
    .replace(/<actions>[\s\S]*?<\/actions>/g, '')
    .replace(/<layer2_update>[\s\S]*?<\/layer2_update>/g, '')
    .replace(/<task_completion>[\s\S]*?<\/task_completion>/g, '')
    .replace(/<plan_snapshot>[\s\S]*?<\/plan_snapshot>/g, '')
    .replace(/<plan_finalize>[\s\S]*?<\/plan_finalize>/g, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
    .replace(/<navigate_to>[\s\S]*?<\/navigate_to>/g, '')
    .replace(/<simulation>[\s\S]*?<\/simulation>/g, '')
    .replace(/<quick_select>[\s\S]*?<\/quick_select>/g, '')
    .replace(/<recipe>[\s\S]*?<\/recipe>/g, '')
    .replace(/<confirm_reject\s*\/?>/g, '')
    .replace(/<commitment>[\s\S]*?<\/commitment>/g, '')
    .replace(/<persona_detected>[\s\S]*?<\/persona_detected>/g, '')
    .trim();
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

function parseRecipeData(content: string): { cleanContent: string; data: RecipeData | null } {
  const match = content.match(/<recipe>([\s\S]*?)<\/recipe>/);
  if (!match) return { cleanContent: content, data: null };
  try {
    const data = JSON.parse(match[1]) as RecipeData;
    const cleanContent = content.replace(/<recipe>[\s\S]*?<\/recipe>/, '').trim();
    return { cleanContent, data };
  } catch {
    return { cleanContent: content, data: null };
  }
}

function hasConfirmRejectIndicator(content: string, taskMode?: string): boolean {
  return !!content.match(/<confirm_reject\s*\/?>/) ||
    taskMode === 'plan_suggestion' ||
    (taskMode === 'plan' && (content.includes('plan') || content.includes('öneriyorum')));
}

/**
 * Detects the low-confidence verification sentence that ai-chat auto-appends
 * when parsed meal confidence < 0.7. Phrasing: "Dogru anladiysam: X. Bu dogru mu?"
 */
function hasLowConfidenceVerificationIndicator(content: string): boolean {
  const lower = content.toLocaleLowerCase('tr');
  return lower.includes('dogru anladiysam') || lower.includes('doğru anladıysam');
}

export default function SessionDetailScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const { sessionId, prefill, taskModeHint } = useLocalSearchParams<{ sessionId: string; prefill?: string; taskModeHint?: string }>();
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
  const [voiceConfirmation, setVoiceConfirmation] = useState<{ text: string; expiresAt: number } | null>(null);
  const [backdateDate, setBackdateDate] = useState<string | null>(null); // YYYY-MM-DD for manual date override
  const [remainingMsgs, setRemainingMsgs] = useState<number | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const listRef = useRef<FlatList>(null);

  const isOnboarding = profile && !profile.onboarding_completed;
  const isPremium = !!(profile as Record<string, unknown> | null)?.premium;

  // Fetch remaining messages for free users on mount
  useEffect(() => {
    getRemainingMessages(isPremium).then(setRemainingMsgs);
  }, [isPremium]);

  // TTS toggle handler
  const handleTTSToggle = useCallback(async (msgId: string, text: string) => {
    if (speakingMsgId === msgId) {
      stopSpeaking();
      setSpeakingMsgId(null);
    } else {
      if (speakingMsgId) stopSpeaking();
      setSpeakingMsgId(msgId);
      const coachTone = ((profile as Record<string, unknown> | null)?.coach_tone as 'strict' | 'balanced' | 'gentle') ?? 'balanced';
      await speak(text, { coachTone });
      setSpeakingMsgId(null);
    }
  }, [speakingMsgId, profile]);

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
  // Flow: record → transcribe → drop into input + show "Duydum: X" banner
  // for 5s so user can review/edit/cancel before sending.
  const handleVoiceToggle = async () => {
    if (isRecordingVoice) {
      try {
        setIsRecordingVoice(false);
        const { text, audioUri } = await stopAndTranscribe();
        if (text) {
          setInput(text);
          const expiresAt = Date.now() + 5000;
          setVoiceConfirmation({ text, expiresAt });
          setTimeout(() => setVoiceConfirmation(prev => prev?.expiresAt === expiresAt ? null : prev), 5000);
        } else if (audioUri) {
          setInput('[Ses kaydedildi ama yazılamadı - metin olarak yazın]');
        }
      } catch {
        setIsRecordingVoice(false);
      }
    } else {
      try {
        const started = await startRecording();
        if (started) setIsRecordingVoice(true);
      } catch {
        setIsRecordingVoice(false);
      }
    }
  };

  const openBarcodeScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setShowBarcodeScanner(true);
  };

  // Load chat history + handle task card auto-start
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    loadSessionMessages(sessionId).then(async (data) => {
      if (cancelled) return;
      if (data.length === 0 && taskModeHint) {
        // Card-triggered session: AI sends first message (not user)
        setLoading(false);
        setSending(true);
        const { data: response } = await sendMessageToSession(
          sessionId,
          `[SYSTEM_INIT] Bu konu hakkında bildiklerini özetle ve sormak istediğin soruları sor.`,
          taskModeHint,
        );
        if (!cancelled && response) {
          setMessages([
            { id: `a-${Date.now()}`, role: 'assistant', content: response.message, task_mode: response.task_mode, created_at: new Date().toISOString() },
          ]);
        }
        if (!cancelled) { setSending(false); setPrefillApplied(true); }
      } else if (data.length === 0 && isOnboarding && !taskModeHint) {
        setMessages([{
          id: 'onboard-intro',
          role: 'assistant',
          content: 'Merhaba! Ben Kochko, yaşam tarzı koçun.\n\nSeni tanımak istiyorum — biraz kendinden bahseder misin?',
          created_at: new Date().toISOString(),
        }]);
        setLoading(false);
      } else {
        if (!cancelled) {
          setMessages(data.map(m => ({ ...m })));
          setLoading(false);

          // Phase 5: proactive greet — if it's been >4h since the last assistant
          // message AND the chat is non-task (general/daily_log), inject a gentle
          // "merhaba tekrar" starter. Silent no-op otherwise.
          if (!taskModeHint && data.length > 0) {
            const last = [...data].reverse().find(m => m.role === 'assistant');
            if (last) {
              const ageMs = Date.now() - new Date(last.created_at).getTime();
              if (ageMs > 4 * 60 * 60 * 1000) {
                // Fire-and-forget: add a small client-only bubble; doesn't hit the DB
                // until user replies, so no noise if they just leave the screen.
                setMessages(prev => [
                  ...prev,
                  {
                    id: 'greet-' + Date.now(),
                    role: 'assistant',
                    content: 'Uzun zamandır konuşmadık. Bugünü konuşalım mı — ne yediğin, enerjin nasıldı?',
                    created_at: new Date().toISOString(),
                  },
                ]);
              }
            }
          }
        }
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, isOnboarding, taskModeHint]);

  // Pre-fill from dashboard quick actions (non-card navigation)
  useEffect(() => {
    if (prefill && !taskModeHint && !prefillApplied && !loading) {
      setInput(prefill);
      setPrefillApplied(true);
    }
  }, [prefill, taskModeHint, prefillApplied, loading]);

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

    // Message counter check (Spec 16: free daily limit)
    if (text && !photo) {
      const counterResult = await incrementAndCheck(isPremium);
      setRemainingMsgs(counterResult.remaining);
      if (!counterResult.allowed) {
        Alert.alert(
          'Mesaj Limiti',
          counterResult.message ?? 'Gunluk mesaj limitine ulastin. Premium\'a gecersen sinirsiz mesaj hakki kazanirsin.',
          [{ text: 'Tamam' }]
        );
        return;
      }
    }

    // Repair intent detection (Spec 5.32)
    let repairContext: RepairDetection | null = null;
    if (text) {
      repairContext = detectRepairIntent(text);
    }

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

    // Call AI — pass repair context if detected
    const effectiveTaskMode = repairContext && repairContext.type !== 'none'
      ? `repair:${repairContext.type}`
      : (taskModeHint ?? undefined);
    const { data, error } = img
      ? await sendPhotoToSession(sessionId, text || 'Bu yemeği analiz et.', img)
      : await sendMessageToSession(sessionId, text, effectiveTaskMode, backdateDate ?? undefined);
    // Clear backdate after use so subsequent messages are today
    if (backdateDate) setBackdateDate(null);

    if (data) {
      // Determine if this message type should show feedback buttons
      // Show feedback for: plan suggestions, coaching advice, recipes (not for simple confirmations)
      const showFeedback = data.task_mode === 'plan' || data.task_mode === 'coaching'
        || data.task_mode === 'recipe' || data.task_mode === 'simulation'
        || data.task_mode === 'eating_out' || data.task_mode === 'plateau';

      // Parse simulation data from AI response
      let messageContent = data.message;
      let simulationData: SimulationData | null = null;
      const simParsed = parseSimulationData(messageContent);
      messageContent = simParsed.cleanContent;
      simulationData = simParsed.data;

      // Parse recipe data from AI response
      let recipeData: RecipeData | null = null;
      const recipeParsed = parseRecipeData(messageContent);
      messageContent = recipeParsed.cleanContent;
      recipeData = recipeParsed.data;

      // Parse quick_select options from AI response
      const quickSelectParsed = parseQuickSelect(messageContent);
      messageContent = quickSelectParsed.cleanContent;
      const quickSelectOptions = quickSelectParsed.options;

      // Detect confirm/reject plan suggestion
      const hasPlanSuggestion = hasConfirmRejectIndicator(messageContent, data.task_mode);
      messageContent = messageContent.replace(/<confirm_reject\s*\/?>/g, '').trim();

      // Detect low-confidence verification prompt (Spec 5.32, auto-appended by ai-chat)
      const hasLowConfidenceVerification = hasLowConfidenceVerificationIndicator(messageContent);

      // Extract persona_detected action (Spec 5.15) — server emits after first-time detection
      const personaAction = data.actions.find(a => a.type === 'persona_detected');
      const personaDetected = (personaAction?.feedback as string | null) ?? null;

      const reply: UIMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: messageContent,
        task_mode: data.task_mode,
        created_at: new Date().toISOString(),
        actions: data.actions,
        showFeedback,
        simulationData,
        recipeData,
        quickSelectOptions,
        hasPlanSuggestion,
        hasLowConfidenceVerification,
        personaDetected,
        taskCompletion: data.task_completion ?? null,
        navigateTo: data.navigate_to ?? null,
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

  const handleCopyConversation = async () => {
    if (messages.length === 0) {
      Alert.alert('Bos sohbet', 'Henuz mesaj yok.');
      return;
    }
    const transcript = messages
      .map((m) => {
        const who = m.role === 'user' ? 'BEN' : 'KOCHKO';
        const text = (m.content ?? '').trim();
        return text ? `${who}: ${text}` : null;
      })
      .filter(Boolean)
      .join('\n\n');
    try {
      await Share.share({ message: transcript });
    } catch (e) {
      Alert.alert('Paylasilamadi', 'Sohbet kopyalanirken bir hata olustu.');
    }
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
      const { data, error } = await sendMessageToSession(sessionId, option);
      if (data) {
        let content = data.message;
        const simParsed = parseSimulationData(content);
        content = simParsed.cleanContent;
        const recipeParsed = parseRecipeData(content);
        content = recipeParsed.cleanContent;
        const qsParsed = parseQuickSelect(content);
        content = qsParsed.cleanContent;
        const hasPlan = hasConfirmRejectIndicator(content, data.task_mode);
        content = content.replace(/<confirm_reject\s*\/?>/g, '').trim();
        const hasLowConf = hasLowConfidenceVerificationIndicator(content);
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant', content, task_mode: data.task_mode,
          created_at: new Date().toISOString(), actions: data.actions, showFeedback: false,
          simulationData: simParsed.data, recipeData: recipeParsed.data,
          quickSelectOptions: qsParsed.options, hasPlanSuggestion: hasPlan,
          hasLowConfidenceVerification: hasLowConf,
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

  // Plan rejection with chip-based reason selection (Spec 7.1 — multi-turn refine)
  const handlePlanReject = useCallback(() => {
    Alert.alert(
      'Neyi değiştirelim?',
      'Hangi kısmı beğenmedin?',
      [
        { text: 'Kahvaltı', onPress: () => handleQuickSelect('Kahvaltı farklı olsun — yeni öneri ver') },
        { text: 'Öğle', onPress: () => handleQuickSelect('Öğle yemeğini değiştir — yeni öneri ver') },
        { text: 'Akşam', onPress: () => handleQuickSelect('Akşam yemeğini değiştir — yeni öneri ver') },
        { text: 'Çok protein', onPress: () => handleQuickSelect('Protein fazla geldi, biraz azalt') },
        { text: 'Çok karb', onPress: () => handleQuickSelect('Karbonhidrat fazla geldi, biraz azalt') },
        { text: 'Tamamen değiştir', onPress: () => handleQuickSelect('Planı tamamen farklı bir yaklaşımla yeniden üret') },
        { text: 'İptal', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [handleQuickSelect]);

  // Low-confidence verification handlers (Spec 5.32)
  // Confirm → AI sees "evet" (confirmation_yes); meal already saved, just acknowledge.
  // Reject  → AI sees "yanlış" (confirmation_no + correction); triggers repair flow.
  const handleLowConfConfirm = useCallback(() => {
    handleQuickSelect('Evet, doğru');
  }, [handleQuickSelect]);

  const handleLowConfReject = useCallback(() => {
    handleQuickSelect('Hayır, yanlış anladın — son kaydı sil');
  }, [handleQuickSelect]);

  // Save AI-generated recipe to library (Spec 7.7)
  const handleSaveRecipe = useCallback(async (messageId: string, recipe: RecipeData) => {
    if (!user?.id) return;
    try {
      const ingredients: RecipeIngredient[] = recipe.ingredients.map(i => ({
        name: i.name, amount: i.amount, unit: '',
      }));
      await saveRecipe({
        user_id: user.id,
        title: recipe.title,
        category: null,
        ingredients,
        instructions: '',
        total_calories: recipe.macros.calories,
        total_protein: recipe.macros.protein,
        prep_time_min: recipe.prepTime,
        cook_time_min: null,
        servings: recipe.servings,
        is_favorite: false,
      });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, recipeSaved: true } : m));
    } catch (err) {
      Alert.alert('Hata', (err as Error).message);
    }
  }, [user?.id]);

  // Backdate picker — quick options: today / yesterday / 2 days ago / reset
  const handleBackdateButton = useCallback(() => {
    Alert.alert(
      'Kayıt tarihi',
      'Geçmiş bir tarihe kayıt yapacaksan seç.',
      [
        { text: 'Bugün (default)', onPress: () => setBackdateDate(null) },
        { text: 'Dün', onPress: () => setBackdateDate(new Date(Date.now() - 86400000).toISOString().split('T')[0]) },
        { text: '2 gün önce', onPress: () => setBackdateDate(new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]) },
        { text: '3 gün önce', onPress: () => setBackdateDate(new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]) },
        { text: 'İptal', style: 'cancel' },
      ],
      { cancelable: true }
    );
  }, []);

  // Persona detection handlers (Spec 5.15)
  // Confirm → AI keeps persona; short acknowledgement.
  // Reject  → clear ai_summary.user_persona via chat; AI re-detects at next milestone.
  const handlePersonaConfirm = useCallback(() => {
    handleQuickSelect('Evet, beni doğru tanımladın');
  }, [handleQuickSelect]);

  const handlePersonaReject = useCallback(() => {
    handleQuickSelect('Hayır, ben farklıyım — persona tipimi unut');
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

      const { data, error } = await sendMessageToSession(sessionId, text);
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

  // Task chat lock: once the server-validated task_completion arrives on any
  // message in this session, the chat is "closed". Composer locks, user can
  // only proceed by tapping a next-task card. Prevents the model from drifting
  // into other topics after the session has logically ended.
  const taskSessionClosed = !!taskModeHint && messages.some(m => (m as UIMessage).taskCompletion?.completed);

  const sendDisabled = (!input.trim() && !photo) || sending || taskSessionClosed;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header */}
      <View style={{ paddingHorizontal: SPACING.xl, paddingTop: Platform.OS === 'web' ? 12 : Math.max(insets.top, 12), paddingBottom: SPACING.xs, flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, flex: 1 }}>Kochko</Text>
        <TouchableOpacity
          onPress={handleCopyConversation}
          style={{ padding: 6, borderRadius: 999, backgroundColor: colors.surfaceLight }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
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
          data={messages.filter(m => !(m.role === 'user' && m.content.startsWith('[SYSTEM_INIT]')))}
          keyExtractor={m => m.id}
          renderItem={({ item }) => <MessageBubble message={item} onAskWhy={handleAskWhy} dashboardMacros={dashboardMacros} macroTargets={macroTargets} onQuickSelect={handleQuickSelect} onConfirm={handlePlanConfirm} onReject={handlePlanReject} onLowConfConfirm={handleLowConfConfirm} onLowConfReject={handleLowConfReject} onPersonaConfirm={handlePersonaConfirm} onPersonaReject={handlePersonaReject} onSaveRecipe={handleSaveRecipe} totalCalories={totalCalories} weeklyBudgetRemaining={weeklyBudgetRemaining} onTTSToggle={handleTTSToggle} speakingMsgId={speakingMsgId} />}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.sm }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Typing indicator */}
      {sending && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <TypingIndicator />
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

      {/* Backdate banner — shows when user is logging for a past date */}
      {backdateDate && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.sm, borderWidth: 0.5, borderColor: colors.warning }}>
            <Ionicons name="calendar" size={14} color={colors.warning} />
            <Text style={{ color: colors.textSecondary, fontSize: 11, flex: 1 }}>
              Kayıt tarihi: {new Date(backdateDate).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
            <TouchableOpacity onPress={() => setBackdateDate(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500' }}>Bugun</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Voice transcription confirmation banner — user can edit input before sending */}
      {voiceConfirmation && Date.now() < voiceConfirmation.expiresAt && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.sm, borderWidth: 0.5, borderColor: colors.primary }}>
            <Ionicons name="mic" size={14} color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: 11, flex: 1 }} numberOfLines={2}>
              Duydum: "{voiceConfirmation.text}" — gonder veya duzenle
            </Text>
            <TouchableOpacity onPress={() => { setInput(''); setVoiceConfirmation(null); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500' }}>Iptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Undo banner */}
      {undoAction && Date.now() < undoAction.expiresAt && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <TouchableOpacity
            onPress={async () => {
              const undoText = `Son ${undoAction.type === 'meal_log' ? 'ogun' : undoAction.type === 'workout_log' ? 'antrenman' : 'supplement'} kaydini geri al`;
              setUndoAction(null);
              await sendMessageToSession(sessionId, undoText);
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

      {/* Remaining messages badge — onboarding bypass means unlimited; show only when ≤10 left */}
      {!isPremium && remainingMsgs != null && remainingMsgs <= 10 && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: 2 }}>
          {remainingMsgs === 0 ? (
            <TouchableOpacity
              onPress={() => router.push('/settings/premium')}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: SPACING.xs, paddingVertical: SPACING.xs,
                backgroundColor: colors.primary + '15', borderRadius: RADIUS.pill,
              }}
            >
              <Ionicons name="lock-closed" size={12} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>
                Günlük 50 mesaj hakkın bitti — Premium'a geç
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{
              color: remainingMsgs <= 5 ? colors.warning : colors.textMuted,
              fontSize: 10, textAlign: 'center',
            }}>
              {remainingMsgs} mesaj hakkı kaldı
            </Text>
          )}
        </View>
      )}

      {/* Input bar */}
      <View style={{
        paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm,
        paddingBottom: keyboardVisible || Platform.OS === 'web' ? SPACING.sm : Math.max(insets.bottom, SPACING.sm),
        borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.background,
      }}>
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end',
          backgroundColor: colors.card, borderRadius: 24,
          borderWidth: 0.5, borderColor: input.length > 0 ? colors.primary + '66' : colors.border,
          paddingHorizontal: SPACING.md, paddingVertical: 6,
          gap: 4,
        }}>
          {/* Text input */}
          <TextInput
            style={{
              flex: 1, color: taskSessionClosed ? colors.textMuted : colors.text, fontSize: 14,
              paddingVertical: 8, maxHeight: 120, lineHeight: 20,
            }}
            placeholder={taskSessionClosed ? 'Bu konu tamamlandı — yukarıdaki karta dokun' : 'Mesajını yaz...'}
            placeholderTextColor={colors.textMuted}
            value={input} onChangeText={setInput}
            multiline maxLength={2000} editable={!sending && !taskSessionClosed}
          />

          {/* Icon buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
            <TouchableOpacity
              onPress={takePhoto}
              accessibilityRole="button"
              accessibilityLabel="Foto çek"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardElevated,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <Ionicons name="camera-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openBarcodeScanner}
              accessibilityRole="button"
              accessibilityLabel="Barkod okut"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardElevated,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <Ionicons name="barcode-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleBackdateButton}
              accessibilityRole="button"
              accessibilityLabel={backdateDate ? `Kayıt tarihi: ${backdateDate}` : 'Geçmiş tarihe kaydet'}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: backdateDate ? colors.warning : colors.cardElevated,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <Ionicons name="calendar-outline" size={16}
                color={backdateDate ? '#fff' : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleVoiceToggle}
              accessibilityRole="button"
              accessibilityLabel={isRecordingVoice ? 'Ses kaydını durdur' : 'Sesli giriş başlat'}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
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
    { text: '30 yaşında, 80 kilo, 175 boy erkeğim', icon: 'person-outline' as const, color: '#22C55E' },
    { text: 'Kilo vermek istiyorum', icon: 'trending-down-outline' as const, color: '#EF4444' },
    { text: 'Kendimi tanıtmak istiyorum', icon: 'chatbubbles-outline' as const, color: '#6366F1' },
  ];
  const regularSuggestions = [
    { text: 'Bugün kahvaltıda 2 yumurta yedim', icon: 'restaurant-outline' as const, color: '#EF9F27' },
    { text: 'Bugünkü planımı oluştur', icon: 'calendar-outline' as const, color: '#1D9E75' },
    { text: 'Nereden başlayalım?', icon: 'compass-outline' as const, color: '#6366F1' },
    { text: 'Evde yapabileceğim antrenman öner', icon: 'barbell-outline' as const, color: '#EC4899' },
  ];
  const suggestions = isOnboarding ? onboardingSuggestions : regularSuggestions;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: SPACING.xl, paddingTop: SPACING.xxl, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Onboarding intro bubble */}
      {messages.length === 1 && messages[0].role === 'assistant' && (
        <View style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          borderBottomLeftRadius: 4,
          padding: SPACING.lg,
          marginBottom: SPACING.xxl,
          borderWidth: 0.5,
          borderColor: colors.border,
          ...(isDark ? {} : { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 }),
        }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>
            {messages[0].content}
          </Text>
        </View>
      )}

      {/* Fresh chat header — only when there are zero messages */}
      {messages.length === 0 && (
        <View style={{ marginBottom: SPACING.lg }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 18,
              backgroundColor: colors.primary + '22',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: SPACING.md,
            }}
          >
            <Ionicons name="chatbubbles" size={26} color={colors.primary} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
            Kochko ile konuş
          </Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>
            Beslenme, antrenman, uyku — ne yedin, nasıl gidiyor, bir sonraki hamle ne olsun.
          </Text>
        </View>
      )}

      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: SPACING.sm }}>
        ÖRNEK BAŞLANGIÇLAR
      </Text>

      <View style={{ gap: SPACING.sm }}>
        {suggestions.map((s, i) => (
          <TouchableOpacity
            key={i}
            accessibilityRole="button"
            accessibilityLabel={s.text}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACING.md,
              backgroundColor: colors.card,
              borderRadius: RADIUS.lg,
              paddingVertical: SPACING.md,
              paddingHorizontal: SPACING.lg,
              borderWidth: 0.5,
              borderColor: colors.border,
            }}
            onPress={() => onSuggestion(s.text)}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: s.color + '18',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={s.icon} size={16} color={s.color} />
            </View>
            <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{s.text}</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Thin wrapper around each message that fades + slides in on mount.
 * Pulled out of MessageBubble so hooks can live in a child component without
 * adding an effect per render to the main body.
 */
function MessageBubbleFrame({ isUser, children }: { isUser: boolean; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  const opacity = anim;
  return (
    <Animated.View
      style={{
        marginBottom: SPACING.sm,
        opacity,
        transform: [{ translateY }],
        alignItems: isUser ? 'flex-end' : 'stretch',
      }}
    >
      {children}
    </Animated.View>
  );
}

function MessageBubble({ message, onAskWhy, dashboardMacros, macroTargets, onQuickSelect, onConfirm, onReject, onLowConfConfirm, onLowConfReject, onPersonaConfirm, onPersonaReject, onSaveRecipe, totalCalories, weeklyBudgetRemaining, onTTSToggle, speakingMsgId }: {
  message: UIMessage;
  onAskWhy: (content: string) => void;
  dashboardMacros: { protein: number; carbs: number; fat: number };
  macroTargets: { protein: number; carbs: number; fat: number };
  onQuickSelect: (option: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  onLowConfConfirm: () => void;
  onLowConfReject: () => void;
  onPersonaConfirm: () => void;
  onPersonaReject: () => void;
  onSaveRecipe: (messageId: string, recipe: RecipeData) => void;
  totalCalories: number;
  weeklyBudgetRemaining: number | null;
  onTTSToggle: (msgId: string, text: string) => void;
  speakingMsgId: string | null;
}) {
  const { colors, isDark } = useTheme();
  const isUser = message.role === 'user';

  // Detect which silent actions this message triggered (for visual badges)
  const allActions = [...(message.actions ?? []), ...(message.actions_executed ?? [])];
  const savedBadges: { icon: string; label: string; color: string }[] = [];
  const seen = new Set<string>();
  for (const a of allActions) {
    if (seen.has(a.type)) continue;
    seen.add(a.type);
    if (a.type === 'profile_update') savedBadges.push({ icon: 'person-circle-outline', label: 'Profil güncellendi', color: '#1D9E75' });
    else if (a.type === 'meal_log') savedBadges.push({ icon: 'restaurant-outline', label: 'Öğün kaydedildi', color: '#EF9F27' });
    else if (a.type === 'weight_log') savedBadges.push({ icon: 'scale-outline', label: 'Tartı kaydedildi', color: '#E91E63' });
    else if (a.type === 'water_log') savedBadges.push({ icon: 'water-outline', label: 'Su kaydedildi', color: '#2F80ED' });
    else if (a.type === 'sleep_log') savedBadges.push({ icon: 'moon-outline', label: 'Uyku kaydedildi', color: '#7F77DD' });
    else if (a.type === 'workout_log') savedBadges.push({ icon: 'fitness-outline', label: 'Antrenman kaydedildi', color: '#22C55E' });
    else if (a.type === 'supplement_log') savedBadges.push({ icon: 'medical-outline', label: 'Takviye kaydedildi', color: '#14B8A6' });
    else if (a.type === 'goal_suggestion') savedBadges.push({ icon: 'flag-outline', label: 'Hedef eklendi', color: '#F59E0B' });
  }

  return (
    <MessageBubbleFrame isUser={isUser}>
      <View style={{
        maxWidth: '86%',
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? colors.primary : colors.card,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderBottomRightRadius: isUser ? 4 : 18,
        borderBottomLeftRadius: isUser ? 18 : 4,
        ...(isUser ? {} : { borderWidth: 0.5, borderColor: colors.border }),
        ...(isDark
          ? {}
          : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: isUser ? 0.12 : 0.04, shadowRadius: 2, elevation: 0 }),
      }}>
        {/* Message content (strip any leaked structured XML tags defensively) */}
        <Text
          selectable
          style={{
            color: isUser ? '#fff' : colors.text,
            fontSize: 14,
            lineHeight: 21,
          }}
        >
          {sanitizeAssistantText(message.content)}
        </Text>

        {/* Navigate-to chip — AI hints the user to a plan screen (Phase 5) */}
        {!isUser && message.navigateTo && (
          <TouchableOpacity
            onPress={() => router.push(message.navigateTo as never)}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: SPACING.sm,
              alignSelf: 'flex-start',
              backgroundColor: '#1D9E7518',
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderWidth: 0.5,
              borderColor: '#1D9E7544',
            }}
          >
            <Ionicons
              name={message.navigateTo.includes('diet') ? 'restaurant-outline' : message.navigateTo.includes('workout') ? 'barbell-outline' : 'open-outline'}
              size={12}
              color="#1D9E75"
            />
            <Text style={{ color: '#1D9E75', fontSize: 11, fontWeight: '700' }}>
              {message.navigateTo === '/plan/diet'
                ? 'Diyet planına git'
                : message.navigateTo === '/plan/workout'
                  ? 'Spor planına git'
                  : 'Aç →'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Silent action badges (profile update, meal log, etc.) — replaces verbal "Kaydettim" */}
        {!isUser && savedBadges.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
            {savedBadges.map((b) => (
              <SavedBadge key={b.label} icon={b.icon} label={b.label} color={b.color} />
            ))}
          </View>
        )}

        {/* Onboarding task handoff — MASTER_PLAN §4.1 */}
        {!isUser && message.taskCompletion && (
          <TaskCompletionCard
            taskCompletion={message.taskCompletion}
            colors={colors}
          />
        )}

        {/* Inline rich content for AI responses (Spec 5.20 + 5.34 macro ring) */}
        {!isUser && message.actions?.some(a => a.type === 'meal_log' && a.feedback) && (
          <MacroRing
            protein={dashboardMacros.protein}
            carbs={dashboardMacros.carbs}
            fat={dashboardMacros.fat}
            targets={macroTargets}
          />
        )}

        {/* Recipe card for recipe task_mode */}
        {!isUser && message.recipeData && (
          <RecipeCard
            title={message.recipeData.title}
            prepTime={message.recipeData.prepTime}
            servings={message.recipeData.servings}
            ingredients={message.recipeData.ingredients}
            macros={message.recipeData.macros}
            saved={message.recipeSaved}
            onSave={() => onSaveRecipe(message.id, message.recipeData as RecipeData)}
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

        {/* Low-confidence verification buttons (Spec 5.32) */}
        {!isUser && message.hasLowConfidenceVerification && !message.hasPlanSuggestion && (
          <ConfirmRejectButtons onConfirm={onLowConfConfirm} onReject={onLowConfReject} />
        )}

        {/* Persona detection card — shown once after 100+ messages (Spec 5.15) */}
        {!isUser && message.personaDetected && (
          <PersonaCard persona={message.personaDetected} onConfirm={onPersonaConfirm} onReject={onPersonaReject} />
        )}

        {/* Timestamp + TTS button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 6 }}>
          {!isUser && (
            <TouchableOpacity onPress={() => onTTSToggle(message.id, message.content)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Ionicons
                name={speakingMsgId === message.id ? 'stop-circle-outline' : 'volume-medium-outline'}
                size={14}
                color={speakingMsgId === message.id ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
          )}
          <Text style={{ color: isUser ? 'rgba(255,255,255,0.6)' : colors.textMuted, fontSize: 10, alignSelf: 'flex-end' }}>
            {new Date(message.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
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

      {/* (Old outer ActionFeedback removed — replaced by colorful savedBadges inside bubble) */}

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
    </MessageBubbleFrame>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TaskCompletionCard — MASTER_PLAN §4.1
// Shows the summary chip + up to 3 next-task cards after a task chat
// completes its checklist (server-validated task_completion).
// ═══════════════════════════════════════════════════════════════════

function TaskCompletionCard({
  taskCompletion,
  colors,
}: {
  taskCompletion: { completed: string; summary: string; next_suggestions: string[] };
  colors: any;
}) {
  // Phase 7: mini celebration on mount — scale-in bounce on the summary chip +
  // a light vibration pulse. No confetti library (would need native rebuild);
  // Animated.spring is enough to feel rewarding without being noisy.
  const chipScale = useRef(new Animated.Value(0.6)).current;
  const chipOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    try { Vibration.vibrate([0, 40, 40, 30]); } catch { /* silent on devices without vibrator */ }
    Animated.parallel([
      Animated.spring(chipScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(chipOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [chipScale, chipOpacity]);

  const suggestionTasks = taskCompletion.next_suggestions
    .map(getTaskByKey)
    .filter((t): t is NonNullable<ReturnType<typeof getTaskByKey>> => t !== null)
    .slice(0, 3);

  const handleTap = async (task: NonNullable<ReturnType<typeof getTaskByKey>>) => {
    const id = await createSession({ title: task.title, topicTags: [task.key] });
    if (id) {
      router.push({
        pathname: `/chat/${id}`,
        params: { prefill: task.prefillMessage, taskModeHint: task.taskModeHint },
      });
    }
  };

  return (
    <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
      {/* Summary chip — animated celebration entrance */}
      <Animated.View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          alignSelf: 'flex-start',
          backgroundColor: '#1D9E7518',
          borderRadius: 999,
          paddingHorizontal: 10, paddingVertical: 5,
          transform: [{ scale: chipScale }],
          opacity: chipOpacity,
        }}
      >
        <Ionicons name="checkmark-circle" size={14} color="#1D9E75" />
        <Text style={{ color: '#1D9E75', fontSize: 11, fontWeight: '700' }}>
          {taskCompletion.summary ? `Kochko seni tanıdı — ${taskCompletion.summary}` : 'Bu konu tamamlandı'}
        </Text>
      </Animated.View>

      {/* Next-task suggestion cards */}
      {suggestionTasks.length > 0 && (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
            Devam edebileceğin konular
          </Text>
          {suggestionTasks.map((task) => (
            <TouchableOpacity
              key={task.key}
              onPress={() => handleTap(task)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                backgroundColor: colors.background,
                borderWidth: 0.5, borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
              }}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 8,
                backgroundColor: task.color + '20',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name={task.icon as any} size={14} color={task.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{task.title}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                  {task.description}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * SavedBadge — small pill that bounces in on mount.
 * Makes silent saves (principle 2) noticeable without adding chat text noise.
 */
function SavedBadge({ icon, label, color }: { icon: string; label: string; color: string }) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: color + '18',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        transform: [{ scale }],
        opacity,
      }}
    >
      <Ionicons name={icon as any} size={12} color={color} />
      <Text style={{ color, fontSize: 10, fontWeight: '600' }}>{label}</Text>
    </Animated.View>
  );
}
