import "server-only";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getObjectBytes } from "@/app/lib/storage";
import type { ServiceContext } from "@/app/lib/ai/types";
import { inferDatasetColumnTypes, normalizeHeaders, readDatasetSchemaColumns, readDatasetSchemaTypes, validateDatasetColumnTypes, validateDatasetSchema, type DatasetColumnType } from "@/app/services/data/schema-contract";

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

function rowsFromMatrix(
    matrix: unknown[][],
    sourceType: "CSV" | "EXCEL",
): ParsedRows {
    if (matrix.length === 0 || !matrix[0]?.length) {
        throw new Error("The file must contain a header row and at least one data row.");
    }

    const headers = matrix[0].map((value) =>
        value === null || value === undefined ? "" : String(value).trim(),
    );
    // Validate before converting rows into objects; object conversion would hide
    // duplicate header names by overwriting one of the values.
    normalizeHeaders(headers);

    const rawRows = matrix.slice(1).filter((row) =>
        row.some((value) => value !== null && value !== undefined && String(value).trim() !== ""),
    );
    if (rawRows.length === 0) {
        throw new Error("The file must contain a header and at least one data row.");
    }

    const rows = rawRows.map((row, index) => {
        if (row.length > headers.length && row.slice(headers.length).some(
            (value) => value !== null && value !== undefined && String(value).trim() !== "",
        )) {
            throw new Error(`Row ${index + 2} contains more values than the header defines.`);
        }
        if (sourceType === "CSV" && row.length !== headers.length) {
            throw new Error(
                `Row ${index + 2} has ${row.length} columns; expected ${headers.length} based on the header.`,
            );
        }

        const record: Record<string, unknown> = {};
        headers.forEach((header, headerIndex) => {
            record[header] = row[headerIndex] ?? null;
        });
        return record;
    });

    return { rows, headers };
}

async function parseRows(
    bytes: Uint8Array,
    type: "CSV" | "EXCEL",
): Promise<ParsedRows> {
    if (type === "CSV") {
        const text = Buffer.from(bytes).toString("utf8");
        const result = Papa.parse<string[]>(text, {
            header: false,
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

        return rowsFromMatrix(result.data, "CSV");
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
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        raw: false,
        blankrows: false,
    });

    return rowsFromMatrix(matrix, "EXCEL");
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
        const storedSchemaTypes = readDatasetSchemaTypes(dataImport.dataSource.schema);
        let expectedColumns = storedSchemaColumns;
        let expectedTypes = storedSchemaTypes;
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
                const knownTypes = new Set(["number", "date", "boolean", "string", "mixed"]);
                const previousTypes: Record<string, DatasetColumnType> = {};
                for (const mapping of mappings) {
                    if (mapping.detectedType && knownTypes.has(mapping.detectedType)) {
                        previousTypes[mapping.normalizedName] = mapping.detectedType as DatasetColumnType;
                    }
                }
                if (Object.keys(previousTypes).length) expectedTypes = previousTypes;
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
                    validateDatasetColumnTypes(
                        readDatasetSchemaTypes(currentSource?.schema),
                        parsed.rows,
                        parsed.headers,
                        normalizedHeaders,
                    );
                }
            } else if (!storedSchemaTypes) {
                await tx.dataSource.update({
                    where: { id: dataImport.dataSourceId },
                    data: {
                        schema: {
                            version: 1,
                            columns: storedSchemaColumns,
                            types: expectedTypes ?? inferredTypes,
                        } as Prisma.InputJsonValue,
                    },
                });
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
