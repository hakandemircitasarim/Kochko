/**
 * Debug/Transparency Mode
 * Spec 5.22: Power user transparency view.
 * Shows AI context layers, token usage, guardrail status.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function DebugModeScreen() {
  const user = useAuthStore(s => s.user);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [lastMessages, setLastMessages] = useState<Record<string, unknown>[]>([]);
  const [stats, setStats] = useState({ totalMessages: 0, todayMessages: 0, avgTokens: 0 });

  useEffect(() => {
    if (!user?.id) return;
    const today = new Date().toISOString().split('T')[0];

    Promise.all([
      supabase.from('profiles').select('tdee_calculated, calorie_range_training_min, calorie_range_training_max, weight_kg, premium, onboarding_completed').eq('id', user.id).single(),
      supabase.from('ai_summary').select('general_summary, behavioral_patterns, user_persona, nutrition_literacy').eq('user_id', user.id).single(),
      supabase.from('chat_messages').select('task_mode, model_version, token_count, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', `${today}T00:00:00`),
    ]).then(([profileRes, summaryRes, messagesRes, totalRes, todayRes]) => {
      setProfile(profileRes.data);
      setSummary(summaryRes.data);
      setLastMessages((messagesRes.data ?? []) as Record<string, unknown>[]);
      const tokens = (messagesRes.data ?? []).filter((m: Record<string, unknown>) => m.token_count).map((m: Record<string, unknown>) => m.token_count as number);
      setStats({
        totalMessages: totalRes.count ?? 0,
        todayMessages: todayRes.count ?? 0,
        avgTokens: tokens.length > 0 ? Math.round(tokens.reduce((s, t) => s + t, 0) / tokens.length) : 0,
      });
    });
  }, [user?.id]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Gelistirici Modu</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.lg }}>AI sisteminin iç yapısı ve performans metrikleri.</Text>

      {/* Profile Summary */}
      <Card title="Katman 1 (Profil)">
        <DebugRow label="TDEE" value={`${profile?.tdee_calculated ?? '-'} kcal`} />
        <DebugRow label="Kalori Araligi" value={`${profile?.calorie_range_training_min ?? '-'} - ${profile?.calorie_range_training_max ?? '-'} kcal`} />
        <DebugRow label="Kilo" value={`${profile?.weight_kg ?? '-'} kg`} />
        <DebugRow label="Premium" value={profile?.premium ? 'Aktif' : 'Hayir'} />
        <DebugRow label="Onboarding" value={profile?.onboarding_completed ? 'Tamamlandi' : 'Devam Ediyor'} />
      </Card>

      {/* AI Summary */}
      <Card title="Katman 2 (AI Ozeti)">
        <DebugRow label="Genel Ozet" value={summary?.general_summary ? `${(summary.general_summary as string).substring(0, 80)}...` : 'Bos'} />
        <DebugRow label="Kaliplar" value={`${(summary?.behavioral_patterns as unknown[] ?? []).length} kalip`} />
        <DebugRow label="Persona" value={(summary?.user_persona as string) ?? 'Belirlenmedi'} />
        <DebugRow label="Beslenme Okuryazarlik" value={(summary?.nutrition_literacy as string) ?? 'medium'} />
      </Card>

      {/* Usage Stats */}
      <Card title="Kullanim Istatistikleri">
        <DebugRow label="Toplam Mesaj" value={`${stats.totalMessages}`} />
        <DebugRow label="Bugunki Mesaj" value={`${stats.todayMessages}`} />
        <DebugRow label="Ort. Token/Mesaj" value={`${stats.avgTokens}`} />
      </Card>

      {/* Recent Messages Debug */}
      <Card title="Son 10 Mesaj (Gorev Modlari)">
        {lastMessages.map((m, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: i < lastMessages.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{String(m.task_mode ?? '-')}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{String(m.model_version ?? '-')}</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{String(m.token_count ?? '-')} tok</Text>
          </View>
        ))}
        {lastMessages.length === 0 && <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Henuz mesaj yok.</Text>}
      </Card>

      {/* System Info */}
      <Card title="Sistem">
        <DebugRow label="Birincil Model" value="gpt-4o-mini" />
        <DebugRow label="Goruntu Modeli" value="gpt-4o" />
        <DebugRow label="Fallback Model" value="gpt-4o-mini" />
        <DebugRow label="Token Butcesi" value="130.000 (toplam context)" />
        <DebugRow label="K1 Butcesi" value="%15 (19.500 token)" />
        <DebugRow label="K2 Butcesi" value="%10 (13.000 token)" />
        <DebugRow label="K3 Butcesi" value="%25 (32.500 token)" />
        <DebugRow label="K4 Butcesi" value="%35 (45.500 token)" />
      </Card>
    </ScrollView>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '500', maxWidth: '60%', textAlign: 'right' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}
