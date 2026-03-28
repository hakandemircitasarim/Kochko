import { View, Text, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function WeeklyReportScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Haftalik Rapor</Text>
      <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Haftalik rapor, hafta sonu AI tarafindan otomatik olusturulacak.</Text></Card>
    </ScrollView>
  );
}
