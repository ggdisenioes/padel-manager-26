// ./app/ranking/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import Card from "../components/Card";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type RankedPlayer = {
  id: number;
  name: string;
  avatar_url: string | null;
  wins: number;
  points: number;
};

export default function RankingPage() {
  const [players, setPlayers] = useState<RankedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Cargar ranking desde Supabase (jugadores + partidos)
  const loadRanking = useCallback(async () => {
    setLoading(true);

    // Jugadores aprobados
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("id, name, avatar_url")
      .eq("is_approved", true);

    if (playerError) {
      console.error("Error cargando jugadores:", playerError);
      toast.error("No se pudieron cargar los jugadores");
      setLoading(false);
      return;
    }

    // Partidos
    const { data: matches, error: matchError } = await supabase
      .from("matches")
      .select("winner, player_1_a, player_2_a, player_1_b, player_2_b");

    if (matchError) {
      console.error("Error cargando partidos:", matchError);
      toast.error("No se pudieron cargar los partidos");
      setLoading(false);
      return;
    }

    // Contar victorias por jugador
    const winsMap: Record<number, number> = {};

    (matches || []).forEach((match: any) => {
      if (!match.winner || match.winner === "pending") return;

      if (match.winner === "A") {
        [match.player_1_a, match.player_2_a].forEach((id: number) => {
          if (!id) return;
          winsMap[id] = (winsMap[id] || 0) + 1;
        });
      }

      if (match.winner === "B") {
        [match.player_1_b, match.player_2_b].forEach((id: number) => {
          if (!id) return;
          winsMap[id] = (winsMap[id] || 0) + 1;
        });
      }
    });

    // Crear array de ranking con puntos (3 pts por victoria)
    const ranking: RankedPlayer[] = (playerData || []).map((p: any) => {
      const wins = winsMap[p.id] || 0;
      const points = wins * 3;
      return {
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        wins,
        points,
      };
    });

    // Ordenar por puntos desc
    ranking.sort((a, b) => b.points - a.points);

    setPlayers(ranking);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRanking();

    // Recalcular ranking en tiempo real cuando cambien los partidos
    const channel = supabase
      .channel("public:matches-ranking")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => {
          loadRanking();
          toast.success("Ranking actualizado");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRanking]);

  const podium = players.slice(0, 3);
  const rest = players.slice(3);

  const handleRowClick = (id: number) => {
    // Lleva al perfil de jugador, accesible para cualquier usuario
    router.push(`/players/${id}`);
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20">
      <section className="max-w-5xl mx-auto">
        <div className="mb-6 text-center">
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-wide">
            Ranking de Jugadores
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Puntos calculados automáticamente según las victorias registradas.
          </p>
        </div>

        {loading ? (
          <p className="text-gray-400 text-center animate-pulse">
            Cargando ranking...
          </p>
        ) : players.length === 0 ? (
          <p className="text-gray-400 text-center">
            Todavía no hay jugadores con puntos. ¡Registrá algunos partidos!
          </p>
        ) : (
          <>
            {/* 🔝 PODIO TOP 3 */}
            <Card className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-[0.18em] mb-4 text-center">
                Podio
              </h2>
              <div className="grid grid-cols-3 gap-3 items-end">
                {podium.map((player, index) => (
                  <button
                    key={player.id}
                    onClick={() => handleRowClick(player.id)}
                    className={`flex flex-col items-center rounded-2xl px-3 py-4 transition hover:bg-gray-100 dark:hover:bg-gray-900/60 hover:scale-[1.02] ${
                      index === 0 ? "md:scale-105" : ""
                    }`}
                  >
                    <div className="text-sm font-bold text-[#ccff00] mb-1">
                      {index + 1}º
                    </div>
                    <div className="text-2xl mb-1">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                    </div>

                    {player.avatar_url ? (
                      <img
                        src={player.avatar_url}
                        alt={player.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-[#ccff00]"
                        onError={(e: any) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = `https://placehold.co/80x80/111827/ccff00?text=${player.name
                            .slice(0, 1)
                            .toUpperCase()}`;
                        }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-[#ccff00] text-gray-900 flex items-center justify-center font-bold">
                        {player.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <span className="mt-2 text-sm font-semibold text-gray-900 dark:text-white text-center">
                      {player.name}
                    </span>
                    <span className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {player.points} pts · {player.wins} victoria
                      {player.wins === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
                {podium.length === 0 && (
                  <p className="col-span-3 text-center text-gray-400 text-sm">
                    Aún no hay jugadores en el podio.
                  </p>
                )}
              </div>
            </Card>

            {/* 📋 TABLA DEL 4º EN ADELANTE */}
            {rest.length > 0 && (
              <Card>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-[0.18em] mb-3">
                  Resto del ranking
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-xs uppercase text-gray-400">
                        <th className="py-2 pr-2 text-left font-semibold">
                          Posición
                        </th>
                        <th className="py-2 pr-2 text-left font-semibold">
                          Jugador
                        </th>
                        <th className="py-2 pr-2 text-center font-semibold">
                          Victorias
                        </th>
                        <th className="py-2 text-center font-semibold">
                          Puntos
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rest.map((player, idx) => (
                        <tr
                          key={player.id}
                          className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900/70 cursor-pointer transition"
                          onClick={() => handleRowClick(player.id)}
                        >
                          <td className="py-2 pr-2 text-gray-400">
                            {idx + 4}º
                          </td>
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-2">
                              {player.avatar_url ? (
                                <img
                                  src={player.avatar_url}
                                  alt={player.name}
                                  className="w-7 h-7 rounded-full object-cover"
                                  onError={(e: any) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = `https://placehold.co/60x60/111827/ccff00?text=${player.name
                                      .slice(0, 1)
                                      .toUpperCase()}`;
                                  }}
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-[#ccff00] text-gray-900 flex items-center justify-center text-xs font-bold">
                                  {player.name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {player.name}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 pr-2 text-center text-gray-700 dark:text-gray-200">
                            {player.wins}
                          </td>
                          <td className="py-2 text-center font-bold text-gray-900 dark:text-white">
                            {player.points}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </section>
    </main>
  );
}