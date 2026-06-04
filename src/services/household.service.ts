/**
 * Household / Family Service
 * Spec 20.4: Aile planı, ortak alışveriş listesi, paylaşılan tarifler.
 *
 * Provides household creation, membership management, invite codes,
 * and aggregated shopping lists from all members' weekly plans.
 */
import { supabase } from '@/lib/supabase';

// ────────────────────────────── Types ──────────────────────────────

export interface HouseholdMember {
  userId: string;
  displayName: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
}

export interface ShoppingListItem {
  ingredient: string;
  totalAmount: number;
  unit: string;
  memberIds: string[];
}

// ────────────────────────────── Helpers ──────────────────────────────

/**
 * Generate a short, human-readable invite code (6 alphanumeric chars).
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ────────────────────────────── Household CRUD ──────────────────────────────

/**
 * Create a new household. The creating user becomes the owner.
 */
export async function createHousehold(
  userId: string,
  name?: string
): Promise<Household> {
  const inviteCode = generateInviteCode();
  const householdName = name ?? 'Ailem';

  const { data, error } = await supabase
    .from('households')
    .insert({
      name: householdName,
      invite_code: inviteCode,
      owner_id: userId,
    })
    .select()
    .single();

  if (error || !data) throw error ?? new Error('Aile olusturulamadi.');

  // Add owner as first member (household_members is the source of truth)
  const { error: memberError } = await supabase
    .from('household_members')
    .insert({
      household_id: data.id,
      user_id: userId,
      role: 'owner',
    });

  if (memberError) throw memberError;

  return {
    id: data.id,
    name: data.name,
    inviteCode: data.invite_code,
    ownerId: data.owner_id,
    createdAt: data.created_at,
  };
}

/**
 * Join an existing household by invite code.
 */
export async function joinHousehold(
  userId: string,
  inviteCode: string
): Promise<Household> {
  // Look up household by invite code
  const { data: household, error: findError } = await supabase
    .from('households')
    .select('*')
    .eq('invite_code', inviteCode.toUpperCase().trim())
    .single();

  if (findError || !household) {
    throw new Error('Gecersiz davet kodu.');
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', household.id)
    .eq('user_id', userId)
    .single();

  if (existing) {
    throw new Error('Zaten bu aileye uyesiniz.');
  }

  // Add as member
  const { error: joinError } = await supabase
    .from('household_members')
    .insert({
      household_id: household.id,
      user_id: userId,
      role: 'member',
    });

  if (joinError) throw joinError;

  return {
    id: household.id,
    name: household.name,
    inviteCode: household.invite_code,
    ownerId: household.owner_id,
    createdAt: household.created_at,
  };
}

/**
 * Leave a household. If the user is the owner, the household is dissolved.
 */
export async function leaveHousehold(userId: string, householdId: string): Promise<void> {
  // Check if owner
  const { data: membership } = await supabase
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();

  if (membership?.role === 'owner') {
    // Dissolve: remove all members, delete household.
    // Deleting the household_members rows is sufficient; membership is the
    // single source of truth (profiles has no household_id column).
    const { error: membersError } = await supabase
      .from('household_members')
      .delete()
      .eq('household_id', householdId);
    if (membersError) throw membersError;

    const { error: householdError } = await supabase
      .from('households')
      .delete()
      .eq('id', householdId);
    if (householdError) throw householdError;
  } else {
    // Just remove this member
    const { error: memberError } = await supabase
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId);
    if (memberError) throw memberError;
  }
}

// ────────────────────────────── Member queries ──────────────────────────────

/**
 * Get all members of a household.
 */
export async function getHouseholdMembers(
  householdId: string
): Promise<HouseholdMember[]> {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, joined_at')
    .eq('household_id', householdId)
    .order('joined_at', { ascending: true });

  if (error) console.warn('getHouseholdMembers failed', error);
  if (!data) return [];

  return data.map((m, i) => ({
    userId: m.user_id,
    displayName: m.role === 'owner' ? 'Aile Reisi' : `Uye ${i + 1}`,
    role: m.role as 'owner' | 'member',
    joinedAt: m.joined_at,
  }));
}

/**
 * Get the household info for a user (if any).
 */
export async function getUserHousehold(userId: string): Promise<Household | null> {
  // Resolve membership through the household_members join table
  // (the source of truth; profiles has no household_id column).
  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership?.household_id) return null;

  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('id', membership.household_id)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    inviteCode: data.invite_code,
    ownerId: data.owner_id,
    createdAt: data.created_at,
  };
}

// ────────────────────────────── Shared Shopping List ──────────────────────────────

/**
 * Aggregate shopping lists from all household members' active weekly plans.
 * Combines identical ingredients, sums amounts, and tracks which members need them.
 */
export async function getSharedShoppingList(
  householdId: string
): Promise<ShoppingListItem[]> {
  // Get all member user IDs
  const { data: members } = await supabase
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId);

  if (!members || members.length === 0) return [];

  const memberIds = members.map((m) => m.user_id);

  // Get current week start
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - diff);
  const weekStart = now.toISOString().slice(0, 10);

  // Fetch each member's weekly plan and read its embedded shopping_list JSON.
  // (There is no weekly_plan_shopping table; the list lives on weekly_plans.)
  const { data: plans, error } = await supabase
    .from('weekly_plans')
    .select('user_id, shopping_list, week_start')
    .in('user_id', memberIds)
    .gte('week_start', weekStart);

  if (error) console.warn('getSharedShoppingList failed', error);
  if (!plans || plans.length === 0) return [];

  // Aggregate by ingredient name. shopping_list items are
  // { category, name, amount (free-text string), checked }; there is no
  // numeric quantity, so we keep the amount string as the unit label and use
  // totalAmount to count how many members need the item.
  const aggregated = new Map<string, ShoppingListItem>();

  for (const plan of plans) {
    const list = (plan.shopping_list as
      | { name?: string; amount?: string }[]
      | null) ?? [];

    for (const item of list) {
      const name = item.name?.trim();
      if (!name) continue;

      const key = name.toLowerCase();
      const existing = aggregated.get(key);

      if (existing) {
        if (!existing.memberIds.includes(plan.user_id)) {
          existing.memberIds.push(plan.user_id);
          existing.totalAmount += 1;
        }
      } else {
        aggregated.set(key, {
          ingredient: name,
          totalAmount: 1,
          unit: item.amount ?? '',
          memberIds: [plan.user_id],
        });
      }
    }
  }

  return Array.from(aggregated.values()).sort((a, b) =>
    a.ingredient.localeCompare(b.ingredient, 'tr')
  );
}
