/**
 * Quick Log Modal — opened from center FAB
 * All data entry starts here: text, photo, barcode, voice, water, weight, sleep, workout
 */
import { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Modal, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendMessage, queueMessageOffline, type ChatResponse } from '@/services/chat.service';
import { lookupBarcode, calculateServing, type BarcodeResult } from '@/services/barcode.service';
import { updateCurrentWeight } from '@/services/weight.service';
import { isOnline } from '@/services/offline-queue.service';
import { startRecording, stopRecording, transcribeAudio } from '@/services/voice.service';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';

type Screen = 'main' | 'barcode' | 'voice' | 'weight' | 'sleep' | 'recovery';

// daily_metrics.muscle_soreness is CHECK-constrained to these text values.
const SORENESS_LEVELS = [
  { value: 1, label: 'Yok', dbValue: 'none' },
  { value: 2, label: 'Hafif', dbValue: 'light' },
  { value: 3, label: 'Orta', dbValue: 'moderate' },
  { value: 4, label: 'Şiddetli', dbValue: 'severe' },
] as const;

// FIX (audit HIGH: sahte başarı): koçun yanıtı yalnızca KALICI bir aksiyon çalıştırdıysa
// "kayıt" sayılır. Rate-limit reddi veya netleştirme sorusu 'Kaydın eklendi!' toast'ıyla
// kapanamaz — öğün sessizce kayboluyordu. Tipler ai-chat aksiyon switch'inin yazan dallarıyla eş.
const PERSIST_ACTION_TYPES = new Set([
  'meal_log', 'workout_log', 'weight_log', 'water_log', 'sleep_log', 'mood_log',
  'supplement_log', 'venue_log', 'health_event', 'life_event', 'lab_value',
  'food_preference', 'profile_update', 'commitment', 'save_recipe', 'constraint_confirm',
]);
function hasPersistedAction(data: ChatResponse | null): boolean {
  // feedback şartı (review fix): sunucu başarısız/dupe-skip yazımlarda aksiyonu
  // feedback=null ile döndürür — tip tek başına "kaydedildi" kanıtı değil.
  return !!data?.actions?.some(a => PERSIST_ACTION_TYPES.has(a.type) && !!a.feedback);
}

