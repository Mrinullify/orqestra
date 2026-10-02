import "server-only";

import { prisma } from "@/app/lib/prisma";
import { requireHR } from "@/app/lib/ai/permissions";
import { requireApprovedAction } from "@/app/lib/ai/approvals";
import { writeAuditLog } from "@/app/lib/ai/audit";
import type { ServiceContext } from "@/app/lib/ai/types";

export async function listEmployees(context: ServiceContext) {
    return prisma.user.findMany({
        where: { organizationId: context.organizationId },
        select: {
            id: true,
            name: true,
            email: true,
            department: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function findEmployee(
    context: ServiceContext,
    input: { employeeId?: string; email?: string },
) {
    if (!input.employeeId && !input.email) {
        throw new Error("employeeId or email is required.");
    }

    return prisma.user.findFirst({
        where: {
            organizationId: context.organizationId,
            ...(input.employeeId
                ? { id: input.employeeId }
                : { email: input.email!.trim().toLowerCase() }),
        },
        select: {
            id: true,
            name: true,
            email: true,
            department: true,
            role: true,
            isActive: true,
        },
    });
}

export async function deactivateEmployee(
    context: ServiceContext,
    employeeId: string,
) {
    requireHR(context);

    const employee = await prisma.user.findFirst({
        where: { id: employeeId, organizationId: context.organizationId },
        select: { id: true, email: true, isActive: true },
    });

    if (!employee) throw new Error("Employee not found.");
    if (!employee.isActive) return employee;

    const updated = await prisma.user.update({
        where: { id: employee.id },
        data: { isActive: false },
        select: { id: true, email: true, isActive: true },
    });

    await writeAuditLog({
        context,
        action: "DEACTIVATE_EMPLOYEE",
        resourceType: "USER",
        resourceId: employee.id,
        metadata: { email: employee.email },
    });

    return updated;
}

export async function deleteEmployee(
    context: ServiceContext,
    employeeId: string,
) {
    requireHR(context);
    await requireApprovedAction(context, "DELETE_EMPLOYEE");

    const employee = await prisma.user.findFirst({
        where: { id: employeeId, organizationId: context.organizationId },
        select: { id: true, email: true, name: true },
    });

    if (!employee) throw new Error("Employee not found.");

    await prisma.user.delete({
        where: { id: employee.id },
    });

    await writeAuditLog({
        context,
        action: "DELETE_EMPLOYEE",
        resourceType: "USER",
        resourceId: employee.id,
        metadata: {
            email: employee.email,
            name: employee.name,
        },
    });

    return { deleted: true, employeeId: employee.id };
}
