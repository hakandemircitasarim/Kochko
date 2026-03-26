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

export default function WorkoutLogScreen() {
  const user = useAuthStore((s) => s.user);
  const addWorkoutLog = useLogStore((s) => s.addWorkoutLog);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.id || !input.trim()) {
      Alert.alert('Hata', 'Ne yaptığınızı yazın.');
      return;
    }

    setLoading(true);
    const { error } = await addWorkoutLog(user.id, input.trim());
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
        <Text style={styles.title}>Spor Kaydet</Text>
        <Text style={styles.hint}>
          Ne yaptığını yaz. Tip, süre, yoğunluk - biz ayıklayalım.
        </Text>

        <Input
          label="Ne yaptın?"
          placeholder="Yürüyüş bandı 35 dk, orta tempo"
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
