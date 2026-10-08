import "server-only";

import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

export async function listDataSources(context: ServiceContext) {
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
            createdAt: true,
            imports: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    id: true,
                    status: true,
                    totalRows: true,
                    acceptedRows: true,
                    rejectedRows: true,
                    completedAt: true,
                },
            },
        },
    });

    return sources.map((source) => ({
        ...source,
        sizeBytes: source.sizeBytes?.toString() ?? null,
        latestImport: source.imports[0] ?? null,
    }));
}

export async function inspectDataSource(
    context: ServiceContext,
    dataSourceId: string,
) {
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
            createdAt: true,
            imports: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    id: true,
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
        createdAt: source.createdAt,
        latestImport,
        columns: latestImport?.columnMappings ?? [],
    };
}
