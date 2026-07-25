import { createCanvas } from "@napi-rs/canvas";

import type { AutonomyLevel } from "@/lib/assignments";

/**
 * The image a student shares after finishing a task.
 *
 * Sized 1080x1080 because it travels through WhatsApp, where a square renders
 * fully in the chat bubble without cropping.
 *
 * What it deliberately does NOT show: scores, number of attempts, hints used,
 * comparisons with classmates, or anything a forwarded message could turn into
 * a judgement of the child. It celebrates finishing the work, and the autonomy
 * bucket only ever appears as encouragement, never as a grade.
 */

const SIZE = 1080;

const PALETTE = {
  forestDark: "#103C36",
  forest: "#174F46",
  paper: "#FFFDF7",
  lime: "#D9ED8D",
  cream: "#F5EAD4",
  mutedInk: "rgba(255, 253, 247, 0.72)",
};

const HEADLINES: Record<AutonomyLevel, string> = {
  INDEPENDENT: "¡Lo resolviste\npor tu cuenta!",
  GUIDED: "¡Lo lograste\npaso a paso!",
  SUPPORTED: "¡Llegaste\nhasta el final!",
};

const SUBTITLES: Record<AutonomyLevel, string> = {
  INDEPENDENT: "Terminaste sin pedir ninguna pista.",
  GUIDED: "Usaste las pistas y seguiste pensando.",
  SUPPORTED: "No te rendiste: eso también es aprender.",
};

export type CelebrationInput = {
  studentAlias: string;
  assignmentTitle: string;
  courseName: string;
  autonomy: AutonomyLevel;
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

  // Brand lockup
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

  // Headline
  ctx.fillStyle = PALETTE.lime;
  ctx.font = "italic bold 92px Georgia, serif";
  const headlineLines = HEADLINES[input.autonomy].split("\n");
  headlineLines.forEach((line, index) => {
    ctx.fillText(line, 96, 330 + index * 104);
  });

  ctx.fillStyle = PALETTE.paper;
  ctx.font = "34px system-ui, -apple-system, sans-serif";
  ctx.fillText(SUBTITLES[input.autonomy], 96, 330 + headlineLines.length * 104 + 34);

  // Student and task
  ctx.fillStyle = PALETTE.mutedInk;
  ctx.font = "bold 25px system-ui, -apple-system, sans-serif";
  ctx.fillText("ESTUDIANTE", 96, 720);
  ctx.fillStyle = PALETTE.paper;
  ctx.font = "bold 48px Georgia, serif";
  ctx.fillText(truncate(ctx, input.studentAlias, SIZE - 192), 96, 772);

  ctx.fillStyle = PALETTE.mutedInk;
  ctx.font = "bold 25px system-ui, -apple-system, sans-serif";
  ctx.fillText("ACTIVIDAD", 96, 848);
  ctx.fillStyle = PALETTE.paper;
  ctx.font = "34px system-ui, -apple-system, sans-serif";
  ctx.fillText(truncate(ctx, input.assignmentTitle, SIZE - 192), 96, 892);

  // Footer
  ctx.strokeStyle = "rgba(255, 253, 247, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(96, 948);
  ctx.lineTo(SIZE - 96, 948);
  ctx.stroke();

  ctx.fillStyle = PALETTE.mutedInk;
  ctx.font = "27px system-ui, -apple-system, sans-serif";
  ctx.fillText(input.courseName, 96, 992);
  ctx.textAlign = "right";
  ctx.fillText(formatDate(input.completedAt), SIZE - 96, 992);

  return canvas.toBuffer("image/png");
}

/**
 * A nod to the Andean textile motif in the brand assets, drawn as simple
 * geometry so the image stays self-contained and needs no font or asset
 * loading at request time.
 */
function drawWovenBorder(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>): void {
  const band = 28;
  ctx.fillStyle = "rgba(217, 237, 141, 0.16)";
  ctx.fillRect(0, 0, SIZE, band);
  ctx.fillRect(0, SIZE - band, SIZE, band);

  ctx.fillStyle = "rgba(238, 128, 104, 0.55)";
  const step = 60;
  for (let x = step / 2; x < SIZE; x += step) {
    diamond(ctx, x, band / 2, 11);
    diamond(ctx, x, SIZE - band / 2, 11);
  }
}

function diamond(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
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
 * Aliases and task names are teacher-authored free text. Measuring instead of
 * counting characters keeps a long name from running off the canvas.
 */
function truncate(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  value: string,
  maxWidth: number,
): string {
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
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
