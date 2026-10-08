import "server-only";

import { NextResponse } from "next/server";

import { getVerifiedAuthSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { headObject } from "@/app/lib/storage";
import { processDataImport } from "@/app/services/data-import/data-import.service";
import type { ServiceContext } from "@/app/lib/ai/types";
import type { OrganizationRole } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        const session = await getVerifiedAuthSession();

        if (session.role !== "HR") {
            return NextResponse.json(
                { error: "Only HR users can import company data." },
                { status: 403 },
            );
        }

        const body = (await request.json()) as {
            dataImportId?: unknown;
        };

        const dataImportId =
            typeof body.dataImportId === "string"
                ? body.dataImportId
                : "";

        if (!dataImportId) {
            return NextResponse.json(
                { error: "dataImportId is required." },
                { status: 400 },
            );
        }

        const dataImport = await prisma.dataImport.findFirst({
            where: {
                id: dataImportId,
                dataSource: {
                    organizationId: session.organizationId,
                },
            },
            include: {
                dataSource: true,
            },
        });

        if (!dataImport) {
            return NextResponse.json(
                { error: "Data import not found." },
                { status: 404 },
            );
        }

        const object = await headObject(dataImport.dataSource.storageKey);

        if (!object.ContentLength || object.ContentLength <= 0) {
            return NextResponse.json(
                { error: "The uploaded file is empty or was not uploaded." },
                { status: 400 },
            );
        }

        if (dataImport.dataSource.sizeBytes?.toString() !== object.ContentLength.toString()) {
            return NextResponse.json(
                { error: "Uploaded file size does not match the expected size." },
                { status: 400 },
            );
        }

        const serviceContext: ServiceContext = {
            userId: session.userId,
            organizationId: session.organizationId,
            role: session.role as OrganizationRole,
            requestId: crypto.randomUUID(),
        };

        const result = await processDataImport(serviceContext, dataImport.id);

        return NextResponse.json({
            success: true,
            dataImport: result,
        });
    } catch (error) {
        console.error("Dataset import failed:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to import the uploaded file.",
            },
            { status: 500 },
        );
    }
}
