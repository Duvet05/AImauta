import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { ApiError } from "@/lib/http";

export type AssignmentTokenPurpose =
  | "assignment-public"
  | "assignment-resume"
  | "assignment-receipt";

const OPAQUE_TOKEN_BYTES = 32;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CIPHERTEXT_VERSION = "v1";

function configuredSecret(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < 32) {
    throw new ApiError(
      `${name} debe configurarse con al menos 32 caracteres.`,
      503,
    );
  }
  return value;
}

function tokenEncryptionKey(): Buffer {
  const encryptionSecret = configuredSecret(
    "AIMAUTA_ASSIGNMENT_TOKEN_SECRET",
  );
  return createHash("sha256")
    .update("aimauta-assignment-token-encryption-v1\0", "utf8")
    .update(encryptionSecret, "utf8")
    .digest();
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function requireAssignmentAdmin(request: Request): void {
  const adminSecret = configuredSecret("AIMAUTA_ASSIGNMENT_ADMIN_SECRET");
  const encryptionSecret = configuredSecret(
    "AIMAUTA_ASSIGNMENT_TOKEN_SECRET",
  );
  if (constantTimeTextEqual(adminSecret, encryptionSecret)) {
    throw new ApiError(
      "Los secretos administrativo y de cifrado de tareas deben ser distintos.",
      503,
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const provided = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!provided || !constantTimeTextEqual(provided, adminSecret)) {
    throw new ApiError("No autorizado.", 401);
  }
}

export function requireAssignmentResumeToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const token = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!isAssignmentToken(token)) {
    throw new ApiError("Sesión de tarea no autorizada.", 401);
  }
  return token;
}

export function generateAssignmentToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

export function isAssignmentToken(value: string): boolean {
  return OPAQUE_TOKEN_PATTERN.test(value);
}

export function hashAssignmentToken(
  purpose: AssignmentTokenPurpose,
  token: string,
): string {
  if (!isAssignmentToken(token)) {
    throw new ApiError("Enlace no encontrado.", 404);
  }
  return createHash("sha256")
    .update(`aimauta-${purpose}-v1\0`, "utf8")
    .update(token, "utf8")
    .digest("hex");
}

export function encryptAssignmentToken(
  purpose: AssignmentTokenPurpose,
  token: string,
): string {
  if (!isAssignmentToken(token)) {
    throw new ApiError("No se pudo proteger el token de la tarea.", 500);
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`aimauta-${purpose}-${CIPHERTEXT_VERSION}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    CIPHERTEXT_VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAssignmentToken(
  purpose: AssignmentTokenPurpose,
  envelope: string,
): string {
  const [version, encodedNonce, encodedTag, encodedCiphertext, extra] =
    envelope.split(".");
  if (
    version !== CIPHERTEXT_VERSION ||
    !encodedNonce ||
    !encodedTag ||
    !encodedCiphertext ||
    extra
  ) {
    throw new ApiError("El token cifrado de la tarea no es válido.", 500);
  }

  try {
    const nonce = Buffer.from(encodedNonce, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      tokenEncryptionKey(),
      nonce,
    );
    decipher.setAAD(
      Buffer.from(`aimauta-${purpose}-${CIPHERTEXT_VERSION}`, "utf8"),
    );
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!isAssignmentToken(token)) {
      throw new Error("invalid token");
    }
    return token;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("No se pudo descifrar el token de la tarea.", 500);
  }
}

export function assignmentPublicBaseUrl(): URL {
  const configured = process.env.AIMAUTA_PUBLIC_URL?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(
      "AIMAUTA_PUBLIC_URL debe ser una URL pública válida.",
      503,
    );
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".test"));
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new ApiError(
      "AIMAUTA_PUBLIC_URL debe usar HTTPS y no incluir credenciales, ruta, query ni fragmento.",
      503,
    );
  }
  url.pathname = "/";
  return url;
}

export function assignmentShareUrl(publicToken: string): string {
  if (!isAssignmentToken(publicToken)) {
    throw new ApiError("No se pudo construir el enlace de la tarea.", 500);
  }
  return new URL(
    `/a/${encodeURIComponent(publicToken)}`,
    assignmentPublicBaseUrl(),
  ).toString();
}

export function assignmentReceiptUrl(receiptToken: string): string {
  if (!isAssignmentToken(receiptToken)) {
    throw new ApiError("No se pudo construir el comprobante.", 500);
  }
  return new URL(
    `/completado/${encodeURIComponent(receiptToken)}`,
    assignmentPublicBaseUrl(),
  ).toString();
}
