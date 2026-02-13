import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    // Verificar que sea una solicitud local o autorizada
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.includes("Bearer")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Obtener usuario con email ggdisenioes@gmail.com
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const superAdminUser = users?.find(u => u.email === "ggdisenioes@gmail.com");

    if (!superAdminUser) {
      return NextResponse.json(
        { error: "User ggdisenioes@gmail.com not found" },
        { status: 404 }
      );
    }

    // Actualizar su perfil a super_admin
    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ role: "super_admin", active: true })
      .eq("id", superAdminUser.id)
      .select();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "User updated to super_admin",
      userId: superAdminUser.id,
      profile: profile[0],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
