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

  // Add owner as first member
  await supabase.from('household_members').insert({
    household_id: data.id,
    user_id: userId,
    role: 'owner',
  });

  // Set household_id on profile
  await supabase
    .from('profiles')
    .update({ household_id: data.id })
    .eq('id', userId);

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

  // Update profile
  await supabase
    .from('profiles')
    .update({ household_id: household.id })
    .eq('id', userId);

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
    // Dissolve: remove all members, delete household
    await supabase.from('household_members').delete().eq('household_id', householdId);
    await supabase.from('households').delete().eq('id', householdId);

    // Clear household_id from all former members
    await supabase
      .from('profiles')
      .update({ household_id: null })
      .eq('household_id', householdId);
  } else {
    // Just remove this member
    await supabase
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId);

    await supabase
      .from('profiles')
      .update({ household_id: null })
      .eq('id', userId);
  }
}

// ────────────────────────────── Member queries ──────────────────────────────

/**
 * Get all members of a household.
 */
export async function getHouseholdMembers(
  householdId: string
): Promise<HouseholdMember[]> {
  const { data } = await supabase
    .from('household_members')
    .select('user_id, role, created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });

  if (!data) return [];

  return data.map((m, i) => ({
    userId: m.user_id,
    displayName: m.role === 'owner' ? 'Aile Reisi' : `Uye ${i + 1}`,
    role: m.role as 'owner' | 'member',
    joinedAt: m.created_at,
  }));
}

/**
 * Get the household info for a user (if any).
 */
export async function getUserHousehold(userId: string): Promise<Household | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('household_id')
    .eq('id', userId)
    .single();

  if (!profile?.household_id) return null;

  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('id', profile.household_id)
    .single();

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

  // Fetch shopping items from all members' weekly plans
  const { data: items } = await supabase
    .from('weekly_plan_shopping')
    .select('ingredient, amount, unit, user_id')
    .in('user_id', memberIds)
    .gte('week_start', weekStart);

  if (!items || items.length === 0) return [];

  // Aggregate by ingredient + unit
  const aggregated = new Map<string, ShoppingListItem>();

  for (const item of items) {
    const key = `${item.ingredient.toLowerCase()}|${item.unit}`;
    const existing = aggregated.get(key);

    if (existing) {
      existing.totalAmount += item.amount ?? 0;
      if (!existing.memberIds.includes(item.user_id)) {
        existing.memberIds.push(item.user_id);
      }
    } else {
      aggregated.set(key, {
        ingredient: item.ingredient,
        totalAmount: item.amount ?? 0,
        unit: item.unit ?? '',
        memberIds: [item.user_id],
      });
    }
  }

  return Array.from(aggregated.values()).sort((a, b) =>
    a.ingredient.localeCompare(b.ingredient, 'tr')
  );
}
