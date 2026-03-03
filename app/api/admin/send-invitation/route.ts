import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { sendUserInvitationEmail } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INVITE_NETWORK_TIMEOUT_MS = Number(process.env.INVITE_NETWORK_TIMEOUT_MS || "12000");

const inviteSchema = z.object({
  first_name: z.string().trim().min(1, "Nombre requerido.").max(100),
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  role: z.enum(["user", "manager"]).default("user"),
  last_name: z.string().trim().max(100).optional(),
});

type RequesterProfile = {
  role: string | null;
  active: boolean | null;
  tenant_id: string | null;
};

type ExistingProfile = {
  id: string;
  tenant_id: string | null;
  role: string | null;
};

function getHost(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host") || "";
  return host.split(",")[0].trim().toLowerCase();
}

function getOrigin(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const host = getHost(req).split(":")[0];
  const proto = (req.headers.get("x-forwarded-proto") || "https")
    .split(",")[0]
    .trim();

  if (!host) {
    return "https://twinco.padelx.es";
  }

  return `${proto}://${host}`;
}

function generateTemporaryPassword(): string {
  // Strong temporary password. User will replace it from recovery link.
  const token = crypto.randomBytes(24).toString("base64url");
  return `Tmp!${token}A1`;
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timeout`));
        }, INVITE_NETWORK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const { success } = rateLimit(`send-invitation:${ip}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intentá en un minuto." },
        { status: 429 }
      );
    }

    if (!supabaseUrl || !serviceRoleKey || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Servidor mal configurado (env faltante)." },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Datos inválidos." },
        { status: 400 }
      );
    }

    const { email, role, first_name, last_name } = parsed.data;

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
    if (
      requesterProfile.active !== true ||
      requesterProfile.role !== "admin" ||
      !requesterProfile.tenant_id
    ) {
      return NextResponse.json(
        { error: "Solo admins activos pueden enviar invitaciones." },
        { status: 403 }
      );
    }

    const { data: profileRows, error: profileRowsErr } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, role")
      .eq("email", email);

    if (profileRowsErr) {
      return NextResponse.json(
        { error: "No se pudo validar el usuario invitado." },
        { status: 500 }
      );
    }

    const existingProfiles = (profileRows || []) as ExistingProfile[];
    const sameTenantProfile =
      existingProfiles.find((p) => p.tenant_id === requesterProfile.tenant_id) || null;
    const otherTenantProfile =
      existingProfiles.find((p) => p.tenant_id && p.tenant_id !== requesterProfile.tenant_id) ||
      null;

    if (otherTenantProfile) {
      return NextResponse.json(
        { error: "Este email ya pertenece a otro club." },
        { status: 409 }
      );
    }

    if (sameTenantProfile?.role === "admin") {
      return NextResponse.json(
        { error: "Este email ya pertenece a un administrador." },
        { status: 409 }
      );
    }

    let invitedUserId = sameTenantProfile?.id || null;

    if (!invitedUserId) {
      const createResult = await supabaseAdmin.auth.admin.createUser({
        email,
        password: generateTemporaryPassword(),
        email_confirm: true,
        user_metadata: {
          tenant_id: requesterProfile.tenant_id,
          role,
          first_name: first_name || null,
          last_name: last_name || null,
        },
        app_metadata: {
          tenant_id: requesterProfile.tenant_id,
          role,
        } as Record<string, unknown>,
      });

      if (createResult.error || !createResult.data.user) {
        const msg = createResult.error?.message || "No se pudo crear el usuario";
        if (msg.toLowerCase().includes("already")) {
          return NextResponse.json(
            { error: "El email ya está registrado. Contactá soporte para reasignarlo." },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }

      invitedUserId = createResult.data.user.id;
    }

    const profilePayload: Record<string, unknown> = {
      id: invitedUserId,
      email,
      role,
      active: true,
      tenant_id: requesterProfile.tenant_id,
    };
    if (first_name) profilePayload.first_name = first_name;
    if (last_name) profilePayload.last_name = last_name;

    const { error: upsertProfileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" });

    if (upsertProfileError) {
      return NextResponse.json(
        { error: "No se pudo preparar el perfil del usuario." },
        { status: 500 }
      );
    }

    const origin = getOrigin(req);
    const redirectTo = `${origin}/reset-password`;

    const { data: linkData, error: linkError } = await withTimeout(
      supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      }),
      "generate-link"
    );

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json(
        { error: "No se pudo generar el enlace de invitación." },
        { status: 500 }
      );
    }

    const { data: tenantData } = await supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", requesterProfile.tenant_id)
      .maybeSingle();

    const tenantName = String(tenantData?.name || "").trim();
    const host = getHost(req);
    const isTwincoTenant =
      host.includes("twinco.padelx.es") || tenantName.toLowerCase() === "twinco";
    const clubName = isTwincoTenant ? "Twinco Padel Manager" : tenantName || "PadelX";

    const sent = await withTimeout(
      sendUserInvitationEmail({
        to: email,
        inviteUrl: linkData.properties.action_link,
        clubName,
        fromName: clubName,
        invitedName: first_name,
        invitedRole: role,
      }),
      "send-invitation-email"
    ).catch((mailErr) => {
      console.error("[send-invitation] invitation email error", mailErr);
      return false;
    });

    let delivered = sent;
    if (!delivered) {
      // Fallback to Supabase default recovery template to avoid blocking.
      const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      });
      const fallback = await withTimeout(
        supabasePublic.auth.resetPasswordForEmail(email, { redirectTo }),
        "fallback-reset-email"
      ).catch((fallbackErr) => {
        console.error("[send-invitation] fallback reset email error", fallbackErr);
        return null;
      });

      delivered = Boolean(fallback && !fallback.error);
    }

    if (!delivered) {
      return NextResponse.json(
        { error: "No se pudo enviar la invitación. Reintentá en unos segundos." },
        { status: 502 }
      );
    }

    try {
      await supabaseAdmin.from("action_logs").insert({
        action: "ADMIN_SEND_INVITATION",
        entity: "auth",
        entity_id: invitedUserId,
        tenant_id: requesterProfile.tenant_id,
        metadata: {
          invited_email: email,
          invited_role: role,
          invited_name: first_name,
        },
      });
    } catch (logErr) {
      console.warn("[send-invitation] non-blocking log insert error", logErr);
    }

    return NextResponse.json({
      ok: true,
      invited: true,
      email,
      role,
      user_id: invitedUserId,
    });
  } catch (error) {
    console.error("[send-invitation] unexpected error", error);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
