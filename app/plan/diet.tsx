/**
 * Diet plan screen — MASTER_PLAN §4.2 / Phase 2.
 *
 * Three states:
 *   (a) Empty   — no active plan, no draft. PlanEmptyState with CTA.
 *   (b) Draft   — user is negotiating. Sticky preview card + plan chat.
 *   (c) Active  — approved plan. PlanActiveView with plan as primary content.
 *
 * State transitions happen by reading from weekly_plans table. The local
 * `view` state memoizes which branch to render without an extra round-trip.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Keyboard,
  Alert,
} from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { invokePlanChat, createHeadlessSession } from '@/services/chat.service';
import {
  getActive,
  getDraft,
  discardDraft,
  applySnapshot,
  dayLabelTR,
  type PlanRow,
  type DietPlanData,
} from '@/services/plan.service';
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
import type { PlanData } from '@/services/plan.service';

// FIX (audit Wave3): 'error' state for network-failure recovery (was missing → infinite spinner).
type ViewState = 'loading' | 'empty' | 'draft' | 'active' | 'error';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  plan_version?: number;
}

export default function DietPlanScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const fetchProfile = useProfileStore(s => s.fetch);

  const [view, setView] = useState<ViewState>('loading');
  const [active, setActive] = useState<PlanRow | null>(null);
  const [draft, setDraft] = useState<PlanRow | null>(null);
  const [goal, setGoal] = useState<{ goal_type?: string; target_weight_kg?: number } | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);
  const [fullyViewed, setFullyViewed] = useState(false);
  const [changedCells, setChangedCells] = useState<Array<{ dayIndex: number; mealType: string }>>([]);
  const [altCandidate, setAltCandidate] = useState<DietPlanData | null>(null);
  const [showAltModal, setShowAltModal] = useState(false);
  // FIX (fix-pass 07-12, item 7): allergen/health completion lives off-profile
  // (food_preferences / health_events / ai_summary) — fetched in load() so the
  // empty-state weak-spot chips can drop once those tasks are actually done.
  const [readinessExtras, setReadinessExtras] = useState<ReadinessExtras>({});
  const prevPlanRef = useRef<DietPlanData | null>(null);
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
      if (!useProfileStore.getState().profile) await fetchProfile(user.id);
      const [activeRow, draftRow, goalRes, allergiesRes, healthRes, summaryRes] = await Promise.all([
        getActive(user.id, 'diet'),
        getDraft(user.id, 'diet'),
        supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1),
        // FIX (fix-pass 07-12, item 7): weak-spot chip data (same sources as onboarding-tasks.service).
        supabase.from('food_preferences').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_allergen', true),
        supabase.from('health_events').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('ai_summary').select('onboarding_tasks_completed').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!mountedRef.current) return;
      setActive(activeRow);
      setDraft(draftRow);
      setGoal((goalRes.data as { goal_type?: string; target_weight_kg?: number }[] | null)?.[0] ?? null);
      setReadinessExtras({
        allergiesCount: allergiesRes.count ?? 0,
        healthEventsCount: healthRes.count ?? 0,
        completedTasks: ((summaryRes.data as Record<string, unknown> | null)?.onboarding_tasks_completed as string[]) ?? [],
      });

      if (draftRow) {
        setView('draft');
        prevPlanRef.current = draftRow.plan_data as DietPlanData;
        // FIX (audit Wave3): rehydrate chatSessionId for a persisted draft. Without this, a draft
        // reloaded on focus/mount had chatSessionId=null, so send/approve/alternative silently
        // returned (dead end). Derive a fresh session so the draft stays interactive.
        if (!chatSessionId && !creatingSessionRef.current) {
          creatingSessionRef.current = true;
          const sid = await createHeadlessSession({ title: 'Diyet planı revizyonu', topicTags: ['plan_diet'] });
          if (sid && mountedRef.current) setChatSessionId(sid);
          else creatingSessionRef.current = false; // allow retry if creation failed
        }
      } else if (activeRow) setView('active');
      else setView('empty');
    } catch {
      if (mountedRef.current) { haptics.error(); setView('error'); }
    }
  }, [user?.id, fetchProfile, chatSessionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Reset fullyViewed whenever snapshot version changes — the accordion resets its
  // viewed-days set on the same version bump and re-fires when all days are re-opened.
  useEffect(() => {
    const v = (draft?.plan_data as DietPlanData | undefined)?.version;
    if (v !== undefined) setFullyViewed(false);
  }, [(draft?.plan_data as DietPlanData | undefined)?.version]);

  // ─── Handlers ───
  // FIX (audit UX-PRM-07): surface the premium quota BEFORE the user invests a full
  // conversational draft session. canApprovePlan only blocked at the final 'Onayla' tap,
  // so a free user who'd already used their 1 free plan built an entire plan in chat just
  // to hit the paywall on approval. We now warn up-front (reason === 'free_quota_used') and
  // let them make an informed choice. Draft creation itself stays free, so we resolve `true`
  // when the user chooses to continue and `false` when they back out / go to premium.
  const ensurePlanQuotaAcknowledged = (): Promise<boolean> => {
    if (canApprovePlan('diet').reason !== 'free_quota_used') return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      Alert.alert(
        'Premium gerekiyor',
        'Ücretsiz planda 1 diyet planı hakkın doldu. Yeni bir plan oluşturabilirsin ama onaylamak için premium gerekiyor.',
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
    const sid = await createHeadlessSession({ title: 'Diyet planı oluşturma', topicTags: ['plan_diet'] });
    if (!sid) {
      // FIX (fix-pass 07-12, item 8a): silent return = dead button. Tell the user.
      Alert.alert('Bağlantı sorunu', 'Koç oturumu açılamadı. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    setChatSessionId(sid);
    setSending(true);
    // The [PLAN_INIT] sentinel is sent to the LLM only — never mounted as a
    // visible bubble — so the assistant's reply is the first thing the user sees.
    setMessages([]);
    const { data, error } = await invokePlanChat({
      sessionId: sid,
      message: '[PLAN_INIT] Profile göre haftalık diyet planını oluştur.',
      planType: 'diet',
    });
    setSending(false);
    if (error || !data) {
      // The messages list only renders inside the 'draft' view; on a creation
      // failure no draft exists so view stays 'empty' (PlanEmptyState) and a
      // pushed bubble would be invisible. Surface the error with an Alert.
      Alert.alert('Plan oluşturulamadı', error ?? 'Bir sorun oluştu, lütfen tekrar dene.');
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
      sid = await createHeadlessSession({ title: 'Diyet planı revizyonu', topicTags: ['plan_diet'] });
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
      planType: 'diet',
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
    // Ask AI for a second-approach snapshot; we capture it client-side without persisting
    // to the draft row, so the user can pick between current draft and alternative.
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: '[ALT] Lütfen aynı profilimle FARKLI bir yaklaşımla alternatif bir haftalık plan üret. Mevcut plana benzemesin.',
      planType: 'diet',
    });
    setSending(false);
    if (data?.plan_snapshot) {
      setAltCandidate(data.plan_snapshot as unknown as DietPlanData);
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
    setAltCandidate(null);
    setShowAltModal(false);
  };
  const pickAlternative = async () => {
    if (!altCandidate || !draft || !user?.id) return;
    const updated = await applySnapshot(draft.id, altCandidate, {
      from: 'draft v' + ((draft.plan_data as DietPlanData).version ?? 1),
      to: 'alternative',
      reason: 'Kullanıcı alternatifi seçti',
    });
    if (!updated) {
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: 'Alternatif uygulanamadı, tekrar dene.' },
      ]);
      return;
    }
    setAltCandidate(null);
    setShowAltModal(false);
    await load();
  };

  const handleApprove = async () => {
    if (!chatSessionId || !draft) return;
    const gate = canApprovePlan('diet');
    if (!gate.allowed) {
      setMessages(prev => [
        ...prev,
        {
          id: 'paywall-' + Date.now(),
          role: 'assistant',
          content:
            'Ücretsiz paketinde 1 diyet planı hakkın vardı ve kullandın. Yeni planları onaylamak için premium\'a geçmen gerekiyor.',
        },
      ]);
      router.push('/settings/premium' as never);
      return;
    }
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: 'Planı onaylıyorum.',
      planType: 'diet',
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
    // Reload to switch to active view.
    await load();
    setChatSessionId(null);
  };

  const handleRegenerate = async () => {
    if (!draft || !user?.id) return;
    await discardDraft(draft.id);
    setMessages([]);
    setChatSessionId(null);
    await load();
    startDraftCreation();
  };

  const handleStartRevision = async () => {
    if (!user?.id || !active) return;
    // FIX (audit Wave3): check for an existing draft before INSERT. migration 030 enforces a
    // partial UNIQUE(user_id, plan_type) WHERE status='draft', so a blind INSERT over an existing
    // draft threw 23505 and the raw Postgres "duplicate key" string leaked into the chat bubble.
    // FIX (fix-pass 07-12, item 8c): getDraft now throws on network error; we're still in the
    // ACTIVE view here, where chat bubbles are invisible — use an Alert.
    let existing: PlanRow | null = null;
    try {
      existing = await getDraft(user.id, 'diet');
    } catch {
      Alert.alert('Bağlantı sorunu', 'Revizyon başlatılamadı. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    if (existing) {
      const sid = await createHeadlessSession({ title: 'Diyet planı revizyonu', topicTags: ['plan_diet'] });
      if (sid) setChatSessionId(sid);
      setMessages([
        {
          id: 'greet-' + Date.now(),
          role: 'assistant',
          content: 'Zaten devam eden bir taslağın var — kaldığın yerden düzenleyelim. Değiştirmek istediğin öğünü ya da günü yaz.',
        },
      ]);
      await load();
      return;
    }
    const { data: inserted, error } = await supabase
      .from('weekly_plans')
      .insert({
        user_id: user.id,
        plan_type: 'diet',
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
    const sid = await createHeadlessSession({ title: 'Diyet planı revizyonu', topicTags: ['plan_diet'] });
    if (sid) setChatSessionId(sid);
    // Seed an assistant greeting so the revision chat opens with a clear prompt
    // instead of an empty list that misleadingly reads "Plan hazırlanıyor...".
    setMessages([
      {
        id: 'greet-' + Date.now(),
        role: 'assistant',
        content: 'Mevcut planında neyi değiştirelim? İstediğin öğünü ya da günü yaz, birlikte güncelleyelim.',
      },
    ]);
    await load();
  };

  const handleHistory = () => {
    router.push('/plan/history?type=diet' as never);
  };

  // ─── Render ───
  if (view === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Diyet planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // FIX (audit Wave3): error state mirrors reports/daily.tsx — cloud-offline icon + retry button
  // instead of an endless spinner when load() rejects.
  if (view === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <Stack.Screen options={{ title: 'Diyet planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
        <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' }}>Plan yüklenemedi</Text>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.lg, textAlign: 'center' }}>Bağlantını kontrol edip tekrar dene.</Text>
        <TouchableOpacity
          onPress={() => { haptics.tap(); setView('loading'); load(); }}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>Tekrar dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (view === 'empty') {
    // FIX (fix-pass 07-12, item 7): pass off-profile task data so completed
    // allergen/health tasks stop rendering as weak-spot chips forever.
    const readiness = isPlanReady(profile, goal, 'diet', readinessExtras);
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Diyet planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <PlanEmptyState
          planType="diet"
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
        <Stack.Screen options={{ title: 'Diyet planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
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
    const planData = draft.plan_data as DietPlanData;
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <Stack.Screen options={{ title: 'Diyet planı — taslak', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

        {/* Sticky preview card */}
        <View style={{ padding: SPACING.md, paddingBottom: 0 }}>
          <PlanPreviewCard
            plan={planData}
            planType="diet"
            weekStart={draft.week_start}
            onPress={() => setShowFullModal(true)}
            // Reserve the label for a "new, needs review" cue; once read we drop
            // it so the version line reads cleanly (no read-state/recency mix-up).
            updatedLabel={fullyViewed ? undefined : 'yeni · incele'}
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
          renderItem={({ item }) => <DraftChatBubble msg={item} />}
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
                highlightedCells={changedCells}
                onMealEdit={(dayIndex, mealType) => {
                  const label = dayLabelTR(dayIndex, planData.days?.[dayIndex]?.day_label);
                  sendUserMessage(`${label} - ${mealType} öğününü değiştirir misin?`);
                }}
                onAllDaysViewed={() => setFullyViewed(true)}
              />
            </View>
          }
          ListEmptyComponent={
            sending ? null : (
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.lg }}>
                Değiştirmek istediğin şeyi yaz, birlikte düzenleyelim.
              </Text>
            )
          }
          ListFooterComponent={
            sending ? (
              <View style={{ paddingTop: SPACING.xs }}>
                <TypingIndicator label="Koç düşünüyor" />
              </View>
            ) : null
          }
        />

        {/* Composer */}
        <PlanChatComposer
          onSend={sendUserMessage}
          onAskReasoning={() => sendUserMessage('Nasıl yaptın? Detaylıca açıkla.')}
          onRequestAlternative={handleAlternative}
          onRegenerate={handleRegenerate}
          onApprove={handleApprove}
          canApprove={fullyViewed}
          approveHint={fullyViewed ? undefined : 'Plan güncellendi — yeni haftayı gözden geçir, sonra onayla'}
          sending={sending}
        />

        <View style={{ height: Math.max(insets.bottom, 4), backgroundColor: colors.background }} />

        <FullPlanModal
          visible={showFullModal}
          onClose={() => setShowFullModal(false)}
          plan={planData}
          planVersion={planData.version ?? 1}
          weekStart={draft.week_start}
          highlightedCells={changedCells}
          onFullyViewed={() => setFullyViewed(true)}
          onMealEdit={(dayIndex, mealType) => {
            setShowFullModal(false);
            const dayLabel = dayLabelTR(dayIndex, planData.days?.[dayIndex]?.day_label);
            sendUserMessage(`${dayLabel} - ${mealType} öğününü değiştirir misin?`);
          }}
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
          />
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  return null;
}

function DraftChatBubble({ msg }: { msg: ChatMsg }) {
  const { colors } = useTheme();
  const isUser = msg.role === 'user';
  const hiddenTrigger = msg.content.startsWith('[PLAN_INIT]') || msg.content.startsWith('[ALT]');
  if (isUser && hiddenTrigger) return null;

  // Review fix (ux-pass2): the server appends the <confirm_reject/> machine marker to
  // persisted plan proposals — this surface has its own approve UI, never render it.
  const displayContent = msg.content.replace(/<confirm_reject\s*\/?>/g, '').trim();

  const userFg = getContrastColor(colors.primary);

  return (
    <View
      style={{
        maxWidth: '86%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? colors.primary : colors.card,
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
