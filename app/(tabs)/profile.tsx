import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { loadInsights } from '@/services/chat.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<{ general_summary?: string; [key: string]: unknown } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => setProfile(data));
    loadInsights().then(data => setSummary(data));
  }, [user?.id]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Profil</Text>

      <Card>
        <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.md }}>{user?.email}</Text>
        {profile && (
          <View style={{ gap: SPACING.xs }}>
            {[['Boy', profile.height_cm ? `${profile.height_cm} cm` : '-'],
              ['Kilo', profile.weight_kg ? `${profile.weight_kg} kg` : '-'],
              ['Yas', profile.birth_year ? `${new Date().getFullYear() - (profile.birth_year as number)}` : '-'],
              ['Aktivite', (profile.activity_level as string) ?? '-'],
              ['Diyet', (profile.diet_mode as string) ?? 'standard'],
            ].map(([l, v], i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>{String(l)}</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '500' }}>{String(v)}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* AI Summary - What the coach knows */}
      {summary?.general_summary && (
        <Card title="Kocun Seni Nasil Taniyor">
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>Her konusmandan ogrenilenler. Yanlis varsa kocuna soyle.</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{String(summary.general_summary ?? '')}</Text>
        </Card>
      )}

      <View style={{ gap: SPACING.sm, marginTop: SPACING.md }}>
        <Button title="Ayarlar" variant="outline" onPress={() => router.push('/settings' as never)} />
        <Button title="Cikis Yap" variant="ghost" onPress={() => Alert.alert('Cikis', 'Emin misin?', [{ text: 'Iptal' }, { text: 'Cikis', style: 'destructive', onPress: signOut }])} />
      </View>
    </ScrollView>
  );
}
