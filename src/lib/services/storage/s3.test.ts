import assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceConfigurationError } from "../service-config.ts";
import { resolveStorageDriver, supportsDirectUploads } from "./driver.ts";
import {
  createS3StorageService,
  readS3Settings,
  type S3SendClient,
} from "./s3.ts";
import { StorageObjectNotFoundError } from "./types.ts";

type StoredObject = { body: Uint8Array; contentType?: string };
type Command = {
  constructor: { name: string };
  input: Record<string, unknown>;
};

const env = {
  S3_ACCESS_KEY_ID: "key",
  S3_BUCKET: "signudoc",
  S3_ENDPOINT: "https://objects.example.test",
  S3_SECRET_ACCESS_KEY: "secret",
};

function s3Error(name: string, httpStatusCode: number) {
  return Object.assign(new Error(name), {
    $metadata: { httpStatusCode },
    name,
  });
}

// An in-memory stand-in for an S3 bucket that records how it was called,
// and answers the way S3 does: NoSuchKey for a missing GET, NotFound for a
// missing HEAD, and 412 for a conditional write that finds an object there.
function createFakeS3Client({ conditionalWrites = true } = {}) {
  const objects = new Map<string, StoredObject>();
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];

  const client = {
    async send(command: Command) {
      const name = command.constructor.name;
      const input = command.input;
      const key = input.Key as string;

      calls.push({ command: name, input });
      assert.equal(input.Bucket, "signudoc");

      switch (name) {
        case "PutObjectCommand": {
          if (
            conditionalWrites &&
            input.IfNoneMatch === "*" &&
            objects.has(key)
          ) {
            throw s3Error("PreconditionFailed", 412);
          }

          objects.set(key, {
            body: new Uint8Array(input.Body as Uint8Array),
            contentType: input.ContentType as string,
          });

          return { ETag: '"etag"' };
        }
        case "GetObjectCommand": {
          const object = objects.get(key);

          if (!object) {
            throw s3Error("NoSuchKey", 404);
          }

          return {
            Body: {
              async transformToByteArray() {
                return new Uint8Array(object.body);
              },
              transformToWebStream() {
                return new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(object.body);
                    controller.close();
                  },
                });
              },
            },
            ContentLength: object.body.byteLength,
            ContentType: object.contentType,
            ETag: '"etag"',
          };
        }
        case "HeadObjectCommand": {
          const object = objects.get(key);

          if (!object) {
            throw s3Error("NotFound", 404);
          }

          return {
            ContentLength: object.body.byteLength,
            ContentType: object.contentType,
            ETag: '"etag"',
          };
        }
        case "DeleteObjectCommand":
          objects.delete(key);

          return {};
        default:
          throw new Error(`Unexpected command ${name}`);
      }
    },
  };

  return { calls, client: client as unknown as S3SendClient, objects };
}

const pdf = (text: string) => new TextEncoder().encode(text);

test("objects are written to the bucket and replace what was there", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  const ref = await storage.putObject({
    body: pdf("first"),
    contentType: "application/pdf",
    key: "/envelopes/a.pdf",
  });
  await storage.putObject({
    body: pdf("second"),
    contentType: "application/pdf",
    key: "envelopes/a.pdf",
  });

  assert.deepEqual(ref, { bucketName: "signudoc", key: "envelopes/a.pdf" });
  assert.equal(fake.calls[0].input.IfNoneMatch, undefined);
  assert.equal(fake.calls[0].input.ContentType, "application/pdf");
  assert.equal(
    new TextDecoder().decode(fake.objects.get("envelopes/a.pdf")!.body),
    "second",
  );
});

test("an object that is to be kept is not written over", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  await storage.putObject({
    body: pdf("first"),
    contentType: "application/pdf",
    keepExisting: true,
    key: "seal.pdf",
  });
  const ref = await storage.putObject({
    body: pdf("second"),
    contentType: "application/pdf",
    keepExisting: true,
    key: "seal.pdf",
  });

  assert.deepEqual(ref, { bucketName: "signudoc", key: "seal.pdf" });
  assert.equal(fake.calls[0].input.IfNoneMatch, "*");
  assert.equal(
    new TextDecoder().decode(fake.objects.get("seal.pdf")!.body),
    "first",
  );
});

