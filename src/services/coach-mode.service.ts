/**
 * B2B Coach Mode Service
 * Spec 20.1: Rol/izin sistemi, veri paylaşım onayı, koç dashboard.
 *
 * Provides foundation for coach-client relationships where a
 * professional coach can view and guide multiple client accounts.
 */
import { supabase } from '@/lib/supabase';

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
 * Check if a user has an active coach relationship.
 * Derived from the active-consent state (the coach link lives on
 * coach_consents, not on profiles).
 */
export function isCoachMode(consent: DataSharingConsent | null): boolean {
  return consent != null && consent.active;
}

/**
 * Check if the given userId is a coach (has at least one client).
 * The coach link is modelled through coach_consents (the only table
 * with a coach_id column), not profiles.
 */
export async function isCoach(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('coach_consents')
    .select('id', { count: 'exact', head: true })
    .eq('coach_id', userId)
    .eq('is_active', true);
  return (count ?? 0) > 0;
}

// ────────────────────────────── Client management ──────────────────────────────

/**
 * Get all clients assigned to a coach.
 * Fetches profile basics + latest daily_metrics for last-active and compliance.
 */
export async function getCoachClients(coachId: string): Promise<CoachClient[]> {
  // The coach link lives on coach_consents (the only table with coach_id),
  // not on profiles. Resolve clients via active consents.
  const { data: consents } = await supabase
    .from('coach_consents')
    .select('user_id, shared_data_types')
    .eq('coach_id', coachId)
    .eq('is_active', true);

  if (!consents || consents.length === 0) return [];

  const clients: CoachClient[] = [];

  for (const consent of consents) {
    const clientId = consent.user_id as string;

    // Fetch client profile basics
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, weight_kg')
      .eq('id', clientId)
      .is('deleted_at', null)
      .single();

    if (!profile) continue;

    // Get latest metrics for this client
    // compliance_score lives on daily_reports (keyed on `date`), not daily_metrics.
    const { data: metrics } = await supabase
      .from('daily_reports')
      .select('date, compliance_score')
      .eq('user_id', clientId)
      .order('date', { ascending: false })
      .limit(1);

    // Get active goal
    const { data: goal } = await supabase
      .from('goals')
      .select('goal_type')
      .eq('user_id', clientId)
      .eq('is_active', true)
      .limit(1)
      .single();

    const latestMetric = metrics?.[0];

    clients.push({
      id: profile.id,
      displayName: `Danisan ${(profile.id as string).slice(0, 6)}`, // anonymized
      weight_kg: profile.weight_kg,
      goalType: goal?.goal_type ?? null,
      lastActiveDate: latestMetric?.date ?? null,
      complianceScore: latestMetric?.compliance_score ?? null,
      sharedDataTypes: (consent.shared_data_types as string[]) ?? [],
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

  // Upsert consent record. The relationship is carried entirely by this row
  // (coach_consents is the only table with coach_id); created_at is set by the
  // table default.
  const { error } = await supabase
    .from('coach_consents')
    .upsert(
      {
        user_id: userId,
        coach_id: coachId,
        shared_data_types: validTypes,
        is_active: true,
      },
      { onConflict: 'user_id,coach_id' }
    );

  if (error) throw error;
}

/**
 * Revoke coach access: deactivate the user's consent record(s).
 * The relationship lives entirely on coach_consents, so deactivating the
 * consent is sufficient to remove coach access.
 */
export async function revokeCoachAccess(userId: string): Promise<void> {
  const { error } = await supabase
    .from('coach_consents')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw error;
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
    .eq('is_active', true)
    .single();

  if (!data) return null;

  return {
    userId: data.user_id,
    coachId: data.coach_id,
    dataTypes: data.shared_data_types ?? [],
    grantedAt: data.created_at,
    active: data.is_active,
  };
}
