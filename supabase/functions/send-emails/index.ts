import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import PlayerSelect from "@/components/PlayerSelect";

export default function EditMatchPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [formData, setFormData] = useState({
    tournament_id: "",
    round_name: "",
    player_1_a: "",
    player_2_a: "",
    player_1_b: "",
    player_2_b: "",
    place: "",
    court: "",
    start_time: "",
    winner: "pending",
    score: "",
  });
  const [players, setPlayers] = useState([]);
  const [tournaments, setTournaments] = useState([]);

  useEffect(() => {
    async function loadData() {
      const { data: playersData } = await supabase.from("players").select("*");
      setPlayers(playersData || []);

      const { data: tournamentsData } = await supabase
        .from("tournaments")
        .select("*");
      setTournaments(tournamentsData || []);

      const { data: matchData } = await supabase
        .from("matches")
        .select("*")
        .eq("id", params.id)
        .single();

      if (matchData) {
        setFormData({
          tournament_id: matchData.tournament_id ? String(matchData.tournament_id) : '',
          round_name: matchData.round_name || '',
          player_1_a: matchData.player_1_a ? String(matchData.player_1_a) : '',
          player_2_a: matchData.player_2_a ? String(matchData.player_2_a) : '',
          player_1_b: matchData.player_1_b ? String(matchData.player_1_b) : '',
          player_2_b: matchData.player_2_b ? String(matchData.player_2_b) : '',
          place: matchData.place || '',
          court: matchData.court ? String(matchData.court) : '',
          // datetime-local: YYYY-MM-DDTHH:mm
          start_time: matchData.start_time ? String(matchData.start_time).substring(0, 16) : '',
          winner: matchData.winner || 'pending',
          score: matchData.score || '',
        });
      }
    }
    loadData();
  }, [params.id]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const updateData = {
      tournament_id: formData.tournament_id ? Number(formData.tournament_id) : null,
      round_name: formData.round_name || null,
      player_1_a: formData.player_1_a ? Number(formData.player_1_a) : null,
      player_2_a: formData.player_2_a ? Number(formData.player_2_a) : null,
      player_1_b: formData.player_1_b ? Number(formData.player_1_b) : null,
      player_2_b: formData.player_2_b ? Number(formData.player_2_b) : null,
      place: formData.place || null,
      court: formData.court ? Number(formData.court) : null,
      start_time: formData.start_time || null,
      winner: formData.winner || "pending",
      score: formData.score || null,
    };

    const { error } = await supabase
      .from("matches")
      .update(updateData)
      .eq("id", params.id);

    if (!error) {
      router.push("/matches");
    } else {
      alert("Error al actualizar el partido");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Torneo</label>
        <select
          name="tournament_id"
          value={formData.tournament_id}
          onChange={handleChange}
        >
          <option value="">-- Sin torneo --</option>
          {tournaments.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name} - {t.category}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Ronda</label>
        <input
          type="text"
          name="round_name"
          value={formData.round_name}
          onChange={handleChange}
        />
      </div>

      <div>
        <label>Jugador 1A</label>
        <PlayerSelect
          name="player_1_a"
          value={formData.player_1_a}
          onChange={handleChange}
          players={players}
        />
      </div>

      <div>
        <label>Jugador 2A</label>
        <PlayerSelect
          name="player_2_a"
          value={formData.player_2_a}
          onChange={handleChange}
          players={players}
        />
      </div>

      <div>
        <label>Jugador 1B</label>
        <PlayerSelect
          name="player_1_b"
          value={formData.player_1_b}
          onChange={handleChange}
          players={players}
        />
      </div>

      <div>
        <label>Jugador 2B</label>
        <PlayerSelect
          name="player_2_b"
          value={formData.player_2_b}
          onChange={handleChange}
          players={players}
        />
      </div>

      <div>
        <label>Lugar</label>
        <input
          type="text"
          name="place"
          value={formData.place}
          onChange={handleChange}
        />
      </div>

      <div>
        <label>Pista</label>
        <input
          type="number"
          name="court"
          value={formData.court}
          onChange={handleChange}
        />
      </div>

      <div>
        <label>Fecha y hora</label>
        <input
          type="datetime-local"
          name="start_time"
          value={formData.start_time}
          onChange={handleChange}
        />
      </div>

      <div>
        <label>Ganador</label>
        <select
          name="winner"
          value={formData.winner}
          onChange={handleChange}
        >
          <option value="pending">Pendiente</option>
          <option value="team_a">Equipo A</option>
          <option value="team_b">Equipo B</option>
        </select>
      </div>

      <div>
        <label>Marcador</label>
        <input
          type="text"
          name="score"
          value={formData.score}
          onChange={handleChange}
        />
      </div>

      <button type="submit">Guardar</button>
    </form>
  );
}

// PlayerSelect.tsx
import React from "react";

export default function PlayerSelect({
  name,
  value,
  onChange,
  players,
}: {
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  players: { id: number; name: string; level: number }[];
}) {
  return (
    <select name={name} value={value} onChange={onChange}>
      <option value="">-- Seleccionar jugador --</option>
      {players.map((p) => (
        <option key={p.id} value={String(p.id)}>
          {p.name} (Niv {p.level})
        </option>
      ))}
    </select>
  );
}