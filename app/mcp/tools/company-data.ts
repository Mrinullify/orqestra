import "server-only";

import { z } from "zod/v4";

import { getToolContext } from "@/app/lib/ai/context";
import { queryCompanyData } from "@/app/services/data/query-data.service";
import {
    listDataSources,
    inspectDataSource,
} from "@/app/services/data/data-sources.service";
import {
    aggregateCompanyData,
    compareCompanyData,
    groupCompanyData,
} from "@/app/services/data/analytics.service";
import {
    queryCompanyDataSchema,
} from "@/app/ai/tools/company-data";
import {
    aggregateCompanyDataSchema,
    compareCompanyDataSchema,
    groupCompanyDataSchema,
} from "@/app/ai/tools/analytics";
import {
    inspectDataSourceSchema,
} from "@/app/ai/tools/data-sources";

const dataSourceSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    originalName: z.string(),
    type: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.string().nullable(),
    createdAt: z.string(),
    latestImport: z.object({
        id: z.string(),
        status: z.string(),
        totalRows: z.number().nullable(),
        acceptedRows: z.number(),
        rejectedRows: z.number(),
        completedAt: z.string().nullable(),
    }).nullable(),
});

const dataSourceColumnSchema = z.object({
    originalName: z.string(),
    normalizedName: z.string(),
    detectedType: z.string().nullable(),
    confidence: z.number().nullable(),
    isApproved: z.boolean(),
});

const dataSourceDetailSchema = z.object({
    id: z.string(),
    name: z.string(),
    originalName: z.string(),
    type: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.string().nullable(),
    createdAt: z.string(),
    latestImport: z.object({
        id: z.string(),
        status: z.string(),
        totalRows: z.number().nullable(),
        acceptedRows: z.number(),
        rejectedRows: z.number(),
        completedAt: z.string().nullable(),
    }).nullable(),
    columns: z.array(dataSourceColumnSchema),
});

const companyDataRowSchema = z.object({
    rowNumber: z.number(),
    data: z.record(z.string(), z.unknown()),
    dataSourceId: z.string(),
});

const queryCompanyDataMcpSchema = queryCompanyDataSchema;

const listDataSourcesMcpSchema = z.object({}).strict();

const inspectDataSourceMcpSchema = inspectDataSourceSchema;

const aggregateCompanyDataMcpSchema = aggregateCompanyDataSchema;

const compareCompanyDataMcpSchema = compareCompanyDataSchema;

const groupCompanyDataMcpSchema = groupCompanyDataSchema;

export const listDataSourcesMcpOutputSchema = z.object({
    dataSources: z.array(dataSourceSummarySchema),
});

export const inspectDataSourceMcpOutputSchema = dataSourceDetailSchema;

export const queryCompanyDataMcpOutputSchema = z.object({
    dataSource: z.object({
        id: z.string(),
        name: z.string(),
    }).nullable(),
    count: z.number(),
    rows: z.array(companyDataRowSchema),
    limit: z.number(),
    hasMore: z.boolean(),
});

export const aggregateCompanyDataMcpOutputSchema = z.object({
    dataSource: z.object({
        id: z.string(),
        name: z.string(),
    }),
    operation: z.string(),
    column: z.string().nullable().optional(),
    value: z.number().nullable(),
});

export const compareCompanyDataMcpOutputSchema = z.object({
    dataSource: z.object({
        id: z.string(),
        name: z.string(),
    }),
    column: z.string(),
    operator: z.string(),
    value: z.number(),
    count: z.number(),
    rows: z.array(z.object({
        rowNumber: z.number(),
        data: z.record(z.string(), z.unknown()),
    })),
    limit: z.number(),
    hasMore: z.boolean(),
});

export const groupCompanyDataMcpOutputSchema = z.object({
    dataSource: z.object({
        id: z.string(),
        name: z.string(),
    }),
    groupBy: z.string(),
    operation: z.string(),
    metricColumn: z.string().nullable(),
    groups: z.array(z.object({
        groupValue: z.string().nullable(),
        value: z.number(),
    })),
    limit: z.number(),
});

export async function mcpListDataSources() {
    const context = await getToolContext("MCP");
    const sources = await listDataSources(context);

    return {
        dataSources: sources.map((source) => ({
            ...source,
            createdAt: source.createdAt.toISOString(),
            latestImport: source.latestImport
                ? {
                    ...source.latestImport,
                    completedAt: source.latestImport.completedAt?.toISOString() ?? null,
                }
                : null,
        })),
    };
}

export async function mcpInspectDataSource(
    input: z.infer<typeof inspectDataSourceMcpSchema>,
) {
    const context = await getToolContext("MCP");
    const result = await inspectDataSource(context, input.dataSourceId);

    return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        latestImport: result.latestImport
            ? {
                ...result.latestImport,
                completedAt: result.latestImport.completedAt?.toISOString() ?? null,
            }
            : null,
    };
}

export async function mcpQueryCompanyData(
    input: z.infer<typeof queryCompanyDataMcpSchema>,
) {
    const context = await getToolContext("MCP");
    return queryCompanyData(context, input);
}

export async function mcpAggregateCompanyData(
    input: z.infer<typeof aggregateCompanyDataMcpSchema>,
) {
    const context = await getToolContext("MCP");
    return aggregateCompanyData(context, input);
}

export async function mcpCompareCompanyData(
    input: z.infer<typeof compareCompanyDataMcpSchema>,
) {
    const context = await getToolContext("MCP");
    return compareCompanyData(context, input);
}

export async function mcpGroupCompanyData(
    input: z.infer<typeof groupCompanyDataMcpSchema>,
) {
    const context = await getToolContext("MCP");
    return groupCompanyData(context, input);
}

export {
    queryCompanyDataMcpSchema,
    listDataSourcesMcpSchema,
    inspectDataSourceMcpSchema,
    aggregateCompanyDataMcpSchema,
    compareCompanyDataMcpSchema,
    groupCompanyDataMcpSchema,
};
