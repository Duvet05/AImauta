import { randomBytes } from "node:crypto";

import { getBook } from "@/lib/catalog";

/**
 * Tokens that travel in shared links and QR codes.
 *
 * They are the only identifier a forwarded message carries, so they must not
 * be guessable and must not encode anything about the student or the class.
 * Nine random bytes give 72 bits of entropy in 12 url-safe characters, short
 * enough to stay legible under a QR code and to be typed by hand if a camera
 * fails.
 */
const TOKEN_BYTES = 9;

export const MAX_ASSIGNMENT_TITLE = 120;
export const MAX_ASSIGNMENT_INSTRUCTIONS = 600;
export const MAX_STUDENT_ALIAS = 40;

export type AutonomyLevel = "INDEPENDENT" | "GUIDED" | "SUPPORTED";

export function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * A token is only ever compared against the database, never parsed, so the
 * shape check exists to reject obvious junk before a query runs.
 */
export function isWellFormedToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{12}$/.test(value);
}

/**
 * How much support the student needed, derived from what the tutor already
 * tracks. This is deliberately coarse: three buckets that tell a teacher who to
 * check on, not a score. It is never shown to the student.
 *
 * Finishing without hints is independent regardless of attempts, because
 * retrying on your own is the behaviour we want to reward, not penalise.
 */
export function computeAutonomy(input: {
  hintsUsed: number;
  attemptCount: number;
}): AutonomyLevel {
  const hints = Math.max(0, Math.trunc(input.hintsUsed));
  const attempts = Math.max(0, Math.trunc(input.attemptCount));

  if (hints === 0) {
    return "INDEPENDENT";
  }
  if (hints >= 3 || attempts >= 5) {
    return "SUPPORTED";
  }
  return "GUIDED";
}

/**
 * Teacher-facing wording for each bucket. Phrased as an observation about the
 * work, never as a label on the child ("necesitó apoyo", not "alumno lento").
 */
export const autonomyLabels: Record<
  AutonomyLevel,
  { label: string; teacherHint: string }
> = {
  INDEPENDENT: {
    label: "Resolvió por su cuenta",
    teacherHint: "Terminó sin pedir pistas.",
  },
  GUIDED: {
    label: "Avanzó con orientación",
    teacherHint: "Necesitó una o dos pistas para continuar.",
  },
  SUPPORTED: {
    label: "Necesitó acompañamiento",
    teacherHint: "Usó las tres pistas o hizo varios intentos. Conviene revisarlo en clase.",
  },
};

export type AssignmentDraft = {
  bookId: string;
  title: string;
  instructions: string | null;
  firstPage: number;
  lastPage: number;
  unitId: string | null;
};

export class AssignmentValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "AssignmentValidationError";
    this.field = field;
  }
}

/**
 * Validates a teacher's task against the published catalog. Fails closed: an
 * unpublished or unknown book is treated as unavailable, matching how the rest
 * of the app gates material.
 */
export function validateAssignmentDraft(input: {
  bookId: unknown;
  title: unknown;
  instructions?: unknown;
  firstPage: unknown;
  lastPage: unknown;
  unitId?: unknown;
}): AssignmentDraft {
  const bookId = typeof input.bookId === "string" ? input.bookId.trim() : "";
  const book = bookId ? getBook(bookId) : undefined;
  if (!book) {
    throw new AssignmentValidationError(
      "Elige un cuaderno disponible.",
      "bookId",
    );
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_ASSIGNMENT_TITLE) {
    throw new AssignmentValidationError(
      `Ponle un nombre a la tarea (máximo ${MAX_ASSIGNMENT_TITLE} caracteres).`,
      "title",
    );
  }

  const rawInstructions =
    typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (rawInstructions.length > MAX_ASSIGNMENT_INSTRUCTIONS) {
    throw new AssignmentValidationError(
      `Las indicaciones no pueden pasar de ${MAX_ASSIGNMENT_INSTRUCTIONS} caracteres.`,
      "instructions",
    );
  }

  const firstPage = toPage(input.firstPage);
  const lastPage = toPage(input.lastPage);
  if (firstPage === null || lastPage === null) {
    throw new AssignmentValidationError(
      "Indica desde qué página hasta qué página.",
      "firstPage",
    );
  }
  if (firstPage > lastPage) {
    throw new AssignmentValidationError(
      "La página inicial debe ser menor o igual que la final.",
      "firstPage",
    );
  }
  if (lastPage > book.pages) {
    throw new AssignmentValidationError(
      `Este cuaderno llega hasta la página ${book.pages}.`,
      "lastPage",
    );
  }

  const unitId =
    typeof input.unitId === "string" && input.unitId.trim()
      ? input.unitId.trim()
      : null;

  return {
    bookId,
    title,
    instructions: rawInstructions || null,
    firstPage,
    lastPage,
    unitId,
  };
}

function toPage(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    return null;
  }
  return parsed;
}

/**
 * The alias a student types when opening a shared task. It replaces any
 * personal identifier: a roll number or a first name is enough for a teacher to
 * recognise the work, and nothing here is treated as verified identity.
 */
export function normalizeStudentAlias(value: unknown): string {
  const alias = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!alias || alias.length > MAX_STUDENT_ALIAS) {
    throw new AssignmentValidationError(
      `Escribe tu nombre o número de lista (máximo ${MAX_STUDENT_ALIAS} caracteres).`,
      "studentAlias",
    );
  }
  return alias;
}

export function isAssignmentOpen(assignment: {
  active: boolean;
  expiresAt: Date | null;
}): boolean {
  if (!assignment.active) {
    return false;
  }
  return !assignment.expiresAt || assignment.expiresAt.getTime() > Date.now();
}
