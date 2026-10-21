"use client";

import { FormEvent, useEffect, useState } from "react";

type ChartPayload = {
    type: "bar";
    title: string;
    xAxisLabel: string;
    yAxisLabel: string;
    points: Array<{ label: string; value: number }>;
};

type Message = {
    role: "user" | "assistant";
    content: string;
    chart?: ChartPayload;
    transient?: boolean;
    retryable?: boolean;
    excludeFromContext?: boolean;
};

type ChatResponse = {
    message?: string;
    chart?: ChartPayload;
    error?: string;
    retryAfterSeconds?: number;
};

const suggestions = [
    "Which department has the highest average salary? Show a chart.",
    "Compare employee count by department with a chart.",
    "Show the salary distribution and explain any unusual patterns.",
];

export default function CopilotClient() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);
    const [retryMessage, setRetryMessage] = useState<string | null>(null);

    useEffect(() => {
        if (cooldownSeconds <= 0) return;

        const timer = window.setTimeout(() => {
            setCooldownSeconds((remaining) => Math.max(0, remaining - 1));
        }, 1000);

        return () => window.clearTimeout(timer);
    }, [cooldownSeconds]);

    async function sendMessage(
        message?: string,
        options: { retry?: boolean } = {},
    ) {
        const text = (message ?? input).trim();

        if (!text || loading || cooldownSeconds > 0) return;

        if (!options.retry) {
            setInput("");
            setMessages((current) => [
                ...current,
                { role: "user", content: text },
            ]);
        }

        setLoading(true);

        // Keep only actual conversation turns. Rate-limit and network errors are UI
        // notices, not assistant answers, and failed prompts are excluded until retried.
        const history = messages
            .filter((item) => !item.transient && !item.excludeFromContext)
            .map(({ role, content }) => ({ role, content }));

        try {
            const response = await fetch("/api/ai/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: text,
                    messages: history,
                }),
            });

            const data = (await response.json()) as ChatResponse;

            if (!response.ok) {
                if (response.status === 429) {
                    const headerRetryAfter = Number(response.headers.get("Retry-After"));
                    const retryAfter = typeof data.retryAfterSeconds === "number"
                        ? data.retryAfterSeconds
                        : headerRetryAfter;
                    const seconds = Number.isFinite(retryAfter) && retryAfter > 0
                        ? Math.ceil(retryAfter)
                        : 0;

                    setCooldownSeconds(seconds);
                    setRetryMessage(text);
                    setMessages((current) => {
                        const next = current.filter((item) => !item.transient);
                        for (let index = next.length - 1; index >= 0; index -= 1) {
                            const item = next[index];
                            if (item.role === "user" && item.content === text) {
                                next[index] = { ...item, excludeFromContext: true };
                                break;
                            }
                        }
                        return [
                            ...next,
                            {
                                role: "assistant",
                                content: data.error ?? "The AI service is rate limited. Please retry shortly.",
                                transient: true,
                                retryable: true,
                            },
                        ];
                    });
                    return;
                }

                throw new Error(data.error ?? "Unable to process your request.");
            }

            setCooldownSeconds(0);
            setRetryMessage(null);
            setMessages((current) => {
                const next = current.filter((item) => !item.transient);
                if (options.retry) {
                    for (let index = next.length - 1; index >= 0; index -= 1) {
                        const item = next[index];
                        if (item.role === "user" && item.content === text && item.excludeFromContext) {
                            next[index] = { ...item, excludeFromContext: false };
                            break;
                        }
                    }
                }

                return [
                    ...next,
                    {
                        role: "assistant",
                        content: data.message ?? "I couldn't generate a response.",
                        ...(data.chart ? { chart: data.chart } : {}),
                    },
                ];
            });
        } catch (error) {
            setMessages((current) => {
                const next = current.filter((item) => !item.transient);
                for (let index = next.length - 1; index >= 0; index -= 1) {
                    const item = next[index];
                    if (item.role === "user" && item.content === text) {
                        next[index] = { ...item, excludeFromContext: true };
                        break;
                    }
                }
                return [
                    ...next,
                    {
                        role: "assistant",
                        content: error instanceof Error
                            ? error.message
                            : "Something went wrong. Please try again.",
                        transient: true,
                    },
                ];
            });
        } finally {
            setLoading(false);
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void sendMessage();
    }

    return (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="min-h-[420px] space-y-5 p-5 sm:p-6">
                {messages.length === 0 ? (
                    <div className="flex min-h-[370px] flex-col items-center justify-center text-center">
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-lg font-semibold text-white">
                            O
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-900">
                            How can I help?
                        </h2>
                        <p className="mt-1 max-w-md text-sm text-zinc-500">
                            Ask about employees in your organization. Copilot will use the
                            available read-only tools when appropriate.
                        </p>

                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                            {suggestions.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => void sendMessage(suggestion)}
                                    disabled={loading || cooldownSeconds > 0}
                                    className="rounded-full border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((message, index) => (
                        <div
                            key={index}
                            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                        >
                            <div
                                className={
                                    message.transient
                                        ? "max-w-[85%] rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm whitespace-pre-wrap text-amber-900"
                                        : message.role === "user"
                                            ? "max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-3 text-sm text-white"
                                            : "max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-sm whitespace-pre-wrap text-zinc-800"
                                }
                            >
                                <div>{message.content}</div>
                                {message.transient && message.retryable && retryMessage && (
                                    <button
                                        type="button"
                                        onClick={() => void sendMessage(retryMessage, { retry: true })}
                                        disabled={loading || cooldownSeconds > 0}
                                        className="mt-3 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {cooldownSeconds > 0
                                            ? `Retry in ${cooldownSeconds}s`
                                            : "Retry previous question"}
                                    </button>
                                )}
                                {message.role === "assistant" && message.chart && (
                                    <div className="mt-4 w-full min-w-[260px] rounded-xl border border-zinc-200 bg-white p-4 text-zinc-800 sm:min-w-[360px]">
                                        <div className="mb-3">
                                            <h3 className="text-sm font-semibold text-zinc-900">{message.chart.title}</h3>
                                            <p className="mt-1 text-xs text-zinc-500">{message.chart.xAxisLabel} · {message.chart.yAxisLabel}</p>
                                        </div>
                                        <div className="space-y-3">
                                            {message.chart.points.map((point) => {
                                                const maxValue = Math.max(1, ...message.chart!.points.map((item) => Math.abs(item.value)));
                                                const width = Math.max(1, (Math.abs(point.value) / maxValue) * 100);
                                                return (
                                                    <div key={point.label} className="grid grid-cols-[minmax(72px,0.8fr)_minmax(90px,2fr)_auto] items-center gap-2 text-xs">
                                                        <span className="truncate text-zinc-600" title={point.label}>{point.label}</span>
                                                        <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
                                                            <div className="h-full rounded-full bg-indigo-600" style={{ width: `${width}%` }} />
                                                        </div>
                                                        <span className="min-w-[56px] text-right font-medium tabular-nums text-zinc-800">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(point.value)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <p className="mt-3 text-[11px] text-zinc-400">Chart values are calculated from the uploaded dataset.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}

                {loading && (
                    <div className="flex justify-start">
                        <div className="rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
                            Thinking…
                        </div>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-zinc-200 p-4">
                {cooldownSeconds > 0 && (
                    <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        Groq is rate-limiting requests. You can retry in {cooldownSeconds} second{cooldownSeconds === 1 ? "" : "s"}. Your conversation context is being kept.
                    </p>
                )}
                <div className="flex gap-3">
                    <input
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        disabled={loading}
                        placeholder="Ask about your employees..."
                        className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white disabled:opacity-60"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim() || cooldownSeconds > 0}
                        className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {loading ? "Thinking…" : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : "Send"}
                    </button>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                    Ask natural-language questions, compare groups, and request charts from your company data.
                    Conversation context includes recent successful turns; refresh the page to start a new chat.
                </p>
            </form>
        </div>
    );
}
