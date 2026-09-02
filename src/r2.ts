import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";

interface DecodedImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

function parseDataUrl(input: string): { mime?: string; payload: string } {
  const match = input.match(/^data:([^;,]+);base64,(.+)$/s);
  if (match) {
    return { mime: match[1], payload: match[2] };
  }
  return { payload: input.replace(/\s+/g, "") };
}

function detectImage(buffer: Buffer, mime?: string): { contentType: string; ext: string } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { contentType: "image/png", ext: "png" };
  }

  if (mime === "image/jpeg" || mime === "image/jpg") {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (mime === "image/png") {
    return { contentType: "image/png", ext: "png" };
  }

  throw new ToolError(
    "Ungültiges Bildformat. Instagram akzeptiert JPEG und PNG. " +
      "Bitte image_base64 als JPEG/PNG (optional als data-URL) übergeben.",
  );
}

function decodeBase64Image(imageBase64: string): DecodedImage {
  const { mime, payload } = parseDataUrl(imageBase64.trim());

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    throw new ToolError("image_base64 konnte nicht dekodiert werden.");
  }

  if (buffer.length === 0) {
    throw new ToolError("image_base64 ist leer oder kein gültiges Base64.");
  }

  const { contentType, ext } = detectImage(buffer, mime);
  return { buffer, contentType, ext };
}

export async function uploadImageBase64(imageBase64: string): Promise<string> {
  const config = getConfig();
  const image = decodeBase64Image(imageBase64);
  const key = `posts/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.${image.ext}`;

  const client = new S3Client({
    region: "auto",
    endpoint: config.mediaEndpoint,
    credentials: {
      accessKeyId: config.mediaAccessKey,
      secretAccessKey: config.mediaSecretKey,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.mediaBucketName,
        Key: key,
        Body: image.buffer,
        ContentType: image.contentType,
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter R2-Fehler";
    throw new ToolError(
      `Upload nach Cloudflare R2 fehlgeschlagen. Access Key und Bucket prüfen. Details: ${detail}`,
    );
  } finally {
    client.destroy();
  }

  return `${config.mediaBucketUrl}/${key}`;
}
