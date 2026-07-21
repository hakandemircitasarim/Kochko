import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore } from '@/stores/profile.store';
import { getEffectiveDate } from '@/lib/day-boundary';
import { getMonthSummaries, type DaySummary } from '@/services/calendar.service';
import { Card } from '@/components/ui/Card';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export default function CalendarScreen() {
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
    if (score === null) return COLORS.surfaceLight;
    if (score >= 70) return COLORS.success;
    if (score >= 40) return COLORS.warning;
    return COLORS.error;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* Month navigation */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
        <TouchableOpacity
          onPress={prevMonth}
          accessibilityRole="button"
          accessibilityLabel="Önceki ay"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{MONTH_NAMES[month - 1]} {year}</Text>
        <TouchableOpacity
          onPress={nextMonth}
          accessibilityRole="button"
          accessibilityLabel="Sonraki ay"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ color: COLORS.primary, fontSize: FONT.xl }}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: SPACING.xs }}>
        {DAY_NAMES.map(d => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Loading: spinner in place of the grid (no blank flash, no stale month). */}
      {loading && (
        <View style={{ paddingVertical: SPACING.xxl, alignItems: 'center' }} accessibilityLabel="Takvim yükleniyor">
          <ActivityIndicator size="large" color={COLORS.primary} />
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

        {days.map(day => {
          const dayNum = new Date(day.date).getDate();
          const isToday = day.date === todayStr; // FIX (audit UI-PLN-04): compare against local-built todayStr
          const isSelected = selected?.date === day.date;

          return (
            <TouchableOpacity key={day.date} onPress={() => setSelected(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${dayNum} ${MONTH_NAMES[month - 1]}${isToday ? ', bugün' : ''}${day.hasData && day.compliance_score !== null ? `, uyum ${day.compliance_score}/100` : day.hasData ? '' : ', veri yok'}`}
              style={{ width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: isSelected ? COLORS.primary : day.hasData ? getScoreColor(day.compliance_score) + '30' : 'transparent',
                borderWidth: isToday ? 2 : 0, borderColor: COLORS.primary,
                justifyContent: 'center', alignItems: 'center',
              }}>
                {/* FIX (audit UI-DS-01): seçili gün metni '#fff' yerine getContrastColor(COLORS.primary) (siyah; teal üzerinde WCAG AA geçer, beyaz 3.39:1 idi). */}
                <Text style={{ color: isSelected ? getContrastColor(COLORS.primary) : day.hasData ? COLORS.text : COLORS.textMuted, fontSize: FONT.sm, fontWeight: isToday ? '700' : '400' }}>{dayNum}</Text>
              </View>
              {/* Dot indicator */}
              {day.hasData && !isSelected && (
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: getScoreColor(day.compliance_score), marginTop: 2 }} />
              )}
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
          <View style={{ flexDirection: 'row', marginTop: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: COLORS.border, paddingVertical: SPACING.md }}>
            {[
              { value: `${logged.length}`, label: 'loglanan gün', color: COLORS.text },
              { value: avg != null ? `%${avg}` : '-', label: 'ort. uyum', color: avg != null ? getScoreColor(avg) : COLORS.text },
              { value: `${workouts}`, label: 'antrenman', color: COLORS.text },
            ].map((s) => (
              <View key={s.label} style={{ alignItems: 'center', flex: 1 }}>
                <Text style={{ color: s.color, fontSize: FONT.xl, fontWeight: '800' }}>{s.value}</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        );
      })()}

      {/* Color legend (only meaningful next to a rendered grid) */}
      {!loading && !loadError && (
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginTop: SPACING.md }}
        accessibilityLabel="Renk açıklaması: yeşil iyi, turuncu orta, kırmızı düşük uyum, boş hücre veri yok"
      >
        {[
          { color: COLORS.success, label: 'İyi' },
          { color: COLORS.warning, label: 'Orta' },
          { color: COLORS.error, label: 'Düşük' },
        ].map(item => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{item.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: COLORS.textMuted }} />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Veri yok</Text>
        </View>
      </View>
      )}

      {/* Selected day detail */}
      {selected && (
        <Card title={new Date(selected.date).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })} style={{ marginTop: SPACING.lg }}>
          {!selected.hasData ? (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Bu gün için veri yok.</Text>
          ) : (
            <View style={{ gap: 4 }}>
              {selected.compliance_score !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Uyum</Text>
                  <Text style={{ color: getScoreColor(selected.compliance_score), fontSize: FONT.md, fontWeight: '700' }}>{selected.compliance_score}/100</Text>
                </View>
              )}
              {selected.calorie_actual !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kalori</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.calorie_actual} kcal</Text>
                </View>
              )}
              {selected.weight_kg !== null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kilo</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.weight_kg} kg</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Öğün</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{selected.meal_count} kayıt</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Antrenman</Text>
                <Text style={{ color: selected.workout_done ? COLORS.success : COLORS.textMuted, fontSize: FONT.md }}>{selected.workout_done ? 'Yapıldı' : 'Yapılmadı'}</Text>
              </View>
              {/* FIX (ux-audit major): the tap used to dead-end at this 5-row summary; give it a path
                  to that day's full gün-sonu report (narrative, tomorrow_action, deviation reason).
                  ux-readiness: only when a report actually exists (compliance_score!=null) — a
                  meal/weight-only day has no daily_reports row and the link would soft-dead-end. */}
              {selected.compliance_score !== null && (
                <TouchableOpacity
                  onPress={() => router.push(`/reports/daily?date=${selected.date}`)}
                  accessibilityRole="button"
                  accessibilityLabel="Bu günün gün sonu raporunu gör"
                  style={{ marginTop: SPACING.sm, paddingVertical: SPACING.sm, alignSelf: 'flex-start' }}
                >
                  <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Gün sonu raporunu gör →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}
