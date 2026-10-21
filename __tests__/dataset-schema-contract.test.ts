import {
    normalizeHeaders,
    readDatasetSchemaColumns,
    validateDatasetSchema,
} from "@/app/services/data/schema-contract";

describe("dataset schema contracts", () => {
    it("normalizes headers consistently", () => {
        expect(normalizeHeaders(["Employee ID", "Department Name"])).toEqual([
            "employee_id",
            "department_name",
        ]);
    });

    it("rejects headers that collide after normalization", () => {
        expect(() => normalizeHeaders(["Employee ID", "employee-id"])).toThrow(
            "Duplicate column headers after normalization",
        );
    });

    it("rejects blank or unusable headers", () => {
        expect(() => normalizeHeaders(["Employee ID", "   "])).toThrow(
            "Column headers cannot be empty",
        );
        expect(() => normalizeHeaders(["---"])).toThrow(
            "Column headers cannot be empty",
        );
    });

    it("accepts the same columns even when the file changes column order", () => {
        expect(() =>
            validateDatasetSchema(
                ["employee_id", "department"],
                ["department", "employee_id"],
            ),
        ).not.toThrow();
    });

    it("rejects missing and unexpected columns with an actionable error", () => {
        expect(() =>
            validateDatasetSchema(
                ["employee_id", "department"],
                ["employee_id", "region"],
            ),
        ).toThrow(
            "Missing columns: department. Unexpected columns: region. The existing dataset was not changed.",
        );
    });

    it("reads only well-formed schema contracts", () => {
        expect(readDatasetSchemaColumns({ version: 1, columns: ["employee_id"] })).toEqual([
            "employee_id",
        ]);
        expect(readDatasetSchemaColumns({ columns: ["employee_id", 42] })).toBeNull();
        expect(readDatasetSchemaColumns(null)).toBeNull();
    });
});
