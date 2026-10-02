import "server-only";

import { z } from "zod";
import type { ToolDefinition } from "@/app/lib/ai/types";
import {
    deleteEmployee,
    deactivateEmployee,
    findEmployee,
    listEmployees,
} from "@/app/services/employees/employee.service";

const listEmployeesSchema = z.object({}).strict();
const findEmployeeSchema = z.object({
    employeeId: z.string().min(1).optional(),
    email: z.string().email().optional(),
}).refine((value) => value.employeeId || value.email, {
    message: "employeeId or email is required",
});

const employeeIdSchema = z.object({ employeeId: z.string().min(1) });

type ListEmployeesInput = z.infer<typeof listEmployeesSchema>;
type FindEmployeeInput = z.infer<typeof findEmployeeSchema>;
type EmployeeIdInput = z.infer<typeof employeeIdSchema>;

const listEmployeesTool: ToolDefinition<typeof listEmployeesSchema> = {
    name: "list_employees",
    description: "List employees belonging to the authenticated user's organization.",
    inputSchema: listEmployeesSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (_input: ListEmployeesInput, context) => listEmployees(context),
};

const findEmployeeTool: ToolDefinition<typeof findEmployeeSchema> = {
    name: "find_employee",
    description: "Find one employee by organization-scoped employee ID or email.",
    inputSchema: findEmployeeSchema,
    allowedRoles: ["HR", "EMPLOYEE"],
    execute: async (input: FindEmployeeInput, context) => findEmployee(context, input),
};

const deactivateEmployeeTool: ToolDefinition<typeof employeeIdSchema> = {
    name: "deactivate_employee",
    description: "Deactivate an employee without deleting their record.",
    inputSchema: employeeIdSchema,
    allowedRoles: ["HR"],
    requiresApproval: false,
    execute: async (input: EmployeeIdInput, context) =>
        deactivateEmployee(context, input.employeeId),
};

const deleteEmployeeTool: ToolDefinition<typeof employeeIdSchema> = {
    name: "delete_employee",
    description: "Permanently delete one employee. This is destructive and requires explicit approval.",
    inputSchema: employeeIdSchema,
    allowedRoles: ["HR"],
    requiresApproval: true,
    execute: async (input: EmployeeIdInput, context) =>
        deleteEmployee(context, input.employeeId),
};

export const employeeTools = [
    listEmployeesTool,
    findEmployeeTool,
    deactivateEmployeeTool,
    deleteEmployeeTool,
];
