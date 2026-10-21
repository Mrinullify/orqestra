"use client";

import { useActionState } from "react";
import { resendInvitationAction, revokeInvitationAction } from "@/app/actions/invitations";
import type { InviteState } from "@/app/lib/validation/invitations";
import type { InvitationStatus } from "@/generated/prisma/client";

interface Props {
    invitationId: string;
    status: InvitationStatus;
}

export function InvitationActions({ invitationId, status }: Props) {
    const [resendState, resendFormAction, resendPending] = useActionState<InviteState, FormData>(
        resendInvitationAction,
        undefined
    );
    const [revokeState, revokeFormAction, revokePending] = useActionState<InviteState, FormData>(
        revokeInvitationAction,
        undefined
    );

    if (status === "ACCEPTED" || status === "REVOKED") return null;

    return (
        <div className="flex items-center gap-2">
            {resendState?.errors && (
                <span className="text-xs text-red-600">{resendState.errors[0]}</span>
            )}
            {resendState?.success && (
                <span className="text-xs text-emerald-600">Resent!</span>
            )}

            <form action={resendFormAction}>
                <input type="hidden" name="invitationId" value={invitationId} />
                <button
                    type="submit"
                    disabled={resendPending || revokePending}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-900 disabled:opacity-50 transition"
                >
                    {resendPending ? "Sending…" : "Resend"}
                </button>
            </form>

            <form action={revokeFormAction}>
                <input type="hidden" name="invitationId" value={invitationId} />
                <button
                    type="submit"
                    disabled={resendPending || revokePending}
                    onClick={(e) => {
                        if (!confirm("Revoke this invitation? The employee will no longer be able to use this link.")) {
                            e.preventDefault();
                        }
                    }}
                    className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition"
                >
                    {revokePending ? "Revoking…" : "Revoke"}
                </button>
            </form>
        </div>
    );
}
