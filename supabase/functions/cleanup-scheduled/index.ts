/**
 * Scheduled Cleanup Runner (Spec 18.2)
 *
 * Called by pg_cron every 15 minutes. Processes pending scheduled_cleanups
 * rows whose scheduled_at has passed:
 *   - meal_photo / progress_photo: delete storage object + DB row, mark done
 *   - export: delete generated export file, mark done
 *   - temp_data: delete DB row referenced by target_table+target_id, mark done
 *
 * Keeps per-row error isolation so one failure doesn't block the batch.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';

const STORAGE_BUCKET = 'user-uploads';

interface CleanupRow {
  id: string;
  user_id: string;
  resource_type: string | null;
  resource_id: string | null;
  cleanup_type: string | null;
  target_table: string | null;
  target_id: string | null;
  scheduled_at: string | null;
  scheduled_for: string | null;
  status: string | null;
}

serve(async () => {
  try {
    const now = new Date().toISOString();

    // Fetch up to 200 pending rows due now (status pending AND time reached via either column)
    const { data: rows, error } = await supabaseAdmin
      .from('scheduled_cleanups')
      .select('id, user_id, resource_type, resource_id, cleanup_type, target_table, target_id, scheduled_at, scheduled_for, status')
      .eq('status', 'pending')
      .or(`scheduled_at.lte.${now},scheduled_for.lte.${now}`)
      .limit(200);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const pending = (rows ?? []) as CleanupRow[];
    let processed = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        const type = row.resource_type ?? row.cleanup_type ?? '';
        const ref = row.resource_id ?? row.target_id ?? '';

        if (type === 'meal_photo' || type === 'photo' || type === 'progress_photo') {
          // Delete storage object if ref looks like a path/url
          if (ref) {
            const path = ref.includes('/') ? ref.split(STORAGE_BUCKET + '/')[1] ?? ref : ref;
            await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]).catch(() => {});
          }
          // Delete DB row for progress_photos if target_table points there
          if (row.target_table === 'progress_photos' && row.target_id) {
            await supabaseAdmin.from('progress_photos').delete().eq('id', row.target_id);
          }
        } else if (type === 'export') {
          if (ref) {
            const path = ref.includes('/') ? ref.split(STORAGE_BUCKET + '/')[1] ?? ref : ref;
            await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]).catch(() => {});
          }
        } else if (type === 'temp_data' && row.target_table && row.target_id) {
          await supabaseAdmin.from(row.target_table).delete().eq('id', row.target_id);
        }

        await supabaseAdmin
          .from('scheduled_cleanups')
          .update({ status: 'done', executed_at: now })
          .eq('id', row.id);
        processed++;
      } catch (err) {
        console.error(`[cleanup] row ${row.id} failed:`, (err as Error).message);
        await supabaseAdmin
          .from('scheduled_cleanups')
          .update({ status: 'failed', executed_at: now, metadata: { error: (err as Error).message } })
          .eq('id', row.id).catch(() => {});
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed, failed, total: pending.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
