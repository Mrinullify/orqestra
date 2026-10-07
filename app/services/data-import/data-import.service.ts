import "server-only";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { prisma } from "@/app/lib/prisma";
import { getObjectBytes } from "@/app/lib/r2";
import type { ServiceContext } from "@/app/lib/ai/types";

const MAX_IMPORT_ROWS = 250_000;
const BATCH_SIZE = 1_000;

function normalizeColumnName(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return normalized || "column";
}

function normalizeHeaders(headers: string[]): string[] {
    const counts = new Map<string, number>();

    return headers.map((header) => {
        const base = normalizeColumnName(header);
        const count = (counts.get(base) ?? 0) + 1;
        counts.set(base, count);
        return count === 1 ? base : `${base}_${count}`;
    });
}

function buildRecords(
    rows: Array<Record<string, unknown>>,
    originalHeaders: string[],
    normalizedHeaders: string[],
) {
    return rows.map((row, index) => {
        const data: Record<string, unknown> = {};

        originalHeaders.forEach((header, headerIndex) => {
            data[normalizedHeaders[headerIndex]] = row[header] ?? null;
        });

        return {
            rowNumber: index + 1,
            data,
        };
    });
}

async function parseRows(
    bytes: Uint8Array,
    type: "CSV" | "EXCEL",
) {
    if (type === "CSV") {
        const text = Buffer.from(bytes).toString("utf8");

        const result = Papa.parse<Record<string, unknown>>(text, {
            header: true,
            skipEmptyLines: "greedy",
        });

        if (result.errors.length > 0) {
            throw new Error(
                `CSV parsing failed: ${result.errors
                    .slice(0, 3)
                    .map((error) => error.message)
                    .join("; ")}`,
            );
        }

        const headers = result.meta.fields ?? [];
        if (headers.length === 0) {
            throw new Error("The CSV must contain a header row.");
        }

        return {
            rows: result.data,
            headers,
        };
    }

    const workbook = XLSX.read(Buffer.from(bytes), {
        type: "buffer",
        cellDates: true,
    });

    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) {
        throw new Error("The Excel workbook contains no sheets.");
    }

    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
    });

    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    if (headers.length === 0) {
        throw new Error("The Excel sheet must contain a header row and data.");
    }

    return { rows, headers };
}

export async function processDataImport(
    context: ServiceContext,
    dataImportId: string,
) {
    const dataImport = await prisma.dataImport.findFirst({
        where: {
            id: dataImportId,
            dataSource: {
                organizationId: context.organizationId,
            },
        },
        include: {
            dataSource: true,
        },
    });

    if (!dataImport) {
        throw new Error("Data import not found.");
    }

    await prisma.dataImport.update({
        where: { id: dataImport.id },
        data: {
            status: "PROCESSING",
            startedAt: new Date(),
            completedAt: null,
            errorDetails: null,
        },
    });

    try {
        const bytes = await getObjectBytes(dataImport.dataSource.storageKey);

        if (bytes.byteLength === 0) {
            throw new Error("The uploaded file is empty.");
        }

        const parsed = await parseRows(bytes, dataImport.dataSource.type);

        if (parsed.rows.length > MAX_IMPORT_ROWS) {
            throw new Error(
                `The import contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows.`,
            );
        }

        const normalizedHeaders = normalizeHeaders(parsed.headers);

        await prisma.$transaction(async (tx) => {
            await tx.dataRecord.deleteMany({
                where: { dataImportId: dataImport.id },
            });

            await tx.columnMapping.deleteMany({
                where: { dataImportId: dataImport.id },
            });

            await tx.columnMapping.createMany({
                data: parsed.headers.map((header, index) => ({
                    dataImportId: dataImport.id,
                    originalName: header,
                    normalizedName: normalizedHeaders[index],
                    detectedType: "unknown",
                    confidence: 0,
                    isApproved: true,
                })),
            });
        });

        const records = buildRecords(
            parsed.rows,
            parsed.headers,
            normalizedHeaders,
        );

        for (let index = 0; index < records.length; index += BATCH_SIZE) {
            const batch = records.slice(index, index + BATCH_SIZE);

            await prisma.dataRecord.createMany({
                data: batch.map((record) => ({
                    organizationId: context.organizationId,
                    dataSourceId: dataImport.dataSourceId,
                    dataImportId: dataImport.id,
                    rowNumber: record.rowNumber,
                    data: record.data,
                })),
            });
        }

        const completed = await prisma.dataImport.update({
            where: { id: dataImport.id },
            data: {
                status: "COMPLETED",
                totalRows: records.length,
                acceptedRows: records.length,
                rejectedRows: 0,
                completedAt: new Date(),
            },
            select: {
                id: true,
                status: true,
                totalRows: true,
                acceptedRows: true,
                rejectedRows: true,
            },
        });

        return completed;
    } catch (error) {
        await prisma.dataImport.update({
            where: { id: dataImport.id },
            data: {
                status: "FAILED",
                errorDetails: {
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown import error.",
                },
                completedAt: new Date(),
            },
        });

        throw error;
    }
}
