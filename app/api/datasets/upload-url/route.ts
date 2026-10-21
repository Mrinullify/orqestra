import "server-only";

import { NextResponse } from "next/server";
import crypto from "crypto";

import { getVerifiedAuthSession } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createUploadUrl } from "@/app/lib/storage";

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
            datasetName?: unknown;
            reportingPeriod?: unknown;
            replaceExistingPeriod?: unknown;
            sizeBytes?: unknown;
            contentType?: unknown;
        };

        const fileName =
            typeof body.fileName === "string" ? body.fileName.trim() : "";
        const datasetName =
            typeof body.datasetName === "string" ? body.datasetName.trim() : "";
        const reportingPeriod =
            typeof body.reportingPeriod === "string" && body.reportingPeriod.trim()
                ? body.reportingPeriod.trim()
                : null;
        const replaceExistingPeriod = body.replaceExistingPeriod === true;
        const sizeBytes =
            typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
        const requestedContentType =
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

        if (datasetName.length < 2 || datasetName.length > 80) {
            return NextResponse.json(
                { error: "Dataset name must contain between 2 and 80 characters." },
                { status: 400 },
            );
        }

        if (reportingPeriod && reportingPeriod.length > 80) {
            return NextResponse.json(
                { error: "Reporting period must be 80 characters or fewer." },
                { status: 400 },
            );
        }

        if (replaceExistingPeriod && !reportingPeriod) {
            return NextResponse.json(
                { error: "A reporting period is required when replacing existing period data." },
                { status: 400 },
            );
        }

        if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: "The file must be non-empty and no larger than 100 MB." },
                { status: 400 },
            );
        }

        const matchingSources = await prisma.dataSource.findMany({
            where: {
                organizationId: session.organizationId,
                name: { equals: datasetName, mode: "insensitive" },
            },
            take: 2,
            select: { id: true, schema: true },
        });

        if (matchingSources.length > 1) {
            return NextResponse.json(
                { error: "More than one existing dataset has this name. Rename or reconcile the existing datasets before uploading more files." },
                { status: 409 },
            );
        }

        const existingSource = matchingSources[0] ?? null;

        if (existingSource && reportingPeriod) {
            const existingPeriod = await prisma.dataImport.findFirst({
                where: {
                    dataSourceId: existingSource.id,
                    reportingPeriod,
                    status: "COMPLETED",
                    isActive: true,
                },
                select: { id: true },
            });

            if (existingPeriod && !replaceExistingPeriod) {
                return NextResponse.json(
                    { error: `The period "${reportingPeriod}" already exists in this dataset. Enable "Replace existing period" to replace it safely, or choose a different period.` },
                    { status: 409 },
                );
            }
        }

        const dataSourceId = existingSource?.id ?? crypto.randomUUID();
        const dataImportId = crypto.randomUUID();
        const storageKey =
            `organizations/${session.organizationId}/data-sources/${dataSourceId}/imports/${dataImportId}/${safeFileName(fileName)}`;
        const mimeType = requestedContentType;

        if (existingSource) {
            await prisma.dataImport.create({
                data: {
                    id: dataImportId,
                    dataSourceId,
                    originalName: fileName,
                    storageKey,
                    fileType: fileConfig.type,
                    mimeType,
                    sizeBytes,
                    reportingPeriod,
                    replaceExistingPeriod,
                },
            });
        } else {
            await prisma.dataSource.create({
                data: {
                    id: dataSourceId,
                    name: datasetName,
                    originalName: fileName,
                    type: fileConfig.type,
                    mimeType,
                    sizeBytes,
                    storageKey,
                    organizationId: session.organizationId,
                    imports: {
                        create: {
                            id: dataImportId,
                            originalName: fileName,
                            storageKey,
                            fileType: fileConfig.type,
                            mimeType,
                            sizeBytes,
                            reportingPeriod,
                            replaceExistingPeriod,
                        },
                    },
                },
            });
        }

        const uploadUrl = await createUploadUrl({
            key: storageKey,
            contentType: mimeType,
        });

        return NextResponse.json({
            dataSourceId,
            dataImportId,
            datasetName,
            existingDataset: Boolean(existingSource),
            hasSchema: Boolean(existingSource?.schema),
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
