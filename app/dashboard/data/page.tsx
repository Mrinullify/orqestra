import type { Metadata } from "next";

import { requireHRRole } from "@/app/lib/auth";
import DataUploadClient from "./DataUploadClient";

export const metadata: Metadata = {
    title: "Company Data — Orqestra",
};

export default async function CompanyDataPage() {
    await requireHRRole();

    return (
        <div className="mx-auto max-w-5xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900">Company Data</h1>
                <p className="mt-1 text-sm text-zinc-500">
                    Upload CSV or Excel files. Orqestra keeps the original file in R2 and imports
                    the rows into your organization&apos;s database.
                </p>
            </div>

            <DataUploadClient />
        </div>
    );
}
