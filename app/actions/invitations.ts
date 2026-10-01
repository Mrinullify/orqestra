"use server";

import { z } from "zod";
import crypto from "crypto";
import { requireHRSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { sendInvitationEmail } from "@/app/lib/email";

const INVITATION_EXPIRY_HOURS = Number(process.env.INVITATION_EXPIRY_HOURS ?? "24");
const MAX_BATCH_SIZE = Number(process.env.MAX_INVITATION_BATCH ?? "500");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmployeeRow {
    name: string;
    email: string;
    department: string;
}

export interface ValidationResult {
    valid: EmployeeRow[];
    errors: Array<{ row: number; email: string; reason: string }>;
    duplicateEmails: string[];
    existingMembers: string[];
}

export type InviteState =
    | { errors?: string[]; message?: string; success?: boolean; count?: number }
    | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Validate parsed CSV rows
// ---------------------------------------------------------------------------

export async function validateEmployeeRows(
    rows: EmployeeRow[],
    organizationId: string
): Promise<ValidationResult> {
    const emailSchema = z.string().email();
    const seen = new Set<string>();
    const duplicateEmails: string[] = [];
    const validRows: EmployeeRow[] = [];
    const errors: ValidationResult["errors"] = [];

    const limitedRows = rows.slice(0, MAX_BATCH_SIZE);

    for (let i = 0; i < limitedRows.length; i++) {
        const row = limitedRows[i];
        const email = normalizeEmail(row.email ?? "");
        const name = (row.name ?? "").trim();

        if (!email) {
            errors.push({ row: i + 1, email: row.email, reason: "Missing email" });
            continue;
        }

        const emailValid = emailSchema.safeParse(email);
        if (!emailValid.success) {
            errors.push({ row: i + 1, email, reason: "Invalid email address" });
            continue;
        }

        if (!name) {
            errors.push({ row: i + 1, email, reason: "Missing employee name" });
            continue;
        }

        if (seen.has(email)) {
            duplicateEmails.push(email);
            errors.push({ row: i + 1, email, reason: "Duplicate email in upload" });
            continue;
        }

        seen.add(email);
        validRows.push({ ...row, email, name });
    }

    // Check DB for existing memberships
    const validEmails = validRows.map((r) => r.email);
    const existingUsers = await prisma.user.findMany({
        where: { email: { in: validEmails } },
        select: {
            email: true,
            memberships: {
                where: { organizationId },
                select: { id: true },
            },
        },
    });

    const existingMembers: string[] = [];
    const filteredValid: EmployeeRow[] = [];

    for (const row of validRows) {
        const existing = existingUsers.find((u) => u.email === row.email);
        if (existing && existing.memberships.length > 0) {
            existingMembers.push(row.email);
            errors.push({ row: validRows.indexOf(row) + 1, email: row.email, reason: "Already a member of this organization" });
        } else {
            filteredValid.push(row);
        }
    }

    return { valid: filteredValid, errors, duplicateEmails, existingMembers };
}

// ---------------------------------------------------------------------------
// Create invitations (HR-only, after confirmation)
// ---------------------------------------------------------------------------

export async function createBulkInvitationsAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    const auth = await requireHRSession();

    const rawJson = formData.get("employees");
    if (typeof rawJson !== "string") {
        return { errors: ["Invalid request."] };
    }

    let employees: EmployeeRow[];
    try {
        employees = JSON.parse(rawJson) as EmployeeRow[];
    } catch {
        return { errors: ["Could not parse employee data."] };
    }

    if (!Array.isArray(employees) || employees.length === 0) {
        return { errors: ["No valid employees to invite."] };
    }

    if (employees.length > MAX_BATCH_SIZE) {
        return { errors: [`Maximum ${MAX_BATCH_SIZE} employees per batch.`] };
    }

    const hr = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { organization: true },
    });
    if (!hr) return { errors: ["Your account was not found."] };

    let successCount = 0;
    const failures: string[] = [];

    // Process each employee
    for (const emp of employees) {
        const email = normalizeEmail(emp.email);
        const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);
        const token = generateToken();
        const tokenHash = hashToken(token);

        try {
            // Upsert user record (create if not exists)
            await prisma.$transaction(async (tx) => {
                let user = await tx.user.findUnique({ where: { email } });
                if (!user) {
                    user = await tx.user.create({
                        data: {
                            email,
                            name: emp.name,
                            department: emp.department,
                            organizationId: auth.organizationId,
                            isActive: false,
                        },
                    });
                } else {
                    await tx.user.update({
                        where: { id: user.id },
                        data: { name: emp.name, department: emp.department },
                    });
                }

                // Expire any existing pending/sent invitations for this email+org
                await tx.invitation.updateMany({
                    where: {
                        email,
                        organizationId: auth.organizationId,
                        status: { in: ["PENDING", "SENT"] },
                    },
                    data: { status: "EXPIRED" },
                });

                // Create the new invitation
                await tx.invitation.create({
                    data: {
                        email,
                        organizationId: auth.organizationId,
                        invitedById: auth.userId,
                        tokenHash,
                        role: "EMPLOYEE",
                        expiresAt,
                        status: "PENDING",
                    },
                });
            });

            // Send invitation email
            const emailResult = await sendInvitationEmail({
                toEmail: email,
                toName: emp.name,
                organizationName: hr.organization.name,
                invitationToken: token,
            });

            // Update invitation status based on email result
            const invitation = await prisma.invitation.findFirst({
                where: { tokenHash },
                select: { id: true },
            });

            if (invitation) {
                await prisma.invitation.update({
                    where: { id: invitation.id },
                    data: {
                        status: emailResult.success ? "SENT" : "FAILED",
                        sentAt: emailResult.success ? new Date() : null,
                        failureReason: emailResult.success ? null : emailResult.error,
                    },
                });
            }

            successCount++;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            failures.push(`${email}: ${message}`);
        }
    }

    if (failures.length > 0) {
        return {
            success: true,
            count: successCount,
            message: `${successCount} invitation(s) sent. ${failures.length} failed.`,
            errors: failures,
        };
    }

    return { success: true, count: successCount };
}

