import "server-only";

import { prisma } from "@/app/lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";
import type { ServiceContext } from "./types";

export async function writeAuditLog(params: {
    context: ServiceContext;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Prisma.InputJsonValue;
    success?: boolean;
}): Promise<void> {
    await prisma.auditLog.create({
        data: {
            organizationId: params.context.organizationId,
            actorId: params.context.userId,
            action: params.action,
            resourceType: params.resourceType,
            resourceId: params.resourceId,
            metadata: params.metadata,
            success: params.success ?? true,
            requestId: params.context.requestId,
        },
    });
}
