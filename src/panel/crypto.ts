import crypto from "node:crypto";

// AES-256-GCM – Kunden-Tokens liegen nie im Klartext in der Datenbank.
function getKey(): Buffer {
  const hex = process.env.PANEL_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("PANEL_ENCRYPTION_KEY fehlt oder ist ungültig – mit `openssl rand -hex 32` erzeugen und in .env eintragen.");
  }
  return Buffer.from(hex, "hex");
}

export function assertEncryptionKey(): void {
  getKey();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unbekanntes Token-Format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
