import "server-only";

import { prisma } from "@/app/lib/prisma";
import { requireHR } from "./permissions";
import type { ServiceContext } from "./types";

export class ApprovalRequiredError extends Error {
    constructor(public readonly approvalId: string) {
        super("This action requires explicit approval before execution.");
        this.name = "ApprovalRequiredError";
    }
}

export async function createActionApproval(params: {
    context: ServiceContext;
    action: string;
    resourceType: string;
    resourceId?: string;
    payload?: object;
    expiresInMinutes?: number;
}) {
    requireHR(params.context);

    const expiresAt = new Date(Date.now() + (params.expiresInMinutes ?? 10) * 60 * 1000);

    return prisma.actionApproval.create({
        data: {
            organizationId: params.context.organizationId,
            requestedById: params.context.userId,
            action: params.action,
            resourceType: params.resourceType,
            resourceId: params.resourceId,
            payload: params.payload,
            expiresAt,
        },
    });
}

export async function approveAction(context: ServiceContext, approvalId: string) {
    requireHR(context);

    const approval = await prisma.actionApproval.findFirst({
        where: {
            id: approvalId,
            organizationId: context.organizationId,
            requestedById: context.userId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
        },
    });

    if (!approval) throw new Error("Approval not found, expired, or already resolved.");

    return prisma.actionApproval.update({
        where: { id: approval.id },
        data: { status: "APPROVED", approvedAt: new Date() },
    });
}

export async function requireApprovedAction(context: ServiceContext, action: string) {
    requireHR(context);

    if (!context.approvalId) throw new ApprovalRequiredError("");

    const approval = await prisma.actionApproval.findFirst({
        where: {
            id: context.approvalId,
            organizationId: context.organizationId,
            requestedById: context.userId,
            action,
            status: "APPROVED",
            expiresAt: { gt: new Date() },
        },
    });

    if (!approval) throw new ApprovalRequiredError(context.approvalId);
}
