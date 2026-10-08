import "server-only";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
    employeeIdSchema,
    employeeListOutputSchema,
    employeeOutputSchema,
    employeeActionOutputSchema,
    findEmployeeSchema,
    deleteEmployeeMcpSchema,
    mcpDeactivateEmployee,
    mcpDeleteEmployee,
    mcpFindEmployee,
    mcpListEmployees,
} from "./tools/employees";
import {
    aggregateCompanyDataMcpOutputSchema,
    aggregateCompanyDataMcpSchema,
    compareCompanyDataMcpOutputSchema,
    compareCompanyDataMcpSchema,
    groupCompanyDataMcpOutputSchema,
    groupCompanyDataMcpSchema,
    inspectDataSourceMcpOutputSchema,
    inspectDataSourceMcpSchema,
    listDataSourcesMcpOutputSchema,
    listDataSourcesMcpSchema,
    mcpAggregateCompanyData,
    mcpCompareCompanyData,
    mcpGroupCompanyData,
    mcpInspectDataSource,
    mcpListDataSources,
    mcpQueryCompanyData,
    queryCompanyDataMcpOutputSchema,
    queryCompanyDataMcpSchema,
} from "./tools/company-data";

export function createOrqestraMcpServer() {
    const server = new McpServer({
        name: "orqestra",
        version: "1.0.0",
    });

    server.registerTool(
        "list_employees",
        {
            title: "List Employees",
            description: "List employees belonging to the authenticated user's organization.",
            inputSchema: z.object({}).strict(),
            outputSchema: employeeListOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            const result = await mcpListEmployees();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result),
                    },
                ],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "find_employee",
        {
            title: "Find Employee",
            description: "Find one employee by organization-scoped employee ID or email.",
            inputSchema: findEmployeeSchema,
            outputSchema: employeeOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpFindEmployee(input);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result),
                    },
                ],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "deactivate_employee",
        {
            title: "Deactivate Employee",
            description: "Deactivate an employee without deleting their record. HR only.",
            inputSchema: employeeIdSchema,
            outputSchema: employeeActionOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpDeactivateEmployee(input);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result),
                    },
                ],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "delete_employee",
        {
            title: "Delete Employee",
            description: "Permanently delete one employee. HR only and requires an existing approved action.",
            inputSchema: deleteEmployeeMcpSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpDeleteEmployee(input);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result),
                    },
                ],
            };
        },
    );

    server.registerTool(
        "list_data_sources",
        {
            title: "List Data Sources",
            description: "List uploaded company datasets available to the authenticated user's organization.",
            inputSchema: listDataSourcesMcpSchema,
            outputSchema: listDataSourcesMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () => {
            const result = await mcpListDataSources();

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "inspect_data_source",
        {
            title: "Inspect Data Source",
            description: "Inspect an uploaded company dataset, including import status, row counts, and columns.",
            inputSchema: inspectDataSourceMcpSchema,
            outputSchema: inspectDataSourceMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpInspectDataSource(input);

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "query_company_data",
        {
            title: "Query Company Data",
            description: "Read rows from uploaded company datasets belonging to the authenticated user's organization.",
            inputSchema: queryCompanyDataMcpSchema,
            outputSchema: queryCompanyDataMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpQueryCompanyData(input);

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "aggregate_company_data",
        {
            title: "Aggregate Company Data",
            description: "Calculate count, sum, average, minimum, or maximum for one uploaded company dataset using PostgreSQL.",
            inputSchema: aggregateCompanyDataMcpSchema,
            outputSchema: aggregateCompanyDataMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpAggregateCompanyData(input);

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "compare_company_data",
        {
            title: "Compare Company Data",
            description: "Find rows in uploaded company data matching a numeric threshold such as salary greater than 80000.",
            inputSchema: compareCompanyDataMcpSchema,
            outputSchema: compareCompanyDataMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpCompareCompanyData(input);

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    server.registerTool(
        "group_company_data",
        {
            title: "Group Company Data",
            description: "Group uploaded company data by a column such as department and calculate count or numeric aggregates.",
            inputSchema: groupCompanyDataMcpSchema,
            outputSchema: groupCompanyDataMcpOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async (input) => {
            const result = await mcpGroupCompanyData(input);

            return {
                content: [{ type: "text", text: JSON.stringify(result) }],
                structuredContent: result,
            };
        },
    );

    return server;
}
