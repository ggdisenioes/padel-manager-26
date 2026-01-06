"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

// ✅ Import correcto (Supabase está en /lib/supabase.ts en la raíz)
import { supabase } from "../lib/supabase";
import { useRole } from "../hooks/useRole";

type Match = {
  id: number;
  start_time: string | null;
  tournament_id: number | null;
  round_name: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
  score: string | null;
  winner: string | null;
};

type PlayerMap = Record<number, string>;

type View = "pending" | "finished" | "all";

export default function MatchesPage() {
  const { isAdmin, isManager, role, loading: roleLoading } = useRole();
  const searchParams = useSearchParams();

  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<PlayerMap>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("pending");

  // Si entran con /matches?status=pending, forzamos la vista pendientes
  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "pending") setView("pending");
    if (status === "finished") setView("finished");
    if (status === "all") setView("all");
  }, [searchParams]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      const [{ data: matchesData, error: matchError }, { data: playersData, error: playersError }] =
        await Promise.all([
          supabase
            .from("matches")
            .select(
              "id, start_time, tournament_id, round_name, player_1_a, player_2_a, player_1_b, player_2_b, score, winner"
            )
            .order("start_time", { ascending: true }),
          supabase.from("players").select("id, name"),
        ]);

      if (playersError) {
        // No bloqueamos la pantalla por esto, pero avisamos.
        console.error(playersError);
      }

      if (matchError) {
        console.error(matchError);
        toast.error("No se pudieron cargar los partidos.");
        setMatches([]);
        setLoading(false);
        return;
      }

      const playerMap: PlayerMap = {};
      (playersData || []).forEach((p: any) => {
        playerMap[p.id] = p.name;
      });

      setPlayers(playerMap);
      setMatches(matchesData || []);
      setLoading(false);
    };

    loadData();

    // Realtime: cuando cambie un partido, refrescamos la lista
    const channel = supabase
      .channel("matches_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isPlayed = (m: Match) => !!m.score && !!m.winner && String(m.winner).toLowerCase() !== "pending";

  // 1️⃣ AGREGAR FUNCIÓN handleDeleteMatch
  const handleDeleteMatch = async (matchId: number) => {
    const confirmed = window.confirm(
      "¿Estás seguro? El partido se eliminará definitivamente y quedará registrado en los logs."
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from("matches")
      .delete()
      .eq("id", matchId);

    if (error) {
      console.error(error);
      toast.error("No se pudo eliminar el partido");
      return;
    }

    toast.success("Partido eliminado");
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
  };

  const filteredMatches = useMemo(() => {
    if (view === "all") return matches;
    if (view === "finished") return matches.filter(isPlayed);
    // pending
    return matches.filter((m) => !isPlayed(m));
  }, [matches, view]);

  const name = (id: number | null) => (id ? players[id] || `ID ${id}` : "-");

  if (roleLoading) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <p className="text-gray-500 animate-pulse">Cargando permisos…</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex flex-wrap gap-2 items-center justify-between">
        <h1 className="text-2xl font-bold">Partidos</h1>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setView("pending")}
            className={`px-3 py-1 rounded border ${view === "pending" ? "bg-black text-white" : "bg-white"}`}
          >
            Pendientes
          </button>
          <button
            onClick={() => setView("finished")}
            className={`px-3 py-1 rounded border ${view === "finished" ? "bg-black text-white" : "bg-white"}`}
          >
            Finalizados
          </button>
          <button
            onClick={() => setView("all")}
            className={`px-3 py-1 rounded border ${view === "all" ? "bg-black text-white" : "bg-white"}`}
          >
            Todos
          </button>
          {(isAdmin || isManager) && (
            <Link
              href="/matches/create"
              className="bg-green-600 text-white px-4 py-1 rounded border border-green-600 hover:bg-green-700 transition text-sm font-semibold"
            >
              + Crear partido
            </Link>
          )}
          {(isAdmin || isManager) && (
            <Link
              href="/matches/create?type=friendly"
              className="bg-green-600 text-white px-4 py-1 rounded border border-green-600 hover:bg-green-700 transition text-sm font-semibold"
            >
              + Crear partido amistoso
            </Link>
          )}
        </div>
      </header>

      {loading ? (
        <p className="text-gray-500">Cargando partidos…</p>
      ) : filteredMatches.length === 0 ? (
        <p className="text-gray-500">No hay partidos para mostrar.</p>
      ) : (
        <div className="space-y-3">
          {filteredMatches.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">
                  {m.round_name || "Partido"}
                </span>

                {m.score && (
                  <span className="text-sm font-bold text-green-600">{m.score}</span>
                )}
              </div>

              <div className="flex items-center justify-between text-center">
                <div className="flex-1">
                  <p className="font-semibold text-lg">{name(m.player_1_a)}</p>
                  <p className="text-sm text-gray-500">{name(m.player_2_a)}</p>
                </div>

                <div className="mx-6">
                  <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 font-bold">
                    VS
                  </span>
                </div>

                <div className="flex-1">
                  <p className="font-semibold text-lg">{name(m.player_1_b)}</p>
                  <p className="text-sm text-gray-500">{name(m.player_2_b)}</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
                {m.start_time && (
                  <>
                    <span>📅 {new Date(m.start_time).toLocaleDateString("es-ES")}</span>
                    <span>⏰ {new Date(m.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                {(isAdmin || isManager) && (
                  <Link
                    href={`/matches/edit/${m.id}`}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-blue-700 transition"
                  >
                    Editar partido
                  </Link>
                )}

                {(isAdmin || (isManager && !isPlayed(m))) && (
                  <Link
                    href={`/matches/score/${m.id}`}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 transition"
                  >
                    {isPlayed(m) ? "Editar resultado" : "Cargar resultado"}
                  </Link>
                )}

                {isAdmin && (
                  <button
                    onClick={() => handleDeleteMatch(m.id)}
                    className="bg-red-100 text-red-700 px-4 py-2 rounded-md text-sm font-semibold hover:bg-red-200 transition"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}