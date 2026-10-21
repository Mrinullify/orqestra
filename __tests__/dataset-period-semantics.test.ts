import { requiresReportingPeriod } from "@/app/services/data/period-semantics";

describe("dataset period semantics", () => {
    it("allows additive datasets to aggregate across periods", () => {
        expect(requiresReportingPeriod("ADDITIVE", 12, undefined)).toBe(false);
    });

    it("allows a single snapshot without an explicit period", () => {
        expect(requiresReportingPeriod("SNAPSHOT", 1, undefined)).toBe(false);
    });

    it("requires a period when a snapshot dataset has multiple active imports", () => {
        expect(requiresReportingPeriod("SNAPSHOT", 2, undefined)).toBe(true);
    });

    it("does not require clarification when the user supplied a period", () => {
        expect(requiresReportingPeriod("SNAPSHOT", 4, "January 2026")).toBe(false);
    });

    it("treats a whitespace-only period as missing", () => {
        expect(requiresReportingPeriod("SNAPSHOT", 2, "   ")).toBe(true);
    });
});
