import "server-only";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getObjectBytes } from "@/app/lib/storage";
import type { ServiceContext } from "@/app/lib/ai/types";

const MAX_IMPORT_ROWS = 250_000;
const BATCH_SIZE = 1_000;

type ParsedRows = {
    rows: Array<Record<string, unknown>>;
    headers: string[];
};

function normalizeColumnName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

/**
 * Column names are part of a dataset's contract. Do not silently rename
 * collisions (for example, "Employee ID" and "employee-id") because that
 * makes queries ambiguous and hides malformed input.
 */
function normalizeHeaders(headers: string[]): string[] {
    const normalized = headers.map(normalizeColumnName);
    const seen = new Set<string>();

    for (const [index, header] of headers.entries()) {
        if (!header.trim() || !normalized[index]) {
            throw new Error("Column headers cannot be empty.");
        }
        if (seen.has(normalized[index])) {
            throw new Error(
                `Duplicate column headers after normalization: "${header}". Rename the conflicting columns and upload again.`,
            );
        }
        seen.add(normalized[index]);
    }

    return normalized;
}

function getSchemaColumns(value: unknown): string[] | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const columns = (value as Record<string, unknown>).columns;
    if (!Array.isArray(columns) || !columns.every((column) => typeof column === "string")) {
        return null;
    }

    return columns;
}

function validateSchema(expected: string[], actual: string[]) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((column) => !actualSet.has(column));
    const unexpected = actual.filter((column) => !expectedSet.has(column));

    if (missing.length || unexpected.length) {
        const details = [
            missing.length ? `Missing columns: ${missing.join(", ")}` : "",
            unexpected.length ? `Unexpected columns: ${unexpected.join(", ")}` : "",
        ].filter(Boolean).join(". ");

        throw new Error(
            `This file does not match the schema for this dataset. ${details}. The existing dataset was not changed.`,
        );
    }
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
): Promise<ParsedRows> {
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

        const headers = (result.meta.fields ?? []).map((header) => header.trim());
        if (headers.length === 0) {
            throw new Error("The CSV must contain a header row.");
        }

        return { rows: result.data, headers };
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

    const headers = rows.length > 0 ? Object.keys(rows[0]).map((header) => header.trim()) : [];
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
            errorDetails: Prisma.JsonNull,
        },
    });

    try {
        const objectKey = dataImport.storageKey ?? dataImport.dataSource.storageKey;
        const fileType = dataImport.fileType ?? dataImport.dataSource.type;
        const bytes = await getObjectBytes(objectKey);

        if (bytes.byteLength === 0) {
            throw new Error("The uploaded file is empty.");
        }

        const parsed = await parseRows(bytes, fileType);

        if (parsed.rows.length > MAX_IMPORT_ROWS) {
            throw new Error(
                `The import contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows.`,
            );
        }

        const normalizedHeaders = normalizeHeaders(parsed.headers);
        const storedSchemaColumns = getSchemaColumns(dataImport.dataSource.schema);
        let expectedColumns = storedSchemaColumns;

        // Adopt the column contract from the latest successful legacy import
        // when this dataset predates the schema-contract migration.
        if (!expectedColumns) {
            const previousImport = await prisma.dataImport.findFirst({
                where: {
                    dataSourceId: dataImport.dataSourceId,
                    id: { not: dataImport.id },
                    status: "COMPLETED",
                },
                orderBy: { createdAt: "desc" },
                select: {
                    columnMappings: {
                        select: { normalizedName: true },
                    },
                },
            });
            const previousColumns = previousImport?.columnMappings.map(
                (mapping) => mapping.normalizedName,
            );
            if (previousColumns?.length) expectedColumns = previousColumns;
        }

        if (expectedColumns) {
            validateSchema(
                [...expectedColumns].sort(),
                [...normalizedHeaders].sort(),
            );
        }

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
                    data: record.data as Prisma.InputJsonValue,
                })),
            });
        }

        if (!storedSchemaColumns) {
            await prisma.dataSource.update({
                where: { id: dataImport.dataSourceId },
                data: {
                    schema: {
                        version: 1,
                        columns: expectedColumns ?? normalizedHeaders,
                    } as Prisma.InputJsonValue,
                },
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
