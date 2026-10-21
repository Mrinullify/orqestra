import {
    inferDatasetColumnTypes,
    normalizeHeaders,
    readDatasetSchemaColumns,
    validateDatasetColumnTypes,
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

    it("infers numeric and string columns from the first successful import", () => {
        const rows = [
            { salary: "$72,000", department: "Sales" },
            { salary: "$81,500", department: "Engineering" },
            { salary: "", department: "Sales" },
        ];
        expect(inferDatasetColumnTypes(rows, ["salary", "department"], ["salary", "department"])).toEqual({
            salary: "number",
            department: "string",
        });
    });

    it("does not infer malformed thousands separators as numeric", () => {
        expect(inferDatasetColumnTypes(
            [{ amount: "1,2" }],
            ["amount"],
            ["amount"],
        )).toEqual({ amount: "string" });
    });

    it("rejects type drift in a previously numeric column", () => {
        expect(() =>
            validateDatasetColumnTypes(
                { salary: "number" },
                [{ salary: "not disclosed" }],
                ["salary"],
                ["salary"],
            ),
        ).toThrow("must contain number values");
    });

    it("allows empty values in typed columns without treating them as type drift", () => {
        expect(() =>
            validateDatasetColumnTypes(
                { salary: "number" },
                [{ salary: "75000" }, { salary: "" }, { salary: null }],
                ["salary"],
                ["salary"],
            ),
        ).not.toThrow();
    });
});
