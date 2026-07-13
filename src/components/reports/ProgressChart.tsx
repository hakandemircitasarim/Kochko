/**
 * Weight/metric trend chart (Spec 8: Raporlama - visual progress display).
 * Line chart so a full month of daily readings reads as a smooth trend
 * instead of an illegible picket-fence of thin bars.
 */
import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { COLORS, SPACING, RADIUS, FONT } from '@/lib/constants';

interface DataPoint {
  label: string;
  value: number;
}

interface Props {
  data: DataPoint[];
  color?: string;
  unit?: string;
  height?: number;
}

function formatShortDate(label: string): string {
  // Expects YYYY-MM-DD or similar; returns DD/MM
  const parts = label.split('-');
  if (parts.length >= 3) return `${parts[2]}/${parts[1]}`;
  return label;
}

// FIX (ux-pass5, emulator): chart-kit draws the x-label row INSIDE the svg; at 150px the "11/07"
// labels clipped mid-glyph at the card's bottom edge. 180 matches app/(tabs)/progress.tsx, where
// the same library renders the label row fully.
export function ProgressChart({ data, color = COLORS.primary, unit = '', height = 180 }: Props) {
  if (data.length === 0) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Henüz veri yok</Text>
      </View>
    );
  }

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = values[values.length - 1];

  // Pad the y-domain so small fluctuations (e.g. 0.3kg) don't read as a cliff.
  // chart-kit auto-scales to the union of all datasets, so a hidden anchor
  // dataset at [min-pad, max+pad] widens the range without distorting the line.
  const pad = Math.max(0.5, (max - min) * 0.5);
  const yAnchors = [min - pad, max + pad];

  const chartWidth = Dimensions.get('window').width - SPACING.xl * 4;

  // Thin x-axis labels to ~6 evenly-spaced ticks so 30 daily dates don't collide.
  const step = Math.max(1, Math.floor(data.length / 6));
  const labels = data.map((d, i) => (i % step === 0 ? formatShortDate(d.label) : ''));

  return (
    <View>
      {/* Summary labels — readable size + AA-contrast textSecondary */}
      {/* FIX (ux-pass5): TR ondalık — virgül ("72,5 kg"), nokta değil. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          En düşük {min.toFixed(1).replace('.', ',')}{unit}
        </Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '700' }}>
          Son {last.toFixed(1).replace('.', ',')}{unit}
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          En yüksek {max.toFixed(1).replace('.', ',')}{unit}
        </Text>
      </View>

      <LineChart
        data={{
          labels,
          datasets: [
            { data: values, color: () => color, strokeWidth: 2 },
            // Transparent anchor series only widens the y-domain (see `pad`).
            { data: yAnchors, color: () => 'transparent', strokeWidth: 0, withDots: false },
          ],
        }}
        width={chartWidth}
        height={height}
        chartConfig={{
          backgroundColor: COLORS.card,
          backgroundGradientFrom: COLORS.card,
          backgroundGradientTo: COLORS.card,
          decimalPlaces: 1,
          color: () => color,
          labelColor: () => COLORS.textSecondary,
          propsForDots: { r: data.length > 20 ? '0' : '2' },
        }}
        bezier
        style={{ borderRadius: RADIUS.sm, marginLeft: -SPACING.sm }}
        withInnerLines={false}
        withOuterLines={false}
        withShadow={false}
      />
    </View>
  );
}
