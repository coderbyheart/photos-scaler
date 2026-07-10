import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { webpSize } from "./webp.ts";

const stackName = process.env.STACK_NAME ?? "photos-cdn";

// The lambda builds the redirect locations from the region it runs in
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
if (region === undefined)
  throw new Error(`Set AWS_REGION to the region the stack is deployed to!`);

const outputsFile = path.join(process.cwd(), "stack-outputs.json");
const deployFirst = `Deploy the stack first: STACK_NAME=${stackName} npx cdk deploy --require-approval never --outputs-file stack-outputs.json`;

const outputs = (
  JSON.parse(
    await readFile(outputsFile, "utf-8").catch(() => {
      throw new Error(`${outputsFile} not found! ${deployFirst}`);
    }),
  ) as Record<string, Record<string, string> | undefined>
)[stackName];

const url = outputs?.url;
const photosBucket = outputs?.photosBucketName;
const resizedBucket = outputs?.resizedBucketName;

if (
  url === undefined ||
  photosBucket === undefined ||
  resizedBucket === undefined
)
  throw new Error(
    `${outputsFile} has no outputs for the stack ${stackName}! ${deployFirst}`,
  );

const s3 = new S3Client({});

/**
 * Every run uploads its fixtures under a fresh prefix, so a re-run against an
 * existing stack cannot be served from the resized bucket of a previous run.
 */
const prefix = `e2e-tests/${randomUUID()}`;

const fixtures = {
  jpeg: {
    file: "landscape.jpg",
    contentType: "image/jpeg",
    width: 1200,
    height: 800,
  },
  // Has an alpha channel, which makes ImageMagick write an extended WebP file
  png: {
    file: "alpha.png",
    contentType: "image/png",
    width: 800,
    height: 1200,
  },
  // Animated, only the first frame must be scaled
  gif: {
    file: "animated.gif",
    contentType: "image/gif",
    width: 320,
    height: 240,
  },
} as const;

type Fixture = (typeof fixtures)[keyof typeof fixtures];

const keyFor = (fixture: Fixture) => `${prefix}/${fixture.file}`;

const request = async (
  key: string,
  query: Record<string, string>,
): Promise<Response> =>
  fetch(new URL(`${key}?${new URLSearchParams(query).toString()}`, url), {
    redirect: "manual",
  });

/**
 * The resized bucket is public, but the bucket policy may need a moment to
 * apply after the stack was created.
 */
const download = async (location: string): Promise<Buffer> => {
  for (let i = 5; i > 0; i--) {
    const res = await fetch(location);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    await delay(1000);
  }
  throw new Error(`Failed to download ${location}!`);
};

/**
 * The lambda derives this from the request, see `lambda.ts`.
 */
const resizedKey = (fixture: Fixture, sizeId: string) =>
  `${prefix}/${path.parse(fixture.file).name}.${sizeId}.webp`;

const resizedLocation = (fixture: Fixture, sizeId: string) =>
  `https://${resizedBucket}.s3.${region}.amazonaws.com/${resizedKey(fixture, sizeId)}`;

/** ImageMagick preserves the alpha channel, which needs an extended WebP file. */
const expectedFormat = (fixture: Fixture) =>
  fixture.contentType === "image/png" ? "extended" : "lossy";

const scaledHeight = (fixture: Fixture, width: number) =>
  Math.round((fixture.height * width) / fixture.width);

/**
 * Scale the fixture and return the WebP the CDN served.
 */
const variant = async (
  fixture: Fixture,
  query: Record<string, string>,
  sizeId: string,
): Promise<Buffer> => {
  const res = await request(keyFor(fixture), query);
  assert.equal(res.status, 301);
  const location = res.headers.get("location");
  assert.equal(location, resizedLocation(fixture, sizeId));
  return download(location as string);
};

/**
 * Scale the fixture and return the dimensions of the WebP the CDN served.
 */
const scaled = async (
  fixture: Fixture,
  query: Record<string, string>,
  sizeId: string,
) => webpSize(await variant(fixture, query, sizeId));

