/**
 * Multi-Phase Goal Planning Screen
 * Spec 6.7: Cut/bulk/maintain döngüsü
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { getGoalPhases, addPhase, deletePhase, advanceToNextPhase, getTimelineData, type GoalPhase } from '@/services/goals.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PhaseTimeline } from '@/components/plan/PhaseTimeline';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  cut: { label: 'Cut (Kilo Ver)', color: COLORS.error },
  bulk: { label: 'Bulk (Kilo Al)', color: COLORS.success },
  maintain: { label: 'Bakim', color: COLORS.primary },
  mini_cut: { label: 'Mini Cut', color: COLORS.warning },
  recomp: { label: 'Recomp', color: '#9C27B0' },
};

export default function MultiPhaseGoalsScreen() {
  const user = useAuthStore(s => s.user);
  const [phases, setPhases] = useState<GoalPhase[]>([]);
  const [timelineData, setTimelineData] = useState<{ phases: { id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[]; currentWeek: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newPhaseLabel, setNewPhaseLabel] = useState('cut');
  const [newTarget, setNewTarget] = useState('');
  const [newWeeks, setNewWeeks] = useState('12');

  useEffect(() => { if (user?.id) load(); }, [user?.id]);
  const load = async () => {
    if (!user?.id) return;
    const [p, t] = await Promise.all([getGoalPhases(user.id), getTimelineData(user.id)]);
    setPhases(p);
    setTimelineData(t);
  };

  const handleAdd = async () => {
    if (!user?.id) return;
    const goalType = newPhaseLabel === 'cut' || newPhaseLabel === 'mini_cut' ? 'lose_weight' : newPhaseLabel === 'bulk' ? 'gain_weight' : 'maintain';
    await addPhase(user.id, goalType, newTarget ? parseFloat(newTarget) : null, parseInt(newWeeks) || 12, newPhaseLabel);
    setShowAdd(false); setNewTarget(''); setNewWeeks('12');
    load();
  };

  const handleDelete = (id: string) => {
    Alert.alert('Sil', 'Bu fazi silmek istediginize emin misiniz?', [
      { text: 'Iptal' },
      { text: 'Sil', style: 'destructive', onPress: () => { deletePhase(id); load(); } },
    ]);
  };

  const handleAdvance = async () => {
    if (!user?.id) return;
    const next = await advanceToNextPhase(user.id);
    if (next) {
      Alert.alert('Faz Gecisi', `"${next.phase_label}" fazina gecildi.`);
      load();
    } else {
      Alert.alert('Bitti', 'Tum fazlar tamamlandi!');
    }
  };

  const activePhase = phases.find(p => p.is_active);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Cok Fazli Hedef</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Sirali fazlar tanimla: ornegin "75kg'a in (cut) → 3 ay bulk 80kg → 77kg'a in (mini cut)". Fazlar sirayla aktif olur.
      </Text>

      {/* Horizontal timeline bar (Spec 6.7) */}
      {timelineData && timelineData.phases.length > 1 && (
        <View style={{ marginBottom: SPACING.md }}>
          <PhaseTimeline phases={timelineData.phases} currentWeek={timelineData.currentWeek} />
        </View>
      )}

      {/* Phase timeline */}
      {phases.length > 0 && (
        <Card title="Faz Zaman Cizelgesi">
          {phases.map((phase, i) => {
            const info = PHASE_LABELS[phase.phase_label ?? ''] ?? { label: phase.phase_label ?? phase.goal_type, color: COLORS.textMuted };
            return (
              <TouchableOpacity key={phase.id} onLongPress={() => handleDelete(phase.id)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: i < phases.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
                {/* Phase indicator */}
                <View style={{ width: 24, alignItems: 'center', marginRight: SPACING.sm }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: phase.is_active ? info.color : COLORS.surfaceLight, borderWidth: phase.is_active ? 0 : 1, borderColor: COLORS.border }} />
                  {i < phases.length - 1 && <View style={{ width: 2, height: 20, backgroundColor: COLORS.border, marginTop: 2 }} />}
                </View>
                {/* Phase info */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                    <Text style={{ color: phase.is_active ? info.color : COLORS.text, fontSize: FONT.md, fontWeight: phase.is_active ? '700' : '400' }}>{info.label}</Text>
                    {phase.is_active && (
                      <View style={{ backgroundColor: info.color, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>AKTIF</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 1 }}>
                    {phase.target_weight_kg ? `Hedef: ${phase.target_weight_kg}kg` : 'Koru'} | {phase.target_weeks ?? '?'} hafta
                  </Text>
                </View>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>#{phase.phase_order}</Text>
              </TouchableOpacity>
            );
          })}
        </Card>
      )}

      {/* Advance to next phase */}
      {activePhase && phases.length > 1 && (
        <Button title="Sonraki Faza Gec" variant="outline" onPress={handleAdvance} style={{ marginBottom: SPACING.md }} />
      )}

      {/* Add new phase */}
      <Button title={showAdd ? 'Iptal' : 'Yeni Faz Ekle'} variant={showAdd ? 'ghost' : 'primary'} onPress={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card style={{ marginTop: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Faz Tipi</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
            {Object.entries(PHASE_LABELS).map(([key, info]) => (
              <TouchableOpacity key={key} onPress={() => setNewPhaseLabel(key)}
                style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
                  borderColor: newPhaseLabel === key ? info.color : COLORS.border,
                  backgroundColor: newPhaseLabel === key ? info.color : 'transparent' }}>
                <Text style={{ color: newPhaseLabel === key ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{info.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Hedef Kilo (opsiyonel)" placeholder="75" value={newTarget} onChangeText={setNewTarget} keyboardType="decimal-pad" />
          <Input label="Sure (hafta)" placeholder="12" value={newWeeks} onChangeText={setNewWeeks} keyboardType="numeric" />
          <Button title="Faz Ekle" onPress={handleAdd} />
        </Card>
      )}

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Uzun bas: fazi sil</Text>
    </ScrollView>
  );
}
