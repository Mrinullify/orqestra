import { NextRequest, NextResponse } from "next/server";
import { requireHRRole } from "@/app/lib/auth";
import { validateEmployeeRowsServer } from "@/app/actions/invitations";
import type { EmployeeRow } from "@/app/lib/validation/invitations";
import { checkRateLimit, RATE_LIMITS } from "@/app/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    let authSession;
    try {
        authSession = await requireHRRole();
    } catch {
        return NextResponse.json({ error: "Unauthorized or insufficient permissions." }, { status: 401 });
    }

    // Rate Limiting Check
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const rlKey = `validate:${authSession.userId}:${ip}`;
    const rl = await checkRateLimit(
        rlKey,
        RATE_LIMITS.VALIDATE.maxRequests,
        RATE_LIMITS.VALIDATE.windowSeconds
    );

    if (!rl.success) {
        return NextResponse.json(
            { error: "Rate limit exceeded. Please wait before re-validating." },
            { status: 429 }
        );
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.rows)) {
        return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }

    const rows: EmployeeRow[] = body.rows;
    const result = await validateEmployeeRowsServer(rows, authSession.organizationId);
    return NextResponse.json(result);
}
