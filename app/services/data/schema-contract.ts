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
