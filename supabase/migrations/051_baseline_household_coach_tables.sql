-- 051: households / household_members / coach_consents baseline (CREATE IF NOT EXISTS)
--
-- AMAÇ: Bu üç tablo canlı veritabanında ELLE açılmış ama hiçbir migration'da
-- CREATE TABLE yok (repo geneli 'create table ... households/...' araması BOŞ).
-- Migration 040 (RLS), 043 (RPC/index), 050 (policy) hepsi tablonun zaten var
-- olduğunu VARSAYIYOR. Sıfırdan temiz bir DB'de `supabase db reset` migration 040'ta
-- "relation does not exist" ile patlardı. Bu baseline, zinciri temiz ortamda tamir eder.
--
-- KANONİK NUMARALANDIRMA NOTU (corrections.md "Düzeltme 3"): kesirli ad (039a) Supabase
-- CLI sıralama/repair ile riskli olduğundan baseline, yeni en-son slota (051) konuldu.
-- Tablolar/kolonlar canlıda zaten mevcut olduğu için CREATE TABLE/COLUMN IF NOT EXISTS
-- canlıda NO-OP'tur; mantıksal "040'tan önce" sırası önemini yitirir (idempotent).
--
-- DDL canlı şemadan birebir çıkarıldı (KAPSAMLI_AUDIT teyidi). FK/UNIQUE/CHECK gömülü.
-- Geri-alma gerekmez (yeni ortam dışında no-op).

-- FIX (audit DB/HIGH — households/household_members/coach_consents migration baseline yok)
CREATE TABLE IF NOT EXISTS public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Ailem',
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code text UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.coach_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shared_data_types text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (user_id, coach_id)
);

-- RLS açık olmalı; policy'ler 040/043/050'de tanımlı (bu dosya yalnız zemini kurar).
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_consents ENABLE ROW LEVEL SECURITY;
