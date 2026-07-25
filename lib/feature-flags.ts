export function isStrictlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function isVoiceTutorEnabled(): boolean {
  return isStrictlyEnabled(process.env.AIMAUTA_VOICE_TUTOR_ENABLED);
}

export function isAvatarEnabled(): boolean {
  return isStrictlyEnabled(process.env.AIMAUTA_AVATAR_ENABLED);
}
