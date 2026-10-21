import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".orqestra-storage");

function getStorageProvider(): "local" | "r2" {
    const configured = process.env.STORAGE_PROVIDER;

    if (configured === "local" || configured === "r2") {
        return configured;
    }

    return process.env.NODE_ENV === "production" ? "r2" : "local";
}

function getR2Config() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET_NAME;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error("R2 storage environment variables are not configured.");
    }

    return {
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        accessKeyId,
        secretAccessKey,
        bucket,
    };
}

function getR2Client() {
    const config = getR2Config();

    return {
        client: new S3Client({
            region: "auto",
            endpoint: config.endpoint,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        }),
        bucket: config.bucket,
    };
}

function getLocalPath(key: string) {
    const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const resolved = path.resolve(LOCAL_STORAGE_ROOT, normalizedKey);
    const root = path.resolve(LOCAL_STORAGE_ROOT);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error("Invalid storage key.");
    }

    return resolved;
}

async function createLocalUploadUrl(key: string) {
    const params = new URLSearchParams({ key });
    return `/api/datasets/upload-file?${params.toString()}`;
}

export async function createUploadUrl(params: {
    key: string;
    contentType: string;
}) {
    if (getStorageProvider() === "local") {
        return createLocalUploadUrl(params.key);
    }

    const { client, bucket } = getR2Client();

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.contentType,
    });

    return getSignedUrl(client, command, { expiresIn: 10 * 60 });
}

export async function putLocalObject(key: string, body: Uint8Array) {
    if (getStorageProvider() !== "local") {
        throw new Error("Local storage is not enabled.");
    }

    const filePath = getLocalPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
    if (getStorageProvider() === "local") {
        return fs.readFile(getLocalPath(key));
    }

    const { client, bucket } = getR2Client();

    const response = await client.send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );

    if (!response.Body) {
        throw new Error("Uploaded object has no content.");
    }

    return response.Body.transformToByteArray();
}

export async function headObject(key: string) {
    if (getStorageProvider() === "local") {
        const stats = await fs.stat(getLocalPath(key));

        return {
            ContentLength: stats.size,
        };
    }

    const { client, bucket } = getR2Client();

    return client.send(
        new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );
}

export function isLocalStorage() {
    return getStorageProvider() === "local";
}
