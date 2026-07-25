import { parseAssignmentQrFormat, renderAssignmentQr } from "@/lib/assignment-qr";
import { requireAssignmentAdmin } from "@/lib/assignment-security";
import { assignmentShareForAdmin } from "@/lib/assignment-service";
import { errorResponse, requiredString } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    requireAssignmentAdmin(request);
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const teacherId = requiredString(
      searchParams.get("teacherId"),
      "teacherId",
      { maxLength: 100 }
    );
    const format = parseAssignmentQrFormat(searchParams.get("format"));
    const share = await assignmentShareForAdmin({ id, teacherId });
    const rendered = await renderAssignmentQr({
      url: share.shareUrl,
      format
    });
    const safeId =
      id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "actividad";
    let responseBody: BodyInit;
    if (typeof rendered.body === "string") {
      responseBody = rendered.body;
    } else {
      const bytes = new Uint8Array(rendered.body.byteLength);
      bytes.set(rendered.body);
      responseBody = bytes.buffer;
    }
    return new Response(responseBody, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          `attachment; filename="aimauta-${safeId}.${rendered.extension}"`,
        "Content-Security-Policy": "sandbox",
        "Content-Type": rendered.contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
