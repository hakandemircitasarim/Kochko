/**
 * Tempo Chart — planned vs actual weight progression (Spec 6.3)
 * Shows user's weekly weight trajectory against the goal pace.
 */
import { View, Text, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

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
  //
  // Bunu `hidePointsAtIndex` ile yapiyorduk ve zaman ekseni okunmaz haldeydi: chart-kit
  // ayni listeyi EKSEN ETIKETLERINI silmek icin de kullaniyor
  // (AbstractChart.js renderVerticalLabels: `if (hidePointsAtIndex.includes(i)) return null`).
  // Tek olcumlu bir hedefte 13 etiketten 12'si birden yok oluyor, ekranda sadece "0h"
  // kaliyordu — 12 haftalik plan tek haftalik gibi gorunuyor. `getDotColor` noktayi
  // etiketten bagimsiz gizler: olculmeyen haftalarin dolgusu saydam.
  const measuredWeeks = new Set(Object.keys(actualByWeek).map(Number));
  measuredWeeks.add(0);

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
        <Text style={{ ...TYPE.headline, color: colors.text }}>Kilo tempo</Text>
        <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
          {/* FIX (ux-pass5): Turkish weight idiom — comma decimal + space before kg
              ('81,0 kg'), matching goal-progress/export/plateau formatting. */}
          {startWeight.toFixed(1).replace('.', ',')} kg → {targetWeight.toFixed(1).replace('.', ',')} kg
        </Text>
      </View>
      {/* FIX (ux-round3 #3): collapse the chart SVG into one accessible image with a spoken summary. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Kilo tempo grafiği: ${startWeight.toFixed(1).replace('.', ',')} kilodan ${targetWeight.toFixed(1).replace('.', ',')} kiloya hedef.${etaWeeks !== null && etaWeeks > 0 ? ` Tempo devam ederse yaklaşık ${etaWeeks} hafta sonra ulaşılır.` : ''}`}
      >
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
        getDotColor={(_value, i) => (measuredWeeks.has(i) ? colors.primary : 'transparent')}
        bezier
        style={{ borderRadius: RADIUS.sm, marginLeft: -SPACING.sm }}
        withInnerLines={false}
        withOuterLines={false}
      />
      </View>
      {etaWeeks !== null && etaWeeks > 0 && (
        <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.xs, textAlign: 'center' }}>
          Tempo devam ederse ~{etaWeeks} hafta sonra hedefe ulaşırsın.
        </Text>
      )}
    </View>
  );
}
