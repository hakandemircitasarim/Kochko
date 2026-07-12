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
  // One household per user (uniq_household_member_per_user enforces this at the
  // DB too) — pre-check so the user gets a clear message instead of a 23505.
  const existing = await getUserHousehold(userId);
  if (existing) throw new Error('Zaten bir ailenin uyesisin. Once mevcut aileden ayril.');

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

  if (error || !data) throw error ?? new Error('Aile oluşturulamadı.');

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
  _userId: string,
  inviteCode: string
): Promise<Household> {
  // SECURITY DEFINER RPC (migration 043): a non-member can't SELECT the
  // households row under RLS, so the old code-lookup ALWAYS failed with
  // "Gecersiz davet kodu" — the join flow was structurally dead.
  const { data, error } = await supabase.rpc('join_household_by_code', {
    p_code: inviteCode.toUpperCase().trim(),
  });

  if (error) throw new Error('Katılım başarısız: ' + error.message);
  const result = data as { ok: boolean; error?: string; household?: Record<string, unknown> } | null;
  if (!result?.ok || !result.household) {
    throw new Error(result?.error ?? 'Geçersiz davet kodu.');
  }

  const h = result.household;
  return {
    id: h.id as string,
    name: h.name as string,
    inviteCode: h.invite_code as string,
    ownerId: h.owner_id as string,
    createdAt: h.created_at as string,
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
  // limit(1): legacy data could hold multiple memberships (pre-043 there was
  // no per-user unique index) and maybeSingle() errors → null on multi-row,
  // which made the screen show "Aile Oluştur" to an existing member.
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1);
  const membership = memberships?.[0];

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
  _householdId: string
): Promise<ShoppingListItem[]> {
  // SECURITY DEFINER RPC (migration 043): weekly_plans RLS only lets a user see
  // their OWN rows, so the old .in('user_id', memberIds) query silently
  // filtered other members out — the "shared" list was never shared.
  const { data, error } = await supabase.rpc('get_household_shopping_list');
  if (error) {
    console.warn('getSharedShoppingList failed', error);
    return [];
  }

  const plans = (data as { user_id: string; week_start: string; shopping_list: unknown }[] | null) ?? [];
  if (plans.length === 0) return [];

  // Aggregate by ingredient name. shopping_list may be FLAT
  // [{category,name,amount,checked}] or GROUPED [{category,items:[{name,amount}]}]
  // (the raw AI shape) — flatten both. totalAmount counts how many members need it.
  const aggregated = new Map<string, ShoppingListItem>();

  for (const plan of plans) {
    const raw = Array.isArray(plan.shopping_list) ? plan.shopping_list : [];
    const flat: { name?: string; amount?: string }[] = [];
    for (const entry of raw as { name?: string; amount?: string; items?: { name?: string; amount?: string }[] }[]) {
      if (Array.isArray(entry.items)) flat.push(...entry.items);
      else flat.push(entry);
    }

    for (const item of flat) {
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
