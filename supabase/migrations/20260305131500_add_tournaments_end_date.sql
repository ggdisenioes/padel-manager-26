-- Ensure tournament end date can be persisted and displayed in list cards.
ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS end_date DATE;