export default function QuickLogScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const { fetchToday, addWater, waterLiters } = useDashboardStore();
  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const waterTarget = (profile?.water_target_liters ?? 2.5) as number;

  const [screen, setScreen] = useState<Screen>('main');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  // Which main-screen quick action is mid-navigation — gives the tapped row a
  // brief busy state so it doesn't look dead while the modal-dismiss + tab-open
  // round-trip resolves on slower devices.
  const [navigatingIndex, setNavigatingIndex] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #ux-regression: a returning/interrupted navigation must not leave the grid permanently
  // disabled (navigatingIndex stuck). Reset whenever the modal regains focus.
  useFocusEffect(useCallback(() => { setNavigatingIndex(null); }, []));

  // Barcode state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeResult, setBarcodeResult] = useState<string | null>(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  // FIX (audit HIGH: porsiyon): bulunan ürün önce burada bekler — gram seçilmeden mesaj gitmez.
  const [pendingProduct, setPendingProduct] = useState<{ barcode: string; result: BarcodeResult } | null>(null);
  const [customGrams, setCustomGrams] = useState('');
  const [showCustomGrams, setShowCustomGrams] = useState(false);

  // FIX (audit: çift yazı yolu): 'Yazarak gir' artık sohbete ışınlamaz, buradaki
  // Hızlı kayıt alanına odaklanır — tek kanonik yazı yolu.
  const quickInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const quickInputY = useRef(0);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Weight state
  const [weightInput, setWeightInput] = useState('');

  // Sleep state
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');

  // Recovery state (Spec 3.1 — muscle soreness + recovery feel)
  const [soreness, setSoreness] = useState<number | null>(null);
  const [recoveryScore, setRecoveryScore] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Single shared mutex — prevents two handlers firing at once (e.g. double-tap
  // the FAB, or tapping Save + Water before the first finishes).
  const submittingRef = useRef(false);
  // Scale-spring for the success checkmark (matches the chat SavedBadge reward language).
  const successScale = useRef(new Animated.Value(0.6)).current;

  const showSuccessAndClose = (msg: string) => {
    haptics.success();
    setSuccessMsg(msg);
    successScale.setValue(0.6);
    Animated.spring(successScale, {
      toValue: 1,
      friction: 4,
      tension: 130,
      useNativeDriver: true,
    }).start();
    // #ux-regression: keep the timer id so a tap on the toast can cancel it — otherwise the
    // tap's router.back() runs immediately AND the orphaned timer fires a SECOND back ~1.2s later.
    closeTimer.current = setTimeout(() => { setSuccessMsg(null); router.back(); }, 1200);
  };

  const handleLog = async () => {
    if (!text.trim() || !user?.id || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const { data, error } = await sendMessage(text.trim());
      if (error) { haptics.error(); Alert.alert('Kayıt eklenemedi', error); }
      // FIX (audit HIGH: sahte başarı): hatasız her yanıt başarı sayılıyordu — koç rate-limit'e
      // takılsa ya da yalnızca soru sorsa bile 'Kaydın eklendi!' deyip kapanıyor, öğün sessizce
      // kayboluyordu. Artık yanıtta gerçekten yazan bir aksiyon arıyoruz.
      else if (data?.rate_limited) {
        haptics.error();
        Alert.alert('Kaydedilemedi', data.message?.trim()
          ? data.message.trim().slice(0, 300)
          : 'Çok hızlı gidiyorsun — birazdan tekrar dene. Yazdıkların duruyor.');
      }
      else if (!hasPersistedAction(data)) {
        // Koç kaydetmek yerine yanıt verdi / soru sordu — konuşma sohbette devam ediyor.
        // Mesaj thread'e zaten gitti; metni temizle ki ikinci Kaydet çift göndermesin.
        haptics.tap();
        Alert.alert(
          'Koç bir şey sordu',
          data?.message?.trim()
            ? data.message.trim().slice(0, 300)
            : 'Koç kaydetmeden önce bir şey sormak istiyor — sohbete bak.',
          [
            { text: 'Sohbete git', onPress: () => { setText(''); router.dismissTo('/(tabs)/chat'); } },
            { text: 'Kapat', style: 'cancel', onPress: () => setText('') },
          ],
        );
      }
      // FIX (audit UX-FBK-06 + yavaş success): toast, gönderim onaylanır onaylanmaz gelir;
      // fetchToday await edilmeden arka planda tazeler.
      else {
        showSuccessAndClose('Kaydın eklendi!');
        fetchToday(user.id, dayBoundaryHour).catch(() => {});
      }
    } catch (err) {
      haptics.error();
      const detail = err instanceof Error ? err.message : 'Bilinmeyen hata';
      Alert.alert(
        'Kayıt eklenemedi',
        `İnternet bağlantını kontrol et ve tekrar dene.\n\nDetay: ${detail}`,
        [
          { text: 'Kapat', style: 'cancel' },
          { text: 'Tekrar dene', onPress: () => { void handleLog(); } },
        ],
      );
    }
    finally { submittingRef.current = false; setLoading(false); }
  };

  const handlePhoto = () => {
    // Dismiss this modal and jump to the chat tab in one router intent — two
    // separate calls race with the modal dismissal animation on slower devices.
    router.dismissTo({ pathname: '/(tabs)/chat', params: { openCamera: 'true' } });
  };

  const handleBarcodeScan = async (barcode: string) => {
    // Ref gate: CameraView fires onBarcodeScanned many times per second; the
    // state-based scannedBarcode check has a brief race window on the first
    // frame. Ref is synchronous.
    if (submittingRef.current || pendingProduct || scannedBarcode === barcode) return;
    submittingRef.current = true;
    setScannedBarcode(barcode);
    setBarcodeLoading(true);
    try {
      const result = await lookupBarcode(barcode, user?.id);
      if (result.found && result.product_name) {
        // FIX (audit HIGH: porsiyon): 100g değerlerini porsiyon sormadan göndermek yerine
        // önce tek dokunuşluk porsiyon seçimi ("porsiyon: nullg" ihtimali dahil öldü).
        // Gönderim + doğrulama sendBarcodeLog'da; log onaylanana kadar ekran açık kalır.
        setBarcodeResult(null);
        setPendingProduct({ barcode, result });
      } else if (result.network_error) {
        // FIX (audit: çevrimdışı kopya yalanı): ürün önbellekte de yok — kuyruklanacak besin
        // verisi olmadığından (sunucu barkodu tek başına çözemez) dürüstçe söyle.
        setScannedBarcode(null); // bağlanınca aynı ürünü yeniden taramaya izin ver
        setBarcodeResult('İnternet yok ve bu ürün çevrimdışı kayıtlı değil. Bağlanınca tekrar tara veya "Yazarak gir" ile manuel kaydet.');
      } else {
        setBarcodeResult('Ürün veritabanında bulunamadı. "Yazarak gir" ile manuel kaydedebilirsin.');
      }
    } catch (err) {
      console.warn('[log] barcode lookup failed', err);
      const offline = err instanceof Error && /network|fetch/i.test(err.message);
      setScannedBarcode(null);
      setBarcodeResult(offline
        ? 'İnternet yok ve bu ürün çevrimdışı kayıtlı değil. Bağlanınca tekrar tara veya "Yazarak gir" ile manuel kaydet.'
        : 'Barkod okunamadı. Kamerayı temiz tut ve barkodu net göster, veya "Yazarak gir" ile manuel kaydet.');
    }
    finally { submittingRef.current = false; setBarcodeLoading(false); }
  };

  const resetBarcodeState = () => {
    setPendingProduct(null);
    setShowCustomGrams(false);
    setCustomGrams('');
    setScannedBarcode(null);
    setBarcodeResult(null);
  };

  // Porsiyon seçildikten sonra gönderir. Gram HER ZAMAN mesajda açıkça yazılır; log
  // sunucuda gerçekten işlenmeden ekran kapanmaz (sahte-başarı kuralının aynısı).
  const sendBarcodeLog = async (grams: number) => {
    if (!pendingProduct || submittingRef.current) return;
    const g = Math.round(grams);
    if (!Number.isFinite(g) || g <= 0 || g > 5000) {
      haptics.error();
      Alert.alert('Geçersiz gramaj', '1–5000 g arası bir değer gir.');
      return;
    }
    submittingRef.current = true;
    setBarcodeLoading(true);
    try {
      const { barcode, result } = pendingProduct;
      const serving = calculateServing(result, g);
      const msg = serving
        ? `Barkod: ${barcode} - ${result.product_name}, ${g} g yedim. Bu porsiyon: ${serving.calories} kcal, P:${serving.protein_g}g K:${serving.carbs_g}g Y:${serving.fat_g}g.`
        : `Barkod: ${barcode} - ${result.product_name}, ${g} g yedim. Besin değerleri veritabanında eksik, tahminle kaydeder misin?`;

      // FIX (audit: çevrimdışı kopya yalanı): bağlantı yoksa mesaj GERÇEKTEN kuyruğa girer;
      // reconnect'te processOfflineQueue otomatik gönderir. Eski kopya bunu vadedip hiçbir
      // şey kuyruklamıyordu.
      if (!(await isOnline())) {
        await queueMessageOffline(msg);
        resetBarcodeState();
        setScreen('main');
        showSuccessAndClose('Çevrimdışı — bağlanınca eklenecek!');
        return;
      }

      const { data, error: sendErr } = await sendMessage(msg);
      if (sendErr) {
        setBarcodeResult('Kayıt eklenemedi: ' + sendErr); // pendingProduct durur → tekrar denenebilir
        return; // finally{} resets submittingRef + barcodeLoading
      }
      if (data?.rate_limited) {
        setBarcodeResult(data.message?.trim()
          ? data.message.trim().slice(0, 200)
          : 'Çok hızlı gidiyorsun — birazdan tekrar dene.');
        return;
      }
      if (!hasPersistedAction(data)) {
        // Koç kaydetmek yerine soru sordu — konuşma sohbette devam ediyor.
        resetBarcodeState();
        Alert.alert(
          'Koç bir şey sordu',
          data?.message?.trim()
            ? data.message.trim().slice(0, 300)
            : 'Koç kaydetmeden önce bir şey sormak istiyor — sohbete bak.',
          [
            { text: 'Sohbete git', onPress: () => router.dismissTo('/(tabs)/chat') },
            { text: 'Kapat', style: 'cancel' },
          ],
        );
        return;
      }
      resetBarcodeState();
      setScreen('main'); // success toast main render dalında yaşar
      showSuccessAndClose('Kaydın eklendi!');
      if (user?.id) fetchToday(user.id, dayBoundaryHour).catch(() => {});
    } finally { submittingRef.current = false; setBarcodeLoading(false); }
  };

  const handleVoiceToggle = async () => {
    if (isRecording) {
      setIsRecording(false);
      setTranscribing(true);
      const uri = await stopRecording();
      if (uri) {
        const { text: transcribed, premiumRequired } = await transcribeAudio(uri);
        if (premiumRequired) {
          Alert.alert('Premium özellik', 'Sesli giriş Premium bir özellik. Premium\'a geçince sesle de kayıt yapabilirsin.');
        } else if (transcribed) {
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
    if (!user?.id || submittingRef.current) return;
    const newTotal = waterLiters + WATER_INCREMENT;
    const warning = checkSuspiciousInput('water', newTotal);
    const doAdd = async () => {
      submittingRef.current = true;
      try {
        await addWater(user.id, WATER_INCREMENT, dayBoundaryHour);
        showSuccessAndClose('Su eklendi!');
      } catch {
        Alert.alert('Hata', 'Su eklenemedi. Tekrar dene.');
      } finally {
        submittingRef.current = false;
      }
    };
    if (warning) {
      Alert.alert('Doğrulama', warning, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet', onPress: () => { void doAdd(); } },
      ]);
    } else {
      void doAdd();
    }
  };

  const handleWeightSave = async () => {
    if (submittingRef.current) return;
    const w = parseFloat(weightInput.replace(',', '.'));
    if (!user?.id) return;
    // FIX (audit Wave3): inline feedback for invalid weight instead of a silent return (matches the
    // edit-profile rangeError pattern + handleSleepSave's Alert).
    if (!w || w < 20 || w > 300) { haptics.error(); return Alert.alert('Geçersiz kilo', '20–300 kg arası bir değer gir.'); }
    submittingRef.current = true;
    setLoading(true);
    try {
      // FIX (audit: kilo split-brain): tek yazım yolu — updateCurrentWeight hem bugünün
      // daily_metrics satırını hem profiles.weight_kg'yi günceller. Eskiden yalnız
      // daily_metrics yazılıyordu; canlıda Profil 80 gösterirken dashboard 79.5 gösterdi.
      await updateCurrentWeight(user.id, w, dayBoundaryHour);
      showSuccessAndClose('Kilo kaydedildi!');
      // Toast'ı bekletme — store tazelemeleri arka planda.
      fetchToday(user.id, dayBoundaryHour).catch(() => {});
      void useProfileStore.getState().fetch(user.id);
    } catch {
      Alert.alert('Hata', 'Kilo kaydedilemedi. Tekrar dene.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleRecoverySave = async () => {
    if (submittingRef.current) return;
    if (!user?.id || (soreness === null && recoveryScore === null)) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const date = getEffectiveDate(new Date(), dayBoundaryHour);
      const payload: Record<string, unknown> = { user_id: user.id, date, synced: true };
      if (soreness !== null) {
        payload.muscle_soreness = SORENESS_LEVELS.find(s => s.value === soreness)?.dbValue ?? 'none';
      }
      if (recoveryScore !== null) payload.recovery_score = recoveryScore;
      const { error } = await supabase.from('daily_metrics').upsert(payload, { onConflict: 'user_id,date' });
      if (error) throw error;
      await fetchToday(user.id, dayBoundaryHour);
      showSuccessAndClose('Toparlanma kaydedildi!');
    } catch {
      Alert.alert('Hata', 'Toparlanma kaydedilemedi. Tekrar dene.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSleepSave = async () => {
    if (submittingRef.current) return;
    if (!sleepTime || !wakeTime || !user?.id) return;
    const [sh, sm] = sleepTime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(wh) || !Number.isFinite(wm)) {
      // FIX (audit Wave3): restore Turkish diacritics.
      return Alert.alert('Hata', 'Saat formatı geçersiz. Örnek: 23:00');
    }
    let sleepMin = sh * 60 + sm;
    let wakeMin = wh * 60 + wm;
    if (wakeMin <= sleepMin) wakeMin += 24 * 60;
    const hours = Math.round(((wakeMin - sleepMin) / 60) * 10) / 10;
    if (hours < 0.5 || hours > 18) return Alert.alert('Hata', 'Geçersiz uyku süresi.');

    submittingRef.current = true;
    setLoading(true);
    try {
      const date = getEffectiveDate(new Date(), dayBoundaryHour);
      const { error } = await supabase.from('daily_metrics').upsert(
        { user_id: user.id, date, sleep_hours: hours, sleep_time: sleepTime, wake_time: wakeTime, synced: true },
        { onConflict: 'user_id,date' }
      );
      if (error) throw error;
      await fetchToday(user.id, dayBoundaryHour);
      showSuccessAndClose('Uyku kaydedildi!');
    } catch {
      Alert.alert('Hata', 'Uyku kaydedilemedi. Tekrar dene.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // ====== BARCODE SCREEN ======
  if (screen === 'barcode') {
    if (!cameraPermission?.granted) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
          <Text style={{ color: colors.text, fontSize: FONT.md, textAlign: 'center', marginBottom: SPACING.md }}>Barkod taramak için kamera izni gerekli</Text>
          <TouchableOpacity onPress={requestCameraPermission} accessibilityRole="button" accessibilityLabel="İzin ver" style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl }}>
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>İzin ver</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen('main')} accessibilityRole="button" accessibilityLabel="Geri" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginTop: SPACING.md }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>Geri</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          // Porsiyon seçimi beklerken yeni taramaları yut — chooser üstüne ikinci ürün binmesin.
          onBarcodeScanned={(e) => { if (!pendingProduct) void handleBarcodeScan(e.data); }}
        />
        {/* Scan-guide frame: a raw camera feed gives the user no sense of where to
            aim. A centered reticle + hint is the standard barcode affordance. Hidden
            once a product is found / while saving so it never sits under the chooser.
            pointerEvents=none so it never intercepts a tap. */}
        {!pendingProduct && !barcodeLoading && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 260, height: 150, borderRadius: RADIUS.lg, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(255,255,255,0.04)' }} />
            <Text style={{ color: '#fff', fontSize: FONT.sm, marginTop: SPACING.md, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>
              Barkodu çerçeveye hizala
            </Text>
          </View>
        )}
        {/* Overlay */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.xl, paddingTop: insets.top + 12 }}>
            <TouchableOpacity
              onPress={() => { setScreen('main'); resetBarcodeState(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: FONT.lg, fontWeight: '600' }}>Barkod Tara</Text>
            <View style={{ width: 28 }} />
          </View>
          {/* Result banner / portion chooser */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ padding: SPACING.xl, paddingBottom: insets.bottom + 24 }}>
            {barcodeLoading && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.md, padding: SPACING.lg, alignItems: 'center' }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: '#fff', fontSize: FONT.sm, marginTop: SPACING.sm }}>
                  {pendingProduct ? 'Kaydediliyor...' : 'Ürün aranıyor...'}
                </Text>
              </View>
            )}
            {/* FIX (audit HIGH: porsiyon): göndermeden önce tek dokunuşluk porsiyon seçimi */}
            {pendingProduct && !barcodeLoading && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: RADIUS.md, padding: SPACING.lg }}>
                <Text style={{ color: '#fff', fontSize: FONT.md, fontWeight: '600', textAlign: 'center' }}>
                  {pendingProduct.result.product_name}
                  {pendingProduct.result.calories_per_100g != null ? ` · ${pendingProduct.result.calories_per_100g} kcal/100g` : ''}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs, marginBottom: SPACING.md }}>
                  Ne kadar yedin?
                </Text>
                {showCustomGrams ? (
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <TextInput
                      value={customGrams}
                      onChangeText={setCustomGrams}
                      keyboardType="decimal-pad"
                      autoFocus
                      maxLength={6}
                      placeholder="gram"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      accessibilityLabel="Gram miktarı"
                      style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.sm, color: '#fff', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: FONT.md }}
                    />
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); void sendBarcodeLog(parseFloat(customGrams.replace(',', '.'))); }}
                      accessibilityRole="button" accessibilityLabel="Gramı kaydet"
                      style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.xl, justifyContent: 'center' }}>
                      <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>Kaydet</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center' }}>
                    {pendingProduct.result.serving_size_g && pendingProduct.result.serving_size_g > 0 ? (
                      <TouchableOpacity
                        onPress={() => { haptics.tap(); void sendBarcodeLog(pendingProduct.result.serving_size_g as number); }}
                        accessibilityRole="button" accessibilityLabel={`1 porsiyon, ${Math.round(pendingProduct.result.serving_size_g)} gram`}
                        style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg }}>
                        <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>
                          1 porsiyon ({Math.round(pendingProduct.result.serving_size_g)} g)
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); void sendBarcodeLog(100); }}
                      accessibilityRole="button" accessibilityLabel="100 gram"
                      style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg }}>
                      <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>100 g</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); setShowCustomGrams(true); }}
                      accessibilityRole="button" accessibilityLabel="Özel gram gir"
                      style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg }}>
                      <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Özel gram</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {barcodeResult && (
                  <Text style={{ color: '#FFB4AB', fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>{barcodeResult}</Text>
                )}
                <TouchableOpacity
                  onPress={() => { haptics.tap(); resetBarcodeState(); }}
                  accessibilityRole="button" accessibilityLabel="Vazgeç"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ alignSelf: 'center', marginTop: SPACING.md }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: FONT.sm }}>Vazgeç</Text>
                </TouchableOpacity>
              </View>
            )}
            {barcodeResult && !pendingProduct && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: RADIUS.md, padding: SPACING.lg }}>
                <Text style={{ color: '#fff', fontSize: FONT.sm, textAlign: 'center' }}>{barcodeResult}</Text>
              </View>
            )}
          </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    );
  }

  // ====== VOICE SCREEN ======
  if (screen === 'voice') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity
          onPress={() => { setScreen('main'); setIsRecording(false); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={{ position: 'absolute', top: insets.top + 12, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>

        {transcribing ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.md, marginTop: SPACING.md }}>Ses tanınıyor...</Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              onPress={() => { haptics.tap(); void handleVoiceToggle(); }}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? 'Kaydı durdur' : 'Kayda başla'}
              style={{
                width: 96, height: 96, borderRadius: 48,
                backgroundColor: isRecording ? colors.error : colors.pink,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: SPACING.xxl,
              }}
            >
              <Ionicons name={isRecording ? 'stop' : 'mic'} size={40} color={getContrastColor(isRecording ? colors.error : colors.pink)} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm }}>
              {isRecording ? 'Dinliyorum...' : 'Konuşmaya başla'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>
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
      // FIX (audit UI-LAY-03): pin content to the top (flex-start + paddingTop) instead of vertical
      // centering. The autoFocused decimal-pad keyboard opens immediately and, in this modal, its top
      // edge reaches above center on small devices and would cover the İptal/Kaydet buttons.
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'flex-start', alignItems: 'center', padding: SPACING.xl, paddingTop: insets.top + 64 }}>
        <TouchableOpacity
          onPress={() => setScreen('main')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={{ position: 'absolute', top: insets.top + 12, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.pink + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
          <Ionicons name="scale" size={24} color={colors.pink} />
        </View>
        <Text style={{ fontSize: FONT.lg, fontWeight: '600', color: colors.text, marginBottom: SPACING.xxl }}>Tartı Kaydı</Text>
        <TextInput
          style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg,
            color: colors.text, fontSize: FONT.hero, fontWeight: '700',
            textAlign: 'center', width: '70%', borderWidth: 0.5, borderColor: colors.border,
          }}
          // FIX (audit: yanıltıcı 73.5 sabiti): placeholder kullanıcının bilinen son kilosu —
          // profil boşsa placeholder gösterme, uydurma bir sayı telkin etme.
          placeholder={profile?.weight_kg ? String(profile.weight_kg) : undefined}
          placeholderTextColor={colors.textMuted}
          value={weightInput} onChangeText={setWeightInput}
          keyboardType="decimal-pad" autoFocus
          accessibilityLabel="Kilo (kg)"
        />
        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: SPACING.xs, marginBottom: SPACING.xxl }}>kg</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '70%' }}>
          <TouchableOpacity onPress={() => setScreen('main')} accessibilityRole="button" accessibilityLabel="İptal" style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>İptal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleWeightSave} disabled={loading} accessibilityRole="button" accessibilityLabel="Kaydet" style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center', opacity: loading ? 0.5 : 1 }}>
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== SLEEP SCREEN ======
  if (screen === 'sleep') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity
          onPress={() => setScreen('main')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={{ position: 'absolute', top: insets.top + 12, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.purple + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
          <Ionicons name="moon" size={24} color={colors.purple} />
        </View>
        <Text style={{ fontSize: FONT.lg, fontWeight: '600', color: colors.text, marginBottom: SPACING.xxl }}>Uyku Kaydı</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '80%', marginBottom: SPACING.xxl }}>
          {/* FIX (audit Wave3): native time picker instead of free-text TextInput — invalid HH:mm
              becomes impossible to enter (iOS numbers-and-punctuation keyboard lacked ':'). The
              handleSleepSave split(':') validation stays as a safety net. DateTimeField returns 'HH:mm'. */}
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Yatış</Text>
            <DateTimeField mode="time" value={sleepTime} onChange={setSleepTime} placeholder="23:00" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Kalkış</Text>
            <DateTimeField mode="time" value={wakeTime} onChange={setWakeTime} placeholder="07:00" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '80%' }}>
          <TouchableOpacity onPress={() => setScreen('main')} accessibilityRole="button" accessibilityLabel="İptal" style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>İptal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSleepSave} disabled={loading} accessibilityRole="button" accessibilityLabel="Kaydet" style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center', opacity: loading ? 0.5 : 1 }}>
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== RECOVERY SCREEN ======
  if (screen === 'recovery') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
        <TouchableOpacity
          onPress={() => setScreen('main')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={{ position: 'absolute', top: insets.top + 12, left: SPACING.xl }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.success + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md }}>
          <Ionicons name="fitness" size={24} color={colors.success} />
        </View>
        <Text style={{ fontSize: FONT.lg, fontWeight: '600', color: colors.text, marginBottom: SPACING.xxl }}>Toparlanma Kaydı</Text>

        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', alignSelf: 'flex-start', marginBottom: SPACING.sm }}>Kas ağrısı</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.sm, width: '100%', marginBottom: SPACING.xl }}>
          {SORENESS_LEVELS.map(s => (
            <TouchableOpacity key={s.value} onPress={() => { haptics.tap(); setSoreness(s.value); }}
              accessibilityRole="button"
              accessibilityLabel={`Kas ağrısı: ${s.label}`}
              accessibilityState={{ selected: soreness === s.value }}
              style={{
                flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, alignItems: 'center',
                backgroundColor: soreness === s.value ? colors.warning : colors.card,
                borderWidth: 0.5, borderColor: soreness === s.value ? colors.warning : colors.border,
              }}>
              <Text style={{ color: soreness === s.value ? getContrastColor(colors.warning) : colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', alignSelf: 'flex-start', marginBottom: SPACING.sm }}>Genel toparlanma (1 kötü — 5 harika)</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.sm, width: '100%', marginBottom: SPACING.xxl }}>
          {[1, 2, 3, 4, 5].map(r => (
            <TouchableOpacity key={r} onPress={() => { haptics.tap(); setRecoveryScore(r); }}
              accessibilityRole="button"
              accessibilityLabel={`Toparlanma puanı: ${r}`}
              accessibilityState={{ selected: recoveryScore === r }}
              style={{
                flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, alignItems: 'center',
                backgroundColor: recoveryScore === r ? colors.success : colors.card,
                borderWidth: 0.5, borderColor: recoveryScore === r ? colors.success : colors.border,
              }}>
              <Text style={{ color: recoveryScore === r ? getContrastColor(colors.success) : colors.textSecondary, fontSize: FONT.md, fontWeight: '700' }}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: SPACING.md, width: '80%' }}>
          <TouchableOpacity onPress={() => setScreen('main')} accessibilityRole="button" accessibilityLabel="İptal" style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>İptal</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRecoverySave} disabled={loading || (soreness === null && recoveryScore === null)}
            accessibilityRole="button" accessibilityLabel="Kaydet"
            accessibilityState={{ disabled: loading || (soreness === null && recoveryScore === null) }}
            style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center', opacity: loading || (soreness === null && recoveryScore === null) ? 0.5 : 1 }}>
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== SUCCESS TOAST ======
  if (successMsg) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setSuccessMsg(null); router.back(); }}
        accessibilityRole="button"
        accessibilityLabel={`${successMsg}. Kapatmak için dokun`}
        style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
          alignItems: 'center', borderWidth: 0.5, borderColor: colors.border,
        }}>
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          </Animated.View>
          <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md }}>{successMsg}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // ====== MAIN SCREEN ======
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {/* FIX (audit UI-LAY-01/HIGH): wrap the quick-log scroll in KeyboardAvoidingView so the
        free-text input and its "Kaydet" button are pushed above the keyboard instead of hidden behind it. */}
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.xl, paddingTop: insets.top + 12, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xxl }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Geri">
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: FONT.lg + 2, fontWeight: '600' }}>Kayıt ekle</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Input methods card */}
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.xxl }}>
        {[
          // `navigates` rows fire a router intent that crosses the modal->tab
          // boundary, so they get a transient busy state; in-screen rows don't.
          // FIX (audit: çift yazı yolu): 'Yazarak gir' sohbete ışınlamak yerine alttaki
          // Hızlı kayıt alanına odaklanır — modal içinde TEK kanonik yazı yolu.
          { icon: 'create-outline' as const, title: 'Yazarak gir', desc: '2 yumurta, peynir, ekmek yedim', color: colors.primary, navigates: false, onPress: () => {
            quickInputRef.current?.focus();
            // Klavye açılırken alan görünür kalsın diye başlığına kaydır.
            setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(quickInputY.current - 8, 0), animated: true }), 50);
          } },
          { icon: 'camera-outline' as const, title: 'Fotoğraf çek', desc: 'Tabağını fotoğrafla, AI tanısın', color: colors.protein, navigates: true, onPress: handlePhoto },
          { icon: 'barcode-outline' as const, title: 'Barkod okut', desc: 'Paketli ürünü tara', color: colors.carbs, navigates: false, onPress: () => setScreen('barcode') },
          { icon: 'mic-outline' as const, title: 'Sesli giriş', desc: 'Konuşarak kayıt gir', color: colors.pink, navigates: false, onPress: () => setScreen('voice') },
        ].map((method, i) => {
          const busy = navigatingIndex === i;
          return (
          <TouchableOpacity
            key={i}
            activeOpacity={0.7}
            disabled={navigatingIndex !== null}
            accessibilityRole="button"
            accessibilityLabel={`${method.title}. ${method.desc}`}
            accessibilityState={{ busy }}
            onPress={() => {
              haptics.tap();
              if (method.navigates) setNavigatingIndex(i);
              method.onPress();
            }}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md,
              borderBottomWidth: i < 3 ? 0.5 : 0, borderBottomColor: colors.border,
              opacity: navigatingIndex !== null && !busy ? 0.5 : 1,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: method.color + '18', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={method.icon} size={18} color={method.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '500' }}>{method.title}</Text>
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>{method.desc}</Text>
            </View>
            {busy
              ? <ActivityIndicator size="small" color={colors.textMuted} />
              : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
          </TouchableOpacity>
          );
        })}
      </View>

      {/* Quick text input */}
      {/* FIX (audit TR-i18n): textTransform:'uppercase' locale bilmez — 'Diğer' → 'DIĞER'
          üretiyordu (canlıda görüldü). Doğru Türkçe büyük harf (İ/I ayrımı) literal yazıldı. */}
      <Text
        onLayout={(e) => { quickInputY.current = e.nativeEvent.layout.y; }}
        style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '500', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
        HIZLI KAYIT
      </Text>
      <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, marginBottom: SPACING.xxl }}>
        <TextInput
          ref={quickInputRef}
          style={{ color: colors.text, fontSize: FONT.sm, minHeight: 50, textAlignVertical: 'top' }}
          placeholder="Örnek: 2 dilim ekmek, 1 yumurta, çay"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Hızlı kayıt"
          value={text} onChangeText={setText} multiline maxLength={2000}
        />
        {text.trim() ? (
          <TouchableOpacity onPress={handleLog} disabled={loading}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Kaydet"
            accessibilityState={{ disabled: loading, busy: loading }}
            style={{ backgroundColor: colors.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.md, opacity: loading ? 0.5 : 1 }}>
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '500' }}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Other entries — 2x2 grid */}
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '500', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
        DİĞER KAYITLAR
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {[
          { icon: 'barbell-outline' as const, label: 'Antrenman', color: colors.purple, navigates: true, onPress: () => router.dismissTo({ pathname: '/(tabs)/chat', params: { prefill: 'Antrenman yaptım: ' } }) },
          { icon: 'scale-outline' as const, label: 'Tartı', color: colors.pink, navigates: false, onPress: () => setScreen('weight') },
          { icon: 'moon-outline' as const, label: 'Uyku', color: colors.purple, navigates: false, onPress: () => setScreen('sleep') },
          { icon: 'water-outline' as const, label: 'Su (+0.25L)', color: colors.protein, navigates: false, onPress: handleWaterAdd },
          { icon: 'fitness-outline' as const, label: 'Toparlanma', color: colors.success, navigates: false, onPress: () => setScreen('recovery') },
        ].map((action, i) => {
          const busy = navigatingIndex === 100 + i;
          return (
          <TouchableOpacity key={i}
            activeOpacity={0.7}
            disabled={navigatingIndex !== null}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ busy }}
            onPress={() => {
              haptics.tap();
              if (action.navigates) setNavigatingIndex(100 + i);
              action.onPress();
            }}
            style={{ width: '48%', backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, padding: SPACING.lg, alignItems: 'center', gap: SPACING.sm, opacity: navigatingIndex !== null && !busy ? 0.5 : 1 }}>
            {busy
              ? <ActivityIndicator size="small" color={action.color} />
              : <Ionicons name={action.icon} size={24} color={action.color} />}
            <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '500' }}>{action.label}</Text>
          </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
