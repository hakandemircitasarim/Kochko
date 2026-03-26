import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useLogStore } from '@/stores/log.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function WeightLogScreen() {
  const user = useAuthStore((s) => s.user);
  const updateDailyMetrics = useLogStore((s) => s.updateDailyMetrics);
  const [weight, setWeight] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.id || !weight.trim()) {
      Alert.alert('Hata', 'Kilonuzu girin.');
      return;
    }

    const kg = parseFloat(weight);
    if (isNaN(kg) || kg < 30 || kg > 300) {
      Alert.alert('Hata', 'Geçerli bir kilo değeri girin (30-300 kg).');
      return;
    }

    setLoading(true);
    const date = new Date().toISOString().split('T')[0];
    const { error } = await updateDailyMetrics(user.id, date, { weight_kg: kg });
    setLoading(false);

    if (error) {
      Alert.alert('Hata', error);
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Tartı</Text>
        <Text style={styles.hint}>Bugünkü kilonu kaydet.</Text>

        <Input
          label="Kilo (kg)"
          placeholder="78.5"
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
        />

        <Button title="Kaydet" onPress={handleSave} loading={loading} size="lg" />
      </View>
    </View>
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
});
