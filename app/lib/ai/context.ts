import "server-only";

import crypto from "crypto";
import { getVerifiedAuthSession, getVerifiedMcpAuthSession } from "@/app/lib/auth";
import type { ToolContext } from "./types";

export async function getToolContext(source: ToolContext["source"]): Promise<ToolContext> {
    const session = source === "MCP"
        ? await getVerifiedMcpAuthSession()
        : await getVerifiedAuthSession();
    return {
        userId: session.userId,
        organizationId: session.organizationId,
        role: session.role,
        requestId: crypto.randomUUID(),
        source,
    };
}
