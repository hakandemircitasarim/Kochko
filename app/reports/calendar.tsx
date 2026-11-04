/**
 * Takvim — ayın günleri uyum kademesine göre renkli; güne dokununca o günün özeti.
 *
 * Duolingo seri takvimi dili (DEVIR §0-A, 2026-11): kayıtlı gün = opak pastel DOLU daire +
 * kademe renginde 2px çerçeve + kalın mürekkep rakam (eskiden %19 alfa leke + 4px nokta —
 * hangi günün dolu olduğu uzaktan okunmuyordu). Aynı haftadaki ARDIŞIK kayıtlı günler arkadan
 * yumuşak bir bantla birleşir: seri gözle görülür. Bugün kalın menekşe halka, seçili gün dolu
 * menekşe. Ay seçici gövdeli tuşlar (MonthNav). Veri/gezinme mantığı aynen korunur.
 */
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { METRIC_COLORS } from '@/lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore } from '@/stores/profile.store';
import { getEffectiveDate } from '@/lib/day-boundary';
import { getMonthSummaries, type DaySummary } from '@/services/calendar.service';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MonthNav, PLATE_INK, tint } from '@/components/reports/ReportBits';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { formatDecimal } from '@/lib/units';

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export default function CalendarScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  // Review fix (efficiency): tüm profile objesine değil tek skalere abone ol —
  // her profil yazımı 42 hücrelik grid'i yeniden render ediyordu.
  const dayBoundaryHour = useProfileStore(s => (s.profile?.day_boundary_hour as number) ?? 4);
  const now = new Date();
  // Review fix: ay durumu da EFEKTİF günden başlar — ayın 1'i 00:30'da takvim
  // medeni-takvim ayını (yeni ay) açıp efektif günün (dünün) halkasını ekran-dışı
  // bırakıyordu; kullanıcı '<' ile geri gitmeden 'bugün' hiç görünmüyordu.
  const effTodayStr = getEffectiveDate(now, dayBoundaryHour);
  const [year, setYear] = useState(Number(effTodayStr.slice(0, 4)));
  const [month, setMonth] = useState(Number(effTodayStr.slice(5, 7)));
  const [days, setDays] = useState<DaySummary[]>([]);
  const [selected, setSelected] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0); // retry trigger

  // FIX (ux-pass raporlar #6): the grid had no loading state (blank flash), month navigation left
  // the OLD month's days under the new title until the fetch landed, and a network failure silently
  // rendered a 'veri yok' month. Now: clear grid + selected day immediately on month change, show a
  // spinner while loading, and surface an explicit retry on failure. The `cancelled` guard drops
  // stale responses when the user taps through months quickly.
  // FIX (ux-pass5): getMonthSummaries artık sorgu-içi supabase hatalarını yutmuyor — hata fırlatıyor,
  // yani aşağıdaki .catch → 'Tekrar dene' dalı ağ kopmasında da çalışıyor.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setDays([]);
    setSelected(null);
    getMonthSummaries(year, month)
      .then(d => { if (!cancelled) setDays(d); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month, attempt]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Calculate first day offset (Monday = 0)
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  // FIX (audit UI-PLN-04 + ux-pass5): "bugün" halkası EFEKTİF günü işaretler —
  // yerel takvim tarihi bile gün-sınırından (varsayılan 04:00) önce yanlış: 01:00'de
  // günlük verisi hâlâ dünün hücresine yazılırken halka boş "yarın" hücresindeydi.
  // Diğer tüm yüzeylerle aynı getEffectiveDate ankrajı (yukarıda ay-init de aynı değeri kullanır).
  const todayStr = effTodayStr;

  const getScoreColor = (score: number | null) => {
    if (score === null) return colors.surfaceLight;
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.warning;
    return colors.error;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* Month navigation — gövdeli yuvarlak tuşlar (aylık raporla ortak MonthNav). */}
      <MonthNav title={`${MONTH_NAMES[month - 1]} ${year}`} onPrev={prevMonth} onNext={nextMonth} />

      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: SPACING.xs }}>
        {DAY_NAMES.map(d => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, ...TYPE.caption, fontWeight: '700' }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Loading: spinner in place of the grid (no blank flash, no stale month). */}
      {loading && (
        <View style={{ paddingVertical: SPACING.xxl, alignItems: 'center' }} accessibilityLabel="Takvim yükleniyor">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {/* Load failure: explicit retry instead of a silent 'veri yok' month. (refactor: shared LoadErrorState) */}
      {!loading && loadError && (
        <LoadErrorState embedded title="Yüklenemedi" onRetry={() => setAttempt(a => a + 1)} />
      )}

      {/* Calendar grid */}
      {!loading && !loadError && (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {/* Empty cells for offset */}
        {Array.from({ length: offset }).map((_, i) => (
          <View key={`empty-${i}`} style={{ width: '14.28%', aspectRatio: 1 }} />
        ))}

        {days.map((day, idx) => {
          const dayNum = new Date(day.date).getDate();
          const isToday = day.date === todayStr; // FIX (audit UI-PLN-04): compare against local-built todayStr
          const isSelected = selected?.date === day.date;
          // Seri bandı: aynı hafta satırında (Pzt=0 … Paz=6) komşu gün de kayıtlıysa o yöne
          // yarım bant uzar — ardışık kayıtlı günler tek parça "seri" gibi birleşir.
          const col = (offset + idx) % 7;
          const linkPrev = day.hasData && col > 0 && !!days[idx - 1]?.hasData;
          const linkNext = day.hasData && col < 6 && !!days[idx + 1]?.hasData;
          const scoreColor = day.compliance_score !== null ? getScoreColor(day.compliance_score) : colors.primary;
          const band = tint(colors.primary, colors, isDark, isDark ? 1.1 : 1.5);

          return (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={day.date} onPress={() => setSelected(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${dayNum} ${MONTH_NAMES[month - 1]}${isToday ? ', bugün' : ''}${day.hasData && day.compliance_score !== null ? `, uyum yüzde ${day.compliance_score}` : day.hasData ? '' : ', veri yok'}`}
              style={{ width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center' }}>
              {linkPrev && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: '50%', height: 30, backgroundColor: band }} />}
              {linkNext && <View pointerEvents="none" style={{ position: 'absolute', left: '50%', right: 0, height: 30, backgroundColor: band }} />}
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                // Dolu daire OPAK pastel (bant üstünde de temiz durur); kademe rengi çerçevede.
                backgroundColor: isSelected ? colors.primary : day.hasData ? tint(scoreColor, colors, isDark, 1.8) : 'transparent',
                borderWidth: isToday ? 3 : day.hasData && !isSelected ? 2 : 0,
                borderColor: isToday ? colors.primary : scoreColor,
                justifyContent: 'center', alignItems: 'center',
              }}>
                {/* FIX (audit UI-DS-01): seçili gün metni getContrastColor(colors.primary). */}
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: isSelected ? getContrastColor(colors.primary) : day.hasData ? colors.text : colors.textMuted, ...TYPE.bodyStrong, fontWeight: day.hasData || isToday ? '800' : '500' }}>{dayNum}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      {/* FIX (ux-round3 #2): month-at-a-glance strip from the already-loaded day summaries (logged
          days, average compliance, workouts) so the user doesn't count cells. Live per month. */}
      {!loading && !loadError && days.some(d => d.hasData) && (() => {
        const logged = days.filter(d => d.hasData);
        const scored = logged.filter(d => d.compliance_score !== null);
        const avg = scored.length ? Math.round(scored.reduce((s, d) => s + (d.compliance_score ?? 0), 0) / scored.length) : null;
        const workouts = days.filter(d => d.workout_done).length;
        return (
          <View style={{ flexDirection: 'row', marginTop: SPACING.md, gap: SPACING.sm }}>
            {[
              { value: `${logged.length}`, label: 'kayıtlı gün', icon: 'calendar' as const, color: METRIC_COLORS.calories },
              { value: avg != null ? `%${avg}` : '-', label: 'ort. uyum', icon: 'checkmark-circle' as const, color: avg != null ? getScoreColor(avg) : colors.textMuted },
              { value: `${workouts}`, label: 'antrenman', icon: 'barbell' as const, color: METRIC_COLORS.protein },
            ].map((s) => (
              // Salt okunur özet kutucuğu: dolu renkli plaka + mürekkep ikon, sayı mürekkep.
              <View key={s.label} accessible accessibilityLabel={`${s.label}: ${s.value}`} style={{ flex: 1, alignItems: 'center', backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: colors.border, paddingVertical: SPACING.md }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: s.color, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xs }}>
                  <Ionicons name={s.icon} size={17} color={PLATE_INK} />
                </View>
                <Text style={{ color: colors.text, ...TYPE.title3, fontWeight: '800' }}>{s.value}</Text>
                <Text style={{ color: colors.textSecondary, ...TYPE.caption, marginTop: 1 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        );
      })()}

      {/* Color legend (only meaningful next to a rendered grid) */}
      {!loading && !loadError && (
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginTop: SPACING.md }}
        accessibilityLabel="Renk açıklaması: mavi iyi, turuncu orta, kırmızı düşük uyum, boş hücre veri yok"
      >
        {[
          { color: colors.success, label: 'İyi' },
          { color: colors.warning, label: 'Orta' },
          { color: colors.error, label: 'Düşük' },
        ].map(item => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: tint(item.color, colors, isDark, 1.8), borderWidth: 2, borderColor: item.color }} />
            <Text style={{ color: colors.textSecondary, ...TYPE.caption }}>{item.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.textMuted }} />
          <Text style={{ color: colors.textSecondary, ...TYPE.caption }}>Veri yok</Text>
        </View>
      </View>
      )}

      {/* Selected day detail */}
      {selected && (
        <Card title={new Date(selected.date).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })} style={{ marginTop: SPACING.lg }}>
          {!selected.hasData ? (
            <Text style={{ color: colors.textMuted, ...TYPE.body }}>Bu gün için veri yok.</Text>
          ) : (
            <View style={{ gap: 4 }}>
              {selected.compliance_score !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Uyum</Text>
                  <Text style={{ color: getScoreColor(selected.compliance_score), ...TYPE.headline }}>%{selected.compliance_score}</Text>
                </View>
              )}
              {selected.calorie_actual !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Kalori</Text>
                  <Text style={{ color: colors.text, ...TYPE.body }}>{selected.calorie_actual} kcal</Text>
                </View>
              )}
              {selected.weight_kg !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Kilo</Text>
                  <Text style={{ color: colors.text, ...TYPE.body }}>{formatDecimal(selected.weight_kg as number)} kg</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Öğün</Text>
                <Text style={{ color: colors.text, ...TYPE.body }}>{selected.meal_count} kayıt</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Antrenman</Text>
                <Text style={{ color: selected.workout_done ? colors.success : colors.textMuted, ...TYPE.body }}>{selected.workout_done ? 'Yapıldı' : 'Yapılmadı'}</Text>
              </View>
              {/* FIX (ux-audit major): the tap used to dead-end at this 5-row summary; give it a path
                  to that day's full gün-sonu report (narrative, tomorrow_action, deviation reason).
                  ux-readiness: only when a report actually exists (compliance_score!=null) — a
                  meal/weight-only day has no daily_reports row and the link would soft-dead-end. */}
              {selected.compliance_score !== null && (
                <Button
                  title="Gün sonu raporunu gör"
                  variant="outline"
                  size="sm"
                  onPress={() => router.push(`/reports/daily?date=${selected.date}`)}
                  accessibilityLabel="Bu günün gün sonu raporunu gör"
                  icon={<Ionicons name="document-text-outline" size={16} color={colors.primary} />}
                  style={{ marginTop: SPACING.sm, alignSelf: 'flex-start' }}
                />
              )}
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
