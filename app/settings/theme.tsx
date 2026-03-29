/**
 * Theme Settings Screen — Spec 22.2
 * Koyu/açık/sistem tema seçimi
 */
import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type ThemeMode = 'system' | 'dark' | 'light';

const THEMES: { value: ThemeMode; label: string; desc: string }[] = [
  { value: 'system', label: 'Sistem Temasi', desc: 'Telefonun tema ayarini takip eder.' },
  { value: 'dark', label: 'Koyu Tema', desc: 'Her zaman koyu tema kullanilir. Gece kullanimi ve pil tasarrufu icin ideal.' },
  { value: 'light', label: 'Acik Tema', desc: 'Her zaman acik tema kullanilir.' },
];

export default function ThemeScreen() {
  // Currently app is dark-only. This screen prepares for light mode support.
  const [selected, setSelected] = useState<ThemeMode>('dark');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Tema</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        Uygulamanin gorunumunu ayarla.
      </Text>

      {THEMES.map(t => (
        <TouchableOpacity key={t.value} onPress={() => setSelected(t.value)}>
          <Card style={{
            borderWidth: selected === t.value ? 2 : 1,
            borderColor: selected === t.value ? COLORS.primary : COLORS.border,
          }}>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{t.label}</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>{t.desc}</Text>
          </Card>
        </TouchableOpacity>
      ))}

      <Card>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, lineHeight: 18, textAlign: 'center' }}>
          Su an koyu tema varsayilan olarak aktif. Acik tema destegi gelecek guncellemede eklenecek.
        </Text>
      </Card>
    </ScrollView>
  );
}
