import { requireSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Dashboard — Orqestra",
};

export default async function DashboardPage() {
    const session = await requireSession();

    const org = await prisma.organization.findUnique({
        where: { id: session.organizationId },
        select: {
            name: true,
            _count: {
                select: { memberships: true },
            },
        },
    });

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
                <p className="mt-1 text-sm text-zinc-500">{org?.name}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-zinc-200 bg-white p-6">
                    <p className="text-sm font-medium text-zinc-500">Team members</p>
                    <p className="mt-2 text-3xl font-bold text-zinc-900">{org?._count.memberships ?? 0}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-6">
                    <p className="text-sm font-medium text-zinc-500">Your role</p>
                    <p className="mt-2 text-xl font-bold text-zinc-900">{session.role}</p>
                </div>
            </div>

            {session.role === "HR" && (
                <div className="mt-8">
                    <h2 className="mb-4 text-base font-semibold text-zinc-900">HR Actions</h2>
                    <div className="flex flex-wrap gap-3">
                        <Link
                            href="/dashboard/employees"
                            className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition"
                        >
                            Manage employees
                        </Link>
                        <Link
                            href="/dashboard/employees/invite"
                            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition"
                        >
                            Invite employees
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
