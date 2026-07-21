/**
 * Shared plan manager screen — MASTER_PLAN §4.2 / Phase 2+3.
 * Consolidation of app/plan/diet.tsx and app/plan/workout.tsx (~84% identical);
 * the route files are now thin wrappers passing planType.
 *
 * Three states:
 *   (a) Empty   — no active plan, no draft. PlanEmptyState with CTA.
 *   (b) Draft   — user is negotiating. Sticky preview card + plan chat.
 *   (c) Active  — approved plan. PlanActiveView with plan as primary content.
 *
 * State transitions happen by reading from weekly_plans table. The local
 * `view` state memoizes which branch to render without an extra round-trip.
 *
 * Per-type differences live in PLAN_COPY (strings/routes) plus a handful of
 * explicitly-marked `planType === ...` branches. Branches tagged
 * "drift preserved" reproduce pre-consolidation asymmetries between the two
 * screens VERBATIM — do not unify them without a deliberate behavior decision.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Alert,
} from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { invokePlanChat, createHeadlessSession, stripMachineMarkers } from '@/services/chat.service';
import {
  getActive,
  getDraft,
  discardDraft,
  applySnapshot,
  dayLabelTR,
  type PlanRow,
  type PlanData,
  type PlanType,
} from '@/services/plan.service';
import { mealTypeLabelTR } from '@/lib/labels';
import { isPlanReady, type ReadinessExtras } from '@/lib/plan-readiness';
import { canApprovePlan } from '@/lib/premium-gate';
import { PlanEmptyState } from '@/components/plan/PlanEmptyState';
import { PlanPreviewCard } from '@/components/plan/PlanPreviewCard';
import { PlanActiveView } from '@/components/plan/PlanActiveView';
import { FullPlanModal } from '@/components/plan/FullPlanModal';
import { PlanDayAccordion } from '@/components/plan/PlanDayAccordion';
import { AlternativeComparisonModal } from '@/components/plan/AlternativeComparisonModal';
import { PlanChatComposer } from '@/components/plan/PlanChatComposer';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { LoadErrorState } from '@/components/ui/LoadErrorState';

// FIX (audit Wave3): 'error' state for network-failure recovery (was missing → infinite spinner).
type ViewState = 'loading' | 'empty' | 'draft' | 'active' | 'error';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
}

/** Every per-type copy string / route in one place. */
const PLAN_COPY: Record<PlanType, {
  headerTitle: string;
  draftHeaderTitle: string;
  sessionCreateTitle: string;
  sessionReviseTitle: string;
  topicTag: string;
  initMessage: string;
  altMessage: string;
  quotaAlertBody: string;
  paywallMessage: string;
  revisionExistingGreet: string;
  revisionNewGreet: string;
  emptyListHint: string;
  approveHint: string;
  historyRoute: string;
  /** PlanPreviewCard updatedLabel — drift preserved: diet drops the label once
   *  read ('yeni · incele' → undefined); workout swaps it ('az önce güncellendi' → 'okundu'). */
  updatedLabelNew: string;
  updatedLabelViewed?: string;
}> = {
  diet: {
    headerTitle: 'Diyet planı',
    draftHeaderTitle: 'Diyet planı — taslak',
    sessionCreateTitle: 'Diyet planı oluşturma',
    sessionReviseTitle: 'Diyet planı revizyonu',
    topicTag: 'plan_diet',
    initMessage: '[PLAN_INIT] Profile göre haftalık diyet planını oluştur.',
    altMessage: '[ALT] Lütfen aynı profilimle FARKLI bir yaklaşımla alternatif bir haftalık plan üret. Mevcut plana benzemesin.',
    quotaAlertBody: 'Ücretsiz planda 1 diyet planı hakkın doldu. Yeni bir plan oluşturabilirsin ama onaylamak için premium gerekiyor.',
    paywallMessage:
      'Ücretsiz paketinde 1 diyet planı hakkın vardı ve kullandın. Yeni planları onaylamak için premium\'a geçmen gerekiyor.',
    revisionExistingGreet: 'Zaten devam eden bir taslağın var — kaldığın yerden düzenleyelim. Değiştirmek istediğin öğünü ya da günü yaz.',
    revisionNewGreet: 'Mevcut planında neyi değiştirelim? İstediğin öğünü ya da günü yaz, birlikte güncelleyelim.',
    emptyListHint: 'Değiştirmek istediğin şeyi yaz, birlikte düzenleyelim.',
    approveHint: 'Plan güncellendi — yeni haftayı gözden geçir, sonra onayla',
    historyRoute: '/plan/history?type=diet',
    updatedLabelNew: 'yeni · incele',
    updatedLabelViewed: undefined,
  },
  workout: {
    headerTitle: 'Antrenman planı',
    draftHeaderTitle: 'Antrenman planı — taslak',
    sessionCreateTitle: 'Antrenman planı oluşturma',
    sessionReviseTitle: 'Antrenman planı revizyonu',
    topicTag: 'plan_workout',
    initMessage: '[PLAN_INIT] Profile göre haftalık antrenman programını oluştur.',
    altMessage: '[ALT] Lütfen aynı profilimle FARKLI bir yaklaşımla alternatif bir haftalık antrenman programı üret.',
    quotaAlertBody: 'Ücretsiz planda 1 spor planı hakkın doldu. Yeni bir plan oluşturabilirsin ama onaylamak için premium gerekiyor.',
    paywallMessage:
      'Ücretsiz paketinde 1 spor planı hakkın vardı ve kullandın. Yeni planları onaylamak için premium\'a geçmen gerekiyor.',
    revisionExistingGreet: 'Zaten devam eden bir taslağın var — kaldığın yerden düzenleyelim. Neyi değiştirelim?',
    revisionNewGreet: 'Mevcut antrenman planında neyi değiştirelim?',
    emptyListHint: 'Değiştirmek istediğin şeyi yaz',
    approveHint: 'Önce tüm haftayı gözden geçir',
    historyRoute: '/plan/history?type=workout',
    updatedLabelNew: 'az önce güncellendi',
    updatedLabelViewed: 'okundu',
  },
};

