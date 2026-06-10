-- 042: meal_logs.template_id FK → ON DELETE SET NULL
--
-- useTemplate artık oluşturduğu meal_log'a template_id yazıyor (izlenebilirlik).
-- Mevcut FK NO ACTION olduğundan, kullanılmış bir şablonu silmek 23503 ile
-- patlardı. Şablon silinince geçmiş loglar kalmalı, sadece bağ kopmalı.

ALTER TABLE public.meal_logs
  DROP CONSTRAINT IF EXISTS meal_logs_template_id_fkey;
ALTER TABLE public.meal_logs
  ADD CONSTRAINT meal_logs_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.meal_templates(id) ON DELETE SET NULL;
