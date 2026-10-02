import "server-only";

import { employeeTools } from "./employees";
import type { ToolDefinition, ToolContext } from "@/app/lib/ai/types";
import { requireRole } from "@/app/lib/ai/permissions";
import { ApprovalRequiredError, requireApprovedAction } from "@/app/lib/ai/approvals";

export const toolRegistry = new Map<string, ToolDefinition>(
    employeeTools.map((tool) => [tool.name, tool]),
);

export async function executeTool(name: string, rawInput: unknown, context: ToolContext) {
    const tool = toolRegistry.get(name);
    if (!tool) throw new Error("Unknown tool: " + name);

    requireRole(context, ...tool.allowedRoles);

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) throw new Error("Invalid tool arguments.");

    if (tool.requiresApproval) {
        if (!context.approvalId) throw new ApprovalRequiredError("");
        await requireApprovedAction(context, name === "delete_employee" ? "DELETE_EMPLOYEE" : name);
    }

    return tool.execute(parsed.data, context);
}