// ---------------------------------------------------------------------------
// Resend invitation (HR-only)
// ---------------------------------------------------------------------------

export async function resendInvitationAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    const auth = await requireHRSession();

    const invitationId = formData.get("invitationId");
    if (typeof invitationId !== "string") return { errors: ["Invalid request."] };

    const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
        include: { organization: { select: { name: true } } },
    });

    if (!invitation || invitation.organizationId !== auth.organizationId) {
        return { errors: ["Invitation not found."] };
    }

    if (invitation.status === "ACCEPTED") {
        return { errors: ["This invitation has already been accepted."] };
    }

    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);
    const token = generateToken();
    const tokenHash = hashToken(token);

    await prisma.invitation.update({
        where: { id: invitationId },
        data: {
            tokenHash,
            expiresAt,
            status: "PENDING",
            sentAt: null,
            failureReason: null,
        },
    });

    const user = await prisma.user.findUnique({ where: { email: invitation.email }, select: { name: true } });
    const emailResult = await sendInvitationEmail({
        toEmail: invitation.email,
        toName: user?.name ?? null,
        organizationName: invitation.organization.name,
        invitationToken: token,
    });

    await prisma.invitation.update({
        where: { id: invitationId },
        data: {
            status: emailResult.success ? "SENT" : "FAILED",
            sentAt: emailResult.success ? new Date() : null,
            failureReason: emailResult.success ? null : emailResult.error,
        },
    });

    if (!emailResult.success) {
        return { errors: [`Failed to send email: ${emailResult.error}`] };
    }

    return { success: true };
}

// ---------------------------------------------------------------------------
// Revoke invitation (HR-only)
// ---------------------------------------------------------------------------

export async function revokeInvitationAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    const auth = await requireHRSession();

    const invitationId = formData.get("invitationId");
    if (typeof invitationId !== "string") return { errors: ["Invalid request."] };

    const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
        select: { organizationId: true, status: true },
    });

    if (!invitation || invitation.organizationId !== auth.organizationId) {
        return { errors: ["Invitation not found."] };
    }

    if (invitation.status === "ACCEPTED") {
        return { errors: ["Cannot revoke an accepted invitation."] };
    }

    await prisma.invitation.update({
        where: { id: invitationId },
        data: { status: "REVOKED", revokedAt: new Date() },
    });

    return { success: true };
}
