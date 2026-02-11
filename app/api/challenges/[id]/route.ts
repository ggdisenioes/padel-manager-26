import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const challengeUpdateSchema = z.object({
  status: z.enum(["pending", "accepted", "declined", "completed", "cancelled"]),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Servidor mal configurado" },
        { status: 500 }
      );
    }

    const { id } = await params;
    const challengeId = parseInt(id, 10);

    if (isNaN(challengeId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("authorization") || "" } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Get challenge details
    const { data: challenge } = await supabaseClient
      .from("challenges")
      .select("challenged_id, challenger_id")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Desafío no encontrado" }, { status: 404 });
    }

    // Get user's player IDs
    const { data: userPlayers } = await supabaseClient
      .from("players")
      .select("id")
      .eq("user_id", user.id);

    const userPlayerIds = userPlayers?.map((p) => p.id) || [];

    // Check permissions
    const isChallenger = userPlayerIds.includes(challenge.challenger_id);
    const isChallenged = userPlayerIds.includes(challenge.challenged_id);

    if (!isChallenger && !isChallenged) {
      return NextResponse.json(
        { error: "No tienes permiso para modificar este desafío" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const validated = challengeUpdateSchema.parse(body);

    // Validate status transitions
    if (
      (validated.status === "accepted" || validated.status === "declined") &&
      !isChallenged
    ) {
      return NextResponse.json(
        { error: "Solo el jugador retado puede aceptar o rechazar" },
        { status: 403 }
      );
    }

    if (validated.status === "cancelled" && !isChallenger) {
      return NextResponse.json(
        { error: "Solo el retador puede cancelar el desafío" },
        { status: 403 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: updatedChallenge, error } = await supabaseAdmin
      .from("challenges")
      .update({ status: validated.status })
      .eq("id", challengeId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    try {
      await supabaseAdmin.from("action_logs").insert({
        action: `CHALLENGE_${validated.status.toUpperCase()}`,
        entity: "challenges",
        entity_id: challengeId,
        user_id: user.id,
        user_email: user.email,
        metadata: { status: validated.status },
      });
    } catch {
      // Silent fail
    }

    return NextResponse.json({ success: true, challenge: updatedChallenge });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || "Datos inválidos" },
        { status: 400 }
      );
    }
    console.error("CHALLENGE PUT ERROR:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Servidor mal configurado" },
        { status: 500 }
      );
    }

    const { id } = await params;
    const challengeId = parseInt(id, 10);

    if (isNaN(challengeId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("authorization") || "" } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Get challenge and verify permission
    const { data: challenge } = await supabaseClient
      .from("challenges")
      .select("challenger_id")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Desafío no encontrado" }, { status: 404 });
    }

    const { data: userPlayers } = await supabaseClient
      .from("players")
      .select("id")
      .eq("user_id", user.id);

    const isChallenger = userPlayers?.some((p) => p.id === challenge.challenger_id);

    if (!isChallenger) {
      return NextResponse.json(
        { error: "Solo el retador puede eliminar el desafío" },
        { status: 403 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error } = await supabaseAdmin
      .from("challenges")
      .delete()
      .eq("id", challengeId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("CHALLENGE DELETE ERROR:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
