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
    pathname.startsWith("/login") ||
    pathname.startsWith("/dashboard")
  );
}

export async function middleware(req: NextRequest) {
  try {
    const pathname = req.nextUrl.pathname;
    const host = req.headers.get("host") || "";

    // Rutas públicas siempre permitidas
    if (isPublicPath(pathname)) return NextResponse.next();

    // Endpoints de setup (públicos para configuración inicial)
    if (pathname.startsWith("/api/setup")) return NextResponse.next();

    // Si es un subdominio y no es /login, verificar sesión
    const isSubdomain = host.includes(".padelx.es") && !host.startsWith("padelx.es");
    if (isSubdomain && pathname !== "/login") {
      // Si no hay cookie de sesión, redirigir al login principal
      const hasSession = req.cookies.get("sb-") || req.headers.get("authorization");
      if (!hasSession) {
        // Redirigir a padelx.es/login con returnTo de forma segura
        const fullUrl = `https://${host}${pathname}${req.nextUrl.search}`;
        const loginUrl = new URL("https://padelx.es/login");
        loginUrl.searchParams.set("returnTo", fullUrl);
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