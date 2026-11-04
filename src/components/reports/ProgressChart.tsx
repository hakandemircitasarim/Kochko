/**
 * Weight/metric trend chart (Spec 8: Raporlama - visual progress display).
 * Line chart so a full month of daily readings reads as a smooth trend
 * instead of an illegible picket-fence of thin bars.
 *
 * Duolingo dili (§0-A): özet satırı üç düz metin yerine üç küçük "çip" — en düşük/en yüksek
 * gri, SON değer grafiğin kendi renginin opak pastelinde (gözün ilk bakacağı yer). Grafik rengi
 * çağırandan gelir (METRIC_COLORS — kilo gül); varsayılan marka menekşesi. Yeşil yok.
 */
import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, alpha } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { tint } from '@/components/reports/ReportBits';

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
  // FIX (ux-polish): TR short form "11 Tem" to match progress.tsx's axis (was "11/07").
  const d = new Date(label.length <= 10 ? `${label}T00:00:00` : label);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  return label;
}

// FIX (ux-pass5, emulator): chart-kit draws the x-label row INSIDE the svg; at 150px the "11/07"
// labels clipped mid-glyph at the card's bottom edge. 180 matches app/(tabs)/progress.tsx, where
// the same library renders the label row fully.
export function ProgressChart({ data, color: colorProp, unit = '', height = 180 }: Props) {
  const { colors, isDark } = useTheme();
  // FIX (theme): varsayılan renk artık varsayılan-parametrede sabitlenmiyor — aktif temadan çözülüyor.
  const color = colorProp ?? colors.primary;

  // Tek noktayla bu bilesen "En dusuk 85,4 / Son 85,4 / En yuksek 85,4" yazip tek bir nokta
  // ciziyordu: uc ozdes sayi ve cizgisi olmayan bir cizgi grafigi. Bir olcum bir aralik
  // degildir. (app/(tabs)/progress.tsx zaten kendi grafigini `>= 2` ile kapatiyordu — bu
  // esik artik bilesenin kendisinde, yani aylik/haftalik raporlar da ayni kurala uyuyor.)
  if (data.length < 2) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.lg }}>
        <Text style={{ ...TYPE.body, color: colors.textMuted, textAlign: 'center' }}>
          {data.length === 0 ? 'Henüz veri yok' : 'Trend için en az iki kayıt gerekli'}
        </Text>
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

  // Thin x-axis labels to ~5 evenly-spaced ticks so 30 daily dates don't collide.
  // 2026-11: floor(n/6) 10 noktada adımı 1'e düşürüp ON etiketi üst üste basıyordu
  // ("15 Eki17 Eki19…", aylık raporda görüldü). ceil(n/5) — progress.tsx labelsFor ile aynı kural.
  const step = Math.max(1, Math.ceil(data.length / 5));
  const labels = data.map((d, i) => (i % step === 0 ? formatShortDate(d.label) : ''));

  return (
    <View>
      {/* Summary labels — readable size + AA-contrast textSecondary */}
      {/* FIX (ux-pass5): TR ondalık — virgül ("72,5 kg"), nokta değil. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.xs }}>
        <StatChip label="En düşük" value={`${min.toFixed(1).replace('.', ',')}${unit}`} bg={colors.surfaceLight} />
        <StatChip label="Son" value={`${last.toFixed(1).replace('.', ',')}${unit}`} bg={tint(color, colors, isDark, 1.3)} strong />
        <StatChip label="En yüksek" value={`${max.toFixed(1).replace('.', ',')}${unit}`} bg={colors.surfaceLight} />
      </View>

      {/* FIX (ux-round3 #3): collapse the chart SVG into ONE accessible image node with a spoken
          summary — a screen reader otherwise wanders the raw SVG as noise. */}
      <View accessible accessibilityRole="image" accessibilityLabel={`Grafik: en düşük ${min.toFixed(1).replace('.', ',')}${unit}, son ${last.toFixed(1).replace('.', ',')}${unit}, en yüksek ${max.toFixed(1).replace('.', ',')}${unit}`}>
      <LineChart
        data={{
          labels,
          datasets: [
            { data: values, color: () => color, strokeWidth: 3 },
            // Transparent anchor series only widens the y-domain (see `pad`).
            { data: yAnchors, color: () => 'transparent', strokeWidth: 0, withDots: false },
          ],
        }}
        width={chartWidth}
        height={height}
        chartConfig={{
          backgroundColor: colors.card,
          backgroundGradientFrom: colors.card,
          backgroundGradientTo: colors.card,
          decimalPlaces: 1,
          // Çizgi + (varsa) alan dolgusu aynı metrik renginden; nokta kontürü kart rengi —
          // noktalar çizginin üstünde "boncuk" gibi ayrışır.
          color: (o = 1) => (color.startsWith('#') ? alpha(color, o) : color),
          labelColor: () => colors.textSecondary,
          propsForDots: { r: data.length > 20 ? '0' : '3.5', strokeWidth: '2', stroke: colors.card },
        }}
        bezier
        style={{ borderRadius: RADIUS.sm, marginLeft: -SPACING.sm }}
        withInnerLines={false}
        withOuterLines={false}
        withShadow={false}
      />
      </View>
    </View>
  );
}

function StatChip({ label, value, bg, strong }: { label: string; value: string; bg: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: bg, borderRadius: RADIUS.sm, paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.xs }}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.footnote, color: colors.textSecondary }}>{label}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={{ ...(strong ? TYPE.headline : TYPE.bodyStrong), color: colors.text, fontWeight: strong ? '800' : '600' }}>{value}</Text>
    </View>
  );
}
