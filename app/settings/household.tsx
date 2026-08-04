import { useState, useEffect, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, ScrollView, TouchableOpacity, Alert, Share } from 'react-native';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/stores/auth.store';
import { isoDateMondayOfWeek } from '@/services/plan.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(s => s.user?.id);

  const [loading, setLoading] = useState(true);
  // FIX (ux-round4 #20): a failed load used to fall through to household=null → the "Aile Oluştur"
  // empty state, misleading an existing member. Track the failure and show a retry instead.
  const [loadError, setLoadError] = useState(false);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const [joinCode, setJoinCode] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [busy, setBusy] = useState(false);

  // FIX (final sweep): checked-off items were component-local and vanished on unmount.
  // Persist per household + ISO week (Monday anchor, same helper as the plan flow) so the
  // list survives navigation and resets naturally when a new week's menu lands.
  const checkedStorageKey = (householdId: string) =>
    `@kochko_household_checked:${householdId}:${isoDateMondayOfWeek(new Date())}`;

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(false);
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
        // FIX (final sweep): hydrate this week's checked-off items (best-effort).
        try {
          const stored = await AsyncStorage.getItem(checkedStorageKey(h.id));
          setCheckedItems(stored ? new Set(JSON.parse(stored) as string[]) : new Set());
        } catch { /* corrupt/missing entry → start unchecked */ }
      }
    } catch (e) {
      console.error('Household load error', e);
      setLoadError(true);
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
    } catch (e) {
      // FIX (audit error-message-sweep): raw PostgREST/EN hata metnini kullanıcıya sızdırma; konsola bırak.
      console.error('createHousehold error', e);
      Alert.alert('Hata', 'Aile oluşturulamadı, lütfen tekrar dene.');
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
    } catch (e) {
      // FIX (audit error-message-sweep): raw PostgREST/EN hata metnini kullanıcıya sızdırma; konsola bırak.
      console.error('joinHousehold error', e);
      Alert.alert('Hata', 'Aileye katılamadık — kodu kontrol edip tekrar dene.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = () => {
    if (!userId || !household) return;
    const isOwner = household.ownerId === userId;
    Alert.alert(
      'Aileden Ayrıl',
      isOwner
        ? 'Aile reisi olarak ayrılırsan aile tamamen silinir. Emin misin?'
        : 'Bu aileden ayrılmak istediğine emin misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Ayrıl',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await leaveHousehold(userId, household.id);
              setHousehold(null);
              setMembers([]);
              setShoppingList([]);
            } catch (e) {
              // FIX (audit error-message-sweep): raw PostgREST/EN hata metnini kullanıcıya sızdırma; konsola bırak.
              console.error('leaveHousehold error', e);
              Alert.alert('Hata', 'Aileden ayrılamadık, lütfen tekrar dene.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const toggleCheck = (key: string) => {
    const next = new Set(checkedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCheckedItems(next);
    // FIX (final sweep): write-through so the checked state survives unmount (best-effort).
    if (household) {
      AsyncStorage.setItem(checkedStorageKey(household.id), JSON.stringify([...next])).catch(() => {});
    }
  };

  if (loading) {
    // FIX (ux-polish): content-shaped skeleton (like the sibling settings screens) instead of a bare
    // centered spinner that jumps to a full page of cards.
    return <View style={{ flex: 1, backgroundColor: colors.background }}><SkeletonScreen cards={2} /></View>;
  }

  // FIX (ux-round4 #20): a real load failure gets a retry — not a misleading "create a family" form.
  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadErrorState title="Aile bilgisi yüklenemedi" onRetry={loadData} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Aile üyelerini ekle, ortak alışveriş listesi oluştur.
      </Text>

      {!household ? (
        <>
          {/* Create household */}
          <Card title="Aile Oluştur">
            <Input
              label="Aile Adı (opsiyonel)"
              value={householdName}
              onChangeText={setHouseholdName}
              placeholder="Ailem"
            />
            <Button
              title={busy ? 'Oluşturuluyor...' : 'Aile Oluştur'}
              onPress={handleCreate}
              disabled={busy}
              style={{ marginTop: SPACING.md }}
            />
          </Card>

          {/* Join with code */}
          <Card title="Davet Koduyla Katıl" style={{ marginTop: SPACING.md }}>
            <Input
              label="Davet Kodu"
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="ABC123"
              autoCapitalize="characters"
            />
            <Button
              title={busy ? 'Katılınıyor...' : 'Katıl'}
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
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Davet Kodu</Text>
                {/* ux-sweep (HH-01): kod salt-görüntüydü — 'paylaş' vaadi eylemsizdi. Dokun→paylaş. */}
                <TouchableOpacity
                  onPress={() => { void Share.share({ message: `KOCHKO aile davet kodum: ${household.inviteCode}` }); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Davet kodu ${household.inviteCode}. Paylaşmak için dokun`}
                  style={{ backgroundColor: colors.surfaceLight, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}
                >
                  <Text selectable style={{ color: colors.primary, ...TYPE.title3, letterSpacing: 2 }}>{household.inviteCode}</Text>
                  <Ionicons name="share-social-outline" size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.textMuted, ...TYPE.caption }}>
                Koda dokunarak paylaşabilirsin — aile üyeleri bu kodla katılır.
              </Text>
            </View>
          </Card>

          {/* Members */}
          <Card title="Üyeler" style={{ marginTop: SPACING.md }}>
            {members.map((m, i) => (
              <View
                key={m.userId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: SPACING.sm,
                  borderBottomWidth: i < members.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, ...TYPE.body }}>{m.displayName}</Text>
                <Text style={{ color: m.role === 'owner' ? colors.primary : colors.textMuted, ...TYPE.caption, fontWeight: '600' }}>
                  {m.role === 'owner' ? 'Kurucu' : 'Üye'}
                </Text>
              </View>
            ))}
          </Card>

          {/* Shopping list */}
          <Card title="Ortak Alışveriş Listesi" style={{ marginTop: SPACING.md }}>
            {shoppingList.length === 0 ? (
              <Text style={{ color: colors.textMuted, ...TYPE.body }}>
                Henüz alışveriş listesi yok. Haftalık menü oluşturulduğunda burada görünecek.
              </Text>
            ) : (
              shoppingList.map((item) => {
                const key = `${item.ingredient}|${item.unit}`;
                const checked = checkedItems.has(key);
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => toggleCheck(key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={item.ingredient}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SPACING.md,
                      minHeight: 44,
                      paddingVertical: SPACING.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: checked ? colors.primary : colors.textMuted,
                        backgroundColor: checked ? colors.primary : 'transparent',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      {checked && <Text style={{ color: getContrastColor(colors.primary), fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: checked ? colors.textMuted : colors.text, ...TYPE.body, textDecorationLine: checked ? 'line-through' : 'none' }}>
                        {item.ingredient}
                      </Text>
                    </View>
                    <Text style={{ color: colors.textSecondary, ...TYPE.body }}>
                      {/* FIX (final sweep): totalAmount = MEMBER COUNT, unit = the full amount string —
                          '{count} {unit}' rendered '1 500 g' as if it were 1500 g. Show the amount,
                          plus how many members need it when shared. */}
                      {`${item.unit}${item.totalAmount > 1 ? ` · ${item.totalAmount} kişi` : ''}`}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </Card>

          {/* Leave */}
          <View style={{ marginTop: SPACING.xl }}>
            <Button
              title="Aileden Ayrıl"
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
