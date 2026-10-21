"use client";

import { useState, useRef, useActionState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createBulkInvitationsAction } from "@/app/actions/invitations";
import type { EmployeeRow, ValidationResult, InviteState } from "@/app/lib/validation/invitations";

type Step = "upload" | "preview" | "confirm" | "done";

export default function BulkInviteClient() {
    const [step, setStep] = useState<Step>("upload");
    const [fileName, setFileName] = useState<string | null>(null);
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const [inviteState, inviteFormAction, invitePending] = useActionState<InviteState, FormData>(
        createBulkInvitationsAction,
        undefined
    );

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        setParseError(null);
        setValidation(null);
        setFileName(file.name);
        setIsParsing(true);

        try {
            let rows: EmployeeRow[] = [];

            if (file.name.toLowerCase().endsWith(".csv")) {
                rows = await parseCSV(file);
            } else if (file.name.toLowerCase().match(/\.xlsx?$/)) {
                rows = await parseExcel(file);
            } else {
                setParseError("Only CSV and Excel files are supported.");
                setIsParsing(false);
                return;
            }

            if (rows.length === 0) {
                setParseError("No data rows found in the file.");
                setIsParsing(false);
                return;
            }

            // Call validate API route (uses session for org context)
            const resp = await fetch("/api/invitations/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                setParseError(err.error ?? "Validation failed.");
                setIsParsing(false);
                return;
            }

            const result: ValidationResult = await resp.json();
            setValidation(result);
            setStep("preview");
        } catch (err) {
            setParseError(err instanceof Error ? err.message : "Failed to parse file.");
        } finally {
            setIsParsing(false);
        }
    }

    function parseCSV(file: File): Promise<EmployeeRow[]> {
        return new Promise((resolve, reject) => {
            Papa.parse<Record<string, string>>(file, {
                header: true,
                skipEmptyLines: true,
                complete(results) {
                    const rows = results.data.map((row) => ({
                        name: (row["Employee Name"] ?? row["Name"] ?? row["name"] ?? "").trim(),
                        email: (row["Work Email"] ?? row["Email"] ?? row["email"] ?? "").trim(),
                        department: (row["Department"] ?? row["department"] ?? "").trim(),
                    }));
                    resolve(rows);
                },
                error(err) {
                    reject(new Error(err.message));
                },
            });
        });
    }

    async function parseExcel(file: File): Promise<EmployeeRow[]> {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        return data.map((row) => ({
            name: (row["Employee Name"] ?? row["Name"] ?? row["name"] ?? "").trim(),
            email: (row["Work Email"] ?? row["Email"] ?? row["email"] ?? "").trim(),
            department: (row["Department"] ?? row["department"] ?? "").trim(),
        }));
    }

    function reset() {
        setStep("upload");
        setFileName(null);
        setValidation(null);
        setParseError(null);
        if (fileRef.current) fileRef.current.value = "";
    }

    // --- Done state ---
    if (step === "done" || inviteState?.success) {
        return (
            <div className="text-center py-12">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 mb-4">
                    <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-lg font-semibold text-zinc-900 mb-2">Invitations sent</h2>
                <p className="text-sm text-zinc-500 mb-6">
                    {inviteState?.count} invitation(s) sent successfully.
                    {inviteState?.errors && inviteState.errors.length > 0 && (
                        <> {inviteState.errors.length} failed.</>
                    )}
                </p>
                {inviteState?.errors && inviteState.errors.length > 0 && (
                    <div className="mb-6 mx-auto max-w-lg rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-left">
                        <p className="font-medium mb-2">Failures:</p>
                        <ul className="list-disc list-inside space-y-1">
                            {inviteState.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </div>
                )}
                <button
                    onClick={reset}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition"
                >
                    Send more invitations
                </button>
            </div>
        );
    }

    // --- Upload step ---
    if (step === "upload") {
        return (
            <div>
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-8 py-16 cursor-pointer hover:border-zinc-400 hover:bg-white transition">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="sr-only"
                        onChange={handleFileChange}
                    />
                    {isParsing ? (
                        <div className="text-center">
                            <div className="h-8 w-8 rounded-full border-2 border-zinc-300 border-t-zinc-700 animate-spin mx-auto mb-3" />
                            <p className="text-sm text-zinc-500">Parsing file…</p>
                        </div>
                    ) : (
                        <div className="text-center">
                            <svg className="h-10 w-10 text-zinc-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-sm font-medium text-zinc-700">
                                Drop a CSV or Excel file here, or <span className="text-zinc-900 underline">click to browse</span>
                            </p>
                            <p className="mt-2 text-xs text-zinc-400">
                                Required columns: <code className="bg-zinc-100 px-1 rounded">Employee Name</code>,{" "}
                                <code className="bg-zinc-100 px-1 rounded">Work Email</code>,{" "}
                                <code className="bg-zinc-100 px-1 rounded">Department</code>
                            </p>
                        </div>
                    )}
                </label>

                {parseError && (
                    <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                        {parseError}
                    </div>
                )}

                <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-5 py-4">
                    <p className="text-xs font-semibold text-zinc-700 mb-2">Example CSV format</p>
                    <pre className="text-xs text-zinc-500 font-mono">
{`Employee Name,Work Email,Department
Jane Smith,jane.smith@company.com,Engineering
John Doe,john.doe@company.com,Sales`}
                    </pre>
                </div>
            </div>
        );
    }

    // --- Preview step ---
    if (step === "preview" && validation) {
        const { valid, errors, duplicateEmails, existingMembers } = validation;

        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-zinc-500">File: <span className="font-medium text-zinc-700">{fileName}</span></p>
                    </div>
                    <button onClick={reset} className="text-sm text-zinc-400 hover:text-zinc-700 transition">
                        Choose different file
                    </button>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                        <p className="text-2xl font-bold text-emerald-700">{valid.length}</p>
                        <p className="text-xs text-emerald-600 mt-1">Valid &amp; ready</p>
                    </div>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
                        <p className="text-2xl font-bold text-red-600">{errors.length}</p>
                        <p className="text-xs text-red-500 mt-1">Errors</p>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                        <p className="text-2xl font-bold text-amber-600">{existingMembers.length}</p>
                        <p className="text-xs text-amber-600 mt-1">Already members</p>
                    </div>
                </div>

                {/* Valid rows preview */}
                {valid.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-700 mb-2">
                            Employees to be invited ({valid.length})
                        </h3>
                        <div className="rounded-xl border border-zinc-200 overflow-hidden max-h-64 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr>
                                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500">Name</th>
                                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500">Email</th>
                                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500">Department</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-zinc-100">
                                    {valid.map((row, i) => (
                                        <tr key={i}>
                                            <td className="px-4 py-2.5 text-zinc-900">{row.name}</td>
                                            <td className="px-4 py-2.5 text-zinc-500">{row.email}</td>
                                            <td className="px-4 py-2.5 text-zinc-500">{row.department || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Errors */}
                {errors.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-700 mb-2">Issues ({errors.length})</h3>
                        <div className="rounded-xl border border-red-200 bg-red-50 divide-y divide-red-100 overflow-hidden max-h-48 overflow-y-auto">
                            {errors.map((e, i) => (
                                <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                                    <span className="text-sm text-red-700">{e.email || `Row ${e.row}`}</span>
                                    <span className="text-xs text-red-500">{e.reason}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {valid.length === 0 ? (
                    <div className="text-center py-4">
                        <p className="text-sm text-zinc-500">No valid employees to invite. Please fix the issues and re-upload.</p>
                        <button onClick={reset} className="mt-3 text-sm font-medium text-zinc-900 underline">
                            Try again
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between pt-2">
                        <button onClick={reset} className="text-sm text-zinc-500 hover:text-zinc-700 transition">
                            Cancel
                        </button>
                        <button
                            onClick={() => setStep("confirm")}
                            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 transition"
                        >
                            Review &amp; confirm →
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // --- Confirm step ---
    if (step === "confirm" && validation) {
        return (
            <div className="space-y-6">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
                    <h3 className="text-base font-semibold text-zinc-900 mb-1">Ready to send invitations</h3>
                    <p className="text-sm text-zinc-500">
                        This will send {validation.valid.length} invitation email(s). Each employee will receive a unique
                        link to activate their account. Invitations expire in 24 hours.
                    </p>
                </div>

                {inviteState?.errors && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                        {inviteState.errors.join(", ")}
                    </div>
                )}

                <form action={inviteFormAction}>
                    <input
                        type="hidden"
                        name="employees"
                        value={JSON.stringify(validation.valid)}
                    />
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => setStep("preview")}
                            className="text-sm text-zinc-500 hover:text-zinc-700 transition"
                        >
                            ← Back to preview
                        </button>
                        <button
                            type="submit"
                            disabled={invitePending}
                            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                            {invitePending
                                ? "Sending invitations…"
                                : `Send ${validation.valid.length} invitation(s)`}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    return null;
}
