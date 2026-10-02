import "server-only";

import { z } from "zod";

const llmConfigSchema = z.object({
    LLM_API_KEY: z.string().min(1),
    LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
    LLM_MODEL: z.string().min(1).default("gpt-4.1-mini"),
});

const config = llmConfigSchema.parse({
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    LLM_MODEL: process.env.LLM_MODEL ?? "gpt-4.1-mini",
});

export type LlmTool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type LlmMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content?: string | null; tool_calls?: LlmToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

export type LlmToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

export type LlmResponse = {
    message: {
        role: "assistant";
        content: string | null;
        tool_calls?: LlmToolCall[];
    };
};

async function callChatCompletions(
    messages: LlmMessage[],
    tools: LlmTool[] = [],
): Promise<LlmResponse> {
    const response = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify({
            model: config.LLM_MODEL,
            messages,
            tools,
            tool_choice: tools.length > 0 ? "auto" : undefined,
            temperature: 0,
        }),
        cache: "no-store",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM request failed: ${response.status} ${text.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
        choices?: Array<{ message?: LlmResponse["message"] }>;
    };

    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("LLM returned no assistant message.");

    return { message: { ...message, role: "assistant" } };
}

export async function generateResponse(
    messages: LlmMessage[],
    tools: LlmTool[] = [],
): Promise<LlmResponse> {
    return callChatCompletions(messages, tools);
}
