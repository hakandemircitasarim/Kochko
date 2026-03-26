import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useLogStore } from '@/stores/log.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';
import type { MealType } from '@/types/database';

const mealTypes: { label: string; value: MealType }[] = [
  { label: 'Kahvaltı', value: 'breakfast' },
  { label: 'Öğle', value: 'lunch' },
  { label: 'Akşam', value: 'dinner' },
  { label: 'Atıştırma', value: 'snack' },
];

export default function MealLogScreen() {
  const user = useAuthStore((s) => s.user);
  const addMealLog = useLogStore((s) => s.addMealLog);
  const [input, setInput] = useState('');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.id || !input.trim()) {
      Alert.alert('Hata', 'Ne yediğinizi yazın.');
      return;
    }

    setLoading(true);
    const { error } = await addMealLog(user.id, input.trim(), mealType);
    setLoading(false);

    if (error) {
      Alert.alert('Hata', error);
    } else {
      router.back();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Öğün Kaydet</Text>
        <Text style={styles.hint}>
          Ne yediğini yaz, gerisini biz halledelim.
        </Text>

        <View style={styles.typeRow}>
          {mealTypes.map((t) => (
            <Button
              key={t.value}
              title={t.label}
              variant={mealType === t.value ? 'primary' : 'outline'}
              size="sm"
              onPress={() => setMealType(t.value)}
            />
          ))}
        </View>

        <Input
          label="Ne yedin?"
          placeholder="2 yumurta, 60g hindi füme, 1 dilim ekmek"
          value={input}
          onChangeText={setInput}
          multiline
          numberOfLines={3}
          style={styles.textArea}
        />

        <Button title="Kaydet" onPress={handleSave} loading={loading} size="lg" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  typeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
