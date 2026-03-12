"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

import Card from "../../components/Card";
import { logAction } from "../../lib/audit";
import { useTenantPlan } from "../../hooks/useTenantPlan";
import { useRole } from "../../hooks/useRole";
import { supabase } from "../../lib/supabase";
import {
  DEFAULT_LEAGUE_MODE,
  DEFAULT_TOURNAMENT_TYPE,
  LEAGUE_MODE_LABEL,
  TOURNAMENT_TYPE_LABEL,
  type LeagueMode,
  type TournamentType,
} from "../../lib/tournamentFormats";

type TournamentInsert = {
  name: string;
  category: string;
  status: string;
  start_date: string | null;
  tournament_type: TournamentType;
  league_mode: LeagueMode | null;
  rounds: Array<{
    round_number: number;
    round_name: string;
    start_at: string;
  }>;
};

export default function CreateTournament() {
  const router = useRouter();
  const { isAdmin, isManager, loading: roleLoading } = useRole();
  const { loading: planLoading, plan, canCreateTournament, usage } = useTenantPlan();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Mixto A");
  const [status, setStatus] = useState("open");
  const [startDate, setStartDate] = useState<string>("");
  const [tournamentType, setTournamentType] = useState<TournamentType>(DEFAULT_TOURNAMENT_TYPE);
  const [leagueMode, setLeagueMode] = useState<LeagueMode>(DEFAULT_LEAGUE_MODE);
  const [roundsCount, setRoundsCount] = useState<number>(1);
  const [roundStarts, setRoundStarts] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  const isLeague = tournamentType === "league";

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin && !isManager) {
      toast.error("No tenés permisos para crear torneos");
      router.replace("/tournaments");
    }
  }, [isAdmin, isManager, roleLoading, router]);

  const tournamentSummary = useMemo(() => {
    if (tournamentType === "cup") {
      return "Copa por eliminación directa: cada partido define quién avanza en el cuadro y quién queda eliminado.";
    }

    return leagueMode === "double_leg"
      ? "Liga todos contra todos con ida y vuelta entre cada cruce de parejas."
      : "Liga todos contra todos con un único cruce por enfrentamiento de parejas.";
  }, [leagueMode, tournamentType]);

  const handleCreate = async () => {
    if (!isAdmin && !isManager) {
      toast.error("No tenés permisos para crear torneos");
      return;
    }

    if (!name.trim()) {
      toast.error("Ingresá un nombre para el torneo");
      return;
    }

    if (!canCreateTournament) {
      toast.error(`Limite de torneos activos alcanzado (${usage.activeTournamentCount}/${plan?.max_concurrent_tournaments}). Finaliza un torneo o actualiza tu plan.`);
      return;
    }

    setLoading(true);

    const finalCategory = isCustomCategory ? customCategory.trim() : category;

    if (!finalCategory) {
      toast.error("Ingresá una categoría válida");
      setLoading(false);
      return;
    }

    const payload: TournamentInsert = {
      name: name.trim(),
      category: finalCategory,
      status,
      start_date: startDate ? startDate : null,
      tournament_type: tournamentType,
      league_mode: tournamentType === "league" ? leagueMode : null,
      rounds: [],
    };

    if (isLeague) {
      const normalizedRoundCount = Math.max(1, Math.min(40, roundsCount));
      const roundsPayload: TournamentInsert["rounds"] = [];

      for (let index = 0; index < normalizedRoundCount; index += 1) {
        const localDateTime = String(roundStarts[index] || "").trim();
        if (!localDateTime) {
          toast.error(`Completá la fecha de inicio de la jornada ${index + 1}`);
          setLoading(false);
          return;
        }

        const parsed = new Date(localDateTime);
        if (Number.isNaN(parsed.getTime())) {
          toast.error(`La fecha de la jornada ${index + 1} es inválida`);
          setLoading(false);
          return;
        }

        roundsPayload.push({
          round_number: index + 1,
          round_name: `Fecha ${index + 1}`,
          start_at: parsed.toISOString(),
        });
      }

      payload.rounds = roundsPayload;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      toast.error("Sesión no válida. Volvé a iniciar sesión.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/tournaments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.data?.id) {
      const msg = result?.error || "Error al crear el torneo";
      console.error("[CreateTournament] API error:", msg);
      toast.error(msg);
      setLoading(false);
      return;
    }

    try {
      await logAction({
        action: "CREATE_TOURNAMENT",
        entity: "tournament",
        entityId: result.data.id,
        metadata: payload,
      });
    } catch (e) {
      console.warn("No se pudo registrar la acción en auditoría", e);
    }

    toast.success("Torneo creado");
    setLoading(false);

    router.push(`/tournaments/edit/${result.data.id}`);
  };

  if (roleLoading) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
        <p className="text-gray-500 animate-pulse">Validando permisos...</p>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">Crear Torneo</h2>

      {!planLoading && !canCreateTournament && (
        <div className="max-w-3xl mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded-lg text-yellow-800 text-sm">
          <strong>Limite alcanzado:</strong> Tu plan {plan?.name} permite hasta {plan?.max_concurrent_tournaments} torneo(s) activo(s) y ya tienes {usage.activeTournamentCount}. Finaliza un torneo o contacta al administrador para actualizar tu plan.
        </div>
      )}

      <Card className="max-w-4xl">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Ej: Torneo Apertura"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Categoría</label>
            <select
              value={isCustomCategory ? "__custom__" : category}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "__custom__") {
                  setIsCustomCategory(true);
                  setCategory("");
                } else {
                  setIsCustomCategory(false);
                  setCategory(value);
                }
              }}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="Mixto A">Mixto A</option>
              <option value="Mixto B">Mixto B</option>
              <option value="Masculino A">Masculino A</option>
              <option value="Masculino B">Masculino B</option>
              <option value="Femenino A">Femenino A</option>
              <option value="Femenino B">Femenino B</option>
              <option value="__custom__">➕ Crear categoría</option>
            </select>
          </div>

          {isCustomCategory && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre de la nueva categoría</label>
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="Ej: Senior +40"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="open">Abierto (Inscripciones)</option>
              <option value="ongoing">En curso</option>
              <option value="finished">Finalizado</option>
            </select>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Tipo de torneo</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(["league", "cup"] as TournamentType[]).map((typeOption) => {
                const active = tournamentType === typeOption;
                return (
                  <button
                    key={typeOption}
                    type="button"
                    onClick={() => setTournamentType(typeOption)}
                    className={`rounded-xl border p-4 text-left transition ${
                      active
                        ? "border-green-500 bg-green-50 shadow-sm"
                        : "border-gray-300 bg-white hover:border-gray-400"
                    }`}
                  >
                    <p className="font-semibold text-gray-900">{TOURNAMENT_TYPE_LABEL[typeOption]}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {typeOption === "league"
                        ? "Todos contra todos entre parejas."
                        : "Eliminación directa en formato de llaves."}
                    </p>

                    {typeOption === "league" ? (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="h-px flex-1 bg-emerald-300" />
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="h-px flex-1 bg-emerald-300" />
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-3 gap-1 items-center">
                        <span className="h-6 rounded bg-blue-100" />
                        <span className="h-px bg-blue-300" />
                        <span className="h-6 rounded bg-indigo-100" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {isLeague && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Modo de Liga</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(["single_leg", "double_leg"] as LeagueMode[]).map((modeOption) => {
                  const active = leagueMode === modeOption;
                  return (
                    <button
                      key={modeOption}
                      type="button"
                      onClick={() => setLeagueMode(modeOption)}
                      className={`rounded-xl border p-4 text-left transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50 shadow-sm"
                          : "border-gray-300 bg-white hover:border-gray-400"
                      }`}
                    >
                      <p className="font-semibold text-gray-900">{LEAGUE_MODE_LABEL[modeOption]}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {modeOption === "single_leg"
                          ? "Cada pareja juega una vez contra cada rival."
                          : "Cada cruce se juega dos veces (ida y vuelta)."}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-semibold text-gray-800 mb-1">Resumen del formato</p>
            <p>{tournamentSummary}</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Fecha Inicio</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const value = e.target.value;
                setStartDate(value);
                if (!isLeague || !value) return;
                setRoundStarts((prev) => {
                  if (!prev.length || prev[0]) return prev;
                  const next = [...prev];
                  next[0] = `${value}T20:00`;
                  return next;
                });
              }}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          {isLeague && (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Cantidad de jornadas</label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={roundsCount}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    const nextCount = Number.isFinite(parsed)
                      ? Math.max(1, Math.min(40, Math.trunc(parsed)))
                      : 1;

                    setRoundsCount(nextCount);
                    setRoundStarts((prev) => {
                      const next = [...prev];
                      while (next.length < nextCount) next.push("");
                      return next.slice(0, nextCount);
                    });
                  }}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">Definí cuántas fechas tendrá la liga.</p>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700">Fechas de inicio por jornada</p>
                {Array.from({ length: Math.max(1, Math.min(40, roundsCount)) }).map((_, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2 items-center">
                    <label className="text-sm text-gray-600">{`Jornada ${index + 1}`}</label>
                    <input
                      type="datetime-local"
                      value={roundStarts[index] || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRoundStarts((prev) => {
                          const next = [...prev];
                          next[index] = value;
                          return next;
                        });
                      }}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => router.push("/tournaments")}
              className="px-4 py-2 rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
              disabled={loading}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleCreate}
              className="px-5 py-2 rounded bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
              disabled={loading || !canCreateTournament}
            >
              {loading ? "Creando..." : "Crear torneo"}
            </button>
          </div>
        </div>
      </Card>
    </main>
  );
}
