import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Interim authentication gate for the school-directory CRUD API.
//
// The routes matched below (students, teachers, courses, grades, levels) read
// and mutate PII of minors and cascade-delete academic records. Until per-user
// roles (teacher/admin) exist, every request must present a shared admin bearer
// secret. This mirrors the constant-time bearer pattern already used for the
// internal voice endpoint (lib/internal-auth.ts) and fails closed: a missing or
// too-short secret returns 503 rather than leaving the directory open.
//
// A single matcher is the only enforcement point, so future directory routes
// under these prefixes are protected automatically.

const MIN_SECRET_LENGTH = 32;

function noStoreJson(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Runtime-agnostic constant-time comparison (Edge and Node). Both inputs are
// HMAC'd with a fresh random key so the comparison runs over fixed-length
// digests, leaking neither length nor content through timing.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(a)),
    crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i += 1) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.AIMAUTA_ADMIN_SECRET;
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    // Fail closed: never serve directory data with a misconfigured secret.
    return noStoreJson(503, {
      error: "El directorio no está configurado de forma segura.",
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return noStoreJson(401, { error: "Autenticación requerida." });
  }

  const received = authorization.slice(prefix.length);
  if (!(await timingSafeEqual(expected, received))) {
    return noStoreJson(401, { error: "Credencial inválida." });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/students/:path*",
    "/api/teachers/:path*",
    "/api/courses/:path*",
    "/api/grades/:path*",
    "/api/levels/:path*",
    // Assignment management is teacher-only: it lists who completed what and
    // can revoke work in progress. The student-facing counterpart lives under
    // /api/tareas/:token and stays public on purpose.
    "/api/assignments/:path*",
  ],
};
