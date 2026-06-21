/**
 * Active plan state (post-approval): plan is the primary content, optionally
 * open a revision chat overlay, see history, and surface the drift banner
 * when the user's profile has materially changed since approval.
 */
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import { DAY_LABELS_TR, type PlanRow, type DietPlanData, type WorkoutPlanData } from '@/services/plan.service';
import type { Profile } from '@/types/database';

interface Props {
  plan: PlanRow;
  profile: Profile | null;
  goal?: { goal_type?: string; target_weight_kg?: number } | null;
  onStartRevision: () => void;
  onOpenHistory: () => void;
  creatingRevision?: boolean;
}

// 0 = Monday in our day_index convention (matches the dashboard helper).
function todayIndex(): number {
  const raw = new Date().getDay();
  return raw === 0 ? 6 : raw - 1;
}

// Drift detection per MASTER_PLAN §4.8.
function detectDrift(
  plan: PlanRow,
  profile: Profile | null,
  currentGoal: { goal_type?: string; target_weight_kg?: number } | null | undefined,
): { soft: string[]; hard: string[] } {
  const soft: string[] = [];
  const hard: string[] = [];
  const snap = plan.approval_snapshot as Record<string, unknown> | null;
  if (!snap || !profile) return { soft, hard };

  const snapWeight = snap.weight_kg as number | null;
  const snapHeight = snap.height_cm as number | null;
  const snapActivity = snap.activity_level as string | null;
  const snapDietMode = snap.diet_mode as string | null;
  const snapGoal = (snap.goal as { goal_type?: string; target_weight_kg?: number } | null) ?? null;

  if (snapWeight && profile.weight_kg && Math.abs(profile.weight_kg - snapWeight) > 3) {
    soft.push(`Kilon ${snapWeight}kg'dan ${profile.weight_kg}kg'a değişmiş`);
  }
  if (snapHeight && profile.height_cm && profile.height_cm !== snapHeight) {
    soft.push('Boy güncellendi');
  }
  if (snapActivity && profile.activity_level && profile.activity_level !== snapActivity) {
    soft.push('Aktivite düzeyin değişmiş');
  }
  if (snapDietMode && profile.diet_mode && profile.diet_mode !== snapDietMode) {
    hard.push('Beslenme modun değişmiş — planı gözden geçirelim');
  }
  if (snapGoal?.goal_type && currentGoal?.goal_type && snapGoal.goal_type !== currentGoal.goal_type) {
    soft.push('Hedefin değişmiş');
  }
  if (
    snapGoal?.target_weight_kg && currentGoal?.target_weight_kg
    && Math.abs(currentGoal.target_weight_kg - snapGoal.target_weight_kg) > 1
  ) {
    soft.push(`Hedef kilon ${snapGoal.target_weight_kg}kg → ${currentGoal.target_weight_kg}kg`);
  }
  return { soft, hard };
}

