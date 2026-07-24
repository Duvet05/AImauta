export type TutorAvatarConnection =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type TutorAvatarState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "error"
  | "unavailable";

type TutorAvatarSignals = {
  connection: TutorAvatarConnection;
  disabled: boolean;
  agentSpeaking: boolean;
  microphoneEnabled: boolean;
};

export function resolveTutorAvatarState({
  connection,
  disabled,
  agentSpeaking,
  microphoneEnabled,
}: TutorAvatarSignals): TutorAvatarState {
  if (disabled) return "unavailable";

  switch (connection) {
    case "requesting":
    case "connecting":
      return "connecting";
    case "connected":
      if (agentSpeaking) return "speaking";
      return microphoneEnabled ? "listening" : "ready";
    case "reconnecting":
      return "reconnecting";
    case "error":
      return "error";
    default:
      return "idle";
  }
}
