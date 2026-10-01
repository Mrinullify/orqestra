import type { InvitationStatus } from "@/generated/prisma/client";

const STATUS_CONFIG: Record<
    InvitationStatus,
    { label: string; className: string }
> = {
    PENDING: { label: "Pending", className: "bg-amber-50 text-amber-700" },
    SENT: { label: "Sent", className: "bg-blue-50 text-blue-700" },
    ACCEPTED: { label: "Accepted", className: "bg-emerald-50 text-emerald-700" },
    EXPIRED: { label: "Expired", className: "bg-zinc-100 text-zinc-500" },
    REVOKED: { label: "Revoked", className: "bg-red-50 text-red-600" },
    FAILED: { label: "Failed", className: "bg-red-50 text-red-600" },
};

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
    const config = STATUS_CONFIG[status];
    return (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
            {config.label}
        </span>
    );
}
