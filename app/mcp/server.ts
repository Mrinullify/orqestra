import "server-only";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
    employeeIdSchema,
    employeeListOutputSchema,
    employeeOutputSchema,
    findEmployeeSchema,
    deleteEmployeeMcpSchema,
    mcpDeactivateEmployee,
    mcpDeleteEmployee,
    mcpFindEmployee,
    mcpListEmployees,
} from "./tools/employees";

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
            outputSchema: employeeOutputSchema,
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

    return server;
}
