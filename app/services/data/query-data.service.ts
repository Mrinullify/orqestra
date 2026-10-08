import "server-only";

import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

export interface CompanyDataFilter {
    column: string;
    value: string;
}

export async function queryCompanyData(
    context: ServiceContext,
    input: {
        dataSourceId?: string;
        search?: string;
        filters?: CompanyDataFilter[];
        limit: number;
    },
) {
    const dataSource = input.dataSourceId
        ? await prisma.dataSource.findFirst({
              where: {
                  id: input.dataSourceId,
                  organizationId: context.organizationId,
              },
              select: {
                  id: true,
                  name: true,
                  originalName: true,
              },
          })
        : null;

    if (input.dataSourceId && !dataSource) {
        throw new Error("Data source not found.");
    }

    const records = await prisma.dataRecord.findMany({
        where: {
            organizationId: context.organizationId,
            ...(input.dataSourceId
                ? { dataSourceId: input.dataSourceId }
                : {}),
        },
        orderBy: { rowNumber: "asc" },
        take: Math.min(input.limit, 100),
        select: {
            rowNumber: true,
            data: true,
            dataSourceId: true,
        },
    });

    const filters = input.filters ?? [];
    const search = input.search?.trim().toLowerCase();

    const filtered = records.filter((record) => {
        const row = record.data as Record<string, unknown>;

        const matchesFilters = filters.every((filter) => {
            const value = row[filter.column];
            return String(value ?? "").toLowerCase() === filter.value.toLowerCase();
        });

        if (!matchesFilters) return false;

        if (!search) return true;

        return JSON.stringify(row).toLowerCase().includes(search);
    });

    return {
        dataSource: dataSource
            ? {
                  id: dataSource.id,
                  name: dataSource.name,
              }
            : null,
        count: filtered.length,
        rows: filtered,
        truncated: records.length >= Math.min(input.limit, 100),
    };
}
