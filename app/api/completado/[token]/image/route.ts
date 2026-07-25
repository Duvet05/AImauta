import { isAssignmentToken } from "@/lib/assignment-security";
import { verifyCompletionReceipt } from "@/lib/assignment-service";
import { renderCelebrationPng } from "@/lib/celebration-image";
import { ApiError, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shareable render of a completion receipt.
//
// Public for the same reason /completado/[token] is: a family opens it from a
// WhatsApp message, without an account. Safe to be public because possession of
// the receipt token is the only capability, and the image carries no identity,
// score or diagnostic — just that the activity was finished.

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { token } = await context.params;
    if (!isAssignmentToken(token)) {
      throw new ApiError("Comprobante no encontrado.", 404);
    }

    const receipt = await verifyCompletionReceipt(token);
    const png = renderCelebrationPng({
      assignmentTitle: receipt.assignmentTitle,
      completedItemCount: receipt.completedItemCount,
      totalItemCount: receipt.totalItemCount,
      completedAt: new Date(receipt.completedAt),
    });

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'inline; filename="aimauta-actividad-completada.png"',
        // Addressed by an unguessable token and cheap to regenerate; kept out
        // of shared caches so no intermediary retains a class's receipts.
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
