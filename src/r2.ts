import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

function decodeBase64Audio(audioBase64: string): { buffer: Buffer; contentType: string; ext: string } {
  const { mime, payload } = parseDataUrl(audioBase64.trim());
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    throw new ToolError("Audioaufnahme konnte nicht dekodiert werden.");
  }
  if (buffer.length === 0) {
    throw new ToolError("Audioaufnahme ist leer oder kein gültiges Base64.");
  }
  const ext = mime ? AUDIO_EXT_BY_MIME[mime.toLowerCase()] : undefined;
  if (!mime || !ext) {
    throw new ToolError("Nicht unterstütztes Audioformat für die Diktierfunktion.");
  }
  return { buffer, contentType: mime, ext };
}

/**
 * Panel v13, serverseitige Diktier-Transkription (iOS-Fallback, siehe Session-Bericht): laedt eine
 * kurze Sprachaufnahme NUR VORUEBERGEHEND nach R2 hoch, weil Falls Whisper-Endpunkt (audio-
 * transcribe.ts) eine oeffentlich erreichbare URL braucht, keine rohen Bytes im Request-Body
 * akzeptiert - Aufrufer MUSS `deleteObject` mit dem zurueckgegebenen `key` aufrufen, sobald die
 * Transkription fertig ist (Erfolg oder Fehler), damit keine Sprachaufnahmen von Kunden dauerhaft
 * gespeichert bleiben. Eigener `voice-tmp/`-Praefix, damit das nie mit den dauerhaften `posts/`-
 * Bild-Objekten verwechselt wird.
 */
export async function uploadAudioBase64(audioBase64: string): Promise<{ url: string; key: string }> {
  const config = getConfig();
  const audio = decodeBase64Audio(audioBase64);
  const key = `voice-tmp/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.${audio.ext}`;

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
        Body: audio.buffer,
        ContentType: audio.contentType,
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter R2-Fehler";
    throw new ToolError(`Upload der Sprachaufnahme nach Cloudflare R2 fehlgeschlagen. Details: ${detail}`);
  } finally {
    client.destroy();
  }

  return { url: `${config.mediaBucketUrl}/${key}`, key };
}

/** Loescht ein R2-Objekt (aktuell nur fuer die temporaeren Voice-Uploads oben gebraucht). Wirft
 *  nie - ein fehlgeschlagenes Aufraeumen darf eine bereits erfolgreiche Transkription nie zu
 *  einem Fehler fuer den Kunden machen, nur geloggt. */
export async function deleteObject(key: string): Promise<void> {
  const config = getConfig();
  const client = new S3Client({
    region: "auto",
    endpoint: config.mediaEndpoint,
    credentials: {
      accessKeyId: config.mediaAccessKey,
      secretAccessKey: config.mediaSecretKey,
    },
  });
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.mediaBucketName, Key: key }));
  } catch (error) {
    console.error(`[r2] Aufräumen von ${key} fehlgeschlagen (nicht kritisch):`, error instanceof Error ? error.message : error);
  } finally {
    client.destroy();
  }
}

/**
 * Fertig gerendertes Video (MP4) nach R2 - Instagram lädt Reels ausschließlich über eine
 * öffentlich erreichbare URL hoch, rohe Bytes nimmt die Graph-API nicht an (gleiches Prinzip wie
 * bei den Bildern oben). Eigener `videos/`-Präfix, damit Video-Objekte in der Bucket-Übersicht
 * und bei einem späteren Aufräumen von den Bildern unterscheidbar bleiben. Bleibt liegen wie ein
 * Beitragsbild auch - Instagram lädt das Video beim Veröffentlichen zwar zu sich, die URL wird
 * aber auch für die Freigabe-Vorschau im Panel gebraucht.
 */
export async function uploadVideoBuffer(buffer: Buffer): Promise<string> {
  const config = getConfig();
  if (!buffer.length) throw new ToolError("Video ist leer - nichts hochzuladen.");
  const key = `videos/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.mp4`;

  const client = new S3Client({
    region: "auto",
    endpoint: config.mediaEndpoint,
    credentials: { accessKeyId: config.mediaAccessKey, secretAccessKey: config.mediaSecretKey },
  });
  try {
    await client.send(
      new PutObjectCommand({ Bucket: config.mediaBucketName, Key: key, Body: buffer, ContentType: "video/mp4" }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter R2-Fehler";
    throw new ToolError(`Video-Upload nach Cloudflare R2 fehlgeschlagen. Details: ${detail}`);
  } finally {
    client.destroy();
  }
  return `${config.mediaBucketUrl}/${key}`;
}
