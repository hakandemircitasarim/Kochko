import { View, Text, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ProgressScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Ilerleme</Text>
      <Card title="Kilo Trendi"><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Tarti kayitlari birikince grafik burada gorunecek.</Text></Card>
      <Card title="Uyum Puani"><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Gun sonu raporlari olusturuldukca trend burada gorunecek.</Text></Card>
    </ScrollView>
  );
}
