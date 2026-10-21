import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateResponse, LlmConnectionError, LlmRateLimitError, type LlmMessage, type LlmTool } from "@/app/ai/llm/client";
import { toolRegistry, executeTool } from "@/app/ai/tools";
import { getToolContext } from "@/app/lib/ai/context";
import { ApprovalRequiredError } from "@/app/lib/ai/approvals";
import { getCopilotDataContext } from "@/app/services/data/data-sources.service";

const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 2000;
const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_TOOL_ROUNDS = 3;

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
    "list_data_sources",
    "inspect_data_source",
    "aggregate_company_data",
    "compare_company_data",
    "group_company_data",
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
- For questions about uploaded CSV/Excel data (including salary, department, name, counts, or other imported columns), use the company-data tools. Do not use list_employees or find_employee for values that come from uploaded company data.
- For calculations such as counts, averages, sums, minimums, maximums, or grouped statistics, ALWAYS use aggregate_company_data or group_company_data so PostgreSQL performs the calculation. Do not calculate these values yourself from rows.
- For numeric threshold questions such as who earns more than 80000, use compare_company_data so PostgreSQL performs the comparison.
- For a person lookup in uploaded data, use query_company_data with search set to the person name, such as search="Aman".
- Use filters with the uploaded column name and value for exact matching.
- For questions asking which datasets/files are available, answer directly from the server-provided dataset context.
- When you need the columns or structure of a specific dataset, use inspect_data_source after identifying its dataSourceId.
- Use query_company_data to retrieve actual rows or answer non-aggregate questions about values in uploaded data.
- The available dataset context below already contains dataset IDs, import status, row counts, and column names. Use it directly to select the right dataSourceId and column names. Do NOT call list_data_sources or inspect_data_source just to rediscover information already shown here.
- Call list_data_sources only if the server-provided dataset context is empty and you need to discover available sources.
- Call inspect_data_source only when the required information is genuinely missing from the context below.
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
            "A numeric column is required for this operation.",
            "A numeric metric column is required for this operation.",
        ]);

        if (safeMessages.has(error.message)) {
            return error.message;
        }
    }

    return "Tool execution failed.";
}

function serializeToolResult(result: unknown): string {
    const serialized = JSON.stringify({ success: true, result });
    if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized;

    return JSON.stringify({
        success: true,
        truncated: true,
        note: "The tool result was too large and has been shortened. Use narrower filters or a smaller limit.",
        preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS - 300),
    });
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
        const conversation: LlmMessage[] = parsed.data.messages
            .slice(-MAX_HISTORY_MESSAGES)
            .map((message) => ({
                role: message.role,
                content: message.content.slice(-MAX_HISTORY_MESSAGE_CHARS),
            }));

        // Fetch compact organization-scoped dataset metadata once so the model
        // doesn't spend separate LLM rounds listing and inspecting the same source.
        const datasetContext = await getCopilotDataContext(context);
        const datasetContextText = datasetContext.length
            ? JSON.stringify(datasetContext)
            : "No uploaded datasets are currently available for this organization.";

        const messages: LlmMessage[] = [
            {
                role: "system",
                content: `${systemPrompt}\n\nAvailable dataset context (trusted server-provided metadata):\n${datasetContextText}`,
            },
            ...conversation,
            { role: "user", content: parsed.data.message },
        ];

        const tools = buildToolDefinitions();

        for (let iteration = 0; iteration < MAX_TOOL_ROUNDS; iteration += 1) {
            console.info(
                `[AI ${context.requestId}] LLM round ${iteration + 1}/${MAX_TOOL_ROUNDS}`,
            );

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

            console.info(
                `[AI ${context.requestId}] requested tools: ${assistant.tool_calls.map((call) => call.function.name).join(", ")}`,
            );

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
                        content: serializeToolResult(result),
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

        // The last tool round may have produced enough data, but the model has not
        // yet had a chance to turn it into a user-facing answer. Ask for that answer
        // without tools so another tool loop cannot start.
        console.warn(
            `[AI ${context.requestId}] reached the tool-round limit; requesting a final answer without tools.`,
        );
        const finalResponse = await generateResponse(messages, []);

        return NextResponse.json({
            message: finalResponse.message.content ?? "I retrieved the data, but couldn't produce a summary. Please try a more specific question.",
            requestId: context.requestId,
        });
    } catch (error) {
        if (error instanceof LlmConnectionError) {
            return NextResponse.json(
                {
                    error: "The AI provider could not be reached after retrying. Please try again shortly.",
                    requestId: context.requestId,
                },
                { status: 503, headers: { "Retry-After": "2" } },
            );
        }

        if (error instanceof LlmRateLimitError) {
            const retryAfterSeconds = error.retryAfterSeconds;
            const headers = retryAfterSeconds === undefined
                ? undefined
                : { "Retry-After": String(Math.ceil(retryAfterSeconds)) };

            return NextResponse.json(
                {
                    error: "The AI service is busy due to a temporary rate limit. Please retry shortly.",
                    retryAfterSeconds,
                    requestId: context.requestId,
                },
                { status: 429, headers },
            );
        }

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
