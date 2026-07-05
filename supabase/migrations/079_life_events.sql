-- 079: life_events — episodic, dated personal events the coach remembers ACROSS sessions.
-- The "organism" continuity feature: a user mentions "3 hafta sonra kardeşimin düğünü var" and
-- the coach should carry that as a motivating deadline on every future turn (and in NEW sessions),
-- tie the plan to it, and count down as it approaches — not forget it the moment the chat ends.
-- Distinct from periodic_state (ongoing STATES: ramadan/travel/exam/illness) and user_commitments
-- ("I'll do X" promises). This is a point-in-time motivating event with a date.

CREATE TABLE IF NOT EXISTS life_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,                 -- "kardeşinin düğünü", "Bodrum tatili"
  event_type  text NOT NULL DEFAULT 'other', -- wedding|engagement|vacation|beach|graduation|birthday|reunion|exam|photoshoot|competition|other
  event_date  date NOT NULL,
  note        text,
  is_active   boolean NOT NULL DEFAULT true, -- flips false once passed or cancelled
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One hot query: "the user's nearest upcoming active event".
CREATE INDEX IF NOT EXISTS idx_life_events_user_upcoming
  ON life_events (user_id, event_date) WHERE is_active;

ALTER TABLE life_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'life_events' AND policyname = 'life_events_sel') THEN
    CREATE POLICY life_events_sel ON life_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'life_events' AND policyname = 'life_events_ins') THEN
    CREATE POLICY life_events_ins ON life_events FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'life_events' AND policyname = 'life_events_upd') THEN
    CREATE POLICY life_events_upd ON life_events FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'life_events' AND policyname = 'life_events_del') THEN
    CREATE POLICY life_events_del ON life_events FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
