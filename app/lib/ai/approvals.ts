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

export async function requireApprovedAction(
    context: ServiceContext,
    action: string,
): Promise<void> {
    requireHR(context);

    if (!context.approvalId) {
        throw new ApprovalRequiredError("");
    }

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

    if (!approval) {
        throw new ApprovalRequiredError(context.approvalId);
    }
}
