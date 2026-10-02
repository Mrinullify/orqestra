import { NextRequest, NextResponse } from "next/server";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/activate", "/api/auth", "/api/health"];

// Routes that should redirect logged-in users away
const AUTH_ROUTES = ["/login"];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip static assets, API routes for auth/health, and Next internals
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/health") ||
        pathname === "/favicon.ico"
    ) {
        return NextResponse.next();
    }

    // Auth.js session cookies (handles development and production SSL cookies)
    const sessionToken =
        request.cookies.get("authjs.session-token")?.value ||
        request.cookies.get("__Secure-authjs.session-token")?.value ||
        request.cookies.get("next-auth.session-token")?.value ||
        request.cookies.get("__Secure-next-auth.session-token")?.value;

    const isLoggedIn = !!sessionToken;
    const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
    const isAuthRoute = AUTH_ROUTES.some((r) => pathname === r);

    if (isLoggedIn && isAuthRoute) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (!isLoggedIn && !isPublicRoute) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
