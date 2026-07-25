"use client";

import { useState } from "react";

type ShareAchievementProps = {
  token: string;
  assignmentTitle: string;
};

/**
 * Sharing surface for a finished activity.
 *
 * Prefers the native share sheet, which on a phone sends the actual image file
 * into a WhatsApp chat. Falls back to wa.me with the receipt link, which is
 * what desktop and older browsers can do.
 */
export function ShareAchievement({
  token,
  assignmentTitle,
}: ShareAchievementProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const imageUrl = `/api/completado/${encodeURIComponent(token)}/image`;
  const message = `¡Actividad completada! "${assignmentTitle}" — con AImauta.`;

  async function share() {
    setBusy(true);
    try {
      const pageUrl = window.location.href;

      if (navigator.canShare) {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], "aimauta-actividad-completada.png", {
            type: "image/png",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: message });
            return;
          }
        }
      }

      if (navigator.share) {
        await navigator.share({ title: message, text: message, url: pageUrl });
        return;
      }

      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${message} ${pageUrl}`)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch {
      // A cancelled share sheet lands here too, so this stays silent.
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="achievement-share">
      {/* Server-rendered PNG, identical to what gets shared. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={`Constancia de la actividad ${assignmentTitle} completada`}
        width={480}
        height={480}
      />

      <div className="achievement-buttons">
        <button type="button" onClick={share} disabled={busy}>
          {busy ? "Preparando…" : "Compartir por WhatsApp"}
        </button>
        <a href={imageUrl} download="aimauta-actividad-completada.png">
          Descargar imagen
        </a>
        <button type="button" onClick={copyLink}>
          {copied ? "Enlace copiado ✓" : "Copiar enlace"}
        </button>
      </div>
    </div>
  );
}
