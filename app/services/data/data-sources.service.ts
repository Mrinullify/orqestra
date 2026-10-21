import "server-only";

import { requireHR } from "@/app/lib/ai/permissions";

import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

export async function listDataSources(context: ServiceContext) {
    requireHR(context);
    const sources = await prisma.dataSource.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            originalName: true,
            type: true,
            mimeType: true,
            sizeBytes: true,
            schema: true,
            createdAt: true,
            imports: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    id: true,
                    originalName: true,
                    reportingPeriod: true,
                    status: true,
                    totalRows: true,
                    acceptedRows: true,
                    rejectedRows: true,
                    completedAt: true,
                },
            },
        },
    });

    return sources.map((source) => {
        const { imports, ...dataset } = source;
        return {
            ...dataset,
            sizeBytes: source.sizeBytes?.toString() ?? null,
            latestImport: imports[0] ?? null,
        };
    });
}

export async function inspectDataSource(
    context: ServiceContext,
    dataSourceId: string,
 ) {
    requireHR(context);
    const source = await prisma.dataSource.findFirst({
        where: {
            id: dataSourceId,
            organizationId: context.organizationId,
        },
        select: {
            id: true,
            name: true,
            originalName: true,
            type: true,
            mimeType: true,
            sizeBytes: true,
            schema: true,
            createdAt: true,
            imports: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    id: true,
                    originalName: true,
                    reportingPeriod: true,
                    status: true,
                    totalRows: true,
                    acceptedRows: true,
                    rejectedRows: true,
                    completedAt: true,
                    columnMappings: {
                        orderBy: { originalName: "asc" },
                        select: {
                            originalName: true,
                            normalizedName: true,
                            detectedType: true,
                            confidence: true,
                            isApproved: true,
                        },
                    },
                },
            },
        },
    });

    if (!source) throw new Error("Data source not found.");

    const latestImport = source.imports[0] ?? null;

    return {
        id: source.id,
        name: source.name,
        originalName: source.originalName,
        type: source.type,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes?.toString() ?? null,
        schema: source.schema,
        createdAt: source.createdAt,
        latestImport,
        columns: latestImport?.columnMappings ?? [],
    };
}

/**
 * Supply the model with trusted metadata for active, successfully imported
 * files. Pending/failed imports must never be presented as queryable data.
 */
export async function getCopilotDataContext(context: ServiceContext) {
    if (context.role !== "HR") return [];
    const sources = await prisma.dataSource.findMany({
        where: {
            organizationId: context.organizationId,
            imports: {
                some: { status: "COMPLETED", isActive: true },
            },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
            id: true,
            name: true,
            schema: true,
            imports: {
                where: { status: "COMPLETED", isActive: true },
                orderBy: { createdAt: "desc" },
                take: 12,
                select: {
                    originalName: true,
                    reportingPeriod: true,
                    totalRows: true,
                    acceptedRows: true,
                    rejectedRows: true,
                    columnMappings: {
                        orderBy: { originalName: "asc" },
                        take: 60,
                        select: {
                            originalName: true,
                            normalizedName: true,
                        },
                    },
                },
            },
        },
    });

    return sources.map((source) => ({
        id: source.id,
        name: source.name,
        schema: source.schema,
        imports: source.imports.map((dataImport) => ({
            originalName: dataImport.originalName,
            reportingPeriod: dataImport.reportingPeriod,
            totalRows: dataImport.totalRows,
            acceptedRows: dataImport.acceptedRows,
            rejectedRows: dataImport.rejectedRows,
            columns: dataImport.columnMappings,
        })),
    }));
}
