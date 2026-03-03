import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_LOOKUP_TIMEOUT_MS = Number(process.env.AUTH_LOOKUP_TIMEOUT_MS || "7000");
const INVITATION_FALLBACK_WINDOW_DAYS = Number(
  process.env.INVITATION_FALLBACK_WINDOW_DAYS || "45"
);

type RequesterProfile = {
  role: string | null;
  active: boolean | null;
  tenant_id: string | null;
};

type InvitationLogRow = {
  entity_id: string | number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  active: boolean | null;
  deleted_at: string | null;
  created_at: string | null;
};

type PendingInvitation = {
  user_id: string | null;
  name: string;
  email: string;
  role: string;
  invited_at: string;
  last_sign_in_at: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRole(role: unknown): string {
  const v = String(role || "")
    .trim()
    .toLowerCase();
  if (v === "admin" || v === "manager" || v === "user") return v;
  return "user";
}

async function getAuthSignInMap(
  admin: ReturnType<typeof createClient>,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
  const out = new Map<string, string | null>();
  if (uniqueIds.length === 0) return out;

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 15) {
    chunks.push(uniqueIds.slice(i, i + 15));
  }

  const withTimeout = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout`)), AUTH_LOOKUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (userId) => {
        const { data, error } = await withTimeout(
          admin.auth.admin.getUserById(userId),
          `getUserById:${userId}`
        );
        if (error || !data?.user) {
          return { userId, lastSignInAt: null };
        }
        return { userId, lastSignInAt: data.user.last_sign_in_at || null };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        out.set(result.value.userId, result.value.lastSignInAt);
      } else {
        console.warn("[pending-invitations] getUserById failed", result.reason);
      }
    }
  }

  return out;
}

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const { success } = rateLimit(`pending-invitations:${ip}`, {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!success) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intentá en un minuto." },
        { status: 429 }
      );
    }

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Servidor mal configurado (env faltante)." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const accessToken = match[1].trim();

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
    }

    const { data: requester, error: requesterErr } = await supabaseAdmin
      .from("profiles")
      .select("role, active, tenant_id")
      .eq("id", user.id)
      .maybeSingle();

    if (requesterErr || !requester) {
      return NextResponse.json({ error: "Permisos insuficientes." }, { status: 403 });
    }

    const requesterProfile = requester as RequesterProfile;
    const requesterRole = String(requesterProfile.role || "").toLowerCase();
    const canRead =
      requesterProfile.active === true &&
      (requesterRole === "admin" || requesterRole === "manager") &&
      Boolean(requesterProfile.tenant_id);

    if (!canRead) {
      return NextResponse.json(
        { error: "Solo admins o managers activos pueden ver invitaciones." },
        { status: 403 }
      );
    }

    const { data: invitationLogs, error: invitationErr } = await supabaseAdmin
      .from("action_logs")
      .select("entity_id, metadata, created_at")
      .eq("tenant_id", requesterProfile.tenant_id)
      .eq("action", "ADMIN_SEND_INVITATION")
      .order("created_at", { ascending: false })
      .limit(500);

    if (invitationErr) {
      return NextResponse.json(
        { error: "No se pudieron cargar las invitaciones enviadas." },
        { status: 500 }
      );
    }

    const latestByKey = new Map<
      string,
      {
        user_id: string | null;
        invited_email: string | null;
        invited_name: string | null;
        invited_role: string;
        invited_at: string;
      }
    >();

    for (const row of (invitationLogs || []) as InvitationLogRow[]) {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      const userId = asString(row.entity_id);
      const invitedEmail = asString(metadata.invited_email)?.toLowerCase() || null;
      const invitedName = asString(metadata.invited_name);
      const invitedRole = normalizeRole(metadata.invited_role);

      const key = userId ? `id:${userId}` : invitedEmail ? `email:${invitedEmail}` : null;
      if (!key || latestByKey.has(key)) continue;

      latestByKey.set(key, {
        user_id: userId,
        invited_email: invitedEmail,
        invited_name: invitedName,
        invited_role: invitedRole,
        invited_at: row.created_at,
      });
    }

    const dedupedInvites = Array.from(latestByKey.values());

    const fallbackSince = new Date();
    fallbackSince.setDate(fallbackSince.getDate() - INVITATION_FALLBACK_WINDOW_DAYS);

    const { data: tenantProfiles, error: tenantProfilesErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, first_name, last_name, role, active, deleted_at, created_at")
      .eq("tenant_id", requesterProfile.tenant_id)
      .in("role", ["user", "manager"])
      .is("deleted_at", null)
      .eq("active", true)
      .gte("created_at", fallbackSince.toISOString())
      .order("created_at", { ascending: false })
      .limit(1000);

    if (tenantProfilesErr) {
      return NextResponse.json(
        { error: "No se pudieron cargar perfiles del tenant." },
        { status: 500 }
      );
    }

    const profileRows = (tenantProfiles || []) as ProfileRow[];
    const profileById = new Map(profileRows.map((p) => [p.id, p]));

    const userIdSet = new Set<string>();
    for (const inv of dedupedInvites) {
      if (inv.user_id) userIdSet.add(inv.user_id);
    }
    for (const p of profileRows) {
      userIdSet.add(p.id);
    }

    const signInById = await getAuthSignInMap(supabaseAdmin, Array.from(userIdSet));

    const pendingMap = new Map<string, PendingInvitation>();
    const upsertPending = (row: PendingInvitation) => {
      const key = row.user_id ? `id:${row.user_id}` : `email:${row.email.toLowerCase()}`;
      if (pendingMap.has(key)) return;
      pendingMap.set(key, row);
    };

    for (const invite of dedupedInvites) {
      const profile = invite.user_id ? profileById.get(invite.user_id) || null : null;
      if (profile && (profile.deleted_at || profile.active === false)) continue;

      const lastSignIn = invite.user_id ? signInById.get(invite.user_id) || null : null;
      if (lastSignIn) continue;

      const firstName = asString(profile?.first_name);
      const lastName = asString(profile?.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

      const email = asString(profile?.email) || invite.invited_email;
      if (!email) continue;

      upsertPending({
        user_id: invite.user_id,
        name: fullName || invite.invited_name || "Sin nombre",
        email,
        role: normalizeRole(profile?.role || invite.invited_role),
        invited_at: invite.invited_at,
        last_sign_in_at: lastSignIn,
      });
    }

    for (const profile of profileRows) {
      const lastSignIn = signInById.get(profile.id) || null;
      if (lastSignIn) continue;

      const email = asString(profile.email);
      if (!email) continue;

      const firstName = asString(profile.first_name);
      const lastName = asString(profile.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

      upsertPending({
        user_id: profile.id,
        name: fullName || "Sin nombre",
        email,
        role: normalizeRole(profile.role),
        invited_at: profile.created_at || new Date().toISOString(),
        last_sign_in_at: null,
      });
    }

    const pending = Array.from(pendingMap.values());

    pending.sort((a, b) => {
      return new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime();
    });

    return NextResponse.json({
      ok: true,
      count: pending.length,
      invitations: pending,
    });
  } catch (error) {
    console.error("[pending-invitations] unexpected error", error);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
