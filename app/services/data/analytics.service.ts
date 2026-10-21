import "server-only";

import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import type { ServiceContext } from "@/app/lib/ai/types";

export interface CompanyDataFilter {
    column: string;
    value: string;
}

function numericExpression(column: string) {
    return Prisma.sql`
        NULLIF(
            regexp_replace(
                jsonb_extract_path_text("data", ${column}),
                '[^0-9.-]',
                '',
                'g'
            ),
            ''
        )::numeric
    `;
}

function buildWhere(
    context: ServiceContext,
    dataSourceId: string,
    filters: CompanyDataFilter[] = [],
) {
    let where = Prisma.sql`
        "organizationId" = ${context.organizationId}
        AND "dataSourceId" = ${dataSourceId}
    `;

    for (const filter of filters) {
        where = Prisma.sql`${where}
            AND jsonb_extract_path_text("data", ${filter.column}) = ${filter.value}
        `;
    }

    return where;
}

async function assertDataSource(
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
        },
    });

    if (!source) {
        throw new Error("Data source not found.");
    }

    return source;
}

export async function aggregateCompanyData(
    context: ServiceContext,
    input: {
        dataSourceId: string;
        operation: "count" | "sum" | "average" | "min" | "max";
        column?: string;
        filters?: CompanyDataFilter[];
    },
) {
    const source = await assertDataSource(context, input.dataSourceId);
    const where = buildWhere(context, input.dataSourceId, input.filters);

    if (input.operation === "count") {
        const rows = await prisma.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS value
            FROM "DataRecord"
            WHERE ${where}
        `);

        return {
            dataSource: source,
            operation: input.operation,
            value: Number(rows[0]?.value ?? 0),
        };
    }

    if (!input.column) {
        throw new Error("A numeric column is required for this operation.");
    }

    const expression = numericExpression(input.column);
    const operationSql =
        input.operation === "sum"
            ? Prisma.sql`SUM(${expression})`
            : input.operation === "average"
              ? Prisma.sql`AVG(${expression})`
              : input.operation === "min"
                ? Prisma.sql`MIN(${expression})`
                : Prisma.sql`MAX(${expression})`;

    const rows = await prisma.$queryRaw<Array<{ value: unknown }>>(Prisma.sql`
        SELECT ${operationSql} AS value
        FROM "DataRecord"
        WHERE ${where}
    `);

    const rawValue = rows[0]?.value;
    const value = rawValue === null || rawValue === undefined ? null : Number(rawValue);

    return {
        dataSource: source,
        operation: input.operation,
        column: input.column,
        value: Number.isFinite(value ?? NaN) ? value : null,
    };
}

export async function compareCompanyData(
    context: ServiceContext,
    input: {
        dataSourceId: string;
        column: string;
        operator: "gt" | "gte" | "lt" | "lte" | "eq";
        value: number;
        filters?: CompanyDataFilter[];
        limit: number;
    },
) {
    const source = await assertDataSource(context, input.dataSourceId);
    const where = buildWhere(context, input.dataSourceId, input.filters);
    const expression = numericExpression(input.column);

    const comparison =
        input.operator === "gt"
            ? Prisma.sql`> ${input.value}`
            : input.operator === "gte"
              ? Prisma.sql`>= ${input.value}`
              : input.operator === "lt"
                ? Prisma.sql`< ${input.value}`
                : input.operator === "lte"
                  ? Prisma.sql`<= ${input.value}`
                  : Prisma.sql`= ${input.value}`;

    const rows = await prisma.$queryRaw<
        Array<{
            rowNumber: number;
            data: Record<string, unknown>;
        }>
    >(Prisma.sql`
        SELECT "rowNumber", "data"
        FROM "DataRecord"
        WHERE ${where}
          AND ${expression} ${comparison}
        ORDER BY "rowNumber" ASC
        LIMIT ${input.limit}
    `);

    return {
        dataSource: source,
        column: input.column,
        operator: input.operator,
        value: input.value,
        count: rows.length,
        rows,
        limit: input.limit,
        hasMore: rows.length === input.limit,
    };
}

export async function groupCompanyData(
    context: ServiceContext,
    input: {
        dataSourceId: string;
        groupBy: string;
        operation: "count" | "sum" | "average" | "min" | "max";
        metricColumn?: string;
        filters?: CompanyDataFilter[];
        limit: number;
    },
) {
    const source = await assertDataSource(context, input.dataSourceId);
    const where = buildWhere(context, input.dataSourceId, input.filters);

    if (input.operation !== "count" && !input.metricColumn) {
        throw new Error("A numeric metric column is required for this operation.");
    }

    const groupExpression = Prisma.sql`jsonb_extract_path_text("data", ${input.groupBy})`;
    const metricExpression = input.metricColumn
        ? numericExpression(input.metricColumn)
        : null;

    const aggregateSql =
        input.operation === "count"
            ? Prisma.sql`COUNT(*)::bigint`
            : input.operation === "sum"
              ? Prisma.sql`SUM(${metricExpression!})`
              : input.operation === "average"
                ? Prisma.sql`AVG(${metricExpression!})`
                : input.operation === "min"
                  ? Prisma.sql`MIN(${metricExpression!})`
                  : Prisma.sql`MAX(${metricExpression!})`;

    const rows = await prisma.$queryRaw<
        Array<{ groupValue: string | null; value: unknown }>
    >(Prisma.sql`
        SELECT
            ${groupExpression} AS "groupValue",
            ${aggregateSql} AS value
        FROM "DataRecord"
        WHERE ${where}
        GROUP BY ${groupExpression}
        ORDER BY value DESC NULLS LAST
        LIMIT ${input.limit}
    `);

    return {
        dataSource: source,
        groupBy: input.groupBy,
        operation: input.operation,
        metricColumn: input.metricColumn ?? null,
        groups: rows.map((row) => ({
            groupValue: row.groupValue,
            value: Number(row.value ?? 0),
        })),
        limit: input.limit,
    };
}
