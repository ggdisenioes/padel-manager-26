// ./app/tournaments/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isAdminSession } from "../lib/admin";
import toast from "react-hot-toast";
import Link from "next/link";

type Tournament = {
  id: number;
  name: string;
  category: string | null;
  start_date: string | null;
};

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Ver si es admin
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setIsAdmin(isAdminSession(session));

      // Cargar torneos
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .order("id", { ascending: true });

      if (error) {
        toast.error(`Error al cargar torneos: ${error.message}`);
        console.error("Error al cargar torneos:", error);
      } else {
        setTournaments((data || []) as Tournament[]);
      }

      setLoading(false);
    };

    load();
  }, []);

  return (
    <main className="p-4 md:p-10 pb-20 w-full overflow-x-hidden">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Torneos
          </h1>

          {isAdmin && (
            <Link
              href="/tournaments/create"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
            >
              ➕ Crear torneo
            </Link>
          )}
        </div>

        {loading ? (
          <p className="text-gray-500 animate-pulse">Cargando torneos...</p>
        ) : tournaments.length === 0 ? (
          <p className="text-gray-500">No hay torneos.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {tournaments.map((t) => (
              <article
                key={t.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <h2 className="text-lg md:text-xl font-bold mb-1 text-gray-900">
                    {t.name}
                  </h2>
                  {t.category && (
                    <span className="inline-block mb-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      {t.category}
                    </span>
                  )}
                  {t.start_date && (
                    <p className="text-xs text-gray-500">
                      Desde{" "}
                      {new Date(t.start_date).toLocaleDateString("es-ES")}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100 text-sm">
                  <Link
                    href={`/matches?tournament=${t.id}`}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    Ver partidos &rarr;
                  </Link>

                  {isAdmin && (
                    <Link
                      href={`/tournaments/edit/${t.id}`}
                      className="text-xs font-semibold text-gray-700 hover:text-gray-900"
                    >
                      Editar
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}