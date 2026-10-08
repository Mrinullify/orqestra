"use server";

import { z } from "zod";
import crypto from "crypto";
import { headers } from "next/headers";
import { requireHRRole } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { invitationQueue } from "@/app/lib/queue";
import { checkRateLimit, RATE_LIMITS } from "@/app/lib/rate-limit";

const INVITATION_EXPIRY_HOURS = Number(process.env.INVITATION_EXPIRY_HOURS ?? "24");
const MAX_BATCH_SIZE = Number(process.env.MAX_INVITATION_BATCH ?? "500");

import {
    BulkEmployeeBatchSchema,
    EmployeeItemSchema,
    type EmployeeRow,
    type InviteState,
} from "@/app/lib/validation/invitations";
import type { ValidationResult } from "@/app/lib/validation/invitations";

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
// Server-Side Employee Input Validation
// ---------------------------------------------------------------------------

export async function validateEmployeeRowsServer(
    rows: EmployeeRow[],
    organizationId: string
): Promise<ValidationResult> {
    const seen = new Set<string>();
    const duplicateEmails: string[] = [];
    const validRows: EmployeeRow[] = [];
    const errors: ValidationResult["errors"] = [];

    const limitedRows = rows.slice(0, MAX_BATCH_SIZE);

    for (let i = 0; i < limitedRows.length; i++) {
        const rawRow = limitedRows[i];
        const parsed = EmployeeItemSchema.safeParse(rawRow);

        if (!parsed.success) {
            const firstErr = parsed.error.issues[0]?.message ?? "Invalid input data";
            errors.push({ row: i + 1, email: rawRow?.email ?? "", reason: firstErr });
            continue;
        }

        const { name, email, department } = parsed.data;

        if (seen.has(email)) {
            duplicateEmails.push(email);
            errors.push({ row: i + 1, email, reason: "Duplicate email in batch" });
            continue;
        }

        seen.add(email);
        validRows.push({ name, email, department });
    }

    // Server DB Check across ALL organizations
    const validEmails = validRows.map((r) => r.email);
    const existingUsers = await prisma.user.findMany({
        where: { email: { in: validEmails } },
        select: {
            email: true,
            organizationId: true,
            isActive: true,
        },
    });

    const existingMembers: string[] = [];
    const otherOrgEmails: string[] = [];
    const filteredValid: EmployeeRow[] = [];

    for (const row of validRows) {
        const existing = existingUsers.find((u) => u.email === row.email);

        if (existing) {
            if (existing.organizationId !== organizationId) {
                otherOrgEmails.push(row.email);
                errors.push({
                    row: validRows.indexOf(row) + 1,
                    email: row.email,
                    reason: "Email belongs to another organization",
                });
            } else if (existing.isActive) {
                existingMembers.push(row.email);
                errors.push({
                    row: validRows.indexOf(row) + 1,
                    email: row.email,
                    reason: "Already an active member of this organization",
                });
            } else {
                // User exists in this org but is inactive (pending invitation) - allow re-invite
                filteredValid.push(row);
            }
        } else {
            filteredValid.push(row);
        }
    }

    return {
        valid: filteredValid,
        errors,
        duplicateEmails,
        existingMembers,
        otherOrgEmails,
    };
}

// ---------------------------------------------------------------------------
// Create Bulk Invitations (HR-only, Background Jobs)
// ---------------------------------------------------------------------------

