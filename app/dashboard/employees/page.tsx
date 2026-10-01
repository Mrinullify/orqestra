import { requireHRSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import { InvitationStatusBadge } from "./InvitationStatusBadge";
import { InvitationActions } from "./InvitationActions";

export const metadata: Metadata = {
    title: "Employees — Orqestra",
};

export default async function EmployeesPage() {
    const auth = await requireHRSession();

    const [members, invitations] = await Promise.all([
        prisma.membership.findMany({
            where: { organizationId: auth.organizationId },
            include: { user: { select: { id: true, name: true, email: true, department: true, isActive: true, createdAt: true } } },
            orderBy: { createdAt: "desc" },
        }),
        prisma.invitation.findMany({
            where: {
                organizationId: auth.organizationId,
                status: { in: ["PENDING", "SENT", "FAILED"] },
            },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900">Employees</h1>
                    <p className="mt-1 text-sm text-zinc-500">{members.length} total members</p>
                </div>
                <Link
                    href="/dashboard/employees/invite"
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition"
                >
                    Invite employees
                </Link>
            </div>

            {/* Pending invitations */}
            {invitations.length > 0 && (
                <div className="mb-8">
                    <h2 className="mb-3 text-sm font-semibold text-zinc-700 uppercase tracking-wide">
                        Pending invitations ({invitations.length})
                    </h2>
                    <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="flex items-center justify-between px-5 py-4">
                                <div>
                                    <p className="text-sm font-medium text-zinc-900">{inv.email}</p>
                                    <p className="text-xs text-zinc-400 mt-0.5">
                                        Invited {new Date(inv.createdAt).toLocaleDateString()} · Expires{" "}
                                        {new Date(inv.expiresAt).toLocaleDateString()}
                                    </p>
                                    {inv.failureReason && (
                                        <p className="text-xs text-red-500 mt-0.5">Email failed: {inv.failureReason}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <InvitationStatusBadge status={inv.status} />
                                    <InvitationActions invitationId={inv.id} status={inv.status} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Members list */}
            <div>
                <h2 className="mb-3 text-sm font-semibold text-zinc-700 uppercase tracking-wide">
                    Members
                </h2>
                {members.length === 0 ? (
                    <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
                        <p className="text-sm text-zinc-500">No members yet. Invite your first employee.</p>
                    </div>
                ) : (
                    <div className="rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
                        {members.map((m) => (
                            <div key={m.id} className="flex items-center justify-between px-5 py-4">
                                <div>
                                    <p className="text-sm font-medium text-zinc-900">
                                        {m.user.name ?? m.user.email}
                                    </p>
                                    <p className="text-xs text-zinc-400 mt-0.5">
                                        {m.user.email}
                                        {m.user.department ? ` · ${m.user.department}` : ""}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                                        {m.role}
                                    </span>
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                            m.user.isActive
                                                ? "bg-emerald-50 text-emerald-700"
                                                : "bg-zinc-100 text-zinc-500"
                                        }`}
                                    >
                                        {m.user.isActive ? "Active" : "Pending activation"}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
