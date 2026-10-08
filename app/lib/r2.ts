import "server-only";

import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function createUploadUrl(params: {
    key: string;
    contentType: string;
}) {
    const { client, bucket } = getR2Client();

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: params.contentType,
    });

    return getSignedUrl(client, command, { expiresIn: 10 * 60 });
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
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
    const { client, bucket } = getR2Client();

    return client.send(
        new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
        }),
    );
}
