"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRole } from "@/app/hooks/useRole";
import toast from "react-hot-toast";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AdminUsersPage() {
  const { role, loading: roleLoading } = useRole();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState<"user" | "manager">("user");
  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Estado inicial mientras se detecta el rol
  if (roleLoading) {
    return <div className="p-4 sm:p-6 text-gray-900">Cargando...</div>;
  }

  // Protección de ruta
  if (role !== "admin") {
    return (
      <div className="p-4 sm:p-6 text-gray-900 font-semibold text-red-600">
        No tenés permisos para acceder a esta sección.
      </div>
    );
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        toast.error("Sesión inválida");
        return;
      }

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          password,
          role: userRole,
          first_name: firstName,
          last_name: lastName,
        }),
      });

      let data: any = null;

      try {
        data = await res.json();
      } catch {
        toast.error("Error del servidor (respuesta inválida)");
        return;
      }

      if (!res.ok) {
        toast.error(data?.error || "Error creando usuario");
        return;
      }

      toast.success("Usuario creado correctamente");
      setEmail("");
      setPassword("");
      setUserRole("user");
      setFirstName("");
      setLastName("");
    } catch (err) {
      console.error(err);
      toast.error("Error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Administración de Usuarios</h1>

      <form
        onSubmit={handleCreateUser}
        className="space-y-4 bg-white border rounded-lg p-4 sm:p-6 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-800">Nombre</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400"
            placeholder="Nombre"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-800">Apellido</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400"
            placeholder="Apellido"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-800">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400"
            placeholder="usuario@padel.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-800">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400"
            placeholder="Mínimo 8 caracteres"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-800">Rol</label>
          <select
            value={userRole}
            onChange={(e) =>
              setUserRole(e.target.value as "user" | "manager")
            }
            className="w-full border rounded px-3 py-2 text-gray-900 placeholder-gray-400"
          >
            <option value="user">Cliente</option>
            <option value="manager">Manager</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 transition disabled:opacity-50 text-base"
        >
          {loading ? "Creando usuario..." : "Crear usuario"}
        </button>
      </form>
    </div>
  );
}