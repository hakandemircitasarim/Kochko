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
  // FIX (fix-pass 07-12, item 10): carry-forward used to be plotted EXACTLY like a
  // measurement (same solid line, same dots) — empty weeks and the whole future read
  // as a real flat weight. Chart-kit can't truncate one dataset (each dataset spreads
  // over its own length, so a shorter series would misalign with the planned line),
  // so instead: the actual line renders DASHED + faded (it's an interpolation), and
  // solid dots mark ONLY the weeks with a real measurement (hidePointsAtIndex).
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
  // Weeks WITHOUT a real measurement → hide their dots. Week 0 keeps its dot: the
  // goal's start weight is a real datum, not a carry-forward.
  const measuredWeeks = new Set(Object.keys(actualByWeek).map(Number));
  measuredWeeks.add(0);
  const hiddenDotIndexes = Array.from({ length: weeks + 1 }, (_, i) => i)
    .filter(i => !measuredWeeks.has(i));

  // ETA: project based on pace of last 3 weeks.
  // FIX (audit ui-tempochart): carry-forward'lu actualSeries yerine yalnızca GERÇEK ölçüm
  // olan haftaların son değerlerini kullan; aksi halde boş haftalardaki yatay sahte kilo
  // tempoyu (ve ETA'yı) bozuyordu.
  const realWeeks = Object.keys(actualByWeek).map(Number).sort((a, b) => a - b);
  const realVals = realWeeks.map((w) => actualByWeek[w][actualByWeek[w].length - 1]);
  const recentWeeks = realVals.slice(-3);
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
  // FIX (audit ui-tempo-chart): step bir kez hesapla; labels veri ile EŞİT uzunlukta
  // (boşluklar '' ile) üretilip chart-kit etiketlerinin doğru indekslere hizalanması sağlanır.
  const labelStep = Math.max(1, Math.floor(weeks / 6));

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
          labels: labels.map((l, i) => (i % labelStep === 0 ? l : '')),
          datasets: [
            // Planned trajectory: solid muted reference, no dots.
            { data: plannedPoints, color: () => colors.textMuted, strokeWidth: 2, withDots: false },
            // Actual: dashed + faded (interpolated between sparse weigh-ins);
            // dots below mark the real measurements only.
            { data: actualSeries, color: () => colors.primary + 'B3', strokeWidth: 2, strokeDashArray: [5, 5] },
          ],
          legend: ['Planlanan', 'Gerçekleşen'],
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
          propsForDots: { r: '3' },
        }}
        hidePointsAtIndex={hiddenDotIndexes}
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
