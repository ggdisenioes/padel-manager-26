// proxy.ts
import { NextRequest, NextResponse } from "next/server";

function isPublicPath(pathname: string) {
  return (
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/public") ||
    pathname === "/" ||
    pathname.startsWith("/login")
  );
}

export async function proxy(req: NextRequest) {
  try {
    const pathname = req.nextUrl.pathname;
    const host = req.headers.get("host") || "";

    // Rutas públicas siempre permitidas
    if (isPublicPath(pathname)) return NextResponse.next();

    // Endpoints de setup (públicos para configuración inicial)
    if (pathname.startsWith("/api/setup")) return NextResponse.next();

    // Si es un subdominio y no es /login, redirigir a padelx.es/login
    const isSubdomain = host.includes(".padelx.es") && !host.startsWith("padelx.es");
    if (isSubdomain && pathname !== "/login") {
      // Intentar obtener la sesión
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !anonKey) {
        return NextResponse.redirect(new URL("/login", req.url));
      }

      // Si no hay cookie de sesión, redirigir al login principal
      const hasSession = req.cookies.get("sb-session") || req.cookies.get("sb-auth-token");
      if (!hasSession) {
        // Redirigir a padelx.es/login con returnTo
        const loginUrl = new URL("https://padelx.es/login");
        loginUrl.searchParams.set("returnTo", `${host}${pathname}`);
        return NextResponse.redirect(loginUrl);
      }
    }

    // Permitir rutas protegidas (la protección se hace en el layout)
    if (pathname.startsWith("/admin")) return NextResponse.next();
    if (pathname.startsWith("/super-admin")) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.next();

    return NextResponse.next();
  } catch (err) {
    console.error("PROXY_FATAL:", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};