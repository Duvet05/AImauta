import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isValidTeacherSession,
  issueTeacherSession,
  matchesAdminSecret,
  TeacherAuthConfigurationError,
} from "@/lib/teacher-session";

const SECRET = "z".repeat(48);
const originalSecret = process.env.AIMAUTA_ADMIN_SECRET;

beforeEach(() => {
  process.env.AIMAUTA_ADMIN_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.AIMAUTA_ADMIN_SECRET;
  } else {
    process.env.AIMAUTA_ADMIN_SECRET = originalSecret;
  }
});

describe("teacher session", () => {
  it("accepts a session it just issued", () => {
    const session = issueTeacherSession();
    expect(isValidTeacherSession(session.value)).toBe(true);
  });

  it("rejects a missing cookie", () => {
    expect(isValidTeacherSession(undefined)).toBe(false);
    expect(isValidTeacherSession("")).toBe(false);
  });

  it("rejects a session whose expiry was edited", () => {
    const session = issueTeacherSession();
    const signature = session.value.slice(session.value.lastIndexOf(".") + 1);
    const extended = `${Date.now() + 999_999_999}.${signature}`;
    expect(isValidTeacherSession(extended)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const session = issueTeacherSession();
    const payload = session.value.slice(0, session.value.lastIndexOf("."));
    expect(isValidTeacherSession(`${payload}.forged`)).toBe(false);
  });

  it("rejects an expired session even with a valid signature", () => {
    const past = Date.now() - 60_000;
    const session = issueTeacherSession(past - 8 * 60 * 60 * 1000);
    expect(isValidTeacherSession(session.value)).toBe(false);
  });

  it("rejects a session signed with a different secret", () => {
    const session = issueTeacherSession();
    process.env.AIMAUTA_ADMIN_SECRET = "q".repeat(48);
    expect(isValidTeacherSession(session.value)).toBe(false);
  });

  it("rejects malformed cookies without consulting the secret", () => {
    const wellFormed = issueTeacherSession().value;
    delete process.env.AIMAUTA_ADMIN_SECRET;

    // No signature separator: rejected on shape alone, so a misconfigured
    // server still denies access rather than erroring.
    expect(isValidTeacherSession("anything")).toBe(false);
    expect(isValidTeacherSession(".onlysignature")).toBe(false);

    // A well-formed cookie does need the secret, and surfaces the
    // misconfiguration so the access screen can explain it.
    expect(() => isValidTeacherSession(wellFormed)).toThrow(
      TeacherAuthConfigurationError,
    );
  });

  it("refuses to issue a session when the secret is too short", () => {
    process.env.AIMAUTA_ADMIN_SECRET = "corto";
    expect(() => issueTeacherSession()).toThrow(TeacherAuthConfigurationError);
    expect(() => matchesAdminSecret("corto")).toThrow(
      TeacherAuthConfigurationError,
    );
  });

  it("compares the admin secret without leaking length", () => {
    expect(matchesAdminSecret(SECRET)).toBe(true);
    expect(matchesAdminSecret(SECRET.slice(0, -1))).toBe(false);
    expect(matchesAdminSecret(`${SECRET}x`)).toBe(false);
    expect(matchesAdminSecret("")).toBe(false);
  });
});
