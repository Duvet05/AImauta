"use client";

import { TutorAvatar } from "@/components/tutor-avatar";

export function AvatarPreview() {
  return (
    <section
      className="voice-tutor avatar-preview"
      aria-labelledby="avatar-preview-title"
    >
      <div className="voice-heading">
        <div className="voice-heading-icon" aria-hidden="true">
          <PreviewIcon />
        </div>
        <div>
          <p>Vista previa experimental</p>
          <h2 id="avatar-preview-title">Avatar de AImauta</h2>
        </div>
        <span className="avatar-preview-badge">Silencioso</span>
      </div>

      <div className="voice-presence">
        <TutorAvatar state="preview" audioTrack={null} />
        <div className="voice-presence-copy">
          <p className="voice-status">
            El personaje se renderiza en tu navegador. La voz y el micrófono
            continúan apagados.
          </p>
          <span className="voice-avatar-privacy">
            Avatar local · sin cámara · sin LiveKit
          </span>
        </div>
      </div>
    </section>
  );
}

function PreviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 15c2-5 4-7 8-7s6 2 8 7M8 7a4 4 0 0 1 8 0M9 15h6M12 15v4" />
    </svg>
  );
}
