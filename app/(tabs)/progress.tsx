import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function ProgressScreen() {
  // TODO: Fetch analytics data and render charts
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>İlerleme</Text>

      <Card title="Kilo Trendi">
        <Text style={styles.placeholder}>
          Kilo grafiği yeterli veri toplandığında burada görünecek.
        </Text>
      </Card>

      <Card title="Uyum Puanı">
        <Text style={styles.placeholder}>
          Günlük uyum skorlarınız burada izlenecek.
        </Text>
      </Card>

      <Card title="Makro Trendleri">
        <Text style={styles.placeholder}>
          Protein, karbonhidrat ve yağ trendleri burada görünecek.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.lg,
  },
  placeholder: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
  },
});
