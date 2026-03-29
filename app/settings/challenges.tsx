/**
 * Challenges Screen
 * Spec 13.5: Challenge modülü — system + custom challenges
 *
 * Features: active challenges with daily progress, pause/resume,
 * system challenges with descriptions, custom challenge creation,
 * completed challenges history.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import {
  getActiveChallenges, startChallenge, pauseChallenge, resumeChallenge,
  abandonChallenge, SYSTEM_CHALLENGES, type Challenge,
} from '@/services/challenges.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const METRIC_LABELS: Record<string, string> = {
  no_sugar: 'Seker yok', steps: 'Adim', protein_met: 'Protein hedefi',
  water_met: 'Su hedefi', workout: 'Antrenman', custom: 'Ozel',
};

const CHALLENGE_DESCRIPTIONS: Record<string, string> = {
  '7 Gun Seker Yok': 'Eklenmis seker iceren yiyeceklerden 7 gun uzak dur. Meyve serbest.',
  '30 Gun 10.000 Adim': 'Her gun en az 10.000 adim at. Yagmurda da, karda da.',
  '14 Gun Protein Hedefi': '14 gun boyunca gunluk protein hedefini tuttur.',
  '14 Gun Su Hedefi': '14 gun boyunca su hedefini tamamla.',
  '7 Gun Her Gun Antrenman': '7 gun ust uste her gun en az 1 antrenman yap. Yogunluk onemli degil.',
};

export default function ChallengesScreen() {
  const [active, setActive] = useState<Challenge[]>([]);
  const [completed, setCompleted] = useState<Challenge[]>([]);
  const [showSystem, setShowSystem] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Custom challenge form
  const [customTitle, setCustomTitle] = useState('');
  const [customDays, setCustomDays] = useState('14');
  const [customDesc, setCustomDesc] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    const activeData = await getActiveChallenges();
    setActive(activeData);

    const { data: hist } = await supabase
      .from('challenges')
      .select('*')
      .in('status', ['completed', 'abandoned'])
      .order('started_at', { ascending: false })
      .limit(10);
    setCompleted((hist ?? []) as Challenge[]);
  };

  const handleStartSystem = async (c: typeof SYSTEM_CHALLENGES[0]) => {
    try {
      await startChallenge(c.title, CHALLENGE_DESCRIPTIONS[c.title] ?? null, c.target);
      setShowSystem(false);
      load();
    } catch (e) {
      Alert.alert('Hata', (e as Error).message);
    }
  };

  const handleStartCustom = async () => {
    if (!customTitle.trim()) { Alert.alert('Hata', 'Challenge adi gir.'); return; }
    const days = parseInt(customDays) || 14;
    if (days < 3 || days > 90) { Alert.alert('Hata', 'Sure 3-90 gun arasi olmali.'); return; }

    try {
      await startChallenge(
        customTitle.trim(),
        customDesc.trim() || null,
        { metric: 'custom', goal: 1, period: 'daily', duration_days: days },
        'custom',
      );
      setCustomTitle(''); setCustomDays('14'); setCustomDesc('');
      setShowCustom(false);
      load();
    } catch (e) {
      Alert.alert('Hata', (e as Error).message);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Challenge'lar</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        Kisa sureli hedeflerle aliskanlik olustur. Ayni anda en fazla 2 aktif challenge.
      </Text>

      {/* Active Challenges */}
      {active.length === 0 ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>
            Aktif challenge yok. Asagidan bir tane baslat!
          </Text>
        </Card>
      ) : (
        active.map(c => {
          const metDays = c.progress.filter(p => p.met).length;
          const totalDays = c.target.duration_days;
          const pct = Math.round((metDays / totalDays) * 100);
          const streak = getStreak(c.progress);

          return (
            <Card key={c.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>{c.title}</Text>
                <View style={{
                  paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: 8,
                  backgroundColor: c.status === 'paused' ? COLORS.warning : COLORS.success,
                }}>
                  <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '600' }}>
                    {c.status === 'paused' ? 'Duraklatildi' : 'Aktif'}
                  </Text>
                </View>
              </View>

              {c.description && (
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, lineHeight: 20 }}>{c.description}</Text>
              )}

              {/* Progress bar */}
              <View style={{ marginTop: SPACING.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{metDays}/{totalDays} gun</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>%{pct}</Text>
                </View>
                <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${pct}%`, backgroundColor: COLORS.success, borderRadius: 4 }} />
                </View>
              </View>

              {/* Daily dots (last 7 days) */}
              <View style={{ flexDirection: 'row', gap: 4, marginTop: SPACING.sm, flexWrap: 'wrap' }}>
                {c.progress.slice(-14).map((p, i) => (
                  <View key={i} style={{
                    width: 18, height: 18, borderRadius: 9,
                    backgroundColor: p.met ? COLORS.success : COLORS.error,
                    justifyContent: 'center', alignItems: 'center',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }}>{p.met ? '✓' : '✗'}</Text>
                  </View>
                ))}
              </View>

              {streak > 1 && (
                <Text style={{ color: COLORS.success, fontSize: FONT.xs, marginTop: SPACING.xs, fontWeight: '600' }}>
                  {streak} gun ust uste basarili!
                </Text>
              )}

              {/* Actions */}
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                {c.status === 'active' && (
                  <Button title="Duraklat" variant="outline" size="sm" onPress={async () => { await pauseChallenge(c.id); load(); }} />
                )}
                {c.status === 'paused' && (
                  <Button title="Devam Et" variant="primary" size="sm" onPress={async () => { await resumeChallenge(c.id); load(); }} />
                )}
                <Button title="Birak" variant="ghost" size="sm" onPress={() => {
                  Alert.alert('Birak', `"${c.title}" challenge'ini birakmak istediginize emin misiniz?`, [
                    { text: 'Iptal' },
                    { text: 'Birak', style: 'destructive', onPress: async () => { await abandonChallenge(c.id); load(); } },
                  ]);
                }} />
              </View>
            </Card>
          );
        })
      )}

      {/* Start New Section */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg }}>
        <Button title="Sistem Challenge" variant={showSystem ? 'ghost' : 'primary'} onPress={() => { setShowSystem(!showSystem); setShowCustom(false); }} style={{ flex: 1 }} />
        <Button title="Ozel Challenge" variant={showCustom ? 'ghost' : 'outline'} onPress={() => { setShowCustom(!showCustom); setShowSystem(false); }} style={{ flex: 1 }} />
      </View>

      {/* System challenges */}
      {showSystem && (
        <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
          {SYSTEM_CHALLENGES.map((c, i) => (
            <Card key={i}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{c.title}</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>
                {CHALLENGE_DESCRIPTIONS[c.title] ?? `${c.target.duration_days} gun`}
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 4 }}>
                {c.target.duration_days} gun | Metrik: {METRIC_LABELS[c.target.metric] ?? c.target.metric}
              </Text>
              <Button title="Baslat" size="sm" onPress={() => handleStartSystem(c)} style={{ marginTop: SPACING.sm }} />
            </Card>
          ))}
        </View>
      )}

      {/* Custom challenge form */}
      {showCustom && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>Kendi Challenge'ini Olustur</Text>
          <Input label="Baslik" placeholder="21 gun kosu challenge'i" value={customTitle} onChangeText={setCustomTitle} />
          <Input label="Sure (gun)" placeholder="14" value={customDays} onChangeText={setCustomDays} keyboardType="numeric" />
          <Input label="Aciklama (opsiyonel)" placeholder="Her gun en az 20dk kosu yap" value={customDesc} onChangeText={setCustomDesc} multiline />
          <Button title="Baslat" onPress={handleStartCustom} style={{ marginTop: SPACING.sm }} />
        </Card>
      )}

      {/* Completed history */}
      <TouchableOpacity onPress={() => setShowHistory(!showHistory)} style={{ marginTop: SPACING.lg }}>
        <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>
          {showHistory ? 'Gecmisi Gizle' : `Gecmis Challenge'lar (${completed.length})`}
        </Text>
      </TouchableOpacity>

      {showHistory && completed.map(c => {
        const metDays = c.progress.filter(p => p.met).length;
        return (
          <View key={c.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{c.title}</Text>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{metDays}/{c.target.duration_days} gun</Text>
            </View>
            <View style={{
              paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: 8,
              backgroundColor: c.status === 'completed' ? COLORS.success : COLORS.textMuted,
            }}>
              <Text style={{ color: '#fff', fontSize: FONT.xs }}>{c.status === 'completed' ? 'Tamamlandi' : 'Birakildi'}</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function getStreak(progress: { met: boolean }[]): number {
  let streak = 0;
  for (let i = progress.length - 1; i >= 0; i--) {
    if (progress[i].met) streak++;
    else break;
  }
  return streak;
}
