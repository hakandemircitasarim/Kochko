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

export async function addOrUpdateVenue(
  venueName: string,
  venueType: string | null,
  items: Venue['learned_items']
): Promise<void> {
  await supabase.from('user_venues').upsert({
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
