/**
 * Scheduled Export Settings Screen
 * Spec 18.2: Zamanlanmış otomatik veri export
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToggleRow } from '@/components/settings/ToggleRow';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import {
  getScheduledExportSettings,
  updateScheduledExportSettings,
  type ExportFrequency,
  type ScheduledExportSettings,
} from '@/services/scheduled-export.service';

export default function ScheduledExportScreen() {
  const [settings, setSettings] = useState<ScheduledExportSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getScheduledExportSettings().then(setSettings); }, []);

  const updateFrequency = async (freq: ExportFrequency) => {
    if (!settings) return;
    setSaving(true);
    const updated = { ...settings, frequency: freq };
    await updateScheduledExportSettings(updated);
    setSettings({ ...updated });
    setSaving(false);
    Alert.alert('Kaydedildi', freq === 'off' ? 'Otomatik export kapatildi.' : `${freq === 'weekly' ? 'Haftalik' : 'Aylik'} export aktif.`);
  };

  const toggleAISummary = async () => {
    if (!settings) return;
    const updated = { ...settings, includeAISummary: !settings.includeAISummary };
    await updateScheduledExportSettings(updated);
    setSettings(updated);
  };

  const toggleFormat = async () => {
    if (!settings) return;
    const newFormat = settings.format === 'json' ? 'csv' : 'json';
    const updated = { ...settings, format: newFormat as 'json' | 'csv' };
    await updateScheduledExportSettings(updated);
    setSettings(updated);
  };

  if (!settings) return null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
    >
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text }}>Otomatik Veri Yedegi</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.md }}>
        Verilerini duzenli olarak yedekle. KVKK kapsaminda veri tasima hakkin.
      </Text>

      <Card title="Siklik">
        {(['off', 'weekly', 'monthly'] as ExportFrequency[]).map(freq => {
          const labels: Record<ExportFrequency, string> = { off: 'Kapali', weekly: 'Haftalik', monthly: 'Aylik' };
          const isActive = settings.frequency === freq;
          return (
            <Button
              key={freq}
              title={labels[freq]}
              variant={isActive ? 'primary' : 'outline'}
              onPress={() => updateFrequency(freq)}
              loading={saving}
              style={{ marginBottom: SPACING.xs }}
            />
          );
        })}
      </Card>

      <Card title="Ayarlar">
        <ToggleRow label="AI notlarini dahil et (Katman 2)" value={settings.includeAISummary} onToggle={toggleAISummary} />
        <ToggleRow label={`Format: ${settings.format.toUpperCase()}`} value={settings.format === 'json'} onToggle={toggleFormat} description="Kapat: CSV, Ac: JSON" />
      </Card>

      {settings.lastExportedAt && (
        <Card title="Son Export">
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
            {new Date(settings.lastExportedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </Card>
      )}

      {settings.nextExportAt && settings.frequency !== 'off' && (
        <Card title="Sonraki Export">
          <Text style={{ color: COLORS.primary, fontSize: FONT.sm }}>
            {new Date(settings.nextExportAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}
