import "server-only";

import type { OrganizationRole } from "../../../generated/prisma/client";
import type { ServiceContext } from "./types";

export class AuthorizationError extends Error {
    constructor(message = "You are not authorized to perform this action.") {
        super(message);
        this.name = "AuthorizationError";
    }
}

export function requireRole(
    context: ServiceContext,
    ...allowedRoles: OrganizationRole[]
): void {
    if (!allowedRoles.includes(context.role)) {
        throw new AuthorizationError();
    }
}

export function requireHR(context: ServiceContext): void {
    requireRole(context, "HR");
}
