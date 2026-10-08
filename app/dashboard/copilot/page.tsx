import type { Metadata } from "next";
import CopilotClient from "./CopilotClient";

export const metadata: Metadata = {
    title: "Copilot — Orqestra",
};

export default function CopilotPage() {
    return (
        <div className="mx-auto max-w-5xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900">Orqestra Copilot</h1>
                <p className="mt-1 text-sm text-zinc-500">
                    Ask questions about employees in your organization using natural language.
                </p>
            </div>

            <CopilotClient />
        </div>
    );
}
