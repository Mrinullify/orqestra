import { requireHRRole } from "@/app/lib/auth";
import BulkInviteClient from "./BulkInviteClient";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Invite employees — Orqestra",
};

export default async function InvitePage() {
    // Server-side auth check — must be HR
    await requireHRRole();

    return (
        <div>
            <div className="mb-6">
                <Link href="/dashboard/employees" className="text-sm text-zinc-400 hover:text-zinc-700 transition">
                    ← Back to employees
                </Link>
            </div>

            <div className="mb-8">
                <h1 className="text-2xl font-bold text-zinc-900">Invite employees</h1>
                <p className="mt-1 text-sm text-zinc-500">
                    Upload a CSV or Excel file to invite multiple employees (200–400 supported).
                </p>
            </div>

            <div className="max-w-2xl">
                <BulkInviteClient />
            </div>
        </div>
    );
}
