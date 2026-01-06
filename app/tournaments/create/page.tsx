"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import toast from "react-hot-toast";

import Card from "../../components/Card";
import { supabase } from "../../lib/supabase";
import { logAction } from "../../lib/audit";

export default function EditTournament() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = params?.id;

  const [loading, setLoading] = useState(false);
  const [tournament, setTournament] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);

  const [scoreUpdating, setScoreUpdating] = useState<number | null>(null);

  useEffect(() => {
    if (!tournamentId) return;

    const loadTournament = async () => {
      const { data, error } = await supabase
        .from("tournaments")
        .select()
        .eq("id", tournamentId)
        .single();

      if (error) {
        toast.error("Error cargando torneo");
        return;
      }

      setTournament(data);
    };

    loadTournament();
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;

    const loadMatches = async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(`id, tournament_id, round_name, place, court, start_time, score, winner,
          player_1_a, player_2_a, player_1_b, player_2_b,
          p1a:players!matches_player_1_a_fkey(id,name),
          p2a:players!matches_player_2_a_fkey(id,name),
          p1b:players!matches_player_1_b_fkey(id,name),
          p2b:players!matches_player_2_b_fkey(id,name)`)
        .eq("tournament_id", tournamentId)
        .order("start_time", { ascending: true });

      if (error) {
        toast.error("Error cargando partidos");
        return;
      }

      setMatches(data || []);
    };

    loadMatches();
  }, [tournamentId]);

  const playerLabel = (p: any, id?: number | null) => p?.name ?? (id ? `#${id}` : "-");

  const teamA = (m: any) =>
    `${playerLabel(m.p1a, m.player_1_a)}${m.player_2_a ? ` / ${playerLabel(m.p2a, m.player_2_a)}` : ""}`;

  const teamB = (m: any) =>
    `${playerLabel(m.p1b, m.player_1_b)}${m.player_2_b ? ` / ${playerLabel(m.p2b, m.player_2_b)}` : ""}`;

  const handleDeleteMatch = async (matchId: number) => {
    if (!tournamentId) return;

    if (!confirm("¿Eliminar este partido?")) return;

    const { error } = await supabase.from("matches").delete().eq("id", matchId);

    if (error) {
      toast.error("Error eliminando partido");
      return;
    }

    setMatches((prev) => prev.filter((m) => m.id !== matchId));

    await logAction({
      action: "DELETE_MATCH",
      entity: "match",
      entityId: matchId,
      metadata: { tournamentId },
    });

    toast.success("Partido eliminado");
  };

  const handleUpdateScore = async (matchId: number, newScore: string) => {
    if (!tournamentId) return;

    setScoreUpdating(matchId);

    const { error } = await supabase
      .from("matches")
      .update({ score: newScore })
      .eq("id", matchId);

    if (error) {
      toast.error("Error actualizando marcador");
      setScoreUpdating(null);
      return;
    }

    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, score: newScore } : m))
    );

    await logAction({
      action: "UPDATE_MATCH_SCORE",
      entity: "match",
      entityId: matchId,
      metadata: { tournamentId, score: newScore },
    });

    toast.success("Marcador actualizado");
    setScoreUpdating(null);
  };

  if (!tournament) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Cargando torneo...</h2>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">
        Editar Torneo: {tournament.name}
      </h2>

      <Card className="max-w-4xl">
        <div className="space-y-4">
          {matches.length === 0 && <p>No hay partidos para este torneo.</p>}

          {matches.map((match) => (
            <div key={match.id} className="border p-4 rounded mb-4">
              <div className="flex justify-between items-center mb-2">
                <div className="text-lg font-semibold">{match.round_name}</div>
                <div className="flex items-center gap-3">
                  <a
                    href={`/matches/edit/${match.id}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Editar partido
                  </a>

                  <a
                    href={`/matches/score/${match.id}`}
                    className="text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    Editar resultado
                  </a>

                  <button
                    onClick={() => handleDeleteMatch(match.id)}
                    className="text-red-600 hover:text-red-800 font-medium"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-2">
                <div>
                  <div className="font-semibold text-gray-900">{teamA(match)}</div>
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{teamB(match)}</div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <input
                  type="text"
                  defaultValue={match.score || ""}
                  disabled={scoreUpdating === match.id}
                  onBlur={(e) => {
                    if (e.target.value !== match.score) {
                      handleUpdateScore(match.id, e.target.value);
                    }
                  }}
                  className="border border-gray-300 rounded p-1 w-24"
                  placeholder="Marcador"
                />
                <div>
                  <strong>Cancha:</strong> {match.court || "-"}
                </div>
                <div>
                  <strong>Lugar:</strong> {match.place || "-"}
                </div>
                <div>
                  <strong>Inicio:</strong>{" "}
                  {match.start_time ? new Date(match.start_time).toLocaleString("es-ES") : "-"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}