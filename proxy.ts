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

    if (isPublicPath(pathname)) return NextResponse.next();

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