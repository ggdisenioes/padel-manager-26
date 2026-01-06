// ./app/matches/create/page.tsx

"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { logAction } from '../../lib/audit';
import { useRouter } from 'next/navigation';
import Card from '../../components/Card';
import toast from 'react-hot-toast'; // Para notificaciones

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Tournament = {
  id: number;
  name: string;
  category: string;
};

type Player = {
  id: number;
  name: string;
  level: number;
};

export default function CreateMatch() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [players, setPlayers] = useState<Player[]>([]); 

  const [formData, setFormData] = useState({
    round_name: '',
    player_1_a: '', // Estos ahora almacenarán el ID (string)
    player_2_a: '', 
    player_1_b: '', 
    player_2_b: '',
    place: 'Club Central',
    court: '',
    start_time: '',
    // Nota: El ganador se setea a 'pending' o al valor real del equipo ('A' o 'B')
    // Asumiremos que el admin edita el resultado después.
    winner: 'pending' 
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        // Cargar Torneos
        const { data: tourns } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false });
        
        // Cargar solo jugadores APROBADOS
        const { data: plyrs } = await supabase
          .from('players')
          .select('id, name, level')
          .eq('is_approved', true) // Solo aprobados
          .order('name');
          
        if (tourns) setTournaments(tourns);
        if (plyrs) setPlayers(plyrs);
      } catch (err) {
        console.error('Error loading create match data', err);
        toast.error('Error cargando datos iniciales');
      }
    };
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const selectedPlayers = [formData.player_1_a, formData.player_2_a, formData.player_1_b, formData.player_2_b];
    const activePlayers = selectedPlayers.filter(p => p !== "");
    const uniquePlayers = new Set(activePlayers);

    if (uniquePlayers.size !== activePlayers.length) {
        toast.error("⛔ ERROR: Has seleccionado al mismo jugador más de una vez.");
        setLoading(false);
        return;
    }
    
    // 🔑 CLAVE 1: Mapear los IDs de jugadores a números grandes (BIGINT)
    const matchData = {
        round_name: formData.round_name || 'Partido Amistoso',
        place: formData.place,
        court: formData.court,
        // start_time ahora es de tipo TIMESTAMP en la DB
        start_time: formData.start_time, 
        winner: formData.winner,
        
        // Convertir los player IDs de string (del select) a BIGINT (número)
        // Usamos null si el campo está vacío para cumplir con las restricciones de BIGINT
        player_1_a: formData.player_1_a ? Number(formData.player_1_a) : null,
        player_2_a: formData.player_2_a ? Number(formData.player_2_a) : null,
        player_1_b: formData.player_1_b ? Number(formData.player_1_b) : null,
        player_2_b: formData.player_2_b ? Number(formData.player_2_b) : null,
        
        // NOTA: match_date fue eliminada o suplantada por start_time en la DB.
        // Si tu DB espera 'score' y 'winner' como NOT NULL, debes asegurarte de que 
        // se permiten valores nulos (NULL) en esas columnas, ya que no se proporcionan aquí.
    };
    
    // Validar que se seleccionen los 4 jugadores para pádel
    if (activePlayers.length < 4) {
        toast.error("Se deben seleccionar los 4 jugadores.");
        setLoading(false);
        return;
    }


    const { data, error } = await supabase
      .from('matches')
      .insert([matchData])
      .select()
      .single();

    if (error) {
        toast.error('Error al guardar: ' + error.message);
        setLoading(false);
    } else {
        // 📜 AUDITORÍA: creación de partido
        await logAction({
            action: 'CREATE_MATCH',
            entity: 'match',
            entityId: data.id,
            metadata: {
                round_name: matchData.round_name,
                players: {
                    teamA: [matchData.player_1_a, matchData.player_2_a],
                    teamB: [matchData.player_1_b, matchData.player_2_b],
                },
                start_time: matchData.start_time,
                place: matchData.place,
                court: matchData.court,
            },
        });

        toast.success('¡Partido programado exitosamente!');
        router.push('/matches');
        router.refresh();
    }
    setLoading(false);
  };

  const PlayerSelect = ({ label, value, onChange }: any) => (
    <div>
      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">{label}</label>
      <select
        required
        disabled={loading}
        className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Seleccionar...</option>
        {players.map(p => (
            // 🔑 CLAVE 2: Ahora el VALUE es el ID numérico, no el nombre
            <option key={p.id} value={p.id}>{p.name} (Niv {p.level})</option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="flex-1 overflow-y-auto p-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Programar Partido</h2>

        <Card className="max-w-4xl mx-auto">
            <form onSubmit={handleSubmit} className="space-y-8">
                
                {/* Detalles del Partido */}
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del partido</label>
                        <input type="text" placeholder="Ej: Octavos de Final" className="w-full p-2 border border-gray-300 rounded" value={formData.round_name} onChange={(e) => setFormData({...formData, round_name: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha y Hora</label>
                        <input type="datetime-local" required className="w-full p-2 border border-gray-300 rounded" value={formData.start_time} onChange={(e) => setFormData({...formData, start_time: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lugar (Place)</label>
                        <input type="text" placeholder="Ej: Club Padel Center" className="w-full p-2 border border-gray-300 rounded" value={formData.place} onChange={(e) => setFormData({...formData, place: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nº Pista (Court)</label>
                        <input type="text" placeholder="Ej: Pista 4" className="w-full p-2 border border-gray-300 rounded" value={formData.court} onChange={(e) => setFormData({...formData, court: e.target.value})} />
                    </div>
                    
                </div>

                {/* Selección de Jugadores */}
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
                    <div className="flex-1 w-full bg-gray-50 p-5 rounded-xl border-l-4 border-l-blue-500 shadow-sm">
                        <h3 className="font-bold text-blue-700 mb-4 border-b pb-2">PAREJA 1</h3>
                        <div className="space-y-4">
                            <PlayerSelect label="Jugador 1 (Revés)" value={formData.player_1_a} onChange={(val: string) => setFormData({...formData, player_1_a: val})} />
                            <PlayerSelect label="Jugador 2 (Drive)" value={formData.player_2_a} onChange={(val: string) => setFormData({...formData, player_2_a: val})} />
                        </div>
                    </div>
                    <div className="text-3xl font-black text-gray-300 italic">VS</div>
                    <div className="flex-1 w-full bg-gray-50 p-5 rounded-xl border-r-4 border-r-red-500 shadow-sm text-right">
                        <h3 className="font-bold text-red-700 mb-4 border-b pb-2">PAREJA 2</h3>
                        <div className="space-y-4">
                            <PlayerSelect label="Jugador 1 (Revés)" value={formData.player_1_b} onChange={(val: string) => setFormData({...formData, player_1_b: val})} />
                            <PlayerSelect label="Jugador 2 (Drive)" value={formData.player_2_b} onChange={(val: string) => setFormData({...formData, player_2_b: val})} />
                        </div>
                    </div>
                </div>

                <div className="flex gap-4 pt-6 border-t">
                    <button type="button" onClick={() => router.back()} className="px-6 py-3 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
                    <button type="submit" disabled={loading} className="flex-1 px-6 py-3 text-white bg-green-600 rounded hover:bg-green-700 font-bold text-lg shadow-lg">
                        {loading ? 'Creando partido...' : '✅ Confirmar Partido'}
                    </button>
                </div>
            </form>
        </Card>
    </main>
  );
}