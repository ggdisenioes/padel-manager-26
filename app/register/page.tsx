"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabase";
import { getFirstPasswordError, getPasswordRuleStatuses } from "../lib/password-policy";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  // opcional: si existe en DB
  is_active?: boolean | null;
};

type RegisterResponse = {
  ok?: boolean;
  error?: string;
  notify_now?: boolean;
  confirmation_required?: boolean;
  user_id?: string | null;
};

export default function RegisterPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [tenantId, setTenantId] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const visibleTenants = useMemo(() => {
    // Reglas:
    // - Mostrar solo tenants activos (si existe is_active)
    // - Excluir tenants de pruebas (por slug)
    // Para este momento (según tu consigna), debería quedar solo TWINCO.
    return tenants
      .filter((t) => (t.is_active ?? true) === true)
      .filter((t) => {
        const s = (t.slug || "").toLowerCase();
        if (s.includes("test") || s.includes("prueba") || s.includes("demo")) return false;
        return true;
      });
  }, [tenants]);

  const passwordRuleStatuses = useMemo(
    () => getPasswordRuleStatuses(password),
    [password]
  );

  useEffect(() => {
    const loadTenants = async () => {
      setTenantsLoading(true);

      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, is_active")
        .order("name", { ascending: true });

      if (error) {
        console.error(error);
        toast.error("No se pudieron cargar los clubes.");
        setTenants([]);
        setTenantsLoading(false);
        return;
      }

      const list = (data as Tenant[]) || [];
      setTenants(list);

      // Auto-seleccionar si solo hay 1 visible (por ejemplo, Twinco)
      const filtered = (list as Tenant[])
        .filter((t) => (t.is_active ?? true) === true)
        .filter((t) => {
          const s = (t.slug || "").toLowerCase();
          if (s.includes("test") || s.includes("prueba") || s.includes("demo")) return false;
          return true;
        });

      if (filtered.length === 1) {
        setTenantId(filtered[0].id);
      }

      setTenantsLoading(false);
    };

    void loadTenants();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!tenantId) {
      toast.error("Seleccioná un club.");
      return;
    }

    if (!email.trim()) {
      toast.error("Ingresá un email.");
      return;
    }

    const passwordError = getFirstPasswordError(password);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    if (password !== password2) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    // IMPORTANTE: acá NO asignamos roles.
    // El alta la hace /api/auth/register en el servidor, que valida el email,
    // el club y los límites de frecuencia ANTES de crear nada. El rol SIEMPRE
    // lo define el backend (trigger en auth.users -> profiles): 'user' con
    // active=false (pendiente) para el registro libre.
    const normalizedEmail = email.trim().toLowerCase();

    let result: RegisterResponse = {};

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          email: normalizedEmail,
          password,
          password_confirmation: password2,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        }),
      });

      result = ((await response.json().catch(() => ({}))) || {}) as RegisterResponse;

      if (!response.ok) {
        toast.error(result.error || "No se pudo crear la cuenta.");
        setLoading(false);
        return;
      }
    } catch (registerError) {
      console.error("[register] request failed", registerError);
      toast.error("No se pudo conectar con el servidor. Intentá de nuevo.");
      setLoading(false);
      return;
    }

    // Si falta confirmar el email, el aviso a los admins lo dispara
    // /registro-confirmado. Acá solo se avisa cuando la cuenta ya quedó
    // confirmada (es decir, con la confirmación desactivada en Supabase).
    if (result.notify_now) {
      try {
        const notifyController = new AbortController();
        const notifyTimeout = setTimeout(() => notifyController.abort(), 9000);

        await fetch("/api/auth/register/admin-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            email: normalizedEmail,
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            user_id: result.user_id ?? null,
          }),
          signal: notifyController.signal,
        }).finally(() => clearTimeout(notifyTimeout));
      } catch (notifyErr) {
        // No bloquea el registro del usuario.
        console.warn("[register] admin notify failed", notifyErr);
      }
    }

    toast.success(
      result.confirmation_required
        ? "Te enviamos un email para confirmar tu dirección. Confirmala para completar la solicitud."
        : "Solicitud enviada. Tu acceso quedará pendiente de aprobación por el administrador del club."
    );
    router.push("/login?error=aprobacion_en_curso");
  };

  return (
    <main className="min-h-[calc(100vh-64px)] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="space-y-1 mb-6">
          <h1 className="text-2xl font-bold">Crear cuenta</h1>
          <p className="text-sm text-gray-600">
            Registrate para solicitar acceso a un club. Un administrador debe aprobar tu solicitud.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Club</label>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={tenantsLoading}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50"
            >
              <option value="">
                {tenantsLoading ? "Cargando clubes…" : "Seleccionar club"}
              </option>
              {visibleTenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Si no ves tu club, contactá al administrador.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Juan"
                autoComplete="given-name"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Apellido</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Martínez"
                autoComplete="family-name"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="tuemail@dominio.com"
              autoComplete="email"
              type="email"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <ul className="mt-2 space-y-1">
              {passwordRuleStatuses.map((rule) => (
                <li
                  key={rule.key}
                  className={`text-xs ${rule.ok ? "text-green-700" : "text-gray-500"}`}
                >
                  {rule.ok ? "[OK]" : "[ ]"} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Repetir contraseña
            </label>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Repetí tu contraseña"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || tenantsLoading}
            className="w-full bg-green-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50"
          >
            {loading ? "Enviando…" : "Enviar solicitud"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full bg-gray-100 text-gray-700 px-4 py-3 rounded-lg font-semibold hover:bg-gray-200 transition"
          >
            Ya tengo cuenta
          </button>
        </form>
      </div>
    </main>
  );
}
