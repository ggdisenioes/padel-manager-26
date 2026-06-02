-- Fix: el constraint global "players_name_key" (UNIQUE sobre name) impedía
-- crear jugadores con un nombre ya usado en CUALQUIER club, e incluso reusar
-- el nombre de un jugador borrado (soft-delete deja la fila con deleted_at).
--
-- En una app multi-tenant el nombre debe ser único, a lo sumo, dentro del
-- mismo club y solo entre jugadores activos. Lo cambiamos por un índice
-- único parcial por (tenant_id, name) que ignora los soft-deleted.

alter table public.players drop constraint if exists players_name_key;

-- Por si en algún entorno el unique se creó como índice en vez de constraint.
drop index if exists players_name_key;

create unique index if not exists players_tenant_name_active_key
  on public.players (tenant_id, name)
  where deleted_at is null;
