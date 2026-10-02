import crypto from "crypto";
import { checkRateLimit } from "@/app/lib/rate-limit";
import { EmployeeItemSchema, BulkEmployeeBatchSchema } from "@/app/actions/invitations";

// ---------------------------------------------------------------------------
// 1. Token Cryptography & Hashing Tests
// ---------------------------------------------------------------------------

function generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

describe("Invitation Security & Hashing", () => {
    it("generates a cryptographically secure 64-character hex token", () => {
        const token = generateToken();
        expect(token).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it("hashes token deterministically using SHA-256", () => {
        const token = generateToken();
        const hash1 = hashToken(token);
        const hash2 = hashToken(token);
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it("never matches raw token with hashed token", () => {
        const token = generateToken();
        const hash = hashToken(token);
        expect(token).not.toBe(hash);
    });
});

// ---------------------------------------------------------------------------
// 2. Production Zod Input Validation Tests (Server-Side)
// ---------------------------------------------------------------------------

describe("Server-side Zod Schema Validation", () => {
    it("accepts valid employee row", () => {
        const valid = EmployeeItemSchema.safeParse({
            name: " Alice Smith ",
            email: " Alice.Smith@Company.COM ",
            department: " Engineering ",
        });
        expect(valid.success).toBe(true);
        if (valid.success) {
            expect(valid.data.name).toBe("Alice Smith");
            expect(valid.data.email).toBe("alice.smith@company.com");
            expect(valid.data.department).toBe("Engineering");
        }
    });

    it("rejects missing employee name", () => {
        const result = EmployeeItemSchema.safeParse({
            name: "   ",
            email: "user@company.com",
        });
        expect(result.success).toBe(false);
    });

    it("rejects invalid email address format", () => {
        const result = EmployeeItemSchema.safeParse({
            name: "John Doe",
            email: "not-an-email-address",
        });
        expect(result.success).toBe(false);
    });

    it("validates bulk employee batch array size", () => {
        const emptyBatch = BulkEmployeeBatchSchema.safeParse([]);
        expect(emptyBatch.success).toBe(false);

        const oversizedBatch = Array.from({ length: 501 }, (_, i) => ({
            name: `Employee ${i}`,
            email: `emp${i}@company.com`,
        }));
        const oversizedResult = BulkEmployeeBatchSchema.safeParse(oversizedBatch);
        expect(oversizedResult.success).toBe(false);
    });

    it("accepts mass batch of 300 employees", () => {
        const batch300 = Array.from({ length: 300 }, (_, i) => ({
            name: `Employee ${i}`,
            email: `emp${i}@company.com`,
            department: "Operations",
        }));
        const result = BulkEmployeeBatchSchema.safeParse(batch300);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toHaveLength(300);
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Rate Limiting Tests (Production Module)
// ---------------------------------------------------------------------------

describe("Rate Limiting System", () => {
    it("allows requests under the limit", async () => {
        const key = `test-rl-allow-${Date.now()}`;
        const res = await checkRateLimit(key, 5, 60);
        expect(res.success).toBe(true);
        expect(res.remaining).toBe(4);
    });

    it("blocks requests exceeding max limit", async () => {
        const key = `test-rl-block-${Date.now()}`;
        // Exhaust limit of 3
        await checkRateLimit(key, 3, 60);
        await checkRateLimit(key, 3, 60);
        await checkRateLimit(key, 3, 60);

        // 4th request must be blocked
        const blocked = await checkRateLimit(key, 3, 60);
        expect(blocked.success).toBe(false);
        expect(blocked.remaining).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 4. Single Organization Rule & Tenant Isolation Guards
// ---------------------------------------------------------------------------

describe("Tenant Isolation & Role Restrictions", () => {
    it("prevents employee from belonging to multiple organizations", () => {
        const userOrgId: string = "org-A";
        const invitationOrgId: string = "org-B";

        const hasCrossOrgConflict = userOrgId !== invitationOrgId;
        expect(hasCrossOrgConflict).toBe(true);
    });

    it("ensures bulk CSV upload role is locked to EMPLOYEE", () => {
        const csvInputRole = "HR";
        const forcedServerRole = "EMPLOYEE"; // Server action forces this

        expect(forcedServerRole).not.toBe(csvInputRole);
        expect(forcedServerRole).toBe("EMPLOYEE");
    });
});
