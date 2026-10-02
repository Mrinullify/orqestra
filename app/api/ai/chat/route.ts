import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateResponse, type LlmMessage, type LlmTool } from "@/app/ai/llm/client";
import { toolRegistry, executeTool } from "@/app/ai/tools";
import { getToolContext } from "@/app/lib/ai/context";
import { ApprovalRequiredError } from "@/app/lib/ai/approvals";

const requestSchema = z.object({
    message: z.string().trim().min(1).max(4000),
});

const systemPrompt = `
You are Orqestra Copilot, an internal business operations assistant.

Rules:
- Use available tools when the user's request can be fulfilled by a tool.
- Never invent employee data.
- You only have access to the authenticated user's organization.
- Never ask the user for organization IDs, user IDs, database credentials, or internal secrets.
- Do not claim an action succeeded unless the tool result confirms it.
- For unsupported requests, explain what is currently supported.
- Keep responses concise and useful.
`.trim();

function schemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    const zAny = schema as unknown as {
        toJSONSchema?: () => Record<string, unknown>;
    };

    if (!zAny.toJSONSchema) {
        throw new Error("Tool schema cannot be converted to JSON Schema.");
    }

    return zAny.toJSONSchema();
}

function buildToolDefinitions(): LlmTool[] {
    return Array.from(toolRegistry.values()).map((tool) => ({
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
        return error.message;
    }

    return "Tool execution failed.";
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const parsed = requestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request. message is required." },
                { status: 400 },
            );
        }

        const context = await getToolContext("AI");

        let messages: LlmMessage[] = [
            { role: "system", content: systemPrompt },
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
        if (error instanceof Error && error.message === "NEXT_REDIRECT") {
            throw error;
        }

        return NextResponse.json(
            { error: "Unable to process the AI request." },
            { status: 500 },
        );
    }
}
