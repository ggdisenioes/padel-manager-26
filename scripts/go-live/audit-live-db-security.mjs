import { execFileSync } from "node:child_process";
import { Client } from "pg";

function getConnectionFromSupabaseCli() {
  let output = "";
  try {
    output = execFileSync("supabase", ["db", "dump", "--dry-run", "--schema", "public"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr || "")
        : "";
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String(error.stdout || "")
        : "";
    const details = (stderr || stdout || "unknown error").trim();
    throw new Error(`Unable to obtain temporary DB credentials from Supabase CLI.\n${details}`);
  }

  const env = {};
  const regex = /^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)="([^"]*)"$/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    env[match[1]] = match[2];
  }

  const required = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Supabase CLI did not return complete DB credentials. Missing: ${missing.join(", ")}`
    );
  }

  return env;
}

async function runAudit() {
  const conn = getConnectionFromSupabaseCli();

  const client = new Client({
    host: conn.PGHOST,
    port: Number(conn.PGPORT),
    user: conn.PGUSER,
    password: conn.PGPASSWORD,
    database: conn.PGDATABASE,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const tablesWithoutRlsQuery = `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND NOT c.relrowsecurity
      ORDER BY 1, 2;
    `;

    const exposureInventoryQuery = `
      SELECT
        table_schema,
        table_name,
        grantee,
        STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
      FROM information_schema.table_privileges
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3;
    `;

    const viewsWithoutInvokerQuery = `
      SELECT
        n.nspname AS schema_name,
        c.relname AS view_name,
        COALESCE(array_to_string(c.reloptions, ','), '') AS reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'v'
        AND n.nspname = 'public'
        AND COALESCE(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%'
      ORDER BY 1, 2;
    `;

    const definerWithoutSearchPathQuery = `
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        p.prosecdef AS security_definer,
        COALESCE(array_to_string(p.proconfig, ','), '') AS config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef
        AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM unnest(p.proconfig) cfg
            WHERE cfg LIKE 'search_path=%'
          )
        )
      ORDER BY 1, 2;
    `;

    const broadPolicyQuery = `
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          COALESCE(qual, '') ILIKE '%true%'
          OR COALESCE(with_check, '') ILIKE '%true%'
        )
      ORDER BY 1, 2, 3;
    `;

    const tablesWithoutRls = await client.query(tablesWithoutRlsQuery);
    const exposureInventory = await client.query(exposureInventoryQuery);
    const viewsWithoutInvoker = await client.query(viewsWithoutInvokerQuery);
    const definerWithoutSearchPath = await client.query(definerWithoutSearchPathQuery);
    const broadPolicies = await client.query(broadPolicyQuery);

    console.log("Live DB Security Audit (public schema)");
    console.log(`- Tables without RLS: ${tablesWithoutRls.rows.length}`);
    if (tablesWithoutRls.rows.length > 0) {
      for (const row of tablesWithoutRls.rows) {
        console.log(`  - ${row.schema_name}.${row.table_name}`);
      }
    }

    console.log(`- Exposed grants to anon/authenticated: ${exposureInventory.rows.length}`);
    if (exposureInventory.rows.length > 0) {
      for (const row of exposureInventory.rows) {
        console.log(`  - ${row.table_schema}.${row.table_name} [${row.grantee}] -> ${row.privileges}`);
      }
    }

    console.log(`- Public views without explicit security_invoker=true: ${viewsWithoutInvoker.rows.length}`);
    if (viewsWithoutInvoker.rows.length > 0) {
      for (const row of viewsWithoutInvoker.rows) {
        console.log(`  - ${row.schema_name}.${row.view_name} (${row.reloptions || "no reloptions"})`);
      }
    }

    console.log(
      `- SECURITY DEFINER functions without fixed search_path: ${definerWithoutSearchPath.rows.length}`
    );
    if (definerWithoutSearchPath.rows.length > 0) {
      for (const row of definerWithoutSearchPath.rows) {
        console.log(`  - ${row.schema_name}.${row.function_name} (${row.config || "no config"})`);
      }
    }

    console.log(`- Broad policies using true conditions (review): ${broadPolicies.rows.length}`);
    if (broadPolicies.rows.length > 0) {
      for (const row of broadPolicies.rows) {
        console.log(
          `  - ${row.schemaname}.${row.tablename}.${row.policyname} [${row.cmd}]`
        );
      }
    }

    const criticalFindings = [];
    if (tablesWithoutRls.rows.length > 0) {
      criticalFindings.push("Public tables with RLS disabled");
    }
    if (definerWithoutSearchPath.rows.length > 0) {
      criticalFindings.push("SECURITY DEFINER functions without fixed search_path");
    }

    if (criticalFindings.length > 0) {
      console.error("Critical findings detected:");
      for (const finding of criticalFindings) {
        console.error(`- ${finding}`);
      }
      process.exit(1);
    }

    console.log("OK: no critical findings detected.");
  } finally {
    await client.end().catch(() => {});
  }
}

runAudit().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
