"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabase";
import { waitForSession } from "@/lib/auth-session";

export type UserRole = "admin" | "manager" | "super_admin" | "user";

type TokenClaims = {
  // Compatibilidad: hay proyectos que usan role/active y otros user_role/user_active
  role?: string;
  active?: boolean;
  user_role?: string;
  user_active?: boolean;
  app_metadata?: {
    role?: string;
    active?: boolean;
    user_role?: string;
    user_active?: boolean;
  };
};

type RoleCachePayload = {
  ts: number;
  role: UserRole;
  userId: string;
};

const ROLE_CACHE_KEY = "padelx:role-cache:v1";
const ROLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SESSION_USER_ID_KEY = "padelx.sessionUserId";

let inMemoryRoleCache: RoleCachePayload | null = null;

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

function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "admin" || normalized === "manager" || normalized === "user") {
    return normalized as UserRole;
  }
  if (normalized === "super_admin" || normalized === "super-admin" || normalized === "superadmin") {
    return "super_admin";
  }
  return null;
}

function readRoleCache(): RoleCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    if (inMemoryRoleCache) {
      if (Date.now() - inMemoryRoleCache.ts <= ROLE_CACHE_TTL_MS) {
        return inMemoryRoleCache;
      }
      inMemoryRoleCache = null;
    }

    const raw = window.sessionStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoleCachePayload;
    if (!parsed || typeof parsed.ts !== "number" || typeof parsed.role !== "string") {
      return null;
    }
    if (Date.now() - parsed.ts > ROLE_CACHE_TTL_MS) {
      return null;
    }

    const sessionUserId = window.localStorage.getItem(SESSION_USER_ID_KEY);
    if (sessionUserId && parsed.userId && sessionUserId !== parsed.userId) {
      return null;
    }

    inMemoryRoleCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeRoleCache(role: UserRole, userId: string) {
  if (typeof window === "undefined") return;
  try {
    const payload: RoleCachePayload = {
      ts: Date.now(),
      role,
      userId,
    };
    inMemoryRoleCache = payload;
    window.sessionStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function clearRoleCache() {
  inMemoryRoleCache = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ROLE_CACHE_KEY);
  } catch {
    // no-op
  }
}

export function useRole() {
  const initialCache = readRoleCache();
  const [role, setRole] = useState<UserRole>(initialCache?.role || "user");
  const [loading, setLoading] = useState(!initialCache);

  useEffect(() => {
    let active = true;
    let lateRetryScheduled = false;

    const loadRole = async () => {
      try {
        const session = await waitForSession(supabase, { retries: 16, delayMs: 180 });

        if (!session?.user?.id) {
          if (active) {
            setRole("user");
            setLoading(false);
          }
          clearRoleCache();
          if (!lateRetryScheduled) {
            lateRetryScheduled = true;
            setTimeout(() => {
              if (active) void loadRole();
            }, 1200);
          }
          return;
        }

        // 1) Preferimos claims del JWT (no depende de RLS)
        const token = session.access_token;
        const claims = token ? decodeJwtPayload<TokenClaims>(token) : null;
        const roleFromToken =
          claims?.role ??
          claims?.user_role ??
          claims?.app_metadata?.role ??
          claims?.app_metadata?.user_role;

        const activeFromToken =
          claims?.active ??
          claims?.user_active ??
          claims?.app_metadata?.active ??
          claims?.app_metadata?.user_active;

        if (activeFromToken === false) {
          console.warn("[useRole] inactive user (JWT claim), signing out", session.user.id);
          toast.error("Tu cuenta fue desactivada. Contactá al administrador.");
          await supabase.auth.signOut();
          try {
            sessionStorage.setItem("auth_disabled", "1");
          } catch {}
          if (typeof window !== "undefined") {
            window.location.href = "/login?disabled=1";
          }
          return;
        }

        const normalizedTokenRole = normalizeRole(roleFromToken);
        if (normalizedTokenRole && normalizedTokenRole !== "user") {
          if (active) {
            setRole(normalizedTokenRole);
            setLoading(false);
          }
          writeRoleCache(normalizedTokenRole, session.user.id);
          // Si el token ya trae privilegios, no hace falta pegarle a la DB.
          return;
        }

        const userId = session.user.id;

        // 2) Fallback a DB (por si el hook de claims todavía no está activo)
        const { data, error } = await supabase
          .from("profiles")
          .select("role, active")
          .eq("id", userId)
          .single();

        if (error || !data) {
          console.warn("[useRole] failed to fetch role from profiles", error);
          if (active) {
            const nextRole = normalizedTokenRole || "user";
            setRole(nextRole);
            setLoading(false);
            writeRoleCache(nextRole, userId);
          }
          return;
        }

        if (data.active === false) {
          console.warn("[useRole] inactive user, signing out", userId);
          toast.error("Tu cuenta fue desactivada. Contactá al administrador.");
          await supabase.auth.signOut();
          try { sessionStorage.setItem("auth_disabled", "1"); } catch {}
          if (typeof window !== "undefined") {
            window.location.href = "/login?disabled=1";
          }
          return;
        }

        const normalizedDbRole = normalizeRole(data.role);
        if (normalizedDbRole) {
          if (active) {
            setRole(normalizedDbRole);
            setLoading(false);
          }
          writeRoleCache(normalizedDbRole, userId);
        } else {
          console.warn("[useRole] invalid role value", data.role);
          if (active) {
            const nextRole = normalizedTokenRole || "user";
            setRole(nextRole);
            setLoading(false);
            writeRoleCache(nextRole, userId);
          }
        }
      } catch (err) {
        console.error("[useRole] unexpected error:", err);
        if (active) {
          setRole("user");
          setLoading(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearRoleCache();
      }
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED" ||
        event === "SIGNED_OUT"
      ) {
        void loadRole();
      }
    });

    void loadRole();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    role,
    isAdmin: role === "admin" || role === "super_admin",
    isSuperAdmin: role === "super_admin",
    isManager: role === "manager",
    isUser: role === "user",
    loading,
  };
}
