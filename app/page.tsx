// ./app/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Link from "next/link";
import { useRole } from "./hooks/useRole";

type PlayerMap = {
  [key: number]: string;
};

type TournamentMap = {
  [key: number]: string;
};

type UpcomingMatch = {
  id: number;
  start_time: string | null;
  tournament_id: number | null;
  round_name: string | null;
  place: string | null;
  court: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
  winner: string | null;
  score: string | null;
};

type AuditLog = {
  id: number;
  action: string;
  entity: string | null;
  entity_id: number | null;
  user_email: string | null;
  created_at: string;
};

type AlertItem = {
  id: string;
  type: "warning" | "info";
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

// --- Dashboard extra types ---
type RankingItem = {
  player_id: number;
  name: string;
  points: number;
  wins: number;
};

type FinishedMatch = {
  id: number;
  score: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
  created_at: string;
};


export default function DashboardPage() {
  const [countPlayers, setCountPlayers] = useState(0);
  const [countTournaments, setCountTournaments] = useState(0);
  const [countPendingMatches, setCountPendingMatches] = useState(0);
  const [upcomingMatches, setUpcomingMatches] = useState<UpcomingMatch[]>([]);
  const [playerMap, setPlayerMap] = useState<PlayerMap>({});
  const [tournamentMap, setTournamentMap] = useState<TournamentMap>({});
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const { isAdmin, isManager } = useRole();
  const isUser = !isAdmin && !isManager;

  const [topRanking, setTopRanking] = useState<RankingItem[]>([]);
  const [recentResults, setRecentResults] = useState<FinishedMatch[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);


  // Función para calcular alertas inteligentes (estable para hooks/realtime)
  const calculateAlerts = useCallback(async () => {
    const alertsList: AlertItem[] = [];
    const now = new Date();

    // 1️⃣ Partido atrasado
    const { data: overdueMatches, error: overdueErr } = await supabase
      .from("matches")
      .select("id, start_time")
      .eq("winner", "pending")
      .lt("start_time", now.toISOString());

    if (!overdueErr && overdueMatches && overdueMatches.length > 0) {
      alertsList.push({
        id: "overdue-matches",
        type: "warning",
        message: `⚠️ Hay ${overdueMatches.length} partido(s) atrasado(s) sin resultado.`,
        actionLabel: "Cargar resultados",
        actionHref: "/matches?status=pending",
      });
    }

    // 2️⃣ Torneos sin partidos
    const { data: tournaments, error: tErr } = await supabase
      .from("tournaments")
      .select("id, name");

    if (!tErr && tournaments) {
      for (const t of tournaments) {
        const { count } = await supabase
          .from("matches")
          .select("*", { count: "exact", head: true })
          .eq("tournament_id", t.id);

        if (!count || count === 0) {
          alertsList.push({
            id: `tournament-${t.id}`,
            type: "info",
            message: `ℹ️ El torneo "${t.name}" no tiene partidos cargados.`,
            actionLabel: "Crear partido",
            actionHref: `/matches/create?tournament=${t.id}`,
          });
        }
      }
    }

    // 3️⃣ Jugadores inactivos
    const { data: players, error: pErr } = await supabase
      .from("players")
      .select("id, name")
      .eq("is_approved", true);

    if (!pErr && players) {
      for (const p of players) {
        const { count } = await supabase
          .from("matches")
          .select("*", { count: "exact", head: true })
          .or(
            `player_1_a.eq.${p.id},player_2_a.eq.${p.id},player_1_b.eq.${p.id},player_2_b.eq.${p.id}`
          );

        if (!count || count === 0) {
          alertsList.push({
            id: `player-${p.id}`,
            type: "info",
            message: `ℹ️ El jugador "${p.name}" aún no tiene partidos jugados.`,
            actionLabel: "Asignar partido",
            actionHref: `/matches/create?player=${p.id}`,
          });
        }
      }
    }

    setAlerts(alertsList.slice(0, 4));
  }, []);


  useEffect(() => {
    const loadData = async () => {
      // 1) Contadores
      const [{ count: pendingCount }, { count: playersCount }, { count: tournamentsCount }] =
        await Promise.all([
          supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("winner", "pending"),
          supabase
            .from("players")
            .select("*", { count: "exact", head: true })
            .eq("is_approved", true),
          supabase.from("tournaments").select("*", { count: "exact", head: true }),
        ]);

      setCountPendingMatches(pendingCount || 0);
      setCountPlayers(playersCount || 0);
      setCountTournaments(tournamentsCount || 0);

      // 2) Jugadores (mapa id -> nombre)
      const { data: players } = await supabase
        .from("players")
        .select("id, name")
        .eq("is_approved", true);

      const pMap: PlayerMap = {};
      (players || []).forEach((p) => {
        pMap[p.id] = p.name;
      });
      setPlayerMap(pMap);
      // Guardamos el mapa local para usarlo en el ranking (evita estado stale)
      const localPlayerMap = pMap;

      // 3) Torneos (mapa id -> nombre)
      const { data: tournaments } = await supabase
        .from("tournaments")
        .select("id, name");

      const tMap: TournamentMap = {};
      (tournaments || []).forEach((t) => {
        tMap[t.id] = t.name;
      });
      setTournamentMap(tMap);

      // 4) Partidos pendientes
      const { data: matches } = await supabase
        .from("matches")
        .select(
          "id, start_time, tournament_id, round_name, place, court, player_1_a, player_2_a, player_1_b, player_2_b, winner, score"
        )
        .eq("winner", "pending")
        .order("start_time", { ascending: true })
        .limit(5);

      setUpcomingMatches(matches || []);

      // 4.5) Resultados recientes
      const { data: finishedMatches } = await supabase
        .from("matches")
        .select("id, score, player_1_a, player_2_a, player_1_b, player_2_b, created_at")
        .neq("winner", "pending")
        .order("created_at", { ascending: false })
        .limit(5);

      setRecentResults(finishedMatches || []);

      // 5) Logs iniciales
      const { data: logs } = await supabase
        .from("action_logs")
        .select("id, action, entity, entity_id, user_email, created_at")
        .order("created_at", { ascending: false })
        .limit(6);

      setRecentLogs(logs || []);

      // 5.5) Ranking real
      const { data: rankingMatches } = await supabase
        .from("matches")
        .select("winner, player_1_a, player_2_a, player_1_b, player_2_b")
        .neq("winner", "pending");

      const rankingMap: Record<number, RankingItem> = {};

      (rankingMatches || []).forEach((m) => {
        const winners =
          m.winner === "A"
            ? [m.player_1_a, m.player_2_a]
            : m.winner === "B"
            ? [m.player_1_b, m.player_2_b]
            : [];

        winners.forEach((pid: number | null) => {
          if (!pid) return;
          if (!rankingMap[pid]) {
            rankingMap[pid] = {
              player_id: pid,
              name: localPlayerMap[pid] || `Jugador ${pid}`,
              points: 0,
              wins: 0,
            };
          }
          rankingMap[pid].wins += 1;
          rankingMap[pid].points += 100;
        });
      });

      setTopRanking(
        Object.values(rankingMap)
          .sort((a, b) => b.points - a.points)
          .slice(0, 5)
      );

      // 6) Alertas inteligentes
      await calculateAlerts();

      setLoadingDashboard(false);
    };

    loadData();
  }, [calculateAlerts]);


  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel("realtime-action-logs")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "action_logs",
        },
        (payload) => {
          const newLog = payload.new as AuditLog;

          setRecentLogs((prev) => {
            const updated = [newLog, ...prev];
            return updated.slice(0, 6);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  useEffect(() => {
    // KPIs en tiempo real (admin y manager)
    const channel = supabase
      .channel("realtime-kpis")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        async () => {
          const { count } = await supabase
            .from("matches")
            .select("*", { count: "exact", head: true })
            .eq("winner", "pending");

          setCountPendingMatches(count || 0);
          // Dashboard PRO v2: recalcular resumen últimos 30 días
          // await fetchSummary30d(); // <-- eliminado: no actualizar gráficos desde realtime
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        async () => {
          const { count } = await supabase
            .from("players")
            .select("*", { count: "exact", head: true })
            .eq("is_approved", true);

          setCountPlayers(count || 0);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournaments" },
        async () => {
          const { count } = await supabase
            .from("tournaments")
            .select("*", { count: "exact", head: true });

          setCountTournaments(count || 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);


  const getPlayerName = (id: number | null) =>
    id && playerMap[id] ? playerMap[id] : id ? `ID ${id}` : "-";

  const getTournamentName = (id: number | null) =>
    id && tournamentMap[id] ? tournamentMap[id] : id ? `Torneo #${id}` : "Sin torneo";

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

  if (isUser) {
    // Usuario cliente: solo vista informativa
  }
  return (
    <main className="w-full overflow-x-hidden px-4 py-6 md:px-8 lg:px-10 lg:py-8">
      <div className="max-w-5xl mx-auto">
        {/* HEADER */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900">
              Panel General
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Resumen de tu club en tiempo real.
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
            {new Date().toLocaleDateString("es-ES", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </div>
        </header>

        {/* ACCIONES RÁPIDAS */}
        {(isAdmin || isManager) && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Acciones rápidas
            </h2>

            <div className="flex flex-wrap gap-3">
              {/* Crear partido */}
              <Link
                href="/matches/create"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 transition"
              >
                ➕ Crear partido
              </Link>

              {/* Cargar resultados */}
              <Link
                href="/matches?status=pending"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 transition"
              >
                🎯 Cargar resultados
              </Link>

              {/* Crear torneo (solo admin) */}
              {isAdmin && (
                <Link
                  href="/tournaments/create"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 transition"
                >
                  🏆 Crear torneo
                </Link>
              )}

              {/* Gestión de usuarios (solo admin) */}
              {isAdmin && (
                <Link
                  href="/admin/users"
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100 transition"
                >
                  👤 Crear usuario
                </Link>
              )}

              {/* Ver logs (solo admin) */}
              {isAdmin && (
                <Link
                  href="/admin/logs"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 transition"
                >
                  📜 Ver logs
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/admin/users/manage"
                  className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-semibold text-purple-700 shadow-sm hover:bg-purple-100 transition"
                >
                  🛠️ Administrar usuarios
                </Link>
              )}
            </div>
          </section>
        )}

        {/* KPI CARDS */}
        {(isAdmin || isManager) && (
          loadingDashboard ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-28 bg-gray-100 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
              <div className="bg-white rounded-xl shadow-sm p-5 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Torneos Activos</p>
                  <p className="text-3xl font-bold">{countTournaments}</p>
                  <p className="text-xs text-green-600 mt-1">+12% vs mes anterior</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-xl">🏆</div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-5 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Partidos esta semana</p>
                  <p className="text-3xl font-bold">{countPendingMatches}</p>
                  <p className="text-xs text-green-600 mt-1">+25% vs mes anterior</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-xl">🎾</div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-5 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Jugadores registrados</p>
                  <p className="text-3xl font-bold">{countPlayers}</p>
                  <p className="text-xs text-green-600 mt-1">+8% vs mes anterior</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-xl">👥</div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-5 flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-500">Próximo partido</p>
                  <p className="text-2xl font-bold">
                    {upcomingMatches[0]?.start_time
                      ? new Date(upcomingMatches[0].start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center text-green-600 text-xl">📅</div>
              </div>
            </section>
          )
        )}


        {/* ALERTAS INTELIGENTES */}
        {(isAdmin || isManager) && alerts.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Alertas Inteligentes
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-xl border p-4 text-sm shadow-sm flex items-start justify-between gap-4 ${
                    alert.type === "warning"
                      ? "bg-yellow-50 border-yellow-300 text-yellow-900"
                      : "bg-blue-50 border-blue-300 text-blue-900"
                  }`}
                >
                  <p>{alert.message}</p>
                  {alert.actionHref && alert.actionLabel && (
                    <Link
                      href={alert.actionHref}
                      className="shrink-0 inline-flex items-center rounded-md bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-white transition"
                    >
                      {alert.actionLabel} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PRÓXIMOS PARTIDOS (CARDS) */}
        <section className="mt-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              Próximos Partidos
            </h2>
            <Link
              href="/matches"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Ver todos →
            </Link>
          </div>

          <div className="space-y-6">
            {upcomingMatches.map((m) => (
              <div
                key={m.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5"
              >
                {/* Tournament */}
                <div className="mb-4">
                  <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                    {getTournamentName(m.tournament_id)}
                  </span>
                </div>

                {/* Players */}
                <div className="grid grid-cols-3 items-center text-center gap-4">
                  <div>
                    <p className="text-lg font-bold text-gray-900">
                      {getPlayerName(m.player_1_a)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {getPlayerName(m.player_2_a)}
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <span className="flex items-center justify-center h-12 w-12 rounded-full bg-green-100 text-green-700 font-bold">
                      VS
                    </span>
                  </div>

                  <div>
                    <p className="text-lg font-bold text-gray-900">
                      {getPlayerName(m.player_1_b)}
                    </p>
                    <p className="text-sm text-gray-500">
                      {getPlayerName(m.player_2_b)}
                    </p>
                  </div>
                </div>

                {/* Divider */}
                <div className="my-4 h-px bg-gray-200" />

                {/* Meta */}
                <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    📅 {m.start_time
                      ? new Date(m.start_time).toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "Sin fecha"}
                  </div>
                  <div className="flex items-center gap-2">
                    ⏰ {m.start_time
                      ? new Date(m.start_time).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "--:--"}
                  </div>
                  <div className="flex items-center gap-2">
                    📍 {m.court ?? "Sin pista"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* RANKING + RESULTADOS */}
        <section className="mt-10 grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Resultados recientes */}
          <div className="xl:col-span-2">
            <h2 className="text-lg font-bold mb-4">Resultados Recientes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentResults.map((m) => (
                <div key={m.id} className="bg-white rounded-xl border p-4 shadow-sm">
                  <p className="font-semibold text-sm">
                    {getPlayerName(m.player_1_a)} / {getPlayerName(m.player_2_a)}
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    vs {getPlayerName(m.player_1_b)} / {getPlayerName(m.player_2_b)}
                  </p>
                  <p className="text-green-600 font-bold">{m.score}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Ranking */}
          <div>
            <h2 className="text-lg font-bold mb-4">Top Ranking</h2>
            <div className="bg-white rounded-xl border shadow-sm divide-y">
              {topRanking.map((r, idx) => {
                const medal =
                  idx === 0 ? "🥇" :
                  idx === 1 ? "🥈" :
                  idx === 2 ? "🥉" :
                  null;

                return (
                  <Link
                    key={r.player_id}
                    href={`/players/${r.player_id}`}
                    className="flex items-center justify-between p-4 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 text-center text-lg font-bold text-gray-500">
                        {medal ?? idx + 1}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-gray-900">
                          {r.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {r.wins} victorias
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-bold text-green-600 text-lg">
                        {r.points}
                      </p>
                      <p className="text-xs text-gray-400">
                        puntos
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* ACTIVIDAD RECIENTE */}
        {isAdmin && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Actividad Reciente
            </h2>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y">
              {recentLogs.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">
                  No hay actividad registrada.
                </p>
              ) : (
                recentLogs.map((log) => (
                  <div key={log.id} className="p-4 flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-green-500" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-800">
                        <span className="font-semibold">
                          {log.user_email ?? "Sistema"}
                        </span>{" "}
                        realizó{" "}
                        <span className="font-semibold">
                          {log.action.replace(/_/g, " ").toLowerCase()}
                        </span>
                        {log.entity && (
                          <>
                            {" "}
                            en <span className="font-semibold">{log.entity}</span>
                          </>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(log.created_at).toLocaleString("es-ES")}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}