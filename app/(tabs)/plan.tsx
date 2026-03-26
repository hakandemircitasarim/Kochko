import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function PlanScreen() {
  // TODO: Fetch daily plan from store/API
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Günün Planı</Text>

      <Card title="Hedefler">
        <Text style={styles.placeholder}>
          Plan henüz üretilmedi. AI motoru aktif olduğunda günlük planınız burada
          görünecek.
        </Text>
      </Card>

      <Card title="Öğün Önerileri">
        <Text style={styles.placeholder}>
          Kişiselleştirilmiş öğün seçenekleri burada listelenecek.
        </Text>
      </Card>

      <Card title="Antrenman Planı">
        <Text style={styles.placeholder}>
          Günün antrenman detayları burada görünecek.
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
