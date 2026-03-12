# Security Audit Report - 2026-03-12

## Scope
- Application: `padel-manager-26` (Twinco production deployment).
- Audit type: source review + runtime verification + database posture check.
- Date: 2026-03-12.

## Executive Verdict
- Current security posture: **82/100**.
- Overall verdict: **Good baseline with critical controls active**, but not yet at "maximum hardening" due to pending distributed rate limiting, MFA/session policy enforcement, and dependency risk cleanup.

## Scoring Model
- Identity & Access Management (25): **20/25**
- Data Security & Isolation (25): **24/25**
- API/App Protections (20): **17/20**
- Secrets & Supply Chain (15): **10/15**
- Monitoring, Auditability, Incident Readiness (15): **11/15**
- Total: **82/100**

## Evidence Collected
- `npm run check:security:migrations` -> Critical `0`, warnings `12`.
- `npm run check:secret-patterns` -> no high-risk secret pattern in tracked files.
- `npm run check:client-secrets` -> no `SUPABASE_SERVICE_ROLE_KEY` leak to client code.
- `npm run audit:live-db-security` (read-only):
  - Public tables without RLS: `0`
  - Exposed grants to `anon/authenticated`: `0`
  - Public views without explicit `security_invoker=true`: `0`
  - `SECURITY DEFINER` functions without fixed `search_path`: `0`
  - Broad policies flagged for review: `35` (review list, non-critical by itself).
- Runtime health check (`/api/health`) confirms:
  - `csrf_guard: true`
  - `distributed_rate_limit_configured: false`
- Runtime CSRF probe:
  - Cross-origin `POST` to admin endpoint returns `403 {"error":"forbidden"}`.
- Dependency audit:
  - `npm audit --json`: `1 high` (`minimatch`) + `1 moderate` (`ajv`), both fixable.

## What Is Already Strong
- RLS posture is strong in production (no critical table exposure).
- Security definer hardening applied (`search_path` fixed).
- CSRF protection in mutating API paths.
- Rate limiting implemented across sensitive auth/admin flows.
- Secret scanning and migration guardrails in CI.
- Security headers present in production responses.

## Findings and Risks

### High
1. Distributed rate limiting is not active in production.
- Evidence: `/api/health` reports `distributed_rate_limit_configured: false`.
- Risk: protection works per-instance fallback, but loses global consistency under scale.
- Required action: configure `KV_REST_API_URL` + `KV_REST_API_TOKEN` in Vercel production.

2. Dependency vulnerabilities (1 high, 1 moderate).
- Evidence: `npm audit --json`.
- Risk: ReDoS vectors in vulnerable transitive packages.
- Required action: run controlled dependency updates and re-test.

### Medium
3. Broad RLS policies using literal `true` predicates require explicit periodic review.
- Evidence: 35 policies flagged by live audit.
- Risk: future policy drift can widen access unintentionally.
- Action: document each policy intent and tighten where possible.

4. MFA and strict session policy not enforced at platform level.
- Risk: higher account-takeover impact for admin/manager roles.
- Action: enforce MFA for admins and set inactivity + absolute session limits.

### Low
5. Security telemetry can be improved.
- Current: audit logs exist, but no centralized alerting pipeline.
- Action: alert on role changes, repeated 401/403/429 spikes, and unusual invitation activity.

## Implementations Done During This Audit Window
- Added global security headers in middleware/proxy.
- Added live DB read-only security audit script:
  - `scripts/go-live/audit-live-db-security.mjs`
- Added migration guardrail for broad RLS `true` predicates.
- Hardened admin endpoints so auth/authz executes before payload validation:
  - `app/api/admin/create-user/route.ts`
  - `app/api/admin/send-invitation/route.ts`
  - `app/api/admin/invitations/resend/route.ts`
  - `app/api/admin/invitations/cancel/route.ts`
- Hardened passkey rate limiting with async distributed-capable strategy.

## Priority Next Steps
1. Configure Vercel KV env vars in production (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).
2. Patch vulnerable dependencies from `npm audit` and re-run smoke/build.
3. Enforce MFA for admin roles.
4. Define session timeout and absolute max session lifetime.
5. Add security alerting over audit logs.

## Business Readiness Statement
- The application is **operationally secure enough for controlled production use**, with strong tenant data isolation and no critical DB exposure found in this audit.
- To reach a **"high-assurance" posture**, complete the top 3 next steps above first.
