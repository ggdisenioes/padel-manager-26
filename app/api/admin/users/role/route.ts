export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  user_id?: string;
  role?: string;
};

const ALLOWED_ROLES = new Set(["admin", "manager", "user"]);

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1) Auth del requester por bearer token (JWT)
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null;
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: requesterUser, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !requesterUser?.user)
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // 2) Perfil del requester
    const { data: requesterProfile } = await adminClient
      .from("profiles")
      .select("id, role, tenant_id, active")
      .eq("id", requesterUser.user.id)
      .maybeSingle();

    if (!requesterProfile?.active || requesterProfile.role !== "admin") {
      return NextResponse.json({ error: "Solo admins pueden cambiar roles." }, { status: 403 });
    }
    if (!requesterProfile.tenant_id) {
      return NextResponse.json({ error: "Admin sin tenant asignado." }, { status: 400 });
    }

    // 3) Body
    const body = (await request.json()) as Body;
    const targetId = (body.user_id || "").trim();
    const newRole = (body.role || "").toLowerCase();

    if (!targetId || !ALLOWED_ROLES.has(newRole)) {
      return NextResponse.json({ error: "Parámetros inválidos." }, { status: 400 });
    }

    // 4) Perfil target (misma tenant)
    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, tenant_id, role, active")
      .eq("id", targetId)
      .maybeSingle();

    if (targetErr || !target) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }
    if (target.tenant_id !== requesterProfile.tenant_id) {
      return NextResponse.json({ error: "No podés editar usuarios de otro tenant." }, { status: 403 });
    }
    const currentRole = String(target.role || "").toLowerCase();
    if (currentRole === "super_admin") {
      return NextResponse.json({ error: "No se puede modificar super_admin." }, { status: 403 });
    }
    if (currentRole === newRole) {
      return NextResponse.json({ success: true, user_id: targetId, role: newRole, unchanged: true });
    }

    // Evita que se quede el tenant sin admins activos
    if (currentRole === "admin" && newRole !== "admin") {
      const { count, error: countErr } = await adminClient
        .from("profiles")
        .select("id", { head: true, count: "exact" })
        .eq("tenant_id", requesterProfile.tenant_id)
        .eq("role", "admin")
        .eq("active", true);

      if (countErr) {
        return NextResponse.json({ error: countErr.message || "Error validando admins." }, { status: 500 });
      }

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "No se puede quitar el rol admin al único admin activo del tenant." },
          { status: 400 }
        );
      }
    }

    // 5) Update perfil
    const { error: upErr } = await adminClient
      .from("profiles")
      .update({ role: newRole, active: true })
      .eq("id", targetId)
      .eq("tenant_id", requesterProfile.tenant_id);

    if (upErr) {
      const msg = upErr.message || "Error actualizando rol";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // 6) Opcional: reflejar en app_metadata/user_metadata
    await adminClient.auth.admin.updateUserById(targetId, {
      app_metadata: { role: newRole },
      user_metadata: { role: newRole },
    }).catch(() => {});

    return NextResponse.json({ success: true, user_id: targetId, role: newRole });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
