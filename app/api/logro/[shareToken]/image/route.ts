import { isWellFormedToken } from "@/lib/assignments";
import { renderCelebrationPng } from "@/lib/celebration-image";
import { ApiError, errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The celebration image behind a share link. Public, because the point is that
// a family can open it from WhatsApp without an account, and it is safe to be
// public because the render contains no scores or diagnostics — only the fact
// that the activity was finished.

type RouteContext = {
  params: Promise<{ shareToken: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { shareToken } = await context.params;
    if (!isWellFormedToken(shareToken)) {
      throw new ApiError("Este logro no existe.", 404);
    }

    const completion = await prisma.assignmentCompletion.findUnique({
      where: { shareToken },
      include: {
        assignment: { include: { course: true } },
      },
    });
    if (!completion) {
      throw new ApiError("Este logro no existe.", 404);
    }

    const png = renderCelebrationPng({
      studentAlias: completion.studentAlias,
      assignmentTitle: completion.assignment.title,
      courseName: completion.assignment.course.name,
      autonomy: completion.autonomy,
      completedAt: completion.completedAt,
    });

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'inline; filename="logro-aimauta.png"',
        // Immutable content addressed by an unguessable token, but kept private
        // so shared caches never hold a child's name.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
