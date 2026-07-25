import {
  AssignmentValidationError,
  computeAutonomy,
  createToken,
  isAssignmentOpen,
  isWellFormedToken,
  normalizeStudentAlias,
} from "@/lib/assignments";
import { getBook } from "@/lib/catalog";
import { ApiError, errorResponse, jsonResponse, readJsonBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public entry point for a shared task: this is what a QR code resolves to.
// No authentication by design — requiring a login before a student can even see
// the work would defeat the point of handing out a code in class. The token is
// the capability, so it is rate limited and reveals nothing about the class
// roster or any other student's work.

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { token } = await context.params;
    const assignment = await openAssignmentByToken(token);
    const book = getBook(assignment.bookId);

    return jsonResponse({
      title: assignment.title,
      instructions: assignment.instructions,
      firstPage: assignment.firstPage,
      lastPage: assignment.lastPage,
      bookId: assignment.bookId,
      bookTitle: book?.title ?? null,
      courseName: assignment.course.name,
      gradeName: assignment.course.grade.name,
      expiresAt: assignment.expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { token } = await context.params;
    consumeRateLimit({
      scope: "assignment-complete",
      key: token,
      limit: 20,
      windowMs: 60_000,
    });

    const assignment = await openAssignmentByToken(token);
    const body = await readJsonBody(request);
    const studentAlias = normalizeStudentAlias(body.studentAlias);
    const hintsUsed = toCount(body.hintsUsed);
    const attemptCount = toCount(body.attemptCount);

    // Re-submitting the same alias updates the existing record instead of
    // creating a duplicate, so a student who reopens the link does not appear
    // twice in the teacher's list.
    const completion = await prisma.assignmentCompletion.upsert({
      where: {
        assignmentId_studentAlias: {
          assignmentId: assignment.id,
          studentAlias,
        },
      },
      create: {
        assignmentId: assignment.id,
        studentAlias,
        shareToken: createToken(),
        hintsUsed,
        attemptCount,
        autonomy: computeAutonomy({ hintsUsed, attemptCount }),
      },
      update: {
        hintsUsed,
        attemptCount,
        autonomy: computeAutonomy({ hintsUsed, attemptCount }),
        completedAt: new Date(),
      },
      select: { shareToken: true },
    });

    return jsonResponse({ shareToken: completion.shareToken }, 201);
  } catch (error) {
    if (error instanceof AssignmentValidationError) {
      return errorResponse(new ApiError(error.message, 422));
    }
    return errorResponse(error);
  }
}

async function openAssignmentByToken(token: string) {
  if (!isWellFormedToken(token)) {
    throw new ApiError("Esta tarea no existe o el enlace cambió.", 404);
  }

  const assignment = await prisma.assignment.findUnique({
    where: { token },
    include: { course: { include: { grade: true } } },
  });

  // An expired or revoked task is reported as gone rather than as forbidden:
  // the student did nothing wrong, and the distinction would only leak that
  // the token was once valid.
  if (!assignment || !isAssignmentOpen(assignment)) {
    throw new ApiError("Esta tarea ya no está disponible.", 404);
  }
  return assignment;
}

function toCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 999);
}
