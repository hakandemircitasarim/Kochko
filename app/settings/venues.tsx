import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getVenues, deleteVenue, type Venue } from '@/services/venues.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restoran', cafeteria: 'Kafeterya', fast_food: 'Fast Food', cafe: 'Kafe',
};

export default function VenuesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);

  useEffect(() => { getVenues().then(setVenues); }, []);

  const navigateToEatingOut = () => {
    router.push('/(tabs)/chat');
    // The chat screen will pick up the eating_out mode from the user's message
  };

  const handleDelete = async (id: string) => {
    await deleteVenue(id);
    setVenues(prev => prev.filter(v => v.id !== id));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit ui-settings-duplicate-title): native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
      {/* FIX (audit i18n-strings): Türkçe diakritik geri yüklendi. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.md }}>Sık gittiğin mekanlar ve öğrenilen makro tahminleri.</Text>

      {/* Quick Action: Navigate to chat for eating out planning */}
      <View style={{ marginBottom: SPACING.lg }}>
        <Button title="Dışarıda Yemek Planlıyorum" onPress={navigateToEatingOut} variant="outline" />
      </View>

      {venues.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>Henüz kayıtlı mekan yok. Koçuna "Simit Sarayı'nda yedim" gibi yazdığında mekan otomatik öğrenilir.</Text></Card>
      ) : (
        venues.map(v => (
          <TouchableOpacity key={v.id} onLongPress={() => handleDelete(v.id)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{v.venue_name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  {v.venue_type && <Text style={{ color: COLORS.primary, fontSize: FONT.xs }}>{TYPE_LABELS[v.venue_type] ?? v.venue_type}</Text>}
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{v.visit_count}x</Text>
                  {/* FIX (audit ui-destructive-delete): görünür/erişilebilir sil butonu; long-press kısayolu korundu. */}
                  <TouchableOpacity
                    onPress={() => handleDelete(v.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${v.venue_name} mekanını sil`}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={{ padding: SPACING.xs }}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
              {v.learned_items.length > 0 && (
                <View style={{ gap: 2 }}>
                  {v.learned_items.map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.name}</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                        <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{item.calories} kcal</Text>
                        {item.confirmed && <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>onaylı</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
