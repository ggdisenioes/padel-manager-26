const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_MANAGER_EMAIL",
  "E2E_MANAGER_PASSWORD",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
];

const missing = required.filter((key) => {
  const value = process.env[key];
  return !value || String(value).trim().length === 0;
});

if (missing.length > 0) {
  console.error("Missing required E2E environment variables:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("OK: E2E required environment variables are present.");
