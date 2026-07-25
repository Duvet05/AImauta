import { hasTeacherSession } from "@/app/docente/guard";
import {
  parseAssignmentQrFormat,
  renderAssignmentQr,
} from "@/lib/assignment-qr";
import { assignmentShareForAdmin } from "@/lib/assignment-service";
import { errorResponse, jsonResponse, requiredString } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    if (!(await hasTeacherSession())) {
      return jsonResponse({ error: "No autorizado." }, 401);
    }

    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const teacherId = requiredString(
      searchParams.get("teacherId"),
      "teacherId",
      { maxLength: 100 },
    );
    const format = parseAssignmentQrFormat(searchParams.get("format"));
    const share = await assignmentShareForAdmin({ id, teacherId });
    const rendered = await renderAssignmentQr({
      url: share.shareUrl,
      format,
    });
    const safeId =
      id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "actividad";
    const body =
      typeof rendered.body === "string"
        ? rendered.body
        : Uint8Array.from(rendered.body).buffer;

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          `inline; filename="aimauta-${safeId}.${rendered.extension}"`,
        "Content-Security-Policy": "sandbox",
        "Content-Type": rendered.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
