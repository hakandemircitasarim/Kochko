import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function TodayScreen() {
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Bugun</Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>{today}</Text>

      {/* Quick Actions */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.lg }}>
        {[
          { label: 'Ogun', onPress: () => router.push('/(tabs)/chat') },
          { label: 'Spor', onPress: () => router.push('/(tabs)/chat') },
          { label: 'Tarti', onPress: () => router.push('/(tabs)/chat') },
          { label: 'Foto', onPress: () => router.push('/(tabs)/chat') },
        ].map((a, i) => (
          <TouchableOpacity key={i} onPress={a.onPress} style={{ alignItems: 'center', padding: SPACING.sm }}>
            <Text style={{ fontSize: 24, color: COLORS.primary, fontWeight: '700' }}>+</Text>
            <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Card title="Koçuna Yaz">
        <TouchableOpacity onPress={() => router.push('/(tabs)/chat')} style={{ backgroundColor: COLORS.inputBg, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>Ne yedin, ne yaptin, nasil hissediyorsun...</Text>
        </TouchableOpacity>
      </Card>

      <Card title="Bugunun Ozeti">
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Kocunla konusmaya basla, gunluk ozetin burada gorunecek.</Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }} onPress={() => router.push('/reports/daily' as never)}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Gun Sonu Raporu</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }} onPress={() => router.push('/reports/weekly' as never)}>
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Haftalik Rapor</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
