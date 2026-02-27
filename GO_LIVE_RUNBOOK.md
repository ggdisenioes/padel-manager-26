# Go-Live Runbook

## 1. Pre-deploy checks
- `npm run check:migrations`
- `npm run check:client-secrets`
- `npm run build`
- `npm run test:e2e` (expect role tests to skip if E2E role credentials are missing)
- `supabase db lint --linked`
- `supabase migration list --linked` (local vs remote aligned)

## 2. Database release
- Apply pending migrations:
  - `supabase db push --linked`
- Re-check schema:
  - `supabase db lint --linked`

## 3. Application release
- Push changes to `main`.
- Deploy production from clean git state:
  - `vercel deploy --prod --yes`
- Verify deployment status:
  - `vercel inspect <deployment-url>`

## 4. Post-release smoke checks
- `npm run go-live:smoke` (defaults to `https://twinco.padelx.es`)
- Manual spot-check:
  - Login with admin account.
  - Open dashboard, matches, ranking, admin notifications.
  - Confirm `/api/health` returns `ok: true`.

## 5. Incident rollback
- Identify previous working deployment:
  - `vercel ls --status READY`
- Promote previous deployment alias to production (or redeploy previous commit).
- If DB rollback is required:
  - Apply forward-fix migration (preferred).
  - Avoid destructive rollback unless absolutely necessary.

## 6. Monitoring and response
- Primary health endpoint: `/api/health`
- Alert trigger suggestion:
  - 2 consecutive failures (>=503) within 5 minutes.
- During incident:
  - Capture failing endpoint, timestamp, and user impact.
  - Check Vercel deployment status/logs.
  - Check Supabase status and recent migrations.
