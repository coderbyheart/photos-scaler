import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from "aws-lambda";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path, { parse } from "node:path";

const s3 = new S3Client({});

const photosBucket = process.env.PHOTOS_BUCKET ?? "";
const resizedBucket = process.env.RESIZED_BUCKET ?? "";

export const handler = async (
  event: LambdaFunctionURLEvent
): Promise<LambdaFunctionURLResult> => {
  /*
  "rawPath": "/2023-12-10/1000013814-01.jpeg",
  "rawQueryString": "size=250",
  */
  const imagePath = event.rawPath;
  const query = new URLSearchParams(event.rawQueryString);
  const size = query.get("f") ?? "raw";
  if (!["thumb", "placeholder", "scaled", "raw"].includes(size))
    return {
      statusCode: 400,
      body: `Invalid size: ${size}!`,
    };

  if (size === "raw") {
    const original = await fetchOriginal(photosBucket, imagePath.slice(1));
    if (original === null) return notFound;
    // Bucket name has dots
    return redirect(
      `https://s3.${
        process.env.AWS_DEFAULT_REGION
      }.amazonaws.com/${photosBucket}/${imagePath.slice(1)}`
    );
  }

  let w = Math.floor(parseInt(query.get("w") ?? "250", 10) / 250) * 250;
  let q = Math.min(10, Math.max(1, parseInt(query.get("q") ?? "6", 10)));

  if (size === "placeholder") {
    w = 16;
    q = 2;
  }

  const sizeId = `${size}-${w}-${q}`;

  const filePath = parse(imagePath);
  const resizedKey = `${filePath.dir.slice(1)}/${filePath.name}.${sizeId}.webp`;
  const resizedLocation = `https://${resizedBucket}.s3.${process.env.AWS_DEFAULT_REGION}.amazonaws.com/${resizedKey}`;

  // Check if resized exists
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: resizedBucket,
        Key: resizedKey,
      })
    );
    console.log(`Resized variant found: ${resizedKey}`);
    return redirect(resizedLocation);
  } catch {
    console.log(`Resized variant does not exist: ${resizedKey}`);
  }

  const original = await fetchOriginal(photosBucket, imagePath.slice(1));
  if (original === null) return notFound;
  const originalFile = path.join(os.tmpdir(), randomUUID());
  await writeFile(originalFile, original, "binary");

  const resizedFile = `${path.join(os.tmpdir(), randomUUID())}.webp`;
  const originalInfo = (
    await run("/opt/bin/identify", [originalFile])
  ).toString("ascii");
  const [, type, dimensions, , colorDepth, colorFormat] =
    originalInfo.split(" "); // /tmp/f5bb4094-29eb-44ff-9c29-feaf5d2ce7d4 JPEG 3008x4000 3008x4000+0+0 8-bit sRGB 2.49426MiB 0.010u 0:00.004
  if (size === "thumb" || size === "placeholder") {
    await run("/opt/bin/convert", [
      originalFile,
      "-thumbnail",
      `${w}x${w}^`,
      `-gravity`,
      `center`,
      `-crop`,
      `${w}x${w}+0+0`,
      "-quality",
      `${q * 10}`,
      `-strip`,
      resizedFile,
    ]);
  } else if (size === "scaled") {
    await run("/opt/bin/convert", [
      originalFile,
      "-resize",
      `${w}x`,
      "-quality",
      `${q * 10}`,
      resizedFile,
    ]);
  }

  // Store resized file
  await s3.send(
    new PutObjectCommand({
      Bucket: resizedBucket,
      Key: resizedKey,
      Body: createReadStream(resizedFile),
      ContentType: `image/webp`,
      CacheControl: cacheForAYear,
      Metadata: {
        original: `${imagePath} ${type} ${dimensions} ${colorDepth} ${colorFormat}`,
      },
    })
  );

  return redirect(resizedLocation);
};

const cacheForAYear = "public, max-age=31449600, immutable";
const cacheControl = {
  "Cache-Control": cacheForAYear,
};

const redirect = (location: string) => ({
  statusCode: 301,
  headers: {
    location,
    ...cacheControl,
  },
});

const notFound = {
  statusCode: 404,
  headers: cacheControl,
};

const fetchOriginal = async (
  Bucket: string,
  Key: string
): Promise<Buffer | null> => {
  // Try to fetch original
  try {
    const { Body } = await s3.send(
      new GetObjectCommand({
        Bucket,
        Key,
      })
    );
    if (Body === undefined) return null;
    const stream = await Body.transformToByteArray();
    return Buffer.from(stream);
  } catch (err) {
    console.error(err);
    return null;
  }
};

const run = async (cmd: string, args: string[]): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(cmd, args);
    const resultBuffers: Buffer[] = [];
    proc.stdout.on("data", (buffer) => {
      resultBuffers.push(buffer);
    });
    proc.stderr.on("data", (buffer) => console.error(buffer.toString()));
    proc.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(`failed with ${code || signal}`);
      } else {
        resolve(Buffer.concat(resultBuffers));
      }
    });
  });
