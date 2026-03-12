-- Tipos de torneo: liga/copa y modo de liga
ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS tournament_type text,
ADD COLUMN IF NOT EXISTS league_mode text;
UPDATE public.tournaments
SET tournament_type = 'league'
WHERE tournament_type IS NULL;
UPDATE public.tournaments
SET league_mode = 'single_leg'
WHERE tournament_type = 'league'
  AND league_mode IS NULL;
ALTER TABLE public.tournaments
ALTER COLUMN tournament_type SET DEFAULT 'league';
ALTER TABLE public.tournaments
ALTER COLUMN tournament_type SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tournaments_tournament_type_check'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_tournament_type_check
      CHECK (tournament_type IN ('league', 'cup'));
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tournaments_league_mode_check'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_league_mode_check
      CHECK (
        league_mode IS NULL OR league_mode IN ('single_leg', 'double_leg')
      );
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tournaments_type_mode_consistency_check'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_type_mode_consistency_check
      CHECK (
        (tournament_type = 'league' AND league_mode IS NOT NULL)
        OR (tournament_type = 'cup' AND league_mode IS NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tournaments_tenant_type
ON public.tournaments (tenant_id, tournament_type);
