import { requireSession } from "@/app/lib/session";
import { logoutAction } from "@/app/actions/auth";
import Link from "next/link";
import { prisma } from "@/app/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await requireSession();

    const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { name: true, email: true, organization: { select: { name: true } } },
    });

    return (
        <div className="min-h-screen bg-zinc-50">
            {/* Top nav */}
            <nav className="border-b border-zinc-200 bg-white">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
                    <div className="flex items-center gap-6">
                        <Link href="/dashboard" className="text-base font-bold tracking-tight text-zinc-900">
                            Orqestra
                        </Link>
                        <div className="hidden sm:flex items-center gap-4 text-sm">
                            <Link href="/dashboard" className="text-zinc-500 hover:text-zinc-900 transition">
                                Dashboard
                            </Link>
                            {session.role === "HR" && (
                                <Link href="/dashboard/employees" className="text-zinc-500 hover:text-zinc-900 transition">
                                    Employees
                                </Link>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="hidden sm:block text-right">
                            <p className="text-sm font-medium text-zinc-900 leading-none">{user?.name ?? user?.email}</p>
                            <p className="text-xs text-zinc-400 mt-0.5">{user?.organization.name} · {session.role}</p>
                        </div>

                        <form action={logoutAction}>
                            <button
                                type="submit"
                                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition"
                            >
                                Sign out
                            </button>
                        </form>
                    </div>
                </div>
            </nav>

            {/* Page content */}
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
                {children}
            </main>
        </div>
    );
}
