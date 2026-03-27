/**
 * Handles actions detected by the AI coach.
 * Parses the <actions> block and executes database operations.
 */

import { supabaseAdmin } from '../shared/supabase-admin.ts';

interface MealItem {
  name: string;
  portion: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/**
 * Extracts actions from AI response text.
 * Returns cleaned message (without action block) and parsed actions.
 */
export function extractActions(text: string): { cleanMessage: string; actions: Action[] } {
  let actions: Action[] = [];
  const match = text.match(/<actions>([\s\S]*?)<\/actions>/);

  if (match) {
    try {
      actions = JSON.parse(match[1]);
    } catch {
      // Malformed JSON - ignore actions
    }
  }

  const cleanMessage = text.replace(/<actions>[\s\S]*?<\/actions>/, '').trim();
  return { cleanMessage, actions };
}

/**
 * Executes all detected actions against the database.
 */
export async function executeActions(
  userId: string,
  actions: Action[],
  existingWater: number,
): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0];
  const executed: string[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'meal_log': {
          // Create meal log
          const { data: mealLog } = await supabaseAdmin.from('meal_logs').insert({
            user_id: userId,
            raw_input: action.raw ?? '',
            meal_type: action.meal_type ?? 'snack',
            logged_at: new Date().toISOString(),
            synced: true,
          }).select('id').single();

          // Insert parsed items if available
          if (mealLog && action.items && action.items.length > 0) {
            const rows = action.items.map(item => ({
              meal_log_id: mealLog.id,
              food_name: item.name,
              portion_text: item.portion,
              portion_grams: null,
              calories: Math.max(0, Math.round(item.calories)),
              protein_g: Math.max(0, Math.round(item.protein_g * 10) / 10),
              carbs_g: Math.max(0, Math.round(item.carbs_g * 10) / 10),
              fat_g: Math.max(0, Math.round(item.fat_g * 10) / 10),
              user_corrected: false,
            }));
            await supabaseAdmin.from('meal_log_items').insert(rows);
          }
          executed.push('Ogun kaydedildi');
          break;
        }

        case 'workout_log': {
          await supabaseAdmin.from('workout_logs').insert({
            user_id: userId,
            raw_input: action.raw ?? '',
            workout_type: action.workout_type ?? '',
            duration_min: action.duration_min ?? 0,
            intensity: action.intensity ?? 'moderate',
            calories_burned: action.calories_burned ?? 0,
            logged_at: new Date().toISOString(),
            synced: true,
          });
          executed.push('Antrenman kaydedildi');
          break;
        }

        case 'weight_log': {
          if (action.value && action.value > 20 && action.value < 300) {
            await supabaseAdmin.from('daily_metrics').upsert({
              user_id: userId,
              date: today,
              weight_kg: action.value,
              water_liters: existingWater,
              synced: true,
            }, { onConflict: 'user_id,date' });

            // Also update profile weight
            await supabaseAdmin.from('profiles')
              .update({ weight_kg: action.value, updated_at: new Date().toISOString() })
              .eq('id', userId);
            executed.push('Tarti kaydedildi');
          }
          break;
        }

        case 'water_log': {
          if (action.liters && action.liters > 0) {
            const newTotal = existingWater + action.liters;
            await supabaseAdmin.from('daily_metrics').upsert({
              user_id: userId,
              date: today,
              water_liters: newTotal,
              synced: true,
            }, { onConflict: 'user_id,date' });
            executed.push(`Su kaydedildi (+${action.liters}L)`);
          }
          break;
        }

        case 'sleep_log': {
          if (action.hours && action.hours > 0 && action.hours < 24) {
            await supabaseAdmin.from('daily_metrics').upsert({
              user_id: userId,
              date: today,
              sleep_hours: action.hours,
              water_liters: existingWater,
              synced: true,
            }, { onConflict: 'user_id,date' });
            executed.push('Uyku kaydedildi');
          }
          break;
        }

        case 'mood_note': {
          if (action.note) {
            await supabaseAdmin.from('daily_metrics').upsert({
              user_id: userId,
              date: today,
              mood_note: action.note,
              water_liters: existingWater,
              synced: true,
            }, { onConflict: 'user_id,date' });
            executed.push('Not kaydedildi');
          }
          break;
        }

        case 'commitment': {
          if (action.text) {
            const followUpDate = new Date();
            followUpDate.setDate(followUpDate.getDate() + (action.follow_up_days ?? 1));
            await supabaseAdmin.from('user_commitments').insert({
              user_id: userId,
              commitment: action.text,
              follow_up_at: followUpDate.toISOString(),
              status: 'pending',
            });
            executed.push('Taahhut kaydedildi - takip edilecek');
          }
          break;
        }

        case 'profile_update': {
          // Update profile fields from conversation
          const profileUpdates: Record<string, unknown> = {};
          if (action.height_cm) profileUpdates.height_cm = action.height_cm;
          if (action.weight_kg) profileUpdates.weight_kg = action.weight_kg;
          if (action.birth_year) profileUpdates.birth_year = action.birth_year;
          if (action.gender) profileUpdates.gender = action.gender;

          if (Object.keys(profileUpdates).length > 0) {
            profileUpdates.updated_at = new Date().toISOString();
            await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);

            // Check if we have enough info to complete onboarding
            const { data: currentProfile } = await supabaseAdmin
              .from('profiles').select('height_cm, weight_kg, birth_year, gender, onboarding_completed')
              .eq('id', userId).single();

            if (currentProfile && !currentProfile.onboarding_completed
              && currentProfile.height_cm && currentProfile.weight_kg
              && currentProfile.birth_year && currentProfile.gender) {
              await supabaseAdmin.from('profiles')
                .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
                .eq('id', userId);
              executed.push('Profil tamamlandi!');
            } else {
              executed.push('Profil guncellendi');
            }
          }

          // Create goal if target weight provided
          if (action.target_weight_kg) {
            await supabaseAdmin.from('goals').insert({
              user_id: userId,
              target_weight_kg: action.target_weight_kg,
              target_weeks: action.target_weeks ?? 12,
              priority: 'sustainable',
              weekly_loss_rate: 0.5,
              daily_calorie_min: 1400,
              daily_calorie_max: 1800,
              daily_protein_min: 100,
              daily_steps_target: 8000,
              daily_water_target: 2.0,
              is_active: true,
            });
            executed.push('Hedef belirlendi');
          }
          break;
        }
      }
    } catch {
      // Individual action failure shouldn't block others
    }
  }

  return executed;
}

// Extended Action interface
interface Action {
  type: string;
  raw?: string;
  meal_type?: string;
  items?: MealItem[];
  workout_type?: string;
  duration_min?: number;
  intensity?: string;
  calories_burned?: number;
  value?: number;
  liters?: number;
  hours?: number;
  note?: string;
  text?: string;
  follow_up_days?: number;
  height_cm?: number;
  weight_kg?: number;
  birth_year?: number;
  gender?: string;
  target_weight_kg?: number;
  target_weeks?: number;
}
