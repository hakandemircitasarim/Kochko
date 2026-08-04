/**
 * Side-by-side comparison of two plan drafts. Used when the user taps
 * "Alternatif gör": the AI produces a second candidate with same inputs
 * but a different approach, this modal lets the user pick one (the
 * other is discarded to archived).
 *
 * Intentionally compact (summary-level, not full meal detail) — users
 * can open FullPlanModal after picking if they want to drill in.
 */
import { View, Text, ScrollView, TouchableOpacity, Modal, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, GUTTER } from '@/lib/design';
import type { DietPlanData, WorkoutPlanData, PlanData } from '@/services/plan.service';
import { DAY_LABELS_TR } from '@/services/plan.service';

interface Props {
  visible: boolean;
  onClose: () => void;
  planA: PlanData;
  planB: PlanData;
  onPickA: () => void;
  onPickB: () => void;
  onRequestMore?: () => void; // "Hiçbiri olmadı, 2 tane daha göster"
  // FIX (ux-pass5): onRequestMore fires a 10-30s LLM round-trip while this fullscreen
  // modal hides the composer's TypingIndicator — the parent passes its `sending` flag
  // so the button can show an in-flight state and block re-taps.
  loadingMore?: boolean;
}

/** A/B badge. Was two hand-tuned copies (11px/800/tracking-1) of what `TYPE.overline` already is. */
function PlanBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: accent + '22',
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
      }}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.overline, color: accent }}>
        PLAN {label}
      </Text>
    </View>
  );
}

/** Shared pick CTA — one definition so the diet and workout cards cannot drift apart. */
function PickButton({ label, accent, onPick, pickDisabled }: { label: string; accent: string; onPick: () => void; pickDisabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPick}
      // FIX (ux-pass5): picking while a "2 alternatif daha" request is in flight would
      // apply a candidate that's about to be swapped under the finger — block it.
      disabled={pickDisabled}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${label}'yı seç`}
      accessibilityState={{ disabled: !!pickDisabled }}
      style={{
        marginTop: SPACING.md,
        backgroundColor: accent,
        borderRadius: RADIUS.md,
        // 8pt padding around a 13px label gave a ~38px target; the reading step plus 12pt
        // clears 44 without the button growing wider than the half-width card.
        paddingVertical: SPACING.md,
        alignItems: 'center',
        opacity: pickDisabled ? 0.5 : 1,
      }}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ ...TYPE.bodyStrong, fontWeight: '700', color: getContrastColor(accent) }}
      >
        Bunu seç
      </Text>
    </TouchableOpacity>
  );
}

function DietSummary({ plan, label, accent, onPick, pickDisabled, colors }: { plan: DietPlanData; label: string; accent: string; onPick: () => void; pickDisabled?: boolean; colors: any }) {
  // Candidate snapshot is raw LLM JSON — guard days/meals/targets against a malformed shape.
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const totalKcal = days.reduce((s, d) => s + (d.total_kcal ?? 0), 0);
  const activeDays = days.filter(d => (d.meals?.length ?? 0) > 0).length;
  const avgKcal = Math.round(totalKcal / Math.max(1, activeDays));
  const sampleDay = days.find(d => (d.meals?.length ?? 0) > 0);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: accent + '44',
        padding: SPACING.lg,
      }}
    >
      <PlanBadge label={label} accent={accent} />
      {/* The figure is the number, not the sentence. Splitting the unit off lets the digits carry
          the comparison at title3 while still fitting a half-width card — "2127 kcal/gün" as one
          20px string wraps here, which is why this was stuck at 14px and read as body copy. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: SPACING.sm }}>
        <Text style={{ ...TYPE.title3, color: colors.text }}>{avgKcal}</Text>
        <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>kcal/gün</Text>
      </View>
      <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>
        P {plan.targets?.protein ?? 0}g · K {plan.targets?.carbs ?? 0}g · Y {plan.targets?.fat ?? 0}g
      </Text>

      {sampleDay ? (
        <View style={{ marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            ÖRNEK GÜN ({sampleDay.day_label})
          </Text>
          {/* Was 11px, single line, ellipsised — i.e. the one thing the user is here to compare was
              the least readable text on screen. Reading step + a second line; the modal has empty
              space below to spend, so height is the cheap axis here. */}
          {sampleDay.meals.slice(0, 3).map((m, i) => (
            <Text
              key={i}
              style={{ ...TYPE.caption, color: colors.text, marginTop: SPACING.sm }}
              numberOfLines={2}
            >
              {m.name}
            </Text>
          ))}
        </View>
      ) : null}

      <PickButton label={label} accent={accent} onPick={onPick} pickDisabled={pickDisabled} />
    </View>
  );
}

