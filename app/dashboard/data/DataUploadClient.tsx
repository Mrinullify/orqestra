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
    const [datasetName, setDatasetName] = useState("");
    const [periodMode, setPeriodMode] = useState<"" | "ADDITIVE" | "SNAPSHOT">("");
    const [reportingPeriod, setReportingPeriod] = useState("");
    const [replaceExistingPeriod, setReplaceExistingPeriod] = useState(false);
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
        if (!file || !datasetName.trim() || !periodMode || !reportingPeriod.trim() || loading) return;

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
                    datasetName: datasetName.trim(),
                    periodMode,
                    reportingPeriod: reportingPeriod.trim() || undefined,
                    replaceExistingPeriod: Boolean(reportingPeriod.trim()) && replaceExistingPeriod,
                    sizeBytes: file.size,
                }),
            });

            const prepareData = (await prepareResponse.json()) as {
                uploadUrl?: string;
                uploadContentType?: string;
                dataImportId?: string;
                existingDataset?: boolean;
                hasSchema?: boolean;
                periodMode?: "ADDITIVE" | "SNAPSHOT";
                error?: string;
            };

            if (!prepareResponse.ok || !prepareData.uploadUrl || !prepareData.dataImportId) {
                throw new Error(prepareData.error ?? "Unable to prepare the upload.");
            }

            const effectivePeriodMode = prepareData.periodMode ?? periodMode;
            setPeriodMode(effectivePeriodMode);
            setStatus(
                prepareData.existingDataset
                    ? `Using the existing dataset's ${effectivePeriodMode === "SNAPSHOT" ? "snapshot" : "additive"} period mode. Its column structure will be validated...`
                    : "Uploading file to secure storage...",
            );

            const uploadResponse = await fetch(prepareData.uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": prepareData.uploadContentType || file.type || "application/octet-stream",
                },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error(
                    `File upload failed with status ${uploadResponse.status}.`,
                );
            }

            setStatus("Validating the schema and importing rows into PostgreSQL...");

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
            setStatus("Import completed. The dataset is ready for Copilot.");
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
                    Upload one CSV or Excel file at a time. Files using the same dataset name
                    are treated as one logical dataset and must keep the same column names and compatible data types.
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-zinc-700">
                        Dataset / table name
                        <input
                            type="text"
                            value={datasetName}
                            onChange={(event) => { setDatasetName(event.target.value); setReplaceExistingPeriod(false); }}
                            maxLength={80}
                            placeholder="e.g. Sales Data"
                            disabled={loading}
                            required
                            className="mt-2 block w-full rounded-xl border border-zinc-200 px-3 py-2.5 font-normal outline-none focus:border-zinc-500"
                        />
                        <span className="mt-1 block text-xs font-normal text-zinc-500">
                            Reuse this name to add another file to the same dataset.
                        </span>
                    </label>

                    <label className="block text-sm font-medium text-zinc-700">
                        Reporting period / snapshot label <span className="font-normal text-zinc-400">(required)</span>
                        <input
                            type="text"
                            value={reportingPeriod}
                            onChange={(event) => { setReportingPeriod(event.target.value); setReplaceExistingPeriod(false); }}
                            maxLength={80}
                            placeholder="e.g. October 2026 or Current"
                            disabled={loading}
                            required
                            className="mt-2 block w-full rounded-xl border border-zinc-200 px-3 py-2.5 font-normal outline-none focus:border-zinc-500"
                        />
                        <span className="mt-1 block text-xs font-normal text-zinc-500">
                            Every file needs a period label so Orqestra can select the correct data without guessing.
                        </span>
                    </label>
                </div>

                <label className="mt-4 block text-sm font-medium text-zinc-700">
                    How should reporting periods be handled?
                    <select
                        value={periodMode}
                        onChange={(event) => setPeriodMode(event.target.value as "" | "ADDITIVE" | "SNAPSHOT")}
                        disabled={loading}
                        required
                        className="mt-2 block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-zinc-500"
                    >
                        <option value="">Choose a data behavior...</option>
                        <option value="ADDITIVE">Additive periods — combine separate periods (e.g. monthly sales)</option>
                        <option value="SNAPSHOT">Snapshots — each period is a separate state (e.g. employee roster)</option>
                    </select>
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                        This setting is fixed when the dataset is created. Existing datasets keep their original behavior.
                    </span>
                </label>

                <label className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-700">
                    <input
                        type="checkbox"
                        checked={replaceExistingPeriod}
                        onChange={(event) => setReplaceExistingPeriod(event.target.checked)}
                        disabled={loading || !reportingPeriod.trim()}
                        className="mt-0.5"
                    />
                    <span>
                        <span className="block font-medium">Replace existing data for this period</span>
                        <span className="mt-1 block text-xs text-zinc-500">
                            Use this when uploading a corrected file for a period already imported. The previous version stays stored but is excluded from active analytics. A reporting period is required.
                        </span>
                    </span>
                </label>

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
                        disabled={!file || !datasetName.trim() || !periodMode || !reportingPeriod.trim() || loading}
                        className="mt-5 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {loading ? "Processing..." : "Validate and import"}
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
