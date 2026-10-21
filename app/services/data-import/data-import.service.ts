import "server-only";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getObjectBytes } from "@/app/lib/storage";
import type { ServiceContext } from "@/app/lib/ai/types";
import { inferDatasetColumnTypes, normalizeHeaders, readDatasetSchemaColumns, readDatasetSchemaTypes, validateDatasetColumnTypes, validateDatasetSchema } from "@/app/services/data/schema-contract";

const MAX_IMPORT_ROWS = 250_000;
const BATCH_SIZE = 1_000;

type ParsedRows = {
    rows: Array<Record<string, unknown>>;
    headers: string[];
};

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
        const storedSchemaColumns = readDatasetSchemaColumns(dataImport.dataSource.schema);
        let expectedColumns = storedSchemaColumns;
        let expectedTypes = readDatasetSchemaTypes(dataImport.dataSource.schema);
        const inferredTypes = inferDatasetColumnTypes(
            parsed.rows,
            parsed.headers,
            normalizedHeaders,
        );

        // Adopt column metadata from the latest successful legacy import when
        // this dataset predates the schema-contract migration.
        if (!expectedColumns || !expectedTypes) {
            const previousImport = await prisma.dataImport.findFirst({
                where: {
                    dataSourceId: dataImport.dataSourceId,
                    id: { not: dataImport.id },
                    status: "COMPLETED",
                },
                orderBy: { createdAt: "desc" },
                select: {
                    columnMappings: {
                        select: { normalizedName: true, detectedType: true },
                    },
                },
            });
            const mappings = previousImport?.columnMappings ?? [];
            const previousColumns = mappings.map((mapping) => mapping.normalizedName);
            if (!expectedColumns && previousColumns.length) expectedColumns = previousColumns;

            if (!expectedTypes) {
                const knownTypes = new Set(["number", "date", "boolean", "string", "mixed", "unknown"]);
                const previousTypes = Object.fromEntries(
                    mappings
                        .filter((mapping) => mapping.detectedType && knownTypes.has(mapping.detectedType))
                        .map((mapping) => [mapping.normalizedName, mapping.detectedType]),
                );
                if (Object.keys(previousTypes).length) {
                    expectedTypes = previousTypes as ReturnType<typeof readDatasetSchemaTypes>;
                }
            }
        }

        if (expectedColumns) {
            validateDatasetSchema(
                [...expectedColumns].sort(),
                [...normalizedHeaders].sort(),
            );
        }
        validateDatasetColumnTypes(
            expectedTypes,
            parsed.rows,
            parsed.headers,
            normalizedHeaders,
        );

        if (dataImport.reportingPeriod && !dataImport.replaceExistingPeriod) {
            const duplicatePeriod = await prisma.dataImport.findFirst({
                where: {
                    dataSourceId: dataImport.dataSourceId,
                    id: { not: dataImport.id },
                    reportingPeriod: { equals: dataImport.reportingPeriod, mode: "insensitive" },
                    status: "COMPLETED",
                    isActive: true,
                },
                select: { id: true },
            });
            if (duplicatePeriod) {
                throw new Error(
                    `The period "${dataImport.reportingPeriod}" already exists in this dataset. Enable replacement to avoid double-counting.`,
                );
            }
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
                    detectedType: inferredTypes[normalizedHeaders[index]],
                    confidence: inferredTypes[normalizedHeaders[index]] === "unknown" ? 0 : 1,
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

        const completed = await prisma.$transaction(async (tx) => {
            if (!storedSchemaColumns) {
                const contractColumns = expectedColumns ?? normalizedHeaders;
                const schemaUpdate = await tx.dataSource.updateMany({
                    where: {
                        id: dataImport.dataSourceId,
                        schema: { equals: Prisma.DbNull },
                    },
                    data: {
                        schema: {
                            version: 1,
                            columns: contractColumns,
                            types: expectedTypes ?? inferredTypes,
                        } as Prisma.InputJsonValue,
                    },
                });

                if (schemaUpdate.count === 0) {
                    const currentSource = await tx.dataSource.findFirst({
                        where: {
                            id: dataImport.dataSourceId,
                            organizationId: context.organizationId,
                        },
                        select: { schema: true },
                    });
                    const currentColumns = readDatasetSchemaColumns(currentSource?.schema);
                    if (!currentColumns) {
                        throw new Error("Unable to establish a stable schema for this dataset.");
                    }
                    validateDatasetSchema(currentColumns, contractColumns);
                }
            }

            if (dataImport.replaceExistingPeriod && dataImport.reportingPeriod) {
                await tx.dataImport.updateMany({
                    where: {
                        dataSourceId: dataImport.dataSourceId,
                        id: { not: dataImport.id },
                        reportingPeriod: { equals: dataImport.reportingPeriod, mode: "insensitive" },
                        status: "COMPLETED",
                        isActive: true,
                    },
                    data: { isActive: false },
                });
            }

            return tx.dataImport.update({
                where: { id: dataImport.id },
                data: {
                    status: "COMPLETED",
                    isActive: true,
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
