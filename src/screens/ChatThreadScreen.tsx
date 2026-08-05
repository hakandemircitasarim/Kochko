/**
 * CHAT THREAD SCREEN — the ONE continuous coach conversation (#S1).
 *
 * ux-pass2: this implementation moved out of app/chat/[sessionId].tsx into a plain
 * component so the Kochko TAB can host it directly. The old shape (tab = resolver that
 * router.replace()'d to a root-level /chat/[id] stack) destroyed the tab navigator on
 * every entry: tab bar gone while chatting, hardware back dumped on Ana Sayfa, full
 * remount + network reload per hop, composer drafts lost. Embedded-in-tab, the thread
 * keeps the tab bar, keeps its state across tab switches, and back = home tab.
 * app/chat/[sessionId].tsx survives only as a param-forwarding redirect for deep links.
 */
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, Keyboard, Share, Animated,
  NativeSyntheticEvent, NativeScrollEvent, BackHandler, Modal, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlanPreviewCard } from '@/components/plan/PlanPreviewCard';
import { FullPlanModal } from '@/components/plan/FullPlanModal';
import type { PlanData } from '@/services/plan.service';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useAuthStore } from '@/stores/auth.store';
import {
  sendMessageToSession, sendPhotoToSession, loadSessionMessages, loadOlderSessionMessages,
  queueMessageOffline, processOfflineQueue, getOfflineQueueSize, getCachedThread,
  getTaskOpenerFiredAt, markTaskOpenerFired, stripMachineMarkers, PENDING_REPLY_MESSAGE,
  type ChatMessage,
  approvePlanInChat,
  setPendingAcceptedNudge,
  type ChatResponse,
} from '@/services/chat.service';
import { getTaskByKey, getTaskByModeHint, getIncompleteTasks, getTasksWithStatus, type OnboardingTask } from '@/services/onboarding-tasks.service';
import { deriveNutritionTargets } from '@/lib/nutrition-targets';
import { lookupBarcode, calculateServing } from '@/services/barcode.service';
import { saveRecipe, type RecipeIngredient } from '@/services/recipes.service';
import { startRecording, stopAndTranscribe } from '@/services/voice.service';
import { getRemainingMessages, syncRemainingFromServer } from '@/services/message-counter.service';
import { speak, stopSpeaking } from '@/services/tts.service';
import { detectRepairIntent, type RepairDetection } from '@/services/repair.service';
import { FeedbackButtons } from '@/components/chat/FeedbackButtons';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import {
  MacroSummary, MacroRing, SimulationCard, WeeklyBudgetBar, QuickSelectButtons,
  RecipeCard, ConfirmRejectButtons, PersonaCard, ConfidenceBadge,
} from '@/components/chat/RichMessage';
// FIX (audit: çift offline banner) — inline ui/OfflineBanner kaldırıldı; çevrimdışı
// göstergesi tek kaynak olan global common/OfflineBanner'a (app/_layout.tsx) bırakıldı.
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { getContrastColor } from '@/lib/accessibility';
import { isActivePremium } from '@/lib/premium-gate';
import { trace } from '@/lib/uiTrace';
import { formatISODateTR } from '@/lib/day-boundary';

// Plan-rejection reasons (Spec 7.1 — multi-turn refine). Each entry is the short,
// human-facing chip label + the fuller engineered instruction sent to the model.
// Previously rendered as a native Alert action sheet; now inline tappable chips in
// the bubble. Reasons + effects are byte-for-byte identical — only presentation
// changed (Alert -> chips).
const PLAN_REJECT_REASONS: { label: string; instruction: string }[] = [
  { label: 'Kahvaltı', instruction: 'Kahvaltı farklı olsun — yeni öneri ver' },
  { label: 'Öğle', instruction: 'Öğle yemeğini değiştir — yeni öneri ver' },
  { label: 'Akşam', instruction: 'Akşam yemeğini değiştir — yeni öneri ver' },
  { label: 'Çok protein', instruction: 'Protein fazla geldi, biraz azalt' },
  { label: 'Çok karb', instruction: 'Karbonhidrat fazla geldi, biraz azalt' },
  { label: 'Tamamen değiştir', instruction: 'Planı tamamen farklı bir yaklaşımla yeniden üret' },
];

// FIX (ux-ideas #8): persistent one-tap quick replies shown above the composer once a
// conversation is underway and the box is empty — so continuing never means staring at a
// blank composer ("şimdi ne desem?"). These SEND immediately (handleQuickSelect), unlike the
// first-run StarterSuggestions which only prefill the composer.
const QUICK_REPLIES = ['Bugün ne yesem?', 'Bugünkü planım', 'Nasıl gidiyorum?', 'Bugün ne yapmalıyım?'];

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
  actions?: { type: string; feedback: string | null; confidence?: 'high' | 'medium' | 'low' }[];
  // B2a: typed per-action receipts from the envelope — lets the badge row tell a FAILED write
  // from a successful one instead of green-stamping every executed action.
  receipts?: import('@contracts/turn-envelope').ActionReceipt[] | null;
  showFeedback?: boolean;
  simulationData?: SimulationData | null;
  recipeData?: RecipeData | null;
  quickSelectOptions?: string[] | null;
  hasPlanSuggestion?: boolean;
  // F3/C1: the plan the user is being asked to approve — rendered as a real preview card, and the
  // identity Onayla carries back. Without these the buttons sat under an INVISIBLE plan.
  planSnapshot?: Record<string, unknown> | null;
  planDraftId?: string | null;
  planType?: 'diet' | 'workout' | null;
  hasLowConfidenceVerification?: boolean;
  personaDetected?: string | null;
  recipeSaved?: boolean;
  taskCompletion?: { completed: string; summary: string; next_suggestions: string[] } | null;
  navigateTo?: string | null;
  reasoning?: string | null; // AI's thinking for this message — shown inline on "Neden?" toggle
  // Visible topic-entry marker: the task opener prompt itself is an invisible [SYSTEM_INIT],
  // so without this pill the coach appears to change subject out of nowhere (ux-pass2).
  topicMarker?: string;
  failed?: boolean;
  errorMessage?: string;
  retryPayload?: { text: string; photoUri: string | null; taskMode?: string; backdate?: string | null };
  // FIX (audit UI-CHT-05): local device URI of a photo the user just sent, so the
  // optimistic user bubble can show the actual meal photo thumbnail instead of the
  // literal '[Foto gönderildi]' placeholder. Client-only; not persisted/loaded.
  localPhotoUri?: string;
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

/**
 * Turn a flat message list into a list of {kind: 'separator' | 'message'} items,
 * inserting a date label before each new calendar day. Today's date is labeled
 * "Bugün", yesterday "Dün", older days get a short human date.
 */
type Row = { kind: 'separator'; key: string; label: string } | { kind: 'message'; msg: UIMessage };

function withDateSeparators(messages: UIMessage[]): Row[] {
  const rows: Row[] = [];
  let currentDay = '';
  const today = new Date();
  const todayKey = today.toDateString();
  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayKey = yesterday.toDateString();
  for (const m of messages) {
    const d = new Date(m.created_at);
    const dayKey = d.toDateString();
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      let label: string;
      if (dayKey === todayKey) label = 'Bugün';
      else if (dayKey === yesterdayKey) label = 'Dün';
      else label = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      rows.push({ kind: 'separator', key: dayKey, label });
    }
    rows.push({ kind: 'message', msg: m });
  }
  return rows;
}

function DateSeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.sm }}>
      <View
        style={{
          paddingHorizontal: SPACING.md,
          paddingVertical: 3,
          borderRadius: RADIUS.full,
          backgroundColor: colors.surfaceLight,
        }}
      >
        <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// Visible topic-entry pill (ux-pass2): a task/chip tap fires an INVISIBLE [SYSTEM_INIT]
// opener — without this marker the coach appears to switch subjects out of nowhere.
function TopicMarker({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.sm }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          paddingHorizontal: SPACING.md, paddingVertical: 4,
          borderRadius: RADIUS.full,
          backgroundColor: colors.primary + '15',
          borderWidth: 0.5, borderColor: colors.primary + '33',
        }}
      >
        <Ionicons name="chatbubbles-outline" size={11} color={colors.primary} />
        <Text style={{ ...TYPE.overline, color: colors.primary }}>
          Konu: {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * Split a text into plain/bold segments for rendering in Text nodes.
 * Supports only `**bold**` — the most common markdown AI produces. Any other
 * markup (italic, links, headers) is passed through verbatim to avoid surprise
 * renders.
 */
function splitBoldSegments(text: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), bold: false });
  return parts.length === 0 ? [{ text, bold: false }] : parts;
}

// FIX (ux-ideas #27): coach replies are often multi-item (meal lists, step-by-step plans). The
// old single-Text render ran '- madde' and '1.' lines together as a wall of text. This renders
// line-based structure — '-/•/*' and '1./1)' become indented list rows, blank lines become
// paragraph gaps — while **bold** still applies inline. Only used when the text actually has
// structure (hasRichStructure), so short replies keep the original single-Text path.
function hasRichStructure(text: string): boolean {
  return /(^|\n)\s*([-•*]|\d+[.)])\s+/.test(text) || /\n\s*\n/.test(text);
}
// FIX (ux-round4 #23): truncate a long reply for the collapsed "Devamını oku" state so a wall
// doesn't fill the viewport and bury the composer. Clamps by BOTH line count (a 13-short-line list
// is long even under the char cap — review fix) and char count, at a sentence/word boundary.
function clampText(text: string, maxChars: number, maxLines: number): string {
  let t = text;
  const lines = t.split('\n');
  if (lines.length > maxLines) t = lines.slice(0, maxLines).join('\n');
  if (t.length > maxChars) {
    const slice = t.slice(0, maxChars);
    const brk = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
    t = brk > maxChars * 0.6 ? slice.slice(0, brk) : slice;
  }
  if (t.length >= text.length) return text; // nothing actually trimmed
  // review fix: if the cut left a dangling opening '**' (odd count), drop it so the collapsed
  // preview doesn't leak a literal marker (splitBoldSegments only matches balanced pairs).
  if (((t.match(/\*\*/g) || []).length) % 2 === 1) t = t.slice(0, t.lastIndexOf('**'));
  return t.trimEnd() + '…';
}
function MessageRichText({ content, color, onLongPress }: { content: string; color: string; onLongPress: () => void }) {
  const lines = content.split('\n');
  return (
    <View>
      {lines.map((line, idx) => {
        const listMatch = line.match(/^\s*([-•*]|\d+[.)])\s+(.*)$/);
        if (listMatch) {
          const isNum = /^\d/.test(listMatch[1]);
          const marker = isNum ? `${listMatch[1].replace(/[.)]/, '')}.` : '•';
          return (
            <View key={idx} style={{ flexDirection: 'row', gap: 6, marginTop: idx === 0 ? 0 : 3, paddingLeft: 2 }}>
              {/* The conversation is the app. This is its reading size — and 14/21 is a desktop
                  table size, tight for Turkish, whose descenders (g/ğ/ş/ç/y) crowd the next line.
                  TYPE.body (15/22) is the scale's designated reading step. */}
              <Text style={{ ...TYPE.body, color, fontWeight: isNum ? '700' : '400' }}>{marker}</Text>
              <Text selectable onLongPress={onLongPress} style={{ ...TYPE.body, color, flex: 1 }}>
                {splitBoldSegments(listMatch[2]).map((seg, i) => (
                  <Text key={i} style={seg.bold ? { fontWeight: '700' } : undefined}>{seg.text}</Text>
                ))}
              </Text>
            </View>
          );
        }
        if (line.trim() === '') return <View key={idx} style={{ height: 6 }} />;
        return (
          <Text key={idx} selectable onLongPress={onLongPress} style={{ ...TYPE.body, color, marginTop: idx === 0 ? 0 : 2 }}>
            {splitBoldSegments(line).map((seg, i) => (
              <Text key={i} style={seg.bold ? { fontWeight: '700' } : undefined}>{seg.text}</Text>
            ))}
          </Text>
        );
      })}
    </View>
  );
}

// FIX (ux-ideas #24): the server-authored crisis (detectCrisis) and medical-emergency
// (detectEmergency) replies both instruct "HEMEN 112'yi ara". Detect that exact directive so the
// highest-risk moment renders as a distinct, unmissable card with a one-tap dialable 112 — rather
// than a life-saving number buried in an ordinary chat bubble that reads like any other.
function isEmergencyMessage(text: string): boolean {
  return /112['’]?yi ara/i.test(text) || /hemen\s*112/i.test(text);
}
function CrisisBlock({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.errorLight, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: colors.error, padding: SPACING.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
        <Ionicons name="alert-circle" size={20} color={colors.error} />
        <Text style={{ color: colors.error, ...TYPE.overline }}>ACİL DESTEK</Text>
      </View>
      <Text selectable style={{ ...TYPE.body, color: colors.text }}>{text}</Text>
      <TouchableOpacity activeOpacity={MOTION.pressOpacity}
        onPress={() => { haptics.tap(); Linking.openURL('tel:112').catch(() => {}); }}
        accessibilityRole="button"
        accessibilityLabel="Hemen 112'yi ara"
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md, minHeight: 48, borderRadius: RADIUS.md, backgroundColor: colors.error }}
      >
        <Ionicons name="call" size={18} color={getContrastColor(colors.error)} />
        <Text style={{ color: getContrastColor(colors.error), ...TYPE.headline }}>Hemen 112'yi Ara</Text>
      </TouchableOpacity>
    </View>
  );
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

// Extract the model's <reasoning> block (its "thinking" for this reply). We keep
// it on the message and reveal it inline on the "Neden?" toggle — like ChatGPT's
// show-thinking — instead of stripping it and forcing a second round-trip.
function parseReasoning(content: string): { cleanContent: string; reasoning: string | null } {
  const match = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  if (!match) return { cleanContent: content, reasoning: null };
  const reasoning = match[1].trim();
  const cleanContent = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/, '').trim();
  return { cleanContent, reasoning: reasoning || null };
}

// FIX (kullanıcı bulgusu): DB'den/önbellekten YÜKLENEN mesajlar reasoning'lerini
// kaybediyordu — sanitizeAssistantText <reasoning>'i yakalamadan siliyor, "Düşünce
// süreci" paneli yeniden açılışta ölüyordu. Bütün yükleme yolları (ilk sayfa, cache
// hidrasyonu, poll, focus-reconcile, eski-sayfa prepend) bu eşleyiciden geçer:
// parseReasoning ÖNCE çalışır, blok içerikten sökülüp mesajın `reasoning` alanına
// taşınır — panel canlı mesajlardaki gibi reload sonrası da çalışır.
function toUIMessage(m: ChatMessage): UIMessage {
  let content = m.content;
  let reasoning: string | undefined;
  if (m.role === 'assistant' && content.includes('<reasoning>')) {
    const parsed = parseReasoning(content);
    content = parsed.cleanContent;
    reasoning = parsed.reasoning ?? undefined;
  }
  if (m.role !== 'assistant') return { ...m, content, reasoning };
  // ux-sweep (CHT-02): sunucu <confirm_reject/> işaretini BİLEREK kayıtlı metinde tutuyor ki
  // geçmiş yüklemesi de Onayla/Değiştir butonlarını çizsin — ama hiçbir yükleme yolu bayrağı
  // hesaplamıyordu; sanitize işareti sessizce silip planı onaylanamaz bırakıyordu (uygulamayı
  // kapatıp açan kullanıcı için plan akışı ölüyordu). planType task_mode'dan türer; draftId
  // null kalır — sunucu onayda en son taslağı çözer.
  const hasPlan = hasConfirmRejectIndicator(content, m.task_mode);
  content = stripMachineMarkers(content);
  return {
    ...m, content, reasoning,
    hasPlanSuggestion: hasPlan || undefined,
    planType: hasPlan ? (((m.task_mode ?? '').includes('workout')) ? 'workout' : 'diet') : undefined,
  };
}

function parseQuickSelect(content: string): { cleanContent: string; options: string[] | null } {
  const match = content.match(/<quick_select>([\s\S]*?)<\/quick_select>/);
  if (!match) return { cleanContent: content, options: null };
  try {
    const parsed = JSON.parse(match[1]);
    // Validate shape: the model can emit a non-array (string/object) that is valid JSON
    // but would crash options.map() on render (#crash-audit). Only accept a string array.
    if (!Array.isArray(parsed) || !parsed.every((o) => typeof o === 'string')) {
      return { cleanContent: content, options: null };
    }
    const cleanContent = content.replace(/<quick_select>[\s\S]*?<\/quick_select>/, '').trim();
    return { cleanContent, options: parsed as string[] };
  } catch {
    return { cleanContent: content, options: null };
  }
}

function parseRecipeData(content: string): { cleanContent: string; data: RecipeData | null } {
  const match = content.match(/<recipe>([\s\S]*?)<\/recipe>/);
  if (!match) return { cleanContent: content, data: null };
  try {
    const data = JSON.parse(match[1]) as RecipeData;
    // Validate shape: RecipeCard renders data.ingredients.map(...) and data.macros.* —
    // a valid-JSON-but-wrong-shape recipe block from the model would crash the bubble
    // on render (#crash-audit). Require the fields the card dereferences.
    if (!data || typeof data !== 'object' || !Array.isArray((data as RecipeData).ingredients) || !(data as RecipeData).macros || typeof (data as RecipeData).macros !== 'object') {
      return { cleanContent: content, data: null };
    }
    const cleanContent = content.replace(/<recipe>[\s\S]*?<\/recipe>/, '').trim();
    return { cleanContent, data };
  } catch {
    return { cleanContent: content, data: null };
  }
}

// Map the active task mode / photo send to an intentional typing-indicator label,
// so a multi-second wait reads as purposeful work rather than a dead spinner.
function typingLabelFor(taskMode: string | undefined, isPhoto: boolean): string {
  return typingStagesFor(taskMode, isPhoto)[0];
}

// FIX (ux-ideas #7): a 30-60s plan/photo turn showed ONE static label — a frozen spinner.
// These ordered stages rotate as the wait grows so it reads as purposeful, progressing work.
function typingStagesFor(taskMode: string | undefined, isPhoto: boolean): string[] {
  if (isPhoto) return ['Fotoğrafı açıyorum', 'Yemeği tanıyorum', 'Kalorileri hesaplıyorum'];
  switch (taskMode) {
    case 'plan':
    case 'plan_suggestion':
    case 'plan_diet':
    case 'plan_workout':
      return ['Planını hazırlıyorum', 'Öğünleri dengeliyorum', 'Son rötuşları yapıyorum'];
    case 'recipe':
      return ['Tarifini yazıyorum', 'Malzemeleri ölçüyorum', 'Adımları sıralıyorum'];
    default:
      return ['Kochko yazıyor', 'Düşünüyorum'];
  }
}

