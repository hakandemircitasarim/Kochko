-- 044: handle_new_user kayıt metadata'sındaki birth_year'ı profiles'a kopyalar
--
-- register.tsx doğum yılını zorunlu toplar ve auth.signUp options.data ile
-- gönderir; ama trigger yalnız INSERT INTO profiles (id) yapıyordu —
-- profiles.birth_year süresiz NULL kalıyor, yapısal onboarding TDEE'yi
-- yaş=30 varsayımıyla hesaplıyordu.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_birth_year smallint;
BEGIN
  BEGIN
    v_birth_year := NULLIF(NEW.raw_user_meta_data->>'birth_year', '')::smallint;
    IF v_birth_year IS NOT NULL AND (v_birth_year < 1900 OR v_birth_year > EXTRACT(YEAR FROM now())::smallint) THEN
      v_birth_year := NULL;
    END IF;
  EXCEPTION WHEN others THEN
    v_birth_year := NULL;
  END;

  INSERT INTO public.profiles (id, birth_year) VALUES (NEW.id, v_birth_year);
  RETURN NEW;
END;
$$;
