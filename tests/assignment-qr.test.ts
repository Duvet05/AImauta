import { describe, expect, it } from "vitest";

import {
  parseAssignmentQrFormat,
  renderAssignmentQr
} from "@/lib/assignment-qr";

const url =
  "https://aprende.aimauta.test/a/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("render de códigos QR", () => {
  it("usa SVG por defecto y valida los formatos admitidos", () => {
    expect(parseAssignmentQrFormat(null)).toBe("svg");
    expect(parseAssignmentQrFormat("webp")).toBe("svg");
    expect(parseAssignmentQrFormat("png")).toBe("png");
    expect(parseAssignmentQrFormat("pdf")).toBe("pdf");
  });

  it.each([
    ["svg", "image/svg+xml", "<svg"],
    ["png", "image/png", "\u0089PNG"],
    ["pdf", "application/pdf", "%PDF"]
  ] as const)(
    "genera un archivo %s legible",
    async (format, contentType, signature) => {
      const result = await renderAssignmentQr({ url, format });
      const prefix =
        typeof result.body === "string"
          ? result.body.slice(0, 100)
          : Buffer.from(result.body).subarray(0, 8).toString("latin1");

      expect(result.contentType).toContain(contentType);
      expect(prefix).toContain(signature);
      expect(
        typeof result.body === "string"
          ? result.body.length
          : result.body.byteLength
      ).toBeGreaterThan(100);
    }
  );
});
