import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateResponse, type LlmMessage, type LlmTool } from "@/app/ai/llm/client";
import { toolRegistry, executeTool } from "@/app/ai/tools";
import { getToolContext } from "@/app/lib/ai/context";
import { ApprovalRequiredError } from "@/app/lib/ai/approvals";

const requestSchema = z.object({
    message: z.string().trim().min(1).max(4000),
    messages: z
        .array(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().trim().min(1).max(4000),
            }),
        )
        .max(20)
        .default([]),
});

const AI_READ_ONLY_TOOLS = new Set([
    "list_employees",
    "find_employee",
    "query_company_data",
]);

const systemPrompt = `
You are Orqestra Copilot, an internal business operations assistant.

Rules:
- Use available tools when the user's request can be fulfilled by a tool.
- Never invent employee or company data.
- You only have access to the authenticated user's organization.
- Never ask the user for organization IDs, user IDs, database credentials, or internal secrets.
- Do not claim an action succeeded unless the tool result confirms it.
- The currently available AI tools are read-only. Do not claim to have changed or deleted data.
- For questions about uploaded CSV/Excel data (including salary, department, name, counts, or other imported columns), ALWAYS use query_company_data. Do not use list_employees or find_employee for values that come from uploaded company data.
- For a person lookup in uploaded data, use query_company_data with search set to the person name, such as search="Aman".
- Use filters with the uploaded column name and value for exact matching.
- For broad text lookup, use search.
- For unsupported requests, explain what is currently supported.
- Keep responses concise and useful.
`.trim();

function schemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    const zAny = schema as unknown as {
        toJSONSchema?: () => Record<string, unknown>;
    };

    if (!zAny.toJSONSchema) {
        throw new Error("Tool schema cannot be converted to JSON Schema.");
    }

    return zAny.toJSONSchema();
}

function buildToolDefinitions(): LlmTool[] {
    return Array.from(toolRegistry.values())
        .filter((tool) => AI_READ_ONLY_TOOLS.has(tool.name))
        .map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: schemaToJsonSchema(tool.inputSchema),
            },
        }));
}

function safeToolError(error: unknown): string {
    if (error instanceof ApprovalRequiredError) {
        return "This action requires explicit approval before it can be executed.";
    }

    if (error instanceof Error) {
        const safeMessages = new Set([
            "Employee not found.",
            "Data source not found.",
            "employeeId or email is required.",
            "Invalid tool arguments.",
            "You are not authorized to perform this action.",
        ]);

        if (safeMessages.has(error.message)) {
            return error.message;
        }
    }

    return "Tool execution failed.";
}

export async function POST(request: Request) {
    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON request body." },
            { status: 400 },
        );
    }

    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request. message is required." },
            { status: 400 },
        );
    }

    const context = await getToolContext("AI");

    try {
        const conversation: LlmMessage[] = parsed.data.messages.map((message) => ({
            role: message.role,
            content: message.content,
        }));

        const messages: LlmMessage[] = [
            { role: "system", content: systemPrompt },
            ...conversation,
            { role: "user", content: parsed.data.message },
        ];

        const tools = buildToolDefinitions();

        for (let iteration = 0; iteration < 4; iteration += 1) {
            const response = await generateResponse(messages, tools);
            const assistant = response.message;

            messages.push({
                role: "assistant",
                content: assistant.content,
                tool_calls: assistant.tool_calls,
            });

            if (!assistant.tool_calls?.length) {
                return NextResponse.json({
                    message: assistant.content ?? "",
                    requestId: context.requestId,
                });
            }

            for (const toolCall of assistant.tool_calls) {
                let rawArgs: unknown;

                try {
                    rawArgs = JSON.parse(toolCall.function.arguments || "{}");
                } catch {
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            success: false,
                            error: "Invalid tool arguments.",
                        }),
                    });
                    continue;
                }

                try {
                    const result = await executeTool(
                        toolCall.function.name,
                        rawArgs,
                        context,
                    );

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            success: true,
                            result,
                        }),
                    });
                } catch (error) {
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            success: false,
                            error: safeToolError(error),
                        }),
                    });
                }
            }
        }

        return NextResponse.json(
            {
                error: "The assistant exceeded the tool-call limit.",
                requestId: context.requestId,
            },
            { status: 500 },
        );
    } catch (error) {
        console.error("AI chat request failed:", error);

        return NextResponse.json(
            {
                error: "Unable to process the AI request.",
                requestId: context.requestId,
            },
            { status: 500 },
        );
    }
}