function hasConfirmRejectIndicator(content: string, taskMode?: string): boolean {
  // Trust only the explicit server marker / plan_suggestion mode. The old substring
  // fallback (`taskMode === 'plan' && content.includes('plan')`) fired on virtually
  // every plan-mode reply — offering an "Onayla" button for plans that didn't exist
  // yet (verified audit W#52).
  return !!content.match(/<confirm_reject\s*\/?>/) || taskMode === 'plan_suggestion';
}

/**
 * Detects the low-confidence verification sentence that ai-chat auto-appends
 * when parsed meal confidence < 0.7. Phrasing: "Dogru anladiysam: X. Bu dogru mu?"
 */
function hasLowConfidenceVerificationIndicator(content: string): boolean {
  const lower = content.toLocaleLowerCase('tr');
  return lower.includes('dogru anladiysam') || lower.includes('doğru anladıysam');
}

export default function ChatThreadScreen({ sessionId }: { sessionId: string }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  // Hosted inside the (tabs)/chat route — params land on the TAB route. Normalize '' to
  // undefined: task exit clears params via router.setParams({taskModeHint: ''}) and every
  // truthiness check below must read that as "no task".
  const rawParams = useLocalSearchParams<{ prefill?: string; taskModeHint?: string; openCamera?: string; taskNonce?: string; onbWelcome?: string; acceptedNudgeId?: string }>();
  const prefill = rawParams.prefill || undefined;
  // F3/C5: the accepted offer's identity — forwarded on the FIRST send so the server can stamp
  // coaching_messages.accepted_at deterministically (acceptance must not depend on the LLM
  // recognising a quoted reference).
  const acceptedNudgeId = rawParams.acceptedNudgeId || undefined;
  const taskModeHint = rawParams.taskModeHint || undefined;
  const openCamera = rawParams.openCamera || undefined;
  const taskNonce = rawParams.taskNonce || undefined;
  // FIX (ux-ideas #19): deterministic onboarding welcome passed from the form (numbers in
  // scope there). Rendered as the instant first bubble so first-value never waits on the LLM.
  const onbWelcome = rawParams.onbWelcome || undefined;
  // one task-opener fire per navigation (see the load effect)
  const taskInitKeyRef = useRef<string | null>(null);
  // Embedded in the tab shell: "back" leaves the conversation for the dashboard TAB —
  // the navigator stays alive, so tab state and this thread's state survive the hop.
  const handleBack = useCallback(() => {
    router.navigate('/(tabs)');
  }, []);
  // Android hardware back mirrors the chevron; without this, back from the tab root
  // would exit the app.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => sub.remove();
  }, [handleBack]));
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const refreshDashboard = useDashboardStore(s => s.fetchToday);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  // FIX (ux-round4 #24): full-height compose modal for long drafts (the inline box caps at ~5 lines
  // with internal scroll). Shares the same `input` state, so opening/closing loses nothing.
  const [composeExpanded, setComposeExpanded] = useState(false);
  // #S1 (one-thread): the onboarding task rail moved here from the retired session-list screen —
  // tasks now open as topics INSIDE this same conversation instead of spawning session islands.
  const [railTasks, setRailTasks] = useState<OnboardingTask[]>([]);
  // Review fix (ux-pass2): memoize the count — the inline filter().length allocated a
  // full array copy on every render (each keystroke / countdown tick) just for a dep.
  const completedTaskCount = useMemo(
    () => messages.reduce((n, m) => n + ((m as UIMessage).taskCompletion?.completed ? 1 : 0), 0),
    [messages],
  );
  useEffect(() => {
    if (!user?.id) return;
    getIncompleteTasks(user.id).then(setRailTasks).catch(() => {});
    // refetch after a task completes so the finished card drops off the rail
  }, [user?.id, completedTaskCount]);
  // FIX (kullanıcı bulgusu): tamamlanma kartındaki öneriler TAMAMLANMIŞ konuları
  // gösterebiliyordu — sunucunun next_suggestions'ı durumdan habersiz. Eksik konu
  // anahtarları TaskCompletionCard'a inilir ve orada filtre olarak kullanılır.
  // useMemo: MessageBubble memo'lu — her render'da taze dizi kimliği memoyu kırardı.
  const incompleteKeys = useMemo(() => railTasks.map(t => t.key), [railTasks]);
  // FIX (ux-ideas #8): hide the quick-reply strip when the last turn already demands a specific
  // response — a user message still awaiting a reply, a failed bubble, a just-entered topic
  // opener, or an assistant turn offering inline choices (quick-select / plan confirm / verify).
  const suppressQuickReplies = useMemo(() => {
    const last = messages.length ? messages[messages.length - 1] : null;
    if (!last) return true;
    return last.role === 'user' || !!last.failed || !!last.topicMarker
      || !!(last.quickSelectOptions && last.quickSelectOptions.length)
      || !!last.hasPlanSuggestion || !!last.hasLowConfidenceVerification;
  }, [messages]);
  const openTaskTopic = useCallback((task: OnboardingTask) => {
    // taskNonce: same task re-tapped must re-fire the topic opener (identical params wouldn't).
    // Embedded in the tab: swap params in place — no route replace, no remount, no reload.
    router.setParams({ prefill: task.prefillMessage, taskModeHint: task.taskModeHint, taskNonce: String(Date.now()) });
  }, []);
  // FIX (kullanıcı bulgusu: "toplam kartları görmeliyiz — hangileri bitti hangileri
  // bitmedi"): başlıktaki "Konular" genel bakış modalının durumu. Liste modal her
  // açılışta tazelenir; hata dürüst bir "tekrar dene" satırı olarak yüzeye çıkar.
  const [topicsModalVisible, setTopicsModalVisible] = useState(false);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState(false);
  const [topicsList, setTopicsList] = useState<{ task: OnboardingTask; completed: boolean }[]>([]);
  const loadTopicsList = useCallback(async () => {
    if (!user?.id) return;
    setTopicsLoading(true);
    setTopicsError(false);
    try {
      setTopicsList(await getTasksWithStatus(user.id));
    } catch {
      setTopicsError(true);
    } finally {
      setTopicsLoading(false);
    }
  }, [user?.id]);
  const openTopicsModal = useCallback(() => {
    haptics.tap();
    setTopicsModalVisible(true);
    void loadTopicsList();
  }, [loadTopicsList]);
  // FIX (kullanıcı bulgusu: "klavye düzeni çok kalabalık"): kamera + barkod + geçmiş
  // tarih tek "+" düğmesinin arkasında — açılınca composer ÜSTÜNDE kompakt çip sırası.
  const [showAttachTray, setShowAttachTray] = useState(false);
  // FIX (ux-round2 #8): in-thread search — the one continuous thread grows for weeks and "geçen
  // hafta koç ne demişti" had no answer but endless scrolling. A live client-side FILTER over the
  // loaded window (safer than scrollToIndex on an inverted list); honestly scoped to loaded msgs.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [sending, setSending] = useState(false);
  // Intentional, context-aware label under the typing dots so long LLM waits read
  // as purposeful ("Planını hazırlıyorum…") instead of a blank spinner.
  const [typingLabel, setTypingLabel] = useState<string | undefined>(undefined);
  // FIX (ux-ideas #7): rotating typing stages + a cancel affordance after a long wait.
  const [typingStages, setTypingStages] = useState<string[]>([]);
  const [typingStageIdx, setTypingStageIdx] = useState(0);
  const [showTypingCancel, setShowTypingCancel] = useState(false);
  const cancelledSendRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // FIX (audit UX-CHT-06): upward pagination state. hasMoreOlder is set when the initial
  // load returns a full page (PAGE_SIZE), implying older history exists beyond the window.
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // FIX (ux-pass5): a FAILED older-page fetch must not read as end-of-history — this flag
  // keeps the load-older button visible with a retry label instead of latching it away.
  const [olderLoadFailed, setOlderLoadFailed] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  // FIX (ux-round2 #15): tap a sent/preview photo to view it full-screen (verify the meal shot).
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);
  // Sohbetteki plan önizleme kartı "Detayı görmek için dokun" diyor ama onPress'i boştu —
  // dokunuş görsel geri bildirim veriyor, hiçbir şey açmıyordu. Onaylamadan önce planın
  // TAMAMINI görmek tam da bu kartın vaadi; FullPlanModal zaten yazılmıştı, bağlanmamıştı.
  const [fullPlan, setFullPlan] = useState<{ plan: PlanData; weekStart?: string } | null>(null);
  const [undoAction, setUndoAction] = useState<{ type: string; messageId: string; expiresAt: number } | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceConfirmation, setVoiceConfirmation] = useState<{ text: string; expiresAt: number } | null>(null);
  const [backdateDate, setBackdateDate] = useState<string | null>(null); // YYYY-MM-DD for manual date override
  const [remainingMsgs, setRemainingMsgs] = useState<number | null>(null);
  // When the edge function signals rate_limited we disable input for 60s. The
  // backend gates, so this is purely UX — stops the user from hammering Send.
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    if (!rateLimitedUntil) { setRateLimitCountdown(0); return; }
    const tick = () => {
      const remain = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setRateLimitCountdown(remain);
      if (remain === 0) setRateLimitedUntil(null);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [rateLimitedUntil]);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const listRef = useRef<FlatList>(null);
  const barcodeProcessingRef = useRef(false); // debounce repeated onBarcodeScanned (#R4-15)
  // (#S1: reopenedRef/reopenSession removed — the session is guaranteed active by
  // getOrCreateActiveSession on every entry path, and the close-all-then-reactivate pair was
  // itself a beheading race.)
  // Track whether the user is near the live end of the conversation. Drives both the
  // auto-scroll guard (don't yank the user down while they read older messages) and
  // the "jump to latest" FAB visibility.
  const nearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // FIX (ux-round4 #1): when a reply lands while the user is scrolled up, the non-force
  // scrollToBottom early-returns and the reply appends off-screen — the plain chevron FAB gave no
  // signal that new content (vs just older history) is below. Flag it so the FAB says "Yeni yanıt".
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // INVERTED list (ux-pass2): offset 0 IS the live end — the newest message. The old
    // non-inverted list + scrollToEnd was the root of every scroll bug the emulator pass
    // hit (opens mid-history, chevron no-op, incoming replies off-screen): scrollToEnd
    // against unmeasured rows lands short, flips nearBottom false, and auto-follow dies.
    const distanceFromLiveEnd = e.nativeEvent.contentOffset.y;
    const isNear = distanceFromLiveEnd < 120;
    nearBottomRef.current = isNear;
    setShowScrollToBottom(prev => (prev === !isNear ? prev : !isNear));
    // Reaching the live end consumes the "new reply" signal.
    if (isNear) setHasNewBelow(false);
  }, []);

  const isOnboarding = profile && !profile.onboarding_completed;
  // FIX (audit UX-PRM-03): use the duration-aware isActivePremium gate (honors
  // premium_expires_at) instead of the raw profiles.premium boolean — which stays
  // true for ~1-2 days past expiry during the cron grace window. The server's
  // checkRateLimit uses isActivePremium, so the raw boolean made an expired-premium
  // user see "unlimited" in the UI while the server enforced the free 50/day cap.
  const isPremium = isActivePremium(profile);

  // Fetch remaining messages for free users on mount
  useEffect(() => {
    getRemainingMessages(isPremium).then(setRemainingMsgs);
  }, [isPremium]);

  // FIX (audit UX-OFF-01): drain the offline chat queue on reconnect. When the network
  // comes back, replay any messages queued while offline (processOfflineQueue routes each
  // back to its own session) and reload this session so the just-sent turns + AI replies
  // appear. Guarded by a ref so it only fires on the offline→online transition.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const cameOnline = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (!cameOnline || !sessionId) return;
    let cancelled = false;
    (async () => {
      const queued = await getOfflineQueueSize();
      if (queued === 0) return;
      const sent = await processOfflineQueue();
      if (cancelled || sent === 0) return;
      const fresh = await loadSessionMessages(sessionId);
      if (cancelled || !fresh) return;
      setMessages(fresh.map(toUIMessage));
      setHasMoreOlder(fresh.length >= 50);
      scrollToBottom(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, sessionId]);

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
    // CameraView fires onBarcodeScanned repeatedly while the code is in frame, and
    // state updates are async, so several events can land before the scanner
    // unmounts — debounce so we lookup/insert ONCE (#R4-15).
    if (barcodeProcessingRef.current) return;
    barcodeProcessingRef.current = true;
    setShowBarcodeScanner(false);
    setSending(true);
    const result = await lookupBarcode(barcode);
    if (result.found) {
      // Label the basis with the ACTUAL grams calculateServing used, not a fixed
      // "100g bazında" — products with a real serving size were mislabeled (#R4-9).
      const basisG = result.serving_size_g ?? 100;
      const serving = calculateServing(result, basisG);
      const msg = `Barkod: ${result.product_name} (${result.brand ?? ''}) - ${serving?.calories ?? '?'} kcal, ${serving?.protein_g ?? '?'}g protein (${basisG}g bazında)`;
      setInput(msg);
    } else {
      setInput(`Barkod ${barcode} bulunamadı. Bu ürünü metin olarak girebilirsin.`);
    }
    setSending(false);
    barcodeProcessingRef.current = false; // allow the next deliberate scan
  };

  // Voice recording handler (T4.1 / U1)
  // Flow: record → transcribe → drop into input + show "Duydum: X" banner
  // for 5s so user can review/edit/cancel before sending.
  const handleVoiceToggle = async () => {
    haptics.tap();
    // FIX (ux-pass2, W#51): gate BEFORE recording. The old flow let a free user record a
    // whole message, wait for upload+transcription, and only then learn it's Premium —
    // their spoken words discarded after the fact.
    if (!isPremium && !isRecordingVoice) {
      Alert.alert('Premium özellik', 'Sesli giriş Premium bir özellik. Premium\'a geçince sesle de kayıt yapabilirsin.');
      return;
    }
    if (isRecordingVoice) {
      try {
        setIsRecordingVoice(false);
        const { text, audioUri, premiumRequired } = await stopAndTranscribe();
        if (premiumRequired) {
          Alert.alert('Premium özellik', 'Sesli giriş Premium bir özellik. Premium\'a geçince sesle de kayıt yapabilirsin.');
        } else if (text) {
          setInput(text);
          const expiresAt = Date.now() + 5000;
          setVoiceConfirmation({ text, expiresAt });
          setTimeout(() => setVoiceConfirmation(prev => prev?.expiresAt === expiresAt ? null : prev), 5000);
        } else if (audioUri) {
          Alert.alert('Yazıya çevrilemedi', 'Sesini kaydettim ama yazıya çeviremedim — mesajını yazarak gönderir misin?');
        } else {
          // ux-sweep (CHT-05): ne metin ne ses — eskiden SESSİZ ölüyordu.
          Alert.alert('Kayıt alınamadı', 'Ses kaydı tamamlanamadı — tekrar dener misin?');
        }
      } catch {
        setIsRecordingVoice(false);
      }
    } else {
      try {
        const started = await startRecording();
        if (started) setIsRecordingVoice(true);
        // ux-sweep (CHT-05): false dönüş sessizdi — mikrofon butonu ölü sanılıyordu.
        else Alert.alert('Mikrofon açılamadı', 'Mikrofon iznini kontrol edip tekrar dene.');
      } catch {
        setIsRecordingVoice(false);
        Alert.alert('Mikrofon açılamadı', 'Mikrofon iznini kontrol edip tekrar dene.');
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
  const [loadError, setLoadError] = useState(false);
  // Review fix (ux-pass2): retry re-runs THIS pipeline via the nonce instead of a
  // divergent inline copy (which skipped cache hydration, the task opener and the
  // pending-reply poll).
  const [reloadNonce, setReloadNonce] = useState(0);
  const hydratedFromCacheRef = useRef(false);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    // Instant paint (ux-pass2, W#12/#18): hydrate the last cached page while the network
    // load runs — the app's primary surface must not be a spinner on every tab switch.
    if (!hydratedFromCacheRef.current) {
      hydratedFromCacheRef.current = true;
      getCachedThread().then(cached => {
        if (!cancelled && cached && cached.length > 0) {
          setMessages(prev => (prev.length === 0 ? cached.map(toUIMessage) : prev));
          setLoading(false);
        }
      }).catch(() => {});
    }
    loadSessionMessages(sessionId).then(async (data) => {
      if (cancelled) return;
      if (data === null) {
        // History fetch FAILED (network/5xx). Never render the fresh-account empty state
        // for a user with weeks of history — keep whatever is on screen (cache) and show
        // an explicit error+retry only when nothing else is visible (ux-pass2, W#8/#73).
        setLoading(false);
        setMessages(prev => {
          if (prev.length === 0) setLoadError(true);
          return prev;
        });
        return;
      }
      setLoadError(false);
      // #S1 fix (adversarial audit): the task opener used to fire ONLY on an EMPTY thread — in the
      // one-thread world the thread is always populated, so every task tap was a silent no-op
      // (history reloaded, no opener, prefill dropped). The opener now fires into the populated
      // thread too: show history first, then append the AI's topic opener. taskInitKeyRef guards
      // one fire per navigation (taskNonce changes on every tap, so re-taps re-fire).
      const taskKey = taskModeHint ? `${taskModeHint}-${taskNonce ?? ''}` : null;
      if (taskKey && taskInitKeyRef.current !== taskKey) {
        taskInitKeyRef.current = taskKey;
        // Opener recency guard (ux-pass5, emulator-verified defect): re-opening the same
        // topic within minutes re-fired the opener and the coach re-asked the IDENTICAL
        // question (4× "Bugün neler yedin?" in one evening). If this task's opener fired
        // recently, the question is still the freshest thing on screen — enter task mode
        // silently instead of asking again. Timestamps are user-scoped + persisted, so
        // rail re-taps, donut re-taps and stale nav params are all covered.
        const OPENER_COOLDOWN_MS = 15 * 60_000;
        const firedAt = user?.id && taskModeHint ? await getTaskOpenerFiredAt(user.id, taskModeHint) : null;
        if (firedAt && Date.now() - firedAt < OPENER_COOLDOWN_MS) {
          if (!cancelled) {
            setMessages(data.map(toUIMessage));
            setHasMoreOlder(data.length >= 50);
            setLoading(false);
            setPrefillApplied(true);
          }
          return;
        }
        // Visible topic-entry marker (ux-pass2): the opener prompt is invisible, so without
        // this the coach appears to spontaneously switch subjects.
        const topicTitle = getTaskByModeHint(taskModeHint!)?.title ?? null;
        const withMarker: UIMessage[] = data.map(toUIMessage);
        // FIX (ux-ideas #19): render the deterministic onboarding welcome as the instant first
        // bubble (data is empty for a brand-new user), so first-value doesn't wait on — or break
        // with — the live LLM opener that follows. Takes the place of the topic pill for this case.
        if (onbWelcome && taskModeHint === 'onboarding_goal') {
          withMarker.push({
            id: `onb-welcome-${taskNonce ?? Date.now()}`, role: 'assistant',
            content: onbWelcome, created_at: new Date().toISOString(),
          } as UIMessage);
          // FIX (ux-ideas #19, adversarial-review): params MERGE + persist on the tab route, so
          // without clearing it here the personalized onboarding receipt would re-fire as the
          // first bubble of a LATER, unrelated topic opener. Gate to onboarding_goal AND
          // consume-and-clear so it fires exactly once, for the onboarding entry only.
          router.setParams({ onbWelcome: '' });
        } else if (topicTitle) {
          withMarker.push({
            id: `topic-${taskNonce ?? Date.now()}`, role: 'assistant', content: '',
            topicMarker: topicTitle, created_at: new Date().toISOString(),
          } as UIMessage);
        }
        setMessages(withMarker);
        setHasMoreOlder(data.length >= 50);
        setLoading(false);
        setTypingLabel(typingLabelFor(taskModeHint, false));
        setSending(true);
        const { data: response, error } = await sendMessageToSession(
          sessionId,
          // UX fix (emulator pass): the old "bildiklerini özetle" instruction produced robotic
          // stat-dump openers ("33 yaşındasın, 80 kg'sın, uyumun %0..."). Open WARM and SHORT.
          `[SYSTEM_INIT] Bu konuyu tek kısa cümleyle sıcak bir şekilde aç ve ilk sorunu sor. Profil verilerini/sayıları LİSTELEME, istatistik okuma — sadece samimi bir giriş + tek soru. Sohbet zaten sürüyor: selamlama veya kendini tanıtma YOK.`,
          taskModeHint,
        );
        // Mark on success even if this screen instance got cancelled mid-flight — the
        // opener PERSISTED server-side either way; only a failed send may retry freely.
        if (response && user?.id && taskModeHint) void markTaskOpenerFired(user.id, taskModeHint);
        if (!cancelled && response) {
          setMessages(prev => [...prev,
            { id: response.assistant_message_id ?? `a-${Date.now()}`, role: 'assistant', content: response.message, task_mode: response.task_mode, created_at: new Date().toISOString() },
          ]);
        } else if (!cancelled) {
          // Auto-start failed (e.g. LLM outage) — show a friendly assistant bubble so the tapped
          // task clearly registered. (User can re-send to retry.)
          setMessages(prev => [...prev, {
            id: `a-init-err-${Date.now()}`, role: 'assistant',
            content: error ?? 'Şu an cevap veremedim, bağlantıda bir sorun oldu. Birazdan tekrar dener misin?',
            task_mode: taskModeHint, created_at: new Date().toISOString(),
          }]);
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
          setMessages(data.map(toUIMessage));
          // FIX (audit UX-CHT-06): a full first page (50 rows) means older history exists
          // beyond the window — enable the "Daha eski mesajları yükle" affordance.
          setHasMoreOlder(data.length >= 50);
          setLoading(false);

          // Pending-reply recovery (ux-pass2, W#49): if the newest persisted row is a RECENT
          // user message, a reply was probably still generating when the screen last unmounted
          // (plan turns take 30s+). Show typing and poll briefly instead of reading as
          // "the coach ignored me" — the finished reply appears without a manual re-entry.
          const newest = data[data.length - 1];
          if (newest && newest.role === 'user'
              && Date.now() - new Date(newest.created_at).getTime() < 120_000) {
            setTypingLabel(undefined);
            // FIX (ux-audit blocker #4): poll up to ~2min (was a hard 20s give-up) via the shared
            // poller, so a 30-60s+ plan/photo turn's reply actually lands instead of the typing
            // indicator vanishing and leaving the user's message looking ignored.
            startReplyPoll({ mode: 'replace', silent: false });
          }

          // FIX (audit UX-CHT-07): the old "Uzun zamandır konuşmadık…" proactive greeting
          // was a client-only synthetic bubble that never persisted to chat_messages. The
          // edge function builds context from chat_messages, so the model had no record it
          // "said" that — if the user replied "evet" the AI had no idea what was agreed, and
          // the greeting re-appeared on every reopen after 4h. Dropped: the model opens
          // naturally on the user's first real reply (and any server-side proactive nudge
          // that DOES persist a row will still show up here as a normal message).
        }
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, isOnboarding, taskModeHint, taskNonce, reloadNonce]);

  // Pre-fill from dashboard quick actions (non-card navigation).
  // Review fix (ux-pass2): the screen now lives permanently inside the tab, so the old
  // once-per-mount latches (prefillApplied / cameraHandledRef=true) made these deep links
  // work exactly ONCE per app session. Consume-and-clear instead: apply the param, then
  // wipe it from the route so the next deep link is a fresh param change.
  useEffect(() => {
    if (prefill && !taskModeHint && !prefillApplied && !loading) {
      // F3/C5: park the offer identity for the send that follows this prefill.
      if (acceptedNudgeId) {
        setPendingAcceptedNudge(acceptedNudgeId);
        router.setParams({ acceptedNudgeId: '' });
      }
      setInput(prefill);
      setPrefillApplied(true);
      router.setParams({ prefill: '' });
      // allow the NEXT prefill navigation to apply again
      setTimeout(() => setPrefillApplied(false), 500);
    }
  }, [prefill, taskModeHint, prefillApplied, loading]);

  // Quick Log "Fotoğraf çek" deep-link: log.tsx sends openCamera through
  // (tabs)/chat.tsx into this screen — fire the camera once PER NAVIGATION.
  // FIX (ux-pass5): log.tsx now sends a Date.now() NONCE instead of the constant 'true'.
  // With the constant, latching the ref made the deep link one-shot per app session (the
  // consume-and-clear setParams below normalizes '' to undefined at the param read, so it
  // never re-armed the ref); a fresh nonce always differs from the latch and re-fires.
  const cameraHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (openCamera && cameraHandledRef.current !== openCamera && !loading) {
      cameraHandledRef.current = openCamera;
      router.setParams({ openCamera: '' });
      void takePhoto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCamera, loading]);

  // Leaving the tab exits an active task topic (old semantics: the task ended when the
  // pushed screen unmounted; embedded, the screen never unmounts — without this the
  // composer could stay task-locked forever).
  // FIX (ux-pass5): the old version called router.setParams inside the BLUR cleanup — but
  // the global setParams dispatches to the currently-FOCUSED route, and on blur that is
  // already the DESTINATION tab. So the chat route's task params were never cleared (task
  // pill/lock survived the hop) and ''-junk params were written onto the other tab. Now the
  // blur cleanup only RECORDS the stale task key; the clear runs on the next FOCUS, when the
  // chat route is the focused route again and setParams actually targets it. Keyed on
  // hint+nonce so a NEW task navigation made while we were away (always carries a fresh
  // Date.now() nonce) is never wiped — the 15-min opener cooldown above stays as
  // defense-in-depth for same-task re-entries.
  const staleTaskKeyRef = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    const currentKey = rawParams.taskModeHint
      ? `${rawParams.taskModeHint}|${rawParams.taskNonce ?? ''}`
      : null;
    if (staleTaskKeyRef.current !== null && staleTaskKeyRef.current === currentKey) {
      router.setParams({ taskModeHint: '', taskNonce: '', prefill: '' });
    }
    staleTaskKeyRef.current = null;
    return () => {
      // Blur (or in-focus task switch, which the focus body's key mismatch ignores):
      // mark the active task as stale — do NOT setParams here (wrong route, see above).
      if (rawParams.taskModeHint) {
        staleTaskKeyRef.current = `${rawParams.taskModeHint}|${rawParams.taskNonce ?? ''}`;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawParams.taskModeHint, rawParams.taskNonce]));

  // Silent reconcile on tab re-entry (review fix, emulator-verified ux-pass3): quick-log
  // and other surfaces write into this same thread while we stay mounted — without a
  // focus reload those turns are invisible until a cold open. Gate on `sending` (a live
  // generation owns the state) rather than taskModeHint — the old taskModeHint gate meant
  // the thread NEVER reloaded once a topic pill was showing, so a FAB meal logged mid-topic
  // stayed hidden and the stale task opener kept showing as the newest message.
  const firstFocusRef = useRef(true);
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  useFocusEffect(useCallback(() => {
    if (firstFocusRef.current) { firstFocusRef.current = false; return; }
    if (!sessionId || sendingRef.current) return;
    let cancelled = false;
    loadSessionMessages(sessionId).then(fresh => {
      if (cancelled || sendingRef.current || !fresh || fresh.length === 0) return;
      setMessages(prev => {
        const prevNewest = [...prev].reverse().find(m => !m.topicMarker);
        const freshNewest = fresh[fresh.length - 1];
        // Only replace when the server actually has newer content — never clobber
        // optimistic local bubbles (or a just-fired topic marker) for nothing.
        if (prevNewest && freshNewest && prevNewest.id === freshNewest.id) return prev;
        // ux-sweep (CHT-03): yorumdaki 'never clobber optimistic bubbles' garantisi BAŞARISIZ
        // gönderimde tutmuyordu — sekme değiştirip dönen kullanıcının failed balonu ve
        // 'Yeniden dene' yükü sunucu satırlarıyla eziliyordu. Kuyruktaki failed yereller korunur.
        const failedLocals = prev.filter(m => m.failed);
        return [...fresh.map(toUIMessage), ...failedLocals];
      });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]));

  // Scroll to the live end. Pass force=true when the user just sent/tapped something
  // (always follow their own action); otherwise only follow when they were already
  // reading near the live end — so we never yank them mid-scroll. Inverted list:
  // the live end is offset 0, which needs no row measurement — it always lands.
  const scrollToBottom = useCallback((force = false, newContent = false) => {
    // FIX (ux-round4 #1): a non-force call that can't scroll (user is reading older messages) means
    // content appended below — surface it on the FAB instead of silently landing off-screen. Only a
    // real assistant REPLY sets the "Yeni yanıt" pill (newContent); a failed send appends no reply
    // (review fix), so those callers pass newContent=false and the FAB stays a plain chevron.
    if (!force && !nearBottomRef.current) { if (newContent) setHasNewBelow(true); return; }
    nearBottomRef.current = true;
    setShowScrollToBottom(false);
    setHasNewBelow(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Image pickers. Quality is aggressive (0.5) because the image is base64-
  // encoded and sent in the edge-function body; we can't afford to eat into
  // the ~5MB payload cap with a raw 48MP JPEG. Vision quality at 0.5 is still
  // fine for food recognition.
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('İzin gerekli', 'Galeriye erişim izni vermen gerek.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('İzin gerekli', 'Kameraya erişim izni vermen gerek.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!result.canceled) setPhoto(result.assets[0].uri);
  };

  // Send message. When retryFrom is supplied we re-run the send for a message
  // that previously failed, without pushing a new optimistic user bubble —
  // the existing one flips back from the failed state.
  // FIX (ux-pass2, W#48): synchronous in-flight ref — `sending` flips true only after
  // an async AsyncStorage read below, so a fast double-tap fired TWO full sends
  // (duplicate bubbles, duplicate meal logs). The ref closes that window.
  // FIX (ux-ideas #7): advance the typing label through its stages as the wait grows, and
  // reveal a Cancel affordance after ~40s so a very long turn is escapable.
  useEffect(() => {
    if (!sending) { setTypingStageIdx(0); setShowTypingCancel(false); return; }
    const rot = setInterval(() => {
      setTypingStageIdx(i => Math.min(i + 1, Math.max(0, typingStages.length - 1)));
    }, 9000);
    const cancelT = setTimeout(() => setShowTypingCancel(true), 40000);
    return () => { clearInterval(rot); clearTimeout(cancelT); };
  }, [sending, typingStages.length]);

  // FIX (ux-audit blockers #1/#2/#4): concurrency + slow-turn plumbing.
  // sessionIdRef tracks the live session so a running poll self-cancels when the session changes.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Generation token: only the CURRENT send turn may mutate turn UI state. Cancel and every new
  // send bump it, so a superseded (cancelled) in-flight request can't reset the composer lock,
  // clobber the typing indicator, or overwrite a newer turn's state.
  const sendGenRef = useRef(0);
  const sendInFlightRef = useRef(false);
  // Which generation currently owns the reply poll (-1 = none). Per-generation (not a plain
  // boolean) so a NEWER turn's poll can start while an older one is still winding down, and the
  // older poll retires itself the moment the generation bumps (review fix for the poll-clobber bugs).
  const activePollGenRef = useRef(-1);

  // Poll the server for a slow turn's reply (plan gen / photo, 30-90s) and surface it when ready —
  // instead of a FAILED bubble, a frozen composer, or a 20s give-up. mode 'replace' repaints the
  // page (reopen / still-waiting — no optimistic state to lose); 'merge' only appends new assistant
  // rows (background after Cancel, where the user may already be typing). silent keeps typing off.
  const startReplyPoll = useCallback((opts?: { mode?: 'replace' | 'merge'; silent?: boolean }) => {
    const pollGen = sendGenRef.current;
    // review fix: gen-aware guard — don't double-poll the SAME turn, but a NEWER turn's poll (its
    // gen differs) can always start; the older poll retires on its next tick when the gen bumps.
    if (activePollGenRef.current === pollGen) return;
    activePollGenRef.current = pollGen;
    const mode = opts?.mode ?? 'replace';
    const silent = opts?.silent ?? false;
    const pollSession = sessionIdRef.current;
    if (!silent) setSending(true);
    let count = 0;
    const MAX = 24; // 24 × 5s ≈ 120s — covers 60s+ plan turns
    // review fix: one gen-aware cleanup on EVERY exit (reply found, exhausted, session change, or
    // superseded by Cancel / a newer send). Release the typing indicator ONLY if no newer turn has
    // taken over `sending` (gen unchanged) — otherwise that newer owner manages it; and relinquish
    // the active-poll slot only if it is still ours. This closes the stuck-`sending` + clobber bugs.
    const finish = () => {
      if (activePollGenRef.current === pollGen) activePollGenRef.current = -1;
      if (!silent && sendGenRef.current === pollGen) setSending(false);
    };
    const tick = async () => {
      // retire if this turn was cancelled/superseded (gen bumped) or the session changed.
      if (sendGenRef.current !== pollGen || sessionIdRef.current !== pollSession) { finish(); return; }
      count += 1;
      const fresh = await loadSessionMessages(pollSession);
      if (sendGenRef.current !== pollGen || sessionIdRef.current !== pollSession) { finish(); return; }
      const rows = fresh ?? [];
      const newest = rows.length > 0 ? rows[rows.length - 1] : null;
      if (newest && newest.role === 'assistant') {
        if (mode === 'replace') {
          setMessages(rows.map(toUIMessage));
        } else {
          // merge: append only assistant rows we don't already have, so an optimistic bubble
          // from a NEW send the user started after Cancel isn't clobbered.
          setMessages(prev => {
            const have = new Set(prev.map(m => m.id));
            const add = rows.filter(r => r.role === 'assistant' && !have.has(r.id)).map(toUIMessage);
            return add.length ? [...prev, ...add] : prev;
          });
        }
        finish();
        return;
      }
      if (count < MAX) setTimeout(tick, 5000);
      else {
        // FIX (ux-readiness): don't SILENTLY give up at ~120s — the typing indicator would just
        // vanish, reading as "the coach ignored me". Surface an informational note (NOT an auto-retry:
        // the turn was accepted server-side, so re-sending would risk a double-generation). Only for
        // the visible-wait cases; a user-cancelled background poll stays silent.
        if (!silent) {
          setMessages(prev => (prev.length && prev[prev.length - 1].id.startsWith('delay-')) ? prev : [
            ...prev,
            { id: `delay-${Date.now()}`, role: 'assistant', content: 'Yanıtın beklenenden uzun sürüyor. Sohbeti kapatıp yeniden açtığında düşecektir; düşmezse mesajını tekrar yazabilirsin.', created_at: new Date().toISOString() },
          ]);
        }
        finish();
      }
    };
    setTimeout(tick, 5000);
  }, []);

  // Cancel a long wait (blocker #2): free the composer IMMEDIATELY (was: silently locked for up to
  // 60s) and retire this turn via the generation token, so the still-in-flight request can't reset
  // the lock or the typing state. The turn keeps generating server-side — a silent background poll
  // delivers its reply when ready (no data loss), without blocking the now-free composer.
  const handleCancelTyping = () => {
    haptics.tap();
    cancelledSendRef.current = true;
    sendGenRef.current += 1;
    sendInFlightRef.current = false;
    setSending(false);
    setTypingLabel(undefined);
    setTypingStages([]);
    setShowTypingCancel(false);
    // review fix: use 'replace' (not 'merge'). The poller is generation-aware and retires the moment
    // a new send bumps the gen, so it only ever delivers while idle — a full replace then reconciles
    // to server truth (no client-id-vs-UUID duplicate bubble the merge de-dup could leave), and can't
    // clobber a new send because the poll would have already retired.
    startReplyPoll({ mode: 'replace', silent: true });
  };
  /**
   * `overrideText` sends a message that was never typed into the composer — used by the
   * complete-intent starter chips. It exists because `input` is React state: `setInput(t)`
   * followed by `handleSend()` in the same tick would send the PREVIOUS value (usually empty),
   * which is a silent no-op rather than a visible failure.
   */
  const handleSend = async (retryFrom?: UIMessage, overrideText?: string) => {
    if (sendInFlightRef.current || sending) return;
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) return;
    sendInFlightRef.current = true;
    sendGenRef.current += 1;
    const myGen = sendGenRef.current;
    try {
    if (!isOnline) {
      // FIX (audit UX-OFF-01): the advertised offline-queue resilience (Spec 11) was dead
      // code — handleSend just warned and dropped the message. Now a TEXT message typed
      // offline is queued for THIS session and replayed on reconnect (processOfflineQueue
      // runs from the reconnect effect below). Photo sends still can't be queued (the queue
      // doesn't carry image bytes), and a retry of an already-failed bubble stays a warning.
      const offlineText = !retryFrom ? (overrideText ?? input).trim() : '';
      if (offlineText && !photo) {
        await queueMessageOffline(offlineText, {
          sessionId,
          taskMode: taskModeHint ?? undefined,
          targetDate: backdateDate ?? undefined,
        });
        const queuedMsg: UIMessage = {
          id: `q-${Date.now()}`,
          role: 'user',
          content: offlineText,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, queuedMsg]);
        setInput('');
        Alert.alert('Çevrimdışısın', 'Mesajın sıraya alındı, bağlantı gelince otomatik gönderilecek.');
        scrollToBottom(true);
      } else {
        Alert.alert('İnternet yok', 'Bağlı olduğundan emin olup tekrar dene.');
      }
      return;
    }

    let text: string;
    let img: string | null;
    let effectiveTaskMode: string | undefined;
    let backdate: string | null;
    let userMsgId: string;

    if (retryFrom && retryFrom.retryPayload) {
      text = retryFrom.retryPayload.text;
      img = retryFrom.retryPayload.photoUri;
      effectiveTaskMode = retryFrom.retryPayload.taskMode;
      backdate = retryFrom.retryPayload.backdate ?? null;
      userMsgId = retryFrom.id;
      // Clear the failed state on this message while we retry.
      setMessages(prev => prev.map(m =>
        m.id === userMsgId ? { ...m, failed: false, errorMessage: undefined } : m
      ));
    } else {
      text = (overrideText ?? input).trim();
      if (!text && !photo) return;

      // FIX (audit UX-CHT-05/UX-PRM-02/UX-PRM-05): the SERVER is the authoritative daily
      // gate. It counts ALL user messages (text + photo + chip + action sends) and EXEMPTS
      // record-parse logs (meal/water/sleep/weight). The old client path optimistically
      // incremented a SEPARATE local counter only for `text && !photo`, so it (a) burned a
      // free user's allowance on food/water LOGS the server exempts, and (b) skipped photo
      // sends the server DOES count — drifting both directions. We no longer increment a
      // divergent local counter here; instead we read-only block ONLY when the
      // server-synced remaining (reconciled after every send) already shows 0, and let the
      // server's authoritative rate_limited response be the true gate otherwise.
      if (!isPremium) {
        const remainingNow = await getRemainingMessages(isPremium);
        setRemainingMsgs(remainingNow);
        if (remainingNow <= 0) {
          Alert.alert(
            'Mesaj Limiti',
            `Günlük ${50} mesaj hakkını kullandın. Premium'a geçersen sınırsız mesaj hakkı kazanırsın.`,
            [{ text: 'Tamam' }]
          );
          return;
        }
      }

      // Repair intent detection (Spec 5.32)
      const repairContext: RepairDetection | null = text ? detectRepairIntent(text) : null;
      effectiveTaskMode = repairContext && repairContext.type !== 'none'
        ? `repair:${repairContext.type}`
        : (taskModeHint ?? undefined);

      img = photo;
      backdate = backdateDate ?? null;
      userMsgId = `u-${Date.now()}`;

      const userMsg: UIMessage = {
        id: userMsgId,
        role: 'user',
        content: photo ? (text ? `[Foto] ${text}` : '[Foto gönderildi]') : text,
        created_at: new Date().toISOString(),
        // FIX (audit UI-CHT-05): keep the local photo URI on the optimistic bubble
        // so the actual meal photo renders in-conversation (URI in hand here).
        localPhotoUri: photo ?? undefined,
      };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setPhoto(null);
    }

    setTypingLabel(typingLabelFor(effectiveTaskMode, !!img));
    setTypingStages(typingStagesFor(effectiveTaskMode, !!img)); // ux-ideas #7: rotating stages
    setTypingStageIdx(0);
    cancelledSendRef.current = false;
    setSending(true);
    scrollToBottom(true); // user's own send — always follow

    // #S1: the reopenSession call was REMOVED here. Every route into this screen now resolves
    // through getOrCreateActiveSession, so the session is guaranteed active — and reopenSession's
    // close-all-then-reactivate pair was itself a beheading race (a transient failure between the
    // two unchecked UPDATEs left the canonical thread closed → next open minted an empty session:
    // the exact amnesia S1 kills).

    const { data, error } = img
      ? await sendPhotoToSession(sessionId, text || 'Bu yemeği analiz et.', img)
      : await sendMessageToSession(sessionId, text, effectiveTaskMode, backdate ?? undefined);
    // Clear backdate after use so subsequent messages are today
    if (backdate && !retryFrom) setBackdateDate(null);

    // FIX (ux-audit blocker #2): if this turn was cancelled/retired while in flight (generation
    // token bumped by Cancel or a newer send), do NOT touch the composer, typing, or the active
    // turn's messages. The reply (if any) is server-persisted and delivered by the background poll
    // started on Cancel — so nothing is lost.
    if (sendGenRef.current !== myGen) return;
    // FIX (ux-audit blocker #1): a busy-exhausted "still preparing" response is NOT a failure —
    // keep the typing indicator and poll for the reply instead of flipping to a FAILED bubble whose
    // Retry (a fresh idempotency key) would double-generate a plan.
    if (!data && error === PENDING_REPLY_MESSAGE) {
      startReplyPoll({ mode: 'replace', silent: false });
      return;
    }
    const wasCancelled = cancelledSendRef.current;
    cancelledSendRef.current = false;

    if (data) {
      // FIX (audit UX-CHT-05/UX-PRM-05): reconcile the local quota mirror with the server's
      // authoritative `remaining` on EVERY successful send (text + photo). -1 = exempt
      // (record-parse/onboarding) → counter untouched so logs don't burn the visible quota.
      syncRemainingFromServer(isPremium, data.remaining).then(setRemainingMsgs);
      if (data.rate_limited) {
        // Cool down for 60s; the backend will re-check on the next send anyway.
        setRateLimitedUntil(Date.now() + 60_000);
      }
      // Determine if this message type should show feedback buttons.
      // UX fix (emulator pass): 'coaching' is nearly EVERY message, so the old rule put
      // "İşe yaradı / Bana göre değil / Neden bu öneriyi yaptın?" under plain greetings and
      // questions — three meta-affordances of clutter with no suggestion in sight. Coaching
      // turns now show feedback ONLY when they actually did something (actions executed);
      // suggestion-bearing modes (plan/recipe/simulation/eating_out/plateau) keep it always.
      const showFeedback = data.task_mode === 'plan'
        || data.task_mode === 'recipe' || data.task_mode === 'simulation'
        || data.task_mode === 'eating_out' || data.task_mode === 'plateau'
        || (data.task_mode === 'coaching' && (data.actions?.length ?? 0) > 0);

      // F1/B3 (SEAM-03): the server has ALWAYS returned `simulation` as a structured envelope
      // field — this screen re-parsed the same data out of the message TEXT with a regex while
      // the field fell on the floor. The field is now the source; the regex stays only as the
      // fallback for legacy replies and for history reloads (where structure isn't persisted).
      let messageContent = data.message;
      let simulationData: SimulationData | null = (data.simulation as SimulationData | null) ?? null;
      const simParsed = parseSimulationData(messageContent);
      messageContent = simParsed.cleanContent;      // strip the tag either way
      if (!simulationData) simulationData = simParsed.data;

      // Parse recipe data from AI response
      let recipeData: RecipeData | null = null;
      const recipeParsed = parseRecipeData(messageContent);
      messageContent = recipeParsed.cleanContent;
      recipeData = recipeParsed.data;

      // Parse quick_select options from AI response
      const quickSelectParsed = parseQuickSelect(messageContent);
      messageContent = quickSelectParsed.cleanContent;
      const quickSelectOptions = quickSelectParsed.options;

      // Extract the AI's reasoning so the "Neden?" toggle can reveal it inline
      // (no extra round-trip). Falls back to plan_reasoning when present.
      const reasoningParsed = parseReasoning(messageContent);
      messageContent = reasoningParsed.cleanContent;
      const reasoning = reasoningParsed.reasoning ?? data.plan_reasoning ?? null;

      // Detect confirm/reject plan suggestion
      const hasPlanSuggestion = hasConfirmRejectIndicator(messageContent, data.task_mode);
      // F3/C1: read the STRUCTURED plan fields off the envelope (SEAM-03's lesson: they were
      // produced for three releases while this screen only stripped their text remnants).
      const planSnapshot = (data.plan_snapshot as Record<string, unknown> | null) ?? null;
      const planDraftId = (data.plan_draft_id as string | null) ?? null;
      const planType = (data.plan_type === 'workout' ? 'workout' : data.plan_type === 'diet' ? 'diet' : null);
      messageContent = stripMachineMarkers(messageContent);

      // Detect low-confidence verification prompt (Spec 5.32, auto-appended by ai-chat)
      const hasLowConfidenceVerification = hasLowConfidenceVerificationIndicator(messageContent);

      // Extract persona_detected action (Spec 5.15) — server emits after first-time detection
      const personaAction = data.actions.find(a => a.type === 'persona_detected');
      const personaDetected = (personaAction?.feedback as string | null) ?? null;

      const reply: UIMessage = {
        // Prefer the server-persisted row id (ux-pass2, W#75): feedback votes link to a
        // real chat_messages UUID instead of a client-minted id the service discards.
        id: data.assistant_message_id ?? `a-${Date.now()}`,
        role: 'assistant',
        content: messageContent,
        task_mode: data.task_mode,
        created_at: new Date().toISOString(),
        actions: data.actions,
        receipts: data.receipts ?? null,
        showFeedback,
        simulationData,
        recipeData,
        quickSelectOptions,
        hasPlanSuggestion,
        planSnapshot, planDraftId, planType,
        hasLowConfidenceVerification,
        personaDetected,
        taskCompletion: data.task_completion ?? null,
        navigateTo: data.navigate_to ?? null,
        reasoning,
      };
      setMessages(prev => [...prev, reply]);

      // FIX (kullanıcı bulgusu: "chat tıkandı"): görev tamamlandığı anda konu paramları
      // BURADA temizlenir — composer hiç kilitlenmez, görev rayı (!taskModeHint kapılı)
      // hemen geri gelir. Eski akış kullanıcıyı "yukarıdaki karta dokun" çıkmazına
      // bırakıyordu; tamamlanma artık konuyu KAPATIR, sohbeti değil.
      if (data.task_completion?.completed && taskModeHint) {
        router.setParams({ taskModeHint: '', taskNonce: '', prefill: '' });
      }

      // Refresh dashboard AND profile if actions were executed
      if (data.actions.some(a => a.feedback) && user?.id) {
        haptics.success(); // a log/save committed — tactile confirm
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
      // Flag the user's message as failed with a retry payload. The bubble
      // renders a "Yeniden dene" button that re-invokes handleSend(retryFrom).
      haptics.error(); // send failed — tactile error cue
      const errMsg = error ?? 'Bağlantı hatası. Tekrar dene.';
      setMessages(prev => prev.map(m => m.id === userMsgId
        ? {
            ...m,
            failed: true,
            errorMessage: errMsg,
            retryPayload: { text, photoUri: img, taskMode: effectiveTaskMode, backdate },
          }
        : m
      ));
      // FIX (audit UX-CHT-05): no optimistic local increment to refund anymore — the
      // server is authoritative and only counts messages it actually persisted, so a
      // failed send never consumed quota. (Counter is reconciled from the server's
      // `remaining` on the next successful send.)
    }

    setSending(false);
    // review fix: only signal a new reply on success (data present) — a failed send appends none.
    if (!wasCancelled) scrollToBottom(false, !!data);
    } finally {
      // Only release the composer lock if THIS turn is still the current one — a turn retired by
      // Cancel (or superseded by a newer send) must not free a lock the active turn now owns.
      if (sendGenRef.current === myGen) sendInFlightRef.current = false;
    }
  };

  // FIX (ux-readiness): handleSend is re-created every render (it closes over input/photo/etc.), so
  // passing it directly as onRetry defeated MessageBubble's memo — every keystroke re-rendered every
  // bubble (rich cards/receipts/rings), the exact typing jank the memo was added to prevent. Route
  // retries through a STABLE wrapper backed by a ref so the bubble's onRetry identity never churns.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  const stableRetry = useCallback((m: UIMessage) => { handleSendRef.current(m); }, []);
  // MessageBubble memo'lu — her render'da yeni bir ok fonksiyonu geçmek memo'yu boşa
  // düşürürdü; stableRetry'nin desenini izle.
  const stableOpenPlan = useCallback((plan: PlanData) => {
    const ws = (plan as unknown as { week_start?: string })?.week_start;
    setFullPlan({ plan, weekStart: typeof ws === 'string' ? ws : undefined });
  }, []);

  // Quick suggestion handler
  const handleSuggestion = (text: string) => {
    setInput(text);
  };
  /** Complete-intent starter chips send straight away — see StarterSuggestions for why. */
  const handleStarterSend = (text: string) => { void handleSend(undefined, text); };

  // FIX (ux-round2 #16 — adversarial-review): editing a SENT message must not silently discard a
  // non-empty in-progress draft. Read the live input via a ref so this stays a stable callback
  // (passing a fresh closure to the memoized MessageBubble would re-render every bubble per
  // keystroke). Confirm before overwriting a real draft.
  const inputRef = useRef('');
  inputRef.current = input;
  const handleEditUserMessage = useCallback((text: string) => {
    const draft = inputRef.current.trim();
    if (draft && draft !== text) {
      Alert.alert('Taslağın silinecek', 'Yazmakta olduğun mesaj silinip bu mesaj düzenlenmek üzere kutuya konacak. Devam edilsin mi?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Devam', onPress: () => setInput(text) },
      ]);
    } else {
      setInput(text);
    }
  }, []);

  const handleCopyConversation = async () => {
    haptics.tap();
    if (messages.length === 0) {
      Alert.alert('Boş sohbet', 'Henüz mesaj yok.');
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
      Alert.alert('Paylaşılamadı', 'Sohbet kopyalanırken bir hata oluştu.');
    }
  };

  // QuickSelectButtons handler — user picks an option from AI's inline choices.
  // `displayLabel` (when provided) is the short, human-facing bubble shown to the
  // user; `option` is the fuller engineered instruction actually sent to the model.
  // When omitted (genuine quick-select chips) the bubble matches the tapped chip.
  const handleQuickSelect = useCallback((option: string, displayLabel?: string,
    // F3/C1: an alternate sender carrying the approve identity (hint + user_approved + draft_id).
    // The default path stays byte-identical for every other chip.
    sendOverride?: (sessionId: string, text: string) => Promise<{ data: ChatResponse | null; error: string | null }>) => {
    // FIX (audit UX-CHT-04): in-flight guard. Without this, double-tapping a quick-select
    // chip / Onayla / Doğru-Yanlış fired two concurrent sendMessageToSession calls →
    // duplicate AI turns and duplicate side effects (double log / double delete).
    // FIX (ux-ideas #8, adversarial-review): use the SAME synchronous sendInFlightRef as
    // handleSend — `sending` (React state) lags the tap, so with the always-visible 4-chip
    // quick-reply strip two rapid taps could both pass a `sending`-only guard and fire
    // concurrent sends. The ref is read+set synchronously (second tap bails immediately) and
    // shared with handleSend, so chip and composer sends are now mutually exclusive too.
    if (sendInFlightRef.current || sending) return;
    sendInFlightRef.current = true;
    sendGenRef.current += 1;
    const myGen = sendGenRef.current;
    haptics.tap(); // chip tap — light tactile confirm
    const bubbleText = displayLabel ?? option;
    // Auto-send after a short delay
    setTimeout(async () => {
      let handedToPoll = false;
      try {
      const userMsg: UIMessage = {
        id: `u-${Date.now()}`, role: 'user', content: bubbleText, created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setTypingLabel(undefined);
      setSending(true);
      scrollToBottom(true); // user's own tap — always follow
      const { data, error } = await (sendOverride ? sendOverride(sessionId, option) : sendMessageToSession(sessionId, option));
      // blocker #2: cancelled/retired mid-flight → don't touch the active turn (reply lands via poll).
      if (sendGenRef.current !== myGen) return;
      // blocker #1: busy = still preparing, not failed → poll instead of a fake failure + Retry.
      if (!data && error === PENDING_REPLY_MESSAGE) { handedToPoll = true; startReplyPoll({ mode: 'replace', silent: false }); return; }
      if (data) {
        // FIX (audit UX-CHT-05): chip sends consume the server-side quota too — reconcile.
        syncRemainingFromServer(isPremium, data.remaining).then(setRemainingMsgs);
        let content = data.message;
        const simParsed = parseSimulationData(content);
        content = simParsed.cleanContent;
        const recipeParsed = parseRecipeData(content);
        content = recipeParsed.cleanContent;
        const qsParsed = parseQuickSelect(content);
        content = qsParsed.cleanContent;
        // ux-sweep (CHT-01, critical): çip yolu zarfın PLAN alanlarını düşürüyordu — plan
        // reddetme/İnceltme akışı ('Tamamen değiştir' vb.) tam bu yoldan geçer; revize plan
        // kimliksiz gelince Onayla en son KİMLİKLİ (eski) mesajı bulup YANLIŞ planı
        // onaylayabiliyordu. Ana gönderim yolundaki eşleme buraya da taşındı.
        const chipReasoning = content.includes('<reasoning>') ? parseReasoning(content) : null;
        if (chipReasoning) content = chipReasoning.cleanContent;
        const hasPlan = hasConfirmRejectIndicator(content, data.task_mode);
        content = stripMachineMarkers(content);
        const hasLowConf = hasLowConfidenceVerificationIndicator(content);
        setMessages(prev => [...prev, {
          id: (data.assistant_message_id as string | undefined) ?? `a-${Date.now()}`,
          role: 'assistant', content, task_mode: data.task_mode,
          created_at: new Date().toISOString(), actions: data.actions, receipts: data.receipts ?? null, showFeedback: false,
          simulationData: simParsed.data, recipeData: recipeParsed.data,
          quickSelectOptions: qsParsed.options, hasPlanSuggestion: hasPlan,
          hasLowConfidenceVerification: hasLowConf,
          reasoning: chipReasoning?.reasoning,
          planSnapshot: (data.plan_snapshot as Record<string, unknown> | null) ?? null,
          planDraftId: (data.plan_draft_id as string | null) ?? null,
          planType: (data.plan_type as 'diet' | 'workout' | null) ?? null,
          taskCompletion: data.task_completion ?? null,
          navigateTo: (data.navigate_to as string | null) ?? null,
        }]);
        if (data.actions.some((a: { feedback: string | null }) => a.feedback) && user?.id) { haptics.success(); refreshDashboard(user.id); }
      } else {
        // Mirror the main send path: flip the user's own bubble to a failed state
        // with a 'Yeniden dene' retry, instead of printing the error as a fake
        // assistant reply (which looked like the coach said the error text).
        haptics.error();
        setMessages(prev => prev.map(m => m.id === userMsg.id
          ? { ...m, failed: true, errorMessage: error ?? 'Bağlantı hatası.', retryPayload: { text: option, photoUri: null } }
          : m));
      }
      // review fix: only flag "Yeni yanıt" when a reply was actually appended (data present).
      scrollToBottom(false, !!data);
      } finally {
        // Only the CURRENT turn clears state — a turn retired by Cancel/newer send must not (blocker #2);
        // and when we handed off to the reply poll, leave the typing indicator to it.
        if (sendGenRef.current === myGen) {
          if (!handedToPoll) setSending(false);
          sendInFlightRef.current = false;
        }
      }
    }, 0);
    // sessionId in deps (review fix): the tab can self-heal to a different session id
    // without remounting — a stale closure kept sending chip taps to the old session.
  }, [sending, scrollToBottom, user?.id, refreshDashboard, isPremium, sessionId]);

  // Confirm/Reject plan suggestion handlers. The user-facing bubble stays short and
  // natural while the model still receives the fuller engineered instruction.
  const handlePlanConfirm = useCallback(() => {
    // F3/C1: find the plan the user is LOOKING AT and carry its identity. The old plain-text send
    // reached the server with planTurn=false — the approval block never ran and the draft stayed
    // a draft forever while the UI implied success.
    const planMsg = [...messages].reverse().find((m) => m.hasPlanSuggestion && (m.planDraftId || m.planType));
    if (planMsg?.planType) {
      trace('plan_approve_sent');
      const pt = planMsg.planType;
      const draftId = planMsg.planDraftId ?? null;
      handleQuickSelect('Evet, bu planı onayla', 'Planı onayla',
        (sid) => approvePlanInChat(sid, pt, draftId));
      return;
    }
    // Legacy fallback (message predates the identity fields): the old plain-text path.
    handleQuickSelect('Evet, bu planı onayla', 'Planı onayla');
  }, [handleQuickSelect, messages]);

  // Plan rejection with chip-based reason selection (Spec 7.1 — multi-turn refine).
  // The reason picker is now inline tappable chips rendered in the bubble (see
  // MessageBubble → PlanRejectReasons) instead of a native Alert action sheet.
  // Each chip calls handlePlanRejectReason(reason) with the SAME label/instruction
  // pairs and the SAME handleQuickSelect effect — only presentation changed.
  const handlePlanRejectReason = useCallback((reason: { label: string; instruction: string }) => {
    handleQuickSelect(reason.instruction, reason.label);
  }, [handleQuickSelect]);

  // Low-confidence verification handlers (Spec 5.32)
  // Confirm → AI sees "evet" (confirmation_yes); meal already saved, just acknowledge.
  // Reject  → AI sees "yanlış" (confirmation_no + correction); triggers repair flow.
  const handleLowConfConfirm = useCallback(() => {
    handleQuickSelect('Evet, doğru', 'Doğru');
  }, [handleQuickSelect]);

  const handleLowConfReject = useCallback(() => {
    handleQuickSelect('Hayır, yanlış anladın — son kaydı sil', 'Yanlış, düzelt');
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
      haptics.success(); // recipe saved to library
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, recipeSaved: true } : m));
    } catch (err) {
      haptics.error();
      // Raw backend/JS errors are English tech-speak in a Turkish UI — fixed copy only.
      console.warn('saveRecipe failed:', (err as Error).message);
      Alert.alert('Kaydedilemedi', 'Tarif kitaplığa eklenemedi — tekrar dene.');
    }
  }, [user?.id]);

  // Backdate picker — quick options: today / yesterday / 2 days ago / reset
  const handleBackdateButton = useCallback(() => {
    Alert.alert(
      'Kayıt tarihi',
      'Geçmiş bir tarihe kayıt yapacaksan seç.',
      [
        { text: 'Bugün (varsayılan)', onPress: () => setBackdateDate(null) },
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
    handleQuickSelect('Evet, beni doğru tanımladın', 'Doğru tanıdın');
  }, [handleQuickSelect]);

  const handlePersonaReject = useCallback(() => {
    handleQuickSelect('Hayır, ben farklıyım — persona tipimi unut', 'Ben farklıyım');
  }, [handleQuickSelect]);

  // Dashboard macros for real-time MacroSummary after meal_log
  const totalProtein = useDashboardStore(s => s.totalProtein);
  const totalCarbs = useDashboardStore(s => s.totalCarbs);
  const totalFat = useDashboardStore(s => s.totalFat);
  const totalCalories = useDashboardStore(s => s.totalCalories);
  const weeklyBudgetRemaining = useDashboardStore(s => s.weeklyBudgetRemaining);
  // FIX (audit UI-CHT-06): memoize so a stable object identity is passed to every
  // MessageBubble — unrelated re-renders (keyboard, rate-limit countdown) no longer
  // hand React.memo'd bubbles a fresh object each pass.
  const dashboardMacros = useMemo(
    () => ({ protein: totalProtein, carbs: totalCarbs, fat: totalFat }),
    [totalProtein, totalCarbs, totalFat],
  );

  // Macro gram targets — SAME derivation as the dashboard (ux-pass2 split-brain fix:
  // this used to compute from raw TDEE × macro %, telling the user "205g protein" in
  // the receipt while the dashboard said 144g). deriveNutritionTargets is the single
  // source of truth, and the dashboard store's plan-projected targets take priority
  // exactly like the dashboard itself (review fix: profile-only derivation still
  // diverged from the ring on plan days).
  // FIX (audit UI-CHT-06): memoized so the object identity stays stable.
  const planCalMin = useDashboardStore(s => s.calorieTargetMin);
  const planCalMax = useDashboardStore(s => s.calorieTargetMax);
  const planProteinT = useDashboardStore(s => s.proteinTarget);
  const planCarbsT = useDashboardStore(s => s.carbsTarget);
  const planFatT = useDashboardStore(s => s.fatTarget);
  const macroTargets = useMemo(() => {
    const t = deriveNutritionTargets(profile, {
      calorieMin: planCalMin, calorieMax: planCalMax,
      proteinG: planProteinT, carbsG: planCarbsT, fatG: planFatT,
    });
    return { protein: t.proteinG, carbs: t.carbsG, fat: t.fatG };
  }, [profile?.calorie_range_rest_min, profile?.calorie_range_rest_max, profile?.protein_per_kg, profile?.weight_kg, profile?.macro_carb_pct, profile?.macro_fat_pct, planCalMin, planCalMax, planProteinT, planCarbsT, planFatT]);

  // FIX (kullanıcı bulgusu): handleAskWhy silindi — "Neden bu öneriyi yaptın?"
  // fallback'i sohbete MESAJ yazıyordu. Reasoning artık yalnızca mesajın kendi
  // <reasoning> paneli olarak açılır (MessageBubble); chat'e yazan yol yok.

  // Undo handler — routed through the SAME visible send path as a normal message
  // (FIX audit UX-CHT-02). The old banner onPress fire-and-forget'd the request and
  // discarded {data,error}: no user/assistant bubble, no typing, no error — tapping
  // "Geri Al" just made the banner vanish with no visible feedback. Now we push a
  // user bubble, show typing, append the AI reply, refresh the dashboard when the
  // delete commits, and surface a failure if the request errors or no action lands.
  const handleUndo = useCallback((undo: { type: string; messageId: string; expiresAt: number }) => {
    // review fix: participate in the SYNCHRONOUS composer lock like handleSend/handleQuickSelect
    // (guard on sendInFlightRef, not just the lagging `sending` state) and release it in a
    // gen-guarded finally — otherwise a Geri Al tap during a free-user send's pre-setSending
    // AsyncStorage window could bump the gen without owning the lock and strand it forever.
    if (sendInFlightRef.current || sending) return;
    sendInFlightRef.current = true;
    sendGenRef.current += 1;
    const myGen = sendGenRef.current;
    haptics.tap();
    const undoText = `Son ${undo.type === 'meal_log' ? 'öğün' : undo.type === 'workout_log' ? 'antrenman' : 'supplement'} kaydını geri al`;
    setUndoAction(null);
    setTimeout(async () => {
      let handedToPoll = false;
      try {
      const userMsg: UIMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: undoText,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setTypingLabel(undefined);
      setSending(true);
      scrollToBottom(true);

      const { data, error } = await sendMessageToSession(sessionId, undoText);
      // blocker #2: cancelled/retired mid-flight → don't clobber the active turn.
      if (sendGenRef.current !== myGen) return;
      // blocker #1: busy = still preparing, not failed → poll for the reply.
      if (!data && error === PENDING_REPLY_MESSAGE) { handedToPoll = true; startReplyPoll({ mode: 'replace', silent: false }); return; }
      if (data) {
        // FIX (audit UX-CHT-05): the undo turn reaches the server and counts — reconcile.
        syncRemainingFromServer(isPremium, data.remaining).then(setRemainingMsgs);
        const reply: UIMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.message,
          task_mode: data.task_mode,
          created_at: new Date().toISOString(),
          actions: data.actions,
          receipts: data.receipts ?? null,
          showFeedback: false,
        };
        setMessages(prev => [...prev, reply]);
        // Geri alma turunun sonucu artık zarfta TİPLİ geliyor (receipts[action_type='undo']).
        // Eskiden başarı `actions.some(a => a.feedback)` ile ölçülüyordu, ama sunucunun undo
        // dalı her zaman `actions: []` döndürüyordu — yani kayıt gerçekten silindiğinde bile
        // kullanıcı "Geri alınamadı" görüyor ve pano tazelenmiyordu. Fiş yoksa (eski sunucu)
        // eski ölçüme düş.
        const undoReceipt = (data.receipts ?? []).find(r => r.action_type === 'undo');
        const committed = undoReceipt ? undoReceipt.ok : data.actions.some(a => a.feedback);
        if (committed && user?.id) {
          haptics.success(); // delete committed — tactile confirm
          refreshDashboard(user.id);
        } else {
          haptics.error();
          // 'nothing_to_undo' sunucunun BİLDİĞİ bir durum ve cümlesi zaten baloncukta
          // ("Geri alınacak bir kayıt bulunamadı.") — üstüne ikinci bir uyarı yığmıyoruz.
          if (undoReceipt?.failure_class !== 'nothing_to_undo') {
            Alert.alert('Geri alınamadı', 'Kaydı silemedim — son kaydını kontrol edip gerekirse tekrar dene.');
          }
        }
      } else {
        // Mirror the main send path: flip the user's own bubble to a failed/retry
        // state instead of silently dropping the error.
        haptics.error();
        setMessages(prev => prev.map(m => m.id === userMsg.id
          ? { ...m, failed: true, errorMessage: error ?? 'Geri alma başarısız. Tekrar dene.', retryPayload: { text: undoText, photoUri: null } }
          : m));
      }
      // review fix: only flag "Yeni yanıt" when the undo reply was actually appended (data present).
      scrollToBottom(false, !!data);
      } finally {
        // Only the CURRENT turn clears state; a turn retired by Cancel/newer send must not (and when
        // we handed off to the poll, leave the typing indicator to it).
        if (sendGenRef.current === myGen) {
          if (!handedToPoll) setSending(false);
          sendInFlightRef.current = false;
        }
      }
    }, 0);
  }, [sending, sessionId, scrollToBottom, user?.id, refreshDashboard, isPremium]);

  // FIX (audit UX-CHT-06): fetch and PREPEND the next older page when the user asks for it.
  // Uses the oldest currently-loaded message's created_at as the cursor. De-dups by id in
  // case a row sits on a page boundary. Does not scroll (the user is reading older history).
  const handleLoadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return;
    // The oldest PERSISTED (server) message is the pagination cursor. Client-only optimistic
    // bubbles carry a prefixed id (u-/a-/q-/greet-/onboard-); skip them so we page from a
    // real created_at that exists in the DB.
    const isClientId = (id: string) => /^(u-|a-|q-|greet-|onboard-)/.test(id);
    const oldest = messages.find(m => !isClientId(m.id)) ?? messages[0];
    if (!oldest?.created_at) return;
    setLoadingOlder(true);
    setOlderLoadFailed(false);
    try {
      const older = await loadOlderSessionMessages(sessionId, oldest.created_at);
      // FIX (ux-pass5): null = fetch FAILED (network/5xx). The old error-[] flipped
      // hasMoreOlder false permanently, so one blip silently amputated all older history.
      // Keep hasMoreOlder true and surface a retry label — the button stays tappable.
      if (older === null) {
        haptics.error();
        setOlderLoadFailed(true);
        return;
      }
      if (older.length > 0) {
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          // FIX (kullanıcı bulgusu): eski-sayfa prepend'i de reasoning'i yakalar (toUIMessage).
          const fresh = older.filter(m => !seen.has(m.id)).map(toUIMessage);
          return [...fresh, ...prev];
        });
      }
      // Fewer than a full page back means we've reached the start of the session.
      setHasMoreOlder(older.length >= 50);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMoreOlder, messages, sessionId]);

  // FIX (audit UI-CHT-06): build the separator-decorated row list once per messages
  // change instead of re-running filter+withDateSeparators on every unrelated re-render.
  // CRITICAL: this useMemo MUST stay ABOVE the `if (loading) return` early-return below.
  // A hook after a conditional return violates the Rules of Hooks and threw
  // "Rendered more hooks than during the previous render" the moment loading flipped
  // false — crashing the chat detail screen on open (ErrorBoundary caught it).
  const messageRows = useMemo(
    () => withDateSeparators(messages.filter(m => !(m.role === 'user' && m.content.startsWith('[SYSTEM_INIT]')))),
    [messages],
  );
  // INVERTED list data: newest row first. Reversing AFTER separator insertion keeps each
  // date pill visually above its day (the inverted render flips the order back).
  const invertedRows = useMemo(() => [...messageRows].reverse(), [messageRows]);
  // FIX (ux-round4 #8): id of the newest user message whose send is in flight — only that bubble
  // shows the "Gönderiliyor" clock (older user bubbles are already delivered). Queued-offline
  // bubbles (id 'q-') carry their own 'Kuyrukta' glyph regardless of this.
  const lastPendingUserId = useMemo(() => {
    if (!sending) return null;
    const last = messages[messages.length - 1];
    // FIX (ux-round4 #8 review): only an OPTIMISTIC just-sent bubble (client id 'u-…') is truly
    // in-flight. A server-loaded, already-persisted user row (real id) whose REPLY is still being
    // polled must NOT show "Gönderiliyor" — the message already reached the server. (Known minor
    // gap: retrying a non-last failed message shows no clock — low-value to track the retry id.)
    return last && last.role === 'user' && !last.failed && last.id.startsWith('u-') ? last.id : null;
  }, [messages, sending]);
  // FIX (ux-round2 #8): when searching, show only matching message rows (drop separators).
  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    if (!q) return invertedRows;
    return invertedRows.filter(r => r.kind === 'message' && ((r.msg as UIMessage).content ?? '').toLocaleLowerCase('tr-TR').includes(q));
  }, [invertedRows, searchQuery]);

  if (loading) {
    // FIX (ux-ideas #8): content-shaped skeleton (alternating chat bubbles) instead of a
    // bare centered spinner, so the flagship surface reads as "loading a conversation".
    const skeletonBubbles: { align: 'flex-start' | 'flex-end'; w: `${number}%`; h: number }[] = [
      { align: 'flex-start', w: '72%', h: 54 },
      { align: 'flex-end', w: '55%', h: 38 },
      { align: 'flex-start', w: '80%', h: 72 },
      { align: 'flex-end', w: '48%', h: 38 },
      { align: 'flex-start', w: '66%', h: 54 },
    ];
    return (
      <View
        accessibilityLabel="Sohbet yükleniyor"
        style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: SPACING.xl, paddingTop: Math.max(insets.top, 12) + 56, gap: SPACING.lg }}
      >
        {skeletonBubbles.map((b, i) => (
          <View key={i} style={{ alignSelf: b.align, maxWidth: '85%' }}>
            <SkeletonBlock width={b.w} height={b.h} radius={16} />
          </View>
        ))}
      </View>
    );
  }

  // History fetch failed with nothing to show — explicit error+retry instead of the
  // fresh-account empty state (ux-pass2, W#8/#73: the "her şey silindi" moment).
  // (refactor: shared LoadErrorState)
  if (loadError && messages.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadErrorState
          title="Sohbet geçmişin yüklenemedi"
          subtitle="Mesajların güvende — bağlantını kontrol edip tekrar dene."
          onRetry={() => {
            // Same load pipeline, fresh run — refs reset so cache hydration and a
            // pending task opener fire again.
            hydratedFromCacheRef.current = false;
            taskInitKeyRef.current = null;
            setLoadError(false);
            setLoading(true);
            setReloadNonce(n => n + 1);
          }}
        />
      </View>
    );
  }

  // FIX (kullanıcı bulgusu: "chat tıkandı"): taskSessionClosed kilidi TAMAMEN kaldırıldı.
  // Tamamlanma composer'ı asla kilitlememeli — handleSend görev bitince konu paramlarını
  // zaten temizliyor; yazma her zaman serbest, placeholder her zaman 'Mesajını yaz...'.
  const sendDisabled = (!input.trim() && !photo) || sending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      // FIX (audit UI-CHT-01/HIGH): use 'padding' on BOTH platforms. Under Expo SDK 55's
      // mandatory edge-to-edge, Android 'height' mis-measures the window and could leave the
      // composer hidden behind the keyboard; 'padding' resizes correctly with the keyboard inset.
      behavior="padding"
      // This screen is header-less (headerShown:false at both layout levels) and renders
      // its own in-content header, so there is no native header to offset against. A
      // non-zero offset would float the composer ~90px above the keyboard on iOS.
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={{
        paddingHorizontal: SPACING.xl,
        paddingTop: Platform.OS === 'web' ? 12 : Math.max(insets.top, 12),
        paddingBottom: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.divider,
      }}>
        {/* ux-pass2: no back chevron — this is a TAB now, the tab bar below is the
            navigation. (Hardware back still exits to the home tab via handleBack.) */}
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
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.title3, color: colors.text }}>Kochko</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {/* Token-driven presence dot: offline → muted, sending → warning, online+idle → teal.
                Matches the chat list's colors.primary "active" treatment instead of Tailwind green. */}
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: !isOnline ? colors.textMuted : sending ? colors.warning : colors.primary,
            }} />
            <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
              {!isOnline ? 'çevrimdışı' : sending ? 'yazıyor…' : 'aktif'}
            </Text>
          </View>
        </View>
        {/* FIX (kullanıcı bulgusu: "toplam kartları görmeliyiz — hangileri bitti hangileri
            bitmedi"): tüm konuların durum dökümünü açan genel bakış düğmesi. */}
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
          onPress={openTopicsModal}
          style={{ padding: 6, borderRadius: RADIUS.full, backgroundColor: colors.surfaceLight }}
          accessibilityRole="button"
          accessibilityLabel="Konulara genel bakış"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="list-circle-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
          onPress={handleCopyConversation}
          style={{ padding: 6, borderRadius: RADIUS.full, backgroundColor: colors.surfaceLight }}
          accessibilityRole="button"
          accessibilityLabel="Sohbeti kopyala"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        {/* FIX (ux-ideas #23): AI-first koçlukta en büyük güven sorusu "beni hatırlıyor mu?".
            Koçun kalıcı hatırladıklarını (hedef, alerji/sakatlık, sevilmeyen yemekler, persona)
            tam da sohbet ederken tek dokunuşla görünür/düzeltilebilir kıl — kanonik
            'Kochko Seni Nasıl Tanıyor' ekranına köprü. */}
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
          onPress={() => { haptics.tap(); router.push('/settings/coach-memory' as never); }}
          style={{ padding: 6, borderRadius: RADIUS.full, backgroundColor: colors.surfaceLight }}
          accessibilityRole="button"
          accessibilityLabel="Kochko seni nasıl tanıyor"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        {/* FIX (ux-round2 #8): in-thread search toggle. */}
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
          onPress={() => { haptics.tap(); setSearchOpen(v => { if (v) setSearchQuery(''); return !v; }); }}
          style={{ padding: 6, borderRadius: RADIUS.full, backgroundColor: searchOpen ? colors.primary + '22' : colors.surfaceLight }}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Aramayı kapat' : 'Sohbette ara'}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="search" size={18} color={searchOpen ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* FIX (ux-round2 #8): search bar — live filter over loaded messages. */}
      {searchOpen && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, paddingHorizontal: SPACING.md }}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Yüklü mesajlarda ara"
              placeholderTextColor={colors.textMuted}
              autoFocus
              // The composer must match the bubbles it produces: typing at 13 and reading back at 15
              // makes your own message look like it changed size when you sent it.
              style={{ flex: 1, color: colors.text, ...TYPE.body, paddingVertical: SPACING.sm }}
              accessibilityLabel="Sohbette ara"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Temizle">
                <Ionicons name="close-circle" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* FIX (audit: çift offline banner) — inline <OfflineBanner/> kaldırıldı;
          global common/OfflineBanner (app/_layout.tsx) bu ekranı zaten kapsıyor. */}

      {/* Messages or empty state */}
      {/* FIX (audit UX-CHT-03): only the ZERO-message case uses the ScrollView EmptyState.
          From the first real message onward the FlatList renders, so crossing 1→2 messages
          just appends a row instead of tearing down a ScrollView and mounting a fresh
          FlatList (which remounted every MessageBubble and replayed all entrance
          animations). The lone-onboarding-intro / lone-user-message now render as normal
          bubbles in the list, with the starter suggestions as the list FOOTER at 1 msg. */}
      {messages.length === 0 && !sending ? (
        <EmptyState
          isOnboarding={!!isOnboarding}
          onSuggestion={handleSuggestion}
          onSend={handleStarterSend}
          showSuggestions={!taskModeHint}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            // INVERTED (ux-pass2): the list opens AT the newest message with zero measurement
            // work, incoming rows appear in place when the user is at the live end, loading
            // older pages appends off-screen with NO scroll jump (kills W#70), and the
            // keyboard opening keeps the newest turn visible (kills W#13).
            inverted
            data={displayRows}
            keyExtractor={item => item.kind === 'separator' ? `sep-${item.key}` : (item.msg as UIMessage).id}
            renderItem={({ item }) => {
              if (item.kind === 'separator') return <DateSeparator label={item.label} />;
              const m = item.msg as UIMessage;
              if (m.topicMarker) return <TopicMarker label={m.topicMarker} />;
              return <MessageBubble message={m} incompleteKeys={incompleteKeys} dashboardMacros={dashboardMacros} macroTargets={macroTargets} onQuickSelect={handleQuickSelect} onConfirm={handlePlanConfirm} onPlanRejectReason={handlePlanRejectReason} onLowConfConfirm={handleLowConfConfirm} onLowConfReject={handleLowConfReject} onPersonaConfirm={handlePersonaConfirm} onPersonaReject={handlePersonaReject} onSaveRecipe={handleSaveRecipe} totalCalories={totalCalories} weeklyBudgetRemaining={weeklyBudgetRemaining} onTTSToggle={handleTTSToggle} speakingMsgId={speakingMsgId} onRetry={stableRetry} onEditUser={handleEditUserMessage} onOpenPhoto={setFullscreenPhoto} onOpenPlan={stableOpenPlan} sending={sending} isLastPending={m.id === lastPendingUserId} />;
            }}
            // Inverted list: ListFooter renders at the VISUAL TOP — that's where the
            // "load older" control belongs (FIX audit UX-CHT-06).
            ListFooterComponent={!searchQuery.trim() && hasMoreOlder ? (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                onPress={handleLoadOlder}
                disabled={loadingOlder}
                accessibilityRole="button"
                accessibilityLabel="Daha eski mesajları yükle"
                style={{
                  alignSelf: 'center', marginBottom: SPACING.sm, paddingVertical: 6,
                  paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill,
                  backgroundColor: colors.surfaceLight, flexDirection: 'row',
                  alignItems: 'center', gap: 6, opacity: loadingOlder ? 0.6 : 1,
                }}
              >
                {loadingOlder
                  ? <ActivityIndicator size="small" color={colors.textSecondary} />
                  : <Ionicons name={olderLoadFailed ? 'refresh' : 'arrow-up'} size={13} color={colors.textSecondary} />}
                <Text style={{ ...TYPE.caption, fontWeight: '600', color: colors.textSecondary }}>
                  {/* FIX (ux-pass5): failed page fetch shows a retry cue instead of vanishing */}
                  {loadingOlder ? 'Yükleniyor…' : olderLoadFailed ? 'Yüklenemedi — tekrar dene' : 'Daha eski mesajları yükle'}
                </Text>
              </TouchableOpacity>
            ) : null}
            // Inverted list: ListHeader renders at the VISUAL BOTTOM — starter suggestions
            // sit under the lone first message (FIX audit UX-CHT-03).
            ListHeaderComponent={!taskModeHint && !searchQuery.trim() && messageRows.filter(r => r.kind === 'message').length === 1
              ? <View style={{ marginTop: SPACING.lg }}><StarterSuggestions isOnboarding={!!isOnboarding} onSuggestion={handleSuggestion} onSend={handleStarterSend} /></View>
              : null}
            contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.sm }}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            // 'interactive' (iOS) lets the user read back without killing the keyboard;
            // Android has no interactive mode, keep on-drag there.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          />
          {/* FIX (ux-round2 #8): no-match note as an overlay (an inverted-list ListEmptyComponent
              would render upside-down). */}
          {searchQuery.trim().length > 0 && displayRows.length === 0 && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: SPACING.xxl }}>
              <Text style={{ color: colors.textMuted, ...TYPE.body }}>Yüklü mesajlarda sonuç yok</Text>
            </View>
          )}

          {/* Jump-to-latest FAB — appears only when scrolled away from the live end. FIX (ux-round4
              #1): widens into a labeled "Yeni yanıt" pill when a reply landed below while scrolled
              up, so "new content" is visually distinct from "just older history below". */}
          {showScrollToBottom && (
            <TouchableOpacity
              onPress={() => scrollToBottom(true)}
              activeOpacity={MOTION.pressOpacity}
              accessibilityRole="button"
              accessibilityLabel={hasNewBelow ? 'Yeni yanıt geldi, en sona git' : 'En sona git'}
              style={{
                position: 'absolute',
                right: SPACING.xl,
                bottom: SPACING.md,
                width: hasNewBelow ? undefined : 44,
                height: 44,
                paddingHorizontal: hasNewBelow ? SPACING.md : 0,
                borderRadius: RADIUS.full,
                backgroundColor: colors.primary,
                flexDirection: 'row',
                gap: hasNewBelow ? 6 : 0,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 0.5,
                borderColor: colors.border,
              }}
            >
              {hasNewBelow && (
                <Text style={{ color: getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff', ...TYPE.bodyStrong, fontWeight: '700' }}>Yeni yanıt</Text>
              )}
              <Ionicons name="chevron-down" size={22} color={getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff'} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Typing indicator — ux-ideas #7: rotating stage label + cancel after a long wait */}
      {sending && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <TypingIndicator label={typingStages[typingStageIdx] ?? typingLabel} />
          {showTypingCancel && (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={handleCancelTyping}
              accessibilityRole="button"
              accessibilityLabel="Beklemeyi iptal et"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingVertical: 4, paddingHorizontal: SPACING.sm }}
            >
              <Text style={{ ...TYPE.caption, fontWeight: '600', color: colors.textMuted }}>İptal</Text>
            </TouchableOpacity>
          )}
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
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => setShowBarcodeScanner(false)}
            accessibilityRole="button"
            accessibilityLabel="Barkod tarayıcıyı kapat"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ position: 'absolute', top: 8, right: 8, backgroundColor: colors.error, borderRadius: RADIUS.full, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="close" size={18} color={getContrastColor(colors.error) === 'black' ? '#0D0D12' : '#fff'} />
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
          <TouchableOpacity onPress={() => setFullscreenPhoto(photo)} activeOpacity={MOTION.pressOpacity} accessibilityRole="button" accessibilityLabel="Fotoğrafı büyüt">
            <Image source={{ uri: photo }} style={{ width: 60, height: 60, borderRadius: RADIUS.md }} />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => setPhoto(null)}
            accessibilityRole="button"
            accessibilityLabel="Fotoğrafı kaldır"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginLeft: SPACING.sm, width: 24, height: 24, borderRadius: RADIUS.full, backgroundColor: colors.error, justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="close" size={14} color={getContrastColor(colors.error) === 'black' ? '#0D0D12' : '#fff'} />
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary, ...TYPE.caption, marginLeft: SPACING.sm, flex: 1 }}>Foto eklendi. Mesajla birlikte gönderilebilir.</Text>
        </View>
      )}

      {/* Backdate banner — shows when user is logging for a past date */}
      {backdateDate && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.sm, borderWidth: 0.5, borderColor: colors.warning }}>
            <Ionicons name="calendar" size={14} color={colors.warning} />
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }}>
              Kayıt tarihi: {new Date(backdateDate).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => setBackdateDate(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityRole="button" accessibilityLabel="Bugüne sıfırla">
              <Text style={{ ...TYPE.caption, color: colors.textMuted }}>Bugün</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Voice transcription confirmation banner — user can edit input before sending */}
      {voiceConfirmation && Date.now() < voiceConfirmation.expiresAt && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.sm, borderWidth: 0.5, borderColor: colors.primary }}>
            <Ionicons name="mic" size={14} color={colors.primary} />
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }} numberOfLines={2}>
              Duydum: "{voiceConfirmation.text}" — gönder veya düzenle
            </Text>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => { setInput(''); setVoiceConfirmation(null); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityRole="button" accessibilityLabel="İptal">
              <Text style={{ ...TYPE.caption, color: colors.textMuted }}>İptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Undo banner */}
      {undoAction && Date.now() < undoAction.expiresAt && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            // FIX (audit UX-CHT-02): route undo through handleUndo (visible send
            // path with typing + AI bubble + dashboard refresh + error surfacing)
            // instead of a fire-and-forget request that discarded its result.
            onPress={() => handleUndo(undoAction)}
            style={{
              backgroundColor: colors.warning, borderRadius: RADIUS.pill,
              paddingVertical: 6, paddingHorizontal: SPACING.xl, alignSelf: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Son kaydı geri al"
          >
            <Text style={{ ...TYPE.caption, color: getContrastColor(colors.warning) === 'black' ? '#0D0D12' : '#fff' }}>Geri Al (10sn)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Remaining messages badge — onboarding bypass means unlimited; show only when ≤10 left */}
      {!isPremium && remainingMsgs != null && remainingMsgs <= 10 && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: 2 }}>
          {remainingMsgs === 0 ? (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={() => router.push('/settings/premium')}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: SPACING.xs, paddingVertical: SPACING.xs,
                backgroundColor: colors.primary + '15', borderRadius: RADIUS.pill,
              }}
            >
              <Ionicons name="lock-closed" size={12} color={colors.primary} />
              <Text style={{ ...TYPE.caption, fontWeight: '600', color: colors.primary }}>
                Günlük 50 mesaj hakkın bitti — Premium'a geç
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={{
              color: remainingMsgs <= 5 ? colors.warning : colors.textMuted,
              ...TYPE.caption, textAlign: 'center',
            }}>
              {remainingMsgs} mesaj hakkı kaldı
            </Text>
          )}
        </View>
      )}

      {/* Rate-limit banner */}
      {rateLimitCountdown > 0 && (
        <View style={{
          paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm,
          backgroundColor: colors.warning + '22',
          borderTopWidth: 0.5, borderTopColor: colors.warning + '66',
          flexDirection: 'row', alignItems: 'center', gap: 8,
        }}>
          <Ionicons name="time-outline" size={14} color={colors.warning} />
          <Text style={{ ...TYPE.caption, color: colors.warning, flex: 1 }}>
            Mesaj limiti. {rateLimitCountdown} saniye sonra tekrar deneyebilirsin.
          </Text>
        </View>
      )}

      {/* #S1 Task rail — COMPACT one-line chips (the old full-height cards swallowed a third of
          the conversation and truncated their own text mid-word). Topics open inside THIS
          conversation. Hidden while a task topic is active and while the keyboard is up. */}
      {railTasks.length > 0 && !taskModeHint && !keyboardVisible && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <FlatList
            data={railTasks.slice(0, 5)}
            keyExtractor={t => t.key}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.xs }}
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                onPress={() => { haptics.tap(); openTaskTopic(item); }}
                accessibilityRole="button"
                accessibilityLabel={`Koçuna anlat: ${item.title}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary + '33',
                  borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7,
                }}
              >
                <Ionicons name={'add-circle-outline' as keyof typeof Ionicons.glyphMap} size={14} color={colors.primary} />
                {/* maxWidth 200, 11px etikete göre kesilmişti; okuma basamağına çıkınca
                    "Beslenme alışkanlıklarını anlat" gibi başlıklar sınıra dayanıyordu. Sıra
                    zaten yatay kaydırmalı — genişlik bedava, kırpılmış görev başlığı değil. */}
                <Text numberOfLines={1} style={{ color: colors.text, ...TYPE.caption, fontWeight: '600', maxWidth: 240 }}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* FIX (ux-ideas #8): quick-reply strip — one tap continues the conversation instead of a
          blank composer. Shown only when the box is empty, nothing is generating, the keyboard
          is down, there are no onboarding rail tasks (rail owns that slot), a conversation is
          underway (≥2 msgs), and the last turn isn't already awaiting an inline choice/reply. */}
      {!taskModeHint && !keyboardVisible && !sending && input.trim() === ''
        && railTasks.length === 0 && messages.length >= 2 && !suppressQuickReplies && (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xs }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.xs }} keyboardShouldPersistTaps="handled">
            {QUICK_REPLIES.map((q) => (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                key={q}
                onPress={() => handleQuickSelect(q)}
                accessibilityRole="button"
                accessibilityLabel={q}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: colors.surfaceLight, borderWidth: 0.5, borderColor: colors.border,
                  borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7,
                }}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={colors.primary} />
                <Text style={{ color: colors.text, ...TYPE.caption, fontWeight: '600' }}>{q}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input bar — bottom inset is consumed by the tab bar below (embedded-in-tab),
          so only the small gap is needed here. */}
      <View style={{
        paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm,
        paddingBottom: SPACING.sm,
        borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.background,
      }}>
        {/* FIX (kullanıcı bulgusu: "klavye düzeni çok kalabalık"): "+" ile açılan kompakt
            çip sırası — kamera/barkod/geçmiş-tarih buraya taşındı. KAV içinde composer'ın
            hemen üstünde render edildiği için klavyeyle kavga etmez, birlikte yükselir.
            Bir çipe dokunmak mevcut işleyiciyi AYNEN çağırır ve sırayı kapatır. */}
        {showAttachTray && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.sm }}>
            {([
              { key: 'photo', icon: 'camera-outline', label: 'Fotoğraf', onPress: takePhoto },
              // FIX (ux-ideas #3): pickImage (galeri seçici) tanımlıydı ama hiçbir yerden
              // çağrılmıyordu (ulaşılamaz kod). Kullanıcı artık geçmişte çektiği bir tabağı,
              // market etiketini veya menü fotoğrafını da koça gönderebilir — yalnız anlık kamera değil.
              { key: 'gallery', icon: 'image-outline', label: 'Galeriden seç', onPress: pickImage },
              { key: 'barcode', icon: 'barcode-outline', label: 'Barkod', onPress: openBarcodeScanner },
              { key: 'backdate', icon: 'calendar-outline', label: 'Geçmiş tarih', onPress: handleBackdateButton },
            ] as const).map((chip) => {
              const backdateActive = chip.key === 'backdate' && !!backdateDate;
              return (
                <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                  key={chip.key}
                  onPress={() => { haptics.tap(); setShowAttachTray(false); void chip.onPress(); }}
                  accessibilityRole="button"
                  accessibilityLabel={backdateActive ? `Kayıt tarihi: ${formatISODateTR(backdateDate) ?? backdateDate}` : chip.label}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: colors.card, borderWidth: 0.5,
                    borderColor: backdateActive ? colors.warning : colors.border,
                    borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7,
                  }}
                >
                  <Ionicons name={chip.icon} size={14} color={backdateActive ? colors.warning : colors.textSecondary} />
                  <Text style={{ color: colors.text, ...TYPE.caption, fontWeight: '600' }}>{chip.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {/* Char counter — surfaces only when the user is approaching the cap,
            so it doesn't add noise for 99% of messages. */}
        {input.length > 1800 && (
          <Text style={{
            alignSelf: 'flex-end',
            marginBottom: 4,
            ...TYPE.caption,
            color: input.length >= 2000 ? colors.error : colors.textMuted,
          }}>
            {input.length}/2000
          </Text>
        )}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end',
          backgroundColor: colors.card, borderRadius: 24,
          borderWidth: 0.5, borderColor: input.length > 0 ? colors.primary + '66' : colors.border,
          paddingHorizontal: SPACING.md, paddingVertical: 6,
          gap: 4,
          opacity: rateLimitCountdown > 0 ? 0.6 : 1,
        }}>
          {/* Text input */}
          <TextInput
            style={{
              // Diger yazma alani zaten 15/22; ayni rol, ayni basamak.
              flex: 1, color: colors.text, ...TYPE.body,
              paddingVertical: 8, maxHeight: 120,
            }}
            // FIX (kullanıcı bulgusu: "chat tıkandı"): 'Bu konu tamamlandı — yukarıdaki
            // karta dokun' kilit placeholder'ı kaldırıldı — tamamlanma yazmayı kapatmaz.
            placeholder={rateLimitCountdown > 0 ? `Limit doldu — ${rateLimitCountdown}s sonra` : 'Mesajını yaz...'}
            placeholderTextColor={colors.textMuted}
            value={input} onChangeText={setInput}
            multiline maxLength={2000}
            // FIX (ux-pass2, W#10): stay editable while the coach generates — the old
            // `!sending` gate froze typing for the whole 10-60s LLM round-trip AND
            // (Android) flipping editable on a focused input dropped the keyboard after
            // every send. The SEND button still gates on `sending`.
            editable={rateLimitCountdown === 0}
            accessibilityLabel="Mesajını yaz"
          />

          {/* Icon buttons — FIX (kullanıcı bulgusu: "klavye düzeni çok kalabalık"):
              kamera + barkod + geçmiş-tarih tek "+" düğmesinin arkasına toplandı
              (çip sırası yukarıda); satırda birincil eylemler (mikrofon + gönder) kaldı.
              İşleyiciler/izin akışları birebir aynı — yalnızca yerleşim değişti. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
            {/* FIX (ux-round4 #24): expand-to-full-screen appears once the draft outgrows the box. */}
            {input.length > 200 && (
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                onPress={() => { haptics.tap(); setComposeExpanded(true); }}
                accessibilityRole="button"
                accessibilityLabel="Tam ekran yaz"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardElevated, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="expand-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={() => { haptics.tap(); setShowAttachTray(v => !v); }}
              accessibilityRole="button"
              accessibilityLabel={showAttachTray ? 'Ek seçenekleri gizle' : 'Ek seçenekleri göster: fotoğraf, galeriden seç, barkod, geçmiş tarih'}
              accessibilityState={{ expanded: showAttachTray }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: showAttachTray ? colors.primary + '22' : colors.cardElevated,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <Ionicons name="add-circle-outline" size={18}
                color={showAttachTray ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={handleVoiceToggle}
              accessibilityRole="button"
              accessibilityLabel={isRecordingVoice ? 'Ses kaydını durdur' : 'Sesli giriş başlat'}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: isRecordingVoice ? colors.error : colors.cardElevated,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <Ionicons name={isRecordingVoice ? 'stop' : 'mic-outline'} size={16}
                color={isRecordingVoice ? (getContrastColor(colors.error) === 'black' ? '#0D0D12' : '#fff') : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: colors.primary,
                justifyContent: 'center', alignItems: 'center',
                opacity: sendDisabled ? 0.4 : 1,
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Mesaj gönder"
              accessibilityState={{ disabled: sendDisabled }}
              onPress={() => { haptics.tap(); void handleSend(); }} disabled={sendDisabled}
            >
              {sending
                ? <ActivityIndicator size="small" color={getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff'} />
                : <Ionicons name="arrow-up" size={16} color={getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff'} />}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* FIX (ux-round4 #24): full-height compose modal for long drafts — shares `input` state so
          nothing is lost opening/closing; Send routes through the normal handleSend path. */}
      <Modal visible={composeExpanded} animationType="slide" onRequestClose={() => setComposeExpanded(false)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flex: 1, paddingTop: insets.top + SPACING.sm, paddingHorizontal: SPACING.md, paddingBottom: insets.bottom + SPACING.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm }}>
              <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => setComposeExpanded(false)} accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
              <Text style={{ color: colors.text, ...TYPE.headline }}>Mesajını yaz</Text>
              <Text style={{ color: input.length >= 2000 ? colors.error : colors.textMuted, ...TYPE.caption, minWidth: 56, textAlign: 'right' }}>{input.length}/2000</Text>
            </View>
            <TextInput
              style={{ flex: 1, color: colors.text, ...TYPE.body, textAlignVertical: 'top', paddingTop: SPACING.sm }}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2000}
              autoFocus
              placeholder="Mesajını yaz..."
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Mesajını yaz, tam ekran"
            />
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={() => { haptics.tap(); setComposeExpanded(false); void handleSend(); }}
              disabled={sendDisabled}
              accessibilityRole="button"
              accessibilityLabel="Mesaj gönder"
              accessibilityState={{ disabled: sendDisabled }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.sm, opacity: sendDisabled ? 0.4 : 1 }}
            >
              <Ionicons name="arrow-up" size={16} color={getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff'} />
              <Text style={{ color: getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff', ...TYPE.bodyStrong, fontWeight: '700' }}>Gönder</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FIX (ux-round2 #15): full-screen photo viewer — tap a sent/preview meal photo to verify it. */}
      <Modal visible={!!fullscreenPhoto} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setFullscreenPhoto(null)}
          accessibilityRole="button"
          accessibilityLabel="Fotoğrafı kapat"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}
        >
          {fullscreenPhoto && (
            <Image source={{ uri: fullscreenPhoto }} accessibilityLabel="Fotoğraf" style={{ width: '92%', height: '80%', resizeMode: 'contain' }} />
          )}
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => setFullscreenPhoto(null)}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ position: 'absolute', top: insets.top + 16, right: SPACING.xl, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Plan önizleme kartının dokunuşunun karşılığı: planın tamamı. */}
      <FullPlanModal
        visible={!!fullPlan}
        onClose={() => setFullPlan(null)}
        plan={(fullPlan?.plan ?? { plan_type: 'diet', days: [] }) as PlanData}
        planVersion={0}
        weekStart={fullPlan?.weekStart}
      />

      {/* FIX (kullanıcı bulgusu: "toplam kartları görmeliyiz — hangileri bitti hangileri
          bitmedi"): Konular genel bakış modalı. Ayarlar'daki silme-onayı modalının
          desenini izler (fade + karartma + colors.card kart, RADIUS.lg). Bekleyen satıra
          dokunmak mevcut openTaskTopic akışını çağırır; tamamlananlar etkileşimsiz. */}
      <Modal visible={topicsModalVisible} transparent animationType="fade" onRequestClose={() => setTopicsModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: SPACING.xl }}>
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 0.5,
            borderColor: colors.border, padding: SPACING.xl, maxHeight: '78%',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md }}>
              <Text style={{ flex: 1, color: colors.text, ...TYPE.title3 }}>Konular</Text>
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                onPress={() => { haptics.tap(); setTopicsModalVisible(false); }}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {topicsLoading ? (
              <View style={{ paddingVertical: SPACING.xxl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : topicsError ? (
              // Dürüst hata durumu — ağ hatası asla "hiçbir konu tamamlanmadı" gibi görünmez.
              <View style={{ alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.sm }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body, textAlign: 'center' }}>
                  Konular yüklenemedi — bağlantını kontrol edip tekrar dene.
                </Text>
                <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                  onPress={() => { haptics.tap(); void loadTopicsList(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Tekrar dene"
                  style={{
                    paddingVertical: 6, paddingHorizontal: SPACING.lg,
                    borderRadius: RADIUS.pill, backgroundColor: colors.primary + '18',
                  }}
                >
                  <Text style={{ color: colors.primary, ...TYPE.bodyStrong, fontWeight: '700' }}>Tekrar dene</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {topicsList.map(({ task, completed }) => (
                  <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                    key={task.key}
                    disabled={completed}
                    onPress={() => { haptics.tap(); setTopicsModalVisible(false); openTaskTopic(task); }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: completed }}
                    accessibilityLabel={completed ? `${task.title} — tamamlandı` : `${task.title} — konuyu aç`}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                      paddingVertical: SPACING.sm + 2,
                    }}
                  >
                    <Ionicons
                      name={completed ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={completed ? colors.success : colors.textMuted}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1, ...TYPE.body,
                        color: completed ? colors.textMuted : colors.text,
                        fontWeight: completed ? '400' : '600',
                      }}
                    >
                      {task.title}
                    </Text>
                    {!completed && <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// --- Sub-components ---

// Starter-suggestion chips (ÖRNEK BAŞLANGIÇLAR). Pulled out of EmptyState so the SAME
// affordance can be rendered both in the zero-message ScrollView and as the FlatList
// footer when a session has exactly one message — FIX (audit UX-CHT-03): keeping the
// message container as one FlatList from the first real message on, instead of swapping
// ScrollView↔FlatList at the 1→2 boundary (which remounted every bubble and replayed
// all entrance animations at once).
/**
 * Two kinds of starter, and they must not behave the same way.
 *
 * A TEMPLATE contains stand-in specifics ("2 yumurta", "30 yaşında, 80 kilo") that are almost
 * certainly wrong for this user, so it fills the composer for editing — the earlier decision to
 * show a pencil rather than a send-arrow was right, for these.
 *
 * An INTENT is already complete ("Nereden başlayalım?"). Filling the composer with it and making
 * the user tap send is a second tap that buys nothing: driven on a device, tapping the row looked
 * like it had failed, because nothing happened except text appearing somewhere else on screen.
 *
 * The icon follows the behaviour: pencil = "you'll edit this", arrow = "this sends".
 */
type StarterMode = 'template' | 'intent';

function StarterSuggestions({ isOnboarding, onSuggestion, onSend }: {
  isOnboarding: boolean;
  /** Fill the composer (templates). */
  onSuggestion: (text: string) => void;
  /** Send immediately (complete intents). */
  onSend: (text: string) => void;
}) {
  const { colors } = useTheme();
  const onboardingSuggestions = [
    { text: '30 yaşında, 80 kilo, 175 boy erkeğim', icon: 'person-outline' as const, color: colors.success, mode: 'template' as StarterMode },
    { text: 'Kilo vermek istiyorum', icon: 'trending-down-outline' as const, color: colors.error, mode: 'intent' as StarterMode },
    { text: 'Kendimi tanıtmak istiyorum', icon: 'chatbubbles-outline' as const, color: colors.purple, mode: 'intent' as StarterMode },
  ];
  const regularSuggestions = [
    { text: 'Bugün kahvaltıda 2 yumurta yedim', icon: 'restaurant-outline' as const, color: colors.warning, mode: 'template' as StarterMode },
    { text: 'Bugünkü planımı oluştur', icon: 'calendar-outline' as const, color: colors.primary, mode: 'intent' as StarterMode },
    { text: 'Nereden başlayalım?', icon: 'compass-outline' as const, color: colors.purple, mode: 'intent' as StarterMode },
    { text: 'Evde yapabileceğim antrenman öner', icon: 'barbell-outline' as const, color: colors.pink, mode: 'intent' as StarterMode },
  ];
  const suggestions = isOnboarding ? onboardingSuggestions : regularSuggestions;
  return (
    <>
      <Text style={{ ...TYPE.overline, color: colors.textMuted, marginBottom: SPACING.sm }}>
        ÖRNEK BAŞLANGIÇLAR
      </Text>
      <View style={{ gap: SPACING.sm }}>
        {suggestions.map((s, i) => (
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            key={i}
            accessibilityRole="button"
            accessibilityLabel={s.mode === 'intent' ? `${s.text} — gönder` : `${s.text} — düzenlemek için yazı kutusunu doldurur`}
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
            onPress={() => { haptics.tap(); if (s.mode === 'intent') onSend(s.text); else onSuggestion(s.text); }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: RADIUS.md,
                backgroundColor: s.color + '18',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={s.icon} size={16} color={s.color} />
            </View>
            <Text style={{ ...TYPE.body, color: colors.text, flex: 1 }}>{s.text}</Text>
            {/* The icon states the behaviour: a pencil promises "you get to edit this first",
                an arrow promises "this sends". Showing a pencil on a chip that sends — or an
                arrow on one that only fills the box — is the affordance lying about itself. */}
            <Ionicons
              name={s.mode === 'intent' ? 'arrow-up-circle-outline' : 'create-outline'}
              size={14}
              color={s.mode === 'intent' ? s.color : colors.textMuted}
            />
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

// Zero-message empty state — the fresh-chat header + starter suggestions. FIX (audit
// UX-CHT-03): now only used when there are NO real messages; once a session has ≥1
// message the FlatList renders (with StarterSuggestions as its footer at 1 message),
// so the message container never changes mount type as the conversation grows.
function EmptyState({ isOnboarding, onSuggestion, onSend, showSuggestions = true }: {
  isOnboarding: boolean;
  onSuggestion: (text: string) => void;
  onSend: (text: string) => void;
  // In a specific task chat the AI opens with a contextual question, so generic
  // example-starters ("2 yumurta yedim") are irrelevant noise — hide them there.
  showSuggestions?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: SPACING.xl, paddingTop: SPACING.xxl, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Fresh chat header */}
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
        <Text style={{ ...TYPE.title3, color: colors.text, marginBottom: 4 }}>
          Kochko ile konuş
        </Text>
        <Text style={{ ...TYPE.body, color: colors.textSecondary }}>
          Beslenme, antrenman, uyku — ne yedin, nasıl gidiyor, bir sonraki hamle ne olsun.
        </Text>
      </View>

      {showSuggestions && <StarterSuggestions isOnboarding={isOnboarding} onSuggestion={onSuggestion} onSend={onSend} />}
    </ScrollView>
  );
}

/**
 * Thin wrapper around each message that fades + slides in on mount.
 * Pulled out of MessageBubble so hooks can live in a child component without
 * adding an effect per render to the main body.
 */
function MessageBubbleFrame({ isUser, animate = true, children }: { isUser: boolean; animate?: boolean; children: React.ReactNode }) {
  // FIX (ux-pass2, W#71): entrance animation only for genuinely NEW messages — the old
  // unconditional spring replayed a slide-in wave over all ~50 history bubbles on every
  // thread open.
  const anim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [anim, animate]);
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

// FIX (audit UI-CHT-06): wrapped in memo so a bubble only re-renders when its own
// props change. With the now-stable (useMemo/useCallback) props from the parent,
// unrelated re-renders (keyboard, per-second rate-limit countdown, dashboard totals)
// no longer re-render every visible bubble.
const MessageBubble = memo(function MessageBubble({ message, incompleteKeys, dashboardMacros, macroTargets, onQuickSelect, onConfirm, onPlanRejectReason, onLowConfConfirm, onLowConfReject, onPersonaConfirm, onPersonaReject, onSaveRecipe, totalCalories, weeklyBudgetRemaining, onTTSToggle, speakingMsgId, onRetry, onEditUser, onOpenPhoto, onOpenPlan, sending, isLastPending }: {
  message: UIMessage;
  // FIX (kullanıcı bulgusu): tamamlanma kartının öneri filtresi — henüz EKSİK konu
  // anahtarları (parent'ın railTasks'i). Tamamlanmış bir konu asla önerilmez.
  incompleteKeys: string[];
  dashboardMacros: { protein: number; carbs: number; fat: number };
  macroTargets: { protein: number; carbs: number; fat: number };
  onQuickSelect: (option: string) => void;
  onConfirm: () => void;
  onPlanRejectReason: (reason: { label: string; instruction: string }) => void;
  onLowConfConfirm: () => void;
  onLowConfReject: () => void;
  onPersonaConfirm: () => void;
  onPersonaReject: () => void;
  onSaveRecipe: (messageId: string, recipe: RecipeData) => void;
  totalCalories: number;
  weeklyBudgetRemaining: number | null;
  onTTSToggle: (msgId: string, text: string) => void;
  speakingMsgId: string | null;
  onRetry: (message: UIMessage) => void;
  // FIX (ux-round2 #16): long-press a SENT user message → put its text back in the composer to
  // edit and re-ask (a mis-typed quantity no longer means retyping the whole thing).
  onEditUser: (text: string) => void;
  // FIX (ux-round2 #15): open a bubble photo full-screen.
  onOpenPhoto: (uri: string) => void;
  /** Plan önizleme kartına dokunuş — planın tamamını modal'da açar. */
  onOpenPlan: (plan: PlanData) => void;
  // FIX (audit UX-CHT-04): when a send is in flight, disable inline action chips so a
  // double-tap can't fire a second concurrent send (duplicate AI turn / side effect).
  sending: boolean;
  // FIX (ux-round4 #8): this bubble is the newest user message and its send is in flight — shows a
  // "Gönderiliyor" glyph. Computed in the parent so only the last pending bubble is clocked.
  isLastPending?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const isUser = message.role === 'user';
  const [showReasoning, setShowReasoning] = useState(false);
  // FIX (ux-round4 #23): collapse a very long assistant reply behind "Devamını oku".
  const [showFullText, setShowFullText] = useState(false);
  // Inline plan-reject reason picker (replaces the old native Alert action sheet).
  // Tapping "Değiştir" reveals the reason chips below the bubble; picking a chip
  // fires the same handleQuickSelect refine flow; "İptal" just hides them (no-op,
  // matching the old Alert's cancel).
  const [showRejectReasons, setShowRejectReasons] = useState(false);

  // Detect which silent actions this message triggered (for visual badges).
  // B2a: the TYPED receipt decides success vs failure — before this, a weight upsert that
  // errored still green-stamped "Tartı kaydedildi" over the user's data that never landed.
  const allActions = [...(message.actions ?? []), ...(message.actions_executed ?? [])];
  const savedBadges: { icon: string; label: string; color: string }[] = [];
  const seen = new Set<string>();
  const failedTypes = new Set((message.receipts ?? []).filter(r => !r.ok).map(r => r.action_type));
  const BADGE_DEFS: Record<string, { icon: string; done: string; failed: string; color: string }> = {
    profile_update: { icon: 'person-circle-outline', done: 'Profil güncellendi', failed: 'Profil güncellenemedi', color: colors.success },
    meal_log: { icon: 'restaurant-outline', done: 'Öğün kaydedildi', failed: 'Öğün kaydedilemedi', color: colors.carbs },
    weight_log: { icon: 'scale-outline', done: 'Tartı kaydedildi', failed: 'Tartı kaydedilemedi', color: colors.pink },
    water_log: { icon: 'water-outline', done: 'Su kaydedildi', failed: 'Su kaydedilemedi', color: colors.protein },
    sleep_log: { icon: 'moon-outline', done: 'Uyku kaydedildi', failed: 'Uyku kaydedilemedi', color: colors.purple },
    workout_log: { icon: 'fitness-outline', done: 'Antrenman kaydedildi', failed: 'Antrenman kaydedilemedi', color: colors.success },
    supplement_log: { icon: 'medical-outline', done: 'Takviye kaydedildi', failed: 'Takviye kaydedilemedi', color: colors.primary },
    goal_suggestion: { icon: 'flag-outline', done: 'Hedef eklendi', failed: 'Hedef eklenemedi', color: colors.warning },
  };
  for (const a of allActions) {
    if (seen.has(a.type)) continue;
    seen.add(a.type);
    const def = BADGE_DEFS[a.type];
    if (!def) continue;
    const failed = failedTypes.has(a.type);
    savedBadges.push({
      icon: failed ? 'alert-circle-outline' : def.icon,
      label: failed ? def.failed : def.done,
      color: failed ? colors.error : def.color,
    });
  }

  return (
    <MessageBubbleFrame isUser={isUser} animate={/^(u-|a-|q-|topic-|greet-|onboard-)/.test(message.id)}>
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
      }}>
        {/* FIX (audit UI-CHT-05): render the user's just-sent meal photo as a
            thumbnail inside their own bubble. The local URI is carried on the
            optimistic message (localPhotoUri); persisted/loaded messages have no
            URI and fall back to the placeholder text below. */}
        {isUser && message.localPhotoUri && (
          <TouchableOpacity onPress={() => onOpenPhoto(message.localPhotoUri!)} activeOpacity={MOTION.pressOpacity} accessibilityRole="button" accessibilityLabel="Fotoğrafı tam ekran aç">
            <Image
              source={{ uri: message.localPhotoUri }}
              accessibilityLabel="Gönderilen fotoğraf"
              style={{ width: 180, height: 180, borderRadius: RADIUS.md, marginBottom: SPACING.xs }}
            />
          </TouchableOpacity>
        )}

        {/* Message content (strip leaked XML, support **bold** inline formatting).
            FIX (audit UI-CHT-05): hide the bare '[Foto gönderildi]' placeholder when
            the photo thumbnail is already shown — keep any real caption text. */}
        {!(isUser && message.localPhotoUri && message.content === '[Foto gönderildi]') && (() => {
          const clean = sanitizeAssistantText(message.content);
          const txtColor = isUser ? (getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff') : colors.text;
          // No clipboard module in this repo; long-press surfaces the native share sheet.
          const shareText = () => { haptics.tap(); Share.share({ message: clean }).catch(() => {}); };
          // FIX (ux-round2 #16): a SENT user message long-press offers "Düzenle" (→ composer) too.
          const longPress = isUser
            ? () => {
                haptics.tap();
                Alert.alert('Bu mesaj', undefined, [
                  { text: 'Düzenle', onPress: () => onEditUser(clean) },
                  { text: 'Paylaş', onPress: () => { Share.share({ message: clean }).catch(() => {}); } },
                  { text: 'İptal', style: 'cancel' },
                ]);
              }
            : shareText;
          // FIX (ux-ideas #24): crisis/emergency replies → distinct card with one-tap 112.
          if (!isUser && isEmergencyMessage(clean)) return <CrisisBlock text={clean} />;
          // FIX (ux-round4 #23): a long assistant wall (>600 chars or >12 lines) collapses behind
          // a "Devamını oku" toggle so it doesn't push the receipt/actions/composer below the fold.
          const isLong = !isUser && (clean.length > 600 || clean.split('\n').length > 12);
          const shown = (isLong && !showFullText) ? clampText(clean, 480, 10) : clean;
          // FIX (ux-ideas #27): multi-item replies → indented lists/paragraphs; else original path.
          // Aynı mesaj, yapısına göre iki farklı boyutta çıkıyordu: madde/liste içeriyorsa
          // MessageRichText (TYPE.body 15/22), düz paragrafsa aşağıdaki dal (14/21). Önceki geçiş
          // zengin yolu taşımış, düz yolu atlamış — sohbetin yarısı bir boyutta, yarısı başkaydı.
          const body = hasRichStructure(shown)
            ? <MessageRichText content={shown} color={txtColor} onLongPress={longPress} />
            : (
              <Text selectable onLongPress={longPress} style={{ ...TYPE.body, color: txtColor }}>
                {splitBoldSegments(shown).map((seg, i) => (
                  <Text key={i} style={seg.bold ? { fontWeight: '700' } : undefined}>{seg.text}</Text>
                ))}
              </Text>
            );
          if (!isLong) return body;
          return (
            <>
              {body}
              <TouchableOpacity activeOpacity={MOTION.pressOpacity}
                onPress={() => { haptics.tap(); setShowFullText(v => !v); }}
                accessibilityRole="button"
                accessibilityLabel={showFullText ? 'Daha az göster' : 'Devamını oku'}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginTop: 4, alignSelf: 'flex-start' }}
              >
                <Text style={{ ...TYPE.caption, fontWeight: '700', color: colors.primary }}>{showFullText ? 'Daha az göster' : 'Devamını oku'}</Text>
              </TouchableOpacity>
            </>
          );
        })()}

        {/* Navigate-to chip — AI hints the user to a plan screen (Phase 5) */}
        {!isUser && message.navigateTo && (
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push(message.navigateTo as never); }}
            activeOpacity={MOTION.pressOpacity}
            accessibilityRole="button"
            accessibilityLabel={message.navigateTo === '/plan/diet' ? 'Diyet planına git' : message.navigateTo === '/plan/workout' ? 'Spor planına git' : 'Aç'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: SPACING.sm,
              alignSelf: 'flex-start',
              backgroundColor: colors.primary + '18',
              borderRadius: RADIUS.full,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderWidth: 0.5,
              borderColor: colors.primary + '44',
            }}
          >
            <Ionicons
              name={message.navigateTo.includes('diet') ? 'restaurant-outline' : message.navigateTo.includes('workout') ? 'barbell-outline' : 'open-outline'}
              size={12}
              color={colors.primary}
            />
            <Text style={{ ...TYPE.caption, fontWeight: '700', color: colors.primary }}>
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

        {/* FIX (ux-ideas #20): receipt line — show EXACTLY what the coach logged
            (item breakdown + kcal from the action feedback) so the user can catch a
            silent mis-parse, instead of a bare "Öğün kaydedildi" badge + day-total ring. */}
        {!isUser && (() => {
          const receipt = message.actions?.find(a => (a.type === 'meal_log' || a.type === 'workout_log') && a.feedback)?.feedback;
          // F0/A0: a receipt REACHED the screen (not just 'the server returned one').
          if (receipt) trace('receipts_rendered');
          return receipt ? (
            <View style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.sm,
              backgroundColor: colors.surfaceLight, borderRadius: RADIUS.sm,
              paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
            }}>
              <Ionicons name="receipt-outline" size={14} color={colors.carbs} style={{ marginTop: 1 }} />
              <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }}>{receipt}</Text>
            </View>
          ) : null;
        })()}

        {/* Spec 3.3: surface the parser's uncertainty on non-high-confidence meal
            logs so the user knows to double-check the estimate. */}
        {!isUser && (() => {
          const conf = message.actions?.find(a => a.type === 'meal_log' && a.confidence && a.confidence !== 'high')?.confidence;
          return conf ? <ConfidenceBadge level={conf} /> : null;
        })()}

        {/* Onboarding task handoff — MASTER_PLAN §4.1 */}
        {!isUser && message.taskCompletion && (
          <TaskCompletionCard
            taskCompletion={message.taskCompletion}
            incompleteKeys={incompleteKeys}
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
          <QuickSelectButtons options={message.quickSelectOptions} onSelect={onQuickSelect} disabled={sending} />
        )}

        {/* F3/C1 — THE PLAN THE USER IS APPROVING. For three releases the server returned the
            snapshot while this screen only stripped its text remnants: the user saw Onayla
            buttons under an INVISIBLE plan (the audit's one CRITICAL finding). */}
        {!isUser && message.hasPlanSuggestion && message.planSnapshot && (() => { trace('plan_preview_rendered'); return (
          <View style={{ marginTop: SPACING.sm }}>
            <PlanPreviewCard
              plan={message.planSnapshot as unknown as PlanData}
              planType={message.planType ?? 'diet'}
              onPress={() => onOpenPlan(message.planSnapshot as unknown as PlanData)}
            />
          </View>
        ); })()}

        {/* Confirm/Reject buttons for plan suggestion (D14). Reject now reveals
            inline reason chips (PlanRejectReasons) instead of a native Alert. */}
        {!isUser && message.hasPlanSuggestion && (
          <>
            <ConfirmRejectButtons
              onConfirm={onConfirm}
              onReject={() => setShowRejectReasons(v => !v)}
              disabled={sending}
            />
            {showRejectReasons && (
              <PlanRejectReasons
                disabled={sending}
                onPick={(reason) => { setShowRejectReasons(false); onPlanRejectReason(reason); }}
                onCancel={() => setShowRejectReasons(false)}
              />
            )}
          </>
        )}

        {/* Low-confidence verification buttons (Spec 5.32) */}
        {!isUser && message.hasLowConfidenceVerification && !message.hasPlanSuggestion && (
          <ConfirmRejectButtons onConfirm={onLowConfConfirm} onReject={onLowConfReject} disabled={sending} />
        )}

        {/* Persona detection card — shown once after 100+ messages (Spec 5.15) */}
        {!isUser && message.personaDetected && (
          <PersonaCard persona={message.personaDetected} onConfirm={onPersonaConfirm} onReject={onPersonaReject} />
        )}

        {/* Timestamp + TTS button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 6 }}>
          {!isUser && (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              onPress={() => { haptics.tap(); onTTSToggle(message.id, message.content); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={speakingMsgId === message.id ? 'Sesli okumayı durdur' : 'Sesli oku'}
            >
              <Ionicons
                name={speakingMsgId === message.id ? 'stop-circle-outline' : 'volume-medium-outline'}
                size={14}
                color={speakingMsgId === message.id ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
          )}
          {/* FIX (ux-round4 #8): per-message delivery status for user bubbles — queued-offline and
              in-flight sends looked identical to delivered ones on slow/offline networks. */}
          {isUser && !message.failed && (message.id.startsWith('q-') || isLastPending) && (() => {
            const queued = message.id.startsWith('q-');
            const fg = getContrastColor(colors.primary) === 'black' ? 'rgba(13,13,18,0.6)' : 'rgba(255,255,255,0.6)';
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name={queued ? 'cloud-offline-outline' : 'time-outline'} size={11} color={fg} />
                <Text style={{ ...TYPE.footnote, color: fg }}>{queued ? 'Kuyrukta' : 'Gönderiliyor'}</Text>
              </View>
            );
          })()}
          <Text style={{ color: isUser ? (getContrastColor(colors.primary) === 'black' ? 'rgba(13,13,18,0.6)' : 'rgba(255,255,255,0.6)') : colors.textSecondary, ...TYPE.footnote, alignSelf: 'flex-end' }}>
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
      {/* FIX (audit UI-CHT-02): only render the budget card when the user actually
          HAS a weekly budget (weeklyBudgetRemaining != null AND the resulting total > 0).
          Without a plan/budget the store keeps weeklyBudgetRemaining null, which used to
          pass total=0 → a broken "X / 0 kcal" card with a negative "Kalan". Skip it. */}
      {!isUser && weeklyBudgetRemaining != null && totalCalories + weeklyBudgetRemaining > 0
        && message.actions?.some(a => a.type === 'meal_log' && a.feedback) && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs, marginTop: SPACING.xs }}>
          <WeeklyBudgetBar consumed={totalCalories} total={totalCalories + weeklyBudgetRemaining} />
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
        </View>
      )}

      {/* FIX (kullanıcı bulgusu: "Neden bu öneriyi yaptın?" sohbete mesaj yazıyordu —
          saçma): düğme YALNIZCA mesajın hazır <reasoning>'i varsa render edilir ve
          sadece paneli açıp kapatır — chat'e fallback mesajı gönderen yol silindi.
          showFeedback kapısından da çıkarıldı: DB'den yüklenen mesajlar showFeedback
          taşımaz ama reasoning taşır (toUIMessage) — panel reload sonrası da çalışmalı. */}
      {!isUser && message.reasoning && (
        <View style={{ maxWidth: '82%', alignSelf: 'flex-start', paddingLeft: SPACING.xs }}>
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => { haptics.tap(); setShowReasoning(v => { if (!v) trace('reasoning_opened'); return !v; }); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityState={{ expanded: showReasoning }}
            accessibilityLabel={showReasoning ? 'Düşünce sürecini gizle' : 'Düşünce süreci'}
            style={{ marginTop: SPACING.xs, paddingVertical: 4, paddingHorizontal: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Ionicons name="bulb-outline" size={12} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, ...TYPE.caption, textDecorationLine: 'underline' }}>
              {showReasoning ? 'Düşünce sürecini gizle' : 'Düşünce süreci'}
            </Text>
          </TouchableOpacity>
          {showReasoning && (
            <View style={{
              marginTop: SPACING.xs, padding: SPACING.sm, borderRadius: RADIUS.md,
              backgroundColor: isDark ? '#FFFFFF0A' : '#0000000A',
              borderLeftWidth: 2, borderLeftColor: colors.primary,
            }}>
              <Text style={{ color: colors.textSecondary, ...TYPE.body, fontStyle: 'italic' }}>
                {message.reasoning}
              </Text>
            </View>
          )}
        </View>
      )}

      {isUser && message.failed && message.retryPayload && (
        <View style={{ alignSelf: 'flex-end', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={{ color: colors.error, ...TYPE.caption, maxWidth: 200 }} numberOfLines={2}>
            {message.errorMessage ?? 'Gönderilemedi.'}
          </Text>
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => { haptics.tap(); onRetry(message); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              paddingVertical: 4, paddingHorizontal: 10,
              borderRadius: RADIUS.md, backgroundColor: colors.primary,
            }}
            accessibilityRole="button"
            accessibilityLabel="Mesajı yeniden gönder"
          >
            <Text style={{ color: getContrastColor(colors.primary) === 'black' ? '#0D0D12' : '#fff', ...TYPE.caption, fontWeight: '600' }}>Yeniden dene</Text>
          </TouchableOpacity>
        </View>
      )}
    </MessageBubbleFrame>
  );
}); // FIX (audit UI-CHT-06): close memo() wrapper

/**
 * PlanRejectReasons — inline reason chips for "Neyi değiştirelim?".
 * Replaces the old native Alert action sheet (handlePlanReject) with tappable
 * chips rendered directly in the chat. Reasons + their effects are identical;
 * only presentation changed. "İptal" simply dismisses (no side effect), matching
 * the old Alert's cancel button.
 */
function PlanRejectReasons({ onPick, onCancel, disabled = false }: {
  onPick: (reason: { label: string; instruction: string }) => void;
  onCancel: () => void;
  // FIX (audit UX-CHT-04): lock the reason chips while a send is in flight.
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: SPACING.sm, gap: SPACING.xs, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ ...TYPE.caption, color: colors.textMuted, fontWeight: '700' }}>
        Neyi değiştirelim?
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {PLAN_REJECT_REASONS.map((reason) => (
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            key={reason.label}
            disabled={disabled}
            onPress={() => { haptics.tap(); onPick(reason); }}
            accessibilityRole="button"
            accessibilityLabel={reason.label}
            accessibilityState={{ disabled }}
            style={{
              paddingVertical: 8, paddingHorizontal: SPACING.md, minHeight: 36,
              justifyContent: 'center', borderRadius: RADIUS.pill,
              backgroundColor: colors.card, borderWidth: 0.5, borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, ...TYPE.body }}>{reason.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity activeOpacity={MOTION.pressOpacity}
          onPress={() => { haptics.tap(); onCancel(); }}
          accessibilityRole="button"
          accessibilityLabel="İptal"
          style={{
            paddingVertical: 8, paddingHorizontal: SPACING.md, minHeight: 36,
            justifyContent: 'center', borderRadius: RADIUS.pill,
          }}
        >
          <Text style={{ color: colors.textMuted, ...TYPE.bodyStrong }}>İptal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TaskCompletionCard — MASTER_PLAN §4.1
// Shows the summary chip + up to 3 next-task cards after a task chat
// completes its checklist (server-validated task_completion).
// ═══════════════════════════════════════════════════════════════════

function TaskCompletionCard({
  taskCompletion,
  incompleteKeys,
  colors,
}: {
  taskCompletion: { completed: string; summary: string; next_suggestions: string[] };
  // FIX (kullanıcı bulgusu): henüz eksik konu anahtarları — öneriler bununla filtrelenir,
  // tamamlanmış bir konu asla "devam edebileceğin konu" olarak geri gelmez.
  incompleteKeys: string[];
  colors: any;
}) {
  // Phase 7: mini celebration on mount — scale-in bounce on the summary chip +
  // a milestone haptic. No confetti library (would need native rebuild);
  // Animated.spring is enough to feel rewarding without being noisy.
  const chipScale = useRef(new Animated.Value(0.6)).current;
  const chipOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptics.heavy(); // task completed — milestone celebration cue
    Animated.parallel([
      Animated.spring(chipScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(chipOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [chipScale, chipOpacity]);

  // FIX (kullanıcı bulgusu): sunucunun next_suggestions'ı tamamlanma durumundan habersiz —
  // TAMAMLANMIŞ konular öneri kartı olarak dönebiliyordu. Önce eksik-konu filtresi; filtre
  // hepsini elediyse sıradaki eksik konulara düş (kullanıcının her zaman gidecek bir yeri
  // olsun); hiç eksik konu kalmadıysa kart yerine kutlama satırı (aşağıda).
  const nonNullTask = (t: ReturnType<typeof getTaskByKey>): t is NonNullable<ReturnType<typeof getTaskByKey>> => t !== null;
  const serverSuggestions = taskCompletion.next_suggestions
    .filter(k => incompleteKeys.includes(k))
    .map(getTaskByKey)
    .filter(nonNullTask)
    .slice(0, 3);
  const suggestionTasks = serverSuggestions.length > 0
    ? serverSuggestions
    : incompleteKeys.slice(0, 3).map(getTaskByKey).filter(nonNullTask);
  const allTopicsDone = incompleteKeys.length === 0;

  const handleTap = (task: NonNullable<ReturnType<typeof getTaskByKey>>) => {
    // #S1 (one-thread): the next topic CONTINUES the same conversation. Embedded in the
    // tab, that's a param swap in place — no session resolve, no remount, no reload.
    router.setParams({ prefill: task.prefillMessage, taskModeHint: task.taskModeHint, taskNonce: String(Date.now()) });
  };

  return (
    <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
      {/* Summary chip — animated celebration entrance */}
      <Animated.View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          alignSelf: 'flex-start',
          backgroundColor: colors.success + '18',
          borderRadius: RADIUS.full,
          paddingHorizontal: 10, paddingVertical: 5,
          transform: [{ scale: chipScale }],
          opacity: chipOpacity,
        }}
      >
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
        <Text style={{ ...TYPE.caption, fontWeight: '700', color: colors.success }}>
          {taskCompletion.summary ? `Kochko seni tanıdı — ${taskCompletion.summary}` : 'Bu konu tamamlandı'}
        </Text>
      </Animated.View>

      {/* Next-task suggestion cards */}
      {suggestionTasks.length > 0 && (
        <View style={{ gap: 6, marginTop: SPACING.xs }}>
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            DEVAM EDEBİLECEĞİN KONULAR
          </Text>
          {suggestionTasks.map((task) => (
            <TouchableOpacity
              key={task.key}
              onPress={() => { haptics.tap(); handleTap(task); }}
              activeOpacity={MOTION.pressOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${task.title}: ${task.description}`}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: task.color + '33',
                borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm + 2,
              }}
            >
              <View style={{
                width: 32, height: 32, borderRadius: RADIUS.md,
                backgroundColor: task.color + '20',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name={task.icon as keyof typeof Ionicons.glyphMap} size={15} color={task.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...TYPE.bodyStrong, fontWeight: '700', color: colors.text }}>{task.title}</Text>
                <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 1 }} numberOfLines={1}>
                  {task.description}
                </Text>
              </View>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: task.color + '15',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="arrow-forward" size={12} color={task.color} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {/* FIX (kullanıcı bulgusu): hiç eksik konu kalmadıysa öneri kartı yerine küçük
          kutlama satırı — boş bir "DEVAM EDEBİLECEĞİN KONULAR" başlığı asla görünmez. */}
      {allTopicsDone && (
        <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.xs }}>
          Tüm konular tamamlandı 🎉
        </Text>
      )}
      {/* Dead-end escape (ux-pass2, W#28/#47): ALWAYS render "Sohbete devam et" — the old
          suggestionTasks.length === 0 gate meant that whenever next-task cards DID render
          (the common case) a user who wanted none of them was locked out of their own
          composer with no in-screen exit. Clearing the task params in place unlocks it. */}
      <TouchableOpacity activeOpacity={MOTION.pressOpacity}
        onPress={() => { haptics.tap(); router.setParams({ taskModeHint: '', taskNonce: '', prefill: '' }); }}
        accessibilityRole="button"
        accessibilityLabel="Sohbete devam et"
        style={{
          marginTop: SPACING.xs, alignSelf: 'flex-start',
          backgroundColor: colors.primary + '18', borderRadius: RADIUS.full,
          paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
        }}
      >
        <Text style={{ ...TYPE.bodyStrong, fontWeight: '700', color: colors.primary }}>Sohbete devam et →</Text>
      </TouchableOpacity>
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
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: color + '20',
        borderRadius: RADIUS.full,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderWidth: 0.5,
        borderColor: color + '44',
        transform: [{ scale }],
        opacity,
      }}
    >
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={12} color={color} />
      <Text style={{ ...TYPE.caption, fontWeight: '700', color }}>{label}</Text>
    </Animated.View>
  );
}
