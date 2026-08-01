import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getActiveChallenges, getCompletedChallenges, startChallenge, pauseChallenge, resumeChallenge, abandonChallenge, SYSTEM_CHALLENGES, type Challenge , markManualDay } from '@/services/challenges.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { usePremium } from '@/hooks/usePremium';
import { useProfileStore } from '@/stores/profile.store';

export default function ChallengesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [active, setActive] = useState<Challenge[]>([]);
  const [completed, setCompleted] = useState<Challenge[]>([]);
  const [showSystem, setShowSystem] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  // FIX (ux-round4 #28): the initial load had no error handling — a rejected fetch was an unhandled
  // promise rejection AND collapsed to the "Aktif challenge yok" empty state, hiding a premium
  // user's real challenges. Track the failure and offer a retry.
  const [loadError, setLoadError] = useState(false);

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  // Custom challenge form
  const [customTitle, setCustomTitle] = useState('');
  const [customDays, setCustomDays] = useState('14');
  const [customType, setCustomType] = useState<'water' | 'protein' | 'steps' | 'sleep' | 'custom'>('custom');
  const [customThreshold, setCustomThreshold] = useState('');

  useEffect(() => { load().catch(() => setLoadError(true)).finally(() => setLoading(false)); }, []);
  const load = () => Promise.all([
    getActiveChallenges().then(setActive),
    getCompletedChallenges().then(setCompleted),
  ]);
  const reload = () => {
    setLoadError(false);
    setLoading(true);
    load().catch(() => setLoadError(true)).finally(() => setLoading(false));
  };
  // In-place refresh after a mutation: refetch the lists WITHOUT the full-screen skeleton flash
  // (reload() toggles loading), but still surface a fetch failure via the retry screen.
  const refreshLists = () => { load().catch(() => setLoadError(true)); };
  // FIX (ux-round4 #28 review): pause/resume/bırak used fire-and-forget (mutation; load()) — the
  // reload raced the un-awaited write (stale status → button looked dead) and a failed mutation
  // gave no feedback + an unhandled rejection. Await both, and surface failures.
  const runAction = async (fn: () => Promise<void>) => {
    // FIX (ux-round4 batch-2 review): separate the mutation from the reload. Only a real MUTATION
    // failure surfaces "işlem tamamlanamadı"; a post-success reload failure is handled by reload()
    // itself (→ loadError/retry screen), so a persisted pause isn't reported as failed.
    try {
      await fn();
    } catch {
      Alert.alert('Hata', 'İşlem tamamlanamadı. Lütfen tekrar dene.');
      return;
    }
    refreshLists();
  };

  const handleStart = async (c: typeof SYSTEM_CHALLENGES[0]) => {
    try {
      await startChallenge(c.title, null, c.target);
      setShowSystem(false);
      // FIX (ux-round4 batch-2 review): refreshLists() (self-handling) not bare load() — getters now
      // throw (FIX-A), so an un-awaited load() could reject unhandled after a successful start.
      refreshLists();
    } catch (e) {
      // FIX (audit raw-error): fixed Turkish copy for the user; raw error to the console only.
      console.warn('startChallenge failed', e);
      Alert.alert('Hata', 'Challenge başlatılamadı, tekrar dene.');
    }
  };

  const handleStartCustom = async () => {
    if (!customTitle.trim()) { Alert.alert('Eksik', 'Challenge başlığını yaz.'); return; }
    const days = parseInt(customDays) || 14;
    if (days < 3 || days > 90) { Alert.alert('Geçersiz', 'Süre 3-90 gün arası olmalı.'); return; }
    const threshold = customThreshold ? parseFloat(customThreshold) : null;
    // Canonical target shape — same as SYSTEM_CHALLENGES, so the nightly
    // evaluator (ai-proactive) can score custom challenges too. The old
    // {type, daily_threshold} shape was cast through `as unknown` and would
    // have been unreadable to any evaluator.
    const METRIC_BY_TYPE: Record<typeof customType, { metric: string; defaultGoal: number }> = {
      water: { metric: 'water_met', defaultGoal: 1 },
      protein: { metric: 'protein_met', defaultGoal: 1 },
      steps: { metric: 'steps', defaultGoal: 10000 },
      sleep: { metric: 'sleep', defaultGoal: 7 },
      custom: { metric: 'manual', defaultGoal: 1 },
    };
    const m = METRIC_BY_TYPE[customType];
    try {
      await startChallenge(customTitle.trim(), null, {
        metric: m.metric,
        goal: threshold ?? m.defaultGoal,
        period: 'daily',
        duration_days: days,
      }, 'custom');
      setShowCustom(false);
      setCustomTitle(''); setCustomDays('14'); setCustomThreshold(''); setCustomType('custom');
      // FIX (ux-round4 batch-2 review): refreshLists() (self-handling), not bare load() — see handleStart.
      refreshLists();
    } catch (e) {
      // FIX (audit raw-error): fixed Turkish copy for the user; raw error to the console only.
      console.warn('startChallenge (custom) failed', e);
      Alert.alert('Hata', 'Challenge başlatılamadı, tekrar dene.');
    }
  };

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (loading) {
    // FIX (ux-ideas #28): skeleton loader instead of a bare centered spinner (see achievements).
    return <View style={{ flex: 1, backgroundColor: colors.background }}><SkeletonScreen cards={4} /></View>;
  }

  // FIX (ux-round4 #28): distinguish a real load failure from "no challenges" + offer retry.
  if (loadError) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}><LoadErrorState title="Challenge'lar yüklenemedi" onRetry={reload} /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {/* Active Challenges */}
      {active.length === 0 ? (
        <Card><Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Aktif challenge yok.</Text></Card>
      ) : (
        active.map(c => (
          <Card key={c.id} title={c.title}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
              {c.target.duration_days} gün · {c.status === 'paused' ? 'Duraklatıldı' : 'Aktif'}
            </Text>
            {/* Progress bar */}
            <View style={{ height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden', marginBottom: SPACING.sm }}>
              <View style={{
                height: '100%',
                width: `${Math.min(100, (c.progress.filter(p => p.met).length / c.target.duration_days) * 100)}%`,
                backgroundColor: colors.success, borderRadius: 3,
              }} />
            </View>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              {c.progress.filter(p => p.met).length} / {c.target.duration_days} gün tamamlandı
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {/* ux-sweep (CH-01): 'manual' metriği otomatik değerlendirilemez — gün kullanıcıdan. */}
              {c.status === 'active' && c.target?.metric === 'manual' && (
                <Button title="Bugünü işaretle" variant="primary" size="sm" onPress={() => runAction(async () => {
                  const r = await markManualDay(c.id);
                  if (r.already) Alert.alert('Zaten işaretli', 'Bugünü daha önce işaretlemişsin.');
                  else if (r.done) Alert.alert('Tebrikler!', 'Challenge tamamlandı.');
                })} />
              )}
              {c.status === 'active' && <Button title="Duraklat" variant="outline" size="sm" onPress={() => runAction(() => pauseChallenge(c.id))} />}
              {c.status === 'paused' && <Button title="Devam Et" variant="primary" size="sm" onPress={() => runAction(() => resumeChallenge(c.id))} />}
              <Button title="Bırak" variant="ghost" size="sm" onPress={() => {
                Alert.alert('Bırak', 'Challenge\'ı bırakmak istediğine emin misin?', [
                  { text: 'İptal' },
                  { text: 'Bırak', style: 'destructive', onPress: () => runAction(() => abandonChallenge(c.id)) },
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
          {/* FIX (final sweep): steps preset hidden on Android — Pedometer is iOS-only, the challenge could never score. */}
          {SYSTEM_CHALLENGES.filter(c => Platform.OS !== 'android' || c.target.metric !== 'steps').map((c, i) => (
            <Card key={i}>
              <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>{c.title}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4 }}>{c.target.duration_days} gün</Text>
              <Button title="Başlat" size="sm" onPress={() => handleStart(c)} style={{ marginTop: SPACING.sm }} />
            </Card>
          ))}
        </View>
      )}

      {showCustom && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>
            Kendi Challenge'ını Tanımla
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
            Başlık (örn. "10 gün şekersiz")
          </Text>
          <TextInput
            value={customTitle} onChangeText={setCustomTitle}
            placeholder="Challenge başlığı" placeholderTextColor={colors.textMuted}
            style={{
              backgroundColor: colors.surfaceLight, borderRadius: 8,
              padding: SPACING.sm, color: colors.text, fontSize: FONT.md,
              marginBottom: SPACING.sm,
            }}
          />
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginBottom: SPACING.sm }}>Tip</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: SPACING.sm }}>
            {/* FIX (final sweep): steps type hidden on Android — Pedometer is iOS-only, the metric would never fill. */}
            {(['water', 'protein', 'steps', 'sleep', 'custom'] as const).filter(t => Platform.OS !== 'android' || t !== 'steps').map(t => (
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
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginBottom: 4 }}>Süre (gün)</Text>
              {/* FIX (audit a11y): screen readers get the visible label. */}
              <TextInput
                value={customDays} onChangeText={setCustomDays} keyboardType="numeric"
                accessibilityLabel="Süre (gün)"
                style={{
                  backgroundColor: colors.surfaceLight, borderRadius: 8,
                  padding: SPACING.sm, color: colors.text, fontSize: FONT.md,
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginBottom: 4 }}>Eşik (ops.)</Text>
              {/* FIX (audit a11y): screen readers get the visible label. */}
              <TextInput
                value={customThreshold} onChangeText={setCustomThreshold} keyboardType="numeric"
                placeholder="örn. 10000"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Eşik"
                style={{
                  backgroundColor: colors.surfaceLight, borderRadius: 8,
                  padding: SPACING.sm, color: colors.text, fontSize: FONT.md,
                }}
              />
            </View>
          </View>
          <Button title="Başlat" onPress={handleStartCustom} />
        </Card>
      )}

      {/* #R2-L4: Completed/abandoned history — previously these vanished from the screen */}
      {completed.length > 0 && (
        <View style={{ marginTop: SPACING.lg }}>
          <Text style={{ fontSize: FONT.lg, fontWeight: '700', color: colors.text, marginBottom: SPACING.sm }}>Tamamlanan / Geçmiş</Text>
          {completed.map(c => {
            const done = c.progress.filter(p => p.met).length;
            return (
              <Card key={c.id}>
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600' }}>
                  {c.status === 'completed' ? '🏆 ' : ''}{c.title}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4 }}>
                  {c.status === 'completed' ? 'Tamamlandı' : 'Bırakıldı'} · {done}/{c.target.duration_days} gün
                </Text>
                <View style={{ height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden', marginTop: SPACING.sm }}>
                  <View style={{ height: '100%', width: `${Math.min(100, (done / c.target.duration_days) * 100)}%`, backgroundColor: c.status === 'completed' ? colors.success : colors.textMuted, borderRadius: 3 }} />
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
