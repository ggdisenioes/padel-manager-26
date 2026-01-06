// ./app/components/AppShell.tsx
"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { Toaster } from "react-hot-toast";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    setMobileOpen(false);

    const isLogin = pathname === "/login";
    if (isLogin) {
      setCheckingSession(false);
      return;
    }

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      setCheckingSession(false);
    };

    checkSession();

    // Limpiar flag cuando el usuario ya está en login
    if (pathname === "/login") {
      sessionStorage.removeItem("unauthorized_redirect");
    }
  }, [pathname, pathname === "/login"]);

  if (checkingSession) {
    return null;
  }

  return (
    <>
      <Toaster position="top-right" />

      <div className="min-h-screen flex bg-[#05070b]">
        {/* SIDEBAR DESKTOP */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* COLUMNA PRINCIPAL (HEADER + CONTENIDO) */}
        <div className="flex-1 flex flex-col">
          {/* HEADER MOBILE */}
          <header className="md:hidden flex items-center justify-between px-4 py-4 bg-[#05070b] border-b border-gray-800">
            <div className="text-center flex-1">
              <p className="text-[11px] font-extrabold tracking-[0.26em] text-white uppercase">
                TWINCO
              </p>
              <p className="text-[9px] font-semibold tracking-[0.32em] text-[#ccff00] uppercase mt-1">
                Pádel Manager
              </p>
            </div>

            <button
              type="button"
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              className="ml-3 inline-flex items-center justify-center rounded-md border border-gray-700 p-2 text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#05070b] focus:ring-[#ccff00]"
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? (
                // Icono X
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                // Icono hamburguesa
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </header>

          {/* CONTENIDO PRINCIPAL */}
          <div className="flex-1 bg-gray-50">
            {children}
          </div>
        </div>

        {/* OVERLAY MOBILE DEL SIDEBAR */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            {/* Fondo oscurecido clicable para cerrar */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />

            {/* Sidebar deslizándose desde la izquierda */}
            <div className="absolute inset-y-0 left-0 w-64 max-w-[80%]">
              {/* El Sidebar ya tiene scroll interno en el menú */}
              <Sidebar onLinkClick={() => setMobileOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}