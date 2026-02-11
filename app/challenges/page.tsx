"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";
import Card from "../components/Card";
import toast from "react-hot-toast";

type Challenge = {
  id: number;
  challenger_id: number;
  challenger_partner_id: number | null;
  challenged_id: number;
  challenged_partner_id: number | null;
  status: string;
  message: string | null;
  created_at: string;
  expires_at: string;
};

type Player = {
  id: number;
  name: string;
};

export default function ChallengesPage() {
  const router = useRouter();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userPlayerIds, setUserPlayerIds] = useState<number[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    challenger_id: "",
    challenger_partner_id: "",
    challenged_id: "",
    challenged_partner_id: "",
    message: "",
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    setCurrentUserId(user.id);

    // Get user's players
    const { data: userPlayers, error: userPlayersError } = await supabase
      .from("players")
      .select("id")
      .eq("user_id", user.id);

    if (userPlayersError) {
      console.error("Error fetching user players:", userPlayersError);
      toast.error("Error al cargar tus perfiles");
    }

    const playerIds = userPlayers?.map((p) => p.id) || [];
    setUserPlayerIds(playerIds);

    // Get all players for the challenged dropdown
    const { data: allPlayers, error: allPlayersError } = await supabase
      .from("players")
      .select("id, name")
      .eq("is_approved", true)
      .order("name");

    if (allPlayersError) {
      console.error("Error fetching all players:", allPlayersError);
      toast.error("Error al cargar los jugadores");
    }

    setPlayers(allPlayers || []);

    fetchChallenges();
  };

  const fetchChallenges = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const response = await fetch("/api/challenges", { headers });
      const result = await response.json();

      if (response.ok) {
        setChallenges(result.challenges || []);
      }
    } catch (error) {
      console.error("Error fetching challenges:", error);
      toast.error("Error cargando desafíos");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.challenger_id || !formData.challenger_partner_id || !formData.challenged_id || !formData.challenged_partner_id) {
      toast.error("Todos los 4 jugadores son obligatorios");
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const response = await fetch("/api/challenges", {
        method: "POST",
        headers,
        body: JSON.stringify({
          challenger_id: parseInt(formData.challenger_id),
          challenger_partner_id: formData.challenger_partner_id ? parseInt(formData.challenger_partner_id) : null,
          challenged_id: parseInt(formData.challenged_id),
          challenged_partner_id: formData.challenged_partner_id ? parseInt(formData.challenged_partner_id) : null,
          message: formData.message || null,
        }),
      });

      if (response.ok) {
        toast.success("¡Desafío creado!");
        setFormData({ challenger_id: "", challenger_partner_id: "", challenged_id: "", challenged_partner_id: "", message: "" });
        setShowForm(false);
        fetchChallenges();
      } else {
        const result = await response.json();
        toast.error(result.error || "Error al crear desafío");
      }
    } catch (error) {
      toast.error("Error");
    }
  };

  const handleUpdateStatus = async (
    challengeId: number,
    newStatus: string
  ) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const response = await fetch(`/api/challenges/${challengeId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        toast.success("Desafío actualizado");
        fetchChallenges();
      } else {
        toast.error("Error al actualizar");
      }
    } catch (error) {
      toast.error("Error");
    }
  };

  const getPlayerName = (playerId: number) => {
    return players.find((p) => p.id === playerId)?.name || `Jugador ${playerId}`;
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-200 text-yellow-800";
      case "accepted":
        return "bg-green-200 text-green-800";
      case "declined":
        return "bg-red-200 text-red-800";
      case "completed":
        return "bg-blue-200 text-blue-800";
      default:
        return "bg-gray-200 text-gray-800";
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Cargando desafíos...</div>;
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">⚔️ Desafíos</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {showForm ? "Cancelar" : "+ Nuevo Desafío"}
        </button>
      </div>

      {showForm && (
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">Crear Desafío 2vs2</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Mi equipo (Retadores) */}
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-bold text-blue-600 mb-3">Mi Equipo (Retadores)</h3>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">Jugador 1 *</label>
                  <select
                    value={formData.challenger_id}
                    onChange={(e) =>
                      setFormData({ ...formData, challenger_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">Selecciona jugador 1</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Jugador 2 (Pareja) *</label>
                  <select
                    value={formData.challenger_partner_id}
                    onChange={(e) =>
                      setFormData({ ...formData, challenger_partner_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">Selecciona jugador 2</option>
                    {players
                      .filter((p) => p.id !== parseInt(formData.challenger_id || "0"))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Equipo Contrario (Retados) */}
              <div className="border-l-4 border-red-500 pl-4">
                <h3 className="font-bold text-red-600 mb-3">Equipo Contrario (Retados)</h3>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">Jugador 1 *</label>
                  <select
                    value={formData.challenged_id}
                    onChange={(e) =>
                      setFormData({ ...formData, challenged_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">Selecciona jugador 1</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Jugador 2 (Pareja) *</label>
                  <select
                    value={formData.challenged_partner_id}
                    onChange={(e) =>
                      setFormData({ ...formData, challenged_partner_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">Selecciona jugador 2</option>
                    {players
                      .filter((p) => p.id !== parseInt(formData.challenged_id || "0"))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Mensaje (opcional)
              </label>
              <textarea
                value={formData.message}
                onChange={(e) =>
                  setFormData({ ...formData, message: e.target.value })
                }
                placeholder="¿Quieres añadir un mensaje?"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg h-20"
              />
            </div>

            <button
              type="submit"
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
            >
              Enviar Desafío
            </button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {challenges.length === 0 ? (
          <Card className="p-4 text-center text-gray-500">
            No hay desafíos aún. ¡Crea uno!
          </Card>
        ) : (
          challenges.map((challenge) => {
            const challengerTeam = challenge.challenger_partner_id
              ? `${getPlayerName(challenge.challenger_id)} y ${getPlayerName(challenge.challenger_partner_id)}`
              : getPlayerName(challenge.challenger_id);
            const challengedTeam = challenge.challenged_partner_id
              ? `${getPlayerName(challenge.challenged_id)} y ${getPlayerName(challenge.challenged_partner_id)}`
              : getPlayerName(challenge.challenged_id);

            return (
              <Card key={challenge.id} className="p-6">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-lg">
                    {challengerTeam} vs {challengedTeam}
                  </h3>

                  {challenge.message && (
                    <p className="text-sm text-gray-600 mt-2 italic">
                      "{challenge.message}"
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-3">
                    <span
                      className={`text-xs px-2 py-1 rounded font-semibold ${getStatusBadgeColor(
                        challenge.status
                      )}`}
                    >
                      {challenge.status === "pending"
                        ? "Pendiente"
                        : challenge.status === "accepted"
                        ? "Aceptado"
                        : challenge.status === "declined"
                        ? "Rechazado"
                        : challenge.status === "completed"
                        ? "Completado"
                        : challenge.status}
                    </span>
                    <p className="text-xs text-gray-500">
                      {new Date(challenge.created_at).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                </div>

                {challenge.status === "pending" &&
                  (userPlayerIds.includes(challenge.challenged_id) ||
                    (challenge.challenged_partner_id && userPlayerIds.includes(challenge.challenged_partner_id))) && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateStatus(challenge.id, "accepted")}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                      >
                        Aceptar
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(challenge.id, "declined")}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
              </div>
              </Card>
            );
          })
        )}
      </div>
    </main>
  );
}
