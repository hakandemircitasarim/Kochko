/**
 * Quick Log Modal
 * Allows fast meal/workout/water logging from anywhere in the app.
 */
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { sendMessage } from '@/services/chat.service';
import { useAuthStore } from '@/stores/auth.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function QuickLogScreen() {
  const user = useAuthStore(s => s.user);
  const fetchToday = useDashboardStore(s => s.fetchToday);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLog = async () => {
    if (!text.trim() || !user?.id) return;
    setLoading(true);
    try {
      const { error } = await sendMessage(text.trim());
      if (error) {
        Alert.alert('Hata', error);
      } else {
        await fetchToday(user.id);
        router.back();
      }
    } catch {
      Alert.alert('Hata', 'Bir sorun olustu. Tekrar dene.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancel}>Iptal</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Hizli Kayit</Text>
        <TouchableOpacity onPress={handleLog} disabled={loading || !text.trim()}>
          <Text style={[styles.save, (!text.trim() || loading) && { opacity: 0.4 }]}>
            {loading ? '...' : 'Kaydet'}
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Ornek: 2 dilim ekmek, 1 yumurta, cay"
        placeholderTextColor={COLORS.textMuted}
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        maxLength={2000}
      />

      <View style={styles.hints}>
        <Text style={styles.hintTitle}>Ornekler:</Text>
        <Text style={styles.hint}>• Kahvaltida 2 yumurta 1 peynir yedim</Text>
        <Text style={styles.hint}>• 30dk kosutum</Text>
        <Text style={styles.hint}>• 73.5 kg</Text>
        <Text style={styles.hint}>• 2 bardak su ictim</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  cancel: { color: COLORS.textMuted, fontSize: FONT.md },
  title: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' },
  save: { color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: SPACING.md,
    color: COLORS.text,
    fontSize: FONT.md,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  hints: { marginTop: SPACING.lg },
  hintTitle: { color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs },
  hint: { color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: 4 },
});
