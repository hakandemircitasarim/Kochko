/**
 * Quick Sleep Input
 * Spec 3.1: Yatış/kalkış saati + kalite
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  currentHours: number | null;
  onSave: (hours: number, quality: 'good' | 'ok' | 'bad') => void;
}

export function SleepInput({ currentHours, onSave }: Props) {
  const [hours, setHours] = useState(currentHours ? String(currentHours) : '');
  const [quality, setQuality] = useState<'good' | 'ok' | 'bad'>('ok');
  const [expanded, setExpanded] = useState(false);

  const handleSave = () => {
    const h = parseFloat(hours);
    if (h > 0 && h < 24) {
      onSave(h, quality);
      setExpanded(false);
    }
  };

  if (!expanded) {
    return (
      <TouchableOpacity onPress={() => setExpanded(true)}
        style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Uyku</Text>
        <Text style={{ color: currentHours ? COLORS.text : COLORS.textMuted, fontSize: FONT.md, fontWeight: '600' }}>
          {currentHours ? `${currentHours} saat` : 'Kaydet'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <Input label="Kac saat uyudun?" value={hours} onChangeText={setHours} keyboardType="decimal-pad" placeholder="7.5" />
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xs }}>Kalite</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {(['good', 'ok', 'bad'] as const).map(q => (
          <TouchableOpacity key={q} onPress={() => setQuality(q)}
            style={{ flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center', borderWidth: 1,
              borderColor: quality === q ? COLORS.primary : COLORS.border,
              backgroundColor: quality === q ? COLORS.primary : 'transparent' }}>
            <Text style={{ color: quality === q ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>
              {q === 'good' ? 'Iyi' : q === 'ok' ? 'Orta' : 'Kotu'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <Button title="Kaydet" size="sm" onPress={handleSave} style={{ flex: 1 }} />
        <Button title="Iptal" size="sm" variant="ghost" onPress={() => setExpanded(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
