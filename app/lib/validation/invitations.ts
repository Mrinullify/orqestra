import { z } from "zod";

export const MAX_BATCH_SIZE = Number(process.env.MAX_INVITATION_BATCH ?? "500");

export const EmployeeItemSchema = z.object({
    name: z.string().trim().min(1, "Employee name is required"),
    email: z.string().trim().toLowerCase().email("Invalid work email address"),
    department: z.string().trim().optional().default(""),
});

export const BulkEmployeeBatchSchema = z
    .array(EmployeeItemSchema)
    .min(1, "At least one employee must be provided")
    .max(MAX_BATCH_SIZE, `Batch size cannot exceed ${MAX_BATCH_SIZE} employees`);

export type EmployeeRow = z.infer<typeof EmployeeItemSchema>;

export interface ValidationResult {
    valid: EmployeeRow[];
    errors: Array<{ row: number; email: string; reason: string }>;
    duplicateEmails: string[];
    existingMembers: string[];
    otherOrgEmails: string[];
}

export type InviteState =
    | { errors?: string[]; message?: string; success?: boolean; count?: number }
    | undefined;
