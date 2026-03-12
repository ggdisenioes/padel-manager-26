"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";

import { supabase } from "../../../lib/supabase";
import { useRole } from "../../../hooks/useRole";
import { notifyMatchCreated } from "../../../lib/notify";
import Card from "../../../components/Card";
import {
  DEFAULT_LEAGUE_MODE,
  DEFAULT_TOURNAMENT_TYPE,
  LEAGUE_MODE_LABEL,
  TOURNAMENT_TYPE_LABEL,
  getCupPhaseName,
  isPowerOfTwo,
  nextPowerOfTwo,
  type LeagueMode,
  type TournamentType,
} from "../../../lib/tournamentFormats";

type Player = {
  id: number;
  name: string;
  level?: number | null;
};

type Team = {
  a: number;
  b: number;
};

type TournamentRound = {
  id: number;
  round_number: number;
  round_name: string;
  start_at: string;
};

type TournamentConfig = {
  id: number;
  name: string;
  start_date: string | null;
  tournament_type?: TournamentType | null;
  league_mode?: LeagueMode | null;
};

type MatchForGeneration = {
  id?: number;
  round_name: string | null;
  start_time: string;
  winner: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
};

type MatchInsertPayload = {
  tournament_id: number;
  round_name: string;
  player_1_a: number;
  player_2_a: number;
  player_1_b: number;
  player_2_b: number;
  start_time: string;
  score: null;
  winner: null;
  place: null;
};

function createSeededRandom(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), 1 | t);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(array: T[], randomFn: () => number = Math.random): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function teamKey(t: Team) {
  return [t.a, t.b].sort((x, y) => x - y).join("-");
}

function directedMatchupKey(home: Team, away: Team) {
  return `${teamKey(home)}__${teamKey(away)}`;
}

function undirectedMatchupKey(t1: Team, t2: Team) {
  const k1 = teamKey(t1);
  const k2 = teamKey(t2);
  return [k1, k2].sort().join("__");
}

function phaseSize(phase: string) {
  const normalized = phase.trim().toLowerCase();
  if (normalized === "final") return 2;
  if (normalized === "semifinal") return 4;
  if (normalized === "cuartos") return 8;
  if (normalized === "octavos") return 16;
  if (normalized === "dieciseisavos") return 32;
  const roundMatch = normalized.match(/ronda\s+de\s+(\d+)/i);
  const parsed = roundMatch ? Number(roundMatch[1]) : NaN;
  return Number.isFinite(parsed) && parsed >= 2 ? parsed : null;
}

