"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useRouter, useParams } from "next/navigation";
import Card from "../../../components/Card";
import Link from "next/link";
import { useRole } from "../../../hooks/useRole";
import MatchCard from "../../../components/matches/MatchCard";
import toast from "react-hot-toast";

type TournamentRound = {
  id: number;
  round_number: number;
  round_name: string;
  start_at: string;
};

function toDateTimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function EditTournament() {
  const router = useRouter();
  const params = useParams();

  const idNumber = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    start_date: "",
    end_date: "",
    status: "abierto",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canManageByProfile, setCanManageByProfile] = useState(false);

  const { isAdmin, isManager, loading: roleLoading } = useRole();
  const canManageTournament = isAdmin || isManager || canManageByProfile;
  const [matches, setMatches] = useState<any[]>([]);
  const [rounds, setRounds] = useState<TournamentRound[]>([]);
  const [roundsBusy, setRoundsBusy] = useState(false);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundStartAt, setNewRoundStartAt] = useState("");
  const [editingRoundId, setEditingRoundId] = useState<number | null>(null);
  const [editingRoundName, setEditingRoundName] = useState("");
  const [editingRoundStartAt, setEditingRoundStartAt] = useState("");
  const [tenantId, setTenantId] = useState<string>("");
  const [playersMap, setPlayersMap] = useState<Record<number, string>>({});
  const [openResultMatch, setOpenResultMatch] = useState<any | null>(null);
  const shareCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkManageRole = async () => {
      try {
        const res = await fetch("/api/auth/whoami-role", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (mounted) {
          setCanManageByProfile(Boolean(data?.can_manage_tournaments));
        }
      } catch {
        if (mounted) setCanManageByProfile(false);
      }
    };
    checkManageRole();
    return () => {
      mounted = false;
    };
  }, []);

  // Cargar datos del torneo y partidos
  useEffect(() => {
    if (roleLoading && !canManageByProfile) return;
    if (!canManageTournament) {
      toast.error("No tenés permisos para editar torneos");
      router.replace("/tournaments");
    }
  }, [canManageByProfile, canManageTournament, roleLoading, router]);

  useEffect(() => {
    if ((roleLoading && !canManageByProfile) || !canManageTournament) return;

    const getTournamentAndMatches = async () => {
      if (!idNumber || isNaN(idNumber)) {
        setErrorMsg("ID de torneo inválido");
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("tournaments")
          .select("*")
          .eq("id", idNumber)
          .single();

        if (error) {
          console.error("Error cargando torneo:", error);
          setErrorMsg("Error cargando torneo");
          setLoading(false);
          return;
        }

        if (data) {
          setFormData({
            name: data.name || "",
            category: data.category || "",
            start_date: data.start_date ? data.start_date.split("T")[0] : "",
            end_date: data.end_date ? data.end_date.split("T")[0] : "",
            status: data.status || "abierto",
          });
          setTenantId(data.tenant_id || "");
          if (data.start_date) {
            setNewRoundStartAt((prev) => prev || `${data.start_date.split("T")[0]}T20:00`);
          }
        }
      } catch (err) {
        console.error("Excepción al cargar torneo:", err);
        setErrorMsg("Error inesperado cargando torneo");
        setLoading(false);
        return;
      }

      try {
        const [
          { data: matchesData, error: matchesError },
          { data: roundsData, error: roundsError },
        ] = await Promise.all([
          supabase
            .from("matches")
            .select(`
              id, tournament_id, round_name, place, court, start_time, score, winner,
              player_1_a, player_2_a, player_1_b, player_2_b,
              p1a:players!matches_player_1_a_fkey(id,name),
              p2a:players!matches_player_2_a_fkey(id,name),
              p1b:players!matches_player_1_b_fkey(id,name),
              p2b:players!matches_player_2_b_fkey(id,name)
            `)
            .eq("tournament_id", idNumber)
            .order("start_time", { ascending: true }),
          supabase
            .from("tournament_rounds")
            .select("id, round_number, round_name, start_at")
            .eq("tournament_id", idNumber)
            .order("round_number", { ascending: true }),
        ]);

        if (matchesError) {
          console.error("Error cargando partidos del torneo:", matchesError);
          setMatches([]);
        } else {
          const normalized = (matchesData ?? []).map((m: any) => ({
            ...m,
            player_1_a: m.p1a ?? m.player_1_a,
            player_2_a: m.p2a ?? m.player_2_a,
            player_1_b: m.p1b ?? m.player_1_b,
            player_2_b: m.p2b ?? m.player_2_b,
          }));

          setMatches(normalized);

          const map: Record<number, string> = {};
          normalized.forEach((mm: any) => {
            const vals = [mm.player_1_a, mm.player_2_a, mm.player_1_b, mm.player_2_b];
            vals.forEach((v: any) => {
              if (v && typeof v === "object" && typeof v.id === "number" && typeof v.name === "string") {
                map[v.id] = v.name;
              }
            });
          });
          setPlayersMap(map);
        }

        if (roundsError) {
          console.error("Error cargando jornadas del torneo:", roundsError);
          setRounds([]);
        } else {
          setRounds((roundsData || []) as TournamentRound[]);
        }
      } catch (err) {
        console.error("Excepción al cargar partidos/jornadas:", err);
        setMatches([]);
        setRounds([]);
      } finally {
        setLoading(false);
      }
    };

    getTournamentAndMatches();
  }, [canManageByProfile, canManageTournament, idNumber, roleLoading]);

  if (roleLoading && !canManageByProfile) {
    return (
      <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20">
        <p className="text-gray-600">Validando permisos...</p>
      </main>
    );
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!idNumber || isNaN(idNumber)) {
      alert("ID de torneo inválido");
      setLoading(false);
      return;
    }

    const normalizedStatus = String(formData.status || "").toLowerCase();
    const mustHaveEndDate =
      normalizedStatus === "finalizado" || normalizedStatus === "finished";
    const normalizedEndDate = formData.end_date ? formData.end_date : null;

    if (mustHaveEndDate && !normalizedEndDate) {
      setLoading(false);
      toast.error("Para finalizar el torneo debés indicar una fecha de finalización");
      return;
    }

    const payloadWithEndDate = {
      name: formData.name,
      category: formData.category,
      start_date: formData.start_date || null,
      // Guardamos la fecha de finalizacion siempre que el usuario la complete.
      // Si el estado es finalizado, ademas pasa a ser obligatoria.
      end_date: normalizedEndDate,
      status: formData.status,
    };

    let { error } = await supabase
      .from("tournaments")
      .update(payloadWithEndDate)
      .eq("id", idNumber);

    if (
      error &&
      /end_date/i.test(error.message || "") &&
      /(does not exist|column)/i.test(error.message || "")
    ) {
      const fallbackPayload = {
        name: formData.name,
        category: formData.category,
        start_date: formData.start_date || null,
        status: formData.status,
      };
      const fallbackRes = await supabase
        .from("tournaments")
        .update(fallbackPayload)
        .eq("id", idNumber);
      error = fallbackRes.error;
    }

    if (error) {
      console.error("Error UPDATE tournaments:", error);
      alert("Error al actualizar: " + (error.message || "Error desconocido"));
      setLoading(false);
    } else {
      router.push("/tournaments");
      router.refresh();
    }
  };

  const handleDeleteMatch = async (matchId: number) => {
    if (!confirm("¿Eliminar este partido?")) return;

    const { error } = await supabase
      .from("matches")
      .delete()
      .eq("id", matchId);

    if (error) {
      alert("Error eliminando partido");
    } else {
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    }
  };

  const getNextRoundNumber = () => {
    const numbers = new Set(rounds.map((round) => round.round_number));
    let next = 1;
    while (numbers.has(next)) next += 1;
    return next;
  };

  const handleAddRound = async () => {
    const parsed = new Date(newRoundStartAt);
    if (!newRoundStartAt || Number.isNaN(parsed.getTime())) {
      toast.error("Seleccioná fecha y hora de inicio de la jornada");
      return;
    }

    const nextRoundNumber = getNextRoundNumber();
    const nextRoundName = newRoundName.trim() || `Fecha ${nextRoundNumber}`;

    setRoundsBusy(true);

    let effectiveTenantId = tenantId;
    if (!effectiveTenantId) {
      const { data: tenantData, error: tenantError } = await supabase
        .from("tournaments")
        .select("tenant_id")
        .eq("id", idNumber)
        .single();

      if (tenantError || !tenantData?.tenant_id) {
        console.error("Error resolviendo tenant del torneo:", tenantError);
        setRoundsBusy(false);
        toast.error("No se pudo resolver el tenant del torneo");
        return;
      }

      effectiveTenantId = tenantData.tenant_id;
      setTenantId(effectiveTenantId);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("tournament_rounds")
      .insert({
        tournament_id: idNumber,
        tenant_id: effectiveTenantId,
        round_number: nextRoundNumber,
        round_name: nextRoundName,
        start_at: parsed.toISOString(),
        created_by: user?.id ?? null,
      })
      .select("id, round_number, round_name, start_at")
      .single();

    setRoundsBusy(false);

    if (error || !data) {
      console.error("Error creando jornada:", error);
      toast.error("No se pudo crear la jornada");
      return;
    }

    setRounds((prev) =>
      [...prev, data as TournamentRound].sort((a, b) => a.round_number - b.round_number)
    );
    setNewRoundName("");
    toast.success("Jornada creada");
  };

  const startEditRound = (round: TournamentRound) => {
    setEditingRoundId(round.id);
    setEditingRoundName(round.round_name);
    setEditingRoundStartAt(toDateTimeLocalValue(round.start_at));
  };

  const cancelEditRound = () => {
    setEditingRoundId(null);
    setEditingRoundName("");
    setEditingRoundStartAt("");
  };

  const handleSaveRoundEdit = async (round: TournamentRound) => {
    const trimmedName = editingRoundName.trim();
    if (!trimmedName) {
      toast.error("El nombre de la jornada es obligatorio");
      return;
    }

    const parsed = new Date(editingRoundStartAt);
    if (!editingRoundStartAt || Number.isNaN(parsed.getTime())) {
      toast.error("Seleccioná una fecha y hora válida para la jornada");
      return;
    }

    setRoundsBusy(true);

    const isRenaming = trimmedName !== round.round_name;
    if (isRenaming) {
      const { error: renameMatchesError } = await supabase
        .from("matches")
        .update({ round_name: trimmedName })
        .eq("tournament_id", idNumber)
        .eq("round_name", round.round_name);

      if (renameMatchesError) {
        console.error("Error renombrando partidos de la jornada:", renameMatchesError);
        setRoundsBusy(false);
        toast.error("No se pudo actualizar el nombre en los partidos de la jornada");
        return;
      }
    }

    const { error: updateRoundError } = await supabase
      .from("tournament_rounds")
      .update({
        round_name: trimmedName,
        start_at: parsed.toISOString(),
      })
      .eq("id", round.id);

    if (updateRoundError) {
      console.error("Error actualizando jornada:", updateRoundError);
      if (isRenaming) {
        await supabase
          .from("matches")
          .update({ round_name: round.round_name })
          .eq("tournament_id", idNumber)
          .eq("round_name", trimmedName);
      }
      setRoundsBusy(false);
      toast.error("No se pudo editar la jornada");
      return;
    }

    setRounds((prev) =>
      prev.map((item) =>
        item.id === round.id
          ? {
              ...item,
              round_name: trimmedName,
              start_at: parsed.toISOString(),
            }
          : item
      )
    );
    if (isRenaming) {
      setMatches((prev) =>
        prev.map((match) =>
          match.round_name === round.round_name
            ? { ...match, round_name: trimmedName }
            : match
        )
      );
    }

    setRoundsBusy(false);
    cancelEditRound();
    toast.success("Jornada actualizada");
  };

  const handleDeleteRound = async (round: TournamentRound) => {
    const confirmDelete = confirm(`¿Eliminar ${round.round_name}?`);
    if (!confirmDelete) return;

    setRoundsBusy(true);

    const { count, error: countError } = await supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", idNumber)
      .eq("round_name", round.round_name);

    if (countError) {
      console.error("Error validando partidos de la jornada:", countError);
      setRoundsBusy(false);
      toast.error("No se pudo validar la jornada");
      return;
    }

    if ((count || 0) > 0) {
      setRoundsBusy(false);
      toast.error("Debe eliminar los partidos para eliminar la jornada");
      return;
    }

    const { error } = await supabase
      .from("tournament_rounds")
      .delete()
      .eq("id", round.id);

    setRoundsBusy(false);

    if (error) {
      console.error("Error eliminando jornada:", error);
      toast.error("No se pudo eliminar la jornada");
      return;
    }

    setRounds((prev) => prev.filter((item) => item.id !== round.id));
    if (editingRoundId === round.id) cancelEditRound();
    toast.success("Jornada eliminada");
  };

  const isPlayed = (m: any) =>
    !!m?.score && !!m?.winner && String(m.winner).toLowerCase() !== "pending";

  const formatScoreForDisplay = (raw: string | null) => {
    if (!raw) return "";
    return raw.replace(/\s+/g, " ").trim();
  };

  const buildTeamName = (p1?: any, p2?: any) => {
    const a = p1?.name ? p1.name : "";
    const b = p2?.name ? p2.name : "";
    const joined = [a, b].filter(Boolean).join(" / ");
    return joined || "Por definir";
  };

  const getWinnerLoserTeams = (m: any) => {
    const teamA = buildTeamName(m.player_1_a, m.player_2_a);
    const teamB = buildTeamName(m.player_1_b, m.player_2_b);
    const score = formatScoreForDisplay(m.score);

    if (m.winner === "A") return { winnerTeam: teamA, loserTeam: teamB, score };
    if (m.winner === "B") return { winnerTeam: teamB, loserTeam: teamA, score };
    return { winnerTeam: teamA, loserTeam: teamB, score };
  };

  const formatShareDate = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
  };

  const formatShareTime = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20">
      {loading ? (
        <p className="text-gray-600">Cargando torneo...</p>
      ) : errorMsg ? (
        <p className="text-red-600 font-semibold">{errorMsg}</p>
      ) : (
        <Card className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Editar torneo</h2>

          <form onSubmit={handleUpdate} className="space-y-4">
            {/* Nombre */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre
              </label>
              <input
                type="text"
                className="w-full p-2 border border-gray-300 rounded outline-none"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>

            {/* Categoría */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categoría
              </label>
              <select
                className="w-full p-2 border border-gray-300 rounded outline-none"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
              >
                <option value="">Selecciona una categoría</option>
                <option value="1ra Categoría">1ra Categoría</option>
                <option value="2da Categoría">2da Categoría</option>
                <option value="3ra Categoría">3ra Categoría</option>
                <option value="Mixto A">Mixto A</option>
                <option value="Mixto B">Mixto B</option>
              </select>
            </div>

            {/* Estado */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estado
              </label>
              <select
                className="w-full p-2 border border-gray-300 rounded outline-none"
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
              >
                <option value="abierto">Abierto (Inscripciones)</option>
                <option value="en_curso">En Curso</option>
                <option value="finalizado">Finalizado</option>
              </select>
            </div>

            {/* Fecha */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de inicio
              </label>
              <input
                type="date"
                className="w-full p-2 border border-gray-300 rounded outline-none"
                value={formData.start_date}
                onChange={(e) =>
                  setFormData({ ...formData, start_date: e.target.value })
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de finalización
              </label>
              <input
                type="date"
                className="w-full p-2 border border-gray-300 rounded outline-none"
                value={formData.end_date}
                onChange={(e) =>
                  setFormData({ ...formData, end_date: e.target.value })
                }
              />
              {formData.status === "finalizado" && !formData.end_date && (
                <p className="mt-1 text-xs text-red-600">
                  Para finalizar el torneo, cargá la fecha de finalización.
                </p>
              )}
            </div>

            {/* Botones */}
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
                onClick={() => router.push("/tournaments")}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-white bg-green-600 rounded hover:bg-green-700"
              >
                Guardar cambios
              </button>
            </div>
          </form>

          <hr className="my-8" />

          <h3 className="text-xl font-bold mb-4">Jornadas</h3>

          <div className="space-y-3 mb-4">
            {rounds.length === 0 ? (
              <p className="text-sm text-gray-500">No hay jornadas cargadas para este torneo.</p>
            ) : (
              rounds.map((round) => (
                <div
                  key={round.id}
                  className="border border-gray-200 rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  {editingRoundId === round.id ? (
                    <div className="w-full space-y-2">
                      <input
                        type="text"
                        value={editingRoundName}
                        onChange={(e) => setEditingRoundName(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded outline-none"
                        placeholder="Nombre de la jornada"
                      />
                      <input
                        type="datetime-local"
                        value={editingRoundStartAt}
                        onChange={(e) => setEditingRoundStartAt(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-gray-800">{round.round_name}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(round.start_at).toLocaleString("es-ES", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Europe/Madrid",
                        })}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {editingRoundId === round.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveRoundEdit(round)}
                          disabled={roundsBusy}
                          className="px-3 py-1 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditRound}
                          disabled={roundsBusy}
                          className="px-3 py-1 rounded-md bg-gray-200 text-gray-700 text-sm hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditRound(round)}
                        disabled={roundsBusy}
                        className="px-3 py-1 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Editar jornada
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteRound(round)}
                      disabled={roundsBusy}
                      className="px-3 py-1 rounded-md bg-red-100 text-red-700 text-sm hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Eliminar jornada
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3 mb-8">
            <p className="font-semibold text-gray-800">Agregar jornada</p>
            <input
              type="text"
              value={newRoundName}
              onChange={(e) => setNewRoundName(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded outline-none"
              placeholder={`Nombre (opcional, por defecto "Fecha ${getNextRoundNumber()}")`}
            />
            <input
              type="datetime-local"
              value={newRoundStartAt}
              onChange={(e) => setNewRoundStartAt(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded outline-none"
            />
            <button
              type="button"
              onClick={handleAddRound}
              disabled={roundsBusy}
              className="px-4 py-2 text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Agregar jornada
            </button>
          </div>

          <hr className="my-8" />

          <h3 className="text-xl font-bold mb-4">Partidos del Torneo</h3>

          {canManageTournament && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => router.push(`/matches/create/manual?tournament=${idNumber}`)}
                className="bg-green-600 !text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-green-700 transition"
                style={{ WebkitTextFillColor: "#fff" }}
              >
                + Crear partido
              </button>

              <button
                type="button"
                onClick={() => router.push(`/tournaments/${idNumber}/generate-matches`)}
                className="bg-indigo-600 !text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 transition"
                style={{ WebkitTextFillColor: "#fff" }}
              >
                Crear partidos aleatorios
              </button>
            </div>
          )}

          {matches.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay partidos asociados a este torneo.</p>
          ) : (
            <div className="space-y-4">
              {matches.map((m) => (
                <div key={m.id} className="space-y-3">
                  <div onClick={() => setOpenResultMatch(m)} className="cursor-pointer">
                    <MatchCard match={m} playersMap={playersMap} showActions={false} />
                  </div>

                  <div className="flex justify-end gap-2">
                    {(isAdmin || isManager) && (
                      <>
                        <Link
                          href={`/matches/edit/${m.id}`}
                          className="px-3 py-1 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
                        >
                          Editar partido
                        </Link>

                        <Link
                          href={`/matches/score/${m.id}`}
                          className="px-3 py-1 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700"
                        >
                          Editar resultado
                        </Link>
                      </>
                    )}

                    {isAdmin && (
                      <button
                        onClick={() => handleDeleteMatch(m.id)}
                        className="px-3 py-1 rounded-md bg-red-100 text-red-700 text-sm hover:bg-red-200"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {openResultMatch && isPlayed(openResultMatch) && (() => {
        const m = openResultMatch;
        const { winnerTeam, loserTeam, score } = getWinnerLoserTeams(m);
        const matchType = m.tournament_id
          ? (formData.name || `Torneo #${idNumber}`)
          : "Partido amistoso";
        const dateStr = formatShareDate(m.start_time);
        const timeStr = formatShareTime(m.start_time);
        const courtPlace = [m.court, m.place].filter(Boolean).join(" · ");

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 relative shadow-2xl">
              <button
                onClick={() => setOpenResultMatch(null)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-xl"
              >
                ✕
              </button>

              <div style={{ overflow: "hidden", borderRadius: 16 }}>
                <div
                  ref={shareCardRef}
                  style={{
                    width: 480,
                    height: 520,
                    backgroundColor: "#0b1220",
                    borderRadius: 0,
                    padding: "28px 32px",
                    color: "#fff",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    transform: "scale(0.82)",
                    transformOrigin: "top left",
                    marginBottom: -90,
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <img
                      src="/logo.svg"
                      alt="PADELX"
                      style={{
                        height: 44,
                        width: "auto",
                        margin: "0 auto",
                        objectFit: "contain",
                      }}
                    />
                  </div>

                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <span
                      style={{
                        display: "inline-block",
                        backgroundColor: m.tournament_id ? "#1a3a2a" : "#1a2a3a",
                        color: m.tournament_id ? "#4ade80" : "#60a5fa",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "5px 16px",
                        borderRadius: 20,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                      }}
                    >
                      {matchType}
                    </span>
                  </div>

                  <div
                    style={{
                      textAlign: "center",
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#4ade80",
                          letterSpacing: 3,
                          marginBottom: 6,
                        }}
                      >
                        GANADORES
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff" }}>
                        {winnerTeam}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 56,
                        fontWeight: 900,
                        letterSpacing: 4,
                        color: "#ccff00",
                        margin: "8px 0",
                      }}
                    >
                      {score}
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#666",
                          letterSpacing: 3,
                          marginBottom: 6,
                        }}
                      >
                        PERDEDORES
                      </div>
                      <div style={{ fontSize: 16, color: "#999" }}>
                        {loserTeam}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ height: 1, backgroundColor: "#1e293b", marginBottom: 12 }} />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: 16,
                        fontSize: 11,
                        color: "#64748b",
                      }}
                    >
                      {dateStr && <span>{dateStr}</span>}
                      {timeStr && <span>{timeStr}h</span>}
                      {courtPlace && <span>{courtPlace}</span>}
                    </div>
                    <div
                      style={{
                        textAlign: "center",
                        marginTop: 10,
                        fontSize: 10,
                        color: "#334155",
                      }}
                    >
                      {process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") || "padelx.es"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const el = shareCardRef.current;
                    if (!el) {
                      toast.error("No se pudo generar la imagen");
                      return;
                    }

                    const origTransform = el.style.transform;
                    const origMargin = el.style.marginBottom;
                    el.style.transform = "none";
                    el.style.marginBottom = "0";

                    try {
                      const { toPng } = await import("html-to-image");
                      const dataUrl = await toPng(el, {
                        cacheBust: true,
                        pixelRatio: 2,
                        width: 480,
                        height: 520,
                      });
                      const link = document.createElement("a");
                      link.download = `resultado_partido_${m.id}.png`;
                      link.href = dataUrl;
                      link.click();
                      toast.success("Imagen descargada");
                    } catch (err) {
                      console.error("toPng error:", err);
                      toast.error("No se pudo generar la imagen");
                    } finally {
                      el.style.transform = origTransform;
                      el.style.marginBottom = origMargin;
                    }
                  }}
                  className="flex-1 bg-gray-900 text-white py-2.5 rounded-xl font-semibold hover:bg-black transition text-sm"
                >
                  Descargar imagen
                </button>
              </div>

              <button
                onClick={() => setOpenResultMatch(null)}
                className="w-full border border-gray-200 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}
    </main>
  );
}
