/**
 * Empty state for plan screens — shown when no active and no draft exists.
 * CTA is disabled when prerequisites are missing; each missing field becomes
 * a clickable card routing to the correct onboarding task chat.
 *
 * DUOLINGO DİLİ (2026-11-04): ikonlu hale yerine Koçko (boş durum karakterin sahnesi, §0-A).
 * TEK NET EYLEM: ekranın tek dolu tuşu "Plan oluştur" (gövdeli Button, lg). Eksik bilgi
 * satırları ve "daha iyi olabilir" çipleri gövdeli ama gri (ikincil) — dolu tuşla yarışmaz.
 * Plan hazırlanırken Koçko sevinir ve kıpırdar (odaktayken, reduce-motion'a uyar); boştayken
 * statik: dikkat kopya + CTA'da kalmalı (EmptyState ile aynı karar).
 */
import { View, Text, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
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
  const { colors, isDark } = useTheme();
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

  const isFocused = useIsFocused();
  const grey = isDark ? colors.border : colors.progressTrack;
  const isDiet = planType === 'diet';

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
      <View style={{ alignItems: 'center', marginTop: SPACING.xl }}>
        <KochkoMascot size={128} mood={creating || ready ? 'cheer' : 'happy'} animated={!!creating && isFocused} />
        {/* textAlign was missing here while the subtitle right below it centers — so when the
            heading wrapped, the second word ("yok") hung left under a centered first line and the
            block looked broken. Driven on a device that is exactly how it rendered. */}
        <Text
          accessibilityRole="header"
          style={{ ...TYPE.title2, color: colors.text, marginTop: SPACING.lg, textAlign: 'center' }}
        >
          {creating
            ? (isDiet ? 'Menünü hazırlıyorum…' : 'Programını hazırlıyorum…')
            : (isDiet ? 'Diyet planın yok' : 'Spor planın yok')}
        </Text>
        <Text
          style={{
            ...TYPE.body,
            color: colors.textSecondary,
            textAlign: 'center',
            marginTop: SPACING.xs,
            maxWidth: 300,
          }}
        >
          {creating
            ? 'Biraz sürebilir — profilini ve hedefini harmanlıyorum.'
            : !ready
              ? 'Önce birkaç bilgiye ihtiyacım var. Tamamlayınca planını hemen hazırlarım.'
              : isDiet
                ? 'Profiline bakarak haftalık bir menü hazırlayacağım. İstediğin zaman değiştirebilirsin.'
                : 'Seviyene ve ekipmanına göre haftalık bir program hazırlayacağım.'}
        </Text>
      </View>

      {/* Missing core — block plan creation. Kehribar uyarı kartı (statik) + gövdeli satırlar. */}
      {missingCore.length > 0 ? (
        <View
          style={{
            backgroundColor: mix(colors.warning, colors.card, isDark ? 0.14 : 0.07),
            borderRadius: RADIUS.lg,
            borderWidth: 2,
            borderColor: mix(colors.warning, colors.card, 0.5),
            padding: SPACING.md,
            marginTop: SPACING.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="alert-circle" size={18} color={colors.warning} />
            <Text style={{ ...TYPE.bodyStrong, color: colors.warning, fontWeight: '700' }}>
              Plan için eksik bilgiler
            </Text>
          </View>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4 }}>
            Şu bilgileri tamamlayınca plan oluşturulabilir:
          </Text>
          <View style={{ marginTop: SPACING.md, gap: SPACING.xs }}>
            {missingCore.map((f, i) => (
              <ShelfPressable
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                accessibilityRole="button"
                accessibilityLabel={`${f.field} bilgisi eksik, ${f.taskTitle} kartından tamamla`}
                radius={RADIUS.md}
                shelfColor={grey}
                faceStyle={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: colors.card,
                  borderWidth: 2,
                  borderColor: grey,
                  paddingHorizontal: SPACING.md,
                  paddingVertical: SPACING.sm + 2,
                  gap: SPACING.md,
                }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, fontWeight: '800', color: getContrastColor(colors.primary) }}>
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>
                    {f.field}
                  </Text>
                  <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
                    {f.taskTitle} kartından tamamla
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </ShelfPressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Generation preview — content-shaped placeholder during the slow LLM wait */}
      {creating ? (
        <View style={{ marginTop: SPACING.sm, gap: SPACING.xs }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            {isDiet ? 'MENÜN HAZIRLANIYOR' : 'PROGRAMIN HAZIRLANIYOR'}
          </Text>
          <SkeletonCard lines={4} />
        </View>
      ) : null}

      {/* CTA — ekranın TEK dolu tuşu. loading → spinner + busy/disabled (a11y etiketi korunur). */}
      <Button
        title={ready ? 'Plan oluştur' : 'Önce bilgileri tamamla'}
        size="lg"
        onPress={onCreate}
        disabled={!ready}
        loading={!!creating}
        accessibilityLabel={ready ? `${isDiet ? 'Diyet' : 'Spor'} planı oluştur` : 'Önce eksik bilgileri tamamla'}
        icon={ready ? <Ionicons name="sparkles" size={18} color={getContrastColor(colors.primary)} /> : undefined}
        style={{ marginTop: SPACING.sm }}
      />

      {/* Weak spots — optional, ikincil: gri gövdeli kelime kutucukları (sohbet hızlı cevaplarıyla aynı). */}
      {weakSpots.length > 0 && ready && !creating ? (
        <View style={{ marginTop: SPACING.md, alignItems: 'center' }}>
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            PLAN DAHA İYİ OLABİLİR
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4, textAlign: 'center' }}>
            Şunları da konuşursak plan daha kişisel olur:
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.sm }}>
            {weakSpots.slice(0, 4).map((f, i) => (
              <ShelfPressable
                key={i}
                onPress={() => openTaskChat(f.taskKey, f.taskTitle)}
                accessibilityRole="button"
                accessibilityLabel={`${f.field} ekle: ${f.taskTitle}`}
                hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                radius={RADIUS.pill}
                shelfColor={grey}
                faceStyle={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  minHeight: 36,
                  paddingHorizontal: SPACING.md,
                  backgroundColor: colors.card,
                  borderWidth: 2,
                  borderColor: grey,
                }}
              >
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.callout, color: colors.text, fontWeight: '600' }}>
                  {f.field}
                </Text>
              </ShelfPressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
