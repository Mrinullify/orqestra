export type DatasetPeriodMode = "ADDITIVE" | "SNAPSHOT";

/**
 * Additive datasets (for example, monthly sales) can be aggregated across
 * periods. Snapshot datasets (for example, employee rosters) describe separate
 * states and must not be combined when more than one active import exists.
 */
export function requiresReportingPeriod(
    mode: DatasetPeriodMode,
    activeImportCount: number,
    reportingPeriod?: string | null,
): boolean {
    return mode === "SNAPSHOT"
        && activeImportCount > 1
        && !reportingPeriod?.trim();
}
