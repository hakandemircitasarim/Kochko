/**
 * Meal Prep Plan Screen
 * Package 9: Displays generated meal prep plans with prep order, storage info, and timing.
 */
import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth.store';
import { generateMealPrepPlan, type MealPrepPlan } from '@/services/meal-prep.service';
import { getCurrentWeeklyPlan } from '@/services/weekly-plan.service';

export default function MealPrepPlanScreen() {
  const user = useAuthStore(s => s.user);
  const [plan, setPlan] = useState<MealPrepPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const weeklyPlan = await getCurrentWeeklyPlan();
      if (!weeklyPlan) {
        setError('Once haftalik menunu olustur, sonra meal prep plani yapabiliriz.');
        return;
      }
      const result = await generateMealPrepPlan(user.id, weeklyPlan.id);
      if (!result) {
        setError('Meal prep plani olusturulamadi. Ayarlardan meal prep tercihini aktif ettiginizden emin olun.');
        return;
      }
      setPlan(result);
    } catch {
      setError('Bir hata olustu, lutfen tekrar deneyin.');
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
              {error && (
                <Text style={{ color: COLORS.error, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.md }}>
                  {error}
                </Text>
              )}
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
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hazirlama</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{plan.totalPrepTime} dk</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xs }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Pisirme</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{plan.totalCookTime} dk</Text>
            </View>
          </Card>

          {/* Prep Items */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLANACAKLAR</Text>
          {plan.items.map((item, i) => (
            <Card key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{item.recipeName}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{item.quantity}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>{item.storageDays} gun</Text>
                </View>
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: SPACING.xs }}>Saklama: {item.storageInstructions}</Text>
            </Card>
          ))}

          {/* Prep Order */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLAMA SIRASI</Text>
          <Card>
            {plan.prepOrder.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: i < plan.prepOrder.length - 1 ? SPACING.sm : 0, alignItems: 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '700' }}>{step.order}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{step.action}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{step.durationMin} dk — {step.reason_tr}</Text>
                </View>
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
