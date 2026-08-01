/**
 * Telemetri gönderimi — istemci hata + analitik tamponlarını sunucuya taşır.
 *
 * NEDEN VAR: `reportError()` son 50 hatayı RAM'deki bir halkaya, `trackEvent()` olayları
 * 1000'lik bir tampona yazıyordu ve İKİSİNİN DE gönderen tarafı yoktu — `flushEventBuffer()`
 * diziyi yalnızca döndürüyor, hiçbir yerden çağrılmıyordu. Uygulama kapandığı anda hepsi
 * kayboluyordu: kapalı testte "uygulama çöktü" diyen bir testçiden gelen tek kanıt kendi
 * cümlesiydi. Bu dosya o boşluğu kapatır.
 *
 * TASARIM KURALLARI:
 * - Telemetri ASLA kullanıcı akışını bozmaz: her hata yutulur, hiçbir uyarı gösterilmez.
 * - `client_events` tablosu CANLIDA HENÜZ YOKSA (migration 103 uygulanmadıysa) gönderim
 *   sessizce kapanır ve kayıtlar yerelde kalır — Debug ekranı onları yine gösterir.
 *   Yani bu kod tablo olmadan da güvenle çalışır, sadece uzak kopya oluşmaz.
 * - Tampon geri konur: gönderim başarısızsa kayıtlar KAYBOLMAZ, bir sonraki denemeye kalır.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { drainErrors, restoreErrors } from '@/lib/sentry';
import { flushEventBuffer, restoreEventBuffer, type AnalyticsEvent } from '@/services/analytics.service';

/**
 * Tablo yoksa (PGRST205 / 42P01) her arka plana geçişte tekrar denemenin anlamı yok —
 * oturum boyunca kapat. Uygulama yeniden açıldığında yeniden denenir (migration
 * bu arada uygulanmış olabilir).
 */
let sinkDisabledForSession = false;
let inFlight = false;

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) ?? 'bilinmiyor';

type Row = {
  user_id: string;
  kind: 'error' | 'event';
  name: string;
  stack: string | null;
  props: Record<string, unknown>;
  app_version: string;
  platform: string;
  occurred_at: string;
};

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // PostgREST şema önbelleğinde yok / Postgres 'relation does not exist'
  return err.code === 'PGRST205' || err.code === '42P01' || /client_events/i.test(err.message ?? '') && /does not exist|schema cache/i.test(err.message ?? '');
}

/**
 * Biriken hata + olayları gönder. Güvenle sık çağrılabilir (arka plana geçiş, açılış).
 * Hiçbir zaman throw etmez.
 */
export async function flushTelemetry(userId: string): Promise<void> {
  if (sinkDisabledForSession || inFlight || !userId) return;

  const errors = drainErrors();
  const events = flushEventBuffer();
  if (errors.length === 0 && events.length === 0) return;

  inFlight = true;
  try {
    const rows: Row[] = [
      ...errors.map((e) => ({
        user_id: userId,
        kind: 'error' as const,
        // Mesaj sütunu NOT NULL — boş mesajlı bir istisna satırı tamamen düşürmektense
        // dürüst bir yer tutucu ile sakla.
        name: (e.message || 'bilinmeyen hata').slice(0, 500),
        stack: e.stack ? e.stack.slice(0, 4000) : null,
        props: e.context ?? {},
        app_version: APP_VERSION,
        platform: Platform.OS,
        occurred_at: e.at,
      })),
      ...events.map((ev: AnalyticsEvent) => ({
        user_id: userId,
        kind: 'event' as const,
        name: ev.eventName.slice(0, 500),
        stack: null,
        props: ev.properties ?? {},
        app_version: APP_VERSION,
        platform: Platform.OS,
        occurred_at: new Date(ev.timestamp).toISOString(),
      })),
    ];

    const { error } = await supabase.from('client_events').insert(rows);
    if (error) {
      if (isMissingTable(error)) {
        // Migration 103 henüz uygulanmamış — sessizce yerel moda düş.
        sinkDisabledForSession = true;
      }
      // Başarısızsa kaybetme: iki tamponu da geri koy.
      restoreErrors(errors);
      restoreEventBuffer(events);
    }
  } catch {
    // Ağ yok / beklenmeyen: kayıtlar geri konur, sessiz kalırız.
    restoreErrors(errors);
    restoreEventBuffer(events);
  } finally {
    inFlight = false;
  }
}
