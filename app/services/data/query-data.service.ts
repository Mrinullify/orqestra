import "server-only";

import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

export interface CompanyDataFilter {
    column: string;
    value: string;
}

export async function queryCompanyData(
    context: ServiceContext,
    input: {
        dataSourceId: string;
        search?: string;
        filters?: CompanyDataFilter[];
        limit: number;
    },
) {
    const dataSource = await prisma.dataSource.findFirst({
        where: {
            id: input.dataSourceId,
            organizationId: context.organizationId,
        },
        select: { id: true, name: true },
    });

    if (!dataSource) {
        throw new Error("Data source not found.");
    }

    let where = Prisma.sql`
        "organizationId" = ${context.organizationId}
        AND "dataSourceId" = ${input.dataSourceId}
        AND EXISTS (
            SELECT 1
            FROM "DataImport" AS import_record
            WHERE import_record.id = "DataRecord"."dataImportId"
              AND import_record.status = 'COMPLETED'
              AND import_record."isActive" = true
        )
    `;

    for (const filter of input.filters ?? []) {
        where = Prisma.sql`${where}
            AND jsonb_extract_path_text("data", ${filter.column}) = ${filter.value}`;
    }

    const search = input.search?.trim();
    if (search) {
        where = Prisma.sql`${where} AND "data"::text ILIKE ${`%${search}%`}`;
    }

    const rows = await prisma.$queryRaw<
        Array<{
            rowNumber: number;
            data: Record<string, unknown>;
            dataSourceId: string;
        }>
    >(Prisma.sql`
        SELECT "rowNumber", "data", "dataSourceId"
        FROM "DataRecord"
        WHERE ${where}
        ORDER BY "rowNumber" ASC
        LIMIT ${input.limit}
    `);

    return {
        dataSource,
        count: rows.length,
        rows,
        limit: input.limit,
        hasMore: rows.length === input.limit,
    };
}
