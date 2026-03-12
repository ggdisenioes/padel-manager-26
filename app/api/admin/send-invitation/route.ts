import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { sendUserInvitationEmail } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INVITE_NETWORK_TIMEOUT_MS = Number(process.env.INVITE_NETWORK_TIMEOUT_MS || "25000");

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

type AuthUserLite = {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
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

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<AuthUserLite | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  let safety = 0;

  while (safety < 50) {
    safety += 1;
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }

    const found =
      (data?.users || []).find((u) => String(u.email || "").trim().toLowerCase() === target) ||
      null;
    if (found) {
      return {
        id: found.id,
        email: found.email || null,
        last_sign_in_at: found.last_sign_in_at || null,
      };
    }

    if (!data?.nextPage) {
      break;
    }
    page = data.nextPage;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const { success, retryAfterSeconds } = await rateLimitAsync(`send-invitation:${ip}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intentá en un minuto." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
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
      .ilike("email", email);

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
    let invitedUserLastSignInAt: string | null = null;

    if (!invitedUserId) {
      const createResult = await supabaseAdmin.auth.admin.createUser({
        email,
        password: generateTemporaryPassword(),
        email_confirm: true,
        user_metadata: {
          requested_tenant_id: requesterProfile.tenant_id,
          tenant_id: requesterProfile.tenant_id,
          role,
          first_name: first_name || null,
          last_name: last_name || null,
        },
        app_metadata: {
          requested_tenant_id: requesterProfile.tenant_id,
          tenant_id: requesterProfile.tenant_id,
          role,
        } as Record<string, unknown>,
      });

      if (createResult.error || !createResult.data.user) {
        const msg = createResult.error?.message || "No se pudo crear el usuario";
        const alreadyExists =
          msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered");
        if (alreadyExists) {
          const existingAuthUser = await withTimeout(
            findAuthUserByEmail(supabaseAdmin, email),
            "find-auth-user-by-email"
          ).catch((findErr) => {
            console.error("[send-invitation] find auth user error", findErr);
            return null;
          });

          if (existingAuthUser?.id) {
            invitedUserId = existingAuthUser.id;
            invitedUserLastSignInAt = existingAuthUser.last_sign_in_at || null;
          } else {
            return NextResponse.json(
              { error: "El email ya está registrado. No se pudo recuperar el usuario." },
              { status: 409 }
            );
          }
        } else {
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      } else {
        invitedUserId = createResult.data.user.id;
        invitedUserLastSignInAt = createResult.data.user.last_sign_in_at || null;
      }
    }

    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el usuario invitado." },
        { status: 500 }
      );
    }

    type ProfileState = {
      id: string;
      email: string | null;
      role: string | null;
      tenant_id: string | null;
      active: boolean | null;
      approval_status: string | null;
      deleted_at: string | null;
    };

    const { data: profileById, error: profileByIdErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, role, tenant_id, active, approval_status, deleted_at")
      .eq("id", invitedUserId)
      .maybeSingle();

    if (profileByIdErr) {
      return NextResponse.json(
        { error: "No se pudo validar el perfil del usuario." },
        { status: 500 }
      );
    }

    const currentProfile = (profileById as ProfileState | null) || null;
    if (currentProfile && (currentProfile.role || "").toLowerCase() === "admin") {
      return NextResponse.json(
        { error: "Este email ya pertenece a un administrador." },
        { status: 409 }
      );
    }

    if (
      currentProfile?.tenant_id &&
      currentProfile.tenant_id !== requesterProfile.tenant_id
    ) {
      return NextResponse.json(
        { error: "Este email ya pertenece a otro club." },
        { status: 409 }
      );
    }

    const profileInsert: Record<string, unknown> = {
      id: invitedUserId,
      email,
      role,
      active: true,
      approval_status: "approved",
      deleted_at: null,
      tenant_id: requesterProfile.tenant_id,
    };
    if (first_name) profileInsert.first_name = first_name;
    if (last_name) profileInsert.last_name = last_name;

    const requiresHardRepair =
      !currentProfile || currentProfile.tenant_id !== requesterProfile.tenant_id;

    if (requiresHardRepair) {
      if (invitedUserLastSignInAt && currentProfile?.tenant_id !== requesterProfile.tenant_id) {
        return NextResponse.json(
          { error: "El usuario ya activó su cuenta en otro contexto. Contactá soporte." },
          { status: 409 }
        );
      }

      if (currentProfile) {
        const { error: deleteByIdErr } = await supabaseAdmin
          .from("profiles")
          .delete()
          .eq("id", invitedUserId);
        if (deleteByIdErr) {
          return NextResponse.json(
            { error: "No se pudo preparar el perfil del usuario." },
            { status: 500 }
          );
        }
      }

      // Limpia residuos sin tenant para el mismo email y evita colisiones de unique(email).
      await supabaseAdmin
        .from("profiles")
        .delete()
        .ilike("email", email)
        .is("tenant_id", null);

      const { error: insertProfileErr } = await supabaseAdmin
        .from("profiles")
        .insert(profileInsert);

      if (insertProfileErr) {
        return NextResponse.json(
          { error: "No se pudo preparar el perfil del usuario." },
          { status: 500 }
        );
      }
    } else {
      // Si ya existe en el mismo tenant pero está pendiente/inactivo, intenta aprobarlo.
      if (
        currentProfile.active !== true ||
        (currentProfile.approval_status || "").toLowerCase() !== "approved"
      ) {
        const { error: approveErr } = await supabaseUser.rpc("approve_user", {
          p_user_id: invitedUserId,
        });
        if (approveErr) {
          console.warn("[send-invitation] approve_user warning", approveErr);
        }
      }
    }

    const origin = getOrigin(req);
    const redirectTo = `${origin}/reset-password`;
    const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    let actionLink: string | null = null;
    const linkResult = await withTimeout(
      supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      }),
      "generate-link"
    ).catch((linkErr) => {
      console.error("[send-invitation] generate-link error", linkErr);
      return null;
    });

    if (linkResult && !linkResult.error && linkResult.data?.properties?.action_link) {
      actionLink = linkResult.data.properties.action_link;
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

    let sent = false;
    if (actionLink) {
      sent = await withTimeout(
        sendUserInvitationEmail({
          to: email,
          inviteUrl: actionLink,
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
    }

    let deliveryStatus: "custom_invitation" | "supabase_default" | "failed" =
      sent ? "custom_invitation" : "failed";
    let delivered = sent;
    if (!delivered) {
      // Fallback to Supabase default recovery template to avoid blocking.
      const fallback = await withTimeout(
        supabasePublic.auth.resetPasswordForEmail(email, { redirectTo }),
        "fallback-reset-email"
      ).catch((fallbackErr) => {
        console.error("[send-invitation] fallback reset email error", fallbackErr);
        return null;
      });

      delivered = Boolean(fallback && !fallback.error);
      if (delivered) {
        deliveryStatus = "supabase_default";
      }
    }

    if (!delivered) {
      deliveryStatus = "failed";
    }

    const requesterEmail = user.email || null;

    try {
      await supabaseAdmin.from("action_logs").insert({
        action: "ADMIN_SEND_INVITATION",
        entity: "auth",
        entity_id: invitedUserId,
        user_email: requesterEmail,
        tenant_id: requesterProfile.tenant_id,
        metadata: {
          invited_email: email,
          invited_role: role,
          invited_name: first_name,
          delivery_status: deliveryStatus,
        },
      });
    } catch (logErr) {
      console.warn("[send-invitation] non-blocking log insert error", logErr);
    }

    if (!delivered) {
      return NextResponse.json(
        { error: "No se pudo enviar la invitación. Reintentá en unos segundos." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      invited: true,
      email_template: deliveryStatus,
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
