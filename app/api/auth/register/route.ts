import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { registrationSchema } from "@/lib/validation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_ORIGIN = "https://twinco.padelx.es";
const TRUSTED_HOST_SUFFIX = (
  process.env.NEXT_PUBLIC_APP_BASE_DOMAIN || "padelx.es"
).toLowerCase();

/** Slugs de clubes que nunca deben aceptar registros del formulario público. */
const BLOCKED_TENANT_SLUG_PARTS = ["test", "prueba", "demo"];

function isTrustedHost(host: string): boolean {
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return host === TRUSTED_HOST_SUFFIX || host.endsWith(`.${TRUSTED_HOST_SUFFIX}`);
}

/**
 * Origen para el enlace de confirmación.
 *
 * El host llega en una cabecera que controla quien llama, así que solo se
 * acepta si pertenece al dominio de la aplicación. Si no, se usa el valor por
 * defecto: nunca se arma un enlace hacia un dominio ajeno.
 */
function getOrigin(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const rawHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = rawHost.split(":")[0];
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();

  if (!isTrustedHost(host)) return DEFAULT_ORIGIN;

  return `${proto}://${rawHost}`;
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);

    // Dos ventanas: una corta contra ráfagas y una larga contra el goteo
    // sostenido, que es como se ve el alta automatizada de cuentas.
    const burst = await rateLimitAsync(`register:burst:${ip}`, {
      maxRequests: 5,
      windowMs: 60_000,
    });
    if (!burst.success) {
      return NextResponse.json(
        { error: "Demasiados intentos. Esperá un minuto." },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }

    const sustained = await rateLimitAsync(`register:hourly:${ip}`, {
      maxRequests: 30,
      windowMs: 3_600_000,
    });
    if (!sustained.success) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes desde esta conexión. Probá más tarde." },
        { status: 429, headers: { "Retry-After": String(sustained.retryAfterSeconds) } }
      );
    }

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error("[auth/register] faltan variables de entorno de Supabase");
      return NextResponse.json(
        { error: "Servidor mal configurado." },
        { status: 500 }
      );
    }

    const parsed = registrationSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Datos inválidos." },
        { status: 400 }
      );
    }

    const { email, password, tenant_id, first_name, last_name, captcha_token } = parsed.data;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // El club se valida en el servidor: el filtro del formulario es cosmético
    // y no impide mandar cualquier tenant_id a mano.
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from("tenants")
      .select("id, name, slug, is_active")
      .eq("id", tenant_id)
      .maybeSingle();

    if (tenantError) {
      console.error("[auth/register] error al buscar el club", tenantError);
      return NextResponse.json(
        { error: "No se pudo procesar la solicitud." },
        { status: 500 }
      );
    }

    const tenantSlug = String(tenant?.slug || "").toLowerCase();
    const tenantIsBlocked = BLOCKED_TENANT_SLUG_PARTS.some((part) => tenantSlug.includes(part));

    if (!tenant || tenant.is_active === false || tenantIsBlocked) {
      return NextResponse.json(
        { error: "El club seleccionado no admite registros." },
        { status: 400 }
      );
    }

    // Techo por club: aunque roten las IPs, un club no recibe una avalancha
    // de altas en una hora.
    const perTenant = await rateLimitAsync(`register:tenant:${tenant_id}`, {
      maxRequests: 40,
      windowMs: 3_600_000,
    });
    if (!perTenant.success) {
      return NextResponse.json(
        { error: "El club alcanzó el máximo de registros por hora. Probá más tarde." },
        { status: 429, headers: { "Retry-After": String(perTenant.retryAfterSeconds) } }
      );
    }

    // El alta se hace con la clave pública desde el servidor, no con la de
    // servicio: así Supabase manda el email de confirmación y aplica su propia
    // protección de CAPTCHA, pero la petición ya pasó por las validaciones de
    // arriba.
    const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabasePublic.auth.signUp({
      email,
      password,
      options: {
        data: {
          requested_tenant_id: tenant_id,
          first_name,
          last_name,
        },
        emailRedirectTo: `${getOrigin(req)}/registro-confirmado`,
        ...(captcha_token ? { captchaToken: captcha_token } : {}),
      },
    });

    if (error) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: "Demasiados intentos. Probá más tarde." },
          { status: 429, headers: { "Retry-After": "60" } }
        );
      }

      // El detalle queda en el log del servidor. Al cliente se le devuelve un
      // mensaje genérico para no revelar qué emails ya existen.
      console.error("[auth/register] signUp rechazado", {
        status: error.status,
        message: error.message,
      });
      return NextResponse.json(
        { error: "No se pudo crear la cuenta. Revisá los datos e intentá de nuevo." },
        { status: 400 }
      );
    }

    // Cuando el email ya está registrado, Supabase devuelve un usuario sin
    // identidades en vez de un error. Se responde igual que en un alta nueva
    // para no permitir averiguar qué direcciones existen.
    const alreadyRegistered = data.user?.identities?.length === 0;

    // Sin sesión = Supabase está esperando que confirme el email.
    const confirmationRequired = !data.session;

    return NextResponse.json({
      ok: true,
      // Solo se avisa a los admins ahora si la cuenta ya quedó confirmada.
      // Si falta confirmar, el aviso lo dispara /registro-confirmado.
      notify_now: !confirmationRequired && !alreadyRegistered,
      confirmation_required: confirmationRequired,
      user_id: alreadyRegistered ? null : data.user?.id ?? null,
    });
  } catch (error) {
    console.error("[auth/register] error inesperado", error);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
