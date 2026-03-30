/**
 * Progress Photos Screen
 * Spec 3.1: İlerleme fotoğrafları - sadece kullanıcı cihazında/şifreli bulutta.
 * AI'a gönderilmez, üçüncü tarafla paylaşılmaz.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, Alert, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface ProgressPhoto {
  id: string;
  photo_uri: string;
  pose_type: string;
  taken_at: string;
  notes: string | null;
}

const POSE_TYPES = ['on', 'yan', 'arka'];
const screenWidth = Dimensions.get('window').width;

export default function ProgressPhotosScreen() {
  const user = useAuthStore(s => s.user);
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPose, setSelectedPose] = useState<string>('on');

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('progress_photos').select('*').eq('user_id', user.id)
      .order('taken_at', { ascending: false })
      .then(({ data }) => {
        setPhotos((data ?? []) as ProgressPhoto[]);
        setLoading(false);
      });
  }, [user?.id]);

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Izin Gerekli', 'Kamera izni verin.');
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
    // Store locally - photos are NOT sent to AI (Spec 3.1)
    const newPhoto: Omit<ProgressPhoto, 'id'> & { user_id: string } = {
      user_id: user.id,
      photo_uri: uri,
      pose_type: selectedPose,
      taken_at: new Date().toISOString(),
      notes: null,
    };

    const { data } = await supabase.from('progress_photos').insert(newPhoto).select('*').single();
    if (data) setPhotos(prev => [data as ProgressPhoto, ...prev]);
  };

  const deletePhoto = (id: string) => {
    Alert.alert('Sil', 'Bu fotoğrafı silmek istiyor musun?', [
      { text: 'Iptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        await supabase.from('progress_photos').delete().eq('id', id);
        setPhotos(prev => prev.filter(p => p.id !== id));
      }},
    ]);
  };

  // Group by date for timeline
  const grouped = photos.reduce<Record<string, ProgressPhoto[]>>((acc, p) => {
    const date = p.taken_at.split('T')[0];
    (acc[date] ??= []).push(p);
    return acc;
  }, {});

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Ilerleme Fotograflari</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.lg }}>
        Fotograflar sadece senin cihazinda saklanir. AI'a veya ucuncu tarafa gonderilmez.
      </Text>

      {/* Pose Selection */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {POSE_TYPES.map(pose => (
          <TouchableOpacity key={pose} onPress={() => setSelectedPose(pose)}
            style={{
              flex: 1, padding: SPACING.sm, borderRadius: 8, alignItems: 'center',
              backgroundColor: selectedPose === pose ? COLORS.primary : COLORS.card,
              borderWidth: 1, borderColor: selectedPose === pose ? COLORS.primary : COLORS.border,
            }}>
            <Text style={{ color: selectedPose === pose ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600', textTransform: 'capitalize' }}>{pose}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Capture Buttons */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        <View style={{ flex: 1 }}>
          <Button title="Foto Cek" onPress={takePhoto} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Galeriden Sec" variant="outline" onPress={pickPhoto} />
        </View>
      </View>

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
                <Image source={{ uri: photo.photo_uri }} style={{ width: '100%', aspectRatio: 3 / 4 }} />
                <Text style={{ color: COLORS.textMuted, fontSize: 9, textAlign: 'center', marginTop: 2, textTransform: 'capitalize' }}>{photo.pose_type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {photos.length === 0 && !loading && (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>
            Henuz ilerleme fotoğrafı yok. Duzenlı foto cekerek degisimini takip et.
          </Text>
        </Card>
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Uzun bas: sil</Text>
    </ScrollView>
  );
}
