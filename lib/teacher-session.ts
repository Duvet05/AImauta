import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Browser-side counterpart to the admin bearer used by middleware.ts.
 *
 * The directory API is called by machines and can carry an Authorization
 * header; a teacher opening the panel in a browser cannot. Rather than weaken
 * the API guard, the panel exchanges the same shared secret once for a signed,
 * expiring cookie.
 *
 * This is an interim measure with the same shape as the rest of the app's
 * fail-closed auth: it identifies "someone who holds the school's secret", not
 * an individual teacher. Per-user accounts are what this should become.
 */

const COOKIE_NAME = "aimauta_docente";
const MIN_SECRET_LENGTH = 32;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class TeacherAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeacherAuthConfigurationError";
  }
}

export const teacherSessionCookieName = COOKIE_NAME;

function adminSecret(): string {
  const secret = process.env.AIMAUTA_ADMIN_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new TeacherAuthConfigurationError(
      `AIMAUTA_ADMIN_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres.`,
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", adminSecret()).update(payload).digest("base64url");
}

export function matchesAdminSecret(candidate: string): boolean {
  const expected = Buffer.from(adminSecret(), "utf8");
  const received = Buffer.from(candidate, "utf8");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

/**
 * Token is `expiry.signature`. The expiry is inside the signed payload so it
 * cannot be extended by editing the cookie, and it is checked server-side on
 * every read rather than trusting the cookie's own Max-Age.
 */
export function issueTeacherSession(now = Date.now()): {
  value: string;
  maxAge: number;
} {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return {
    value: `${payload}.${sign(payload)}`,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function isValidTeacherSession(
  value: string | undefined,
  now = Date.now(),
): boolean {
  if (!value) {
    return false;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return false;
  }

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expected = Buffer.from(sign(payload), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return false;
  }

  const expiresAt = Number.parseInt(payload, 10);
  return Number.isInteger(expiresAt) && expiresAt > now;
}
