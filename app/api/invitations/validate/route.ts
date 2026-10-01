import { NextRequest, NextResponse } from "next/server";
import { getVerifiedSession } from "@/app/lib/auth";
import { validateEmployeeRows, type EmployeeRow } from "@/app/actions/invitations";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    let auth;
    try {
        auth = await getVerifiedSession();
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (auth.role !== "HR") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.rows)) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const rows: EmployeeRow[] = body.rows;
    const result = await validateEmployeeRows(rows, auth.organizationId);
    return NextResponse.json(result);
}
