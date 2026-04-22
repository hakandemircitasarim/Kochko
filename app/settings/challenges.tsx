import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveChallenges, startChallenge, pauseChallenge, resumeChallenge, abandonChallenge, SYSTEM_CHALLENGES, type Challenge } from '@/services/challenges.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<Challenge[]>([]);
  const [showSystem, setShowSystem] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [loading, setLoading] = useState(true);

  // Custom challenge form
  const [customTitle, setCustomTitle] = useState('');
  const [customDays, setCustomDays] = useState('14');
  const [customType, setCustomType] = useState<'water' | 'protein' | 'steps' | 'sleep' | 'custom'>('custom');
  const [customThreshold, setCustomThreshold] = useState('');

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

  const handleStartCustom = async () => {
    if (!customTitle.trim()) { Alert.alert('Eksik', 'Challenge başlığını yaz.'); return; }
    const days = parseInt(customDays) || 14;
    if (days < 3 || days > 90) { Alert.alert('Geçersiz', 'Süre 3-90 gün arası olmalı.'); return; }
    const threshold = customThreshold ? parseFloat(customThreshold) : null;
    try {
      await startChallenge(customTitle.trim(), null, {
        type: customType,
        duration_days: days,
        daily_threshold: threshold,
      } as unknown as typeof SYSTEM_CHALLENGES[0]['target']);
      setShowCustom(false);
      setCustomTitle(''); setCustomDays('14'); setCustomThreshold(''); setCustomType('custom');
      load();
    } catch (e) {
      Alert.alert('Hata', (e as Error).message);
    }
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Challenge'lar</Text>

      {/* Active Challenges */}
      {active.length === 0 ? (
        <Card><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Aktif challenge yok.</Text></Card>
      ) : (
        active.map(c => (
          <Card key={c.id} title={c.title}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
              {c.target.duration_days} gün · {c.status === 'paused' ? 'Duraklatıldı' : 'Aktif'}
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
              {c.progress.filter(p => p.met).length} / {c.target.duration_days} gün tamamlandı
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {c.status === 'active' && <Button title="Duraklat" variant="outline" size="sm" onPress={() => { pauseChallenge(c.id); load(); }} />}
              {c.status === 'paused' && <Button title="Devam Et" variant="primary" size="sm" onPress={() => { resumeChallenge(c.id); load(); }} />}
              <Button title="Bırak" variant="ghost" size="sm" onPress={() => {
                Alert.alert('Bırak', 'Challenge\'ı bırakmak istediğine emin misin?', [
                  { text: 'İptal' },
                  { text: 'Bırak', style: 'destructive', onPress: () => { abandonChallenge(c.id); load(); } },
                ]);
              }} />
            </View>
          </Card>
        ))
      )}

      {/* Start New */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
        <Button
          title={showSystem ? 'Gizle' : 'Hazır Challenge'}
          variant={showSystem ? 'ghost' : 'primary'}
          onPress={() => { setShowSystem(!showSystem); setShowCustom(false); }}
          style={{ flex: 1 }}
        />
        <Button
          title={showCustom ? 'Gizle' : 'Kendi Challenge\'in'}
          variant={showCustom ? 'ghost' : 'outline'}
          onPress={() => { setShowCustom(!showCustom); setShowSystem(false); }}
          style={{ flex: 1 }}
        />
      </View>

      {showSystem && (
        <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
          {SYSTEM_CHALLENGES.map((c, i) => (
            <Card key={i}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{c.title}</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4 }}>{c.target.duration_days} gün</Text>
              <Button title="Başlat" size="sm" onPress={() => handleStart(c)} style={{ marginTop: SPACING.sm }} />
            </Card>
          ))}
        </View>
      )}

      {showCustom && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>
            Kendi Challenge'ını Tanımla
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
            Başlık (örn. "10 gün şekersiz")
          </Text>
          <TextInput
            value={customTitle} onChangeText={setCustomTitle}
            placeholder="Challenge başlığı" placeholderTextColor={COLORS.textMuted}
            style={{
              backgroundColor: COLORS.surfaceLight, borderRadius: 8,
              padding: SPACING.sm, color: COLORS.text, fontSize: FONT.md,
              marginBottom: SPACING.sm,
            }}
          />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>Tip</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: SPACING.sm }}>
            {(['water', 'protein', 'steps', 'sleep', 'custom'] as const).map(t => (
              <Button
                key={t}
                title={t === 'water' ? 'Su' : t === 'protein' ? 'Protein' : t === 'steps' ? 'Adım' : t === 'sleep' ? 'Uyku' : 'Özel'}
                size="sm"
                variant={customType === t ? 'primary' : 'outline'}
                onPress={() => setCustomType(t)}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: 4 }}>Süre (gün)</Text>
              <TextInput
                value={customDays} onChangeText={setCustomDays} keyboardType="numeric"
                style={{
                  backgroundColor: COLORS.surfaceLight, borderRadius: 8,
                  padding: SPACING.sm, color: COLORS.text, fontSize: FONT.md,
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginBottom: 4 }}>Eşik (ops.)</Text>
              <TextInput
                value={customThreshold} onChangeText={setCustomThreshold} keyboardType="numeric"
                placeholder="örn. 10000"
                placeholderTextColor={COLORS.textMuted}
                style={{
                  backgroundColor: COLORS.surfaceLight, borderRadius: 8,
                  padding: SPACING.sm, color: COLORS.text, fontSize: FONT.md,
                }}
              />
            </View>
          </View>
          <Button title="Başlat" onPress={handleStartCustom} />
        </Card>
      )}
    </ScrollView>
  );
}
