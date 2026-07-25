export type TutorAvatarConnection =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type TutorAvatarState =
  | "idle"
  | "preview"
  | "connecting"
  | "ready"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "error"
  | "unavailable";

export type TutorMouthPose = {
  jawOpen: number;
  visemeAa: number;
  visemeE: number;
  visemeFf: number;
  visemeI: number;
  visemeO: number;
  visemeSs: number;
  visemeU: number;
};

type TutorAvatarSignals = {
  connection: TutorAvatarConnection;
  disabled: boolean;
  agentSpeaking: boolean;
  microphoneEnabled: boolean;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function resolveTutorMouthPose({
  level,
  low,
  mid,
  high,
}: {
  level: number;
  low: number;
  mid: number;
  high: number;
}): TutorMouthPose {
  const amplitude = clampUnit(level);
  if (amplitude < 0.01) {
    return {
      jawOpen: 0,
      visemeAa: 0,
      visemeE: 0,
      visemeFf: 0,
      visemeI: 0,
      visemeO: 0,
      visemeSs: 0,
      visemeU: 0,
    };
  }

  const safeLow = clampUnit(low);
  const safeMid = clampUnit(mid);
  const safeHigh = clampUnit(high);
  const spectrumTotal = safeLow + safeMid + safeHigh;
  const lowShare = spectrumTotal > 0 ? safeLow / spectrumTotal : 1 / 3;
  const midShare = spectrumTotal > 0 ? safeMid / spectrumTotal : 1 / 3;
  const highShare = spectrumTotal > 0 ? safeHigh / spectrumTotal : 1 / 3;
  const vowelGain = Math.min(1, amplitude * 1.12);

  return {
    jawOpen: Math.min(1, Math.pow(amplitude, 0.82) * 0.68),
    visemeAa: vowelGain * (0.16 + midShare * 0.68),
    visemeE: vowelGain * highShare * 0.58,
    visemeFf: amplitude * highShare * 0.2,
    visemeI: vowelGain * highShare * 0.42,
    visemeO: vowelGain * lowShare * 0.72,
    visemeSs: amplitude * highShare * 0.16,
    visemeU: vowelGain * lowShare * 0.42,
  };
}

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
