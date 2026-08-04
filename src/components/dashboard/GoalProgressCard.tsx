/**
 * Goal Progress Card — the dashboard's "north star" (ux-ideas #10).
 *
 * The user's actual motivation (how much they've lost/gained, how much is left,
 * whether they're on pace, and the projected finish date) had NO home on the
 * home screen even though dashboard.store already computes goalProgress on every
 * fetch. This surfaces it: a compact progress line + pace badge + ETA, tappable
 * through to the goal settings. Only weight-change goals render (maintain/health
 * goals have no meaningful "distance to target").
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import type { GoalProgress, PaceStatus } from '@/lib/goal-progress';

interface Props {
  progress: GoalProgress;
  goalType: string;
  onPress?: () => void;
}

const nf = (n: number) => String(n).replace('.', ',');

export function GoalProgressCard({ progress, goalType, onPress }: Props) {
  const { colors } = useTheme();

  const isWeightGoal = goalType === 'lose_weight' || goalType === 'gain_weight' || goalType === 'gain_muscle';
  if (!isWeightGoal) return null;

  const direction = goalType === 'lose_weight' ? 'verdin' : 'aldın';
  // FIX (ux-review): kgLost is SIGNED (negative = moving the wrong way). Only claim a
  // direction ("X kg verdin/aldın") when actually progressing; otherwise Math.abs() would
  // assert the opposite of reality next to a 0% bar. Neutral phrasing when off-track.
  const movingRight = progress.kgLost > 0;
  const progressLine = movingRight
    ? `${nf(Math.abs(progress.kgLost))} kg ${direction} · ${nf(progress.kgRemaining)} kg kaldı`
    : `Hedefe ${nf(progress.kgRemaining)} kg`;
  const a11yProgressLine = movingRight
    ? `${nf(Math.abs(progress.kgLost))} kilogram ${direction}, hedefe ${nf(progress.kgRemaining)} kilogram kaldı`
    : `Hedefe ${nf(progress.kgRemaining)} kilogram`;

  const tempo: Record<PaceStatus, { label: string; color: string }> = {
    ahead: { label: 'Tempon çok iyi', color: colors.success },
    on_track: { label: 'Yolundasın', color: colors.success },
    behind: { label: 'Biraz geride', color: colors.warning },
    stalled: { label: 'Duraklama', color: colors.errorText },
  };
  const badge = tempo[progress.paceStatus];

  const etaText = (() => {
    if (progress.isGoalReached || !progress.estimatedCompletionDate) return null;
    try {
      const d = new Date(`${progress.estimatedCompletionDate}T12:00:00`);
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    } catch {
      return null;
    }
  })();

  const barColor = progress.paceStatus === 'stalled'
    ? colors.errorText
    : progress.paceStatus === 'behind'
      ? colors.warning
      : colors.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={
        progress.isGoalReached
          ? 'Hedefine ulaştın. Hedef ayarlarını açmak için dokun'
          : `Hedef: ${a11yProgressLine}. ${badge.label}.${etaText ? ` Tahmini bitiş ${etaText}.` : ''} Detay için dokun`
      }
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: colors.border,
        padding: SPACING.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        {/* TYPE.overline is this exact pattern as a token: small, bold, uppercase, and — the part
            that was hand-tuned to 0.5 here — POSITIVE tracking, because capitals need air to stay
            legible at 11px. One definition, so every eyebrow label in the app matches. */}
        <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
          HEDEF
        </Text>
        {!progress.isGoalReached && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: badge.color + '22', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: badge.color }} />
            <Text style={{ ...TYPE.caption, color: badge.color, fontWeight: '700' }} maxFontSizeMultiplier={1.3}>
              {badge.label}
            </Text>
          </View>
        )}
      </View>

      {progress.isGoalReached ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Ionicons name="trophy" size={18} color={colors.primary} />
          <Text style={{ ...TYPE.headline, color: colors.text }}>Hedefine ulaştın! 🎉</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
            {/* The percentage is this card's figure; at FONT.md (14) it was the same size as the
                sentence beside it, so "%0" and "Hedefe 8 kg" competed instead of one leading. */}
            <Text style={{ ...TYPE.title3, color: colors.text }}>
              %{progress.percentComplete}
            </Text>
            <Text style={{ ...TYPE.callout, color: colors.textSecondary }} maxFontSizeMultiplier={1.3}>
              {progressLine}
            </Text>
          </View>
          <View
            accessible={false}
            style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}
          >
            <View style={{ height: '100%', width: `${Math.min(100, Math.max(0, progress.percentComplete))}%`, backgroundColor: barColor, borderRadius: 4 }} />
          </View>
          {etaText && (
            <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: SPACING.sm }} maxFontSizeMultiplier={1.3}>
              Tahmini bitiş ~{etaText}
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
