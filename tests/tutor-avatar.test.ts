import { describe, expect, it } from "vitest";

import { resolveTutorAvatarState } from "@/lib/tutor-avatar";

describe("resolveTutorAvatarState", () => {
  it("prioritizes an unavailable learning stage", () => {
    expect(
      resolveTutorAvatarState({
        connection: "connected",
        disabled: true,
        agentSpeaking: true,
        microphoneEnabled: true,
      }),
    ).toBe("unavailable");
  });

  it.each([
    ["requesting", "connecting"],
    ["connecting", "connecting"],
    ["reconnecting", "reconnecting"],
    ["error", "error"],
    ["idle", "idle"],
  ] as const)("maps %s to %s", (connection, expected) => {
    expect(
      resolveTutorAvatarState({
        connection,
        disabled: false,
        agentSpeaking: false,
        microphoneEnabled: false,
      }),
    ).toBe(expected);
  });

  it("distinguishes ready, listening and speaking while connected", () => {
    expect(
      resolveTutorAvatarState({
        connection: "connected",
        disabled: false,
        agentSpeaking: false,
        microphoneEnabled: false,
      }),
    ).toBe("ready");
    expect(
      resolveTutorAvatarState({
        connection: "connected",
        disabled: false,
        agentSpeaking: false,
        microphoneEnabled: true,
      }),
    ).toBe("listening");
    expect(
      resolveTutorAvatarState({
        connection: "connected",
        disabled: false,
        agentSpeaking: true,
        microphoneEnabled: true,
      }),
    ).toBe("speaking");
  });
});
