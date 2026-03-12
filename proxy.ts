import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "X-DNS-Prefetch-Control": "off",
};

function isMutatingMethod(method: string) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function isSameOrigin(request: NextRequest, originValue: string) {
  try {
    const origin = new URL(originValue);
    const current = new URL(request.url);
    return origin.protocol === current.protocol && origin.host === current.host;
  } catch {
    return false;
  }
}

function withSecurityHeaders(response: NextResponse, request: NextRequest) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return response;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Basic CSRF guard for mutating API requests:
  // - if Origin/Referer is present, it must match current host
  // - if Sec-Fetch-Site explicitly says cross-site, reject
  if (pathname.startsWith("/api/") && isMutatingMethod(req.method)) {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const secFetchSite = req.headers.get("sec-fetch-site");

    if (origin && !isSameOrigin(req, origin)) {
      return withSecurityHeaders(NextResponse.json({ error: "forbidden" }, { status: 403 }), req);
    }

    if (!origin && referer && !isSameOrigin(req, referer)) {
      return withSecurityHeaders(NextResponse.json({ error: "forbidden" }, { status: 403 }), req);
    }

    if (!origin && !referer && secFetchSite === "cross-site") {
      return withSecurityHeaders(NextResponse.json({ error: "forbidden" }, { status: 403 }), req);
    }
  }

  // Protect /super-admin routes server-side
  if (pathname.startsWith("/super-admin") || pathname.startsWith("/api/super-admin")) {
    if (!supabaseUrl || !serviceRoleKey) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), req);
    }

    // Extract access token from cookies (Supabase stores it in sb-*-auth-token)
    const authCookie = req.cookies.getAll().find((c) => c.name.includes("-auth-token"));

    if (!authCookie) {
      return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), req);
    }

    try {
      // Parse the cookie value to get access_token
      let accessToken: string | null = null;
      try {
        const parsed = JSON.parse(authCookie.value);
        accessToken = parsed?.access_token || parsed?.[0]?.access_token || null;
      } catch {
        // Cookie might be base64 encoded or chunked
        const decoded = decodeURIComponent(authCookie.value);
        const parsed = JSON.parse(decoded);
        accessToken = parsed?.access_token || parsed?.[0]?.access_token || null;
      }

      if (!accessToken) {
        return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), req);
      }

      // Verify user with service role
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(accessToken);

      if (error || !user) {
        return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), req);
      }

      // Check role
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || (profile.role !== "super_admin" && profile.role !== "admin")) {
        return withSecurityHeaders(NextResponse.redirect(new URL("/", req.url)), req);
      }
    } catch {
      return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), req);
    }
  }

  return withSecurityHeaders(NextResponse.next(), req);
}

export const config = {
  matcher: ["/super-admin/:path*", "/api/:path*"],
};
