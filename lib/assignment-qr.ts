import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export type AssignmentQrFormat = "svg" | "png" | "pdf";

const QR_WIDTH = 768;

export function parseAssignmentQrFormat(
  value: string | null,
): AssignmentQrFormat {
  return value === "png" || value === "pdf" ? value : "svg";
}

export async function renderAssignmentQr(input: {
  url: string;
  format: AssignmentQrFormat;
}): Promise<{ body: Uint8Array | string; contentType: string; extension: string }> {
  if (input.format === "svg") {
    return {
      body: await QRCode.toString(input.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 3,
        width: QR_WIDTH,
      }),
      contentType: "image/svg+xml; charset=utf-8",
      extension: "svg",
    };
  }

  const png = await QRCode.toBuffer(input.url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 3,
    width: QR_WIDTH,
  });
  if (input.format === "png") {
    return {
      body: png,
      contentType: "image/png",
      extension: "png",
    };
  }

  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const image = await document.embedPng(png);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const imageSize = 400;
  const imageX = (page.getWidth() - imageSize) / 2;
  const imageY = 290;

  page.drawText("AImauta - actividad", {
    x: 180,
    y: 750,
    size: 22,
    font: bold,
    color: rgb(0.09, 0.18, 0.16),
  });
  page.drawText("Escanea el codigo para comenzar.", {
    x: 180,
    y: 715,
    size: 13,
    font,
    color: rgb(0.2, 0.25, 0.24),
  });
  page.drawImage(image, {
    x: imageX,
    y: imageY,
    width: imageSize,
    height: imageSize,
  });
  page.drawText(input.url, {
    x: 55,
    y: 245,
    size: 8,
    font,
    color: rgb(0.25, 0.25, 0.25),
    maxWidth: page.getWidth() - 110,
  });

  return {
    body: await document.save(),
    contentType: "application/pdf",
    extension: "pdf",
  };
}
