import "server-only";

import { z } from "zod";
import type { ToolDefinition } from "@/app/lib/ai/types";
import {
    aggregateCompanyData,
    compareCompanyData,
    groupCompanyData,
} from "@/app/services/data/analytics.service";

const filterSchema = z.object({
    column: z.string().min(1),
    value: z.string(),
}).strict();

export const aggregateCompanyDataSchema = z.object({
    dataSourceId: z.string().min(1),
    operation: z.enum(["count", "sum", "average", "min", "max"]),
    column: z.string().min(1).optional(),
    filters: z.array(filterSchema).max(10).optional(),
}).strict();

type AggregateCompanyDataInput = z.infer<typeof aggregateCompanyDataSchema>;

export const aggregateCompanyDataTool: ToolDefinition<typeof aggregateCompanyDataSchema> = {
    name: "aggregate_company_data",
    description:
        "Run a database-side aggregate on one uploaded company dataset. Use count for record counts, or sum/average/min/max for a numeric column such as salary. Use filters for exact column values. This tool performs the calculation in PostgreSQL; do not calculate the result from returned rows.",
    inputSchema: aggregateCompanyDataSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: AggregateCompanyDataInput, context) =>
        aggregateCompanyData(context, input),
};

export const compareCompanyDataSchema = z.object({
    dataSourceId: z.string().min(1),
    column: z.string().min(1),
    operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
    value: z.number(),
    filters: z.array(filterSchema).max(10).optional(),
    limit: z.number().int().min(1).max(100).default(20),
}).strict();

type CompareCompanyDataInput = z.infer<typeof compareCompanyDataSchema>;

export const compareCompanyDataTool: ToolDefinition<typeof compareCompanyDataSchema> = {
    name: "compare_company_data",
    description:
        "Find uploaded company-data rows whose numeric column matches a comparison such as salary greater than 80000. Use gt/gte/lt/lte/eq. The comparison is executed in PostgreSQL. Use this when the user asks who earns above/below a threshold or similar numeric conditions.",
    inputSchema: compareCompanyDataSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: CompareCompanyDataInput, context) =>
        compareCompanyData(context, input),
};

export const groupCompanyDataSchema = z.object({
    dataSourceId: z.string().min(1),
    groupBy: z.string().min(1),
    operation: z.enum(["count", "sum", "average", "min", "max"]),
    metricColumn: z.string().min(1).optional(),
    filters: z.array(filterSchema).max(10).optional(),
    limit: z.number().int().min(1).max(100).default(20),
}).strict();

type GroupCompanyDataInput = z.infer<typeof groupCompanyDataSchema>;

export const groupCompanyDataTool: ToolDefinition<typeof groupCompanyDataSchema> = {
    name: "group_company_data",
    description:
        "Group one uploaded company dataset by a column such as department and calculate count, sum, average, min, or max. For count, metricColumn is not needed. For other operations, provide a numeric metricColumn such as salary. Results are calculated in PostgreSQL and ordered by the aggregate descending.",
    inputSchema: groupCompanyDataSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: GroupCompanyDataInput, context) =>
        groupCompanyData(context, input),
};
