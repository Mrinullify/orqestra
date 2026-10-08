import "server-only";

import { employeeTools } from "./employees";
import { queryCompanyDataTool } from "./company-data";
import { listDataSourcesTool, inspectDataSourceTool } from "./data-sources";
import type { ToolDefinition, ToolContext } from "@/app/lib/ai/types";
import { requireRole } from "@/app/lib/ai/permissions";
import { ApprovalRequiredError, requireApprovedAction } from "@/app/lib/ai/approvals";

type RegisteredTool = ToolDefinition;

export const toolRegistry = new Map<string, RegisteredTool>(
    [...employeeTools, queryCompanyDataTool, listDataSourcesTool, inspectDataSourceTool].map((tool) => [tool.name, tool]),
);

export async function executeTool(
    name: string,
    rawInput: unknown,
    context: ToolContext,
) {
    const tool = toolRegistry.get(name);
    if (!tool) throw new Error("Unknown tool: " + name);

    requireRole(context, ...tool.allowedRoles);

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) throw new Error("Invalid tool arguments.");

    if (tool.requiresApproval) {
        if (!context.approvalId) throw new ApprovalRequiredError("");
        await requireApprovedAction(context, tool.name);
    }

    return tool.execute(parsed.data, context);
}