test("a write that fails for another reason is still a failure", async () => {
  const fake = createFakeS3Client();
  const client = {
    async send(command: Command) {
      if (command.constructor.name === "PutObjectCommand") {
        throw s3Error("AccessDenied", 403);
      }

      return fake.client.send(command as never);
    },
  } as unknown as S3SendClient;
  const storage = createS3StorageService({ client, env });

  await assert.rejects(
    storage.putObject({
      body: pdf("x"),
      contentType: "application/pdf",
      keepExisting: true,
      key: "a.pdf",
    }),
    /AccessDenied/,
  );
});

test("objects are read back whole or as a stream", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  await storage.putObject({
    body: pdf("hello"),
    contentType: "application/pdf",
    key: "a.pdf",
  });

  const object = await storage.getObject("a.pdf");
  assert.equal(new TextDecoder().decode(object.body), "hello");
  assert.equal(object.contentLength, 5);
  assert.equal(object.contentType, "application/pdf");

  const streamed = await storage.getObjectStream("a.pdf");
  assert.equal(await new Response(streamed.stream).text(), "hello");
  assert.equal(streamed.contentLength, 5);
});

test("a missing object is reported the way the rest of the app expects", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  await assert.rejects(
    storage.getObject("missing.pdf"),
    StorageObjectNotFoundError,
  );
  await assert.rejects(
    storage.getObjectStream("missing.pdf"),
    StorageObjectNotFoundError,
  );
  assert.deepEqual(await storage.headObject("missing.pdf"), {
    bucketName: "signudoc",
    exists: false,
    key: "missing.pdf",
  });
});

test("head and delete work on stored objects", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  await storage.putObject({
    body: pdf("abc"),
    contentType: "application/pdf",
    key: "a.pdf",
  });

  const head = await storage.headObject("a.pdf");
  assert.equal(head.exists, true);
  assert.equal(head.contentLength, 3);

  await storage.deleteObject("a.pdf");
  await storage.deleteObject("a.pdf");
  assert.equal((await storage.headObject("a.pdf")).exists, false);
});

test("keys that could escape their folder are refused", async () => {
  const fake = createFakeS3Client();
  const storage = createS3StorageService({ client: fake.client, env });

  await assert.rejects(storage.getObject("../secret"), /invalid/);
  assert.equal(fake.calls.length, 0);
});

test("without a bucket and keys the driver says what is missing", () => {
  assert.throws(
    () => createS3StorageService({ env: { S3_BUCKET: "signudoc" } }),
    (error: unknown) =>
      error instanceof ServiceConfigurationError &&
      /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/.test(error.message),
  );
});

test("path-style addressing is on for a custom endpoint unless turned off", () => {
  assert.equal(readS3Settings(env).forcePathStyle, true);
  assert.equal(readS3Settings(env).region, "us-east-1");
  assert.equal(
    readS3Settings({ ...env, S3_FORCE_PATH_STYLE: "0" }).forcePathStyle,
    false,
  );

  const awsEnv = { ...env, S3_ENDPOINT: undefined };
  assert.equal(readS3Settings(awsEnv).forcePathStyle, false);
  assert.equal(readS3Settings(awsEnv).endpoint, undefined);
});

test("an S3 bucket is chosen once one is configured", () => {
  assert.equal(resolveStorageDriver(env), "s3");
  assert.equal(resolveStorageDriver({ STORAGE_DRIVER: "S3" }), "s3");
  assert.equal(
    resolveStorageDriver({ ...env, STORAGE_DRIVER: "local" }),
    "local",
  );
  // A connected Vercel Blob store, or running on Vercel, still wins.
  assert.equal(
    resolveStorageDriver({ ...env, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" }),
    "blob",
  );
  assert.equal(resolveStorageDriver({ ...env, VERCEL: "1" }), "blob");
  // PDFs go through the app, which accepts them up to the upload limit.
  assert.equal(supportsDirectUploads(env), false);
});
