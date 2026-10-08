import "server-only";

import { z } from "zod";
import type { ToolDefinition } from "@/app/lib/ai/types";
import { queryCompanyData } from "@/app/services/data/query-data.service";

export const queryCompanyDataSchema = z.object({
    dataSourceId: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    filters: z
        .array(
            z.object({
                column: z.string().min(1),
                value: z.string(),
            }),
        )
        .max(10)
        .optional(),
    limit: z.number().int().min(1).max(100).default(20),
}).strict();

type QueryCompanyDataInput = z.infer<typeof queryCompanyDataSchema>;

export const queryCompanyDataTool: ToolDefinition<typeof queryCompanyDataSchema> = {
    name: "query_company_data",
    description:
        "Read uploaded company data from the authenticated user's organization. Use filters for exact column values or search for a text match. Never access another organization's data.",
    inputSchema: queryCompanyDataSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: QueryCompanyDataInput, context) =>
        queryCompanyData(context, input),
};
