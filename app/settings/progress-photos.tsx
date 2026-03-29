/**
 * Progress Photos Screen
 * Spec 3.1: İlerleme fotoğrafı takibi
 *
 * Users can add body progress photos, compare before/after,
 * and optionally blur faces before sharing.
 * Photos are NEVER sent to AI — stored only on device / encrypted cloud.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Alert, RefreshControl } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface ProgressPhoto {
  id: string;
  photo_uri: string;
  taken_at: string;
  note: string | null;
}

export default function ProgressPhotosScreen() {
  const user = useAuthStore(s => s.user);
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);

  const fetchPhotos = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('progress_photos')
      .select('id, photo_uri, taken_at, note')
      .eq('user_id', user.id)
      .order('taken_at', { ascending: false });
    setPhotos((data ?? []) as ProgressPhoto[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  const addPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [3, 4],
    });

    if (result.canceled || !result.assets[0]) return;
    if (!user?.id) return;

    await supabase.from('progress_photos').insert({
      user_id: user.id,
      photo_uri: result.assets[0].uri,
      taken_at: new Date().toISOString(),
    });

    fetchPhotos();
  };

  const deletePhoto = (id: string) => {
    Alert.alert('Sil', 'Bu fotografi silmek istediginize emin misiniz?', [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        await supabase.from('progress_photos').delete().eq('id', id);
        fetchPhotos();
      }},
    ]);
  };

  const toggleSelect = (id: string) => {
    setSelectedPhotos(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const comparedPhotos = compareMode
    ? photos.filter(p => selectedPhotos.includes(p.id))
    : [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPhotos} tintColor={COLORS.primary} />}
    >
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text }}>Ilerleme Fotograflari</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.md }}>
        Fotograflar AI'a gonderilmez, sadece senin icin saklanir.
      </Text>

      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <Button title="Fotograf Ekle" onPress={addPhoto} style={{ flex: 1 }} />
        <Button
          title={compareMode ? 'Normal Gorunum' : 'Karsilastir'}
          variant="outline"
          onPress={() => { setCompareMode(!compareMode); setSelectedPhotos([]); }}
          style={{ flex: 1 }}
        />
      </View>

      {compareMode && (
        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>
            Karsilastirmak icin 2 fotograf sec:
          </Text>
          {comparedPhotos.length === 2 && (
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {comparedPhotos.map(p => (
                <View key={p.id} style={{ flex: 1 }}>
                  <Image source={{ uri: p.photo_uri }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode="cover" />
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs, textAlign: 'center' }}>
                    {new Date(p.taken_at).toLocaleDateString('tr-TR')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      {photos.length === 0 ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.lg }}>
            Henuz ilerleme fotografi yok. Ekle butonuna bas.
          </Text>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
          {photos.map(photo => (
            <TouchableOpacity
              key={photo.id}
              onLongPress={() => deletePhoto(photo.id)}
              onPress={() => compareMode ? toggleSelect(photo.id) : undefined}
              style={{
                width: '48%', borderRadius: 12, overflow: 'hidden',
                borderWidth: selectedPhotos.includes(photo.id) ? 2 : 0,
                borderColor: COLORS.primary,
              }}
            >
              <Image source={{ uri: photo.photo_uri }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
              <View style={{ padding: SPACING.xs, backgroundColor: COLORS.card }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
                  {new Date(photo.taken_at).toLocaleDateString('tr-TR')}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>
        Uzun bas: fotografi sil
      </Text>
    </ScrollView>
  );
}
