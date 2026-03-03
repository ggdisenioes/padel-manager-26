import { createClient } from "@supabase/supabase-js";

// IMPORTANT:
// - No rompemos el build si faltan env vars (Vercel/Next puede evaluar módulos en build).
// - En runtime real, estas vars deben estar configuradas, pero usamos fallback para evitar
//   errores tipo "supabaseUrl is required" durante prerender.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";
const SUPABASE_FETCH_MAX_RETRIES = Number(process.env.NEXT_PUBLIC_SUPABASE_FETCH_MAX_RETRIES || "2");
const SUPABASE_FETCH_RETRY_BASE_MS = Number(process.env.NEXT_PUBLIC_SUPABASE_FETCH_RETRY_BASE_MS || "300");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const maxRetries = Math.max(0, SUPABASE_FETCH_MAX_RETRIES);
  const retryBaseMs = Math.max(50, SUPABASE_FETCH_RETRY_BASE_MS);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!shouldRetryStatus(response.status) || attempt === maxRetries) {
        return response;
      }

      const retryAfterHeader = Number(response.headers.get("retry-after") || "0");
      const retryAfterMs = Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : 0;
      const delayMs = Math.max(retryAfterMs, retryBaseMs * (attempt + 1));
      await sleep(delayMs);
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (isAbort || attempt === maxRetries) throw error;
      await sleep(retryBaseMs * (attempt + 1));
    }
  }

  return fetch(input, init);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: resilientFetch,
  },
});
