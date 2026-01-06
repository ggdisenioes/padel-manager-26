import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          // Pasamos el token del usuario si existe (cookie/session)
          Authorization: req.headers.get("authorization") ?? "",
        },
      },
    }
  );

  // En Next App Router, lo más estable es leer el JWT desde el cliente.
  // Como este endpoint es para debug, vamos a responder "no-auth" si no hay token.
  const { data: userData, error: userErr } = await supabase.auth.getUser();

  if (userErr || !userData?.user) {
    return NextResponse.json({
      ok: false,
      reason: "no-auth-or-invalid-token",
      userErr: userErr?.message ?? null,
    });
  }

  const user = userData.user;

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id,email,role,created_at")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    ok: true,
    auth: { id: user.id, email: user.email },
    profile,
    profErr: profErr?.message ?? null,
  });
}