import QRCode from "qrcode";

import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse } from "@/lib/http";
import { assignmentUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Renders the shareable code for a task. The QR encodes only the public task
// URL, whose token carries no personal data, so a printed sheet left on a desk
// reveals nothing about the class.

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      select: { token: true, active: true },
    });
    if (!assignment) {
      throw new ApiError("La tarea no existe.", 404);
    }

    // Error correction level M keeps the code readable after printing and
    // photographing, which is how most of these will actually be scanned.
    const png = await QRCode.toBuffer(assignmentUrl(assignment.token), {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#103C36FF", light: "#FFFDF7FF" },
    });

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'inline; filename="tarea-aimauta.png"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
