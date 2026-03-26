import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function ProfileScreen() {
  const { user, signOut } = useAuthStore();
  const { profile } = useProfileStore();

  const handleSignOut = () => {
    Alert.alert('Çıkış', 'Çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: signOut },
    ]);
  };

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
            <InfoRow
              label="Aktivite"
              value={profile.activity_level ?? '-'}
            />
          </View>
        )}
      </Card>

      <View style={styles.menuSection}>
        <Button
          title="Hedef Ayarları"
          variant="outline"
          onPress={() => router.push('/settings/goals')}
        />
        <Button
          title="Yemek Tercihleri"
          variant="outline"
          onPress={() => router.push('/settings/food-preferences')}
        />
        <Button
          title="Lab Değerleri"
          variant="outline"
          onPress={() => router.push('/settings/lab-values')}
        />
        <Button
          title="Veri Dışa Aktar"
          variant="outline"
          onPress={() => router.push('/settings/export')}
        />
        <Button
          title="Ayarlar"
          variant="outline"
          onPress={() => router.push('/settings')}
        />
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  title: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.lg,
  },
  email: {
    fontSize: FONT_SIZE.md,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  stats: {
    gap: SPACING.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  infoLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
  },
  infoValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  menuSection: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  logout: {
    marginTop: SPACING.xl,
  },
});
