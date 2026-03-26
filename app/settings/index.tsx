import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function SettingsScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Ayarlar</Text>

      <View style={styles.section}>
        <Button title="Bildirim Ayarları" variant="outline" onPress={() => {}} />
        <Button title="Gizlilik" variant="outline" onPress={() => {}} />
        <Button title="Hesabımı Sil" variant="ghost" onPress={() => {}} />
      </View>

      <Text style={styles.version}>Kochko v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  section: { gap: SPACING.sm },
  version: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, textAlign: 'center', marginTop: SPACING.xxl },
});
