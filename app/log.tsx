/**
 * Quick Log Modal — opened from center FAB
 * All data entry starts here: text, photo, barcode, voice, water, weight, sleep, workout
 */
import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { sendMessage } from '@/services/chat.service';
import { lookupBarcode } from '@/services/barcode.service';
import { startRecording, stopRecording, transcribeAudio } from '@/services/voice.service';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';

type Screen = 'main' | 'barcode' | 'voice' | 'weight' | 'sleep';

export default function QuickLogScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const { fetchToday, addWater, waterLiters } = useDashboardStore();
  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const waterTarget = (profile?.water_target_liters ?? 2.5) as number;

  const [screen, setScreen] = useState<Screen>('main');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  // Barcode state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeResult, setBarcodeResult] = useState<string | null>(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Weight state
  const [weightInput, setWeightInput] = useState('');

  // Sleep state
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');

  const handleLog = async () => {
    if (!text.trim() || !user?.id) return;
    setLoading(true);
    try {
      const { error } = await sendMessage(text.trim());
      if (error) Alert.alert('Hata', error);
      else { await fetchToday(user.id); router.back(); }
    } catch { Alert.alert('Hata', 'Bir sorun oluştu.'); }
    finally { setLoading(false); }
  };

  const handlePhoto = async () => {
    // Navigate to chat with camera — chat.tsx handles photo capture + send
    router.back();
    setTimeout(() => router.push({ pathname: '/(tabs)/chat', params: { openCamera: 'true' } }), 100);
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (barcodeLoading || scannedBarcode === barcode) return;
    setScannedBarcode(barcode);
    setBarcodeLoading(true);
    try {
      const result = await lookupBarcode(barcode, user?.id);
      if (result.found && result.product_name) {
        setBarcodeResult(`${result.product_name} (${result.calories_per_100g} kcal/100g)`);
        // Send to AI coach for logging
        const msg = `Barkod: ${barcode} - ${result.product_name}, ${result.calories_per_100g} kcal/100g, P:${result.protein_per_100g}g K:${result.carbs_per_100g}g Y:${result.fat_per_100g}g (porsiyon: ${result.serving_size_g}g)`;
        await sendMessage(msg);
        if (user?.id) await fetchToday(user.id);
        setTimeout(() => { router.back(); }, 1500);
      } else {
        setBarcodeResult('Ürün bulunamadı. Koçuna yazarak bildir.');
      }
    } catch { setBarcodeResult('Barkod okunamadı.'); }
    finally { setBarcodeLoading(false); }
  };

  const handleVoiceToggle = async () => {
    if (isRecording) {
      setIsRecording(false);
      setTranscribing(true);
      const uri = await stopRecording();
      if (uri) {
        const transcribed = await transcribeAudio(uri);
        if (transcribed) {
          setText(transcribed);
          setScreen('main');
        } else {
          Alert.alert('Hata', 'Ses tanıma başarısız.');
        }
      }
      setTranscribing(false);
    } else {
      const ok = await startRecording();
      if (ok) setIsRecording(true);
      else Alert.alert('İzin gerekli', 'Mikrofon izni ver.');
    }
  };

  const handleWaterAdd = () => {
    if (!user?.id) return;
    const newTotal = waterLiters + WATER_INCREMENT;
    const warning = checkSuspiciousInput('water', newTotal);
    if (warning) {
      Alert.alert('Doğrulama', warning, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet', onPress: () => { addWater(user.id, WATER_INCREMENT, dayBoundaryHour); router.back(); } },
      ]);
    } else {
      addWater(user.id, WATER_INCREMENT, dayBoundaryHour);
      router.back();
    }
  };

  const handleWeightSave = async () => {
    const w = parseFloat(weightInput.replace(',', '.'));
    if (!w || w < 20 || w > 300 || !user?.id) return;
    const date = getEffectiveDate(new Date(), dayBoundaryHour);
    await supabase.from('daily_metrics').upsert(
      { user_id: user.id, date, weight_kg: w, synced: true },
      { onConflict: 'user_id,date' }
    );
    await supabase.from('weight_logs').insert({ user_id: user.id, weight_kg: w, logged_at: new Date().toISOString() });
    await fetchToday(user.id);
    router.back();
  };

  const handleSleepSave = async () => {
    if (!sleepTime || !wakeTime || !user?.id) return;
    // Calculate hours
    const [sh, sm] = sleepTime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    let sleepMin = sh * 60 + sm;
    let wakeMin = wh * 60 + wm;
    if (wakeMin <= sleepMin) wakeMin += 24 * 60;
    const hours = Math.round(((wakeMin - sleepMin) / 60) * 10) / 10;
    if (hours < 0.5 || hours > 18) return Alert.alert('Hata', 'Geçersiz uyku süresi.');

    const date = getEffectiveDate(new Date(), dayBoundaryHour);
    await supabase.from('daily_metrics').upsert(
      { user_id: user.id, date, sleep_hours: hours, sleep_time: sleepTime, wake_time: wakeTime, synced: true },
      { onConflict: 'user_id,date' }
    );
    await fetchToday(user.id);
    router.back();
  };

  // ====== BARCODE SCREEN ======
  if (screen === 'barcode') {
    if (!cameraPermission?.granted) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
          <Text style={{ color: colors.text, fontSize: 14, textAlign: 'center', marginBottom: SPACING.md }}>Barkod taramak için kamera izni gerekli</Text>
          <TouchableOpacity onPress={requestCameraPermission} style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>İzin ver</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen('main')} style={{ marginTop: SPACING.md }}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Geri</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          onBarcodeScanned={(e) => handleBarcodeScan(e.data)}
        />
        {/* Overlay */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.xl, paddingTop: 60 }}>
            <TouchableOpacity onPress={() => { setScreen('main'); setScannedBarcode(null); setBarcodeResult(null); }}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Barkod Tara</Text>
            <View style={{ width: 28 }} />
          </View>
          {/* Result banner */}
          <View style={{ padding: SPACING.xl, paddingBottom: 60 }}>
            {barcodeLoading && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.md, padding: SPACING.lg, alignItems: 'center' }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, marginTop: SPACING.sm }}>Ürün aranıyor...</Text>
              </View>
            )}
            {barcodeResult && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.md, padding: SPACING.lg }}>
                <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center' }}>{barcodeResult}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  // ====== VOICE SCREEN ======
  if (screen === 'voice') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity onPress={() => { setScreen('main'); setIsRecording(false); }} style={{ position: 'absolute', top: 60, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>

        {transcribing ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: SPACING.md }}>Ses tanınıyor...</Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              onPress={handleVoiceToggle}
              style={{
                width: 96, height: 96, borderRadius: 48,
                backgroundColor: isRecording ? colors.error : colors.pink,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: SPACING.xxl,
              }}
            >
              <Ionicons name={isRecording ? 'stop' : 'mic'} size={40} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: SPACING.sm }}>
              {isRecording ? 'Dinliyorum...' : 'Konuşmaya başla'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
              {isRecording ? 'Bitirince butona tekrar bas' : 'Örnek: "Öğlen yemekte 1 porsiyon mercimek çorbası, pilav ve ayran içtim"'}
            </Text>
          </>
        )}
      </View>
    );
  }

  // ====== WEIGHT SCREEN ======
  if (screen === 'weight') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity onPress={() => setScreen('main')} style={{ position: 'absolute', top: 60, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.pink + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
          <Ionicons name="scale" size={24} color={colors.pink} />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: SPACING.xxl }}>Tartı Kaydı</Text>
        <TextInput
          style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg,
            color: colors.text, fontSize: 28, fontWeight: '700',
            textAlign: 'center', width: '70%', borderWidth: 0.5, borderColor: colors.border,
          }}
          placeholder="73.5" placeholderTextColor={colors.textMuted}
          value={weightInput} onChangeText={setWeightInput}
          keyboardType="decimal-pad" autoFocus
        />
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: SPACING.xs, marginBottom: SPACING.xxl }}>kg</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '70%' }}>
          <TouchableOpacity onPress={() => setScreen('main')} style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>İptal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleWeightSave} style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Kaydet</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== SLEEP SCREEN ======
  if (screen === 'sleep') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity onPress={() => setScreen('main')} style={{ position: 'absolute', top: 60, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.purple + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
          <Ionicons name="moon" size={24} color={colors.purple} />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: SPACING.xxl }}>Uyku Kaydı</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '80%', marginBottom: SPACING.xxl }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginBottom: SPACING.sm }}>Yatış</Text>
            <TextInput
              style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, color: colors.text, fontSize: 20, fontWeight: '600', textAlign: 'center', borderWidth: 0.5, borderColor: colors.border }}
              placeholder="23:00" placeholderTextColor={colors.textMuted}
              value={sleepTime} onChangeText={setSleepTime} keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginBottom: SPACING.sm }}>Kalkış</Text>
            <TextInput
              style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg, color: colors.text, fontSize: 20, fontWeight: '600', textAlign: 'center', borderWidth: 0.5, borderColor: colors.border }}
              placeholder="07:00" placeholderTextColor={colors.textMuted}
              value={wakeTime} onChangeText={setWakeTime} keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '80%' }}>
          <TouchableOpacity onPress={() => setScreen('main')} style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>İptal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSleepSave} style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Kaydet</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== MAIN SCREEN ======
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xxl }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Kayıt ekle</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Input methods card */}
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.xxl }}>
        {[
          { icon: 'create-outline' as const, title: 'Yazarak gir', desc: '2 yumurta, peynir, ekmek yedim', color: colors.primary, onPress: () => { router.back(); setTimeout(() => router.push('/(tabs)/chat'), 100); } },
          { icon: 'camera-outline' as const, title: 'Fotoğraf çek', desc: 'Tabağını fotoğrafla, AI tanısın', color: colors.protein, onPress: handlePhoto },
          { icon: 'barcode-outline' as const, title: 'Barkod okut', desc: 'Paketli ürünü tara', color: colors.carbs, onPress: () => setScreen('barcode') },
          { icon: 'mic-outline' as const, title: 'Sesli giriş', desc: 'Konuşarak kayıt gir', color: colors.pink, onPress: () => setScreen('voice') },
        ].map((method, i) => (
          <TouchableOpacity
            key={i} onPress={method.onPress}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md,
              borderBottomWidth: i < 3 ? 0.5 : 0, borderBottomColor: colors.border,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: method.color + '18', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={method.icon} size={18} color={method.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>{method.title}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 1 }}>{method.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Quick text input */}
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
        Hızlı kayıt
      </Text>
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, marginBottom: SPACING.xxl }}>
        <TextInput
          style={{ color: colors.text, fontSize: 13, minHeight: 50, textAlignVertical: 'top' }}
          placeholder="Örnek: 2 dilim ekmek, 1 yumurta, çay"
          placeholderTextColor={colors.textMuted}
          value={text} onChangeText={setText} multiline maxLength={2000}
        />
        {text.trim() ? (
          <TouchableOpacity onPress={handleLog} disabled={loading}
            style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.md, opacity: loading ? 0.5 : 1 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Other entries — 2x2 grid */}
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
        Diğer kayıtlar
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {[
          { icon: 'barbell-outline' as const, label: 'Antrenman', color: colors.purple, onPress: () => { router.back(); setTimeout(() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Antrenman yaptım: ' } }), 100); } },
          { icon: 'scale-outline' as const, label: 'Tartı', color: colors.pink, onPress: () => setScreen('weight') },
          { icon: 'moon-outline' as const, label: 'Uyku', color: colors.purple, onPress: () => setScreen('sleep') },
          { icon: 'water-outline' as const, label: 'Su (+0.25L)', color: colors.protein, onPress: handleWaterAdd },
        ].map((action, i) => (
          <TouchableOpacity key={i} onPress={action.onPress}
            style={{ width: '48%', backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, alignItems: 'center', gap: SPACING.sm }}>
            <Ionicons name={action.icon} size={24} color={action.color} />
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
