import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { deleteVenue, type Venue } from '@/services/venues.service';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';

const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restoran', cafeteria: 'Kafeterya', fast_food: 'Fast Food', cafe: 'Kafe',
};

export default function VenuesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  // FIX (audit UI-STA-03): yükleme durumu — ilk fetch bitene kadar veri olan kullanıcıya yanlış 'boş' kartı gösterilmiyordu.
  const [loading, setLoading] = useState(true);
  // FIX (audit empty-vs-error): getVenues hataları []'a yutuyor — ekran doğrudan sorguluyor
  // ki fetch hatası 'mekan yok' yerine hata+tekrar dene kartı çizsin.
  const [loadError, setLoadError] = useState(false);

  const loadVenues = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.from('user_venues').select('*').order('visit_count', { ascending: false });
    if (error) {
      console.warn('user_venues load failed', error);
      setLoadError(true);
    } else {
      setVenues((data ?? []) as Venue[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  // "Dışarıda Yemek Planlıyorum" boş bir sohbet açıyordu ve yorumu "sohbet ekranı modu
  // kullanıcının mesajından anlar" diyordu — ama kullanıcı henüz bir şey YAZMAMIŞTI, yani
  // düğme hiçbir bağlam taşımıyordu. Sohbet ekranı `prefill` parametresini zaten okuyor
  // (ChatThreadScreen: rawParams.prefill); niyeti bestecinin içine koyup gönderiyoruz.
  const navigateToEatingOut = () => {
    router.push({
      pathname: '/(tabs)/chat',
      params: { prefill: 'Bugün dışarıda yemek yiyeceğim. Nereye gideceğimi ve ne seçmem gerektiğini birlikte planlayalım mı?' },
    });
  };

  const handleDelete = (id: string) => {
    // ux-sweep (VN-01): çöp ikonu VE uzun basış onaysız + geri-alınmaz siliyordu — öğrenilmiş
    // tüm makro tahminleriyle birlikte. recipes.tsx onay kalıbı + hata kontrolü.
    const v = venues.find(x => x.id === id);
    Alert.alert('Sil', `"${v?.venue_name ?? 'Mekan'}" ve öğrenilen menü tahminleri silinecek. Emin misin?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        const { error } = await deleteVenue(id);
        if (error) { Alert.alert('Hata', 'Silinemedi, tekrar dene.'); return; }
        setVenues(prev => prev.filter(x => x.id !== id));
      }},
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit ui-settings-duplicate-title): native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
      {/* FIX (audit i18n-strings): Türkçe diakritik geri yüklendi. */}
      <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, marginBottom: SPACING.md }}>Sık gittiğin mekanlar ve öğrenilen makro tahminleri.</Text>

      {/* Quick Action: Navigate to chat for eating out planning */}
      <View style={{ marginBottom: SPACING.lg }}>
        <Button title="Dışarıda Yemek Planlıyorum" onPress={navigateToEatingOut} variant="outline" />
      </View>

      {/* FIX (audit UI-STA-03): ilk fetch sürerken boş-durum kartı yerine yükleniyor göstergesi. */}
      {loading ? (
        <View style={{ gap: SPACING.md, paddingTop: SPACING.md }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      ) : loadError ? (
        /* FIX (audit empty-vs-error): fetch hatası 'mekan yok' değil, hata+tekrar dene (shared LoadErrorState). */
        <Card>
          <LoadErrorState embedded title="Mekanlar yüklenemedi" onRetry={loadVenues} />
        </Card>
      ) : venues.length === 0 ? (
        <Card>
          {/* FIX (ux-polish): iconed empty state to match achievements/health-events/lab-values. */}
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="storefront-outline" size={26} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>Henüz kayıtlı mekan yok</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>Koçuna "Simit Sarayı'nda yedim" gibi yazdığında mekan otomatik öğrenilir.</Text>
          </View>
        </Card>
      ) : (
        venues.map(v => (
          <TouchableOpacity key={v.id} onLongPress={() => handleDelete(v.id)}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{v.venue_name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  {v.venue_type && <Text style={{ color: colors.primary, fontSize: FONT.xs }}>{TYPE_LABELS[v.venue_type] ?? v.venue_type}</Text>}
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{v.visit_count}x</Text>
                  {/* FIX (audit ui-destructive-delete): görünür/erişilebilir sil butonu; long-press kısayolu korundu. */}
                  <TouchableOpacity
                    onPress={() => handleDelete(v.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${v.venue_name} mekanını sil`}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={{ padding: SPACING.xs }}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
              {v.learned_items.length > 0 && (
                <View style={{ gap: 2 }}>
                  {v.learned_items.map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>{item.name}</Text>
                      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                        <Text style={{ color: colors.text, fontSize: FONT.sm }}>{item.calories} kcal</Text>
                        {item.confirmed && <Text style={{ color: colors.success, fontSize: FONT.xs }}>onaylı</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
