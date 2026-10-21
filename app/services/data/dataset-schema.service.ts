import "server-only";

import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";
import { requiresReportingPeriod } from "@/app/services/data/period-semantics";

function readSchemaColumns(schema: unknown): string[] {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
    const columns = (schema as Record<string, unknown>).columns;
    return Array.isArray(columns)
        ? columns.filter((column): column is string => typeof column === "string")
        : [];
}

/**
 * Enforce safe period semantics before a query reaches PostgreSQL.
 * A named period must exist and be active. Snapshot datasets with multiple
 * active imports require an explicit period to prevent accidental double-counting.
 */
export async function assertReportingPeriodSelection(
    context: ServiceContext,
    dataSourceId: string,
    reportingPeriod?: string,
) {
    const source = await prisma.dataSource.findFirst({
        where: {
            id: dataSourceId,
            organizationId: context.organizationId,
        },
        select: { periodMode: true },
    });

    if (!source) throw new Error("Data source not found.");

    if (reportingPeriod?.trim()) {
        const matchingImport = await prisma.dataImport.findFirst({
            where: {
                dataSourceId,
                status: "COMPLETED",
                isActive: true,
                reportingPeriod: {
                    equals: reportingPeriod.trim(),
                    mode: "insensitive",
                },
            },
            select: { id: true },
        });

        if (!matchingImport) {
            throw new Error(
                `No active import exists for reporting period "${reportingPeriod.trim()}". Choose a period listed for this dataset.`,
            );
        }
        return;
    }

    if (source.periodMode === "SNAPSHOT") {
        const activeImportCount = await prisma.dataImport.count({
            where: {
                dataSourceId,
                status: "COMPLETED",
                isActive: true,
            },
        });

        if (requiresReportingPeriod(source.periodMode, activeImportCount, reportingPeriod)) {
            throw new Error(
                "This snapshot dataset contains multiple active periods. Specify one reportingPeriod; combining snapshots could double-count records.",
            );
        }
    }
}

/**
 * Resolve the column contract from the logical dataset. Legacy datasets fall
 * back to the most recent successful import's column mappings.
 */
export async function assertDatasetColumns(
    context: ServiceContext,
    dataSourceId: string,
    requestedColumns: string[],
) {
    const source = await prisma.dataSource.findFirst({
        where: {
            id: dataSourceId,
            organizationId: context.organizationId,
        },
        select: {
            schema: true,
            imports: {
                where: { status: "COMPLETED", isActive: true },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    columnMappings: {
                        select: { normalizedName: true },
                    },
                },
            },
        },
    });

    if (!source) throw new Error("Data source not found.");

    const contractColumns = readSchemaColumns(source.schema);
    const availableColumns = contractColumns.length
        ? contractColumns
        : source.imports[0]?.columnMappings.map((column) => column.normalizedName) ?? [];
    const available = new Set(availableColumns);

    for (const column of requestedColumns) {
        if (!available.has(column)) {
            throw new Error(
                `Column "${column}" does not exist in this dataset. Inspect the dataset and use one of its actual column names.`,
            );
        }
    }
}

/**
 * Reject non-numeric columns before running numeric aggregates. Older datasets
 * without stored type metadata retain the strict SQL numeric parser as fallback.
 */
export async function assertDatasetNumericColumns(
    context: ServiceContext,
    dataSourceId: string,
    requestedColumns: string[],
) {
    if (!requestedColumns.length) return;

    const source = await prisma.dataSource.findFirst({
        where: {
            id: dataSourceId,
            organizationId: context.organizationId,
        },
        select: { schema: true },
    });

    if (!source) throw new Error("Data source not found.");
    if (!source.schema || typeof source.schema !== "object" || Array.isArray(source.schema)) return;

    const types = (source.schema as Record<string, unknown>).types;
    if (!types || typeof types !== "object" || Array.isArray(types)) return;

    const columnTypes = types as Record<string, unknown>;
    for (const column of requestedColumns) {
        if (columnTypes[column] !== undefined && columnTypes[column] !== "number") {
            throw new Error(
                `Column "${column}" is typed as ${String(columnTypes[column])} in this dataset, not number. Choose a numeric column or correct the uploaded data.`,
            );
        }
    }
}
