// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

type CookieToSet = {
  name: string;
  value: string;
  options?: {
    domain?: string;
    path?: string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    secure?: boolean;
    // `cookie` SerializeOptions allows boolean; NextResponse cookies prefer string.
    sameSite?: boolean | "lax" | "strict" | "none";
  };
};

function isPublicPath(pathname: string) {
  return (
    // Common auth callback / confirm routes
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/auth") ||
    // Next.js assets
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public")
  );
}

function isAdminPath(pathname: string) {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
}

function isNonAdminApiPath(pathname: string) {
  return pathname.startsWith("/api/") && !isAdminPath(pathname);
}

function decodeJwtPayload<T = unknown>(token: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "===".slice((base64.length + 3) % 4);

    const json = atob(padded);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function getClientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for as a comma-separated list. We take the left-most.
  const xff = req.headers.get("x-forwarded-for");
  const ipFromXff = xff?.split(",")[0]?.trim();
  // NextRequest.ip exists in some Next versions/runtimes
  const anyReq = req as unknown as { ip?: string };
  return ipFromXff || anyReq.ip || "0.0.0.0";
}

const rateLimitEnabled = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

// NOTE: These instances are created once per runtime instance (recommended by Upstash)
// and are safe for Edge/Middleware.
const loginRatelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(30, "5 m"),
  prefix: "rl:login",
});

const adminRatelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "rl:admin",
});

function tooManyRequestsResponse(reset: number, asJson: boolean) {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  const headers = new Headers({ "Retry-After": retryAfter.toString() });

  if (asJson) {
    return NextResponse.json(
      { error: "rate_limited", retry_after_seconds: retryAfter },
      { status: 429, headers }
    );
  }

  return new NextResponse("Too many requests", { status: 429, headers });
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // --- Rate limiting (Vercel KV + Upstash Ratelimit) ---
  // Protects /login from brute force and /admin + /api/admin from abuse.
  // If KV env vars aren't configured, this is a no-op.
  if (rateLimitEnabled) {
    const ip = getClientIp(req);

    if (pathname === "/login") {
      const result = await loginRatelimit.limit(`ip:${ip}`);
      if (!result.success) {
        return tooManyRequestsResponse(result.reset, false);
      }
    }

    if (isAdminPath(pathname)) {
      const result = await adminRatelimit.limit(`ip:${ip}`);
      if (!result.success) {
        return tooManyRequestsResponse(result.reset, pathname.startsWith("/api/"));
      }
    }
  }

  // Allow public paths through without touching auth
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // IMPORTANT: Don't block non-admin API routes in middleware.
  // Auth for API routes should be handled inside the route handlers and/or via DB RLS.
  // This prevents login flows (callbacks, token exchange) from being broken.
  if (isNonAdminApiPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail explicitly if env vars are missing
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing Supabase env vars" },
      { status: 500 }
    );
  }

  const res = NextResponse.next();

  // If Supabase refreshes/updates auth cookies during this request, they are written to `res`.
  // When we return a redirect/JSON response, we must carry those cookies over or see login loops.
  const withSupabaseCookies = (out: NextResponse) => {
    res.cookies.getAll().forEach((c) => out.cookies.set(c));
    return out;
  };

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          const sameSite =
            options?.sameSite === true
              ? "strict"
              : options?.sameSite === false
                ? undefined
                : options?.sameSite;

          res.cookies.set({
            name,
            value,
            ...(options ?? {}),
            ...(sameSite ? { sameSite } : {}),
          });
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If the user is already authenticated, never keep them on the login page.
  // This fixes the "logged-in but stuck on /login" state.
  if (pathname === "/login" && user) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return withSupabaseCookies(NextResponse.redirect(url));
  }

  // Not authenticated → redirect to login
  if (!user) {
    // Allow the login page itself to render when unauthenticated
    if (pathname === "/login") {
      return res;
    }

    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return withSupabaseCookies(NextResponse.redirect(url));
  }

  // Prefer JWT custom claims (fast, no DB hit). Fall back to DB if claims aren't present yet.
  type TokenClaims = {
    user_role?: string;
    user_active?: boolean;
    app_metadata?: { user_role?: string; user_active?: boolean };
  };

  const token = session?.access_token;
  const claims = token ? decodeJwtPayload<TokenClaims>(token) : null;

  // Support both top-level and app_metadata placement
  const roleFromToken = claims?.user_role ?? claims?.app_metadata?.user_role;
  const activeFromToken = claims?.user_active ?? claims?.app_metadata?.user_active;

  let role: string | null = typeof roleFromToken === "string" ? roleFromToken : null;
  let active: boolean | null = typeof activeFromToken === "boolean" ? activeFromToken : null;

  // If claims are missing (e.g., before enabling the hook), fall back to DB once.
  if (role === null || active === null) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return withSupabaseCookies(NextResponse.redirect(url));
    }

    role = profile.role ?? null;
    active = profile.active ?? null;
  }

  if (active === false) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("disabled", "1");
    return withSupabaseCookies(NextResponse.redirect(url));
  }

  // Admin routes require admin role
  if (isAdminPath(pathname) && role !== "admin") {
    if (pathname.startsWith("/api/")) {
      return withSupabaseCookies(
        NextResponse.json({ error: "forbidden" }, { status: 403 })
      );
    }

    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("unauthorized", "1");
    return withSupabaseCookies(NextResponse.redirect(url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};