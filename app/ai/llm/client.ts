import "server-only";

import { z } from "zod";

const llmConfigSchema = z.object({
    GROQ_API_KEY: z.string().min(1),
    GROQ_API_URL: z.string().url().default("https://api.groq.com/openai/v1"),
    GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
});

const config = llmConfigSchema.parse({
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_API_URL: process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1",
    GROQ_MODEL: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
});

const MAX_COMPLETION_TOKENS = 1024;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_NETWORK_RETRIES = 2;
const BASE_NETWORK_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 30_000;

export class LlmRateLimitError extends Error {
    constructor(public readonly retryAfterSeconds?: number) {
        super("The AI service is temporarily rate limited. Please try again shortly.");
        this.name = "LlmRateLimitError";
    }
}

export class LlmConnectionError extends Error {
    constructor() {
        super("The AI service could not be reached. Please try again shortly.");
        this.name = "LlmConnectionError";
    }
}

function isTransientNetworkError(error: unknown): boolean {
    if (!(error instanceof TypeError)) return false;

    const cause = (error as TypeError & { cause?: { code?: string } }).cause;
    return [
        "UND_ERR_SOCKET",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "ECONNRESET",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ECONNREFUSED",
    ].includes(cause?.code ?? "");
}

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

function parseRetryDelay(response: Response, responseBody: string): number | undefined {
    const headerValue = response.headers.get("retry-after");
    if (headerValue) {
        const seconds = Number(headerValue);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds;

        const retryDate = Date.parse(headerValue);
        if (Number.isFinite(retryDate)) {
            return Math.max(0, (retryDate - Date.now()) / 1000);
        }
    }

    const bodyMatch = responseBody.match(/try again in ([0-9.]+)s/i);
    if (bodyMatch) {
        const seconds = Number(bodyMatch[1]);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    }

    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChatCompletions(
    messages: LlmMessage[],
    tools: LlmTool[] = [],
): Promise<LlmResponse> {
    let networkRetries = 0;

    for (let attempt = 0; ; attempt += 1) {
        let response: Response;

        try {
            response = await fetch(`${config.GROQ_API_URL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${config.GROQ_API_KEY}`,
                },
                body: JSON.stringify({
                    model: config.GROQ_MODEL,
                    messages,
                    tools,
                    tool_choice: tools.length > 0 ? "auto" : undefined,
                    temperature: 0,
                    max_completion_tokens: MAX_COMPLETION_TOKENS,
                }),
                cache: "no-store",
            });
        } catch (error) {
            if (!isTransientNetworkError(error)) throw error;

            if (networkRetries >= MAX_NETWORK_RETRIES) {
                console.error("Groq network request failed after retries.", error);
                throw new LlmConnectionError();
            }

            const delayMs = BASE_NETWORK_RETRY_DELAY_MS * 2 ** networkRetries;
            networkRetries += 1;
            console.warn(
                `Groq network connection failed; retrying in ${delayMs}ms (attempt ${networkRetries}/${MAX_NETWORK_RETRIES}).`,
            );
            await sleep(delayMs);
            continue;
        }

        if (!response.ok) {
            const text = await response.text();

            if (response.status === 429) {
                const retryAfterSeconds = parseRetryDelay(response, text);
                const canRetry = attempt < MAX_RATE_LIMIT_RETRIES;
                const retryDelayMs = retryAfterSeconds === undefined
                    ? 1000 * 2 ** attempt
                    : Math.ceil(retryAfterSeconds * 1000);

                if (canRetry && retryDelayMs <= MAX_RETRY_DELAY_MS) {
                    console.warn(
                        `Groq rate limit reached; retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}).`,
                    );
                    await sleep(retryDelayMs);
                    continue;
                }

                throw new LlmRateLimitError(retryAfterSeconds);
            }

            throw new Error(`LLM request failed: ${response.status} ${text.slice(0, 300)}`);
        }

        const json = (await response.json()) as {
            choices?: Array<{ message?: LlmResponse["message"] }>;
        };

        const message = json.choices?.[0]?.message;
        if (!message) throw new Error("LLM returned no assistant message.");

        return { message: { ...message, role: "assistant" } };
    }
}

export async function generateResponse(
    messages: LlmMessage[],
    tools: LlmTool[] = [],
): Promise<LlmResponse> {
    return callChatCompletions(messages, tools);
}
