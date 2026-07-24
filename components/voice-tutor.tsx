"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  RemoteParticipant,
  Room as LiveKitRoom,
} from "livekit-client";
import { TutorAvatar } from "@/components/tutor-avatar";
import type { PageActivity } from "@/lib/curriculum";
import type { LearningSessionState } from "@/lib/learning-session";
import { isExpectedVoiceAgent } from "@/lib/livekit-participant";
import {
  resolveTutorAvatarState,
  type TutorAvatarConnection,
} from "@/lib/tutor-avatar";

type VoiceTutorProps = {
  sessionId: string;
  sessionToken: string;
  disabled: boolean;
  disabledReason?: string;
  onSessionUpdate: (update: VoiceSessionUpdate) => void;
};

export type VoiceSessionUpdate = {
  token: string;
  state: LearningSessionState;
  activity: PageActivity;
};

type VoiceConnection = TutorAvatarConnection;

type VoiceAccess = {
  token: string;
  serverUrl: string;
  expiresIn: number;
  maxSessionSeconds: number;
};

const voiceLabels: Record<VoiceConnection, string> = {
  idle: "La conversación por voz está apagada.",
  requesting: "Solicitando acceso seguro a la sala.",
  connecting: "Conectando el tutor de voz.",
  connected: "Tutor de voz conectado y escuchando.",
  reconnecting: "Recuperando la conexión de voz.",
  error: "La conversación por voz necesita atención.",
};

const AGENT_CONNECT_TIMEOUT_MS = 12_000;

