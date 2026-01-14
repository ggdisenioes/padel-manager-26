"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import toast from "react-hot-toast";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type UserRole = "admin" | "manager" | "user";

type ProfileRow = {
  role: UserRole | string | null;
  // legacy
  active?: boolean | null;
  // new naming (tenants)
  is_disabled?: boolean | null;
  disabled?: boolean | null;
  tenant_slug?: string | null;
  tenant_id?: number | null;
};

async function fetchProfileForUser(userId: string): Promise<ProfileRow | null> {
  // 1) Prefer the tenant-aware view/table if it exists
  const tryTenantView = async () => {
    const { data, error } = await supabase
      .from("profiles_with_tenant")
      .select("role, tenant_slug, tenant_id, is_disabled, disabled, active")
      .eq("id", userId)
      .single();

    if (!error && data) return data as ProfileRow;

    // If it doesn't exist, Supabase usually returns a PostgREST error mentioning the relation
    const msg = (error as any)?.message ?? "";
    const code = (error as any)?.code ?? "";
    if (
      msg.includes("does not exist") ||
      msg.includes("relation") ||
      code === "42P01" // undefined_table
    ) {
      return null;
    }

    // If RLS denies or row not found, we still fallback to legacy profiles
    console.warn("[useRole] profiles_with_tenant lookup failed:", error);
    return null;
  };

  const fromTenant = await tryTenantView();
  if (fromTenant) return fromTenant;

  // 2) Fallback: legacy table
  const { data, error } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  return data as ProfileRow;
}

export function useRole() {
  const [role, setRole] = useState<UserRole>("user");
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const signOutDisabled = async () => {
      try {
        toast.error("Tu cuenta fue desactivada. Contactá al administrador.");
      } catch {}

      try {
        await supabase.auth.signOut();
      } catch {}

      try {
        sessionStorage.setItem("auth_disabled", "1");
      } catch {}

      if (typeof window !== "undefined") {
        window.location.href = "/login?disabled=1";
      }
    };

    const loadRole = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.warn("[useRole] getSession error", sessionError);
        }

        if (!session?.user?.id) {
          if (active) {
            setRole("user");
            setTenantSlug(null);
            setTenantId(null);
            setLoading(false);
          }
          return;
        }

        const userId = session.user.id;

        const profile = await fetchProfileForUser(userId);

        if (!profile) {
          console.warn("[useRole] no profile row found for user", userId);
          if (active) {
            setRole("user");
            setTenantSlug(null);
            setTenantId(null);
          }
          return;
        }

        // Disabled logic (SAFE): only consider disabled when the flag is explicitly true/false.
        // This prevents false positives when a view returns NULLs.
        const isDisabled =
          profile.is_disabled === true ||
          profile.disabled === true ||
          profile.active === false;

        // Helpful debug
        console.log("[useRole] profile loaded:", {
          userId,
          role: profile.role,
          tenant_slug: profile.tenant_slug,
          tenant_id: profile.tenant_id,
          is_disabled: profile.is_disabled,
          disabled: profile.disabled,
          active: profile.active,
        });

        if (isDisabled) {
          console.warn("[useRole] disabled user detected", userId);

          // If the user is actually disabled in DB, we sign out.
          // But avoid redirect loops: do it only once per browser session.
          const alreadyRedirected =
            typeof window !== "undefined" && sessionStorage.getItem("auth_disabled") === "1";

          if (!alreadyRedirected) {
            await signOutDisabled();
          } else {
            try {
              toast.error("Tu cuenta figura como desactivada. Si creés que es un error, avisá al administrador.");
            } catch {}
            if (active) {
              setRole("user");
              setTenantSlug(null);
              setTenantId(null);
              setLoading(false);
            }
          }
          return;
        }

        if (active) {
          // tenant context (optional)
          setTenantSlug(profile.tenant_slug ?? null);
          setTenantId(typeof profile.tenant_id === "number" ? profile.tenant_id : null);

          const rawRole = String(profile.role ?? "user").toLowerCase();
          const validRoles: UserRole[] = ["admin", "manager", "user"];
          setRole(validRoles.includes(rawRole as UserRole) ? (rawRole as UserRole) : "user");

          console.log("[useRole] role detected:", rawRole);
        }
      } catch (err) {
        console.error("[useRole] unexpected error:", err);
        if (active) {
          setRole("user");
          setTenantSlug(null);
          setTenantId(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRole();

    return () => {
      active = false;
    };
  }, []);

  return {
    role,
    tenantSlug,
    tenantId,
    isAdmin: role === "admin",
    isManager: role === "manager",
    isUser: role === "user",
    loading,
  };
}