import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { loadInsights } from '@/services/chat.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

const categoryLabels: Record<string, string> = {
  physical: 'Fiziksel',
  dietary: 'Beslenme',
  behavioral: 'Davranış',
  psychological: 'Psikolojik',
  lifestyle: 'Yaşam Tarzı',
  medical: 'Sağlık Geçmişi',
  preference: 'Tercihler',
  goal: 'Hedefler',
  social: 'Sosyal',
  exercise: 'Egzersiz',
};

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const { profile } = useProfileStore();
  const [insights, setInsights] = useState<{ category: string; insight: string }[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await loadInsights();
      setInsights(data);
    }
    load();
  }, []);

  const handleSignOut = () => {
    Alert.alert('Çıkış', 'Çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: signOut },
    ]);
  };

  // Group insights by category
  const grouped = insights.reduce<Record<string, string[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i.insight);
    return acc;
  }, {});

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profil</Text>

      <Card>
        <Text style={styles.email}>{user?.email}</Text>
        {profile && (
          <View style={styles.stats}>
            <InfoRow label="Boy" value={profile.height_cm ? `${profile.height_cm} cm` : '-'} />
            <InfoRow label="Kilo" value={profile.weight_kg ? `${profile.weight_kg} kg` : '-'} />
            <InfoRow label="Doğum Yılı" value={profile.birth_year?.toString() ?? '-'} />
          </View>
        )}
      </Card>

      {/* AI-Learned Insights - The Living Profile */}
      {Object.keys(grouped).length > 0 && (
        <Card title="Koçun Seni Nasıl Tanıyor">
          <Text style={styles.insightDesc}>
            Her konuşmandan öğrenilen bilgiler. Yanlış olan varsa koçuna söyle, günceller.
          </Text>
          {Object.entries(grouped).map(([category, items]) => (
            <View key={category} style={styles.insightGroup}>
              <Text style={styles.insightCategory}>
                {categoryLabels[category] ?? category}
              </Text>
              {items.map((item, i) => (
                <Text key={i} style={styles.insightItem}>- {item}</Text>
              ))}
            </View>
          ))}
        </Card>
      )}

      <View style={styles.menuSection}>
        <Button title="Hedef Ayarları" variant="outline" onPress={() => router.push('/settings/goals')} />
        <Button title="Yemek Tercihleri" variant="outline" onPress={() => router.push('/settings/food-preferences')} />
        <Button title="Lab Değerleri" variant="outline" onPress={() => router.push('/settings/lab-values')} />
        <Button title="Veri Dışa Aktar" variant="outline" onPress={() => router.push('/settings/export')} />
        <Button title="Ayarlar" variant="outline" onPress={() => router.push('/settings')} />
      </View>

      <View style={styles.logout}>
        <Button title="Çıkış Yap" variant="ghost" onPress={handleSignOut} />
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  email: { color: COLORS.primary, fontSize: FONT_SIZE.md, fontWeight: '600', marginBottom: SPACING.md },
  stats: { gap: SPACING.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs },
  infoLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md },
  infoValue: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '500' },
  insightDesc: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginBottom: SPACING.md, lineHeight: 18 },
  insightGroup: { marginBottom: SPACING.md },
  insightCategory: { color: COLORS.primary, fontSize: FONT_SIZE.sm, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  insightItem: { color: COLORS.text, fontSize: FONT_SIZE.sm, lineHeight: 20, paddingLeft: SPACING.xs },
  menuSection: { gap: SPACING.sm, marginTop: SPACING.md },
  logout: { marginTop: SPACING.xl },
});
