import "server-only";

import { z } from "zod";
import type { ToolDefinition } from "@/app/lib/ai/types";
import {
    deleteEmployee,
    deactivateEmployee,
    findEmployee,
    listEmployees,
} from "@/app/services/employees/employee.service";

export const employeeTools: ToolDefinition[] = [
    {
        name: "list_employees",
        description: "List employees belonging to the authenticated user's organization.",
        inputSchema: z.object({}),
        allowedRoles: ["HR", "EMPLOYEE"],
        execute: async (_input, context) => listEmployees(context),
    },
    {
        name: "find_employee",
        description: "Find one employee by organization-scoped employee ID or email.",
        inputSchema: z.object({
            employeeId: z.string().optional(),
            email: z.string().email().optional(),
        }).refine((value) => value.employeeId || value.email, {
            message: "employeeId or email is required",
        }),
        allowedRoles: ["HR", "EMPLOYEE"],
        execute: async (input, context) => findEmployee(context, input),
    },
    {
        name: "deactivate_employee",
        description: "Deactivate an employee without deleting their record.",
        inputSchema: z.object({ employeeId: z.string().min(1) }),
        allowedRoles: ["HR"],
        requiresApproval: false,
        execute: async (input, context) =>
            deactivateEmployee(context, input.employeeId),
    },
    {
        name: "delete_employee",
        description: "Permanently delete one employee. This is destructive and requires explicit approval.",
        inputSchema: z.object({ employeeId: z.string().min(1) }),
        allowedRoles: ["HR"],
        requiresApproval: true,
        execute: async (input, context) =>
            deleteEmployee(context, input.employeeId),
    },
];
