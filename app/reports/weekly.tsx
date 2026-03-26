import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function WeeklyReportScreen() {
  // TODO: Fetch weekly report from store
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Haftalık Rapor</Text>
      <Card title="Haftalık Değerlendirme">
        <Text style={styles.placeholder}>
          Haftalık koç raporu yeterli veri toplandığında burada görünecek.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  placeholder: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm },
});