function WorkoutSummary({ plan, label, accent, onPick, pickDisabled, colors }: { plan: WorkoutPlanData; label: string; accent: string; onPick: () => void; pickDisabled?: boolean; colors: any }) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const active = days.filter(d => !d.rest_day);
  const total = active.reduce((s, d) => s + (d.exercises?.length ?? 0), 0);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: accent + '44',
        padding: SPACING.lg,
      }}
    >
      <PlanBadge label={label} accent={accent} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: SPACING.sm }}>
        <Text style={{ ...TYPE.title3, color: colors.text }}>{active.length}</Text>
        <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>aktif gün</Text>
      </View>
      <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>
        {total} toplam egzersiz
      </Text>

      <View style={{ marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
        <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
          HAFTALIK BÖLÜM
        </Text>
        {/* FIX (audit UI-PLN-05): candidate is raw LLM JSON — skip empty days and
            fall back when day_index is out of DAY_LABELS_TR range (0-6) to avoid
            rendering 'undefined: Push'. */}
        {/* Measured on device: "• Pazartesi: Tam vücut kuvve…" — day and focus fought for one
            11px line in a half-width card, so every row ellipsised exactly where the answer was.
            Day on its own line, focus under it with room to wrap. */}
        {active
          .filter(d => (d.exercises?.length ?? 0) > 0)
          .slice(0, 4)
          .map((d, i) => (
            <View key={i} style={{ marginTop: SPACING.sm }}>
              <Text style={{ ...TYPE.caption, fontWeight: '700', color: colors.text }}>
                {DAY_LABELS_TR[d.day_index] ?? d.day_label ?? `Gün ${(d.day_index ?? 0) + 1}`}
              </Text>
              <Text style={{ ...TYPE.caption, color: colors.textMuted }} numberOfLines={2}>
                {d.focus ?? `${d.exercises?.length ?? 0} egzersiz`}
              </Text>
            </View>
          ))}
      </View>

      <PickButton label={label} accent={accent} onPick={onPick} pickDisabled={pickDisabled} />
    </View>
  );
}