export function PlanManagerScreen({ planType }: { planType: PlanType }) {
  const cfg = PLAN_COPY[planType];
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const fetchProfile = useProfileStore(s => s.fetch);
  // Accent for the user chat bubble: diet=teal primary, workout=purple.
  const accent = planType === 'diet' ? colors.primary : colors.purple;

  const [view, setView] = useState<ViewState>('loading');
  const [active, setActive] = useState<PlanRow | null>(null);
  const [draft, setDraft] = useState<PlanRow | null>(null);
  const [goal, setGoal] = useState<{ goal_type?: string; target_weight_kg?: number } | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  // Review fix (efficiency): load() reads the session id through a ref so its useCallback
  // identity doesn't depend on chatSessionId — the old dep re-fired useFocusEffect(load)
  // right after every setChatSessionId, doubling the 6-query load on each draft open.
  const chatSessionIdRef = useRef<string | null>(null);
  chatSessionIdRef.current = chatSessionId;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);
  const [fullyViewed, setFullyViewed] = useState(false);
  const [altCandidate, setAltCandidate] = useState<PlanData | null>(null);
  const [showAltModal, setShowAltModal] = useState(false);
  // FIX (fix-pass 07-12, item 7): allergen/health completion lives off-profile
  // (food_preferences / health_events / ai_summary) — fetched in load() so the
  // empty-state weak-spot chips can drop once those tasks are actually done.
  const [readinessExtras, setReadinessExtras] = useState<ReadinessExtras>({});
  const listRef = useRef<FlatList>(null);

  // ── Inline draft review measurements (fix-pass 07-12, item 2a/2b) ──
  // The plan now renders inline as the chat list header. The approve gate is
  // SEMANTIC (review fix ux-pass2): every content day expanded at least once
  // (PlanDayAccordion.onAllDaysViewed) — geometry fit-checks unlocked while 6 of
  // 7 days were still collapsed. Drag-past-the-plan stays as a secondary path.
  const draftHeaderHRef = useRef(0);
  const userDraggedRef = useRef(false);
  // Autoscroll to the newest bubble ONLY when a message was appended. An
  // unconditional scrollToEnd on every content-size change would instantly
  // scroll the inline plan header out of view on first load and yank the list
  // whenever a day accordion expands.
  const prevMsgCountRef = useRef(0);
  const pendingScrollRef = useRef(false);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) pendingScrollRef.current = true;
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  // ─── Data load ───
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // FIX (audit regression): guard one-time session creation — load() depends on chatSessionId,
  // so setChatSessionId re-runs it; the ref prevents creating two sessions in the race window.
  const creatingSessionRef = useRef(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    // FIX (audit Wave3): wrap the whole load in try/catch — a network/Supabase reject used to
    // leave `view` stuck on 'loading' forever (no setView on the failure path). Now we fall to
    // the 'error' branch which offers a retry button.
    try {
      // Review fix (efficiency): both types read the store fresh via getState(). Workout's
      // old subscribed-closure dep re-created load() (→ full 6-query refetch via focus
      // effect) on EVERY profile-store write; the getState() read one branch over proved
      // the dep was never needed.
      const hasProfile = !!useProfileStore.getState().profile;
      if (!hasProfile) await fetchProfile(user.id);
      const [activeRow, draftRow, goalRes, allergiesRes, healthRes, summaryRes] = await Promise.all([
        getActive(user.id, planType),
        getDraft(user.id, planType),
        supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1),
        // FIX (fix-pass 07-12, item 7): weak-spot chip data (same sources as onboarding-tasks.service).
        // Allergen count is a diet-only readiness input (drift preserved: workout never fetched it).
        planType === 'diet'
          ? supabase.from('food_preferences').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_allergen', true)
          : Promise.resolve(null),
        supabase.from('health_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('ai_summary').select('onboarding_tasks_completed').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!mountedRef.current) return;
      setActive(activeRow);
      setDraft(draftRow);
      setGoal((goalRes.data as { goal_type?: string; target_weight_kg?: number }[] | null)?.[0] ?? null);
      setReadinessExtras({
        ...(planType === 'diet' ? { allergiesCount: allergiesRes?.count ?? 0 } : {}),
        healthEventsCount: healthRes.count ?? 0,
        completedTasks: ((summaryRes.data as Record<string, unknown> | null)?.onboarding_tasks_completed as string[]) ?? [],
      });

      if (draftRow) {
        setView('draft');
        // FIX (audit Wave3): rehydrate chatSessionId for a persisted draft. Without this, a draft
        // reloaded on focus/mount had chatSessionId=null, so send/approve/alternative silently
        // returned (dead end). Derive a fresh session so the draft stays interactive.
        if (!chatSessionIdRef.current && !creatingSessionRef.current) {
          creatingSessionRef.current = true;
          const sid = await createHeadlessSession({ title: cfg.sessionReviseTitle, topicTags: [cfg.topicTag] });
          if (sid && mountedRef.current) setChatSessionId(sid);
          else creatingSessionRef.current = false; // allow retry if creation failed
        }
      } else if (activeRow) setView('active');
      else setView('empty');
    } catch {
      if (mountedRef.current) { haptics.error(); setView('error'); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chatSessionId okunuşu ref üzerinden (yukarıdaki verim notu)
  }, [user?.id, fetchProfile, planType]);

  // FIX (audit regression): useFocusEffect already fires on mount, so a separate
  // useEffect(()=>load(),[load]) double-loaded on every focus. Single source.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Reset fullyViewed whenever snapshot version changes — the accordion resets its
  // viewed-days set on the same version bump and re-fires when all days are re-opened.
  useEffect(() => {
    const v = (draft?.plan_data as PlanData | undefined)?.version;
    if (v !== undefined) setFullyViewed(false);
  }, [(draft?.plan_data as PlanData | undefined)?.version]);

  // ─── Handlers ───
  // FIX (audit UX-PRM-07): surface the premium quota BEFORE the user invests a full
  // conversational draft session. canApprovePlan only blocked at the final 'Onayla' tap,
  // so a free user who'd already used their 1 free plan built an entire plan in chat just
  // to hit the paywall on approval. We now warn up-front (reason === 'free_quota_used') and
  // let them make an informed choice. Draft creation itself stays free, so we resolve `true`
  // when the user chooses to continue and `false` when they back out / go to premium.
  const ensurePlanQuotaAcknowledged = (): Promise<boolean> => {
    if (canApprovePlan(planType).reason !== 'free_quota_used') return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      Alert.alert(
        'Premium gerekiyor',
        cfg.quotaAlertBody,
        [
          { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
          { text: "Premium'a bak", onPress: () => { router.push('/settings/premium' as never); resolve(false); } },
          { text: 'Yine de devam et', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };

  const startDraftCreation = async () => {
    if (!user?.id) return;
    // FIX (audit UX-PRM-07): inform the free user their quota is used before they invest effort.
    if (!(await ensurePlanQuotaAcknowledged())) return;
    // Create a chat session for this plan negotiation.
    const sid = await createHeadlessSession({ title: cfg.sessionCreateTitle, topicTags: [cfg.topicTag] });
    if (!sid) {
      // FIX (fix-pass 07-12, item 8a): silent return = dead button. Tell the user.
      Alert.alert('Bağlantı sorunu', 'Koç oturumu açılamadı. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    setChatSessionId(sid);
    setSending(true);
    // The [PLAN_INIT] sentinel is sent to the LLM only, never mounted. (Review fix:
    // workout's old hidden 'trigger' bubble was a provable no-op — DraftChatBubble
    // rendered it as null — so both types now start from an empty list.)
    setMessages([]);
    const { data, error } = await invokePlanChat({
      sessionId: sid,
      message: cfg.initMessage,
      planType,
    });
    setSending(false);
    if (error || !data) {
      // The messages list only renders inside the 'draft' view; on a creation
      // failure no draft exists so view stays 'empty' (PlanEmptyState) and a
      // pushed bubble would be invisible. Surface the error with an Alert.
      Alert.alert('Plan oluşturulamadı', error ?? 'Bir sorun oluştu, lütfen tekrar dene.');
      return;
    }
    // FIX (ux-pass3): the server can return a friendly reply with NO persisted plan
    // (generation_failed — the model produced only the intro and skipped the snapshot).
    // Without this the screen silently reverted to the active view and the user got a
    // dead-end "işte plan:" with nothing attached. Detect it and offer a retry.
    if (!data.plan_snapshot || data.plan_persist_error) {
      Alert.alert(
        'Plan oluşturulamadı',
        'Koç planı hazırlarken bir sorun oldu. Tekrar denemek ister misin?',
        [
          { text: 'Tekrar dene', onPress: () => { void startDraftCreation(); } },
          { text: 'Vazgeç', style: 'cancel' },
        ],
      );
      return;
    }
    setMessages(prev => [
      ...prev,
      { id: 'a-' + Date.now(), role: 'assistant', content: data.message, reasoning: data.plan_reasoning },
    ]);
    await load(); // refresh draft state
  };

  const sendUserMessage = async (text: string) => {
    setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', content: text }]);
    // FIX (fix-pass 07-12, item 8a): a null session used to swallow the message silently
    // (dead composer). Re-attempt session creation; if that also fails, say so in-thread.
    let sid = chatSessionId;
    if (!sid) {
      sid = await createHeadlessSession({ title: cfg.sessionReviseTitle, topicTags: [cfg.topicTag] });
      if (!sid) {
        setMessages(prev => [
          ...prev,
          { id: 'err-' + Date.now(), role: 'assistant', content: 'Bağlantı sorunu — mesajın gönderilemedi, tekrar dene.' },
        ]);
        return;
      }
      setChatSessionId(sid);
    }
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: sid,
      message: text,
      planType,
    });
    setSending(false);
    if (error || !data) {
      setMessages(prev => [...prev, { id: 'err-' + Date.now(), role: 'assistant', content: error ?? 'Hata.' }]);
      return;
    }
    setMessages(prev => [
      ...prev,
      { id: 'a-' + Date.now(), role: 'assistant', content: data.message, reasoning: data.plan_reasoning },
    ]);
    await load();
  };

  const handleAlternative = async () => {
    if (!chatSessionId || !draft) return;
    // FIX (ux-pass5): re-entrancy guard — the alt modal's "2 alternatif daha" button used
    // to fire a parallel invokePlanChat per re-tap during the 10-30s LLM wait.
    if (sending) return;
    // Ask AI for a second-approach snapshot; we capture it client-side without persisting
    // to the draft row, so the user can pick between current draft and alternative.
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: cfg.altMessage,
      planType,
    });
    setSending(false);
    if (data?.plan_snapshot) {
      setAltCandidate(data.plan_snapshot as unknown as PlanData);
      setShowAltModal(true);
    } else {
      // FIX (fix-pass 07-12, item 8b): the invoke error was discarded — the tap did
      // nothing visible. Surface it in-thread.
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: error ?? 'Alternatif üretilemedi, tekrar dene.' },
      ]);
    }
    await load();
  };

  const pickCurrent = async () => {
    // FIX (ux-pass5): haptic moved here from the modal — keeping the current draft is a
    // local, infallible action so immediate success feedback is honest.
    haptics.success();
    setAltCandidate(null);
    setShowAltModal(false);
  };
  const pickAlternative = async () => {
    if (!altCandidate || !draft || !user?.id) return;
    const updated = await applySnapshot(draft.id, altCandidate, {
      from: 'draft v' + ((draft.plan_data as PlanData).version ?? 1),
      to: 'alternative',
      reason: 'Kullanıcı alternatifi seçti',
    });
    if (!updated) {
      // FIX (ux-pass5): the failure bubble was appended to a chat list hidden BEHIND the
      // still-open fullscreen modal (invisible until manual close) — Alert renders above it.
      haptics.error();
      Alert.alert('Alternatif uygulanamadı', 'Bağlantını kontrol edip tekrar dene.');
      return;
    }
    // FIX (ux-pass5): success haptic AFTER the persist succeeded (was fired pre-network in the modal).
    haptics.success();
    setAltCandidate(null);
    setShowAltModal(false);
    await load();
  };

  const handleApprove = async () => {
    if (!chatSessionId || !draft) return;
    const gate = canApprovePlan(planType);
    if (!gate.allowed) {
      setMessages(prev => [
        ...prev,
        {
          id: 'paywall-' + Date.now(),
          role: 'assistant',
          content: cfg.paywallMessage,
        },
      ]);
      router.push('/settings/premium' as never);
      return;
    }
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: 'Planı onaylıyorum.',
      planType,
      userApproved: true,
      draftId: draft.id,
    });
    setSending(false);
    if (error || !data?.plan_approved) {
      // Surface a specific reason when we have one — e.g. the draft now
      // contains an allergen the user added after the draft was generated.
      let reason = error ?? 'Plan onaylanamadı. Yeni bir taslak oluştur ve tekrar dene.';
      const persistErr = data?.plan_persist_error;
      if (persistErr?.startsWith('allergen_violation')) {
        reason = 'Bu plan alerjen listenle çakışıyor. Koçuna tekrar yazıp planı yenileyelim.';
      } else if (persistErr?.includes('plan_type mismatch')) {
        reason = 'Plan türü uyuşmadı. Koç ekranından tekrar dene.';
      } else if (planType === 'workout' && persistErr?.startsWith('injury_violation')) {
        // Workout-only branch (drift preserved: diet fell through to the generic line).
        reason = 'Bu plan sakatlık bildirimlerinle çakışan egzersizler içeriyor. Yeniden oluşturalım.';
      } else if (persistErr === 'free_quota_used' || persistErr?.includes('quota')) {
        // FIX (ux-readiness): the free-tier plan cap hit at approval time — show the friendly paywall
        // copy + route to premium instead of leaking the raw "free_quota_used" code into the bubble.
        reason = cfg.paywallMessage;
        router.push('/settings/premium' as never);
      } else if (persistErr) {
        reason = `Plan kaydedilemedi: ${persistErr}`;
      }
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: reason },
      ]);
      return;
    }
    setMessages(prev => [
      ...prev,
      { id: 'a-' + Date.now(), role: 'assistant', content: data.message },
    ]);
    // FIX (ux-readiness): refresh the profile so plans_used_free is fresh — otherwise a same-session
    // SECOND plan/revision reads the stale count, skips the up-front quota warning, and only walls at
    // "Onayla" (the invest-then-wall this warning was added to prevent).
    if (user?.id) await fetchProfile(user.id);
    // Reload to switch to active view.
    await load();
    setChatSessionId(null);
  };

  const handleRegenerate = async () => {
    // Drift preserved: diet additionally required user?.id before discarding.
    if (!draft || (planType === 'diet' && !user?.id)) return;
    await discardDraft(draft.id);
    setMessages([]);
    setChatSessionId(null);
    await load();
    startDraftCreation();
  };

  // FIX (ux-audit blocker #3): a clean escape from the draft/revision view. Before this, opening
  // "Kochko ile konuş" INSERTed a draft copy of the active plan, and the only exits were "Onayla ve
  // kaydet" (paywall for free users) or "Baştan başla" (delete+regenerate) — so a user who just
  // wanted to peek or tweak one meal was trapped in revision mode, having lost the active plan's
  // one-tap logging. Discarding the draft returns to the active plan (or the empty state).
  const handleDiscardDraft = () => {
    if (!draft) return;
    const hasActive = !!active;
    Alert.alert(
      hasActive ? 'Revizyondan çık' : 'Taslağı sil',
      hasActive
        ? 'Bu taslak silinecek ve mevcut planına döneceksin. Bu taslakta yaptığın değişiklikler kaybolur.'
        : 'Bu taslak silinecek. Emin misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: hasActive ? 'Çık' : 'Sil',
          style: 'destructive',
          onPress: async () => {
            haptics.tap();
            await discardDraft(draft.id);
            setMessages([]);
            setChatSessionId(null);
            await load(); // active exists → 'active'; otherwise → 'empty'
          },
        },
      ],
    );
  };

  const handleStartRevision = async () => {
    if (!user?.id || !active) return;
    // FIX (ux-audit major): warn a free user whose quota is used BEFORE they invest a whole
    // revision conversation, exactly like startDraftCreation does — otherwise they negotiate a
    // full revision and only hit the paywall at "Onayla ve kaydet" (invest-then-wall).
    if (!(await ensurePlanQuotaAcknowledged())) return;
    // FIX (audit Wave3): check for an existing draft before INSERT. migration 030 enforces a
    // partial UNIQUE(user_id, plan_type) WHERE status='draft', so a blind INSERT over an existing
    // draft threw 23505 and the raw Postgres "duplicate key" string leaked into the chat bubble.
    // FIX (fix-pass 07-12, item 8c): getDraft now throws on network error; we're still in the
    // ACTIVE view here, where chat bubbles are invisible — use an Alert.
    let existing: PlanRow | null = null;
    try {
      existing = await getDraft(user.id, planType);
    } catch {
      Alert.alert('Bağlantı sorunu', 'Revizyon başlatılamadı. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    if (existing) {
      const sid = await createHeadlessSession({ title: cfg.sessionReviseTitle, topicTags: [cfg.topicTag] });
      if (sid) setChatSessionId(sid);
      setMessages([
        {
          id: 'greet-' + Date.now(),
          role: 'assistant',
          content: cfg.revisionExistingGreet,
        },
      ]);
      await load();
      return;
    }
    const { data: inserted, error } = await supabase
      .from('weekly_plans')
      .insert({
        user_id: user.id,
        plan_type: planType,
        status: 'draft',
        week_start: active.week_start,
        plan_data: { ...active.plan_data, version: 1 },
        user_revisions: [],
      })
      .select('id')
      .limit(1);
    if (error || !inserted?.[0]) {
      // FIX (audit Wave3): never surface the raw error.message (English/SQL) — use a fixed Turkish line.
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: 'Revizyon başlatılamadı, tekrar dene.' },
      ]);
      return;
    }
    const sid = await createHeadlessSession({ title: cfg.sessionReviseTitle, topicTags: [cfg.topicTag] });
    if (sid) setChatSessionId(sid);
    // Seed an assistant greeting so the revision chat opens with a clear prompt
    // instead of an empty list that misleadingly reads "Plan hazırlanıyor...".
    setMessages([
      {
        id: 'greet-' + Date.now(),
        role: 'assistant',
        content: cfg.revisionNewGreet,
      },
    ]);
    await load();
  };

  const handleHistory = () => {
    router.push(cfg.historyRoute as never);
  };

  // Shared Stack.Screen options (identical inline literals pre-consolidation).
  const screenOptions = (title: string) => ({
    title,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerShadowVisible: false,
  });

  // Prefill for "bu öğünü değiştir" taps (diet-only surfaces: accordion + full modal).
  const sendMealEdit = (planData: PlanData, dayIndex: number, mealType: string) => {
    const label = dayLabelTR(dayIndex, planData.days?.[dayIndex]?.day_label);
    // FIX (ux-readiness): map the raw English meal_type enum to its Turkish label so the user's own
    // chat bubble doesn't read "Pazartesi - lunch öğününü değiştirir misin?".
    sendUserMessage(`${label} - ${mealTypeLabelTR(mealType)} öğününü değiştirir misin?`);
  };

  // ─── Render ───
  if (view === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={screenOptions(cfg.headerTitle)} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // FIX (audit Wave3): error state mirrors reports/daily.tsx — cloud-offline icon + retry button
  // instead of an endless spinner when load() rejects. (refactor: shared LoadErrorState)
  if (view === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={screenOptions(cfg.headerTitle)} />
        <LoadErrorState title="Plan yüklenemedi" onRetry={() => { haptics.tap(); setView('loading'); load(); }} />
      </View>
    );
  }

  if (view === 'empty') {
    // FIX (fix-pass 07-12, item 7): pass off-profile task data so completed
    // allergen/health tasks stop rendering as weak-spot chips forever.
    const readiness = isPlanReady(profile, goal, planType, readinessExtras);
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={screenOptions(cfg.headerTitle)} />
        <PlanEmptyState
          planType={planType}
          missingCore={readiness.missingCore}
          weakSpots={readiness.weakSpots}
          onCreate={startDraftCreation}
          creating={sending}
        />
      </View>
    );
  }

  if (view === 'active' && active) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={screenOptions(cfg.headerTitle)} />
        <PlanActiveView
          plan={active}
          profile={profile}
          goal={goal}
          onStartRevision={handleStartRevision}
          onOpenHistory={handleHistory}
          // FIX (fix-pass 07-12, item 1): stale-plan banner CTA → brand-new draft via
          // the same generation flow as the empty-state 'Plan oluştur'.
          onCreateFresh={startDraftCreation}
          creatingRevision={sending}
        />
      </View>
    );
  }

  // Draft view
  if (view === 'draft' && draft) {
    const planData = draft.plan_data as PlanData;
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        // FIX (safe-area pass): her iki platformda 'padding' — Expo SDK 55 edge-to-edge
        // altında Android 'height' pencereyi yanlış ölçüyor (onboarding.tsx:532 kalıbı).
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* FIX (ux-audit blocker #3): a discoverable "Çık"/"İptal" in the header — the only clean
            escape from the draft that returns to the active plan (or empty), instead of being
            forced through the paywall or a destructive "Baştan başla". */}
        <Stack.Screen options={{
          ...screenOptions(cfg.draftHeaderTitle),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDiscardDraft}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={active ? 'Revizyondan çık, mevcut plana dön' : 'Taslağı sil'}
            >
              <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '600' }}>{active ? 'Çık' : 'İptal'}</Text>
            </TouchableOpacity>
          ),
        }} />

        {/* Sticky preview card */}
        <View style={{ padding: SPACING.md, paddingBottom: 0 }}>
          <PlanPreviewCard
            plan={planData}
            planType={planType}
            weekStart={draft.week_start}
            onPress={() => setShowFullModal(true)}
            // Drift preserved — diet: reserve the label for a "new, needs review" cue and
            // drop it once read; workout: swap to 'okundu'.
            updatedLabel={fullyViewed ? cfg.updatedLabelViewed : cfg.updatedLabelNew}
          />
        </View>

        {/* Chat area — the plan itself renders INLINE as the list header
            (fix-pass 07-12, item 2b): the day-by-day content used to hide behind
            the tiny preview card, leaving a huge void between card and composer. */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
          onScrollBeginDrag={() => { userDraggedRef.current = true; }}
          onScroll={e => {
            // Gate path 2 (item 2a): user dragged far enough to see the whole
            // inline plan. Guarded by onScrollBeginDrag so the programmatic
            // scrollToEnd on new messages can't silently satisfy the gate.
            if (!userDraggedRef.current) return;
            const { contentOffset, layoutMeasurement } = e.nativeEvent;
            if (draftHeaderHRef.current > 0
              && contentOffset.y + layoutMeasurement.height >= draftHeaderHRef.current - 40) {
              setFullyViewed(true);
            }
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (!pendingScrollRef.current) return;
            pendingScrollRef.current = false;
            listRef.current?.scrollToEnd({ animated: true });
          }}
          renderItem={({ item }) => <DraftChatBubble msg={item} accent={accent} />}
          ListHeaderComponent={
            <View
              onLayout={e => { draftHeaderHRef.current = e.nativeEvent.layout.height; }}
              style={{ paddingBottom: SPACING.xs }}
            >
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '700', letterSpacing: 1, marginBottom: SPACING.sm }}>
                HAFTALIK TASLAK — GÖZDEN GEÇİR
              </Text>
              <PlanDayAccordion
                plan={planData}
                resetKey={planData.version ?? 1}
                onAllDaysViewed={() => setFullyViewed(true)}
                // Review fix: eski changedCells hep [] idi (setter hiç olmadı) — ölü
                // highlightedCells tesisatı silindi; öğün-düzenleme diet'e özgü kalır.
                onMealEdit={planType === 'diet'
                  ? (dayIndex: number, mealType: string) => sendMealEdit(planData, dayIndex, mealType)
                  : undefined}
              />
            </View>
          }
          ListEmptyComponent={
            sending ? null : (
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.lg }}>
                {cfg.emptyListHint}
              </Text>
            )
          }
          // Drift preserved — diet: typing indicator scrolls WITH the list (footer);
          // workout: fixed indicator below the list (see block after the FlatList).
          ListFooterComponent={
            planType === 'diet' && sending ? (
              <View style={{ paddingTop: SPACING.xs }}>
                <TypingIndicator label="Koç düşünüyor" />
              </View>
            ) : null
          }
        />

        {planType === 'workout' && sending ? (
          <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.xs }}>
            <TypingIndicator label="Koç düşünüyor" />
          </View>
        ) : null}

        {/* Composer */}
        <PlanChatComposer
          onSend={sendUserMessage}
          onAskReasoning={() => sendUserMessage('Nasıl yaptın? Detaylıca açıkla.')}
          onRequestAlternative={handleAlternative}
          onRegenerate={handleRegenerate}
          onApprove={handleApprove}
          canApprove={fullyViewed}
          approveHint={fullyViewed ? undefined : cfg.approveHint}
          sending={sending}
        />

        <View style={{ height: Math.max(insets.bottom, 4), backgroundColor: colors.background }} />

        <FullPlanModal
          visible={showFullModal}
          onClose={() => setShowFullModal(false)}
          plan={planData}
          planVersion={planData.version ?? 1}
          weekStart={draft.week_start}
          onFullyViewed={() => setFullyViewed(true)}
          // Review fix: ölü highlightedCells tesisatı silindi (hep [] idi).
          onMealEdit={planType === 'diet'
            ? (dayIndex: number, mealType: string) => {
                setShowFullModal(false);
                sendMealEdit(planData, dayIndex, mealType);
              }
            : undefined}
        />

        {altCandidate ? (
          <AlternativeComparisonModal
            visible={showAltModal}
            onClose={() => { setShowAltModal(false); setAltCandidate(null); }}
            planA={planData}
            planB={altCandidate}
            onPickA={pickCurrent}
            onPickB={pickAlternative}
            onRequestMore={handleAlternative}
            // FIX (ux-pass5): give the in-modal "2 alternatif daha" button an in-flight state
            // (the composer's TypingIndicator is occluded by this fullscreen modal).
            loadingMore={sending}
          />
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  return null;
}

function DraftChatBubble({ msg, accent }: { msg: ChatMsg; accent: string }) {
  const { colors } = useTheme();
  const isUser = msg.role === 'user';
  const hiddenTrigger = msg.content.startsWith('[PLAN_INIT]') || msg.content.startsWith('[ALT]');
  if (isUser && hiddenTrigger) return null;

  // Review fix (ux-pass2): the server appends the <confirm_reject/> machine marker to
  // persisted plan proposals — this surface has its own approve UI, never render it.
  const displayContent = stripMachineMarkers(msg.content);

  // Contrast-aware foreground over the accent bubble (diet: primary, workout: purple).
  // FIX (ux-pass5): workout had drifted to hardcoded white rgba on the purple bubble
  // (~2.8:1 at 11-12px, AA fail) — both types now share diet's contrast-aware branch.
  const userFg = getContrastColor(accent);

  return (
    <View
      style={{
        maxWidth: '86%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? accent : colors.card,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomRightRadius: isUser ? 4 : 16,
        borderBottomLeftRadius: isUser ? 16 : 4,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
        borderWidth: isUser ? 0 : 0.5,
        borderColor: colors.border,
      }}
    >
      <Text selectable style={{ color: isUser ? userFg : colors.text, fontSize: 14, lineHeight: 20 }}>
        {displayContent}
      </Text>
      {msg.reasoning ? (
        <View
          style={{
            marginTop: SPACING.sm,
            paddingTop: SPACING.sm,
            borderTopWidth: 0.5,
            borderTopColor: isUser ? (userFg === 'black' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.3)') : colors.divider,
          }}
        >
          <Text
            style={{
              color: isUser ? (userFg === 'black' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.75)') : colors.textMuted,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1,
            }}
          >
            GEREKÇE
          </Text>
          <Text
            style={{
              color: isUser ? (userFg === 'black' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)') : colors.textSecondary,
              fontSize: 12,
              marginTop: 3,
              lineHeight: 17,
            }}
          >
            {msg.reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
