"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { supabase } from "../../../lib/supabase";
import { useRole } from "../../../hooks/useRole";

type Player = {
  id: number;
  name: string;
  is_approved?: boolean;
};

type Court = {
  id: number;
  name: string;
  is_covered: boolean;
  sort_order?: number;
};

type FriendlyMatchInsert = {
  start_time: string;
  duration_minutes: number;
  is_friendly: boolean;
  tournament_id: number | null;
  round_name: string | null;
  winner: string;
  score: string | null;
  court_id: number | null;
  court: string | null;
  place: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
};

function shuffleCopy(ids: number[]) {
  // Fisher–Yates (estable y sin warnings). No necesitamos semilla; la guardamos en state.
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export default function CreateFriendlyMatchPage() {
  const router = useRouter();
  const { isAdmin, isManager, loading: roleLoading } = useRole();

  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [shuffledSelected, setShuffledSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const [courts, setCourts] = useState<Court[]>([]);
  const [occupiedCourtIds, setOccupiedCourtIds] = useState<Set<number>>(new Set());
  const [loadingCourts, setLoadingCourts] = useState(false);

  const [form, setForm] = useState({
    start_time: "",
    duration_minutes: "60",
    court_id: "",
  });

  const canAccess = isAdmin || isManager;
  const isPageLoading = roleLoading || loadingCourts;

  const isOdd = selected.length % 2 !== 0;
  const canCreate = selected.length >= 4 && !isOdd;
  const matchesCount = Math.floor(selected.length / 4);

  const selectedCourt = useMemo(() => {
    const id = Number(form.court_id);
    return courts.find((c) => c.id === id);
  }, [courts, form.court_id]);

  const loadData = useCallback(async () => {
    setLoadingCourts(true);

    // Players: en esta pantalla conviene mostrar solo aprobados (consistente con el resto del producto)
    const { data: playersData, error: playersError } = await supabase
      .from("players")
      .select("id, name, is_approved")
      .eq("is_approved", true)
      .order("name");

    if (playersError) {
      console.error(playersError);
      toast.error("No se pudieron cargar los jugadores");
      setPlayers([]);
    } else {
      setPlayers((playersData as Player[]) || []);
    }

    const { data: courtsData, error: courtsError } = await supabase
      .from("courts")
      .select("id, name, is_covered, sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (courtsError) {
      console.error(courtsError);
      toast.error("No se pudieron cargar las pistas");
      setCourts([]);
    } else {
      setCourts((courtsData as Court[]) || []);
    }

    setLoadingCourts(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Mantener un shuffle fijo para que la vista previa coincida con lo que se crea
  useEffect(() => {
    if (selected.length === 0) {
      setShuffledSelected([]);
      return;
    }
    setShuffledSelected((prev) => {
      // Si no cambió el set (mismos ids), mantenemos
      const a = [...prev].sort((x, y) => x - y).join(",");
      const b = [...selected].sort((x, y) => x - y).join(",");
      if (a === b && prev.length === selected.length) return prev;
      return shuffleCopy(selected);
    });
  }, [selected]);

  const togglePlayer = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const handleFormChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const computeAvailability = useCallback(async () => {
    if (!form.start_time || matchesCount <= 0) {
      setOccupiedCourtIds(new Set());
      return;
    }

    const start = new Date(form.start_time);
    const duration = Number(form.duration_minutes || 60);
    const totalMinutes = matchesCount * duration;
    const end = new Date(start.getTime() + totalMinutes * 60_000);

    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { data, error } = await supabase
      .from("matches")
      .select("id, court_id, start_time, duration_minutes")
      .not("court_id", "is", null)
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString());

    if (error) {
      console.error("[friendly availability]", error);
      setOccupiedCourtIds(new Set());
      return;
    }

    const occupied = new Set<number>();
    (data || []).forEach((m: { court_id: number | null; start_time: string | null; duration_minutes: number | null }) => {
      if (!m.court_id || !m.start_time || !m.duration_minutes) return;
      const mStart = new Date(m.start_time);
      const mEnd = new Date(mStart.getTime() + Number(m.duration_minutes) * 60_000);
      const overlaps = mStart < end && mEnd > start;
      if (overlaps) occupied.add(Number(m.court_id));
    });

    setOccupiedCourtIds(occupied);

    if (form.court_id) {
      const selectedId = Number(form.court_id);
      if (occupied.has(selectedId)) {
        setForm((prev) => ({ ...prev, court_id: "" }));
      }
    }
  }, [form.court_id, form.duration_minutes, form.start_time, matchesCount]);

  useEffect(() => {
    void computeAvailability();
  }, [computeAvailability]);

  const previewPairs = useMemo(() => {
    if (!canCreate) return [] as number[][];
    const base = shuffledSelected.length ? shuffledSelected : selected;
    const out: number[][] = [];
    for (let i = 0; i < base.length; i += 4) {
      const g = base.slice(i, i + 4);
      if (g.length === 4) out.push(g);
    }
    return out;
  }, [canCreate, selected, shuffledSelected]);

  const handleCreate = async () => {
    if (!canCreate) {
      toast.error("Para 2vs2 necesitás un número PAR de jugadores (mínimo 4).");
      return;
    }

    if (!form.start_time) {
      toast.error("Seleccioná día y horario");
      return;
    }

    if (!form.court_id) {
      toast.error("Seleccioná una pista disponible");
      return;
    }

    if (!selectedCourt) {
      toast.error("La pista seleccionada no existe o no está disponible");
      return;
    }

    setLoading(true);

    const baseStart = new Date(form.start_time);
    const duration = Number(form.duration_minutes || 60);

    // Usamos el shuffle estable guardado (para coincidir con la vista previa)
    const basePlayers = shuffledSelected.length ? shuffledSelected : shuffleCopy(selected);

    const inserts: FriendlyMatchInsert[] = [];

    for (let i = 0; i < basePlayers.length; i += 4) {
      const group = basePlayers.slice(i, i + 4);
      if (group.length < 4) break;

      const matchIndex = i / 4;
      const start = new Date(baseStart.getTime() + matchIndex * duration * 60_000);

      inserts.push({
        start_time: start.toISOString(),
        duration_minutes: duration,
        is_friendly: true,
        tournament_id: null,
        round_name: null,
        winner: "pending",
        score: null,
        court_id: Number(form.court_id),
        court: selectedCourt.name || null,
        place: null,
        player_1_a: group[0] ?? null,
        player_2_a: group[1] ?? null,
        player_1_b: group[2] ?? null,
        player_2_b: group[3] ?? null,
      });
    }

    const { error: bulkErr } = await supabase.from("matches").insert(inserts);

    if (bulkErr) {
      console.error("[friendly] INSERT bulk error", bulkErr);
      const code = (bulkErr as any)?.code ? ` [${(bulkErr as any).code}]` : "";
      const details = (bulkErr as any)?.details ? ` · ${(bulkErr as any).details}` : "";
      toast.error(`Error al crear amistosos${code}: ${bulkErr.message}${details}`);
      setLoading(false);
      return;
    }

    toast.success("Partidos amistosos creados");
    router.push("/matches");
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      {isPageLoading ? (
        <p className="text-gray-500">Cargando permisos…</p>
      ) : !canAccess ? (
        <p className="text-red-600 font-semibold">No tenés permisos para crear partidos amistosos.</p>
      ) : (
        <>
          <header>
            <h1 className="text-2xl font-bold">Crear partido amistoso</h1>
            <p className="text-sm text-gray-500">Los partidos amistosos no pertenecen a ningún torneo.</p>
          </header>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h2 className="font-semibold">Programación</h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="datetime-local"
                  name="start_time"
                  value={form.start_time}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                />

                <select
                  name="duration_minutes"
                  value={form.duration_minutes}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="30">Duración: 30 min</option>
                  <option value="60">Duración: 60 min</option>
                  <option value="90">Duración: 90 min</option>
                  <option value="120">Duración: 120 min</option>
                </select>

                <select
                  name="court_id"
                  value={form.court_id}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Seleccionar pista</option>
                  {courts.map((c) => {
                    const occupied = occupiedCourtIds.has(c.id);
                    const labelBase = `${c.name} · ${c.is_covered ? "Cubierta" : "Descubierta"}`;
                    const label = occupied ? `${labelBase} · Ocupada` : labelBase;
                    return (
                      <option key={c.id} value={String(c.id)} disabled={occupied}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              {matchesCount > 1 && (
                <p className="text-xs text-gray-600">
                  Se van a crear <strong>{matchesCount}</strong> partidos consecutivos en la misma pista, sumando un total de{" "}
                  <strong>{matchesCount * Number(form.duration_minutes || 60)}</strong> minutos.
                </p>
              )}
            </div>

            <div>
              <h2 className="font-semibold mb-2">Seleccioná jugadores (mínimo 4, número par)</h2>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {players.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer(p.id)}
                    className={`px-3 py-2 rounded-md border text-sm text-left transition
                      ${selected.includes(p.id) ? "bg-green-600 text-white border-green-600" : "bg-white hover:bg-gray-50"}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              {isOdd && (
                <p className="mt-3 text-sm text-orange-600 font-medium">Para 2vs2 necesitás un número PAR de jugadores (se arman parejas).</p>
              )}
            </div>

            {canCreate && previewPairs.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Vista previa de parejas</h3>
                <ul className="space-y-2 text-sm">
                  {previewPairs.map((g, idx) => (
                    <li key={idx}>
                      <strong>Partido {idx + 1}:</strong> {players.find((p) => p.id === g[0])?.name} & {players.find((p) => p.id === g[1])?.name} vs{" "}
                      {players.find((p) => p.id === g[2])?.name} & {players.find((p) => p.id === g[3])?.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => router.back()}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition"
              >
                Cancelar
              </button>

              <button
                onClick={handleCreate}
                disabled={loading}
                className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-green-700 transition disabled:opacity-50"
              >
                {loading ? "Creando…" : "Crear partidos amistosos"}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}