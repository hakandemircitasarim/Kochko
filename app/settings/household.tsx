import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import {
  getUserHousehold,
  createHousehold,
  joinHousehold,
  leaveHousehold,
  getHouseholdMembers,
  getSharedShoppingList,
  type Household,
  type HouseholdMember,
  type ShoppingListItem,
} from '@/services/household.service';

export default function HouseholdScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id);

  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const [joinCode, setJoinCode] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const h = await getUserHousehold(userId);
      setHousehold(h);
      if (h) {
        const [m, s] = await Promise.all([
          getHouseholdMembers(h.id),
          getSharedShoppingList(h.id),
        ]);
        setMembers(m);
        setShoppingList(s);
      }
    } catch (e) {
      console.error('Household load error', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await createHousehold(userId, householdName.trim() || undefined);
      await loadData();
    } catch (e: any) {
      Alert.alert('Hata', e?.message ?? 'Aile olusturulamadi.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!userId || !joinCode.trim()) return;
    setBusy(true);
    try {
      await joinHousehold(userId, joinCode.trim());
      setJoinCode('');
      await loadData();
    } catch (e: any) {
      Alert.alert('Hata', e?.message ?? 'Katilim basarisiz.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = () => {
    if (!userId || !household) return;
    const isOwner = household.ownerId === userId;
    Alert.alert(
      'Aileden Ayril',
      isOwner
        ? 'Aile reisi olarak ayrilirsan aile tamamen silinir. Emin misin?'
        : 'Bu aileden ayrilmak istediginize emin misiniz?',
      [
        { text: 'Iptal', style: 'cancel' },
        {
          text: 'Ayril',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveHousehold(userId, household.id);
              setHousehold(null);
              setMembers([]);
              setShoppingList([]);
            } catch (e: any) {
              Alert.alert('Hata', e?.message ?? 'Ayrilma basarisiz.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const toggleCheck = (key: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Aile Plani</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Aile uyelerini ekle, ortak alisveris listesi olustur.
      </Text>

      {!household ? (
        <>
          {/* Create household */}
          <Card title="Aile Olustur">
            <Input
              label="Aile Adi (opsiyonel)"
              value={householdName}
              onChangeText={setHouseholdName}
              placeholder="Ailem"
            />
            <Button
              title={busy ? 'Olusturuluyor...' : 'Aile Olustur'}
              onPress={handleCreate}
              disabled={busy}
              style={{ marginTop: SPACING.md }}
            />
          </Card>

          {/* Join with code */}
          <Card title="Davet Koduyla Katil" style={{ marginTop: SPACING.md }}>
            <Input
              label="Davet Kodu"
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="ABC123"
              autoCapitalize="characters"
            />
            <Button
              title={busy ? 'Katiliniyor...' : 'Katil'}
              onPress={handleJoin}
              disabled={busy || !joinCode.trim()}
              style={{ marginTop: SPACING.md }}
            />
          </Card>
        </>
      ) : (
        <>
          {/* Household info */}
          <Card title={household.name}>
            <View style={{ gap: SPACING.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Davet Kodu</Text>
                <View style={{ backgroundColor: COLORS.surfaceLight, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.sm }}>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700', letterSpacing: 2 }}>{household.inviteCode}</Text>
                </View>
              </View>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                Bu kodu paylasarak aile uyelerini davet edebilirsin.
              </Text>
            </View>
          </Card>

          {/* Members */}
          <Card title="Uyeler" style={{ marginTop: SPACING.md }}>
            {members.map((m, i) => (
              <View
                key={m.userId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: SPACING.sm,
                  borderBottomWidth: i < members.length - 1 ? 1 : 0,
                  borderBottomColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{m.displayName}</Text>
                <Text style={{ color: m.role === 'owner' ? COLORS.primary : COLORS.textMuted, fontSize: FONT.xs, fontWeight: '600' }}>
                  {m.role === 'owner' ? 'Kurucu' : 'Uye'}
                </Text>
              </View>
            ))}
          </Card>

          {/* Shopping list */}
          <Card title="Ortak Alisveris Listesi" style={{ marginTop: SPACING.md }}>
            {shoppingList.length === 0 ? (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>
                Henuz alisveris listesi yok. Haftalik menu olusturuldugunda burada gorunecek.
              </Text>
            ) : (
              shoppingList.map((item) => {
                const key = `${item.ingredient}|${item.unit}`;
                const checked = checkedItems.has(key);
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => toggleCheck(key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SPACING.md,
                      paddingVertical: SPACING.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.border,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: checked ? COLORS.primary : COLORS.textMuted,
                        backgroundColor: checked ? COLORS.primary : 'transparent',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      {checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: checked ? COLORS.textMuted : COLORS.text, fontSize: FONT.md, textDecorationLine: checked ? 'line-through' : 'none' }}>
                        {item.ingredient}
                      </Text>
                    </View>
                    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
                      {item.totalAmount} {item.unit}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </Card>

          {/* Leave */}
          <View style={{ marginTop: SPACING.xl }}>
            <Button
              title="Aileden Ayril"
              variant="ghost"
              onPress={handleLeave}
              disabled={busy}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
