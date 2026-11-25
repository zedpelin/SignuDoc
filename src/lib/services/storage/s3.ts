import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { type EnvSource, readEnv } from "../../utils/env.ts";
import { ServiceConfigurationError } from "../service-config.ts";
import {
  normalizeStorageKey,
  type StorageObjectHead,
  StorageObjectNotFoundError,
  type StorageService,
} from "./types.ts";

// S3-compatible object storage: AWS S3, or any store that speaks its API,
// such as Nine's Object Storage, Cloudflare R2 or MinIO. The bucket should
// be private: every read goes through the app, which checks who is asking
// first, so nothing in it needs a public URL.
//
//   S3_BUCKET             the bucket's name (setting it turns this driver on)
//   S3_ENDPOINT           the store's address, e.g. https://cz42.objects.nineapis.ch;
//                         leave unset for AWS S3
//   S3_REGION             defaults to us-east-1, which most stores other
//                         than AWS accept
//   S3_ACCESS_KEY_ID      the access key
//   S3_SECRET_ACCESS_KEY  and its secret
//   S3_FORCE_PATH_STYLE   "1" to address the bucket as <endpoint>/<bucket>
//                         rather than <bucket>.<endpoint>. On by default when
//                         S3_ENDPOINT is set, since most other stores need it;
//                         "0" turns it off.

const REQUIRED_VARIABLES = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const DEFAULT_REGION = "us-east-1";

/** The one method of the S3 client this driver uses. Replaced by a fake in tests. */
export type S3SendClient = Pick<S3Client, "send">;

type CreateS3StorageServiceOptions = {
  client?: S3SendClient;
  env?: EnvSource;
};

type S3Settings = {
  accessKeyId: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
};

export function readS3Settings(env: EnvSource = process.env): S3Settings {
  const missing = REQUIRED_VARIABLES.filter((name) => !readEnv(env, name));

  if (missing.length > 0) {
    throw new ServiceConfigurationError("storage", missing);
  }

  const endpoint = readEnv(env, "S3_ENDPOINT");
  const pathStyle = readEnv(env, "S3_FORCE_PATH_STYLE")?.toLowerCase();

  return {
    accessKeyId: readEnv(env, "S3_ACCESS_KEY_ID")!,
    bucket: readEnv(env, "S3_BUCKET")!,
    endpoint,
    forcePathStyle:
      pathStyle === undefined
        ? Boolean(endpoint)
        : pathStyle === "1" || pathStyle === "true",
    region: readEnv(env, "S3_REGION") ?? DEFAULT_REGION,
    secretAccessKey: readEnv(env, "S3_SECRET_ACCESS_KEY")!,
  };
}

function httpStatusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
}

function isNotFoundError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;

  return (
    name === "NoSuchKey" || name === "NotFound" || httpStatusOf(error) === 404
  );
}

/**
 * A write with If-None-Match: * that found an object already there (412),
 * or that raced another conditional write to the same key (409).
 */
function isAlreadyExistsError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = httpStatusOf(error);

  return (
    name === "PreconditionFailed" ||
    name === "ConditionalRequestConflict" ||
    status === 412 ||
    status === 409
  );
}

export function createS3StorageService({
  client,
  env = process.env,
}: CreateS3StorageServiceOptions = {}): StorageService {
  const settings = readS3Settings(env);
  const bucket = settings.bucket;
  const s3 =
    client ??
    new S3Client({
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      region: settings.region,
      // Checksums on every request are newer than many S3-compatible stores,
      // some of which refuse them. Send them only where an operation needs one.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });

  async function fetchObject(key: string) {
    const normalizedKey = normalizeStorageKey(key);

    try {
      const result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: normalizedKey }),
      );

      if (!result.Body) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      return { body: result.Body, normalizedKey, result };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new StorageObjectNotFoundError(normalizedKey);
      }

      throw error;
    }
  }

  async function headObject(key: string): Promise<StorageObjectHead> {
    const normalizedKey = normalizeStorageKey(key);

    try {
      const result = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey }),
      );

      return {
        bucketName: bucket,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        exists: true,
        key: normalizedKey,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { bucketName: bucket, exists: false, key: normalizedKey };
      }

      throw error;
    }
  }

  return {
    async deleteObject(key) {
      // S3 answers a delete of a missing object with success, as the other
      // drivers do.
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: normalizeStorageKey(key),
        }),
      );
    },
    async getObject(key) {
      const { body, normalizedKey, result } = await fetchObject(key);
      const bytes = await body.transformToByteArray();

      return {
        body: bytes,
        bucketName: bucket,
        contentLength: bytes.byteLength,
        contentType: result.ContentType,
        etag: result.ETag,
        key: normalizedKey,
      };
    },
    async getObjectStream(key) {
      const { body, normalizedKey, result } = await fetchObject(key);

      return {
        bucketName: bucket,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        key: normalizedKey,
        stream: body.transformToWebStream() as ReadableStream<Uint8Array>,
      };
    },
    headObject,
    async putObject(input) {
      const normalizedKey = normalizeStorageKey(input.key);

      try {
        await s3.send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: bucket,
            ContentLength: input.body.byteLength,
            ContentType: input.contentType,
            // Keys are complete and deterministic: the same key must always
            // name the same object. Writing it again replaces it, unless the
            // caller asked for what is there to be kept, and then the store
            // itself refuses the write. The store must support conditional
            // writes for that; see docs/self-hosting.md.
            IfNoneMatch: input.keepExisting ? "*" : undefined,
            Key: normalizedKey,
          }),
        );
      } catch (error) {
        // An object that is there is what was asked for; a write that failed
        // for any other reason is still a failure.
        if (
          !input.keepExisting ||
          !isAlreadyExistsError(error) ||
          !(await headObject(normalizedKey)).exists
        ) {
          throw error;
        }
      }

      return { bucketName: bucket, key: normalizedKey };
    },
  };
}
