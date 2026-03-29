/**
 * Restaurant/Venue Memory Service — Spec 2.1
 * Stores frequently visited restaurants/cafes with learned macro estimates.
 * AI uses venue memory to auto-fill macros: "Simit Sarayı'na gittim" → remembered values.
 */
import { supabase } from '@/lib/supabase';

export interface VenueItem {
  name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  confirmed: boolean; // User has confirmed AI's estimate
}

export interface Venue {
  id: string;
  venue_name: string;
  venue_type: string | null; // restaurant, cafeteria, fast_food, cafe
  learned_items: VenueItem[];
  visit_count: number;
  last_visited_at: string | null;
  created_at: string;
}

/**
 * Get all saved venues sorted by visit count.
 */
export async function getVenues(): Promise<Venue[]> {
  const { data } = await supabase.from('user_venues').select('*').order('visit_count', { ascending: false });
  return (data ?? []) as Venue[];
}

/**
 * Add or update a venue. Upserts on user_id + venue_name.
 */
export async function addOrUpdateVenue(
  venueName: string,
  venueType: string | null,
  items: VenueItem[],
): Promise<void> {
  await supabase.from('user_venues').upsert({
    venue_name: venueName.trim(),
    venue_type: venueType,
    learned_items: items,
    last_visited_at: new Date().toISOString(),
  }, { onConflict: 'user_id,venue_name' });
}

/**
 * Increment visit count when user mentions a venue.
 */
export async function incrementVisit(venueName: string): Promise<void> {
  const { data } = await supabase
    .from('user_venues')
    .select('visit_count')
    .eq('venue_name', venueName)
    .single();

  if (data) {
    await supabase.from('user_venues').update({
      visit_count: ((data.visit_count as number) ?? 0) + 1,
      last_visited_at: new Date().toISOString(),
    }).eq('venue_name', venueName);
  }
}

/**
 * Search venues by name (for auto-complete in chat).
 */
export async function searchVenues(query: string): Promise<Venue[]> {
  const { data } = await supabase
    .from('user_venues')
    .select('*')
    .ilike('venue_name', `%${query}%`)
    .order('visit_count', { ascending: false })
    .limit(5);
  return (data ?? []) as Venue[];
}

/**
 * Update a specific learned item's macro estimate.
 * Used when user confirms or corrects AI's estimate.
 */
export async function updateLearnedItem(
  venueId: string,
  itemIndex: number,
  updates: Partial<VenueItem>,
): Promise<void> {
  const { data } = await supabase.from('user_venues').select('learned_items').eq('id', venueId).single();
  if (!data?.learned_items) return;

  const items = data.learned_items as VenueItem[];
  if (items[itemIndex]) {
    items[itemIndex] = { ...items[itemIndex], ...updates };
    await supabase.from('user_venues').update({ learned_items: items }).eq('id', venueId);
  }
}

/**
 * Add a new learned item to a venue.
 */
export async function addLearnedItem(venueId: string, item: VenueItem): Promise<void> {
  const { data } = await supabase.from('user_venues').select('learned_items').eq('id', venueId).single();
  const items = ((data?.learned_items as VenueItem[]) ?? []);
  items.push(item);
  await supabase.from('user_venues').update({ learned_items: items }).eq('id', venueId);
}

/**
 * Remove a learned item from a venue.
 */
export async function removeLearnedItem(venueId: string, itemIndex: number): Promise<void> {
  const { data } = await supabase.from('user_venues').select('learned_items').eq('id', venueId).single();
  if (!data?.learned_items) return;

  const items = (data.learned_items as VenueItem[]).filter((_, i) => i !== itemIndex);
  await supabase.from('user_venues').update({ learned_items: items }).eq('id', venueId);
}

/**
 * Delete a venue entirely.
 */
export async function deleteVenue(venueId: string): Promise<void> {
  await supabase.from('user_venues').delete().eq('id', venueId);
}
