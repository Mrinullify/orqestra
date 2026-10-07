import "server-only";

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 storage environment variables are not configured.");
}

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

export const R2_BUCKET_NAME = bucket;

export async function createUploadUrl(params: {
    key: string;
    contentType: string;
}) {
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.contentType,
    });

    return getSignedUrl(client, command, { expiresIn: 10 * 60 });
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
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
    return client.send(
        new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );
}

export async function deleteObject(key: string) {
    await client.send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );
}
