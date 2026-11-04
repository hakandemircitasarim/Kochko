/**
 * Sticky preview card at the top of the plan screen during the
 * draft-in-progress state. Compact — day strip + macro ring + calorie
 * label. Taps open the FullPlanModal.
 *
 * Shows a version badge ("v2 · az önce güncellendi") that updates each
 * time a new snapshot arrives. This pairs with hasViewedFullPlan reset
 * (MASTER_PLAN §4.2 rev2.1) so users can tell which version they'd be
 * approving.
 *
 * DUOLINGO DİLİ (2026-11-04): kart gövdeli tuş (ShelfPressable; 2px gri çerçeve + gri raf,
 * basınca iner — eski PressableCard küçülmesi yerine). Gün şeridi yastık kutucuklar: içerikli
 * gün markanın/antrenmanın açık tonunda opak yüz + 2px ton kenar, boş/dinlenme günü gri.
 */
import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { mix } from '@/lib/design';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import type { DietPlanData, WorkoutPlanData, PlanData } from '@/services/plan.service';
import { DAY_LABELS_TR, DAY_SHORT_TR, formatWeekStartTR } from '@/services/plan.service';
import { ShelfPressable } from '@/components/ui/ShelfPressable';

interface Props {
  plan: PlanData;
  planType: 'diet' | 'workout';
  onPress: () => void;
  updatedLabel?: string; // e.g. "az önce güncellendi"
  /** Stored weekly_plans.week_start (source of truth for the header). The
   *  LLM-authored plan_data.week_start diverged live (row said 06-07, snapshot
   *  said 12-07) — pass the row value so the display reflects what's stored. */
  weekStart?: string;
}

// FIX (fix-pass 07-12, item 2c): the chip rows read '3 3 - 3 3 - 1' with no day
// context. Label every chip with its day ('Pzt Sal Çar Per Cum Cmt Paz').
function dayShort(dayIndex: number, position: number): string {
  return DAY_SHORT_TR[dayIndex] ?? DAY_SHORT_TR[position] ?? '';
}

/** Şerit kutucuğunun tonları — opak (gövdeli kartın içinde de yarı saydamlık yok). */
function useTileTones(accent: string) {
  const { colors, isDark } = useTheme();
  return {
    on: { bg: mix(accent, colors.card, isDark ? 0.22 : 0.12), bd: mix(accent, colors.card, isDark ? 0.6 : 0.45), fg: accent },
    off: { bg: isDark ? colors.surfaceLight : colors.background, bd: isDark ? colors.border : colors.progressTrack, fg: colors.textMuted },
  };
}

function DietStrip({ plan }: { plan: DietPlanData }) {
  const { colors } = useTheme();
  const tones = useTileTones(colors.primary);
  // plan_data is raw LLM JSON; guard days/meals so a malformed snapshot can't crash the card.
  const days = Array.isArray(plan?.days) ? plan.days : [];
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: SPACING.xs }}>
      {days.map((d, i) => {
        const hasMeals = (d.meals?.length ?? 0) > 0;
        const tone = hasMeals ? tones.on : tones.off;
        return (
        // FIX (audit UI-PLN-06): key by array position, not untrusted LLM day_index
        <View key={`${d.day_index}-${i}`} style={{ flex: 1 }}>
          <View
            style={{
              height: 32,
              borderRadius: 10,
              backgroundColor: tone.bg,
              borderWidth: 2,
              borderColor: tone.bd,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                ...TYPE.caption,
                color: tone.fg,
                fontWeight: '800',
              }}
            >
              {DAY_LABELS_TR[d.day_index]?.[0]}
            </Text>
          </View>
          {/* FIX (ux-pass5): fontSize 8 was illegible (smallest text in the app; defeats the
              day-context labels). 10 keeps hierarchy under the 11px chip letter and fits the
              ~40px flex column ('Pzt' at 10/600 ≈ 20px wide). */}
          <Text style={{ ...TYPE.footnote, color: colors.textMuted, fontWeight: '600', textAlign: 'center', marginTop: 2 }}>
            {dayShort(d.day_index, i)}
          </Text>
        </View>
        );
      })}
    </View>
  );
}

