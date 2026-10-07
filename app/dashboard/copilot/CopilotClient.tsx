"use client";

import { FormEvent, useState } from "react";

type Message = {
    role: "user" | "assistant";
    content: string;
};

const suggestions = [
    "List all employees",
    "Find the employee with email bear@gmail.com",
];

export default function CopilotClient() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    async function sendMessage(message?: string) {
        const text = (message ?? input).trim();

        if (!text || loading) return;

        setInput("");
        setMessages((current) => [
            ...current,
            { role: "user", content: text },
        ]);
        setLoading(true);

        try {
            const response = await fetch("/api/ai/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: text }),
            });

            const data = (await response.json()) as {
                message?: string;
                error?: string;
            };

            if (!response.ok) {
                throw new Error(data.error ?? "Unable to process your request.");
            }

            setMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content: data.message ?? "I couldn't generate a response.",
                },
            ]);
        } catch (error) {
            setMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content:
                        error instanceof Error
                            ? error.message
                            : "Something went wrong. Please try again.",
                },
            ]);
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
                                    className="rounded-full border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
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
                                    message.role === "user"
                                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-3 text-sm text-white"
                                        : "max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-sm whitespace-pre-wrap text-zinc-800"
                                }
                            >
                                {message.content}
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
                        disabled={loading || !input.trim()}
                        className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Send
                    </button>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                    Copilot currently supports read-only employee queries.
                </p>
            </form>
        </div>
    );
}