export function PlanActiveView({ plan, profile, goal, onStartRevision, onOpenHistory, creatingRevision }: Props) {
  const { colors } = useTheme();

  const drift = useMemo(() => detectDrift(plan, profile, goal ?? null), [plan, profile, goal]);

  const data = plan.plan_data;
  const isDiet = data.plan_type === 'diet';
  // plan_data is raw LLM-authored JSON — a structurally-incomplete snapshot can
  // slip past the approve gate (a real active row with days=null exists). Guard
  // like every sibling plan component so a malformed plan doesn't crash the tab (#R6-1).
  type AnyDay = DietPlanData['days'][number] | WorkoutPlanData['days'][number];
  const days: AnyDay[] = Array.isArray((data as { days?: unknown }).days)
    ? ((data as { days: AnyDay[] }).days)
    : [];

  // FIX (audit UI-PLN-06): track the expanded day by ARRAY POSITION, not the
  // untrusted LLM-authored day_index (duplicate indices would collide on key +
  // toggle). Lazy-init to the array slot whose day_index is today so the active
  // plan still opens on today and never lands on a fully-collapsed list.
  const [expandedDay, setExpandedDay] = useState(() => {
    const t = todayIndex();
    const i = days.findIndex(d => d.day_index === t);
    return i >= 0 ? i : 0;
  });
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}>
      {/* Header: summary + revision CTA */}
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.border,
          padding: SPACING.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons
            name={isDiet ? 'restaurant' : 'barbell'}
            size={20}
            color={isDiet ? colors.primary : colors.purple}
          />
          <View style={{ flex: 1, marginLeft: SPACING.sm }}>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800' }}>
              {isDiet ? 'Aktif diyet planın' : 'Aktif spor planın'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              {plan.week_start} · onaylandı
              {plan.approved_at ? ` · ${new Date(plan.approved_at).toLocaleDateString('tr-TR')}` : ''}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm }}>
          <TouchableOpacity
            onPress={onStartRevision}
            disabled={creatingRevision}
            style={{
              flex: 1,
              backgroundColor: colors.primary,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              opacity: creatingRevision ? 0.6 : 1,
            }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={getContrastColor(colors.primary)} />
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>
              Kochko ile konuş
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onOpenHistory}
            style={{
              backgroundColor: colors.surfaceLight,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              paddingHorizontal: SPACING.md,
              alignItems: 'center',
              flexDirection: 'row',
              gap: 4,
            }}
          >
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
              Geçmiş
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Drift banners */}
      {drift.hard.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.errorLight,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.error,
            padding: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="warning" size={16} color={colors.error} />
            <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '700' }}>
              Güvenliğin için planı güncelleyelim
            </Text>
          </View>
          {drift.hard.map((m, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: FONT.xs, marginTop: 4 }}>
              • {m}
            </Text>
          ))}
          <TouchableOpacity
            onPress={onStartRevision}
            style={{
              backgroundColor: colors.error,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              alignItems: 'center',
              marginTop: SPACING.sm,
            }}
          >
            <Text style={{ color: getContrastColor(colors.error), fontSize: FONT.sm, fontWeight: '700' }}>
              Planı güncelle
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {drift.soft.length > 0 && drift.hard.length === 0 ? (
        <View
          style={{
            backgroundColor: colors.warningLight,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.warning,
            padding: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: FONT.xs, fontWeight: '700' }}>
              Verilerinde değişiklik var
            </Text>
          </View>
          {drift.soft.map((m, i) => (
            <Text key={i} style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
              • {m}
            </Text>
          ))}
          <TouchableOpacity onPress={onStartRevision} style={{ marginTop: SPACING.xs }}>
            <Text style={{ color: colors.warning, fontSize: FONT.xs, fontWeight: '700' }}>
              Planı güncelle →
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Days */}
      {days.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
          Bu planın içeriği eksik görünüyor. Plan sekmesinden yeni bir plan oluşturabilirsin.
        </Text>
      ) : days.map((day, dayIdx) => {
        // FIX (audit UI-PLN-06): compare/key by array position, not day.day_index.
        const isOpen = expandedDay === dayIdx;
        return (
          <View key={`${day.day_index}-${dayIdx}`}>
            <TouchableOpacity
              onPress={() => setExpandedDay(isOpen ? -1 : dayIdx)}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceLight,
                borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                gap: SPACING.sm,
              }}
            >
              <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700', flex: 1 }}>
                {day.day_label ?? DAY_LABELS_TR[day.day_index]}
              </Text>
              {isDiet ? (
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                  {/* FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals) */}
                  {Math.round((day as DietPlanData['days'][number]).total_kcal)} kcal
                </Text>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                  {(day as WorkoutPlanData['days'][number]).rest_day
                    ? 'Dinlenme'
                    : `${(day as WorkoutPlanData['days'][number]).exercises?.length ?? 0} egzersiz`}
                </Text>
              )}
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {isOpen ? (
              <View style={{ marginTop: SPACING.sm }}>
                {isDiet ? (
                  ((day as DietPlanData['days'][number]).meals ?? []).map(meal => {
                    // FIX (audit UI-PLN-06): scope meal key by array position so
                    // duplicate day_index values can't share expand-state.
                    const key = `${dayIdx}-${meal.meal_type}`;
                    return (
                      <MealCard
                        key={key}
                        meal={meal}
                        expanded={expandedMeal === key}
                        onToggle={() => setExpandedMeal(expandedMeal === key ? null : key)}
                      />
                    );
                  })
                ) : (day as WorkoutPlanData['days'][number]).rest_day ? (
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: FONT.xs,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      paddingVertical: SPACING.md,
                    }}
                  >
                    Dinlenme günü.
                  </Text>
                ) : (
                  ((day as WorkoutPlanData['days'][number]).exercises ?? []).map((ex, i) => (
                    <ExerciseCard key={i} exercise={ex} />
                  ))
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
