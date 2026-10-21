import "server-only";

import { NextResponse } from "next/server";

import { getVerifiedAuthSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { putLocalObject } from "@/app/lib/storage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function PUT(request: Request) {
    try {
        const session = await getVerifiedAuthSession();

        if (session.role !== "HR") {
            return NextResponse.json(
                { error: "Only HR users can upload company data." },
                { status: 403 },
            );
        }

        const url = new URL(request.url);
        const key = url.searchParams.get("key")?.trim() ?? "";

        if (!key) {
            return NextResponse.json(
                { error: "Storage key is required." },
                { status: 400 },
            );
        }

        const dataSource = await prisma.dataSource.findFirst({
            where: {
                storageKey: key,
                organizationId: session.organizationId,
            },
            select: {
                id: true,
                sizeBytes: true,
            },
        });

        if (!dataSource) {
            return NextResponse.json(
                { error: "Upload target not found." },
                { status: 404 },
            );
        }

        const body = new Uint8Array(await request.arrayBuffer());

        if (body.byteLength <= 0 || body.byteLength > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: "The file must be non-empty and no larger than 100 MB." },
                { status: 400 },
            );
        }

        if (dataSource.sizeBytes?.toString() !== body.byteLength.toString()) {
            return NextResponse.json(
                { error: "Uploaded file size does not match the expected size." },
                { status: 400 },
            );
        }

        await putLocalObject(key, body);

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error("Local dataset upload failed:", error);

        return NextResponse.json(
            { error: "Unable to store the uploaded file." },
            { status: 500 },
        );
    }
}
