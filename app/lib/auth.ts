import "server-only";
import { auth } from "@/auth";
import { prisma } from "./prisma";
import { redirect } from "next/navigation";

export interface AuthenticatedUserSession {
    userId: string;
    organizationId: string;
    role: "HR" | "EMPLOYEE";
    email: string;
    name: string | null;
}

/**
 * Server-side authentication check using Auth.js.
 * Verifies that:
 * 1. User is authenticated via Auth.js session token.
 * 2. User exists in DB, is active, and still belongs to the organization.
 * Returns the verified user session, or redirects to /login if unauthenticated/invalid.
 */
export async function getVerifiedAuthSession(): Promise<AuthenticatedUserSession> {
    const session = await auth();
    if (!session || !session.user || !session.user.id) {
        redirect("/login");
    }

    // Load current DB state (do not blindly trust token)
    const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            organizationId: true,
            role: true,
        },
    });

    if (!dbUser || !dbUser.isActive) {
        redirect("/login");
    }

    return {
        userId: dbUser.id,
        organizationId: dbUser.organizationId,
        role: dbUser.role,
        email: dbUser.email,
        name: dbUser.name,
    };
}

/**
 * Server-side HR authorization check.
 * Ensures the authenticated user has HR role in their organization.
 * Redirects to /dashboard if user is an EMPLOYEE.
 */
export async function requireHRRole(): Promise<AuthenticatedUserSession> {
    const userSession = await getVerifiedAuthSession();
    if (userSession.role !== "HR") {
        redirect("/dashboard");
    }
    return userSession;
}
