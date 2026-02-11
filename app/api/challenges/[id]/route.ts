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
      .select("challenged_id, challenger_id, tenant_id")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Desafío no encontrado" }, { status: 404 });
    }

    // Verify user belongs to the same tenant as the challenge
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.tenant_id !== challenge.tenant_id) {
      return NextResponse.json(
        { error: "No tienes acceso a este desafío" },
        { status: 403 }
      );
    }

    // For now, any authenticated user in the same tenant can accept/decline/cancel
    // This can be made more restrictive later if needed
    const isChallenged = true;
    const isChallenger = true;

    const body = await req.json();
    const validated = challengeUpdateSchema.parse(body);

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
      .select("challenger_id, tenant_id")
      .eq("id", challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Desafío no encontrado" }, { status: 404 });
    }

    // Verify user belongs to the same tenant as the challenge
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.tenant_id !== challenge.tenant_id) {
      return NextResponse.json(
        { error: "No tienes acceso a este desafío" },
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
