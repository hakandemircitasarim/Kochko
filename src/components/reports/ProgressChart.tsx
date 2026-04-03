/**
 * Simple View-based bar chart (no external libraries).
 * Spec 8: Raporlama - visual progress display.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

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

export function ProgressChart({ data, color = COLORS.primary, unit = '', height = 140 }: Props) {
  if (data.length === 0) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Veri yok</Text>
      </View>
    );
  }

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const barAreaHeight = height - 36; // reserve space for labels

  return (
    <View style={{ height }}>
      {/* Min/Max labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{min.toFixed(1)}{unit}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{max.toFixed(1)}{unit}</Text>
      </View>

      {/* Bars */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', flex: 1, gap: 2 }}>
        {data.map((d, i) => {
          const normalized = ((d.value - min) / range) * barAreaHeight;
          const barHeight = Math.max(4, normalized);
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 9, marginBottom: 2 }}>
                {d.value.toFixed(1)}
              </Text>
              <View style={{ width: '80%', height: barHeight, backgroundColor: color, borderRadius: 3 }} />
              <Text style={{ color: COLORS.textMuted, fontSize: 8, marginTop: 2 }} numberOfLines={1}>
                {formatShortDate(d.label)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
