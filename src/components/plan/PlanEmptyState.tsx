/**
 * Empty state for plan screens — shown when no active and no draft exists.
 * CTA is disabled when prerequisites are missing; each missing field becomes
 * a clickable card routing to the correct onboarding task chat.
 */
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { router } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { getOrCreateActiveSession } from '@/services/chat.service';
import { getTaskByKey } from '@/services/onboarding-tasks.service';
import type { MissingField } from '@/lib/plan-readiness';

interface Props {
  planType: 'diet' | 'workout';
  missingCore: MissingField[];
  weakSpots: MissingField[];
  onCreate: () => void;
  creating?: boolean;
}

export function PlanEmptyState({ planType, missingCore, weakSpots, onCreate, creating }: Props) {
  const { colors } = useTheme();
  const ready = missingCore.length === 0;

  const openTaskChat = async (taskKey: string, _taskTitle: string) => {
    // #S1 (one-thread): task topics land in THE coach conversation (topic behavior rides the
    // task_mode_hint request param, not the session row) — no more per-task session islands.
    const id = await getOrCreateActiveSession();
    if (!id) {
      // FIX (ux-pass5): silent return = dead missing-info card (same convention as
      // diet.tsx fix-pass 07-12 item 8a) — tell the user the tap didn't dead-end for no reason.
      haptics.error();
      Alert.alert('Bağlantı sorunu', 'Koç oturumu açılamadı. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    // FIX (fix-pass 07-12, item 6): hints were hand-built as `onboarding_${taskKey}`,
    // producing values the server doesn't recognize (e.g. 'onboarding_daily_routine' vs
    // canonical 'onboarding_routine'). Use the task registry's own taskModeHint + a
    // taskNonce like every other caller so re-taps re-fire the topic opener.
    const task = getTaskByKey(taskKey);
    const params: Record<string, string> = { taskNonce: String(Date.now()) };
    if (task) {
      params.taskModeHint = task.taskModeHint;
      params.prefill = task.prefillMessage;
    }
    router.push({ pathname: `/chat/${id}` as never, params });
  };

  const accent = planType === 'diet' ? colors.primary : colors.purple;

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
      <View style={{ alignItems: 'center', marginTop: SPACING.xl }}>
        {/* Decorative radial-gradient halo behind the icon */}
        <View
          style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={180} height={180} style={{ position: 'absolute' }}>
            <Defs>
              <RadialGradient id="halo" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0%" stopColor={accent} stopOpacity={0.32} />
                <Stop offset="60%" stopColor={accent} stopOpacity={0.08} />
                <Stop offset="100%" stopColor={accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={90} cy={90} r={90} fill="url(#halo)" />
            <Circle cx={90} cy={90} r={60} fill="none" stroke={accent} strokeOpacity={0.18} strokeWidth={1.5} />
            <Circle cx={90} cy={90} r={75} fill="none" stroke={accent} strokeOpacity={0.10} strokeWidth={1} strokeDasharray="3,4" />
          </Svg>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 28,
              backgroundColor: accent + '22',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: accent + '44',
            }}
          >
            <Ionicons
              name={planType === 'diet' ? 'restaurant' : 'barbell'}
              size={44}
              color={accent}
            />
          </View>
        </View>
        {/* textAlign was missing here while the subtitle right below it centers — so when the
            heading wrapped, the second word ("yok") hung left under a centered first line and the
            block looked broken. Driven on a device that is exactly how it rendered. Centering fixes
            the alignment; if it still wraps, that is a container-width question, not an alignment one. */}
        <Text
          accessibilityRole="header"
          style={{ ...TYPE.title3, color: colors.text, marginTop: SPACING.md, textAlign: 'center' }}
        >
          {planType === 'diet' ? 'Diyet planın yok' : 'Spor planın yok'}
        </Text>
        <Text
          style={{
            ...TYPE.body,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: 4,
            maxWidth: 280,
          }}
        >
          {planType === 'diet'
            ? 'Profiline bakarak haftalık bir menü hazırlayacağım. İstediğin zaman değiştirebilirsin.'
            : 'Seviyene ve ekipmanına göre haftalık bir program hazırlayacağım.'}
        </Text>
      </View>

      {/* Missing core — block plan creation */}
      {missingCore.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.warning + '44',
            padding: SPACING.md,
            marginTop: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={{ ...TYPE.bodyStrong, color: colors.warning, fontWeight: '700' }}>
              Plan için eksik bilgiler
            </Text>
          </View>
          <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 4 }}>
            Şu bilgileri tamamlayınca plan oluşturulabilir:
          </Text>
          <View style={{ marginTop: SPACING.sm, gap: SPACING.xs }}>
            {missingCore.map((f, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                accessibilityRole="button"
                accessibilityLabel={`${f.field} bilgisi eksik, ${f.taskTitle} kartından tamamla`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.surfaceLight,
                  borderRadius: RADIUS.md,
                  padding: SPACING.sm + 2,
                  gap: SPACING.sm,
                }}
              >
                <Ionicons name="arrow-forward-circle" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>
                    {f.field}
                  </Text>
                  <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
                    {f.taskTitle} kartından tamamla
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* Generation preview — content-shaped placeholder during the slow LLM wait */}
      {creating ? (
        <View style={{ marginTop: SPACING.md, gap: SPACING.xs }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            {planType === 'diet' ? 'MENÜN HAZIRLANIYOR' : 'PROGRAMIN HAZIRLANIYOR'}
          </Text>
          <SkeletonCard lines={4} />
        </View>
      ) : null}

      {/* CTA */}
      <TouchableOpacity
        onPress={onCreate}
        disabled={!ready || creating}
        accessibilityRole="button"
        accessibilityLabel={ready ? `${planType === 'diet' ? 'Diyet' : 'Spor'} planı oluştur` : 'Önce eksik bilgileri tamamla'}
        accessibilityState={{ disabled: !ready || !!creating, busy: !!creating }}
        style={{
          marginTop: SPACING.md,
          backgroundColor: ready && !creating ? colors.primary : colors.surfaceLight,
          borderRadius: RADIUS.xl,
          paddingVertical: SPACING.md,
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          {creating ? (
            <ActivityIndicator size="small" color={getContrastColor(colors.primary)} />
          ) : null}
          <Text
            style={{
              ...TYPE.headline,
              color: ready && !creating ? getContrastColor(colors.primary) : colors.textMuted,
              fontWeight: '800',
            }}
          >
            {creating ? 'Hazırlanıyor...' : ready ? 'Plan oluştur' : 'Önce bilgileri tamamla'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Weak spots — optional */}
      {weakSpots.length > 0 && ready ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: SPACING.md,
            marginTop: SPACING.sm,
          }}
        >
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            PLAN DAHA İYİ OLABİLİR
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4 }}>
            Şunları da konuşursak plan daha kişisel olur:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
            {weakSpots.slice(0, 4).map((f, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                accessibilityRole="button"
                accessibilityLabel={`${f.field} ekle: ${f.taskTitle}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: colors.surfaceLight,
                  borderRadius: RADIUS.full,
                  paddingHorizontal: SPACING.sm,
                  paddingVertical: 4,
                }}
              >
                <Ionicons name="add-circle-outline" size={12} color={colors.primary} />
                <Text style={{ ...TYPE.caption, color: colors.text, fontWeight: '600' }}>
                  {f.field}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
