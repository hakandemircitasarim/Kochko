/**
 * Progress Photos Screen
 * Spec 3.1: İlerleme fotoğrafları - sadece kullanıcı cihazında/şifreli bulutta.
 * AI'a gönderilmez, üçüncü tarafla paylaşılmaz.
 */
import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, Alert, Dimensions, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { a11yImage, getContrastColor } from '@/lib/accessibility';

interface ProgressPhoto {
  id: string;
  user_id: string;
  storage_path: string;
  pose_type: string;
  angle: string | null;
  photo_date: string;
  note: string | null;
  created_at: string;
}

const POSE_TYPES = ['on', 'yan', 'arka'];
const screenWidth = Dimensions.get('window').width;

export default function ProgressPhotosScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPose, setSelectedPose] = useState<string>('on');
  const [showComparison, setShowComparison] = useState(false);

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('progress_photos').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.warn('progress_photos load failed', error);
        setPhotos((data ?? []) as ProgressPhoto[]);
        setLoading(false);
      });
  }, [user?.id]);

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('İzin Gerekli', 'Kamera izni verin.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      savePhoto(result.assets[0].uri);
    }
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      savePhoto(result.assets[0].uri);
    }
  };

  const savePhoto = async (uri: string) => {
    if (!user?.id) return;
    // Store locally - photos are NOT sent to AI (Spec 3.1).
    // storage_path holds the on-device URI; nothing is uploaded to cloud/AI.
    const { data, error } = await supabase.from('progress_photos').insert({
      user_id: user.id,
      storage_path: uri,
      pose_type: selectedPose,
      photo_date: new Date().toISOString().slice(0, 10),
      note: null,
    }).select('*').single();
    if (error) {
      Alert.alert('Kaydedilemedi', error.message);
      return;
    }
    if (data) setPhotos(prev => [data as ProgressPhoto, ...prev]);
  };

  const deletePhoto = (id: string) => {
    Alert.alert('Sil', 'Bu fotoğrafı silmek istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        await supabase.from('progress_photos').delete().eq('id', id);
        setPhotos(prev => prev.filter(p => p.id !== id));
      }},
    ]);
  };

  // Group by date for timeline
  const grouped = photos.reduce<Record<string, ProgressPhoto[]>>((acc, p) => {
    const date = p.photo_date.split('T')[0];
    (acc[date] ??= []).push(p);
    return acc;
  }, {});

  // Comparison: earliest vs latest photo for the selected pose
  const comparisonPhotos = useMemo(() => {
    const posePhotos = photos
      .filter(p => p.pose_type === selectedPose)
      .sort((a, b) => new Date(a.photo_date).getTime() - new Date(b.photo_date).getTime());
    if (posePhotos.length < 2) return null;
    return { earliest: posePhotos[0], latest: posePhotos[posePhotos.length - 1] };
  }, [photos, selectedPose]);

  const comparisonWidth = (screenWidth - SPACING.md * 2 - SPACING.sm) / 2;

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit ui-settings-duplicate-title): native header (settings/_layout.tsx) renders the title; in-body H1 removed as redundant. */}
      {/* FIX (audit diakritik-sweep): Türkçe diakritik geri yüklendi. */}
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.lg }}>
        Fotoğraflar sadece senin cihazında saklanır. AI'a veya üçüncü tarafa gönderilmez.
      </Text>

      {/* Pose Selection */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {POSE_TYPES.map(pose => (
          // FIX (audit ui-chip-a11y): seçilebilir poz chip'ine radio rolü + selected state + label.
          <TouchableOpacity key={pose} onPress={() => setSelectedPose(pose)}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedPose === pose }}
            accessibilityLabel={pose}
            style={{
              flex: 1, padding: SPACING.sm, borderRadius: 8, alignItems: 'center',
              backgroundColor: selectedPose === pose ? COLORS.primary : COLORS.card,
              borderWidth: 1, borderColor: selectedPose === pose ? COLORS.primary : COLORS.border,
            }}>
            {/* FIX (audit UI-DS-01): seçili poz metni '#fff' yerine getContrastColor(COLORS.primary) (siyah; teal üzerinde WCAG AA geçer, beyaz 3.39:1 idi). */}
            <Text style={{ color: selectedPose === pose ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600', textTransform: 'capitalize' }}>{pose}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Capture Buttons */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        <View style={{ flex: 1 }}>
          <Button title="Foto Çek" onPress={takePhoto} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Galeriden Seç" variant="outline" onPress={pickPhoto} />
        </View>
      </View>

      {/* Comparison Button */}
      {comparisonPhotos && (
        <View style={{ marginBottom: SPACING.lg }}>
          <Button title="Fotoğrafları Karşılaştır" variant="outline" onPress={() => setShowComparison(true)} />
        </View>
      )}

      {/* Comparison Modal - Photos NEVER sent to AI (privacy) */}
      <Modal visible={showComparison} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
            <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>Karşılaştırma ({selectedPose})</Text>
            <TouchableOpacity onPress={() => setShowComparison(false)}>
              <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>Kapat</Text>
            </TouchableOpacity>
          </View>
          {comparisonPhotos && (
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <View style={{ width: comparisonWidth }}>
                {/* FIX (audit ui-a11y-images): anlamlı <Image> etiketi. */}
                <Image source={{ uri: comparisonPhotos.earliest.storage_path }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }} {...a11yImage(`Başlangıç fotoğrafı, ${new Date(comparisonPhotos.earliest.photo_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}`)} />
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xs }}>
                  {new Date(comparisonPhotos.earliest.photo_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center' }}>Başlangıç</Text>
              </View>
              <View style={{ width: comparisonWidth }}>
                {/* FIX (audit ui-a11y-images): anlamlı <Image> etiketi. */}
                <Image source={{ uri: comparisonPhotos.latest.storage_path }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }} {...a11yImage(`Güncel fotoğraf, ${new Date(comparisonPhotos.latest.photo_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}`)} />
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.xs }}>
                  {new Date(comparisonPhotos.latest.photo_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center' }}>Güncel</Text>
              </View>
            </View>
          )}
          <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.lg }}>
            Bu fotoğraflar AI'a gönderilmez ve üçüncü taraflarla paylaşılmaz.
          </Text>
        </View>
      </Modal>

      {/* Timeline */}
      {Object.entries(grouped).map(([date, datePhotos]) => (
        <View key={date} style={{ marginBottom: SPACING.lg }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.sm }}>
            {new Date(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {datePhotos.map(photo => (
              <TouchableOpacity key={photo.id} onLongPress={() => deletePhoto(photo.id)}
                style={{ width: (screenWidth - SPACING.md * 2 - SPACING.sm * 2) / 3, borderRadius: 8, overflow: 'hidden' }}>
                {/* FIX (audit ui-a11y-images): anlamlı <Image> etiketi. */}
                <Image source={{ uri: photo.storage_path }} style={{ width: '100%', aspectRatio: 3 / 4 }} {...a11yImage(`${photo.pose_type} pozu`)} />
                {/* FIX (audit ui-destructive-delete): görünür/erişilebilir sil butonu (Alert onaylı); long-press kısayolu korundu. */}
                <TouchableOpacity
                  onPress={() => deletePhoto(photo.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${photo.pose_type} pozu fotoğrafını sil`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="trash-outline" size={15} color="#fff" />
                </TouchableOpacity>
                <Text style={{ color: COLORS.textMuted, fontSize: 9, textAlign: 'center', marginTop: 2, textTransform: 'capitalize' }}>{photo.pose_type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {photos.length === 0 && !loading && (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>
            Henüz ilerleme fotoğrafı yok. Düzenli foto çekerek değişimini takip et.
          </Text>
        </Card>
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Sil butonuna dokun veya uzun bas</Text>
    </ScrollView>
  );
}
