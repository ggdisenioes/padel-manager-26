"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRole } from "@/app/hooks/useRole";
import toast from "react-hot-toast";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserProfile = {
  id: string;
  email: string;
  role: "admin" | "manager" | "user";
  active: boolean;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
};

export default function AdminUsersManagePage() {
  const { role, loading: roleLoading } = useRole();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    first_name: string;
    last_name: string;
  }>({
    first_name: "",
    last_name: "",
  });

  useEffect(() => {
    const loadUsers = async () => {
      if (role !== "admin") return;

      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,email,role,active,created_at,first_name,last_name")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("loadUsers error", {
            message: (error as any).message,
            details: (error as any).details,
            hint: (error as any).hint,
            code: (error as any).code,
            status: (error as any).status,
            raw: error,
          });
          setError((error as any).message || "Error cargando usuarios");
          toast.error((error as any).message || "Error cargando usuarios");
        } else {
          setUsers((data as any) || []);
        }
      } finally {
        setLoading(false);
      }
    };

    if (!roleLoading) {
      loadUsers();
    }
  }, [role, roleLoading]);

  const updateRole = async (userId: string, newRole: "user" | "manager") => {
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);

    if (error) {
      toast.error("No se pudo actualizar el rol");
    } else {
      toast.success("Rol actualizado");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, role: newRole } : u
        )
      );
    }
  };

  const toggleActive = async (userId: string, active: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ active: !active })
      .eq("id", userId);

    if (error) {
      toast.error("No se pudo actualizar el estado");
    } else {
      toast.success(active ? "Usuario desactivado" : "Usuario activado");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, active: !active } : u
        )
      );
    }
  };

  const getDisplayName = (u: UserProfile) => {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full || u.email;
  };

  const startEdit = (u: UserProfile) => {
    setEditingUserId(u.id);
    setEditForm({
      first_name: u.first_name || "",
      last_name: u.last_name || "",
    });
  };

  const saveEdit = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: editForm.first_name || null,
        last_name: editForm.last_name || null,
      })
      .eq("id", userId);

    if (error) {
      toast.error("No se pudo guardar los cambios");
    } else {
      toast.success("Cambios guardados");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                first_name: editForm.first_name,
                last_name: editForm.last_name,
              }
            : u
        )
      );
      setEditingUserId(null);
    }
  };

  const cancelEdit = () => {
    setEditingUserId(null);
  };

  if (roleLoading) {
    return <div className="p-6">Cargando...</div>;
  }

  if (role !== "admin") {
    return (
      <div className="p-6 text-red-600 font-semibold">
        No tenés permisos para ver esta sección.
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Administración de usuarios</h1>

      {loading ? (
        <div>Cargando usuarios...</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            {error && (
              <div className="mb-4 text-red-600 font-medium">
                {error}
              </div>
            )}

            <table className="min-w-full border rounded-lg bg-white">
              <thead className="bg-gray-50 text-sm">
                <tr>
                  <th className="px-4 py-2 text-left">Usuario</th>
                  <th className="px-4 py-2 text-left">Rol</th>
                  <th className="px-4 py-2 text-left">Estado</th>
                  <th className="px-4 py-2 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t text-sm">
                    <td className="px-4 py-2">
                      {editingUserId === u.id ? (
                        <>
                          <input
                            type="text"
                            placeholder="Nombre"
                            value={editForm.first_name}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                first_name: e.target.value,
                              }))
                            }
                            className="border rounded px-2 py-1 mb-1 w-full"
                          />
                          <input
                            type="text"
                            placeholder="Apellido"
                            value={editForm.last_name}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                last_name: e.target.value,
                              }))
                            }
                            className="border rounded px-2 py-1 mb-1 w-full"
                          />
                          <div className="text-xs text-gray-500">{u.email}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium">{getDisplayName(u)}</div>
                          <div className="text-xs text-gray-500">{u.email}</div>
                        </>
                      )}
                    </td>

                    <td className="px-4 py-2 capitalize">
                      {u.role === "admin" ? (
                        <span className="font-semibold text-indigo-600">
                          admin
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) =>
                            updateRole(
                              u.id,
                              e.target.value as "user" | "manager"
                            )
                          }
                          className="border rounded px-2 py-1"
                        >
                          <option value="user">user</option>
                          <option value="manager">manager</option>
                        </select>
                      )}
                    </td>

                    <td className="px-4 py-2">
                      {u.active ? (
                        <span className="text-green-600 font-medium">
                          Activo
                        </span>
                      ) : (
                        <span className="text-gray-400 font-medium">
                          Inactivo
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-2 space-x-2">
                      {editingUserId === u.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(u.id)}
                            className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          {u.role !== "admin" && (
                            <>
                              <button
                                onClick={() => startEdit(u)}
                                className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => toggleActive(u.id, u.active)}
                                className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                              >
                                {u.active ? "Desactivar" : "Activar"}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-4">
            {error && (
              <div className="mb-4 text-red-600 font-medium">
                {error}
              </div>
            )}
            {users.map((u) => (
              <div key={u.id} className="border rounded-lg bg-white p-4 shadow">
                <div className="mb-2">
                  {editingUserId === u.id ? (
                    <>
                      <input
                        type="text"
                        placeholder="Nombre"
                        value={editForm.first_name}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            first_name: e.target.value,
                          }))
                        }
                        className="border rounded px-2 py-1 mb-1 w-full"
                      />
                      <input
                        type="text"
                        placeholder="Apellido"
                        value={editForm.last_name}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            last_name: e.target.value,
                          }))
                        }
                        className="border rounded px-2 py-1 mb-1 w-full"
                      />
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-lg">{getDisplayName(u)}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </>
                  )}
                </div>

                <div className="mb-2">
                  <span className="font-semibold">Rol: </span>
                  {u.role === "admin" ? (
                    <span className="text-indigo-600">admin</span>
                  ) : editingUserId === u.id ? (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateRole(
                          u.id,
                          e.target.value as "user" | "manager"
                        )
                      }
                      className="border rounded px-2 py-1 w-full"
                    >
                      <option value="user">user</option>
                      <option value="manager">manager</option>
                    </select>
                  ) : (
                    <span>{u.role}</span>
                  )}
                </div>

                <div className="mb-2">
                  <span className="font-semibold">Estado: </span>
                  {u.active ? (
                    <span className="text-green-600 font-medium">Activo</span>
                  ) : (
                    <span className="text-gray-400 font-medium">Inactivo</span>
                  )}
                </div>

                <div className="flex space-x-2">
                  {editingUserId === u.id ? (
                    <>
                      <button
                        onClick={() => saveEdit(u.id)}
                        className="flex-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      {u.role !== "admin" && (
                        <>
                          <button
                            onClick={() => startEdit(u)}
                            className="flex-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => toggleActive(u.id, u.active)}
                            className="flex-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                          >
                            {u.active ? "Desactivar" : "Activar"}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}