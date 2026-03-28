import { View, Text, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function PlanScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Gunun Plani</Text>
      <Card title="Plan">
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 20 }}>Kocunla konusarak gunluk planini olustur. Plan burada gorunecek.</Text>
      </Card>
    </ScrollView>
  );
}
