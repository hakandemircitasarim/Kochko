import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { a11ySwitch, getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

const DATA_TYPE_LABELS: Record<string, string> = {
  meals: 'Öğün Kayıtları',
  metrics: 'Profil Bilgileri',
  weight: 'Kilo Verileri',
  goals: 'Hedefler',
  plans: 'Haftalık Planlar',
  chat_summary: 'AI Özeti',
  reports: 'Sohbet Geçmişi',
};

export default function CoachSharingScreen() {
  const insets = useSafeAreaInsets();
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
        setCoachName(coachProfile ? `Koç ${c.coachId.slice(0, 6)}` : null);
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
    const coachId = inviteCode.trim();
    // The "code" must currently be the coach's account ID (UUID). Anything else
    // hit raw Postgres errors (22P02 invalid uuid / 23503 FK) shown verbatim in
    // an Alert. Validate up front with a human-readable message instead.
    // (A real short-code mechanism is a future server feature — B2B, Spec 20.1.)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(coachId)) {
      haptics.error();
      Alert.alert(
        'Geçersiz kod',
        'Koç bağlantısı için koçunun hesap kimliğini (UUID formatında) girmen gerekiyor. Koçundan uygulamadaki profil kimliğini iste.',
      );
      return;
    }
    setBusy(true);
    try {
      const allTypes = [...SHAREABLE_DATA_TYPES];
      await shareDataWithCoach(userId, coachId, allTypes);
      setInviteCode('');
      haptics.success();
      await loadData();
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      haptics.error();
      Alert.alert('Hata', msg.includes('foreign key') || msg.includes('23503')
        ? 'Bu kimlikle kayıtlı bir koç bulunamadı, kimliği kontrol edip tekrar dene.'
        : msg || 'Koç bağlantısı kurulamadı, tekrar dener misin?');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (dataType: string) => {
    if (!userId || !consent) return;
    haptics.tap();
    const newToggles = { ...toggles, [dataType]: !toggles[dataType] };
    setToggles(newToggles);

    const activeTypes = Object.entries(newToggles)
      .filter(([_, v]) => v)
      .map(([k]) => k);

    if (activeTypes.length === 0) {
      // Can't have zero types — revert
      setToggles(toggles);
      haptics.warning();
      Alert.alert('Uyarı', 'En az bir veri tipi paylaşımda olmalı. Erişimi tamamen kaldırmak için "Koç Erişimini Kaldır" butonunu kullan.');
      return;
    }

    try {
      await shareDataWithCoach(userId, consent.coachId, activeTypes);
    } catch (e: any) {
      setToggles(toggles); // revert on error
      haptics.error();
      Alert.alert('Hata', e?.message ?? 'Güncelleme yapılamadı, tekrar dener misin?');
    }
  };

  const handleRevoke = () => {
    if (!userId) return;
    Alert.alert(
      'Koç Erişimini Kaldır',
      'Koçunun tüm verilerine erişimi kaldırılacak. Emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Erişimi Kaldır',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await revokeCoachAccess(userId);
              setConsent(null);
              setCoachName(null);
              setToggles({});
              haptics.success();
            } catch (e: any) {
              haptics.error();
              Alert.alert('Hata', e?.message ?? 'Erişim kaldırılamadı, tekrar dener misin?');
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
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Profesyonel koçunla verilerini güvenli şekilde paylaş.
      </Text>

      {!consent ? (
        <>
          {/* No coach linked */}
          <Card title="Koç Bağlantısı">
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
              Koçundan aldığın davet kodunu girerek hesabını bağlayabilirsin. Bağlantı sonrası hangi verilerin paylaşılacağını sen belirlersin.
            </Text>
            <Input
              label="Koç Davet Kodu"
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Koç kodunu gir"
            />
            <Button
              title={busy ? 'Bağlanıyor...' : 'Koç Bağla'}
              onPress={handleLink}
              disabled={busy || !inviteCode.trim()}
              style={{ marginTop: SPACING.md }}
            />
          </Card>
        </>
      ) : (
        <>
          {/* Coach info */}
          <Card title="Bağlı Koç">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600' }}>{coachName ?? 'Koç'}</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
                  Bağlantı: {new Date(consent.grantedAt).toLocaleDateString('tr-TR')}
                </Text>
              </View>
              <View style={{ backgroundColor: COLORS.successLight, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.pill }}>
                <Text style={{ color: COLORS.success, fontSize: FONT.xs, fontWeight: '600' }}>Aktif</Text>
              </View>
            </View>
          </Card>

          {/* Data sharing toggles */}
          <Card title="Veri Paylaşım İzinleri" style={{ marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md, lineHeight: 20 }}>
              Koçunun hangi verilerini görebileceğini seç.
            </Text>
            {SHAREABLE_DATA_TYPES.map((dt, i) => (
              <TouchableOpacity
                key={dt}
                onPress={() => handleToggle(dt)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                {...a11ySwitch(DATA_TYPE_LABELS[dt] ?? dt, !!toggles[dt])}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minHeight: 44,
                  paddingVertical: SPACING.sm,
                  borderBottomWidth: i < SHAREABLE_DATA_TYPES.length - 1 ? 1 : 0,
                  borderBottomColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{DATA_TYPE_LABELS[dt] ?? dt}</Text>
                {/* FIX (audit toggle-size): standardize switch to 48x28 (matches ToggleRow primitive). */}
                <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: toggles[dt] ? COLORS.primary : COLORS.surfaceLight, justifyContent: 'center', padding: 2 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: getContrastColor(toggles[dt] ? COLORS.primary : COLORS.surfaceLight), alignSelf: toggles[dt] ? 'flex-end' : 'flex-start' }} />
                </View>
              </TouchableOpacity>
            ))}
          </Card>

          {/* Active consent summary */}
          <Card title="Onay Detayları" style={{ marginTop: SPACING.md }}>
            <View style={{ gap: SPACING.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Durum</Text>
                <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>Aktif</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Paylaşılan Veri</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>
                  {consent.dataTypes.length} / {SHAREABLE_DATA_TYPES.length} kategori
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Başlangıç</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>
                  {new Date(consent.grantedAt).toLocaleDateString('tr-TR')}
                </Text>
              </View>
            </View>
          </Card>

          {/* Revoke */}
          <View style={{ marginTop: SPACING.xl }}>
            <Button
              title="Koç Erişimini Kaldır"
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
