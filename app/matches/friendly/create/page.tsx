'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Card from '../../../components/Card';
import { supabase } from '../../../lib/supabase';
import { useRole } from '../../../hooks/useRole';

interface Player {
  id: number;
  name: string;
}

export default function CreateFriendlyMatch() {
  const router = useRouter();
  const { role } = useRole();

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    date: '',
    time: '',
    place: '',
    court: '',
    teamA1: '',
    teamA2: '',
    teamB1: '',
    teamB2: '',
  });

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    const { data, error } = await supabase
      .from('players')
      .select('id, name')
      .order('name');

    if (error) {
      toast.error('Error cargando jugadores');
      return;
    }

    setPlayers(data || []);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit() {
    if (role === 'user') {
      toast.error('No tenés permisos para crear partidos');
      return;
    }

    const {
      date,
      time,
      place,
      court,
      teamA1,
      teamA2,
      teamB1,
      teamB2,
    } = form;

    if (
      !date ||
      !time ||
      !teamA1 ||
      !teamA2 ||
      !teamB1 ||
      !teamB2
    ) {
      toast.error('Completá todos los campos obligatorios');
      return;
    }

    setLoading(true);

    const start_time = new Date(`${date}T${time}:00`).toISOString();

    const { error } = await supabase.from('matches').insert({
      tournament_id: null,
      round_name: 'Amistoso',
      place: place || null,
      court: court || null,
      start_time,
      player_1_a: Number(teamA1),
      player_2_a: Number(teamA2),
      player_1_b: Number(teamB1),
      player_2_b: Number(teamB2),
      score: null,
      winner: 'pending',
    });

    setLoading(false);

    if (error) {
      toast.error('Error creando partido amistoso');
      return;
    }

    toast.success('Partido amistoso creado');
    router.push('/matches/friendly');
  }

  return (
    <Card title="Crear Partido Amistoso">
      <div className="grid grid-cols-2 gap-4">
        <input
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
        />

        <input
          type="time"
          name="time"
          value={form.time}
          onChange={handleChange}
        />

        <input
          type="text"
          name="place"
          placeholder="Lugar (opcional)"
          value={form.place}
          onChange={handleChange}
        />

        <input
          type="number"
          name="court"
          placeholder="Pista (opcional)"
          value={form.court}
          onChange={handleChange}
        />
      </div>

      <div className="grid grid-cols-2 gap-6 mt-6">
        <div>
          <h3 className="font-semibold mb-2">Pareja A</h3>
          <select name="teamA1" onChange={handleChange} value={form.teamA1}>
            <option value="">Jugador 1</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select name="teamA2" onChange={handleChange} value={form.teamA2}>
            <option value="">Jugador 2</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Pareja B</h3>
          <select name="teamB1" onChange={handleChange} value={form.teamB1}>
            <option value="">Jugador 1</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select name="teamB2" onChange={handleChange} value={form.teamB2}>
            <option value="">Jugador 2</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button
          className="btn-secondary"
          onClick={() => router.back()}
        >
          Cancelar
        </button>

        <button
          className="btn-primary"
          disabled={loading}
          onClick={handleSubmit}
        >
          {loading ? 'Creando...' : 'Crear partido'}
        </button>
      </div>
    </Card>
  );
}