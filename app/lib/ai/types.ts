import "server-only";

import type { z } from "zod";
import type { OrganizationRole } from "../../../generated/prisma/client";

export interface ServiceContext {
    userId: string;
    organizationId: string;
    role: OrganizationRole;
    requestId: string;
    approvalId?: string;
}

export interface ToolContext extends ServiceContext {
    source: "UI" | "AI";
}

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType, TResult = unknown> {
    name: string;
    description: string;
    inputSchema: TInput;
    requiresApproval?: boolean;
    allowedRoles: OrganizationRole[];
    execute: (input: z.infer<TInput>, context: ToolContext) => Promise<TResult>;
}
