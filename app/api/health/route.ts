import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const startedAt = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const buildPublicPayload = (
    ok: boolean,
    status: "healthy" | "degraded",
    checks: { config: boolean; database: boolean }
  ) => ({
    ok,
    status,
    checks,
    duration_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      buildPublicPayload(false, "degraded", {
        config: false,
        database: false,
      }),
      { status: 503 }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error } = await supabase
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return NextResponse.json(
        buildPublicPayload(false, "degraded", {
          config: true,
          database: false,
        }),
        { status: 503 }
      );
    }

    return NextResponse.json(
      buildPublicPayload(true, "healthy", {
        config: true,
        database: true,
      }),
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      buildPublicPayload(false, "degraded", {
        config: true,
        database: false,
      }),
      { status: 503 }
    );
  }
}