export async function createBulkInvitationsAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    // 1. Server-side HR authorization check
    const auth = await requireHRRole();

    // 2. Rate Limiting Check
    const reqHeaders = await headers();
    const ip = reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const rlKey = `bulk-invite:${auth.userId}:${auth.organizationId}`;

    const rl = await checkRateLimit(
        rlKey,
        RATE_LIMITS.BULK_INVITE.maxRequests,
        RATE_LIMITS.BULK_INVITE.windowSeconds
    );

    if (!rl.success) {
        return {
            errors: [`Rate limit exceeded. Please wait ${rl.reset - Math.floor(Date.now() / 1000)} seconds.`],
        };
    }

    // 3. Parse input JSON
    const rawJson = formData.get("employees");
    if (typeof rawJson !== "string") {
        return { errors: ["Invalid request payload."] };
    }

    let parsedRows: unknown;
    try {
        parsedRows = JSON.parse(rawJson);
    } catch {
        return { errors: ["Could not parse employee JSON payload."] };
    }

    // 4. Server Zod validation
    const batchParse = BulkEmployeeBatchSchema.safeParse(parsedRows);
    if (!batchParse.success) {
        const errMsgs = batchParse.error.issues.map((issue) => issue.message);
        return { errors: errMsgs };
    }

    const inputEmployees = batchParse.data;

    // 5. Full server DB validation (no trusting client)
    const validation = await validateEmployeeRowsServer(inputEmployees, auth.organizationId);

    if (validation.valid.length === 0) {
        return { errors: ["No valid employees to invite after server validation."] };
    }

    const validEmployees = validation.valid;
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

    const jobsToEnqueue: Array<{ invitationId: string; token: string }> = [];

    // 6. DB operations in transaction (User + Invitation creation only, NO synchronous emails)
    await prisma.$transaction(async (tx) => {
        for (const emp of validEmployees) {
            const email = normalizeEmail(emp.email);
            const token = generateToken();
            const tokenHash = hashToken(token);

            // Upsert user (role forced strictly to EMPLOYEE, organizationId forced strictly from server session)
            let user = await tx.user.findUnique({ where: { email } });
            if (!user) {
                user = await tx.user.create({
                    data: {
                        email,
                        name: emp.name,
                        department: emp.department,
                        organizationId: auth.organizationId,
                        role: "EMPLOYEE", // FORCED ROLE
                        isActive: false,
                    },
                });
            } else if (user.organizationId === auth.organizationId) {
                await tx.user.update({
                    where: { id: user.id },
                    data: {
                        name: emp.name,
                        department: emp.department,
                        role: "EMPLOYEE",
                    },
                });
            }

            // Expire previous pending/sent invitations for this email in this org
            await tx.invitation.updateMany({
                where: {
                    email,
                    organizationId: auth.organizationId,
                    status: { in: ["PENDING", "QUEUED", "SENT"] },
                },
                data: { status: "EXPIRED" },
            });

            // Create Invitation record with status QUEUED
            const invitation = await tx.invitation.create({
                data: {
                    email,
                    organizationId: auth.organizationId,
                    invitedById: auth.userId,
                    tokenHash,
                    role: "EMPLOYEE", // FORCED ROLE
                    expiresAt,
                    status: "QUEUED",
                },
            });

            jobsToEnqueue.push({ invitationId: invitation.id, token });
        }
    });

    // 7. Enqueue background jobs asynchronously (returns instantly!)
    invitationQueue.enqueueBatch(jobsToEnqueue);

    return {
        success: true,
        count: jobsToEnqueue.length,
        message: `${jobsToEnqueue.length} invitation(s) queued for processing.`,
    };
}

// ---------------------------------------------------------------------------
// Resend Invitation Action (HR-only, Background Worker)
// ---------------------------------------------------------------------------

export async function resendInvitationAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    const auth = await requireHRRole();

    const invitationId = formData.get("invitationId");
    if (typeof invitationId !== "string") return { errors: ["Invalid request."] };

    // Rate Limiting
    const rlKey = `resend:${auth.userId}:${invitationId}`;
    const rl = await checkRateLimit(
        rlKey,
        RATE_LIMITS.RESEND.maxRequests,
        RATE_LIMITS.RESEND.windowSeconds
    );

    if (!rl.success) {
        return { errors: ["Resend rate limit reached. Please wait before retrying."] };
    }

    // Tenant Isolation Check
    const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
        select: { id: true, organizationId: true, status: true, email: true },
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

    // Idempotent update: update existing invitation record
    await prisma.invitation.update({
        where: { id: invitationId },
        data: {
            tokenHash,
            expiresAt,
            status: "QUEUED",
            sentAt: null,
            failureReason: null,
        },
    });

    // Enqueue background job
    invitationQueue.enqueue({ invitationId, token });

    return { success: true, message: "Invitation resend enqueued." };
}

// ---------------------------------------------------------------------------
// Revoke Invitation Action (HR-only)
// ---------------------------------------------------------------------------

export async function revokeInvitationAction(
    state: InviteState,
    formData: FormData
): Promise<InviteState> {
    const auth = await requireHRRole();

    const invitationId = formData.get("invitationId");
    if (typeof invitationId !== "string") return { errors: ["Invalid request."] };

    const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
        select: { id: true, organizationId: true, status: true },
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
