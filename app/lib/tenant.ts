import { supabase } from "./supabase";

type TokenClaims = {
  tenant_id?: string;
  app_metadata?: {
    tenant_id?: string;
  };
  user_metadata?: {
    tenant_id?: string;
  };
};

function decodeJwtPayload<T = unknown>(token: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "===".slice((base64.length + 3) % 4);

    const json = atob(padded);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Devuelve el tenant_id del usuario logueado.
 * - Primero intenta leerlo del JWT (rápido y no depende de RLS).
 * - Si no está, hace fallback a la tabla profiles.
 */
export async function getTenantId(): Promise<string | null> {
  // 1) JWT
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;
  if (token) {
    const claims = decodeJwtPayload<TokenClaims>(token);
    const tenantId =
      claims?.tenant_id ??
      claims?.app_metadata?.tenant_id ??
      claims?.user_metadata?.tenant_id;

    if (typeof tenantId === "string" && tenantId.length > 0) return tenantId;
  }

  // 2) Fallback a DB
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  const tenantId = (data as any)?.tenant_id;
  return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : null;
}
