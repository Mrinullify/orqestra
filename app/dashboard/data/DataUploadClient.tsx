"use client";

import { useState, type ChangeEvent } from "react";

type ImportResult = {
    id: string;
    status: string;
    totalRows: number | null;
    acceptedRows: number;
    rejectedRows: number;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export default function DataUploadClient() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [result, setResult] = useState<ImportResult | null>(null);
    const [loading, setLoading] = useState(false);

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const selected = event.target.files?.[0] ?? null;

        setError("");
        setResult(null);

        if (!selected) {
            setFile(null);
            return;
        }

        if (selected.size > MAX_FILE_SIZE) {
            setFile(null);
            setError("The file must be 100 MB or smaller.");
            return;
        }

        const lower = selected.name.toLowerCase();
        if (!lower.endsWith(".csv") && !lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
            setFile(null);
            setError("Please choose a CSV, XLS, or XLSX file.");
            return;
        }

        setFile(selected);
        setStatus("");
    }

    async function upload() {
        if (!file || loading) return;

        setLoading(true);
        setError("");
        setResult(null);

        try {
            setStatus("Preparing secure upload...");

            const prepareResponse = await fetch("/api/datasets/upload-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fileName: file.name,
                    sizeBytes: file.size,
                    contentType: file.type || "application/octet-stream",
                }),
            });

            const prepareData = (await prepareResponse.json()) as {
                uploadUrl?: string;
                dataImportId?: string;
                error?: string;
            };

            if (!prepareResponse.ok || !prepareData.uploadUrl || !prepareData.dataImportId) {
                throw new Error(prepareData.error ?? "Unable to prepare the upload.");
            }

            setStatus("Uploading file to local storage...");

            const uploadResponse = await fetch(prepareData.uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error(
                    `File upload failed with status ${uploadResponse.status}.`,
                );
            }

            setStatus("Importing rows into PostgreSQL...");

            const importResponse = await fetch("/api/datasets/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dataImportId: prepareData.dataImportId,
                }),
            });

            const importData = (await importResponse.json()) as {
                dataImport?: ImportResult;
                error?: string;
            };

            if (!importResponse.ok || !importData.dataImport) {
                throw new Error(importData.error ?? "Unable to import the file.");
            }

            setResult(importData.dataImport);
            setStatus("Import completed.");
        } catch (uploadError) {
            setStatus("");
            setError(
                uploadError instanceof Error
                    ? uploadError.message
                    : "Something went wrong during the upload.",
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-zinc-900">Upload company data</h2>
                <p className="mt-1 text-sm text-zinc-500">
                    Supported formats: CSV, XLS, XLSX. Maximum file size: 100 MB.
                </p>

                <div className="mt-5 rounded-xl border-2 border-dashed border-zinc-200 p-8 text-center">
                    <input
                        id="company-data-file"
                        type="file"
                        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={handleFileChange}
                        disabled={loading}
                        className="mx-auto block max-w-full text-sm"
                    />

                    {file && (
                        <p className="mt-4 text-sm text-zinc-600">
                            <span className="font-medium text-zinc-900">{file.name}</span>
                            {" · "}
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={() => void upload()}
                        disabled={!file || loading}
                        className="mt-5 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {loading ? "Processing..." : "Upload and import"}
                    </button>
                </div>

                {status && (
                    <p className="mt-4 rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                        {status}
                    </p>
                )}

                {error && (
                    <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </p>
                )}
            </div>

            {result && (
                <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                    <h2 className="text-base font-semibold text-zinc-900">Import result</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <Metric label="Status" value={result.status} />
                        <Metric label="Total rows" value={String(result.totalRows ?? 0)} />
                        <Metric label="Accepted" value={String(result.acceptedRows)} />
                        <Metric label="Rejected" value={String(result.rejectedRows)} />
                    </div>
                </div>
            )}
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl bg-zinc-50 p-4">
            <p className="text-xs text-zinc-400">{label}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
        </div>
    );
}
