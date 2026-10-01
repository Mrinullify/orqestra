"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { createSession, deleteSession } from "@/app/lib/session";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const LoginSchema = z.object({
    email: z.string().email({ error: "Please enter a valid email address." }).toLowerCase().trim(),
    password: z.string().min(1, { error: "Password is required." }),
});

export type LoginState =
    | { errors?: { email?: string[]; password?: string[] }; message?: string }
    | undefined;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginAction(state: LoginState, formData: FormData): Promise<LoginState> {
    const raw = {
        email: formData.get("email"),
        password: formData.get("password"),
    };

    const parsed = LoginSchema.safeParse(raw);
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    const { email, password } = parsed.data;

    // Generic error to prevent account enumeration
    const invalidMsg = "Invalid email or password.";

    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            passwordHash: true,
            isActive: true,
            organizationId: true,
            memberships: {
                select: { role: true, organizationId: true },
                take: 1,
            },
        },
    });

    if (!user || !user.passwordHash) {
        return { message: invalidMsg };
    }

    if (!user.isActive) {
        return { message: "Your account has not been activated yet. Please check your invitation email." };
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
        return { message: invalidMsg };
    }

    const membership = user.memberships[0];
    if (!membership) {
        return { message: "Your account is not associated with any organization." };
    }

    await createSession({
        userId: user.id,
        organizationId: membership.organizationId,
        role: membership.role,
    });

    redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutAction(): Promise<void> {
    await deleteSession();
    redirect("/login");
}
