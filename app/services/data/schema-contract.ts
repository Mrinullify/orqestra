export type DatasetColumnType = "number" | "date" | "boolean" | "string" | "mixed" | "unknown";

function normalizeNumericValue(value: unknown): string {
    return String(value ?? "").trim().replace(/[$,£€₹\s]/g, "");
}

function isNumericValue(value: unknown): boolean {
    return /^[+-]?((\d+(\.\d*)?)|(\.\d+))$/.test(normalizeNumericValue(value));
}

function isBooleanValue(value: unknown): boolean {
    return /^(true|false|yes|no|y|n)$/i.test(String(value ?? "").trim());
}

function isDateValue(value: unknown): boolean {
    const text = String(value ?? "").trim();
    if (!text || isNumericValue(text)) return false;
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)
        && !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(text)) return false;
    return Number.isFinite(Date.parse(text));
}

function classifyValue(value: unknown): DatasetColumnType {
    if (value === null || value === undefined || String(value).trim() === "") return "unknown";
    if (isNumericValue(value)) return "number";
    if (isBooleanValue(value)) return "boolean";
    if (isDateValue(value)) return "date";
    return "string";
}

export function normalizeColumnName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeHeaders(headers: string[]): string[] {
    const normalized = headers.map(normalizeColumnName);
    const seen = new Set<string>();
    for (const [index, header] of headers.entries()) {
        if (!header.trim() || !normalized[index]) throw new Error("Column headers cannot be empty.");
        if (seen.has(normalized[index])) {
            throw new Error(`Duplicate column headers after normalization: "${header}". Rename the conflicting columns and upload again.`);
        }
        seen.add(normalized[index]);
    }
    return normalized;
}

export function readDatasetSchemaColumns(value: unknown): string[] | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const columns = (value as Record<string, unknown>).columns;
    if (!Array.isArray(columns) || !columns.every((column) => typeof column === "string")) return null;
    return columns;
}

export function readDatasetSchemaTypes(value: unknown): Record<string, DatasetColumnType> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const types = (value as Record<string, unknown>).types;
    if (!types || typeof types !== "object" || Array.isArray(types)) return null;
    return types as Record<string, DatasetColumnType>;
}

export function inferDatasetColumnTypes(
    rows: Array<Record<string, unknown>>,
    originalHeaders: string[],
    normalizedHeaders: string[],
): Record<string, DatasetColumnType> {
    const result: Record<string, DatasetColumnType> = {};
    normalizedHeaders.forEach((normalizedHeader, index) => {
        const kinds = new Set<DatasetColumnType>();
        for (const row of rows) {
            const kind = classifyValue(row[originalHeaders[index]]);
            if (kind !== "unknown") kinds.add(kind);
        }
        result[normalizedHeader] = kinds.size === 0
            ? "unknown"
            : kinds.size === 1
              ? [...kinds][0]
              : "mixed";
    });
    return result;
}

export function validateDatasetColumnTypes(
    expectedTypes: Record<string, DatasetColumnType> | null,
    rows: Array<Record<string, unknown>>,
    originalHeaders: string[],
    normalizedHeaders: string[],
) {
    if (!expectedTypes) return;

    const headerIndexByName = new Map(normalizedHeaders.map((name, index) => [name, index]));
    const errors: string[] = [];

    for (const [column, expectedType] of Object.entries(expectedTypes)) {
        if (!["number", "date", "boolean"].includes(expectedType)) continue;
        const headerIndex = headerIndexByName.get(column);
        if (headerIndex === undefined) continue;

        const invalidRows: number[] = [];
        rows.forEach((row, index) => {
            const value = row[originalHeaders[headerIndex]];
            if (value === null || value === undefined || String(value).trim() === "") return;
            const valid = expectedType === "number"
                ? isNumericValue(value)
                : expectedType === "date"
                  ? isDateValue(value)
                  : isBooleanValue(value);
            if (!valid && invalidRows.length < 3) invalidRows.push(index + 2);
        });

        if (invalidRows.length) {
            errors.push(`"${column}" must contain ${expectedType} values (invalid row numbers: ${invalidRows.join(", ")}).`);
        }
    }

    if (errors.length) {
        throw new Error(
            `This file contains values that do not match the dataset's column types. ${errors.join(" ")} The existing dataset was not changed.`,
        );
    }
}

/** Header order may differ between files, but names must match exactly after normalization. */
export function validateDatasetSchema(expected: string[], actual: string[]) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((column) => !actualSet.has(column));
    const unexpected = actual.filter((column) => !expectedSet.has(column));
    if (missing.length || unexpected.length) {
        const details = [
            missing.length ? `Missing columns: ${missing.join(", ")}` : "",
            unexpected.length ? `Unexpected columns: ${unexpected.join(", ")}` : "",
        ].filter(Boolean).join(". ");
        throw new Error(`This file does not match the schema for this dataset. ${details}. The existing dataset was not changed.`);
    }
}
