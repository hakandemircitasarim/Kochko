-- 089: user_safety_state — durable, trajectory-aware SAFETY STATE (target-arch step 14).
--
-- Today ED / disordered-eating detection is STATELESS: detectEDRisk runs per-turn and forgets.
-- So a user showing a restriction pattern over days gets no cumulative protection, and the moment
-- they have one normal turn the coach can resume an aggressive deficit. This is a durable per-user
-- risk state with HYSTERESIS: it escalates fast on a signal and de-escalates only slowly over time,
-- so the deficit engine can refuse aggressive cuts for a user whose trajectory is concerning even
-- when the current message looks fine. De-escalation is time-based only (never a single "good" turn).

CREATE TABLE IF NOT EXISTS user_safety_state (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ed_tier           text NOT NULL DEFAULT 'none' CHECK (ed_tier IN ('none','watch','amber','red')),
  ed_signal_count   integer NOT NULL DEFAULT 0,
  ed_last_signal_at timestamptz,
  ed_escalated_at   timestamptz,
  overtraining_tier text NOT NULL DEFAULT 'none' CHECK (overtraining_tier IN ('none','watch','amber')),
  note              text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_safety_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_safety_state' AND policyname='uss_sel') THEN
    CREATE POLICY uss_sel ON user_safety_state FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

SELECT 'user_safety_state ready' AS status;
