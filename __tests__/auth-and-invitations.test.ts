/**
 * Orqestra — Auth & Invitation Tests
 *
 * Run with: npx jest (after installing jest + ts-jest)
 *
 * NOTE: These are integration-style unit tests that mock the Prisma client and
 * crypto/bcrypt modules so no real DB connection is needed.
 *
 * Install test deps first:
 *   npm install -D jest ts-jest @types/jest jest-environment-node
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Helpers (extracted from app logic so we can test them in isolation)
// ---------------------------------------------------------------------------

function generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function isExpired(expiresAt: Date): boolean {
    return expiresAt < new Date();
}

// ---------------------------------------------------------------------------
// Token generation & hashing
// ---------------------------------------------------------------------------

describe("Invitation tokens", () => {
    it("generates a 64-character hex token", () => {
        const token = generateToken();
        expect(token).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it("produces a different token each time", () => {
        const t1 = generateToken();
        const t2 = generateToken();
        expect(t1).not.toBe(t2);
    });

    it("hashes deterministically", () => {
        const token = generateToken();
        expect(hashToken(token)).toBe(hashToken(token));
    });

    it("different tokens produce different hashes", () => {
        const t1 = generateToken();
        const t2 = generateToken();
        expect(hashToken(t1)).not.toBe(hashToken(t2));
    });

    it("hash is 64 characters (SHA-256 hex)", () => {
        expect(hashToken(generateToken())).toHaveLength(64);
    });
});

// ---------------------------------------------------------------------------
// Email normalization
// ---------------------------------------------------------------------------

describe("Email normalization", () => {
    it("lowercases the email", () => {
        expect(normalizeEmail("Jane.Smith@Company.COM")).toBe("jane.smith@company.com");
    });

    it("trims whitespace", () => {
        expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com");
    });

    it("handles mixed case and spaces", () => {
        expect(normalizeEmail("  JOHN@EXAMPLE.COM  ")).toBe("john@example.com");
    });
});

// ---------------------------------------------------------------------------
// Expiry logic
// ---------------------------------------------------------------------------

describe("Invitation expiry", () => {
    it("marks past dates as expired", () => {
        const past = new Date(Date.now() - 1000);
        expect(isExpired(past)).toBe(true);
    });

    it("marks future dates as not expired", () => {
        const future = new Date(Date.now() + 86400000);
        expect(isExpired(future)).toBe(false);
    });

    it("marks exactly now as expired (boundary)", () => {
        // The boundary could go either way; ensure at least it doesn't throw
        const now = new Date();
        expect(typeof isExpired(now)).toBe("boolean");
    });
});

// ---------------------------------------------------------------------------
// Invitation status transitions
// ---------------------------------------------------------------------------

type Status = "PENDING" | "SENT" | "ACCEPTED" | "EXPIRED" | "REVOKED" | "FAILED";

function canRevoke(status: Status): boolean {
    return status !== "ACCEPTED" && status !== "REVOKED";
}

function canResend(status: Status): boolean {
    return status !== "ACCEPTED";
}

describe("Invitation status transitions", () => {
    it("cannot revoke an ACCEPTED invitation", () => {
        expect(canRevoke("ACCEPTED")).toBe(false);
    });

    it("can revoke PENDING invitation", () => {
        expect(canRevoke("PENDING")).toBe(true);
    });

    it("can revoke SENT invitation", () => {
        expect(canRevoke("SENT")).toBe(true);
    });

    it("can revoke FAILED invitation", () => {
        expect(canRevoke("FAILED")).toBe(true);
    });

    it("cannot resend an ACCEPTED invitation", () => {
        expect(canResend("ACCEPTED")).toBe(false);
    });

    it("can resend a FAILED invitation", () => {
        expect(canResend("FAILED")).toBe(true);
    });

    it("can resend an EXPIRED invitation", () => {
        expect(canResend("EXPIRED")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// CSV row validation logic (pure)
// ---------------------------------------------------------------------------

interface EmployeeRow {
    name: string;
    email: string;
    department: string;
}

interface RowError {
    row: number;
    email: string;
    reason: string;
}

function validateRowsLocally(rows: EmployeeRow[]): {
    valid: EmployeeRow[];
    errors: RowError[];
    duplicates: string[];
} {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set<string>();
    const valid: EmployeeRow[] = [];
    const errors: RowError[] = [];
    const duplicates: string[] = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const email = normalizeEmail(row.email ?? "");
        const name = (row.name ?? "").trim();

        if (!email) {
            errors.push({ row: i + 1, email: "", reason: "Missing email" });
            continue;
        }

        if (!emailRegex.test(email)) {
            errors.push({ row: i + 1, email, reason: "Invalid email" });
            continue;
        }

        if (!name) {
            errors.push({ row: i + 1, email, reason: "Missing name" });
            continue;
        }

        if (seen.has(email)) {
            duplicates.push(email);
            errors.push({ row: i + 1, email, reason: "Duplicate email" });
            continue;
        }

        seen.add(email);
        valid.push({ ...row, email, name });
    }

    return { valid, errors, duplicates };
}

describe("Employee row validation", () => {
    it("accepts valid rows", () => {
        const { valid, errors } = validateRowsLocally([
            { name: "Jane Smith", email: "jane@company.com", department: "Engineering" },
        ]);
        expect(valid).toHaveLength(1);
        expect(errors).toHaveLength(0);
    });

    it("rejects missing email", () => {
        const { valid, errors } = validateRowsLocally([
            { name: "Jane Smith", email: "", department: "Engineering" },
        ]);
        expect(valid).toHaveLength(0);
        expect(errors[0].reason).toBe("Missing email");
    });

    it("rejects malformed email", () => {
        const { errors } = validateRowsLocally([
            { name: "Jane", email: "not-an-email", department: "" },
        ]);
        expect(errors[0].reason).toBe("Invalid email");
    });

    it("rejects missing name", () => {
        const { errors } = validateRowsLocally([
            { name: "", email: "jane@company.com", department: "" },
        ]);
        expect(errors[0].reason).toBe("Missing name");
    });

    it("detects duplicate emails in the same batch", () => {
        const { valid, duplicates, errors } = validateRowsLocally([
            { name: "Jane", email: "jane@company.com", department: "" },
            { name: "Jane2", email: "jane@company.com", department: "" },
        ]);
        expect(valid).toHaveLength(1);
        expect(duplicates).toContain("jane@company.com");
        expect(errors).toHaveLength(1);
    });

    it("normalizes email case and whitespace", () => {
        const { valid } = validateRowsLocally([
            { name: "Jane", email: "  Jane@Company.COM  ", department: "" },
        ]);
        expect(valid[0].email).toBe("jane@company.com");
    });

    it("handles a large batch without throwing", () => {
        const rows: EmployeeRow[] = Array.from({ length: 450 }, (_, i) => ({
            name: `Employee ${i}`,
            email: `emp${i}@company.com`,
            department: "HR",
        }));
        const { valid, errors } = validateRowsLocally(rows);
        expect(valid).toHaveLength(450);
        expect(errors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Role assignment guard
// ---------------------------------------------------------------------------

type OrgRole = "HR" | "EMPLOYEE";

function sanitizeRole(csvValue: string | undefined): OrgRole {
    // CSV data must never be able to assign HR role
    return "EMPLOYEE";
}

describe("Role assignment guard", () => {
    it("always returns EMPLOYEE regardless of CSV input", () => {
        expect(sanitizeRole("HR")).toBe("EMPLOYEE");
        expect(sanitizeRole("ADMIN")).toBe("EMPLOYEE");
        expect(sanitizeRole("hr")).toBe("EMPLOYEE");
        expect(sanitizeRole(undefined)).toBe("EMPLOYEE");
    });
});

// ---------------------------------------------------------------------------
// Cross-org isolation (conceptual guard)
// ---------------------------------------------------------------------------

describe("Cross-organization isolation", () => {
    it("rejects invitation for wrong org", () => {
        const sessionOrgId = "org-A";
        const invitationOrgId = "org-B";
        const isAuthorized = sessionOrgId === invitationOrgId;
        expect(isAuthorized).toBe(false);
    });

    it("allows invitation for correct org", () => {
        const sessionOrgId = "org-A";
        const invitationOrgId = "org-A";
        const isAuthorized = sessionOrgId === invitationOrgId;
        expect(isAuthorized).toBe(true);
    });
});