function WorkoutStrip({ plan }: { plan: WorkoutPlanData }) {
  const { colors } = useTheme();
  const tones = useTileTones(colors.purple);
  const days = Array.isArray(plan?.days) ? plan.days : [];
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: SPACING.xs }}>
      {days.map((d, i) => {
        const tone = d.rest_day ? tones.off : tones.on;
        return (
          // FIX (audit UI-PLN-06): key by array position, not untrusted LLM day_index
          <View key={`${d.day_index}-${i}`} style={{ flex: 1 }}>
            <View
              style={{
                height: 32,
                borderRadius: 10,
                backgroundColor: tone.bg,
                borderWidth: 2,
                borderColor: tone.bd,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {d.rest_day ? (
                <Ionicons name="moon" size={13} color={tone.fg} />
              ) : (
                <Text style={{ ...TYPE.caption, color: tone.fg, fontWeight: '800' }}>
                  {`${d.exercises?.length ?? 0}`}
                </Text>
              )}
            </View>
            {/* FIX (ux-pass5): fontSize 8 → 10, see DietStrip. */}
            <Text style={{ ...TYPE.footnote, color: colors.textMuted, fontWeight: '600', textAlign: 'center', marginTop: 2 }}>
              {dayShort(d.day_index, i)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}


// ux-sweep: taslağın haftası bu haftanın pazartesisinden eskiyse bayattır.
function isStaleWeek(weekStart: string | null | undefined): boolean {
  if (!weekStart) return false;
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const mondayISO = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return weekStart < mondayISO;
}

export function PlanPreviewCard({ plan, planType, onPress, updatedLabel, weekStart }: Props) {
  const { colors, isDark } = useTheme();
  const grey = isDark ? colors.border : colors.progressTrack;

  const summary = useMemo(() => {
    if (plan.plan_type === 'diet') {
      const d = plan as DietPlanData;
      const days = Array.isArray(d?.days) ? d.days : [];
      const totalKcal = days.reduce((s, day) => s + (day.total_kcal ?? 0), 0);
      const avgKcal = Math.round(totalKcal / Math.max(1, days.filter(x => (x.meals?.length ?? 0) > 0).length));
      return {
        primary: `${avgKcal} kcal/gün`,
        // FIX (audit UI-PLN-02): round raw LLM-authored macro targets so decimals don't leak into the UI
        secondary: `P ${Math.round(d?.targets?.protein ?? 0)}g · K ${Math.round(d?.targets?.carbs ?? 0)}g · Y ${Math.round(d?.targets?.fat ?? 0)}g`,
      };
    }
    const w = plan as WorkoutPlanData;
    const days = Array.isArray(w?.days) ? w.days : [];
    const activeDays = days.filter(d => !d.rest_day).length;
    const totalExercises = days.reduce((s, d) => s + (d.exercises?.length ?? 0), 0);
    return {
      primary: `${activeDays} aktif gün`,
      secondary: `${totalExercises} egzersiz`,
    };
  }, [plan]);

  return (
    <ShelfPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${planType === 'diet' ? 'Bu haftaki diyetin' : 'Bu haftaki sporun'}, ${summary.primary}`}
      accessibilityHint="Planın tamamını tam ekranda aç"
      radius={RADIUS.lg}
      shelfColor={grey}
      faceStyle={{
        backgroundColor: colors.card,
        padding: SPACING.md,
        borderWidth: 2,
        borderColor: grey,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: planType === 'diet' ? colors.primary : colors.purple, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons
            name={planType === 'diet' ? 'restaurant' : 'barbell'}
            size={18}
            color="#FFFFFF"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>
            {planType === 'diet' ? 'Bu haftaki diyetin' : 'Bu haftaki sporun'}
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 1 }}>
            {/* FIX (fix-pass 07-12, item 4c): 'Hafta 2026-07-12' → '12 Temmuz haftası',
                driven by the STORED row week_start (not the LLM snapshot's). */}
            {/* ux-sweep (canlı 07-29): '20 Temmuz haftası' etiketi 'Bu haftaki diyetin'
                başlığıyla ÇELİŞİYORDU — bayat taslakta dürüst konuş: sunucu onayda haftayı
                zaten bugüne çekiyor, kullanıcıya da bunu söyle. */}
            {isStaleWeek(weekStart ?? plan.week_start)
              ? 'Geçen haftadan kalan taslak — onaylarsan bu haftaya uygulanır'
              : `${formatWeekStartTR(weekStart ?? plan.week_start)} · v${plan.version ?? 1}${updatedLabel ? ` · ${updatedLabel}` : ''}`}
          </Text>
        </View>
        <Ionicons name="expand-outline" size={16} color={colors.textMuted} />
      </View>

      {/* Day strip */}
      {plan.plan_type === 'diet' ? (
        <DietStrip plan={plan as DietPlanData} />
      ) : (
        <WorkoutStrip plan={plan as WorkoutPlanData} />
      )}

      {/* Özet artık başlığın sağında değil, şeridin altında: sağ sütun başlığı ikiye bölüyordu
          ("Bu haftaki / diyetin") — 390dp'de rozet + başlık + özet tek satıra sığmıyor. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm, gap: SPACING.sm }}>
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
          <Text style={{ fontWeight: '800', color: colors.text }}>{summary.primary}</Text>
          {`  ·  ${summary.secondary}`}
        </Text>
        <Text style={{ ...TYPE.caption, color: colors.primary, fontWeight: '700' }}>Detay</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
      </View>
    </ShelfPressable>
  );
}
