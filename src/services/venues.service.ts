/**
 * Restaurant/Venue Memory Service
 * Spec 2.1: Sık gidilen mekanlar ve öğrenilen makro tahminleri
 */
import { supabase } from '@/lib/supabase';

export interface Venue {
  id: string;
  venue_name: string;
  venue_type: string | null;
  learned_items: { name: string; calories: number; protein_g?: number; confirmed: boolean }[];
  visit_count: number;
}

export async function getVenues(): Promise<Venue[]> {
  const { data } = await supabase.from('user_venues').select('*').order('visit_count', { ascending: false });
  return (data ?? []) as Venue[];
}

export async function deleteVenue(id: string): Promise<void> {
  await supabase.from('user_venues').delete().eq('id', id);
}

export async function addOrUpdateVenue(
  userId: string,
  venueName: string,
  venueType: string | null,
  items: Venue['learned_items']
): Promise<void> {
  await supabase.from('user_venues').upsert({
    user_id: userId,
    venue_name: venueName,
    venue_type: venueType,
    learned_items: items,
  }, { onConflict: 'user_id,venue_name' });
}

export async function incrementVisit(venueName: string): Promise<void> {
  const { data } = await supabase.from('user_venues').select('visit_count').eq('venue_name', venueName).single();
  if (data) {
    await supabase.from('user_venues').update({ visit_count: (data.visit_count ?? 0) + 1 }).eq('venue_name', venueName);
  }
}

/**
 * Auto-learn venue items from a meal log.
 * Merges new items into existing learned_items and increments visit count.
 */
export async function learnFromMealLog(
  userId: string,
  venueName: string,
  items: { name: string; calories: number; protein_g?: number }[],
): Promise<void> {
  // Fetch existing venue data
  const { data: existing } = await supabase
    .from('user_venues')
    .select('learned_items, visit_count')
    .eq('venue_name', venueName)
    .single();

  const existingItems: Venue['learned_items'] = (existing?.learned_items as Venue['learned_items']) ?? [];

  // Merge: update existing items' calories if they differ, add new ones
  const merged = [...existingItems];
  for (const item of items) {
    const lowerName = item.name.toLowerCase();
    const existingIdx = merged.findIndex(m => m.name.toLowerCase() === lowerName);
    if (existingIdx >= 0) {
      // Update calorie estimate (average with previous)
      merged[existingIdx] = {
        ...merged[existingIdx],
        calories: Math.round((merged[existingIdx].calories + item.calories) / 2),
        protein_g: item.protein_g ?? merged[existingIdx].protein_g,
      };
    } else {
      merged.push({
        name: item.name,
        calories: item.calories,
        protein_g: item.protein_g,
        confirmed: false,
      });
    }
  }

  const newVisitCount = (existing?.visit_count ?? 0) + 1;

  await addOrUpdateVenue(userId, venueName, null, merged);
  await supabase
    .from('user_venues')
    .update({ visit_count: newVisitCount })
    .eq('venue_name', venueName);
}

/**
 * Get recommended venues — most visited with learned items.
 */
export async function getRecommendedVenues(limit = 5): Promise<Venue[]> {
  const { data } = await supabase
    .from('user_venues')
    .select('*')
    .order('visit_count', { ascending: false })
    .limit(limit);

  return ((data ?? []) as Venue[]).filter(v => v.learned_items.length > 0);
}

/**
 * Get menu history for a specific venue.
 */
export async function getVenueMenuHistory(venueName: string): Promise<Venue['learned_items']> {
  const { data } = await supabase
    .from('user_venues')
    .select('learned_items')
    .eq('venue_name', venueName)
    .single();

  return (data?.learned_items as Venue['learned_items']) ?? [];
}
