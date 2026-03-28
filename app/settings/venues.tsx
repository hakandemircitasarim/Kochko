import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { getVenues, type Venue } from '@/services/venues.service';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restoran', cafeteria: 'Kafeterya', fast_food: 'Fast Food', cafe: 'Kafe',
};

export default function VenuesScreen() {
  const [venues, setVenues] = useState<Venue[]>([]);

  useEffect(() => { getVenues().then(setVenues); }, []);

  const handleDelete = async (id: string) => {
    await supabase.from('user_venues').delete().eq('id', id);
    setVenues(prev => prev.filter(v => v.id !== id));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Mekanlar</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Sik gittigin mekanlar ve ogrenilen makro tahminleri.</Text>

      {venues.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>Henuz kayitli mekan yok. Kocuna "Simit Sarayi'nda yedim" gibi yazdiginda mekan otomatik ogrenilir.</Text></Card>
      ) : (
        venues.map(v => (
          <TouchableOpacity key={v.id} onLongPress={() => handleDelete(v.id)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{v.venue_name}</Text>
                <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                  {v.venue_type && <Text style={{ color: COLORS.primary, fontSize: FONT.xs }}>{TYPE_LABELS[v.venue_type] ?? v.venue_type}</Text>}
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{v.visit_count}x</Text>
                </View>
              </View>
              {v.learned_items.length > 0 && (
                <View style={{ gap: 2 }}>
                  {v.learned_items.map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.name}</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                        <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{item.calories} kcal</Text>
                        {item.confirmed && <Text style={{ color: COLORS.success, fontSize: FONT.xs }}>onayli</Text>}
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
