"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";

type ApprovalStatus = "pending" | "approved" | "rejected";

type ProfileRow = {
  id: string;
  email: string | null;
  role: "admin" | "manager" | "user" | string;
  tenant_id: string | null;
  active: boolean | null;
  approval_status: ApprovalStatus | null;
  deleted_at: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string | null;
};

type TabKey = "pending" | "approved" | "rejected" | "deleted" | "all";

function displayName(u: ProfileRow) {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || "Sin nombre";
}

function statusFromRow(u: ProfileRow): "pending" | "approved" | "rejected" | "deleted" {
  // 1) Si está marcado como eliminado (soft delete), prima sobre todo.
  if (u.deleted_at) return "deleted";

  // 2) Si hay approval_status válido, úsalo.
  const s = (u.approval_status ?? "").toString().toLowerCase();
  if (s === "pending" || s === "approved" || s === "rejected") return s;

  // 3) Fallback legacy por active
  return u.active ? "approved" : "pending";
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [canAccess, setCanAccess] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [tab, setTab] = useState<TabKey>("pending");

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => statusFromRow(r) === tab);
  }, [rows, tab]);

  const load = async () => {
    setLoading(true);

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      setLoading(false);
      setCanAccess(false);
      toast.error("No se pudo leer tu sesión.");
      return;
    }

    setMeId(user.id);

    // Leer mi perfil desde profiles (RLS: select own permitido)
    const { data: me, error: meErr } = await supabase
      .from("profiles")
      .select("id, tenant_id, role, active, approval_status")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr || !me) {
      console.warn("[admin/users] could not read my profile", { meErr, userId: user.id });
      setLoading(false);
      setCanAccess(false);
      toast.error(
        "No se pudo determinar tu club (tenant). Verificá que exista tu fila en public.profiles y que tenga tenant_id asignado."
      );
      return;
    }

    const role = (me.role ?? "").toString().toLowerCase();
    const allowed = role === "admin" || role === "manager";

    setTenantId(me.tenant_id ?? null);
    setCanAccess(allowed);

    if (!allowed) {
      setRows([]);
      setLoading(false);
      return;
    }

    if (!me.tenant_id) {
      setRows([]);
      setLoading(false);
      toast.error("Tu perfil no tiene tenant_id asignado.");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,role,tenant_id,active,approval_status,deleted_at,first_name,last_name,created_at")
      .eq("tenant_id", me.tenant_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("No se pudieron cargar los usuarios.");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as ProfileRow[]) || []);
    setLoading(false);
  };

  const approve = async (userId: string) => {
    const { error } = await supabase.rpc("approve_user", { p_user_id: userId });
    if (error) {
      console.error(error);
      toast.error("No se pudo aprobar el usuario.");
      return;
    }
    toast.success("Usuario aprobado.");
    void load();
  };

  const reject = async (userId: string) => {
    const { error } = await supabase.rpc("reject_user", { p_user_id: userId });
    if (error) {
      console.error(error);
      toast.error("No se pudo rechazar el usuario.");
      return;
    }
    toast.success("Usuario rechazado.");
    void load();
  };

  const softDelete = async (userId: string) => {
    // “Eliminar” = baja lógica (reversible)
    const { error } = await supabase
      .from("profiles")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      console.error("[admin/users] softDelete error", error);
      toast.error(`No se pudo eliminar (deshabilitar) el usuario. ${error.message ?? ""}`.trim());
      return;
    }

    toast.success("Usuario eliminado (deshabilitado).");
    void load();
  };

  const setActive = async (userId: string, active: boolean) => {
    // No borrar: solo deshabilitar/habilitar
    const patch: Partial<ProfileRow> = active
      ? ({ active: true, deleted_at: null, approval_status: "approved" } as any)
      : ({ active: false } as any);

    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);

    if (error) {
      console.error("[admin/users] setActive error", error);
      toast.error(active ? "No se pudo habilitar el usuario." : "No se pudo deshabilitar el usuario.");
      return;
    }

    toast.success(active ? "Usuario habilitado." : "Usuario deshabilitado.");
    void load();
  };

  const changeRole = async (userId: string, newRole: "user" | "manager") => {
    // Seguridad: nunca permitir setear admin desde UI
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", userId);
    if (error) {
      console.error(error);
      toast.error("No se pudo actualizar el rol.");
      return;
    }
    toast.success("Rol actualizado.");
    void load();
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <p className="p-6 text-gray-500">Cargando…</p>;
  }

  if (!canAccess) {
    return (
      <p className="p-6 text-red-600 font-semibold">
        No tenés permisos para gestionar usuarios.
      </p>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Gestión de usuarios</h1>
          <p className="text-sm text-gray-600">
            Administrá usuarios del club (aprobar/rechazar, habilitar/deshabilitar, rol).
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition"
        >
          Actualizar
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {([
          ["pending", "Pendientes"],
          ["approved", "Aprobados"],
          ["rejected", "Rechazados"],
          ["deleted", "Eliminados"],
          ["all", "Todos"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 rounded-md text-sm font-semibold border ${
              tab === k
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-3 text-xs font-bold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
          <div className="col-span-4">Usuario</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-2">Rol</div>
          <div className="col-span-1">Estado</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6 text-gray-500">No hay usuarios en esta sección.</div>
        ) : (
          filtered.map((u) => {
            const status = statusFromRow(u);
            const isMe = meId === u.id;
            const isAdmin = (u.role ?? "").toString().toLowerCase() === "admin";

            return (
              <div
                key={u.id}
                className="grid grid-cols-12 px-4 py-4 border-b border-gray-100 items-center gap-2"
              >
                <div className="col-span-4">
                  <p className="font-semibold text-gray-900 flex items-center gap-2">
                    {displayName(u)}
                    {isMe && (
                      <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                        Vos
                      </span>
                    )}
                    {isAdmin && (
                      <span className="text-[10px] px-2 py-1 rounded-full bg-purple-100 text-purple-700">
                        Admin
                      </span>
                    )}
                {u.active === false && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-red-100 text-red-700">
                    {u.deleted_at ? "Eliminado" : "Deshabilitado"}
                  </span>
                )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{u.id}</p>
                </div>

                <div className="col-span-3 text-sm text-gray-700 truncate">{u.email ?? "—"}</div>

                <div className="col-span-2">
                  {/* Nunca permitir setear admin desde UI */}
                  {isAdmin ? (
                    <span className="text-sm text-gray-700">admin</span>
                  ) : (
                    <select
                      value={(u.role ?? "user").toString().toLowerCase()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "manager" || v === "user") void changeRole(u.id, v);
                      }}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="user">user</option>
                      <option value="manager">manager</option>
                    </select>
                  )}
                </div>

                <div className="col-span-1">
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : status === "approved"
                        ? "bg-green-100 text-green-800"
                        : status === "deleted"
                        ? "bg-gray-200 text-gray-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {status === "pending"
                      ? "Pendiente"
                      : status === "approved"
                      ? "Aprobado"
                      : status === "rejected"
                      ? "Rechazado"
                      : "Eliminado"}
                  </span>
                </div>

                <div className="col-span-2 flex justify-end gap-2">
                  {status === "pending" && (
                    <>
                      <button
                        onClick={() => approve(u.id)}
                        className="bg-green-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-green-700 transition"
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={() => reject(u.id)}
                        className="bg-red-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-red-700 transition"
                      >
                        Rechazar
                      </button>
                    </>
                  )}

                  {status === "deleted" && (
                    <button
                      onClick={() => setActive(u.id, true)}
                      className="bg-green-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-green-700 transition"
                    >
                      Rehabilitar
                    </button>
                  )}

                  {status !== "pending" && status !== "deleted" && (
                    <>
                      {u.active === false ? (
                        <button
                          onClick={() => setActive(u.id, true)}
                          className="bg-green-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-green-700 transition"
                        >
                          Habilitar
                        </button>
                      ) : (
                        <button
                          onClick={() => setActive(u.id, false)}
                          disabled={isMe || isAdmin}
                          title={
                            isMe
                              ? "No podés deshabilitarte a vos mismo"
                              : isAdmin
                              ? "No se deshabilita el admin principal desde aquí"
                              : ""
                          }
                          className="bg-gray-900 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-black transition disabled:opacity-40"
                        >
                          Deshabilitar
                        </button>
                      )}

                      {/* Eliminar (baja lógica) para no ensuciar: manda al tab Eliminados */}
                      {!u.deleted_at && u.active !== false && (
                        <button
                          onClick={() => softDelete(u.id)}
                          disabled={isMe || isAdmin}
                          title={
                            isMe
                              ? "No podés eliminarte a vos mismo"
                              : isAdmin
                              ? "No se elimina el admin principal desde aquí"
                              : "Eliminar = deshabilitar (reversible)"
                          }
                          className="bg-red-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-red-700 transition disabled:opacity-40"
                        >
                          Eliminar
                        </button>
                      )}

                      {status === "rejected" && (
                        <button
                          onClick={() => approve(u.id)}
                          className="bg-green-600 text-white px-3 py-2 rounded-md text-xs font-semibold hover:bg-green-700 transition"
                        >
                          Aprobar
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-gray-500">
        Nota: “Eliminar” es una baja lógica (reversible). El usuario pasa a la pestaña “Eliminados” y puede ser rehabilitado.
      </p>
    </main>
  );
}