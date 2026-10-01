"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { sendActivationConfirmationEmail } from "@/app/lib/email";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ActivateSchema = z.object({
    token: z.string().min(1),
    password: z
        .string()
        .min(8, { error: "Password must be at least 8 characters." })
        .regex(/[a-zA-Z]/, { error: "Password must contain at least one letter." })
        .regex(/[0-9]/, { error: "Password must contain at least one number." }),
    confirmPassword: z.string().min(1),
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
// Activate
// ---------------------------------------------------------------------------

export async function activateAction(state: ActivateState, formData: FormData): Promise<ActivateState> {
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

    const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
        include: { organization: { select: { name: true } } },
    });

    if (!invitation) {
        return { message: "This invitation link is invalid or has already been used." };
    }

    if (invitation.status === "ACCEPTED") {
        return { message: "This invitation has already been accepted. Please log in." };
    }

    if (invitation.status === "REVOKED") {
        return { message: "This invitation has been revoked. Please contact your HR team." };
    }

    if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
        // Mark expired if not already
        if (invitation.status !== "EXPIRED") {
            await prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: "EXPIRED" },
            });
        }
        return { message: "This invitation has expired. Please ask your HR team for a new one." };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Upsert user and create/confirm membership in a transaction
    await prisma.$transaction(async (tx) => {
        // Find or create user
        let user = await tx.user.findUnique({ where: { email: invitation.email } });

        if (!user) {
            user = await tx.user.create({
                data: {
                    email: invitation.email,
                    passwordHash,
                    isActive: true,
                    organizationId: invitation.organizationId,
                },
            });
        } else {
            await tx.user.update({
                where: { id: user.id },
                data: { passwordHash, isActive: true },
            });
        }

        // Upsert membership
        await tx.membership.upsert({
            where: {
                userId_organizationId: {
                    userId: user.id,
                    organizationId: invitation.organizationId,
                },
            },
            create: {
                userId: user.id,
                organizationId: invitation.organizationId,
                role: invitation.role,
            },
            update: {},
        });

        // Mark invitation accepted
        await tx.invitation.update({
            where: { id: invitation.id },
            data: {
                status: "ACCEPTED",
                acceptedAt: new Date(),
            },
        });
    });

    // Send confirmation email (best-effort, don't fail activation)
    try {
        const user = await prisma.user.findUnique({ where: { email: invitation.email }, select: { name: true } });
        await sendActivationConfirmationEmail({
            toEmail: invitation.email,
            toName: user?.name ?? null,
            organizationName: invitation.organization.name,
        });
    } catch {
        // ignore
    }

    redirect("/login?activated=1");
}
