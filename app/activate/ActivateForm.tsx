"use client";

import { useActionState, useEffect } from "react";
import { activateAction, type ActivateState } from "@/app/actions/activate";

interface Props {
    token: string;
}

export default function ActivateForm({ token }: Props) {
    const [state, action, pending] = useActionState<ActivateState, FormData>(activateAction, undefined);

    return (
        <form action={action} className="space-y-4">
            <input type="hidden" name="token" value={token} />

            {state?.message && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                    {state.message}
                </div>
            )}

            <div>
                <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Create password
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 transition"
                    placeholder="Min. 8 characters"
                />
                {state?.errors?.password && (
                    <ul className="mt-1.5 space-y-0.5">
                        {state.errors.password.map((e) => (
                            <li key={e} className="text-xs text-red-600">
                                {e}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-700 mb-1.5">
                    Confirm password
                </label>
                <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 transition"
                    placeholder="Repeat your password"
                />
                {state?.errors?.confirmPassword && (
                    <p className="mt-1.5 text-xs text-red-600">{state.errors.confirmPassword[0]}</p>
                )}
            </div>

            <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-4 py-3 text-xs text-zinc-600 space-y-1">
                <p className="font-medium text-zinc-700">Password requirements</p>
                <ul className="list-disc list-inside space-y-0.5">
                    <li>At least 8 characters</li>
                    <li>Contains at least one letter</li>
                    <li>Contains at least one number</li>
                </ul>
            </div>

            <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
                {pending ? "Activating…" : "Activate account"}
            </button>
        </form>
    );
}