function nextCupPhase(currentPhase: string) {
  const currentSize = phaseSize(currentPhase);
  if (!currentSize || currentSize <= 2) return null;
  return getCupPhaseName(Math.max(2, currentSize / 2));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export default function GenerateMatchesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, isManager, loading: roleLoading } = useRole();
  const requestedRoundId = searchParams.get("round_id") || searchParams.get("round");

  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingNextPhase, setCreatingNextPhase] = useState(false);
  const [rounds, setRounds] = useState<TournamentRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");

  const [seeded, setSeeded] = useState(false);
  const [pairingSeed, setPairingSeed] = useState<number>(() => (Date.now() % 2147483647) | 0);
  const [tournament, setTournament] = useState<TournamentConfig | null>(null);

  const tournamentId = useMemo(() => Number(id), [id]);
  const selectedRound = useMemo(
    () => rounds.find((round) => String(round.id) === selectedRoundId) || null,
    [rounds, selectedRoundId]
  );

  const tournamentType: TournamentType =
    tournament?.tournament_type && ["league", "cup"].includes(tournament.tournament_type)
      ? tournament.tournament_type
      : DEFAULT_TOURNAMENT_TYPE;

  const leagueMode: LeagueMode =
    tournament?.league_mode && ["single_leg", "double_leg"].includes(tournament.league_mode)
      ? tournament.league_mode
      : DEFAULT_LEAGUE_MODE;

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      const [
        { data: playersData, error: playersError },
        { data: roundsData, error: roundsError },
        { data: tournamentData, error: tournamentError },
      ] = await Promise.all([
        supabase
          .from("players")
          .select("id, name, level")
          .eq("is_approved", true)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("tournament_rounds")
          .select("id, round_number, round_name, start_at")
          .eq("tournament_id", tournamentId)
          .order("round_number", { ascending: true }),
        supabase
          .from("tournaments")
          .select("id, name, start_date, tournament_type, league_mode")
          .eq("id", tournamentId)
          .maybeSingle(),
      ]);

      if (playersError) {
        console.error(playersError);
        toast.error("Error al cargar jugadores");
        setPlayers([]);
      } else {
        setPlayers((playersData || []) as Player[]);
      }

      if (roundsError) {
        console.error("[generate-matches] error cargando jornadas", roundsError);
        setRounds([]);
      } else {
        const nextRounds = (roundsData || []) as TournamentRound[];
        setRounds(nextRounds);
        if (nextRounds.length > 0) {
          const initialRound =
            nextRounds.find((round) => String(round.id) === requestedRoundId) || nextRounds[0];
          setSelectedRoundId(String(initialRound.id));
          setStartDate(initialRound.start_at.slice(0, 10));
        }
      }

      if (tournamentError) {
        console.error("[generate-matches] error cargando torneo", tournamentError);
      }

      if (tournamentData) {
        const tournamentConfig = tournamentData as TournamentConfig;
        setTournament(tournamentConfig);
        setStartDate((prev) => prev || tournamentConfig.start_date || "");
      }

      setLoading(false);
    };

    void loadData();
  }, [tournamentId, requestedRoundId]);

  const togglePlayer = (playerId: number) => {
    setSelectedPlayers((prev) =>
      prev.includes(playerId) ? prev.filter((x) => x !== playerId) : [...prev, playerId]
    );
  };

  const selectedPlayerObjs = useMemo(
    () => players.filter((p) => selectedPlayers.includes(p.id)),
    [players, selectedPlayers]
  );

  const teamsPreview = useMemo(() => {
    if (selectedPlayerObjs.length < 4) return [];
    if (selectedPlayerObjs.length % 2 !== 0) return [];

    let list = [...selectedPlayerObjs];

    if (seeded) {
      list.sort((a, b) => {
        const la = a.level ?? -1;
        const lb = b.level ?? -1;
        if (la !== lb) return lb - la;
        return a.name.localeCompare(b.name);
      });

      const teams: Team[] = [];
      let i = 0;
      let j = list.length - 1;
      while (i < j) {
        teams.push({ a: list[i].id, b: list[j].id });
        i += 1;
        j -= 1;
      }
      return teams;
    }

    list = shuffleArray(list, createSeededRandom(pairingSeed));
    const teams: Team[] = [];
    for (let i = 0; i < list.length; i += 2) {
      teams.push({ a: list[i].id, b: list[i + 1].id });
    }
    return teams;
  }, [pairingSeed, seeded, selectedPlayerObjs]);

  const fetchExistingTournamentMatches = async () => {
    const { data, error } = await supabase
      .from("matches")
      .select("id, round_name, start_time, winner, player_1_a, player_2_a, player_1_b, player_2_b")
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []) as MatchForGeneration[];
  };

  const createMatchesInDb = async (newMatches: MatchInsertPayload[]) => {
    const { data: createdMatches, error: insertError } = await supabase
      .from("matches")
      .insert(newMatches)
      .select("id");

    if (insertError) {
      throw insertError;
    }

    const normalized = (createdMatches || []) as Array<{ id: number }>;

    if (normalized.length > 0) {
      notifyMatchCreated(normalized.map((m) => m.id));
    }

    return normalized.length;
  };

  const baseStartDate = () => {
    const baseCandidate = selectedRound?.start_at || startDate || tournament?.start_date || "";
    const parsed = new Date(baseCandidate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  const leagueRoundName = () => selectedRound?.round_name || "Liga";

  const generateLeagueMatches = async () => {
    if (selectedPlayers.length < 4) {
      toast.error("Seleccioná al menos 4 jugadores (2 parejas)");
      return;
    }
    if (selectedPlayers.length % 2 !== 0) {
      toast.error("Para 2vs2 necesitás un número PAR de jugadores");
      return;
    }

    if (rounds.length > 0 && !selectedRound) {
      toast.error("Seleccioná la jornada donde querés generar los partidos");
      return;
    }

    const baseStart = baseStartDate();
    if (!baseStart) {
      toast.error("Seleccioná una fecha de inicio válida");
      return;
    }

    const teams = teamsPreview;
    if (teams.length < 2) {
      toast.error("No se pudieron armar parejas. Revisá la selección de jugadores.");
      return;
    }

    setCreating(true);

    try {
      const existingMatches = await fetchExistingTournamentMatches();

      const existingUndirected = new Set<string>();
      const existingDirected = new Set<string>();

      existingMatches.forEach((m) => {
        const a1 = m.player_1_a;
        const a2 = m.player_2_a;
        const b1 = m.player_1_b;
        const b2 = m.player_2_b;
        if (a1 == null || a2 == null || b1 == null || b2 == null) return;

        const teamHome = { a: a1, b: a2 };
        const teamAway = { a: b1, b: b2 };
        existingUndirected.add(undirectedMatchupKey(teamHome, teamAway));
        existingDirected.add(directedMatchupKey(teamHome, teamAway));
      });

      const startAt = (idx: number) => {
        const d = new Date(baseStart);
        d.setMinutes(d.getMinutes() + idx * 5);
        return d.toISOString();
      };

      const nextMatches: MatchInsertPayload[] = [];
      let idx = 0;
      let skipped = 0;

      for (let i = 0; i < teams.length; i += 1) {
        for (let j = i + 1; j < teams.length; j += 1) {
          const t1 = teams[i];
          const t2 = teams[j];

          if (leagueMode === "single_leg") {
            const keyUndirected = undirectedMatchupKey(t1, t2);
            if (existingUndirected.has(keyUndirected)) {
              skipped += 1;
              continue;
            }

            nextMatches.push({
              tournament_id: tournamentId,
              round_name: leagueRoundName(),
              player_1_a: t1.a,
              player_2_a: t1.b,
              player_1_b: t2.a,
              player_2_b: t2.b,
              start_time: startAt(idx++),
              score: null,
              winner: null,
              place: null,
            });

            existingUndirected.add(keyUndirected);
            existingDirected.add(directedMatchupKey(t1, t2));
            existingDirected.add(directedMatchupKey(t2, t1));
            continue;
          }

          const idaKey = directedMatchupKey(t1, t2);
          if (!existingDirected.has(idaKey)) {
            nextMatches.push({
              tournament_id: tournamentId,
              round_name: `${leagueRoundName()} · Ida`,
              player_1_a: t1.a,
              player_2_a: t1.b,
              player_1_b: t2.a,
              player_2_b: t2.b,
              start_time: startAt(idx++),
              score: null,
              winner: null,
              place: null,
            });
            existingDirected.add(idaKey);
          } else {
            skipped += 1;
          }

          const vueltaKey = directedMatchupKey(t2, t1);
          if (!existingDirected.has(vueltaKey)) {
            nextMatches.push({
              tournament_id: tournamentId,
              round_name: `${leagueRoundName()} · Vuelta`,
              player_1_a: t2.a,
              player_2_a: t2.b,
              player_1_b: t1.a,
              player_2_b: t1.b,
              start_time: startAt(idx++),
              score: null,
              winner: null,
              place: null,
            });
            existingDirected.add(vueltaKey);
          } else {
            skipped += 1;
          }

          existingUndirected.add(undirectedMatchupKey(t1, t2));
        }
      }

      if (nextMatches.length === 0) {
        toast.error("No hay nuevos partidos para generar");
        return;
      }

      const createdCount = await createMatchesInDb(nextMatches);

      await supabase.from("action_logs").insert({
        action: "GENERATE_MATCHES",
        entity: "tournament",
        entity_id: tournamentId,
        metadata: {
          tournament_type: tournamentType,
          league_mode: leagueMode,
          players: selectedPlayers.length,
          teams: teams.length,
          created_matches: createdCount,
          skipped_existing: skipped,
          round: selectedRound?.round_name || null,
        },
      });

      toast.success(
        skipped > 0
          ? `Se generaron ${createdCount} partidos. ${skipped} cruces ya existían y se omitieron.`
          : `Se generaron ${createdCount} partidos.`
      );
      router.push(`/tournaments/${id}`);
    } catch (error: unknown) {
      console.error("[generate league]", error);
      toast.error(getErrorMessage(error, "Error al generar partidos de liga"));
    } finally {
      setCreating(false);
    }
  };

  const generateCupInitialPhase = async () => {
    if (selectedPlayers.length < 4) {
      toast.error("Seleccioná al menos 4 jugadores (2 parejas)");
      return;
    }
    if (selectedPlayers.length % 2 !== 0) {
      toast.error("Para 2vs2 necesitás un número PAR de jugadores");
      return;
    }

    const teams = teamsPreview;
    if (!isPowerOfTwo(teams.length)) {
      const nextSize = nextPowerOfTwo(teams.length);
      toast.error(`Para Copa necesitás ${nextSize} parejas exactas (potencia de 2).`);
      return;
    }

    const baseStart = baseStartDate();
    if (!baseStart) {
      toast.error("Seleccioná una fecha de inicio válida");
      return;
    }

    setCreating(true);

    try {
      const existingMatches = await fetchExistingTournamentMatches();
      if (existingMatches.length > 0) {
        toast.error("Esta copa ya tiene partidos. Usá 'Generar siguiente fase'.");
        return;
      }

      let cupTeams = [...teams];
      if (seeded) {
        const levelMap = new Map<number, number>();
        players.forEach((p) => levelMap.set(p.id, p.level ?? -1));

        cupTeams.sort((t1, t2) => {
          const s1 = (levelMap.get(t1.a) ?? -1) + (levelMap.get(t1.b) ?? -1);
          const s2 = (levelMap.get(t2.a) ?? -1) + (levelMap.get(t2.b) ?? -1);
          if (s1 !== s2) return s2 - s1;
          return teamKey(t1).localeCompare(teamKey(t2));
        });
      } else {
        cupTeams = shuffleArray(cupTeams, createSeededRandom(pairingSeed + 7));
      }

      const startAt = (idx: number) => {
        const d = new Date(baseStart);
        d.setMinutes(d.getMinutes() + idx * 5);
        return d.toISOString();
      };

      const phaseName = getCupPhaseName(cupTeams.length);
      const nextMatches: MatchInsertPayload[] = [];
      let idx = 0;

      for (let i = 0; i < cupTeams.length / 2; i += 1) {
        const teamA = cupTeams[i];
        const teamB = cupTeams[cupTeams.length - 1 - i];
        nextMatches.push({
          tournament_id: tournamentId,
          round_name: phaseName,
          player_1_a: teamA.a,
          player_2_a: teamA.b,
          player_1_b: teamB.a,
          player_2_b: teamB.b,
          start_time: startAt(idx++),
          score: null,
          winner: null,
          place: null,
        });
      }

      const createdCount = await createMatchesInDb(nextMatches);

      await supabase.from("action_logs").insert({
        action: "GENERATE_MATCHES",
        entity: "tournament",
        entity_id: tournamentId,
        metadata: {
          tournament_type: tournamentType,
          phase: phaseName,
          players: selectedPlayers.length,
          teams: teams.length,
          created_matches: createdCount,
        },
      });

      toast.success(`Se generó la fase ${phaseName} con ${createdCount} partidos.`);
      router.push(`/tournaments/${id}`);
    } catch (error: unknown) {
      console.error("[generate cup initial]", error);
      toast.error(getErrorMessage(error, "Error al generar fase inicial de copa"));
    } finally {
      setCreating(false);
    }
  };

  const generateNextCupPhase = async () => {
    setCreatingNextPhase(true);

    try {
      const existingMatches = await fetchExistingTournamentMatches();
      if (existingMatches.length === 0) {
        toast.error("Primero tenés que generar la fase inicial de la copa.");
        return;
      }

      const byPhase = new Map<string, MatchForGeneration[]>();
      existingMatches.forEach((match) => {
        const phase = String(match.round_name || "").trim();
        if (!phase) return;
        if (!byPhase.has(phase)) byPhase.set(phase, []);
        byPhase.get(phase)!.push(match);
      });

      const phaseNames = [...byPhase.keys()].filter((phase) => phaseSize(phase) !== null);
      if (phaseNames.length === 0) {
        toast.error("No se detectaron fases válidas de copa.");
        return;
      }

      const sortedBySizeDesc = [...phaseNames].sort((a, b) => {
        const sizeA = phaseSize(a) || 0;
        const sizeB = phaseSize(b) || 0;
        return sizeB - sizeA;
      });

      const phaseHasPendingResults = (phase: string) => {
        const phaseMatches = byPhase.get(phase) || [];
        return phaseMatches.some((m) => m.winner !== "A" && m.winner !== "B");
      };

      const candidatePhase = sortedBySizeDesc.find((phase) => {
        const phaseMatches = byPhase.get(phase) || [];
        const completed =
          phaseMatches.length > 0 &&
          phaseMatches.every((m) => m.winner === "A" || m.winner === "B");
        if (!completed) return false;

        const next = nextCupPhase(phase);
        if (!next) return false;

        return !byPhase.has(next);
      });

      if (!candidatePhase) {
        const hasFinalCompleted = (byPhase.get("Final") || []).every(
          (m) => m.winner === "A" || m.winner === "B"
        );
        if (hasFinalCompleted && (byPhase.get("Final") || []).length > 0) {
          toast.error("La copa ya tiene final completa.");
          return;
        }

        const hasAnyPending = sortedBySizeDesc.some((phase) => phaseHasPendingResults(phase));
        toast.error(
          hasAnyPending
            ? "Todavía no hay una fase completa para avanzar. Cargá resultados pendientes."
            : "No hay fase disponible para generar."
        );
        return;
      }

      const nextPhase = nextCupPhase(candidatePhase);
      if (!nextPhase) {
        toast.error("La copa ya tiene final completa.");
        return;
      }

      const completedPhaseMatches = (byPhase.get(candidatePhase) || []).sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );

      const winners: Team[] = [];
      for (const match of completedPhaseMatches) {
        const winner = String(match.winner || "").toUpperCase();
        if (winner === "A") {
          if (
            match.player_1_a == null ||
            match.player_2_a == null
          ) {
            continue;
          }
          winners.push({ a: match.player_1_a, b: match.player_2_a });
          continue;
        }

        if (winner === "B") {
          if (
            match.player_1_b == null ||
            match.player_2_b == null
          ) {
            continue;
          }
          winners.push({ a: match.player_1_b, b: match.player_2_b });
        }
      }

      if (winners.length < 2 || winners.length % 2 !== 0) {
        toast.error("No hay ganadores suficientes para generar la siguiente fase.");
        return;
      }

      const baseStart = baseStartDate();
      if (!baseStart) {
        toast.error("Seleccioná una fecha de inicio válida");
        return;
      }

      const startAt = (idx: number) => {
        const d = new Date(baseStart);
        d.setDate(d.getDate() + 7);
        d.setMinutes(d.getMinutes() + idx * 5);
        return d.toISOString();
      };

      const nextMatches: MatchInsertPayload[] = [];
      let idx = 0;
      for (let i = 0; i < winners.length / 2; i += 1) {
        const teamA = winners[i];
        const teamB = winners[winners.length - 1 - i];
        nextMatches.push({
          tournament_id: tournamentId,
          round_name: nextPhase,
          player_1_a: teamA.a,
          player_2_a: teamA.b,
          player_1_b: teamB.a,
          player_2_b: teamB.b,
          start_time: startAt(idx++),
          score: null,
          winner: null,
          place: null,
        });
      }

      const createdCount = await createMatchesInDb(nextMatches);

      await supabase.from("action_logs").insert({
        action: "GENERATE_MATCHES",
        entity: "tournament",
        entity_id: tournamentId,
        metadata: {
          tournament_type: tournamentType,
          phase_from: candidatePhase,
          phase_to: nextPhase,
          created_matches: createdCount,
        },
      });

      toast.success(`Fase ${nextPhase} generada con ${createdCount} partidos.`);
      router.push(`/tournaments/${id}`);
    } catch (error: unknown) {
      console.error("[generate cup next phase]", error);
      toast.error(getErrorMessage(error, "Error al generar la siguiente fase"));
    } finally {
      setCreatingNextPhase(false);
    }
  };

  const generateMatches = async () => {
    if (!tournamentId || Number.isNaN(tournamentId)) {
      toast.error("ID de torneo inválido");
      return;
    }

    if (tournamentType === "cup") {
      await generateCupInitialPhase();
      return;
    }

    await generateLeagueMatches();
  };

  const isOddPlayers = selectedPlayers.length % 2 !== 0;

  if (!roleLoading && !isAdmin && !isManager) {
    return (
      <main className="max-w-xl mx-auto p-6">
        <p className="text-red-600 font-semibold">No tenés permisos para generar partidos.</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Generar partidos</h1>

      <Card>
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-semibold text-gray-900">
              {tournament?.name || `Torneo #${id}`} · {TOURNAMENT_TYPE_LABEL[tournamentType]}
            </p>
            {tournamentType === "league" ? (
              <p className="mt-1">Modo configurado: <strong>{LEAGUE_MODE_LABEL[leagueMode]}</strong>.</p>
            ) : (
              <p className="mt-1">La copa se genera por fases de llaves: octavos, cuartos, semifinal y final.</p>
            )}
          </div>

          {rounds.length > 0 && tournamentType === "league" && (
            <div>
              <label className="block text-sm font-medium mb-1">Jornada</label>
              <select
                value={selectedRoundId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedRoundId(nextId);
                  const round = rounds.find((item) => String(item.id) === nextId);
                  if (round) setStartDate(round.start_at.slice(0, 10));
                }}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">Seleccionar jornada</option>
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {`${round.round_name} · ${new Date(round.start_at).toLocaleString("es-ES", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Europe/Madrid",
                    })}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Fecha base de generación</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Se usa para definir la fecha/hora inicial de los partidos generados.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="seededPairs"
              checked={seeded}
              onChange={(e) => setSeeded(e.target.checked)}
              className="accent-green-600"
            />
            <label htmlFor="seededPairs" className="select-none">
              Armar parejas por nivel (balanceadas)
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {seeded
                ? "Con parejas por nivel no se rearman manualmente."
                : "La generación usará exactamente las parejas que ves en la vista previa."}
            </p>
            <button
              type="button"
              onClick={() => setPairingSeed((prev) => (prev + 1) % 2147483647)}
              disabled={seeded}
              className={`px-3 py-2 text-xs rounded-md border border-gray-300 ${
                seeded ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"
              }`}
              title={seeded ? "Disponible solo en modo aleatorio" : "Generar una nueva combinación aleatoria"}
            >
              Rearmar parejas
            </button>
          </div>

          <div>
            <p className="font-medium mb-2">Seleccionar jugadores</p>

            <div className="max-h-64 overflow-y-auto border rounded p-3 space-y-2">
              {loading ? (
                <p className="text-gray-500">Cargando jugadores...</p>
              ) : players.length === 0 ? (
                <p className="text-gray-500">No hay jugadores disponibles.</p>
              ) : (
                players.map((player) => (
                  <label
                    key={player.id}
                    className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition ${
                      selectedPlayers.includes(player.id)
                        ? "bg-green-50 border-green-500"
                        : "bg-white border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-green-600"
                      checked={selectedPlayers.includes(player.id)}
                      onChange={() => togglePlayer(player.id)}
                    />
                    <span className="text-sm font-medium text-gray-900">{player.name}</span>
                  </label>
                ))
              )}
            </div>

            {isOddPlayers && (
              <p className="text-yellow-600 text-sm mt-2">
                Para 2vs2 necesitás un número <b>PAR</b> de jugadores (se arman parejas).
              </p>
            )}

            <p className="text-sm text-gray-500 mt-2">Jugadores seleccionados: {selectedPlayers.length}</p>
            <p className="text-sm text-gray-500">Parejas estimadas: {Math.floor(selectedPlayers.length / 2)}</p>
          </div>

          <div>
            <p className="font-medium mb-2">Vista previa de parejas</p>
            {selectedPlayers.length < 4 ? (
              <p className="text-gray-500 text-sm">Seleccioná al menos 4 jugadores para armar parejas.</p>
            ) : selectedPlayers.length % 2 !== 0 ? (
              <p className="text-gray-500 text-sm">Falta 1 jugador para poder armar parejas.</p>
            ) : (
              <div className="border rounded p-3 space-y-2">
                {teamsPreview.map((t, idx) => {
                  const pA = players.find((p) => p.id === t.a)?.name || `ID ${t.a}`;
                  const pB = players.find((p) => p.id === t.b)?.name || `ID ${t.b}`;
                  return (
                    <div key={idx} className="text-sm">
                      <span className="font-semibold">Pareja {idx + 1}:</span> {pA} + {pB}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {tournamentType === "cup" && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <p className="font-semibold">Copa por llaves</p>
              <p className="mt-1">
                La fase inicial requiere cantidad de parejas potencia de 2 (2, 4, 8, 16...).
                Después, cargá resultados y generá la siguiente fase automáticamente.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={generateMatches}
              disabled={creating}
              className="bg-green-600 text-white px-6 py-3 rounded-md font-semibold hover:bg-green-700 transition disabled:opacity-50"
            >
              {creating
                ? "Generando..."
                : tournamentType === "cup"
                ? "Generar fase inicial"
                : "Generar partidos"}
            </button>

            {tournamentType === "cup" && (
              <button
                onClick={generateNextCupPhase}
                disabled={creatingNextPhase}
                className="bg-indigo-600 text-white px-6 py-3 rounded-md font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {creatingNextPhase ? "Generando..." : "Generar siguiente fase"}
              </button>
            )}
          </div>
        </div>
      </Card>
    </main>
  );
}
