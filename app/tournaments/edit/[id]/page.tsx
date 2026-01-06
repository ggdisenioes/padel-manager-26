"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useRouter, useParams } from "next/navigation";
import Card from "../../../components/Card";
import Link from "next/link";
import { useRole } from "../../../hooks/useRole";

export default function EditTournament() {
  const router = useRouter();
  const params = useParams();

  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const idNumber = idParam ? Number(idParam) : null;

  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    start_date: "",
    status: "abierto",
  });

  const { isAdmin, isManager } = useRole();
  const [matches, setMatches] = useState<any[]>([]);

  const playerLabel = (p: any, id?: number | null) =>
    p?.name ?? (id ? `#${id}` : "-");

  const teamA = (m: any) =>
    `${playerLabel(m.p1a, m.player_1_a)}${
      m.player_2_a ? ` / ${playerLabel(m.p2a, m.player_2_a)}` : ""
    }`;

  const teamB = (m: any) =>
    `${playerLabel(m.p1b, m.player_1_b)}${
      m.player_2_b ? ` / ${playerLabel(m.p2b, m.player_2_b)}` : ""
    }`;

  // Cargar datos del torneo
  useEffect(() => {
    const getTournament = async () => {
      if (!idNumber) {
        alert("ID de torneo inválido");
        router.push("/tournaments");
        return;
      }

      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", idNumber)
        .single();

      if (error) {
        console.error("Error cargando torneo:", error);
        alert("Error cargando torneo");
        router.push("/tournaments");
      } else if (data) {
        setFormData({
          name: data.name || "",
          category: data.category || "",
          start_date: data.start_date
            ? data.start_date.split("T")[0]
            : "",
          status: data.status || "abierto",
        });

        const { data: matchesData, error: matchesError } = await supabase
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
          .order("start_time", { ascending: true });

        if (matchesError) {
          console.error("Error cargando partidos del torneo:", matchesError);
        } else {
          setMatches(matchesData || []);
        }
      }

      setLoading(false);
    };

    if (idNumber) getTournament();
  }, [idNumber, router]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!idNumber) {
      alert("ID de torneo inválido");
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from("tournaments")
      .update({
        name: formData.name,
        category: formData.category,
        start_date: formData.start_date,
        status: formData.status,
      })
      .eq("id", idNumber);

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

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20">
      {loading ? (
        <p className="text-gray-600">Cargando torneo...</p>
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

          <h3 className="text-xl font-bold mb-4">Partidos del Torneo</h3>

          {(isAdmin || isManager) && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => router.push(`/matches/create?tournamentId=${idNumber}`)}
                className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-green-700 transition"
              >
                + Crear partido
              </button>

              <button
                type="button"
                onClick={() => router.push(`/tournaments/${idNumber}/generate-matches`)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-indigo-700 transition"
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
                <div
                  key={m.id}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {m.round_name || "Partido"}
                    </span>
                    {m.score && (
                      <span className="text-sm font-bold text-green-600">
                        {m.score}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-center">
                    <div className="flex-1">
                      <p className="font-semibold">{teamA(m)}</p>
                    </div>

                    <span className="mx-4 font-bold text-gray-500">VS</span>

                    <div className="flex-1">
                      <p className="font-semibold">{teamB(m)}</p>
                    </div>
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
    </main>
  );
}