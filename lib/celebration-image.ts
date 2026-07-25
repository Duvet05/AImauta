import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

/**
 * Shareable proof that an activity was finished.
 *
 * Sized 1080x1080 because it travels through WhatsApp, where a square renders
 * fully in the chat bubble without cropping.
 *
 * It shows only what the completion receipt itself carries: the activity name,
 * how many of its parts were finished, and when. There is no student name —
 * assignment runs are anonymous by design — and no score, ranking or
 * comparison, so a forwarded image can never become a judgement of a child.
 */

const SIZE = 1080;

const PALETTE = {
  forest: "#174F46",
  paper: "#FFFDF7",
  lime: "#D9ED8D",
  cream: "#F5EAD4",
  muted: "rgba(255, 253, 247, 0.72)",
  hairline: "rgba(255, 253, 247, 0.2)",
  weave: "rgba(238, 128, 104, 0.55)",
  weaveBand: "rgba(217, 237, 141, 0.16)",
};

export type CelebrationInput = {
  assignmentTitle: string;
  completedItemCount: number;
  totalItemCount: number;
  completedAt: Date;
};

export function renderCelebrationPng(input: CelebrationInput): Buffer {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  const backdrop = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  backdrop.addColorStop(0, "#123F39");
  backdrop.addColorStop(0.55, PALETTE.forest);
  backdrop.addColorStop(1, "#1D5D50");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, SIZE, SIZE);

  drawWovenBorder(ctx);
  drawBrand(ctx);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.fillStyle = PALETTE.lime;
  ctx.font = "italic bold 96px Georgia, serif";
  ctx.fillText("¡Actividad", 96, 360);
  ctx.fillText("completada!", 96, 462);

  ctx.fillStyle = PALETTE.paper;
  ctx.font = "34px system-ui, -apple-system, sans-serif";
  ctx.fillText(progressLine(input), 96, 546);

  ctx.fillStyle = PALETTE.muted;
  ctx.font = "bold 25px system-ui, -apple-system, sans-serif";
  ctx.fillText("ACTIVIDAD", 96, 726);

  ctx.fillStyle = PALETTE.paper;
  ctx.font = "bold 48px Georgia, serif";
  drawWrapped(ctx, input.assignmentTitle, 96, 782, SIZE - 192, 58, 2);

  ctx.strokeStyle = PALETTE.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(96, 936);
  ctx.lineTo(SIZE - 96, 936);
  ctx.stroke();

  ctx.fillStyle = PALETTE.muted;
  ctx.font = "27px system-ui, -apple-system, sans-serif";
  ctx.fillText("Acompañado por AImauta", 96, 984);
  ctx.textAlign = "right";
  ctx.fillText(formatDate(input.completedAt), SIZE - 96, 984);

  return canvas.toBuffer("image/png");
}

function progressLine(input: CelebrationInput): string {
  if (input.totalItemCount <= 1) {
    return "Terminada de principio a fin.";
  }
  if (input.completedItemCount >= input.totalItemCount) {
    return `Se completaron las ${input.totalItemCount} partes.`;
  }
  return `${input.completedItemCount} de ${input.totalItemCount} partes completadas.`;
}

function drawBrand(ctx: SKRSContext2D): void {
  ctx.fillStyle = PALETTE.cream;
  ctx.beginPath();
  ctx.arc(120, 132, 34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.forest;
  ctx.font = "bold 38px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", 120, 136);

  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.paper;
  ctx.font = "bold 40px Georgia, serif";
  ctx.fillText("AImauta", 168, 136);
}

/**
 * A nod to the Andean textile motif in the brand assets, drawn as plain
 * geometry so the render stays self-contained and loads no fonts or files at
 * request time.
 */
function drawWovenBorder(ctx: SKRSContext2D): void {
  const band = 28;
  ctx.fillStyle = PALETTE.weaveBand;
  ctx.fillRect(0, 0, SIZE, band);
  ctx.fillRect(0, SIZE - band, SIZE, band);

  ctx.fillStyle = PALETTE.weave;
  const step = 60;
  for (let x = step / 2; x < SIZE; x += step) {
    diamond(ctx, x, band / 2, 11);
    diamond(ctx, x, SIZE - band / 2, 11);
  }
}

function diamond(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Titles are teacher-authored free text of unknown length. Wrapping on measured
 * width keeps a long one readable, and the last allowed line is ellipsised
 * rather than overflowing the canvas.
 */
function drawWrapped(
  ctx: SKRSContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  const consumed = lines.join(" ");
  if (consumed.length < value.trim().length && lines.length > 0) {
    lines[lines.length - 1] = ellipsise(
      ctx,
      lines[lines.length - 1],
      maxWidth,
    );
  }

  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function ellipsise(
  ctx: SKRSContext2D,
  value: string,
  maxWidth: number,
): string {
  let text = value;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Lima",
  }).format(value);
}
