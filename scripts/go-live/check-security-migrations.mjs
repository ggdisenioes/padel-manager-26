import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");

if (!fs.existsSync(migrationsDir)) {
  console.error(`Missing migrations directory: ${migrationsDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith(".sql"))
  .map((d) => d.name)
  .sort();

if (files.length === 0) {
  console.error("No migration files found under supabase/migrations.");
  process.exit(1);
}

const critical = [];
const warnings = [];

function addCritical(file, message) {
  critical.push(`${file}: ${message}`);
}

function addWarning(file, message) {
  warnings.push(`${file}: ${message}`);
}

for (const file of files) {
  const fullPath = path.join(migrationsDir, file);
  const content = fs.readFileSync(fullPath, "utf8");
  const lower = content.toLowerCase();

  // Critical: disabling RLS in migrations can expose data immediately.
  if (/alter\s+table\s+[^;]*\sdisable\s+row\s+level\s+security/gi.test(lower)) {
    addCritical(file, "contains `DISABLE ROW LEVEL SECURITY`");
  }

  // Critical: SECURITY DEFINER views can bypass caller expectations.
  if (/create\s+(or\s+replace\s+)?view[\s\S]*security_definer\s*=\s*true/gi.test(lower)) {
    addCritical(file, "contains SECURITY DEFINER view declaration");
  }

  // Warning: SECURITY DEFINER functions should pin search_path.
  const hasSecurityDefinerFn = /create\s+(or\s+replace\s+)?function[\s\S]*security\s+definer/gi.test(lower);
  if (hasSecurityDefinerFn && !/set\s+search_path\s*=/gi.test(lower)) {
    addWarning(file, "SECURITY DEFINER function without explicit `SET search_path = ...`");
  }

  // Warning: public tables should explicitly enable RLS in same migration.
  const createsPublicTable =
    /create\s+table\s+(if\s+not\s+exists\s+)?public\.[a-z0-9_]+/gi.test(lower);
  const enablesRls = /alter\s+table\s+public\.[a-z0-9_]+\s+enable\s+row\s+level\s+security/gi.test(lower);
  if (createsPublicTable && !enablesRls) {
    addWarning(file, "creates table in `public` but does not enable RLS in same file");
  }
}

if (warnings.length > 0) {
  console.warn("Security migration warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (critical.length > 0) {
  console.error("Security migration check failed:");
  for (const issue of critical) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `OK: ${files.length} migration files scanned. Critical issues: 0. Warnings: ${warnings.length}.`
);
