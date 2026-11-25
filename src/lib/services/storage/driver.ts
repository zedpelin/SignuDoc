import { type EnvSource } from "../../utils/env.ts";

// Which storage the app uses. Kept free of the drivers themselves so the
// request proxy can ask without loading them.

export type StorageDriver = "blob" | "local" | "s3";

/** True when a Vercel Blob store is connected to the project. */
export function hasBlobCredentials(env: EnvSource = process.env): boolean {
  return Boolean(
    env.BLOB_READ_WRITE_TOKEN?.trim() || env.BLOB_STORE_ID?.trim(),
  );
}

/** True when an S3-compatible bucket is configured. */
export function hasS3Bucket(env: EnvSource = process.env): boolean {
  return Boolean(env.S3_BUCKET?.trim());
}

/**
 * - "blob": Vercel Blob. Chosen automatically once a Blob store is connected
 *   to the project, and always on Vercel, where there is no disk to keep
 *   files on.
 * - "s3": an S3-compatible bucket (AWS S3, Nine Object Storage, R2, MinIO).
 *   Chosen automatically once S3_BUCKET is set, for hosts whose disk does
 *   not survive a restart.
 * - "local": files on this machine's disk. The default everywhere else.
 *
 * STORAGE_DRIVER overrides the choice.
 */
export function resolveStorageDriver(
  env: EnvSource = process.env,
): StorageDriver {
  const configuredDriver = env.STORAGE_DRIVER?.trim().toLowerCase();

  if (
    configuredDriver === "blob" ||
    configuredDriver === "local" ||
    configuredDriver === "s3"
  ) {
    return configuredDriver;
  }

  if (configuredDriver) {
    throw new Error(
      `Unknown STORAGE_DRIVER "${configuredDriver}". Use "blob", "local" or "s3", or leave it unset.`,
    );
  }

  if (hasBlobCredentials(env) || env.VERCEL === "1") {
    return "blob";
  }

  return hasS3Bucket(env) ? "s3" : "local";
}

/**
 * True when the browser can send a PDF straight to storage instead of
 * through the app. Vercel caps a request to the app at 4.5 MB, far below the
 * upload limit, so on Vercel Blob this is the only way a larger PDF gets in.
 */
export function supportsDirectUploads(env: EnvSource = process.env): boolean {
  return resolveStorageDriver(env) === "blob";
}
