/**
 * B2B Coach Mode Service
 * Spec 20.1: Rol/izin sistemi, veri paylaşım onayı, koç dashboard.
 *
 * Provides foundation for coach-client relationships where a
 * professional coach can view and guide multiple client accounts.
 */
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

// ────────────────────────────── Types ──────────────────────────────

export interface CoachClient {
  id: string;
  displayName: string;
  weight_kg: number | null;
  goalType: string | null;
  lastActiveDate: string | null;
  complianceScore: number | null;
  sharedDataTypes: string[];
}

export interface DataSharingConsent {
  userId: string;
  coachId: string;
  dataTypes: string[];
  grantedAt: string;
  active: boolean;
}

/**
 * Valid data types that can be shared with a coach.
 */
export const SHAREABLE_DATA_TYPES = [
  'meals',
  'metrics',
  'weight',
  'goals',
  'plans',
  'chat_summary',
  'reports',
] as const;

export type ShareableDataType = (typeof SHAREABLE_DATA_TYPES)[number];

// ────────────────────────────── Coach checks ──────────────────────────────

/**
 * Check if a profile has an active coach relationship.
 */
export function isCoachMode(profile: Pick<Profile, 'id'> & { coach_id?: string | null }): boolean {
  return profile.coach_id != null && profile.coach_id.length > 0;
}

/**
 * Check if the given userId is a coach (has at least one client).
 */
export async function isCoach(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('coach_id', userId);
  return (count ?? 0) > 0;
}

// ────────────────────────────── Client management ──────────────────────────────

/**
 * Get all clients assigned to a coach.
 * Fetches profile basics + latest daily_metrics for last-active and compliance.
 */
export async function getCoachClients(coachId: string): Promise<CoachClient[]> {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, weight_kg, created_at, updated_at')
    .eq('coach_id', coachId)
    .is('deleted_at', null);

  if (!profiles || profiles.length === 0) return [];

  const clients: CoachClient[] = [];

  for (const p of profiles) {
    // Get latest metrics for this client
    const { data: metrics } = await supabase
      .from('daily_metrics')
      .select('log_date, compliance_score')
      .eq('user_id', p.id)
      .order('log_date', { ascending: false })
      .limit(1);

    // Get active goal
    const { data: goal } = await supabase
      .from('goals')
      .select('goal_type')
      .eq('user_id', p.id)
      .eq('is_active', true)
      .limit(1)
      .single();

    // Get consent data types
    const { data: consent } = await supabase
      .from('coach_consents')
      .select('data_types')
      .eq('user_id', p.id)
      .eq('coach_id', coachId)
      .eq('active', true)
      .single();

    const latestMetric = metrics?.[0];

    clients.push({
      id: p.id,
      displayName: `Danisan ${p.id.slice(0, 6)}`, // anonymized
      weight_kg: p.weight_kg,
      goalType: goal?.goal_type ?? null,
      lastActiveDate: latestMetric?.log_date ?? null,
      complianceScore: latestMetric?.compliance_score ?? null,
      sharedDataTypes: consent?.data_types ?? [],
    });
  }

  return clients;
}

// ────────────────────────────── Data sharing ──────────────────────────────

/**
 * Create or update data sharing consent between a user and their coach.
 * The user explicitly grants which data types the coach can see.
 */
export async function shareDataWithCoach(
  userId: string,
  coachId: string,
  dataTypes: string[]
): Promise<void> {
  // Validate data types
  const validTypes = dataTypes.filter((dt) =>
    (SHAREABLE_DATA_TYPES as readonly string[]).includes(dt)
  );

  if (validTypes.length === 0) {
    throw new Error('En az bir gecerli veri tipi secilmelidir.');
  }

  // Upsert consent record
  const { error } = await supabase
    .from('coach_consents')
    .upsert(
      {
        user_id: userId,
        coach_id: coachId,
        data_types: validTypes,
        granted_at: new Date().toISOString(),
        active: true,
      },
      { onConflict: 'user_id,coach_id' }
    );

  if (error) throw error;

  // Set coach_id on profile
  await supabase
    .from('profiles')
    .update({ coach_id: coachId })
    .eq('id', userId);
}

/**
 * Revoke coach access: remove coach_id from profile and deactivate consent.
 */
export async function revokeCoachAccess(userId: string): Promise<void> {
  // Deactivate all consents
  await supabase
    .from('coach_consents')
    .update({ active: false })
    .eq('user_id', userId);

  // Clear coach_id from profile
  await supabase
    .from('profiles')
    .update({ coach_id: null })
    .eq('id', userId);
}

/**
 * Get active consent details for a user.
 */
export async function getActiveConsent(
  userId: string
): Promise<DataSharingConsent | null> {
  const { data } = await supabase
    .from('coach_consents')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .single();

  if (!data) return null;

  return {
    userId: data.user_id,
    coachId: data.coach_id,
    dataTypes: data.data_types ?? [],
    grantedAt: data.granted_at,
    active: data.active,
  };
}