export function VoiceTutor({
  sessionId,
  sessionToken,
  disabled,
  disabledReason,
  onSessionUpdate,
}: VoiceTutorProps) {
  const roomRef = useRef<LiveKitRoom | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef(sessionId);
  const lastPublishedTokenRef = useRef("");
  const seenSessionPacketTokensRef = useRef(new Set<string>());
  const activationSequenceRef = useRef(0);
  const voiceDeadlineRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [agentAudioTrack, setAgentAudioTrack] =
    useState<MediaStreamTrack | null>(null);
  const [needsAudioStart, setNeedsAudioStart] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const clearRemoteAudio = useCallback(() => {
    setAgentAudioTrack(null);
    const container = audioContainerRef.current;
    if (!container) return;

    for (const media of container.querySelectorAll("audio")) {
      media.pause();
      media.remove();
    }
  }, []);

  const publishSessionContext = useCallback(async (token: string) => {
    const room = roomRef.current;
    if (
      !room ||
      !token ||
      lastPublishedTokenRef.current === token
    ) {
      return;
    }

    const payload = new TextEncoder().encode(
      JSON.stringify({ v: 1, sessionToken: token }),
    );
    await room.localParticipant.publishData(payload, {
      reliable: true,
      topic: "aimauta.context.v1",
    });
    lastPublishedTokenRef.current = token;
  }, []);

  const stopVoice = useCallback(async () => {
    activationSequenceRef.current += 1;
    stoppingRef.current = true;
    if (voiceDeadlineRef.current !== null) {
      window.clearTimeout(voiceDeadlineRef.current);
      voiceDeadlineRef.current = null;
    }
    const room = roomRef.current;
    roomRef.current = null;

    try {
      if (room) {
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        await room.disconnect();
        room.removeAllListeners();
      }
    } finally {
      clearRemoteAudio();
      lastPublishedTokenRef.current = "";
      seenSessionPacketTokensRef.current.clear();
      setMicrophoneEnabled(false);
      setAgentSpeaking(false);
      setNeedsAudioStart(false);
      setConnection("idle");
      stoppingRef.current = false;
    }
  }, [clearRemoteAudio]);

  useEffect(() => {
    if (disabled) {
      void stopVoice();
    }
  }, [disabled, stopVoice]);

  useEffect(() => {
    if (activeSessionIdRef.current !== sessionId) {
      activeSessionIdRef.current = sessionId;
      setErrorMessage(
        "La sesión cambió. La voz se apagó para que puedas activarla de nuevo con seguridad.",
      );
      void stopVoice();
      return;
    }
    activeSessionIdRef.current = sessionId;
  }, [sessionId, stopVoice]);

  useEffect(() => {
    if (connection === "connected") {
      void publishSessionContext(sessionToken).catch(() => {
        setErrorMessage(
          "No se pudo actualizar el contexto de la voz. Puedes apagarla y volver a activarla.",
        );
      });
    }
  }, [connection, publishSessionContext, sessionToken]);

  useEffect(
    () => () => {
      activationSequenceRef.current += 1;
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        void room.disconnect();
        room.removeAllListeners();
      }
      if (voiceDeadlineRef.current !== null) {
        window.clearTimeout(voiceDeadlineRef.current);
        voiceDeadlineRef.current = null;
      }
      clearRemoteAudio();
    },
    [clearRemoteAudio],
  );

  async function startVoice() {
    if (
      disabled ||
      !sessionToken ||
      connection === "requesting" ||
      connection === "connecting" ||
      connection === "connected" ||
      connection === "reconnecting"
    ) {
      return;
    }

    const activationSequence = ++activationSequenceRef.current;
    setErrorMessage("");
    setNeedsAudioStart(false);
    setConnection("requesting");

    try {
      const accessResponse = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });
      const accessBody = (await accessResponse.json().catch(() => ({}))) as
        | Partial<VoiceAccess> & { error?: string };

      if (
        !accessResponse.ok ||
        !accessBody.token ||
        !accessBody.serverUrl ||
        typeof accessBody.expiresIn !== "number" ||
        !Number.isFinite(accessBody.expiresIn) ||
        typeof accessBody.maxSessionSeconds !== "number" ||
        !Number.isFinite(accessBody.maxSessionSeconds)
      ) {
        const fallback =
          accessResponse.status === 423
            ? "La voz se pausa durante Evaluamos."
            : accessResponse.status === 503
              ? "El tutor de voz todavía no está disponible en este entorno."
              : "No se pudo abrir la sala de voz.";
        throw new Error(accessBody.error || fallback);
      }
      if (
        activationSequence !== activationSequenceRef.current
      ) {
        return;
      }

      setConnection("connecting");
      const livekit = await import("livekit-client");
      if (
        activationSequence !== activationSequenceRef.current
      ) {
        return;
      }
      const room = new livekit.Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(
        livekit.RoomEvent.TrackSubscribed,
        (track, _publication, participant) => {
          if (
            track.kind !== livekit.Track.Kind.Audio ||
            !isExpectedVoiceAgent(participant)
          ) {
            return;
          }

          setAgentAudioTrack(track.mediaStreamTrack);
          const element = track.attach();
          if (element instanceof HTMLAudioElement) {
            element.autoplay = true;
            element.setAttribute("playsinline", "");
            element.dataset.aimautaRemoteAudio = "true";
            audioContainerRef.current?.appendChild(element);
            void element.play().catch(() => setNeedsAudioStart(true));
          }
        },
      );

      room.on(
        livekit.RoomEvent.TrackUnsubscribed,
        (track, _publication, participant) => {
          if (!isExpectedVoiceAgent(participant)) return;

          setAgentAudioTrack((current) =>
            current === track.mediaStreamTrack ? null : current,
          );
          for (const element of track.detach()) {
            element.remove();
          }
        },
      );

      room.on(livekit.RoomEvent.Reconnecting, () => {
        setConnection("reconnecting");
      });
      room.on(livekit.RoomEvent.Reconnected, () => {
        setConnection("connected");
      });
      room.on(livekit.RoomEvent.Disconnected, () => {
        if (stoppingRef.current) return;
        setErrorMessage(
          "La conexión de voz terminó. Puedes activarla nuevamente cuando la red esté estable.",
        );
        void stopVoice();
      });
      room.on(livekit.RoomEvent.ParticipantDisconnected, (participant) => {
        if (!isExpectedVoiceAgent(participant) || stoppingRef.current) return;

        setErrorMessage(
          "La sesión de voz terminó. Puedes activarla de nuevo si necesitas continuar.",
        );
        void stopVoice();
      });
      room.on(livekit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(
          speakers.some((participant) => isExpectedVoiceAgent(participant)),
        );
      });
      room.on(
        livekit.RoomEvent.DataReceived,
        (payload, participant, _kind, topic) => {
          if (
            topic !== "aimauta.session.v1" ||
            !isExpectedVoiceAgent(participant) ||
            _kind !== livekit.DataPacket_Kind.RELIABLE ||
            payload.byteLength === 0 ||
            payload.byteLength > 16_384
          ) {
            return;
          }

          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
            const update = parseVoiceSessionUpdate(parsed, sessionId);
            if (
              !update ||
              seenSessionPacketTokensRef.current.has(update.token)
            ) {
              return;
            }

            seenSessionPacketTokensRef.current.add(update.token);
            if (seenSessionPacketTokensRef.current.size > 32) {
              const oldestToken =
                seenSessionPacketTokensRef.current.values().next().value;
              if (oldestToken) {
                seenSessionPacketTokensRef.current.delete(oldestToken);
              }
            }
            onSessionUpdate(update);
          } catch {
            setErrorMessage(
              "La voz envió una actualización que no se pudo validar. La sesión de texto continúa activa.",
            );
          }
        },
      );

      await room.connect(accessBody.serverUrl, accessBody.token);
      if (
        activationSequence !== activationSequenceRef.current
      ) {
        await room.disconnect();
        return;
      }

      if (
        !Array.from(room.remoteParticipants.values()).some((participant) =>
          isExpectedVoiceAgent(participant),
        )
      ) {
        await new Promise<void>((resolve, reject) => {
          const onParticipantConnected = (participant: RemoteParticipant) => {
            if (!isExpectedVoiceAgent(participant)) return;
            cleanup();
            resolve();
          };
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(
              new Error(
                "El agente de voz no respondió a tiempo. Inténtalo nuevamente en unos segundos.",
              ),
            );
          }, AGENT_CONNECT_TIMEOUT_MS);
          const cleanup = () => {
            window.clearTimeout(timeout);
            room.off(
              livekit.RoomEvent.ParticipantConnected,
              onParticipantConnected,
            );
          };
          room.on(
            livekit.RoomEvent.ParticipantConnected,
            onParticipantConnected,
          );
        });
      }
      if (activationSequence !== activationSequenceRef.current) {
        await room.disconnect();
        return;
      }

      await room.startAudio().catch(() => setNeedsAudioStart(true));
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicrophoneEnabled(true);
      setConnection("connected");
      await publishSessionContext(sessionToken);
      const sessionSeconds = Math.max(
        60,
        Math.min(
          Number(accessBody.expiresIn),
          Number(accessBody.maxSessionSeconds),
        ),
      );
      voiceDeadlineRef.current = window.setTimeout(() => {
        setErrorMessage(
          "La sesión de voz alcanzó su duración máxima. Puedes iniciar otra si todavía necesitas ayuda.",
        );
        void stopVoice();
      }, sessionSeconds * 1_000);
    } catch (error) {
      if (activationSequence !== activationSequenceRef.current) {
        return;
      }
      const isPermissionError =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setErrorMessage(
        isPermissionError
          ? "El navegador bloqueó el micrófono. Permite su uso en la configuración del sitio y vuelve a intentarlo."
          : error instanceof Error
            ? error.message
            : "No se pudo iniciar el tutor de voz.",
      );
      setConnection("error");
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        await room.disconnect().catch(() => undefined);
        room.removeAllListeners();
      }
      if (voiceDeadlineRef.current !== null) {
        window.clearTimeout(voiceDeadlineRef.current);
        voiceDeadlineRef.current = null;
      }
      clearRemoteAudio();
      setMicrophoneEnabled(false);
    }
  }

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room || connection !== "connected") return;

    try {
      const nextEnabled = !microphoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(nextEnabled);
      setMicrophoneEnabled(nextEnabled);
      setErrorMessage("");
    } catch {
      setErrorMessage("No se pudo cambiar el estado del micrófono.");
    }
  }

  async function resumeAudio() {
    const room = roomRef.current;
    if (!room) return;

    try {
      await room.startAudio();
      for (const audio of audioContainerRef.current?.querySelectorAll("audio") ?? []) {
        await audio.play();
      }
      setNeedsAudioStart(false);
      setErrorMessage("");
    } catch {
      setErrorMessage(
        "El navegador mantiene el audio bloqueado. Revisa el permiso de sonido del sitio.",
      );
    }
  }

  const isActive =
    connection === "connected" || connection === "reconnecting";
  const isStarting =
    connection === "requesting" || connection === "connecting";
  const statusText =
    connection === "connected" && agentSpeaking
      ? "AImauta está hablando. Puedes detener la voz cuando quieras."
      : connection === "connected" && !microphoneEnabled
        ? "Tutor conectado. Tu micrófono está silenciado."
        : voiceLabels[connection];
  const avatarState = resolveTutorAvatarState({
    connection,
    disabled,
    agentSpeaking,
    microphoneEnabled,
  });

  return (
    <section className="voice-tutor" aria-labelledby="voice-tutor-title">
      <div className="voice-heading">
        <div className="voice-heading-icon" aria-hidden="true">
          <WaveIcon />
        </div>
        <div>
          <p>Canal opcional</p>
          <h2 id="voice-tutor-title">Tutor por voz</h2>
        </div>
        <span
          className={`voice-state-dot voice-state-${connection}`}
          aria-hidden="true"
        />
      </div>

      <div className="voice-presence">
        <TutorAvatar state={avatarState} audioTrack={agentAudioTrack} />
        <div className="voice-presence-copy">
          {disabled ? (
            <p className="voice-disabled-message">
              <LockMiniIcon />
              {disabledReason ?? "La voz no está disponible en esta etapa."}
            </p>
          ) : (
            <p className="voice-status" role="status" aria-live="polite">
              {statusText}
            </p>
          )}
          <span className="voice-avatar-privacy">
            Avatar local · sin cámara
          </span>
        </div>
      </div>

      {!disabled ? (
        <>
          <div className="voice-controls">
            {isStarting ? (
              <>
                <button
                  className="voice-button voice-button-primary"
                  type="button"
                  disabled
                >
                  <MicrophoneIcon />
                  Conectando…
                </button>
                <button
                  className="voice-button voice-button-quiet"
                  type="button"
                  onClick={() => void stopVoice()}
                >
                  <StopIcon />
                  Cancelar
                </button>
              </>
            ) : !isActive ? (
              <button
                className="voice-button voice-button-primary"
                type="button"
                onClick={() => void startVoice()}
                disabled={!sessionToken}
              >
                <MicrophoneIcon />
                Activar voz
              </button>
            ) : (
              <>
                <button
                  className="voice-button voice-button-primary"
                  type="button"
                  onClick={() => void toggleMicrophone()}
                  disabled={connection !== "connected"}
                  aria-pressed={microphoneEnabled}
                >
                  {microphoneEnabled ? <MicrophoneIcon /> : <MutedIcon />}
                  {microphoneEnabled ? "Silenciar" : "Activar micro"}
                </button>
                <button
                  className="voice-button voice-button-quiet"
                  type="button"
                  onClick={() => void stopVoice()}
                >
                  <StopIcon />
                  Terminar
                </button>
              </>
            )}
          </div>
          {needsAudioStart ? (
            <button
              className="voice-audio-unlock"
              type="button"
              onClick={() => void resumeAudio()}
            >
              Reproducir audio del tutor
            </button>
          ) : null}
        </>
      ) : null}

      {errorMessage ? (
        <p className="voice-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="remote-audio" ref={audioContainerRef} aria-hidden="true" />
    </section>
  );
}

function parseVoiceSessionUpdate(
  value: unknown,
  expectedSessionId: string,
): VoiceSessionUpdate | null {
  if (!value || typeof value !== "object") return null;

  const message = value as Record<string, unknown>;
  if (
    message.v !== 1 ||
    typeof message.sessionToken !== "string" ||
    message.sessionToken.length === 0 ||
    message.sessionToken.length > 4_096 ||
    !message.session ||
    typeof message.session !== "object" ||
    !message.activity ||
    typeof message.activity !== "object"
  ) {
    return null;
  }

  const session = message.session as Record<string, unknown>;
  const activity = message.activity as Record<string, unknown>;
  const validStages = new Set([
    "orientation",
    "learn",
    "practice",
    "assessment",
  ]);
  const validSession =
    session.sessionId === expectedSessionId &&
    typeof session.bookId === "string" &&
    typeof session.page === "number" &&
    Number.isInteger(session.page) &&
    session.page > 0 &&
    (typeof session.unitId === "string" || session.unitId === null) &&
    typeof session.stage === "string" &&
    validStages.has(session.stage) &&
    typeof session.attemptCount === "number" &&
    Number.isInteger(session.attemptCount) &&
    session.attemptCount >= 0 &&
    typeof session.turnCount === "number" &&
    Number.isInteger(session.turnCount) &&
    session.turnCount >= 0 &&
    typeof session.totalTurnCount === "number" &&
    Number.isInteger(session.totalTurnCount) &&
    session.totalTurnCount >= 0 &&
    typeof session.hintLevel === "number" &&
    Number.isInteger(session.hintLevel) &&
    session.hintLevel >= 0 &&
    session.hintLevel <= 3 &&
    typeof session.revision === "number" &&
    Number.isInteger(session.revision) &&
    session.revision >= 0 &&
    typeof session.createdAt === "number" &&
    typeof session.expiresAt === "number";
  const validActivity =
    (typeof activity.unitId === "string" || activity.unitId === null) &&
    activity.unitId === session.unitId &&
    (typeof activity.unitNumber === "number" || activity.unitNumber === null) &&
    typeof activity.unitTitle === "string" &&
    activity.unitTitle.length <= 200 &&
    (typeof activity.competency === "string" || activity.competency === null) &&
    typeof activity.stage === "string" &&
    activity.stage === session.stage &&
    typeof activity.stageLabel === "string" &&
    activity.stageLabel.length <= 80 &&
    typeof activity.startPage === "number" &&
    Number.isInteger(activity.startPage) &&
    typeof activity.endPage === "number" &&
    Number.isInteger(activity.endPage) &&
    activity.startPage > 0 &&
    activity.endPage >= activity.startPage &&
    Number(session.page) >= activity.startPage &&
    Number(session.page) <= activity.endPage &&
    typeof activity.tutorAvailable === "boolean";

  if (!validSession || !validActivity) return null;

  return {
    token: message.sessionToken,
    state: session as unknown as LearningSessionState,
    activity: activity as unknown as PageActivity,
  };
}

function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 14v-4M8 17V7M12 20V4M16 17V7M20 14v-4" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 9V6a3 3 0 0 1 5.7-1.3M15 10.5V12a3 3 0 0 1-5.3 1.9M6 11a6 6 0 0 0 10 4.5M12 18v3M9 21h6M4 4l16 16" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function LockMiniIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M6.5 8V6.5a3.5 3.5 0 0 1 7 0V8M5.5 8h9v8h-9V8Z" />
    </svg>
  );
}
