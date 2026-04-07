import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import {
  getActiveConsent,
  shareDataWithCoach,
  revokeCoachAccess,
  SHAREABLE_DATA_TYPES,
  type DataSharingConsent,
} from '@/services/coach-mode.service';
import { supabase } from '@/lib/supabase';

const DATA_TYPE_LABELS: Record<string, string> = {
  meals: 'Ogun Kayitlari',
  metrics: 'Profil Bilgileri',
  weight: 'Kilo Verileri',
  goals: 'Hedefler',
  plans: 'Haftalik Planlar',
  chat_summary: 'AI Ozeti',
  reports: 'Sohbet Gecmisi',
};

export default function CoachSharingScreen() {
  const userId = useAuthStore(s => s.user?.id);

  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState<DataSharingConsent | null>(null);
  const [coachName, setCoachName] = useState<string | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});

  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const c = await getActiveConsent(userId);
      setConsent(c);
      if (c) {
        // Build toggle state from consent data types
        const t: Record<string, boolean> = {};
        for (const dt of SHAREABLE_DATA_TYPES) {
          t[dt] = c.dataTypes.includes(dt);
        }
        setToggles(t);

        // Fetch coach display name
        const { data: coachProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', c.coachId)
          .single();
        setCoachName(coachProfile ? `Koc ${c.coachId.slice(0, 6)}` : null);
      }
    } catch (e) {
      console.error('Coach sharing load error', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleLink = async () => {
    if (!userId || !inviteCode.trim()) return;
    setBusy(true);
    try {
      // Use the invite code as the coach ID (simplified flow)
      const coachId = inviteCode.trim();
      const allTypes = [...SHAREABLE_DATA_TYPES];
      await shareDataWithCoach(userId, coachId, allTypes);
      setInviteCode('');
      await loadData();
    } catch (e: any) {
      Alert.alert('Hata', e?.message ?? 'Koc baglantisi kurulamadi.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (dataType: string) => {
    if (!userId || !consent) return;
    const newToggles = { ...toggles, [dataType]: !toggles[dataType] };
    setToggles(newToggles);

    const activeTypes = Object.entries(newToggles)
      .filter(([_, v]) => v)
      .map(([k]) => k);

    if (activeTypes.length === 0) {
      // Can't have zero types — revert
      setToggles(toggles);
      Alert.alert('Uyari', 'En az bir veri tipi paylasimda olmalidir. Erisimi tamamen kaldirmak icin "Koc Erisimini Kaldir" butonunu kullanin.');
      return;
    }

    try {
      await shareDataWithCoach(userId, consent.coachId, activeTypes);
    } catch (e: any) {
      setToggles(toggles); // revert on error
      Alert.alert('Hata', e?.message ?? 'Guncelleme basarisiz.');
    }
  };

  const handleRevoke = () => {
    if (!userId) return;
    Alert.alert(
      'Koc Erisimini Kaldir',
      'Kocinizin tum verilerinize erisimi kaldirilacak. Emin misiniz?',
      [
        { text: 'Iptal', style: 'cancel' },
        {
          text: 'Erisimi Kaldir',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await revokeCoachAccess(userId);
              setConsent(null);
              setCoachName(null);
              setToggles({});
            } catch (e: any) {
              Alert.alert('Hata', e?.message ?? 'Islem basarisiz.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Koc Paylasimi</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Profesyonel kocinizle verilerinizi guvenli sekilde paylasin.
      </Text>

      {!consent ? (
        <>
          {/* No coach linked */}
          <Card title="Koc Baglantisi">
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
              Kocinizden aldiginiz davet kodunu girerek hesabinizi baglayabilirsiniz. Baglanti sonrasi hangi verilerin paylasilacagini siz belirlersiniz.
            </Text>
            <Input
              label="Koc Davet Kodu"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Koc kodunu girin"
            />
            <Button
              title={busy ? 'Baglaniyor...' : 'Koc Bagla'}
              onPress={handleLink}
              disabled={busy || !inviteCode.trim()}
              style={{ marginTop: SPACING.md }}
            />
          </Card>
        </>
      ) : (
        <>
          {/* Coach info */}
          <Card title="Bagli Koc">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600' }}>{coachName ?? 'Koc'}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
                  Baglanti: {new Date(consent.grantedAt).toLocaleDateString('tr-TR')}
                </Text>
              </View>
              <View style={{ backgroundColor: COLORS.successLight, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.pill }}>
                <Text style={{ color: COLORS.success, fontSize: FONT.xs, fontWeight: '600' }}>Aktif</Text>
              </View>
            </View>
          </Card>

          {/* Data sharing toggles */}
          <Card title="Veri Paylasim Izinleri" style={{ marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
              Kocinizin hangi verilerinizi gorebilecegini secin.
            </Text>
            {SHAREABLE_DATA_TYPES.map((dt, i) => (
              <TouchableOpacity
                key={dt}
                onPress={() => handleToggle(dt)}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: SPACING.sm,
                  borderBottomWidth: i < SHAREABLE_DATA_TYPES.length - 1 ? 1 : 0,
                  borderBottomColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{DATA_TYPE_LABELS[dt] ?? dt}</Text>
                <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: toggles[dt] ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: toggles[dt] ? 'flex-end' : 'flex-start' }} />
                </View>
              </TouchableOpacity>
            ))}
          </Card>

          {/* Active consent summary */}
          <Card title="Onay Detaylari" style={{ marginTop: SPACING.md }}>
            <View style={{ gap: SPACING.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Durum</Text>
                <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>Aktif</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Paylasilan Veri</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>
                  {consent.dataTypes.length} / {SHAREABLE_DATA_TYPES.length} kategori
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Baslangic</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>
                  {new Date(consent.grantedAt).toLocaleDateString('tr-TR')}
                </Text>
              </View>
            </View>
          </Card>

          {/* Revoke */}
          <View style={{ marginTop: SPACING.xl }}>
            <Button
              title="Koc Erisimini Kaldir"
              variant="ghost"
              onPress={handleRevoke}
              disabled={busy}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
