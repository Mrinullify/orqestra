import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/activate"];

// Routes that should redirect logged-in users away
const AUTH_ROUTES = ["/login"];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip static assets and Next internals
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api/health") ||
        pathname === "/favicon.ico"
    ) {
        return NextResponse.next();
    }

    const sessionCookie = request.cookies.get("orqestra_session")?.value;
    const session = sessionCookie ? await decrypt(sessionCookie) : null;
    const isLoggedIn = session !== null && new Date(session.expiresAt) > new Date();

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
