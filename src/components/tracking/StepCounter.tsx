/**
 * Step Counter Display
 * Spec 3.1, 14.2: Telefon sensorunden otomatik adim, wearable oncelikli.
 * Shows progress ring toward daily step goal with source label and manual entry.
 */
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  steps: number | null;
  target?: number;
  source: 'manual' | 'phone' | 'wearable';
  onManualEntry?: (steps: number) => void;
}

const DEFAULT_TARGET = 10_000;

export function StepCounter({ steps, target = DEFAULT_TARGET, source, onManualEntry }: Props) {
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const current = steps ?? 0;
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const pctDisplay = Math.round(pct * 100);
  const color = pct >= 1 ? COLORS.success : pct >= 0.7 ? COLORS.primary : COLORS.textMuted;

  const sourceLabel = source === 'wearable' ? 'Wearable' : source === 'phone' ? 'Telefon' : 'Manuel';

  const handleManualSubmit = () => {
    const val = parseInt(manualInput, 10);
    if (!isNaN(val) && val > 0 && onManualEntry) {
      onManualEntry(val);
    }
    setManualInput('');
    setShowManualModal(false);
  };

  // Progress ring dimensions
  const ringSize = 80;
  const strokeWidth = 8;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pct);

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Adim</Text>
        <View style={{
          backgroundColor: source === 'wearable' ? COLORS.primary + '20' : source === 'phone' ? COLORS.success + '20' : COLORS.warning + '20',
          paddingHorizontal: SPACING.sm,
          paddingVertical: 2,
          borderRadius: 8,
        }}>
          <Text style={{ color: source === 'wearable' ? COLORS.primary : source === 'phone' ? COLORS.success : COLORS.warning, fontSize: FONT.xs, fontWeight: '600' }}>
            {sourceLabel}
          </Text>
        </View>
      </View>

      {/* Main content: ring + numbers */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        {/* SVG-like progress ring using border trick */}
        <View style={{ width: ringSize, height: ringSize, justifyContent: 'center', alignItems: 'center' }}>
          {/* Background ring */}
          <View style={{
            position: 'absolute', width: ringSize, height: ringSize,
            borderRadius: ringSize / 2, borderWidth: strokeWidth,
            borderColor: COLORS.surfaceLight,
          }} />
          {/* Progress ring (approximated with border) */}
          <View style={{
            position: 'absolute', width: ringSize, height: ringSize,
            borderRadius: ringSize / 2, borderWidth: strokeWidth,
            borderColor: color,
            borderTopColor: pct >= 0.25 ? color : 'transparent',
            borderRightColor: pct >= 0.5 ? color : 'transparent',
            borderBottomColor: pct >= 0.75 ? color : 'transparent',
            borderLeftColor: pct >= 1.0 ? color : pct > 0 ? color : 'transparent',
            transform: [{ rotate: '-90deg' }],
          }} />
          {/* Center percentage */}
          <Text style={{ color, fontSize: FONT.sm, fontWeight: '800' }}>{pctDisplay}%</Text>
        </View>

        {/* Numbers */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs }}>
            <Text style={{ color, fontSize: FONT.xxl, fontWeight: '800' }}>{current.toLocaleString('tr-TR')}</Text>
          </View>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>/ {target.toLocaleString('tr-TR')} hedef</Text>
          {pct >= 1 && (
            <Text style={{ color: COLORS.success, fontSize: FONT.xs, fontWeight: '600', marginTop: 2 }}>
              Hedefe ulastin!
            </Text>
          )}
        </View>
      </View>

      {/* Full progress bar */}
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.md }}>
        <View style={{ height: '100%', width: `${pctDisplay}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>

      {/* Manual Entry Button */}
      {onManualEntry && (
        <TouchableOpacity
          onPress={() => setShowManualModal(true)}
          style={{
            marginTop: SPACING.sm, paddingVertical: SPACING.xs,
            alignItems: 'center', borderRadius: 8,
            borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
          }}
        >
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Manuel Gir</Text>
        </TouchableOpacity>
      )}

      {/* Manual Entry Modal */}
      <Modal visible={showManualModal} transparent animationType="fade">
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.lg, width: 280 }}>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.md }}>
              Adim Sayisi Gir
            </Text>
            <TextInput
              value={manualInput}
              onChangeText={setManualInput}
              keyboardType="number-pad"
              placeholder="ornegin: 5000"
              placeholderTextColor={COLORS.textMuted}
              style={{
                backgroundColor: COLORS.surfaceLight, borderRadius: 8,
                padding: SPACING.sm, color: COLORS.text, fontSize: FONT.md,
                marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
              }}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <TouchableOpacity
                onPress={() => { setManualInput(''); setShowManualModal(false); }}
                style={{ flex: 1, padding: SPACING.sm, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: COLORS.border }}
              >
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleManualSubmit}
                style={{ flex: 1, padding: SPACING.sm, alignItems: 'center', borderRadius: 8, backgroundColor: COLORS.primary }}
              >
                <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
