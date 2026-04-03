/**
 * Meal Prep Plan Screen
 * Package 9: Displays generated meal prep plans with prep order, storage info, and timing.
 */
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface PrepItem {
  name: string;
  quantity: string;
  storageMethod: string;
  storageDays: number;
}

interface MealPrepPlan {
  items: PrepItem[];
  prepOrder: string[];
  totalPrepTimeMin: number;
}

// Generates a meal prep plan from user's saved recipes and weekly plan
// In production this would call the AI or a dedicated service
async function generateMealPrepPlan(): Promise<MealPrepPlan> {
  // Simulated plan generation - in real implementation this calls the AI backend
  return {
    items: [
      { name: 'Tavuk gogsu (izgara)', quantity: '1 kg', storageMethod: 'Buzdolabi, hava almaz kap', storageDays: 4 },
      { name: 'Pilav', quantity: '4 porsiyon', storageMethod: 'Buzdolabi, kapali kap', storageDays: 3 },
      { name: 'Sebze karisimi (brokoli, havuc)', quantity: '500g', storageMethod: 'Buzdolabi, zip torba', storageDays: 5 },
      { name: 'Yulaf ezmesi porsiyon', quantity: '5 porsiyon', storageMethod: 'Oda sicakligi, kapali kavanoz', storageDays: 7 },
      { name: 'Yumurta (haslanmis)', quantity: '10 adet', storageMethod: 'Buzdolabi', storageDays: 5 },
    ],
    prepOrder: [
      'Yumurtalari hasla (15 dk)',
      'Pirinci yika ve pilavi ocaga koy (25 dk)',
      'Tavuk goguslerini marine et ve izgara yap (20 dk)',
      'Sebzeleri kes ve buharda pisir (15 dk)',
      'Yulaf porsiyonlarini hazirla (10 dk)',
      'Her seyi kaplara bolustrur',
    ],
    totalPrepTimeMin: 90,
  };
}

export default function MealPrepPlanScreen() {
  const [plan, setPlan] = useState<MealPrepPlan | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateMealPrepPlan();
      setPlan(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Meal Prep Plani</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        Haftanin yemeklerini onceden hazirla, zamandan ve paradan tasarruf et.
      </Text>

      {!plan ? (
        <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
          {loading ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : (
            <>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.lg }}>
                Kayitli tariflerine ve haftalik planina gore bir meal prep plani olusturalim.
              </Text>
              <Button title="Plan Olustur" onPress={handleGenerate} />
            </>
          )}
        </View>
      ) : (
        <>
          {/* Total Prep Time */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Toplam Hazirlama Suresi</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{plan.totalPrepTimeMin} dk</Text>
            </View>
          </Card>

          {/* Prep Items */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLANACAKLAR</Text>
          {plan.items.map((item, i) => (
            <Card key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{item.name}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{item.quantity}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>{item.storageDays} gun</Text>
                </View>
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: SPACING.xs }}>Saklama: {item.storageMethod}</Text>
            </Card>
          ))}

          {/* Prep Order */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLAMA SIRASI</Text>
          <Card>
            {plan.prepOrder.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: i < plan.prepOrder.length - 1 ? SPACING.sm : 0, alignItems: 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>{i + 1}</Text>
                </View>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1, lineHeight: 22 }}>{step}</Text>
              </View>
            ))}
          </Card>

          {/* Regenerate */}
          <View style={{ marginTop: SPACING.md }}>
            <Button title="Yeni Plan Olustur" onPress={handleGenerate} variant="outline" loading={loading} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
