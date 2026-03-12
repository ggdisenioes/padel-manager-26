# Security Priority Checklist

Objetivo: elevar seguridad sin romper permisos actuales ni dejar la app inactiva.

## P0 - Crítico (hacer primero)

- [x] Bloquear regresiones de seguridad en migraciones SQL (control automático).
  - Estado: implementado `npm run check:security:migrations`.
  - Protege contra:
    - `DISABLE ROW LEVEL SECURITY` en migraciones nuevas.
    - Vistas con `SECURITY DEFINER`.
  - Archivo: `scripts/go-live/check-security-migrations.mjs`.

- [x] Endurecer endpoints mutables contra CSRF (sin cambiar RBAC/RLS).
  - Estado: implementado en `proxy.ts` para `POST/PUT/PATCH/DELETE` en `/api/*`.
  - Reglas:
    - Si `Origin` o `Referer` existen, deben ser same-origin.
    - Si `Sec-Fetch-Site = cross-site` y no hay origen válido, se bloquea.
  - Resultado: se reduce riesgo de requests cruzados con cookies de sesión.

- [ ] Auditoría productiva de tablas expuestas sin RLS (lectura).
  - Ejecutar SQL de auditoría en Supabase y confirmar 0 hallazgos críticos.
  - SQL listo: `sql/security_p0_audit.sql`.
  - Condición de cierre:
    - 0 tablas en schemas expuestos sin RLS.
    - 0 vistas con `security_definer=true`.

- [ ] Auditoría de funciones `SECURITY DEFINER` activas.
  - Verificar que cada función tenga `SET search_path` fijo y permisos mínimos.
  - Cerrar hallazgos con migración correctiva compatible.

- [x] Hardening masivo de `SECURITY DEFINER` sin `search_path` (runtime DB).
  - Estado: aplicado con migración `20260312113500_harden_definer_search_path.sql`.
  - Resultado: funciones `SECURITY DEFINER` en `public` sin `search_path` quedaron con:
    - `search_path = pg_catalog, public, auth, extensions`.

## P1 - Alta

- [ ] Rate limit en endpoints sensibles:
  - Login, reset password, invitaciones, cambio de rol.
  - Recomendación: límite por IP + por usuario + ventana temporal.
  - Estado actual: aplicado en reset password, invitaciones (send/resend/cancel), cambio de rol, creación/borrado/cambio de contraseña de usuarios admin y notificación de registros.
  - Implementación: `rateLimitAsync` con backend distribuido (`@upstash/ratelimit` + `@vercel/kv`) y fallback seguro en memoria.

- [ ] MFA obligatorio para roles `admin` (y recomendado para `manager`).

- [ ] Política de sesiones:
  - Timeout por inactividad.
  - Expiración absoluta.
  - Revocación en cambios críticos (password/rol).

- [ ] Endurecer secretos y accesos:
  - Rotación trimestral de claves (`service_role`, Resend, CI/CD).
  - Secret scanning en CI (bloquea merge con secretos).

## P2 - Media

- [ ] Logging de seguridad centralizado:
  - `actor`, `tenant`, `action`, `resource`, `ip`, `user-agent`, `timestamp`.

- [ ] Alertas de seguridad:
  - Escalación de rol.
  - Reintentos de login fallidos.
  - Picos de 403/401.

- [ ] Prueba de restore de backup mensual con evidencia.

## P3 - Continua

- [ ] Pentest periódico.
- [ ] Revisión trimestral de permisos y políticas.
- [ ] Simulacro de incidente (runbook + tiempos de respuesta).

---

## Implementación segura (sin downtime)

1. Aplicar primero cambios de **lectura/auditoría** y guardrails.
2. Desplegar en ventana controlada con rollback preparado.
3. Monitorear errores `401/403/5xx` los primeros 30-60 minutos.
4. Solo después aplicar cambios de RLS/roles en DB con script reversible.
