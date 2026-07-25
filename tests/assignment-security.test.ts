import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  assignmentReceiptUrl,
  assignmentShareUrl,
  decryptAssignmentToken,
  encryptAssignmentToken,
  generateAssignmentToken,
  hashAssignmentToken,
  isAssignmentToken,
  requireAssignmentAdmin,
  requireAssignmentResumeToken
} from "@/lib/assignment-security";
import { ApiError } from "@/lib/http";

const adminSecret = "admin-secret-for-tests-with-more-than-32-characters";
const tokenSecret = "token-secret-for-tests-with-more-than-32-characters";

beforeEach(() => {
  process.env.AIMAUTA_ASSIGNMENT_ADMIN_SECRET = adminSecret;
  process.env.AIMAUTA_ASSIGNMENT_TOKEN_SECRET = tokenSecret;
  process.env.AIMAUTA_PUBLIC_URL = "https://aprende.aimauta.test";
});

afterAll(() => {
  delete process.env.AIMAUTA_ASSIGNMENT_ADMIN_SECRET;
  delete process.env.AIMAUTA_ASSIGNMENT_TOKEN_SECRET;
  delete process.env.AIMAUTA_PUBLIC_URL;
});

describe("seguridad de tareas QR", () => {
  it("emite identificadores opacos de 256 bits y separa cada propósito", () => {
    const token = generateAssignmentToken();
    expect(token).toHaveLength(43);
    expect(isAssignmentToken(token)).toBe(true);
    expect(generateAssignmentToken()).not.toBe(token);
    expect(hashAssignmentToken("assignment-public", token)).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(hashAssignmentToken("assignment-public", token)).not.toBe(
      hashAssignmentToken("assignment-resume", token)
    );
  });

  it("cifra el token con autenticación y no permite cambiar su propósito", () => {
    const token = generateAssignmentToken();
    const envelope = encryptAssignmentToken("assignment-public", token);

    expect(envelope).not.toContain(token);
    expect(
      decryptAssignmentToken("assignment-public", envelope)
    ).toBe(token);
    expect(() =>
      decryptAssignmentToken("assignment-receipt", envelope)
    ).toThrow(/descifrar/);
  });

  it("exige un Bearer administrativo correcto y secretos separados", () => {
    expect(() =>
      requireAssignmentAdmin(
        new Request("https://aimauta.test/api/assignments", {
          headers: { Authorization: `Bearer ${adminSecret}` }
        })
      )
    ).not.toThrow();

    expect(() =>
      requireAssignmentAdmin(
        new Request("https://aimauta.test/api/assignments")
      )
    ).toThrowError(ApiError);

    process.env.AIMAUTA_ASSIGNMENT_TOKEN_SECRET = adminSecret;
    expect(() =>
      requireAssignmentAdmin(
        new Request("https://aimauta.test/api/assignments", {
          headers: { Authorization: `Bearer ${adminSecret}` }
        })
      )
    ).toThrow(/deben ser distintos/);
  });

  it("transporta la reanudación por Authorization y construye URLs públicas", () => {
    const resumeToken = generateAssignmentToken();
    expect(
      requireAssignmentResumeToken(
        new Request("https://aimauta.test/api/assignment-runs/current", {
          headers: { Authorization: `Bearer ${resumeToken}` }
        })
      )
    ).toBe(resumeToken);
    expect(() =>
      requireAssignmentResumeToken(
        new Request("https://aimauta.test/api/assignment-runs/current")
      )
    ).toThrow(/no autorizada/);

    expect(assignmentShareUrl(resumeToken)).toBe(
      `https://aprende.aimauta.test/a/${resumeToken}`
    );
    expect(assignmentReceiptUrl(resumeToken)).toBe(
      `https://aprende.aimauta.test/completado/${resumeToken}`
    );
  });
});
