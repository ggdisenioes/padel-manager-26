"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

/**
 * Página de aterrizaje del enlace de confirmación de email.
 *
 * Es el momento en que se avisa a los administradores: recién acá sabemos que
 * la dirección existe de verdad. Antes de esto no se manda ningún mail, así
 * que un registro con un email inventado nunca llega a la bandeja de nadie.
 *
 * La cuenta sigue pendiente de aprobación, así que la sesión que abre el
 * enlace se cierra antes de mandar al usuario al login.
 */
export default function RegistroConfirmadoPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Confirmando tu email…");

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      // Supabase establece la sesión desde el hash de la URL y puede tardar
      // un instante. Se reintenta unas cuantas veces antes de rendirse.
      let session = (await supabase.auth.getSession()).data.session;
      for (let attempt = 0; attempt < 8 && !session; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!mounted) return;
        session = (await supabase.auth.getSession()).data.session;
      }

      if (!mounted) return;

      const user = session?.user;
      const tenantId = user?.user_metadata?.requested_tenant_id as string | undefined;

      if (user && tenantId) {
        setMessage("Avisando al administrador del club…");

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 9000);

          await fetch("/api/auth/register/admin-notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_id: tenantId,
              email: String(user.email || "").trim().toLowerCase(),
              first_name: user.user_metadata?.first_name ?? null,
              last_name: user.user_metadata?.last_name ?? null,
              user_id: user.id,
            }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
        } catch (notifyError) {
          // No bloquea nada: el admin ve igual la solicitud en su panel.
          console.warn("[registro-confirmado] admin notify failed", notifyError);
        }
      }

      // La cuenta está confirmada pero todavía no aprobada: no corresponde
      // dejarla con sesión abierta.
      if (session) {
        await supabase.auth.signOut();
      }

      if (!mounted) return;
      router.replace("/login?error=aprobacion_en_curso");
    };

    void run();

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main className="min-h-[calc(100vh-64px)] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
        <h1 className="text-2xl font-bold">Email confirmado</h1>
        <p className="text-sm text-gray-600">{message}</p>
        <p className="text-xs text-gray-500">
          Tu acceso queda pendiente de aprobación por el administrador del club.
        </p>
      </div>
    </main>
  );
}
