/**
 * Tempo Chart — planned vs actual weight progression (Spec 6.3)
 * Shows user's weekly weight trajectory against the goal pace.
 */
import { View, Text, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

interface Props {
  startWeight: number;
  targetWeight: number;
  targetWeeks: number;
  actualPoints: { date: string; kg: number }[]; // chronological, oldest first
  goalStartDate: string; // ISO date
}

export function TempoChart({ startWeight, targetWeight, targetWeeks, actualPoints, goalStartDate }: Props) {
  const { colors } = useTheme();
  const screenWidth = Dimensions.get('window').width - SPACING.xl * 2;

  // Week-by-week planned line: linear interpolation from startWeight → targetWeight over targetWeeks
  const weeks = Math.max(1, targetWeeks);
  const plannedPoints: number[] = [];
  for (let w = 0; w <= weeks; w++) {
    plannedPoints.push(startWeight + (targetWeight - startWeight) * (w / weeks));
  }

  // Bucket actual points by week-since-goal-start
  const start = new Date(goalStartDate).getTime();
  const actualByWeek: Record<number, number[]> = {};
  for (const p of actualPoints) {
    const week = Math.floor((new Date(p.date).getTime() - start) / (7 * 86400000));
    if (week < 0 || week > weeks) continue;
    if (!actualByWeek[week]) actualByWeek[week] = [];
    actualByWeek[week].push(p.kg);
  }

  // Build actual series using latest reading per week; fill gaps by carrying forward
  // (chart-kit rejects nulls, so we keep straight line through missing weeks).
  const actualSeries: number[] = [];
  for (let w = 0; w <= weeks; w++) {
    if (actualByWeek[w]?.length) {
      actualSeries.push(actualByWeek[w][actualByWeek[w].length - 1]);
    } else if (w === 0) {
      actualSeries.push(startWeight);
    } else {
      actualSeries.push(actualSeries[actualSeries.length - 1] ?? startWeight);
    }
  }

  // ETA: project based on pace of last 3 weeks
  const recentWeeks = actualSeries.slice(-3);
  let etaWeeks: number | null = null;
  if (recentWeeks.length >= 2) {
    const delta = recentWeeks[recentWeeks.length - 1] - recentWeeks[0];
    const weeksCovered = recentWeeks.length - 1;
    const weeklyRate = delta / weeksCovered;
    const remaining = targetWeight - recentWeeks[recentWeeks.length - 1];
    if (weeklyRate !== 0 && Math.sign(weeklyRate) === Math.sign(remaining)) {
      etaWeeks = Math.ceil(remaining / weeklyRate);
    }
  }

  const labels = Array.from({ length: weeks + 1 }, (_, i) => `${i}h`);

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 0.5, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Kilo Tempo</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          {startWeight.toFixed(1)}kg → {targetWeight.toFixed(1)}kg
        </Text>
      </View>
      <LineChart
        data={{
          labels: labels.filter((_, i) => i % Math.max(1, Math.floor(weeks / 6)) === 0),
          datasets: [
            { data: plannedPoints, color: () => colors.textMuted, strokeWidth: 2 },
            { data: actualSeries, color: () => colors.primary, strokeWidth: 2 },
          ],
          legend: ['Planlanan', 'Gerceklesen'],
        }}
        width={screenWidth}
        height={200}
        chartConfig={{
          backgroundColor: colors.card,
          backgroundGradientFrom: colors.card,
          backgroundGradientTo: colors.card,
          decimalPlaces: 1,
          color: () => colors.primary,
          labelColor: () => colors.textMuted,
          propsForDots: { r: '2' },
        }}
        bezier
        style={{ borderRadius: RADIUS.sm, marginLeft: -SPACING.sm }}
        withInnerLines={false}
        withOuterLines={false}
      />
      {etaWeeks !== null && etaWeeks > 0 && (
        <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: SPACING.xs, textAlign: 'center' }}>
          Tempo devam ederse ~{etaWeeks} hafta sonra hedefe ulaşırsın.
        </Text>
      )}
    </View>
  );
}
