import "server-only";

import { NextResponse } from "next/server";
import crypto from "crypto";

import { getVerifiedAuthSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createUploadUrl } from "@/app/lib/r2";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const allowedExtensions = new Map([
    [".csv", { type: "CSV" as const, mimeType: "text/csv" }],
    [".xlsx", {
        type: "EXCEL" as const,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }],
    [".xls", {
        type: "EXCEL" as const,
        mimeType: "application/vnd.ms-excel",
    }],
]);

function getExtension(name: string) {
    const lower = name.toLowerCase();
    const index = lower.lastIndexOf(".");
    return index >= 0 ? lower.slice(index) : "";
}

function safeFileName(name: string) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export async function POST(request: Request) {
    try {
        const session = await getVerifiedAuthSession();

        if (session.role !== "HR") {
            return NextResponse.json(
                { error: "Only HR users can upload company data." },
                { status: 403 },
            );
        }

        const body = (await request.json()) as {
            fileName?: unknown;
            sizeBytes?: unknown;
            contentType?: unknown;
        };

        const fileName =
            typeof body.fileName === "string" ? body.fileName.trim() : "";
        const sizeBytes =
            typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
        const contentType =
            typeof body.contentType === "string" && body.contentType
                ? body.contentType
                : "application/octet-stream";

        const extension = getExtension(fileName);
        const fileConfig = allowedExtensions.get(extension);

        if (!fileName || !fileConfig) {
            return NextResponse.json(
                { error: "Only CSV, XLS, and XLSX files are supported." },
                { status: 400 },
            );
        }

        if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: "The file must be non-empty and no larger than 100 MB." },
                { status: 400 },
            );
        }

        const dataSourceId = crypto.randomUUID();
        const storageKey =
            `organizations/${session.organizationId}/data-sources/${dataSourceId}/${safeFileName(fileName)}`;

        const dataSource = await prisma.dataSource.create({
            data: {
                id: dataSourceId,
                name: fileName,
                originalName: fileName,
                type: fileConfig.type,
                mimeType: contentType || fileConfig.mimeType,
                sizeBytes,
                storageKey,
                organizationId: session.organizationId,
                imports: {
                    create: {},
                },
            },
            include: {
                imports: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });

        const dataImport = dataSource.imports[0];
        if (!dataImport) {
            throw new Error("Unable to create data import.");
        }

        const uploadUrl = await createUploadUrl({
            key: storageKey,
            contentType,
        });

        return NextResponse.json({
            dataSourceId: dataSource.id,
            dataImportId: dataImport.id,
            storageKey,
            uploadUrl,
            expiresInSeconds: 600,
        });
    } catch (error) {
        console.error("Dataset upload URL creation failed:", error);

        return NextResponse.json(
            { error: "Unable to prepare the file upload." },
            { status: 500 },
        );
    }
}
