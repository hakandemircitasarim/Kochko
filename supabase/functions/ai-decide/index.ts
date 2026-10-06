/**
 * ai-decide — service-role dry-run of one strict-schema decision call. No DB access, no writes.
 * Logic and its contract live in handler.ts (unit-tested without a network); this file only
 * binds it to the edge runtime. verify_jwt stays ON (supabase/config.toml).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleDecide } from './handler.ts';

serve((req) => handleDecide(req));