describe("the image scaling CDN", () => {
  before(async () => {
    await Promise.all(
      Object.values(fixtures).map(async (fixture) =>
        s3.send(
          new PutObjectCommand({
            Bucket: photosBucket,
            Key: keyFor(fixture),
            Body: await readFile(
              path.join(import.meta.dirname, "fixtures", fixture.file),
            ),
            ContentType: fixture.contentType,
          }),
        ),
      ),
    );
  });

  it("should redirect to the original image", async () => {
    const res = await request(keyFor(fixtures.jpeg), { f: "raw" });
    assert.equal(res.status, 301);
    assert.equal(
      res.headers.get("location"),
      `https://s3.${region}.amazonaws.com/${photosBucket}/${keyFor(fixtures.jpeg)}`,
    );
  });

  for (const [name, fixture] of Object.entries(fixtures)) {
    describe(`scaling a ${name} image`, () => {
      it("should create a square thumbnail", async () => {
        assert.deepEqual(
          await scaled(fixture, { f: "thumb", w: "250" }, "thumb-250-6"),
          { width: 250, height: 250, format: expectedFormat(fixture) },
        );
      });

      it("should create a tiny placeholder", async () => {
        assert.deepEqual(
          await scaled(fixture, { f: "placeholder" }, "placeholder-16-2"),
          { width: 16, height: 16, format: expectedFormat(fixture) },
        );
      });

      it("should create a preview that keeps the aspect ratio", async () => {
        assert.deepEqual(
          await scaled(fixture, { f: "preview" }, "preview-64-2"),
          {
            width: 64,
            height: scaledHeight(fixture, 64),
            format: expectedFormat(fixture),
          },
        );
      });

      it("should scale to the requested width", async () => {
        assert.deepEqual(
          await scaled(fixture, { f: "scaled", w: "500" }, "scaled-500-6"),
          {
            width: 500,
            height: scaledHeight(fixture, 500),
            format: expectedFormat(fixture),
          },
        );
      });
    });
  }

  it("should round the requested width down to a multiple of 250", async () => {
    assert.deepEqual(
      await scaled(fixtures.jpeg, { f: "scaled", w: "600" }, "scaled-500-6"),
      { width: 500, height: 333, format: "lossy" },
    );
  });

  it("should honour the requested quality", async () => {
    const [low, high] = await Promise.all([
      variant(fixtures.jpeg, { f: "scaled", w: "500", q: "1" }, "scaled-500-1"),
      variant(
        fixtures.jpeg,
        { f: "scaled", w: "500", q: "10" },
        "scaled-500-10",
      ),
    ]);
    assert.equal(webpSize(low).width, 500);
    assert.equal(webpSize(high).width, 500);
    assert.ok(
      low.length < high.length,
      `Expected the q=1 image (${low.length} bytes) to be smaller than the q=10 image (${high.length} bytes)!`,
    );
  });

  it("should store the resized image so it can be served from the bucket", async () => {
    await scaled(fixtures.jpeg, { f: "thumb", w: "500" }, "thumb-500-6");
    // The lambda serves this on the next request, without scaling again
    await s3.send(
      new HeadObjectCommand({
        Bucket: resizedBucket,
        Key: resizedKey(fixtures.jpeg, "thumb-500-6"),
      }),
    );
    const res = await request(keyFor(fixtures.jpeg), { f: "thumb", w: "500" });
    assert.equal(res.status, 301);
    assert.equal(
      res.headers.get("location"),
      resizedLocation(fixtures.jpeg, "thumb-500-6"),
    );
  });

  it("should reject an unknown format", async () => {
    const res = await request(keyFor(fixtures.jpeg), { f: "huge" });
    assert.equal(res.status, 400);
    assert.equal(await res.text(), `Invalid size: huge!`);
  });

  it("should return 404 for an image that does not exist", async () => {
    for (const f of ["raw", "thumb"]) {
      const res = await request(`${prefix}/does-not-exist.jpg`, { f });
      assert.equal(res.status, 404);
    }
  });
});
