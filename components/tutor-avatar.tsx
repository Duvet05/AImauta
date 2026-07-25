"use client";

import Image from "next/image";
import { useState } from "react";

import { TutorAvatar3D } from "@/components/tutor-avatar-3d";
import type { TutorAvatarState } from "@/lib/tutor-avatar";

type TutorAvatarProps = {
  state: TutorAvatarState;
  audioTrack: MediaStreamTrack | null;
};

const avatarDescriptions: Record<TutorAvatarState, string> = {
  idle: "en espera",
  preview: "en vista previa silenciosa",
  connecting: "preparando la conversación",
  ready: "conectado y con el micrófono silenciado",
  listening: "escuchando",
  speaking: "hablando",
  reconnecting: "recuperando la conexión",
  error: "necesita atención",
  unavailable: "no disponible en esta etapa",
};

/**
 * Avatar SVG autocontenido. Se renderiza en el navegador y forma parte del
 * código MIT de AImauta: no requiere cámara, modelo remoto ni servicio externo.
 */
export function TutorAvatar({ state, audioTrack }: TutorAvatarProps) {
  const description = avatarDescriptions[state];
  const [threeDimensionalReady, setThreeDimensionalReady] = useState(false);
  const [brandPortraitReady, setBrandPortraitReady] = useState(false);

  return (
    <div
      className={`tutor-avatar tutor-avatar-${state}`}
      role="img"
      aria-label={`Avatar ilustrado de AImauta: ${description}.`}
    >
      <span className="tutor-avatar-orbit" aria-hidden="true" />
      <TutorAvatar3D
        state={state}
        audioTrack={audioTrack}
        onReadyChange={setThreeDimensionalReady}
      />
      <Image
        className={`tutor-avatar-brand-portrait${
          threeDimensionalReady || !brandPortraitReady
            ? " tutor-avatar-portrait-hidden"
            : ""
        }`}
        src="/brand/characters/amauta-hint.webp"
        alt=""
        aria-hidden="true"
        width={223}
        height={360}
        onLoad={() => setBrandPortraitReady(true)}
        onError={() => setBrandPortraitReady(false)}
        unoptimized
        priority
      />
      <svg
        className={`tutor-avatar-portrait${
          threeDimensionalReady || brandPortraitReady
            ? " tutor-avatar-portrait-hidden"
            : " tutor-avatar-vector-fallback"
        }`}
        viewBox="0 0 160 160"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="tutor-avatar-backdrop" cx="80" cy="80" r="72" />
        <path
          className="tutor-avatar-shoulders"
          d="M28 151c5-28 24-42 52-42s47 14 52 42"
        />
        <path className="tutor-avatar-neck" d="M66 99h28v26H66z" />
        <path
          className="tutor-avatar-hair-back"
          d="M43 68c0-31 15-49 38-49 25 0 39 19 38 51l-7 39H49Z"
        />
        <circle className="tutor-avatar-ear" cx="46" cy="77" r="9" />
        <circle className="tutor-avatar-ear" cx="114" cy="77" r="9" />
        <path
          className="tutor-avatar-face"
          d="M48 61c2-23 15-36 32-36 20 0 32 15 32 39v18c0 23-14 39-32 39S48 105 48 82Z"
        />
        <path
          className="tutor-avatar-hair"
          d="M48 61c1-25 14-40 33-40 20 0 34 17 32 43-11-2-20-9-26-20-8 11-21 18-39 17Z"
        />
        <path className="tutor-avatar-brow" d="M58 68c5-3 10-3 15 0" />
        <path className="tutor-avatar-brow" d="M88 68c5-3 10-3 15 0" />
        <ellipse className="tutor-avatar-eye" cx="66" cy="76" rx="3.4" ry="4" />
        <ellipse className="tutor-avatar-eye" cx="95" cy="76" rx="3.4" ry="4" />
        <path className="tutor-avatar-nose" d="M80 78l-3 13 7 1" />
        <path
          className="tutor-avatar-mouth tutor-avatar-mouth-rest"
          d="M69 101c7 6 15 6 22 0"
        />
        <ellipse
          className="tutor-avatar-mouth tutor-avatar-mouth-talk"
          cx="80"
          cy="103"
          rx="9"
          ry="5"
        />
        <path
          className="tutor-avatar-headset"
          d="M51 80v-6c0-19 12-34 29-34s30 15 30 34v10"
        />
        <rect
          className="tutor-avatar-headset-pad"
          x="43"
          y="74"
          width="10"
          height="20"
          rx="5"
        />
        <rect
          className="tutor-avatar-headset-pad"
          x="108"
          y="74"
          width="10"
          height="20"
          rx="5"
        />
        <path className="tutor-avatar-microphone" d="M113 91c0 9-7 14-17 14" />
        <circle className="tutor-avatar-microphone-tip" cx="94" cy="105" r="3" />
        <path
          className="tutor-avatar-collar"
          d="m58 118 22 16 22-16 16 33H42Z"
        />
        <path className="tutor-avatar-shirt-line" d="M80 134v17" />
      </svg>
      <span className="tutor-avatar-audio-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="tutor-avatar-state" aria-hidden="true" />
    </div>
  );
}
