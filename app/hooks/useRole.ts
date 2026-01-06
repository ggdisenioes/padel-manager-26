"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import toast from "react-hot-toast";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type UserRole = "admin" | "manager" | "user";

export function useRole() {
  const [role, setRole] = useState<UserRole>("user");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadRole = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user?.id) {
          if (active) {
            setRole("user");
            setLoading(false);
          }
          return;
        }

        const userId = session.user.id;

        const { data, error } = await supabase
          .from("profiles")
          .select("role, active")
          .eq("id", userId)
          .single();

        if (error || !data) {
          console.warn("[useRole] failed to fetch role from profiles", error);
          if (active) setRole("user");
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

        const validRoles: UserRole[] = ["admin", "manager", "user"];
        if (validRoles.includes(data.role)) {
          if (active) setRole(data.role);
        } else {
          console.warn("[useRole] invalid role value", data.role);
          if (active) setRole("user");
        }
      } catch (err) {
        console.error("[useRole] unexpected error:", err);
        if (active) setRole("user");
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
    isAdmin: role === "admin",
    isManager: role === "manager",
    isUser: role === "user",
    loading,
  };
}