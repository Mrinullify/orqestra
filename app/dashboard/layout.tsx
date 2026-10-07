import { getVerifiedAuthSession } from "@/app/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import Link from "next/link";
import { prisma } from "@/app/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const authSession = await getVerifiedAuthSession();

    const user = await prisma.user.findUnique({
        where: { id: authSession.userId },
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
                        <div className="hidden items-center gap-4 text-sm sm:flex">
                            <Link href="/dashboard" className="text-zinc-500 transition hover:text-zinc-900">
                                Dashboard
                            </Link>
                            <Link href="/dashboard/copilot" className="text-zinc-500 transition hover:text-zinc-900">
                                Copilot
                            </Link>
                            {authSession.role === "HR" && (
                                <Link href="/dashboard/employees" className="text-zinc-500 transition hover:text-zinc-900">
                                    Employees
                                </Link>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="hidden text-right sm:block">
                            <p className="text-sm font-medium leading-none text-zinc-900">{user?.name ?? user?.email}</p>
                            <p className="mt-0.5 text-xs text-zinc-400">{user?.organization.name} · {authSession.role}</p>
                        </div>

                        <form action={logoutAction}>
                            <button
                                type="submit"
                                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
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
