import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { getActiveChallenges, startChallenge, pauseChallenge, resumeChallenge, abandonChallenge, SYSTEM_CHALLENGES, type Challenge } from '@/services/challenges.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ChallengesScreen() {
  const [active, setActive] = useState<Challenge[]>([]);
  const [showSystem, setShowSystem] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const load = () => getActiveChallenges().then(setActive);

  const handleStart = async (c: typeof SYSTEM_CHALLENGES[0]) => {
    try {
      await startChallenge(c.title, null, c.target);
      setShowSystem(false);
      load();
    } catch (e) {
      Alert.alert('Hata', (e as Error).message);
    }
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Challenge'lar</Text>

      {/* Active Challenges */}
      {active.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Aktif challenge yok.</Text></Card>
      ) : (
        active.map(c => (
          <Card key={c.id} title={c.title}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
              {c.target.duration_days} gun | {c.status === 'paused' ? 'Duraklatildi' : 'Aktif'}
            </Text>
            {/* Progress bar */}
            <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden', marginBottom: SPACING.sm }}>
              <View style={{
                height: '100%',
                width: `${Math.min(100, (c.progress.filter(p => p.met).length / c.target.duration_days) * 100)}%`,
                backgroundColor: COLORS.success, borderRadius: 3,
              }} />
            </View>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              {c.progress.filter(p => p.met).length} / {c.target.duration_days} gun tamamlandi
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {c.status === 'active' && <Button title="Duraklat" variant="outline" size="sm" onPress={() => { pauseChallenge(c.id); load(); }} />}
              {c.status === 'paused' && <Button title="Devam Et" variant="primary" size="sm" onPress={() => { resumeChallenge(c.id); load(); }} />}
              <Button title="Birak" variant="ghost" size="sm" onPress={() => {
                Alert.alert('Birak', 'Challenge\'i birakmak istediginize emin misiniz?', [
                  { text: 'Iptal' },
                  { text: 'Birak', style: 'destructive', onPress: () => { abandonChallenge(c.id); load(); } },
                ]);
              }} />
            </View>
          </Card>
        ))
      )}

      {/* Start New */}
      <Button
        title={showSystem ? 'Gizle' : 'Yeni Challenge Baslat'}
        variant={showSystem ? 'ghost' : 'primary'}
        onPress={() => setShowSystem(!showSystem)}
        style={{ marginTop: SPACING.md }}
      />

      {showSystem && (
        <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
          {SYSTEM_CHALLENGES.map((c, i) => (
            <Card key={i}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{c.title}</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4 }}>{c.target.duration_days} gun</Text>
              <Button title="Baslat" size="sm" onPress={() => handleStart(c)} style={{ marginTop: SPACING.sm }} />
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
