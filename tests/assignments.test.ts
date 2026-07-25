import { describe, expect, it } from "vitest";

import {
  AssignmentValidationError,
  computeAutonomy,
  createToken,
  isAssignmentOpen,
  isWellFormedToken,
  normalizeStudentAlias,
  validateAssignmentDraft,
} from "@/lib/assignments";
import { getBooks } from "@/lib/catalog";

const publishedBook = getBooks()[0];

describe("assignment tokens", () => {
  it("mints url-safe tokens that survive a round trip through a QR code", () => {
    for (let index = 0; index < 50; index += 1) {
      const token = createToken();
      expect(isWellFormedToken(token)).toBe(true);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it("does not repeat tokens across a batch", () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => createToken()),
    );
    expect(tokens.size).toBe(500);
  });

  it("rejects malformed tokens before they reach the database", () => {
    expect(isWellFormedToken("")).toBe(false);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken("con espacios")).toBe(false);
    expect(isWellFormedToken("../../etc/passwd")).toBe(false);
    expect(isWellFormedToken("a".repeat(13))).toBe(false);
  });
});

describe("autonomy", () => {
  it("treats finishing without hints as independent, however many attempts", () => {
    expect(computeAutonomy({ hintsUsed: 0, attemptCount: 0 })).toBe(
      "INDEPENDENT",
    );
    expect(computeAutonomy({ hintsUsed: 0, attemptCount: 9 })).toBe(
      "INDEPENDENT",
    );
  });

  it("flags exhausting the hints or persisting many attempts as supported", () => {
    expect(computeAutonomy({ hintsUsed: 3, attemptCount: 1 })).toBe("SUPPORTED");
    expect(computeAutonomy({ hintsUsed: 1, attemptCount: 5 })).toBe("SUPPORTED");
  });

  it("places a couple of hints in between", () => {
    expect(computeAutonomy({ hintsUsed: 1, attemptCount: 1 })).toBe("GUIDED");
    expect(computeAutonomy({ hintsUsed: 2, attemptCount: 2 })).toBe("GUIDED");
  });

  it("does not break on negative or fractional counters", () => {
    expect(computeAutonomy({ hintsUsed: -4, attemptCount: -2 })).toBe(
      "INDEPENDENT",
    );
    expect(computeAutonomy({ hintsUsed: 1.7, attemptCount: 0.2 })).toBe(
      "GUIDED",
    );
  });
});

describe("assignment drafts", () => {
  const validDraft = {
    bookId: publishedBook.id,
    title: "Ficha 3 — Fracciones",
    firstPage: 10,
    lastPage: 12,
  };

  it("accepts a task inside a published book", () => {
    const draft = validateAssignmentDraft(validDraft);
    expect(draft.bookId).toBe(publishedBook.id);
    expect(draft.firstPage).toBe(10);
    expect(draft.lastPage).toBe(12);
    expect(draft.instructions).toBeNull();
  });

  it("refuses books that are not published", () => {
    expect(() =>
      validateAssignmentDraft({ ...validDraft, bookId: "no-existe" }),
    ).toThrow(AssignmentValidationError);
  });

  it("refuses an inverted page range", () => {
    expect(() =>
      validateAssignmentDraft({ ...validDraft, firstPage: 20, lastPage: 4 }),
    ).toThrow(AssignmentValidationError);
  });

  it("refuses pages past the end of the book", () => {
    expect(() =>
      validateAssignmentDraft({
        ...validDraft,
        firstPage: 1,
        lastPage: publishedBook.pages + 1,
      }),
    ).toThrow(AssignmentValidationError);
  });

  it("refuses a blank or oversized title", () => {
    expect(() =>
      validateAssignmentDraft({ ...validDraft, title: "   " }),
    ).toThrow(AssignmentValidationError);
    expect(() =>
      validateAssignmentDraft({ ...validDraft, title: "a".repeat(121) }),
    ).toThrow(AssignmentValidationError);
  });

  it("accepts page numbers arriving as strings from a form", () => {
    const draft = validateAssignmentDraft({
      ...validDraft,
      firstPage: "10",
      lastPage: "12",
    });
    expect(draft.firstPage).toBe(10);
    expect(draft.lastPage).toBe(12);
  });
});

describe("student alias", () => {
  it("collapses stray whitespace", () => {
    expect(normalizeStudentAlias("  María   L.  ")).toBe("María L.");
  });

  it("refuses an empty or oversized alias", () => {
    expect(() => normalizeStudentAlias("   ")).toThrow(
      AssignmentValidationError,
    );
    expect(() => normalizeStudentAlias("a".repeat(41))).toThrow(
      AssignmentValidationError,
    );
    expect(() => normalizeStudentAlias(undefined)).toThrow(
      AssignmentValidationError,
    );
  });
});

describe("assignment availability", () => {
  it("closes a revoked task even before its expiry", () => {
    expect(
      isAssignmentOpen({
        active: false,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe(false);
  });

  it("closes an expired task even while active", () => {
    expect(
      isAssignmentOpen({
        active: true,
        expiresAt: new Date(Date.now() - 1),
      }),
    ).toBe(false);
  });

  it("keeps an active task without expiry open", () => {
    expect(isAssignmentOpen({ active: true, expiresAt: null })).toBe(true);
  });
});
