/**
 * Barcode Scanner Component — Spec 3.1, 19
 * Uses expo-camera for barcode reading.
 * Lookups via OpenFoodFacts, fallback to manual entry.
 */
import { useState } from 'react';
import { View, Text, Alert, Modal, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { lookupBarcode, calculateServing, type BarcodeResult } from '@/services/barcode.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult: (result: { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; servingG: number }) => void;
}

export function BarcodeScanner({ visible, onClose, onResult }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<BarcodeResult | null>(null);
  const [servingInput, setServingInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleBarcode = async (data: string) => {
    if (!scanning) return;
    setScanning(false);
    setLoading(true);

    const lookup = await lookupBarcode(data);
    setResult(lookup);
    setLoading(false);

    if (!lookup.found) {
      Alert.alert(
        'Bulunamadi',
        'Bu urun veritabaninda yok. Barkod kaydedildi, ileride eklenebilir. Metin olarak gir.',
        [{ text: 'Tamam', onPress: onClose }],
      );
    } else {
      setServingInput(String(lookup.serving_size_g ?? 100));
    }
  };

  const handleConfirm = () => {
    if (!result?.found) return;
    const servingG = parseFloat(servingInput) || 100;
    const serving = calculateServing(result, servingG);
    if (!serving) return;

    onResult({
      name: result.product_name ?? 'Urun',
      calories: serving.calories,
      protein_g: serving.protein_g,
      carbs_g: serving.carbs_g,
      fat_g: serving.fat_g,
      servingG,
    });
    resetAndClose();
  };

  const resetAndClose = () => {
    setResult(null);
    setScanning(true);
    setServingInput('');
    onClose();
  };

  if (!permission?.granted) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', padding: SPACING.lg }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, textAlign: 'center', marginBottom: SPACING.lg }}>
            Barkod okumak icin kamera izni gerekli.
          </Text>
          <Button title="Izin Ver" onPress={requestPermission} />
          <Button title="Kapat" variant="ghost" onPress={resetAndClose} style={{ marginTop: SPACING.sm }} />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, paddingTop: SPACING.xl }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>Barkod Tara</Text>
          <TouchableOpacity onPress={resetAndClose}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kapat</Text>
          </TouchableOpacity>
        </View>

        {!result?.found && scanning && (
          <>
            <View style={{ flex: 1, overflow: 'hidden', borderRadius: 16, margin: SPACING.md }}>
              <CameraView
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                onBarcodeScanned={({ data }) => handleBarcode(data)}
              />
            </View>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', padding: SPACING.md }}>
              {loading ? 'Araniyor...' : 'Barkodu kameraya goster'}
            </Text>
          </>
        )}

        {/* Result card */}
        {result?.found && (
          <View style={{ padding: SPACING.md }}>
            <Card>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700', marginBottom: SPACING.xs }}>
                {result.product_name}
              </Text>
              {result.brand && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>{result.brand}</Text>}

              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.xs }}>100g basina:</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md }}>
                <MacroPill label="Kalori" value={`${result.calories_per_100g ?? 0}`} unit="kcal" />
                <MacroPill label="Protein" value={`${result.protein_per_100g ?? 0}`} unit="g" />
                <MacroPill label="Karb" value={`${result.carbs_per_100g ?? 0}`} unit="g" />
                <MacroPill label="Yag" value={`${result.fat_per_100g ?? 0}`} unit="g" />
              </View>

              <Input
                label="Porsiyon (gram)"
                value={servingInput}
                onChangeText={setServingInput}
                keyboardType="decimal-pad"
                placeholder="100"
              />

              <Button title="Kaydet" onPress={handleConfirm} />
              <Button title="Tekrar Tara" variant="ghost" onPress={() => { setResult(null); setScanning(true); }} style={{ marginTop: SPACING.xs }} />
            </Card>
          </View>
        )}
      </View>
    </Modal>
  );
}

function MacroPill({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{unit} {label}</Text>
    </View>
  );
}
