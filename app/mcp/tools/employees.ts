import "server-only";

import { z } from "zod/v4";

import {
    deleteEmployee,
    deactivateEmployee,
    findEmployee,
    listEmployees,
} from "@/app/services/employees/employee.service";
import { getToolContext } from "@/app/lib/ai/context";
import { requireRole } from "@/app/lib/ai/permissions";
import {
    findEmployeeSchema,
    employeeIdSchema,
} from "@/app/ai/tools/employees";

const deleteEmployeeMcpSchema = employeeIdSchema.extend({
    approvalId: z.string().min(1),
});

const employeeOutputSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    department: z.string().nullable(),
    role: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const employeeListOutputSchema = z.object({
    employees: z.array(employeeOutputSchema),
});

const employeeActionOutputSchema = z.object({
    id: z.string(),
    email: z.string(),
    isActive: z.boolean(),
});

export async function mcpListEmployees() {
    const context = await getToolContext("MCP");
    const employees = await listEmployees(context);

    return {
        employees: employees.map((employee) => ({
            ...employee,
            createdAt: employee.createdAt.toISOString(),
            updatedAt: employee.updatedAt.toISOString(),
        })),
    };
}

export async function mcpFindEmployee(input: z.infer<typeof findEmployeeSchema>) {
    const context = await getToolContext("MCP");
    const employee = await findEmployee(context, input);

    if (!employee) {
        throw new Error("Employee not found.");
    }

    return {
        ...employee,
        createdAt: employee.createdAt.toISOString(),
        updatedAt: employee.updatedAt.toISOString(),
    };
}

export async function mcpDeactivateEmployee(
    input: z.infer<typeof employeeIdSchema>,
) {
    const context = await getToolContext("MCP");
    requireRole(context, "HR");

    return deactivateEmployee(context, input.employeeId);
}

export async function mcpDeleteEmployee(
    input: z.infer<typeof deleteEmployeeMcpSchema>,
) {
    const context = await getToolContext("MCP");
    requireRole(context, "HR");

    const result = await deleteEmployee(
        { ...context, approvalId: input.approvalId },
        input.employeeId,
    );

    return result;
}

export {
    deleteEmployeeMcpSchema,
    employeeIdSchema,
    employeeOutputSchema,
    employeeListOutputSchema,
    employeeActionOutputSchema,
    findEmployeeSchema,
};
