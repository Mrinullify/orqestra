import "server-only";

import { createMcpHandler } from "@modelcontextprotocol/server";

import { createOrqestraMcpServer } from "@/app/mcp/server";

export const runtime = "nodejs";

const handler = createMcpHandler(() => createOrqestraMcpServer());

export async function GET(request: Request) {
    return handler.fetch(request);
}

export async function POST(request: Request) {
    return handler.fetch(request);
}

export async function DELETE(request: Request) {
    return handler.fetch(request);
}
