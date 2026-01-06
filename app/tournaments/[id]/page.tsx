// ./app/tournaments/[id]/page.tsx

"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Card from "../../components/Card";
import Badge from "../../components/Badge";
import toast from "react-hot-toast";

type Tournament = {
  id: number;
  name: string;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Match = {
  id: number;
  start_time: string | null;
  round_name: string | null;
  place: string | null;
  court: string | null;
  score: string | null;
  winner: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
};

type PlayerMap = {
  [key: number]: string;
};

export default function TournamentDetail() {
  const params = useParams();
  const router = useRouter();

  const rawId = (params as any)?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const idNum = Number(id);

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [playersMap, setPlayersMap] = useState<PlayerMap>({});
  const [loading, setLoading] = useState(true);

  // Cargar torneo + partidos + jugadores
  useEffect(() => {
    if (!id || Number.isNaN(idNum)) {
      toast.error("ID de torneo inválido.");
      router.push("/tournaments");
      return;
    }

    const load = async () => {
      setLoading(true);

      // Torneo
      const { data: tData, error: tError } = await supabase
        .from("tournaments")
        .select("id, name, category, start_date, end_date")
        .eq("id", idNum)
        .single();

      if (tError || !tData) {
        console.error("Error cargando torneo:", tError);
        toast.error("No se pudo cargar el torneo.");
        router.push("/tournaments");
        return;
      }

      setTournament(tData as Tournament);

      // Partidos del torneo
      const { data: mData, error: mError } = await supabase
        .from("matches")
        .select(
          "id, start_time, round_name, place, court, score, winner, player_1_a, player_2_a, player_1_b, player_2_b"
        )
        .eq("tournament_id", idNum)
        .order("start_time", { ascending: true });

      if (mError) {
        console.error("Error cargando partidos:", mError);
        toast.error("No se pudieron cargar los partidos del torneo.");
      } else {
        setMatches((mData || []) as Match[]);
      }

      // Jugadores (map id -> nombre)
      const { data: pData, error: pError } = await supabase
        .from("players")
        .select("id, name");

      if (pError) {
        console.error("Error cargando jugadores:", pError);
      } else {
        const map: PlayerMap = {};
        (pData || []).forEach((p) => {
          map[p.id] = p.name;
        });
        setPlayersMap(map);
      }

      setLoading(false);
    };

    load();
  }, [id, idNum, router]);

  // Helpers
  const getPlayerName = (id: number | null) =>
    id && playersMap[id] ? playersMap[id] : id ? `ID ${id}` : "-";

  const formatDate = (iso: string | null) => {
    if (!iso) return "-";
    return new Date(iso).toLocaleDateString("es-ES");
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "Sin fecha";
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Agrupar partidos por ronda
  const matchesByRound = useMemo(() => {
    return matches.reduce((acc: Record<string, Match[]>, match) => {
      const round = match.round_name || "Sin ronda";
      if (!acc[round]) acc[round] = [];
      acc[round].push(match);
      return acc;
    }, {});
  }, [matches]);

  // Orden lógico de rondas
  const roundOrder = ["Fase de Grupos", "Octavos", "Cuartos", "Semifinal", "Final"];

  const sortedRounds = useMemo(() => {
    const rounds = Object.keys(matchesByRound);
    return rounds.sort((a, b) => {
      const ia = roundOrder.indexOf(a);
      const ib = roundOrder.indexOf(b);

      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [matchesByRound]);

  if (loading) {
    return (
      <main className="p-10 text-center">
        Cargando cuadro...
      </main>
    );
  }

  if (!tournament) {
    return (
      <main className="p-10 text-center">
        No se encontró el torneo.
      </main>
    );
  }

  return (
    <main className="w-full overflow-x-hidden p-4 md:p-8 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Cabecera del Torneo */}
        <section className="mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-2">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {tournament.name}
              </h1>
              {tournament.category && (
                <p className="text-sm text-gray-500 mt-1">
                  Categoría: {tournament.category}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(tournament.start_date)} – {formatDate(tournament.end_date)}
              </p>
            </div>

            {/* Badge simple usando SOLO prop label */}
            <div className="flex items-center md:items-end justify-start md:justify-end">
              <Badge label="Cuadro de Partidos" />
            </div>
          </div>
        </section>

        {/* Cuadro por rondas */}
        <section className="space-y-6">
          {sortedRounds.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aún no hay partidos cargados para este torneo.
            </p>
          ) : (
            sortedRounds.map((roundName) => (
              <div key={roundName} className="space-y-3">
                <h2 className="text-sm md:text-base font-semibold text-gray-800">
                  {roundName}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {matchesByRound[roundName].map((m) => {
                    const played =
                      m.winner && m.winner !== "pending" && m.score;

                    const score = m.score || "-";
                    const statusColor =
                      !played || m.winner === "pending"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-700";
                    const statusText =
                      !played || m.winner === "pending"
                        ? "Pendiente"
                        : "Finalizado";

                    const pareja1 = `${getPlayerName(m.player_1_a)} / ${getPlayerName(
                      m.player_2_a
                    )}`;
                    const pareja2 = `${getPlayerName(m.player_1_b)} / ${getPlayerName(
                      m.player_2_b
                    )}`;

                    return (
                      <Card
                        key={m.id}
                        className="w-full bg-white/95 border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition"
                      >
                        <div className="p-4 space-y-3">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                                Partido #{m.id}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatDateTime(m.start_time)} ·{" "}
                                {m.place
                                  ? `${m.place}${
                                      m.court ? ` - Pista ${m.court}` : ""
                                    }`
                                  : m.court
                                  ? `Pista ${m.court}`
                                  : "Lugar no especificado"}
                              </p>
                            </div>

                            <div className="flex items-center gap-3 md:flex-col md:items-end">
                              <span
                                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${statusColor}`}
                              >
                                {statusText}
                              </span>
                              <span className="text-xl font-extrabold text-gray-900">
                                {score}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1 text-sm">
                            <p className="font-semibold text-gray-900">
                              {pareja1}
                            </p>
                            <p className="font-semibold text-gray-900">
                              {pareja2}
                            </p>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}