export function AlternativeComparisonModal({
  visible,
  onClose,
  planA,
  planB,
  onPickA,
  onPickB,
  onRequestMore,
  loadingMore,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const isDiet = planA.plan_type === 'diet';

  // FIX (ux-round3 #6): the two cards show absolute numbers side by side but not the DIFFERENCE —
  // the user does "1900 vs 1750" arithmetic in their head. Compute a single B-vs-A delta line.
  const deltaLine = (() => {
    if (isDiet) {
      const avg = (p: DietPlanData) => {
        const days = Array.isArray(p?.days) ? p.days : [];
        const active = days.filter(d => (d.meals?.length ?? 0) > 0).length;
        return Math.round(days.reduce((s, d) => s + (d.total_kcal ?? 0), 0) / Math.max(1, active));
      };
      const dk = avg(planB as DietPlanData) - avg(planA as DietPlanData);
      const dp = ((planB as DietPlanData).targets?.protein ?? 0) - ((planA as DietPlanData).targets?.protein ?? 0);
      if (dk === 0 && dp === 0) return null;
      return [dk !== 0 ? `${dk > 0 ? '+' : ''}${dk} kcal/gün` : null, dp !== 0 ? `${dp > 0 ? '+' : ''}${dp}g protein` : null].filter(Boolean).join(' · ');
    }
    const act = (p: WorkoutPlanData) => (Array.isArray(p?.days) ? p.days : []).filter(d => !d.rest_day);
    const aA = act(planA as WorkoutPlanData), aB = act(planB as WorkoutPlanData);
    const tot = (a: WorkoutPlanData['days']) => a.reduce((s, d) => s + (d.exercises?.length ?? 0), 0);
    const da = aB.length - aA.length;
    const dt = tot(aB) - tot(aA);
    if (da === 0 && dt === 0) return null;
    return [da !== 0 ? `${da > 0 ? '+' : ''}${da} aktif gün` : null, dt !== 0 ? `${dt > 0 ? '+' : ''}${dt} egzersiz` : null].filter(Boolean).join(' · ');
  })();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: Platform.OS === 'web' ? 12 : Math.max(insets.top, 12),
            paddingHorizontal: GUTTER,
            paddingBottom: SPACING.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.md,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ padding: 4 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ ...TYPE.title2, color: colors.text, flex: 1 }}>
            İki alternatif
          </Text>
        </View>

        <Text
          style={{
            ...TYPE.callout,
            color: colors.textMuted,
            paddingHorizontal: GUTTER,
            marginBottom: SPACING.lg,
          }}
        >
          Aynı profilinle iki farklı yaklaşım. Hangisi sana daha uygun?
        </Text>

        <ScrollView
          contentContainerStyle={{
            // Was SPACING.md while the header used SPACING.xl, so the cards sat 8px left of the
            // title above them. One gutter for the whole screen.
            paddingHorizontal: GUTTER,
            paddingBottom: Math.max(insets.bottom, SPACING.lg) + SPACING.lg,
          }}
        >
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {/* FIX (ux-pass5): success haptic REMOVED from the pick tap — picking B runs a
                network persist that can fail, so the parent now fires haptics only AFTER
                the outcome (success post-persist, error + Alert on failure). */}
            {isDiet ? (
              <>
                {/* Plan A = brand diet teal, Plan B = brand pink — distinct A/B accents, no off-palette hex */}
                <DietSummary plan={planA as DietPlanData} label="A" accent={colors.primary} onPick={onPickA} pickDisabled={loadingMore} colors={colors} />
                <DietSummary plan={planB as DietPlanData} label="B" accent={colors.pink} onPick={onPickB} pickDisabled={loadingMore} colors={colors} />
              </>
            ) : (
              <>
                {/* Plan A = brand workout purple, Plan B = brand pink — distinct A/B accents, no off-palette hex */}
                <WorkoutSummary plan={planA as WorkoutPlanData} label="A" accent={colors.purple} onPick={onPickA} pickDisabled={loadingMore} colors={colors} />
                <WorkoutSummary plan={planB as WorkoutPlanData} label="B" accent={colors.pink} onPick={onPickB} pickDisabled={loadingMore} colors={colors} />
              </>
            )}
          </View>

          {/* FIX (ux-round3 #6): the concrete B-vs-A difference so the choice is one glance, not mental math. */}
          {deltaLine ? (
            <View style={{ marginTop: SPACING.md, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 6 }}>
              <Ionicons name="swap-horizontal" size={14} color={colors.textSecondary} />
              <Text style={{ ...TYPE.caption, fontWeight: '600', color: colors.textSecondary }}>Plan B, A'ya göre: {deltaLine}</Text>
            </View>
          ) : null}

          {onRequestMore ? (
            // FIX (ux-pass5): the 10-30s LLM call had ZERO in-flight indication inside this
            // fullscreen modal (the composer's TypingIndicator is occluded) and re-taps fired
            // parallel generations — spinner + disabled while loadingMore.
            <TouchableOpacity
              onPress={() => { haptics.tap(); onRequestMore(); }}
              disabled={loadingMore}
              accessibilityRole="button"
              accessibilityLabel={loadingMore ? 'Yeni alternatifler hazırlanıyor' : 'Hiçbiri olmadı, 2 alternatif daha göster'}
              accessibilityState={{ disabled: !!loadingMore, busy: !!loadingMore }}
              style={{
                marginTop: SPACING.lg,
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.surfaceLight,
                borderRadius: RADIUS.full,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                opacity: loadingMore ? 0.7 : 1,
              }}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.textSecondary} style={{ transform: [{ scale: 0.8 }] }} />
              ) : (
                <Ionicons name="refresh" size={15} color={colors.textSecondary} />
              )}
              <Text style={{ ...TYPE.caption, fontWeight: '600', color: colors.textSecondary }}>
                {loadingMore ? 'Yeni alternatifler hazırlanıyor...' : 'Hiçbiri olmadı, 2 alternatif daha göster'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
