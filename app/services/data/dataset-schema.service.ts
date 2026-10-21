import "server-only";

import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

function readSchemaColumns(schema: unknown): string[] {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
    const columns = (schema as Record<string, unknown>).columns;
    return Array.isArray(columns)
        ? columns.filter((column): column is string => typeof column === "string")
        : [];
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
