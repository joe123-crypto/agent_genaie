import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config, requireConfig } from "@/src/config";
import { httpError } from "@/src/lib/utils";

let cachedClient: S3Client | null = null;

export function getR2Client() {
  if (cachedClient) return cachedClient;
  requireConfig(["r2AccountId", "r2AccessKeyId", "r2SecretAccessKey", "r2Bucket", "r2Endpoint"]);
  cachedClient = new S3Client({
    region: "auto",
    endpoint: config.r2Endpoint,
    // R2 supports path-style addressing (Cloudflare's S3 API recommends it), so
    // this is behavior-neutral against R2 while also letting the same client work
    // against S3-compatible servers reached by host/IP (e.g. MinIO in CI), where
    // virtual-hosted-style bucket prefixes can't resolve.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
  return cachedClient;
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: config.r2Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const result = await getR2Client().send(
    new GetObjectCommand({ Bucket: config.r2Bucket, Key: key }),
  );
  const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body || typeof body.transformToByteArray !== "function") {
    throw httpError(500, "Stored object could not be read.");
  }
  return Buffer.from(await body.transformToByteArray());
}

export async function getPresignedGetUrl(key: string, expiresInSeconds = 300) {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: config.r2Bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteObject(key: string) {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: key }));
}

export async function objectExists(key: string) {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") return false;
    throw err;
  }
}
