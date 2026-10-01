import { Suspense } from "react";
import LoginForm from "./LoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Sign in — Orqestra",
};

export default function LoginPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Orqestra</h1>
                    <p className="mt-2 text-sm text-zinc-500">AI-powered Operations Copilot</p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white px-8 py-8 shadow-sm">
                    <h2 className="mb-6 text-lg font-semibold text-zinc-900">Sign in to your account</h2>
                    <Suspense>
                        <LoginForm />
                    </Suspense>
                </div>

                <p className="mt-6 text-center text-xs text-zinc-400">
                    Access is by invitation only. Contact your HR team to get started.
                </p>
            </div>
        </div>
    );
}
