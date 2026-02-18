import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type PlayerRow = {
  id: number;
  name: string;
  level: number | null;
  avatar_url: string | null;
};

type MatchRow = {
  winner: string | null;
  player_1_a: number | null;
  player_2_a: number | null;
  player_1_b: number | null;
  player_2_b: number | null;
  player_1_a_id?: number | null;
  player_2_a_id?: number | null;
  player_1_b_id?: number | null;
  player_2_b_id?: number | null;
};

type PlayerStats = {
  total_matches: number;
  wins: number;
  losses: number;
  pending_matches: number;
  winRate: number;
};

const emptyStats = (): PlayerStats => ({
  total_matches: 0,
  wins: 0,
  losses: 0,
  pending_matches: 0,
  winRate: 0,
});

function getResolvedId(legacyId: number | null, newId?: number | null): number | null {
  const value = legacyId ?? newId ?? null;
  if (!Number.isFinite(value as number)) return null;
  return value as number;
}

export async function GET(req: Request) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("authorization") || "" } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    }

    const [{ data: playersData, error: playersErr }, { data: matchesData, error: matchesErr }] =
      await Promise.all([
        supabaseClient
          .from("players")
          .select("id, name, level, avatar_url")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_approved", true)
          .order("level", { ascending: false }),
        supabaseClient
          .from("matches")
          .select(
            "winner, player_1_a, player_2_a, player_1_b, player_2_b, player_1_a_id, player_2_a_id, player_1_b_id, player_2_b_id"
          )
          .eq("tenant_id", profile.tenant_id),
      ]);

    if (playersErr) {
      return NextResponse.json({ error: playersErr.message }, { status: 500 });
    }

    if (matchesErr) {
      return NextResponse.json({ error: matchesErr.message }, { status: 500 });
    }

    const players = (playersData || []) as PlayerRow[];
    const matches = (matchesData || []) as MatchRow[];
    const statsByPlayer = new Map<number, PlayerStats>();

    for (const player of players) {
      statsByPlayer.set(player.id, emptyStats());
    }

    for (const match of matches) {
      const teamA = new Set<number>();
      const teamB = new Set<number>();

      const a1 = getResolvedId(match.player_1_a, match.player_1_a_id);
      const a2 = getResolvedId(match.player_2_a, match.player_2_a_id);
      const b1 = getResolvedId(match.player_1_b, match.player_1_b_id);
      const b2 = getResolvedId(match.player_2_b, match.player_2_b_id);

      if (a1) teamA.add(a1);
      if (a2) teamA.add(a2);
      if (b1) teamB.add(b1);
      if (b2) teamB.add(b2);

      const participants = new Set<number>([...teamA, ...teamB]);
      if (participants.size === 0) continue;

      const winner = (match.winner || "").toString().toUpperCase();
      const finished = winner === "A" || winner === "B";

      for (const playerId of participants) {
        const current = statsByPlayer.get(playerId);
        if (!current) continue;

        current.total_matches += 1;

        if (!finished) {
          current.pending_matches += 1;
          continue;
        }

        const won = (winner === "A" && teamA.has(playerId)) || (winner === "B" && teamB.has(playerId));
        if (won) current.wins += 1;
        else current.losses += 1;
      }
    }

    const playersWithStats = players.map((player) => {
      const stats = statsByPlayer.get(player.id) || emptyStats();
      const completed = stats.total_matches - stats.pending_matches;
      const winRate = completed > 0 ? Math.round((stats.wins / completed) * 100) : 0;

      return {
        ...player,
        stats: {
          ...stats,
          winRate,
        },
      };
    });

    return NextResponse.json({ players: playersWithStats });
  } catch (error) {
    console.error("PLAYERS STATS GET ERROR:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
