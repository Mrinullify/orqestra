"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { useSearchParams } from "next/navigation";

export default function LoginForm() {
    const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
    const searchParams = useSearchParams();
    const activated = searchParams.get("activated");

    return (
        <form action={action} className="space-y-4">
            {activated && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                    Your account has been activated. You can now sign in.
                </div>
            )}

            {state?.message && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                    {state.message}
                </div>
            )}

            <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Work email
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 transition"
                    placeholder="you@company.com"
                />
                {state?.errors?.email && (
                    <p className="mt-1.5 text-xs text-red-600">{state.errors.email[0]}</p>
                )}
            </div>

            <div>
                <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Password
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 transition"
                    placeholder="••••••••"
                />
                {state?.errors?.password && (
                    <p className="mt-1.5 text-xs text-red-600">{state.errors.password[0]}</p>
                )}
            </div>

            <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
                {pending ? "Signing in…" : "Sign in"}
            </button>
        </form>
    );
}
