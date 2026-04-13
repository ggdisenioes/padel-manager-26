"use client";

import Link from "next/link";
import Card from "../components/Card";

export default function ChallengesPage() {
  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20">
      <section className="max-w-3xl mx-auto">
        <Card className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl">
            ⚔️
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Desafíos deshabilitados temporalmente
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Este módulo está pausado de momento. El ranking, partidos,
            torneos y reservas siguen disponibles normalmente.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Volver al dashboard
          </Link>
        </Card>
      </section>
    </main>
  );
}
