/**
 * Workout plan screen — MASTER_PLAN §4.2 / Phase 3.
 * Parallel structure to app/plan/diet.tsx. Differences:
 *   - plan_type = 'workout'
 *   - task_mode_hint = 'plan_workout'
 *   - WorkoutPlanData shape (exercises instead of meals)
 *   - "Bu egzersizi değiştir" prefill uses exercise name + day
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { invokePlanChat, createSession } from '@/services/chat.service';
import {
  getActive,
  getDraft,
  discardDraft,
  applySnapshot,
  type PlanRow,
  type WorkoutPlanData,
} from '@/services/plan.service';
import { isPlanReady } from '@/lib/plan-readiness';
import { canApprovePlan } from '@/lib/premium-gate';
import { PlanEmptyState } from '@/components/plan/PlanEmptyState';
import { PlanPreviewCard } from '@/components/plan/PlanPreviewCard';
import { PlanActiveView } from '@/components/plan/PlanActiveView';
import { FullPlanModal } from '@/components/plan/FullPlanModal';
import { AlternativeComparisonModal } from '@/components/plan/AlternativeComparisonModal';
import { PlanChatComposer } from '@/components/plan/PlanChatComposer';

type ViewState = 'loading' | 'empty' | 'draft' | 'active';
interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
}

export default function WorkoutPlanScreen() {
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
  const [altCandidate, setAltCandidate] = useState<WorkoutPlanData | null>(null);
  const [showAltModal, setShowAltModal] = useState(false);
  const listRef = useRef<FlatList>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    if (!profile) await fetchProfile(user.id);
    const [activeRow, draftRow, goalRes] = await Promise.all([
      getActive(user.id, 'workout'),
      getDraft(user.id, 'workout'),
      supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1),
    ]);
    if (!mountedRef.current) return;
    setActive(activeRow);
    setDraft(draftRow);
    setGoal((goalRes.data as { goal_type?: string; target_weight_kg?: number }[] | null)?.[0] ?? null);
    if (draftRow) setView('draft');
    else if (activeRow) setView('active');
    else setView('empty');
  }, [user?.id, profile, fetchProfile]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const v = (draft?.plan_data as WorkoutPlanData | undefined)?.version;
    if (v !== undefined) setFullyViewed(false);
  }, [(draft?.plan_data as WorkoutPlanData | undefined)?.version]);

  const startDraftCreation = async () => {
    if (!user?.id) return;
    const sid = await createSession({ title: 'Antrenman planı oluşturma', topicTags: ['plan_workout'] });
    if (!sid) return;
    setChatSessionId(sid);
    setSending(true);
    setMessages([{ id: 'trigger', role: 'user', content: '[PLAN_INIT] Profile göre haftalık antrenman programını oluştur.' }]);
    const { data, error } = await invokePlanChat({
      sessionId: sid,
      message: '[PLAN_INIT] Profile göre haftalık antrenman programını oluştur.',
      planType: 'workout',
    });
    setSending(false);
    if (error || !data) {
      setMessages(prev => [...prev, { id: 'err-' + Date.now(), role: 'assistant', content: error ?? 'Plan oluşturulamadı.' }]);
      return;
    }
    setMessages(prev => [
      ...prev,
      { id: 'a-' + Date.now(), role: 'assistant', content: data.message, reasoning: data.plan_reasoning },
    ]);
    await load();
  };

  const sendUserMessage = async (text: string) => {
    if (!chatSessionId) return;
    setMessages(prev => [...prev, { id: 'u-' + Date.now(), role: 'user', content: text }]);
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: text,
      planType: 'workout',
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
    setSending(true);
    const { data } = await invokePlanChat({
      sessionId: chatSessionId,
      message: '[ALT] Lütfen aynı profilimle FARKLI bir yaklaşımla alternatif bir haftalık antrenman programı üret.',
      planType: 'workout',
    });
    setSending(false);
    if (data?.plan_snapshot) {
      setAltCandidate(data.plan_snapshot as unknown as WorkoutPlanData);
      setShowAltModal(true);
    }
    await load();
  };

  const pickCurrent = () => {
    setAltCandidate(null);
    setShowAltModal(false);
  };
  const pickAlternative = async () => {
    if (!altCandidate || !draft || !user?.id) return;
    const updated = await applySnapshot(draft.id, altCandidate, {
      from: 'draft v' + ((draft.plan_data as WorkoutPlanData).version ?? 1),
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
    const gate = canApprovePlan('workout');
    if (!gate.allowed) {
      setMessages(prev => [
        ...prev,
        {
          id: 'paywall-' + Date.now(),
          role: 'assistant',
          content:
            'Ücretsiz paketinde 1 spor planı hakkın vardı ve kullandın. Yeni planları onaylamak için premium\'a geçmen gerekiyor.',
        },
      ]);
      router.push('/settings/premium' as never);
      return;
    }
    setSending(true);
    const { data, error } = await invokePlanChat({
      sessionId: chatSessionId,
      message: 'Planı onaylıyorum.',
      planType: 'workout',
      userApproved: true,
      draftId: draft.id,
    });
    setSending(false);
    if (error || !data?.plan_approved) {
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: error ?? 'Onaylanamadı.' },
      ]);
      return;
    }
    setMessages(prev => [
      ...prev,
      { id: 'a-' + Date.now(), role: 'assistant', content: data.message },
    ]);
    await load();
    setChatSessionId(null);
  };

  const handleRegenerate = async () => {
    if (!draft) return;
    await discardDraft(draft.id);
    setMessages([]);
    setChatSessionId(null);
    await load();
    startDraftCreation();
  };

  const handleStartRevision = async () => {
    if (!user?.id || !active) return;
    const { data: inserted, error } = await supabase
      .from('weekly_plans')
      .insert({
        user_id: user.id,
        plan_type: 'workout',
        status: 'draft',
        week_start: active.week_start,
        plan_data: { ...active.plan_data, version: 1 },
        user_revisions: [],
      })
      .select('id')
      .limit(1);
    if (error || !inserted?.[0]) {
      setMessages(prev => [
        ...prev,
        { id: 'err-' + Date.now(), role: 'assistant', content: error?.message ?? 'Revizyon başlatılamadı, tekrar dene.' },
      ]);
      return;
    }
    const sid = await createSession({ title: 'Antrenman planı revizyonu', topicTags: ['plan_workout'] });
    if (sid) setChatSessionId(sid);
    setMessages([]);
    await load();
  };

  const handleHistory = () => router.push('/plan/history?type=workout' as never);

  if (view === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Antrenman planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (view === 'empty') {
    const readiness = isPlanReady(profile, goal, 'workout');
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Antrenman planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <PlanEmptyState
          planType="workout"
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
        <Stack.Screen options={{ title: 'Antrenman planı', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />
        <PlanActiveView
          plan={active}
          profile={profile}
          goal={goal}
          onStartRevision={handleStartRevision}
          onOpenHistory={handleHistory}
          creatingRevision={sending}
        />
      </View>
    );
  }

  if (view === 'draft' && draft) {
    const planData = draft.plan_data as WorkoutPlanData;
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <Stack.Screen options={{ title: 'Antrenman planı — taslak', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }} />

        <View style={{ padding: SPACING.md, paddingBottom: 0 }}>
          <PlanPreviewCard
            plan={planData}
            planType="workout"
            onPress={() => setShowFullModal(true)}
            updatedLabel={fullyViewed ? 'tamam' : 'yeni versiyon'}
          />
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <DraftChatBubble msg={item} />}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.lg }}>
              Plan hazırlanıyor...
            </Text>
          }
        />

        <PlanChatComposer
          onSend={sendUserMessage}
          onAskReasoning={() => sendUserMessage('Nasıl yaptın? Detaylıca açıkla.')}
          onRequestAlternative={handleAlternative}
          onRegenerate={handleRegenerate}
          onApprove={handleApprove}
          canApprove={fullyViewed}
          approveHint={fullyViewed ? undefined : 'Önce tüm haftayı gözden geçir'}
          sending={sending}
        />

        <View style={{ height: Math.max(insets.bottom, 4), backgroundColor: colors.background }} />

        <FullPlanModal
          visible={showFullModal}
          onClose={() => setShowFullModal(false)}
          plan={planData}
          planVersion={planData.version ?? 1}
          onFullyViewed={() => setFullyViewed(true)}
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
  return (
    <View
      style={{
        maxWidth: '86%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? '#6366F1' : colors.card,
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
      <Text selectable style={{ color: isUser ? '#fff' : colors.text, fontSize: 14, lineHeight: 20 }}>
        {msg.content}
      </Text>
      {msg.reasoning ? (
        <View
          style={{
            marginTop: SPACING.sm,
            paddingTop: SPACING.sm,
            borderTopWidth: 0.5,
            borderTopColor: isUser ? 'rgba(255,255,255,0.3)' : colors.divider,
          }}
        >
          <Text
            style={{
              color: isUser ? 'rgba(255,255,255,0.75)' : colors.textMuted,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 1,
            }}
          >
            GEREKÇE
          </Text>
          <Text
            style={{
              color: isUser ? 'rgba(255,255,255,0.85)' : colors.textSecondary,
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
