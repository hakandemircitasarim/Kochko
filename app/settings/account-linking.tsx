/**
 * Account Linking Screen — Spec 1.4
 * Link/unlink Google, Apple auth methods to existing account.
 * At least one sign-in method must remain active.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface LinkedIdentity {
  provider: string;
  email: string | null;
}

export default function AccountLinkingScreen() {
  const { user } = useAuthStore();
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadIdentities(); }, []);

  const loadIdentities = () => {
    if (!user) return;
    const ids: LinkedIdentity[] = [];
    // Email always present if registered with email
    if (user.email) {
      ids.push({ provider: 'email', email: user.email });
    }
    // Check user identities from Supabase auth
    const userIdentities = (user as unknown as { identities?: { provider: string; identity_data?: { email?: string } }[] }).identities;
    if (userIdentities) {
      for (const id of userIdentities) {
        if (id.provider !== 'email') {
          ids.push({ provider: id.provider, email: id.identity_data?.email ?? null });
        }
      }
    }
    setIdentities(ids);
  };

  const handleLink = async (provider: 'google' | 'apple') => {
    setLoading(true);
    const { error } = await supabase.auth.linkIdentity({ provider });
    setLoading(false);
    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      Alert.alert('Basarili', `${provider === 'google' ? 'Google' : 'Apple'} hesabi baglandi.`);
      loadIdentities();
    }
  };

  const handleUnlink = async (provider: string) => {
    if (identities.length <= 1) {
      Alert.alert('Hata', 'En az bir giris yontemi aktif kalmali.');
      return;
    }
    Alert.alert('Baglanti Kaldir', `${provider} baglantisinı kaldirmak istediginize emin misiniz?`, [
      { text: 'Iptal' },
      { text: 'Kaldir', style: 'destructive', onPress: async () => {
        setLoading(true);
        const { error } = await supabase.auth.unlinkIdentity({ provider } as never);
        setLoading(false);
        if (error) Alert.alert('Hata', error.message);
        else loadIdentities();
      }},
    ]);
  };

  const providerLabel = (p: string) => {
    switch (p) {
      case 'google': return 'Google';
      case 'apple': return 'Apple';
      case 'email': return 'E-posta + Sifre';
      default: return p;
    }
  };

  const isLinked = (provider: string) => identities.some(i => i.provider === provider);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Hesap Baglama</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Birden fazla giris yontemi baglayabilirsin. Istedigin yontemi kaldir (en az biri aktif kalmali).
      </Text>

      {/* Current identities */}
      <Card title="Bagli Yontemler">
        {identities.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Yukleniyor...</Text>
        ) : (
          identities.map((id, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: i < identities.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <View>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{providerLabel(id.provider)}</Text>
                {id.email && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{id.email}</Text>}
              </View>
              {id.provider !== 'email' && (
                <Button title="Kaldir" variant="ghost" size="sm" onPress={() => handleUnlink(id.provider)} />
              )}
            </View>
          ))
        )}
      </Card>

      {/* Link new providers */}
      <Card title="Yeni Yontem Bagla">
        {!isLinked('google') && (
          <Button title="Google Bagla" variant="outline" onPress={() => handleLink('google')} loading={loading} style={{ marginBottom: SPACING.xs }} />
        )}
        {!isLinked('apple') && (
          <Button title="Apple Bagla" variant="outline" onPress={() => handleLink('apple')} loading={loading} />
        )}
        {isLinked('google') && isLinked('apple') && (
          <Text style={{ color: COLORS.success, fontSize: FONT.sm, textAlign: 'center' }}>Tum yontemler bagli.</Text>
        )}
      </Card>
    </ScrollView>
  );
}
