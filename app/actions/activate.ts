"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { sendActivationConfirmationEmail } from "@/app/lib/email";
import { checkRateLimit, RATE_LIMITS } from "@/app/lib/rate-limit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ActivateSchema = z.object({
    token: z.string().min(1, "Invitation token is missing."),
    password: z
        .string()
        .min(8, "Password must be at least 8 characters long.")
        .regex(/[a-zA-Z]/, "Password must contain at least one letter.")
        .regex(/[0-9]/, "Password must contain at least one number."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
});

export type ActivateState =
    | { errors?: { password?: string[]; confirmPassword?: string[] }; message?: string; success?: boolean }
    | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Activate Account Action (Atomic & Rate Limited)
// ---------------------------------------------------------------------------

export async function activateAction(state: ActivateState, formData: FormData): Promise<ActivateState> {
    const reqHeaders = await headers();
    const ip = reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const rlKey = `activate:${ip}`;

    const rl = await checkRateLimit(
        rlKey,
        RATE_LIMITS.ACTIVATION.maxRequests,
        RATE_LIMITS.ACTIVATION.windowSeconds
    );

    if (!rl.success) {
        return { message: "Too many activation attempts. Please wait a minute before trying again." };
    }

    const raw = {
        token: formData.get("token"),
        password: formData.get("password"),
        confirmPassword: formData.get("confirmPassword"),
    };

    const parsed = ActivateSchema.safeParse(raw);
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    const { token, password, confirmPassword } = parsed.data;

    if (password !== confirmPassword) {
        return { errors: { confirmPassword: ["Passwords do not match."] } };
    }

    const tokenHash = hashToken(token);

    // Initial check of invitation
    const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
        include: { organization: { select: { name: true } } },
    });

    if (!invitation) {
        return { message: "This invitation link is invalid or does not exist." };
    }

    if (invitation.status === "ACCEPTED") {
        return { message: "This invitation has already been accepted. Please log in." };
    }

    if (invitation.status === "REVOKED") {
        return { message: "This invitation has been revoked. Please contact your HR team." };
    }

    if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
        if (invitation.status !== "EXPIRED") {
            await prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: "EXPIRED" },
            });
        }
        return { message: "This invitation has expired. Please ask your HR team for a new one." };
    }

    // Hash user's password securely
    const passwordHash = await bcrypt.hash(password, 12);

    let activationErrorMessage: string | null = null;

    try {
        // Atomic transaction prevents double-activation and enforces single-organization rule
        await prisma.$transaction(async (tx) => {
            // Re-fetch invitation with row lock / transaction isolation
            const currentInv = await tx.invitation.findUnique({
                where: { id: invitation.id },
            });

            if (!currentInv || currentInv.status === "ACCEPTED") {
                activationErrorMessage = "This invitation has already been used.";
                throw new Error("ALREADY_ACCEPTED");
            }

            if (currentInv.status === "REVOKED") {
                activationErrorMessage = "This invitation has been revoked.";
                throw new Error("REVOKED");
            }

            // Check if user already exists
            const existingUser = await tx.user.findUnique({
                where: { email: currentInv.email },
            });

            // Single Organization Constraint Guard
            if (existingUser && existingUser.organizationId !== currentInv.organizationId) {
                activationErrorMessage = "This email address is already registered with another organization.";
                throw new Error("OTHER_ORGANIZATION");
            }

            if (existingUser) {
                // Activate existing user in this org
                await tx.user.update({
                    where: { id: existingUser.id },
                    data: {
                        passwordHash,
                        isActive: true,
                        role: currentInv.role,
                    },
                });
            } else {
                // Create user in this org
                await tx.user.create({
                    data: {
                        email: currentInv.email,
                        passwordHash,
                        isActive: true,
                        role: currentInv.role,
                        organizationId: currentInv.organizationId,
                    },
                });
            }

            // Mark invitation accepted atomically
            await tx.invitation.update({
                where: { id: currentInv.id },
                data: {
                    status: "ACCEPTED",
                    acceptedAt: new Date(),
                },
            });
        });
    } catch (err) {
        if (activationErrorMessage) {
            return { message: activationErrorMessage };
        }
        return { message: "Account activation failed. Please try again." };
    }

    // Best-effort confirmation email
    try {
        const user = await prisma.user.findUnique({
            where: { email: invitation.email },
            select: { name: true },
        });
        await sendActivationConfirmationEmail({
            toEmail: invitation.email,
            toName: user?.name ?? null,
            organizationName: invitation.organization.name,
        });
    } catch {
        // Ignore background email notification failure after account setup
    }

    redirect("/login?activated=1");
}
