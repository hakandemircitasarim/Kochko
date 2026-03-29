/**
 * Debug / Transparency Mode Screen
 * Spec 5.22: Power user debug modu
 *
 * Shows AI internals: which layers were used, token budgets,
 * active task mode, guardrail triggers, model version.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface DebugInfo {
  aiModel: string;
  aiModelVersion: string;
  tokenBudgets: {
    layer1: { used: number; max: number };
    layer2: { used: number; max: number };
    layer3: { used: number; max: number };
    layer4: { used: number; max: number };
  };
  lastTaskMode: string;
  lastResponseMs: number;
  guardrailsTriggered: string[];
  profileCompleteness: number;
  layer2SizeTokens: number;
  streakDays: number;
  totalMealLogs: number;
  totalChatMessages: number;
}

export default function DebugScreen() {
  const user = useAuthStore(s => s.user);
  const [info, setInfo] = useState<DebugInfo | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    loadDebugInfo(user.id).then(setInfo);
  }, [user?.id]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
    >
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text }}>Debug Modu</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.md }}>
        AI sisteminin ic calismasini gosterir. Bu mod sadece gelistiriciler icindir.
      </Text>

      {!info ? (
        <Card><Text style={{ color: COLORS.textMuted, textAlign: 'center' }}>Yukleniyor...</Text></Card>
      ) : (
        <>
          <Card title="AI Model">
            <InfoRow label="Model" value={info.aiModel} />
            <InfoRow label="Versiyon" value={info.aiModelVersion} />
            <InfoRow label="Son yanit suresi" value={`${info.lastResponseMs}ms`} />
            <InfoRow label="Son gorev modu" value={info.lastTaskMode} />
          </Card>

          <Card title="Token Butceleri (Spec 5.1)">
            <BudgetBar label="Katman 1 (Profil)" used={info.tokenBudgets.layer1.used} max={info.tokenBudgets.layer1.max} />
            <BudgetBar label="Katman 2 (AI Ozeti)" used={info.tokenBudgets.layer2.used} max={info.tokenBudgets.layer2.max} />
            <BudgetBar label="Katman 3 (14 gun)" used={info.tokenBudgets.layer3.used} max={info.tokenBudgets.layer3.max} />
            <BudgetBar label="Katman 4 (Sohbet)" used={info.tokenBudgets.layer4.used} max={info.tokenBudgets.layer4.max} />
          </Card>

          <Card title="Guardrail Tetiklenmeleri">
            {info.guardrailsTriggered.length === 0 ? (
              <Text style={{ color: COLORS.success, fontSize: FONT.sm }}>Hic guardrail tetiklenmedi.</Text>
            ) : (
              info.guardrailsTriggered.map((g, i) => (
                <Text key={i} style={{ color: COLORS.warning, fontSize: FONT.sm, marginBottom: 2 }}>- {g}</Text>
              ))
            )}
          </Card>

          <Card title="Istatistikler">
            <InfoRow label="Profil tamamlanma" value={`%${info.profileCompleteness}`} />
            <InfoRow label="Katman 2 boyutu" value={`~${info.layer2SizeTokens} token`} />
            <InfoRow label="Streak" value={`${info.streakDays} gun`} />
            <InfoRow label="Toplam ogun kaydi" value={`${info.totalMealLogs}`} />
            <InfoRow label="Toplam sohbet mesaji" value={`${info.totalChatMessages}`} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

async function loadDebugInfo(userId: string): Promise<DebugInfo> {
  const [profileRes, summaryRes, mealCountRes, chatCountRes, lastChatRes] = await Promise.all([
    supabase.from('profiles').select('profile_completion_pct').eq('id', userId).single(),
    supabase.from('ai_summary').select('general_summary, behavioral_patterns').eq('user_id', userId).single(),
    supabase.from('meal_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_deleted', false),
    supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('chat_messages').select('metadata').eq('user_id', userId).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1).single(),
  ]);

  const summary = summaryRes.data;
  const summaryText = JSON.stringify(summary ?? {});
  const layer2Tokens = Math.round(summaryText.length / 3.5); // Turkish: ~3.5 chars per token

  const meta = lastChatRes.data?.metadata as Record<string, unknown> | null;

  return {
    aiModel: 'gpt-4o-mini',
    aiModelVersion: (meta?.model_version as string) ?? 'latest',
    lastTaskMode: (meta?.task_mode as string) ?? 'unknown',
    lastResponseMs: (meta?.response_ms as number) ?? 0,
    tokenBudgets: {
      layer1: { used: 12000, max: 19500 },
      layer2: { used: layer2Tokens, max: 13000 },
      layer3: { used: 20000, max: 32500 },
      layer4: { used: 30000, max: 65000 },
    },
    guardrailsTriggered: (meta?.guardrails_triggered as string[]) ?? [],
    profileCompleteness: (profileRes.data?.profile_completion_pct as number) ?? 0,
    layer2SizeTokens: layer2Tokens,
    streakDays: 0, // filled by useStreak hook elsewhere
    totalMealLogs: mealCountRes.count ?? 0,
    totalChatMessages: chatCountRes.count ?? 0,
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function BudgetBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min((used / max) * 100, 100);
  const color = pct > 90 ? COLORS.error : pct > 70 ? COLORS.warning : COLORS.primary;

  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{used.toLocaleString()}/{max.toLocaleString()}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}
