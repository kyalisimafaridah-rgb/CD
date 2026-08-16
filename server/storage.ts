// Cloudflare R2 (S3-compatible) file storage.
//
// Replaces the previous Manus "forge" storage proxy. R2 is accessed via
// the standard AWS S3 SDK pointed at R2's S3-compatible endpoint - no
// Cloudflare-specific SDK needed.

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

let _client: S3Client | null = null;

type StorageConfig = { client: S3Client; bucket: string };

function getStorageConfig(): StorageConfig {
  const { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket } = ENV;

  if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2Bucket) {
    throw new Error(
      "R2 storage not configured: set CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME"
    );
  }

  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });
  }

  return { client: _client, bucket: r2Bucket };
}

function normalizeKey(relKey: string): string {
  const stripped = relKey.replace(/^\/+/, "");
  // Reject traversal segments outright rather than trying to resolve them —
  // a caller-controlled filename (e.g. a patient photo upload) must never be
  // able to escape its intended prefix. Fail loudly; callers should generate
  // safe keys (patientId + extension) rather than trusting raw filenames.
  if (stripped.split("/").some((segment) => segment === "..")) {
    throw new Error(`Invalid storage key (path traversal): "${relKey}"`);
  }
  return stripped;
}

// Prefixes that must NEVER get a public URL, no matter how R2_PUBLIC_URL is
// configured for other objects in the same bucket (e.g. patient photos).
// backups/ contains full JSON dumps of the users table (passwordHash) and
// patients table (full PII) — see server/backup.ts. A public URL here is a
// guessable-path data breach (backups/<date>/users.json), not a hardening
// nice-to-have.
const NEVER_PUBLIC_PREFIXES = ["backups/"];

function isNeverPublic(key: string): boolean {
  return NEVER_PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Builds a URL for an object. If R2_PUBLIC_URL is set (a custom domain or
 * r2.dev public bucket URL) AND the key isn't under a NEVER_PUBLIC_PREFIXES
 * prefix, returns a permanent public URL. Otherwise returns a presigned URL
 * valid for 1 hour.
 */
async function buildObjectUrl(client: S3Client, bucket: string, key: string): Promise<string> {
  if (ENV.r2PublicUrl && !isNeverPublic(key)) {
    return `${ENV.r2PublicUrl.replace(/\/+$/, "")}/${key}`;
  }
  return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { client, bucket } = getStorageConfig();
  const key = normalizeKey(relKey);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: data,
    ContentType: contentType,
  }));

  return { key, url: await buildObjectUrl(client, bucket, key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { client, bucket } = getStorageConfig();
  const key = normalizeKey(relKey);
  return { key, url: await buildObjectUrl(client, bucket, key) };
}
