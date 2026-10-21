import "server-only";

import { z } from "zod";
import type { ToolDefinition } from "@/app/lib/ai/types";
import {
    inspectDataSource,
    listDataSources,
} from "@/app/services/data/data-sources.service";

export const listDataSourcesSchema = z.object({}).strict();

export const listDataSourcesTool: ToolDefinition<typeof listDataSourcesSchema> = {
    name: "list_data_sources",
    description:
        "List uploaded company data sources available to the authenticated user's organization. Use this when the user asks what datasets, files, or company data are available. Never access another organization's data.",
    inputSchema: listDataSourcesSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (_input, context) => listDataSources(context),
};

export const inspectDataSourceSchema = z.object({
    dataSourceId: z.string().min(1),
}).strict();

type InspectDataSourceInput = z.infer<typeof inspectDataSourceSchema>;

export const inspectDataSourceTool: ToolDefinition<typeof inspectDataSourceSchema> = {
    name: "inspect_data_source",
    description:
        "Inspect one uploaded company data source to see file information, import status, row counts, and discovered columns. Use this after list_data_sources when you need to understand a dataset before querying it.",
    inputSchema: inspectDataSourceSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: InspectDataSourceInput, context) =>
        inspectDataSource(context, input.dataSourceId),
};
