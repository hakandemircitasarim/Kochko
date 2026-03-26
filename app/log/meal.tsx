import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useLogStore } from '@/stores/log.store';
import { parseMealText, type ParseMealResult } from '@/services/ai.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
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
  const [parseResult, setParseResult] = useState<ParseMealResult | null>(null);
  const [parsing, setParsing] = useState(false);

  const handleSave = async () => {
    if (!user?.id || !input.trim()) {
      Alert.alert('Hata', 'Ne yediğinizi yazın.');
      return;
    }

    setLoading(true);

    // 1. Save meal log
    const { data: mealLog, error } = await addMealLog(user.id, input.trim(), mealType);
    if (error || !mealLog) {
      Alert.alert('Hata', error ?? 'Kayıt başarısız');
      setLoading(false);
      return;
    }

    // 2. Parse with AI (non-blocking - show result but don't block navigation)
    setParsing(true);
    setLoading(false);

    const { data: parsed } = await parseMealText(input.trim(), mealLog.id);
    if (parsed) {
      setParseResult(parsed);
      setParsing(false);
    } else {
      // AI parse failed - still saved, just no macros yet
      setParsing(false);
      router.back();
    }
  };

  const handleDone = () => {
    router.back();
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

        {!parseResult && (
          <Button title="Kaydet" onPress={handleSave} loading={loading || parsing} size="lg" />
        )}

        {parsing && (
          <Text style={styles.parsingText}>AI analiz ediyor...</Text>
        )}

        {parseResult && (
          <ScrollView style={styles.resultScroll}>
            <Card title="AI Analizi">
              {parseResult.items.map((item, i) => (
                <View key={i} style={styles.parsedItem}>
                  <Text style={styles.parsedName}>{item.food_name}</Text>
                  <Text style={styles.parsedPortion}>{item.portion_text}</Text>
                  <View style={styles.macroRow}>
                    <Text style={styles.macroText}>{item.calories} kcal</Text>
                    <Text style={styles.macroText}>P:{item.protein_g}g</Text>
                    <Text style={styles.macroText}>K:{item.carbs_g}g</Text>
                    <Text style={styles.macroText}>Y:{item.fat_g}g</Text>
                  </View>
                </View>
              ))}
              {parseResult.notes && (
                <Text style={styles.parseNote}>{parseResult.notes}</Text>
              )}
              <Text style={styles.confidence}>
                Güven: {parseResult.confidence === 'high' ? 'Yüksek' : parseResult.confidence === 'medium' ? 'Orta' : 'Düşük'}
              </Text>
            </Card>
            <Button title="Tamam" onPress={handleDone} size="lg" />
          </ScrollView>
        )}
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
  parsingText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  resultScroll: {
    flex: 1,
    marginTop: SPACING.md,
  },
  parsedItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  parsedName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  parsedPortion: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  macroRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xs,
  },
  macroText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
  },
  parseNote: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.sm,
  },
  confidence: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.sm,
    textAlign: 'right',
  },
});
