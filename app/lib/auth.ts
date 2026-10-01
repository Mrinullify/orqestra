import "server-only";
import { prisma } from "./prisma";
import { getSession } from "./session";
import { redirect } from "next/navigation";

export interface AuthorizedSession {
    userId: string;
    organizationId: string;
    role: "HR" | "EMPLOYEE";
}

/**
 * Returns the current session after validating the user still exists and
 * belongs to the organization in the session token. Redirects to /login if invalid.
 */
export async function getVerifiedSession(): Promise<AuthorizedSession> {
    const session = await getSession();
    if (!session) redirect("/login");

    // Verify the membership still exists in the DB (not just trusting the token)
    const membership = await prisma.membership.findUnique({
        where: {
            userId_organizationId: {
                userId: session.userId,
                organizationId: session.organizationId,
            },
        },
        select: { role: true },
    });

    if (!membership) redirect("/login");

    return {
        userId: session.userId,
        organizationId: session.organizationId,
        role: membership.role,
    };
}

/**
 * Requires an authenticated session and HR role. Redirects otherwise.
 */
export async function requireHRSession(): Promise<AuthorizedSession> {
    const auth = await getVerifiedSession();
    if (auth.role !== "HR") redirect("/dashboard");
    return auth;
}

/**
 * Checks if an email already has an active membership in the given org.
 */
export async function emailHasMembership(email: string, organizationId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            memberships: {
                where: { organizationId },
                select: { id: true },
            },
        },
    });
    return (user?.memberships.length ?? 0) > 0;
}
