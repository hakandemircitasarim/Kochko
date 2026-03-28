import { View, Text, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function DailyReportScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Gun Sonu Raporu</Text>
      <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Gun sonu raporu, gunun verileri toplandiktan sonra AI tarafindan otomatik olusturulacak.</Text></Card>
    </ScrollView>
  );
}
