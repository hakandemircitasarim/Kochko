/**
 * Data Import Screen
 * Spec 14.4: MyFitnessPal, Fatsecret, Samsung Health CSV/JSON import
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { importMealsFromCSV, importWeightsFromCSV, type ImportResult } from '@/services/import.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function DataImportScreen() {
  const insets = useSafeAreaInsets();
  const [csvText, setCsvText] = useState('');
  const [importType, setImportType] = useState<'meals' | 'weights'>('meals');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    if (!csvText.trim()) {
      Alert.alert('Hata', 'CSV verisi girin.');
      return;
    }

    setImporting(true);
    const res = importType === 'meals'
      ? await importMealsFromCSV(csvText)
      : await importWeightsFromCSV(csvText);

    setResult(res);
    setImporting(false);

    if (res.success) {
      Alert.alert('Basarili', `${res.recordsImported} kayit iceri aktarildi.`);
    } else {
      Alert.alert('Hata', `Import basarisiz. ${res.errors.length} hata.`);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Veri Iceri Aktar</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Baska uygulamalardan (MyFitnessPal, Fatsecret, Samsung Health) disa aktardigin CSV verisini buraya yapistir.
      </Text>

      {/* Import type selection */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <Button
          title="Ogun Verisi"
          variant={importType === 'meals' ? 'primary' : 'outline'}
          size="sm"
          onPress={() => setImportType('meals')}
          style={{ flex: 1 }}
        />
        <Button
          title="Kilo Verisi"
          variant={importType === 'weights' ? 'primary' : 'outline'}
          size="sm"
          onPress={() => setImportType('weights')}
          style={{ flex: 1 }}
        />
      </View>

      {/* Format info */}
      <Card title="Beklenen Format">
        {importType === 'meals' ? (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
            {`tarih,ogun_tipi,yiyecek_adi,kalori,protein\n2024-01-15,breakfast,yumurta,155,13\n2024-01-15,lunch,tavuk gogsu,250,35`}
          </Text>
        ) : (
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
            {`tarih,kilo\n2024-01-15,82.5\n2024-01-16,82.3`}
          </Text>
        )}
      </Card>

      {/* CSV input */}
      <Input
        label="CSV Verisi"
        placeholder="CSV icerigini buraya yapistirin..."
        value={csvText}
        onChangeText={setCsvText}
        multiline
        numberOfLines={8}
        style={{ minHeight: 150, textAlignVertical: 'top', fontFamily: 'monospace' }}
      />

      <Button title="Iceri Aktar" onPress={handleImport} loading={importing} size="lg" />

      {/* Results */}
      {result && (
        <Card title="Sonuc" style={{ marginTop: SPACING.md }}>
          <Text style={{ color: result.success ? COLORS.success : COLORS.error, fontSize: FONT.md, fontWeight: '600' }}>
            {result.recordsImported} kayit aktarildi
          </Text>
          {result.errors.length > 0 && (
            <View style={{ marginTop: SPACING.sm }}>
              <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600' }}>Hatalar:</Text>
              {result.errors.slice(0, 5).map((err, i) => (
                <Text key={i} style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{err}</Text>
              ))}
              {result.errors.length > 5 && (
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>...ve {result.errors.length - 5} hata daha</Text>
              )}
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
