import { describe, expect, it } from "vitest";

import {
  resolveTutorAvatarState,
  resolveTutorMouthPose,
} from "@/lib/tutor-avatar";

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

describe("resolveTutorMouthPose", () => {
  it("keeps every morph closed during silence", () => {
    expect(
      resolveTutorMouthPose({
        level: 0,
        low: 1,
        mid: 1,
        high: 1,
      }),
    ).toEqual({
      jawOpen: 0,
      visemeAa: 0,
      visemeE: 0,
      visemeFf: 0,
      visemeI: 0,
      visemeO: 0,
      visemeSs: 0,
      visemeU: 0,
    });
  });

  it("leans toward rounded visemes for low-frequency speech", () => {
    const pose = resolveTutorMouthPose({
      level: 0.8,
      low: 0.9,
      mid: 0.2,
      high: 0.05,
    });

    expect(pose.jawOpen).toBeGreaterThan(0);
    expect(pose.visemeO).toBeGreaterThan(pose.visemeE);
    expect(pose.visemeU).toBeGreaterThan(pose.visemeI);
  });

  it("leans toward bright visemes for high-frequency speech", () => {
    const pose = resolveTutorMouthPose({
      level: 0.8,
      low: 0.05,
      mid: 0.2,
      high: 0.9,
    });

    expect(pose.visemeE).toBeGreaterThan(pose.visemeO);
    expect(pose.visemeI).toBeGreaterThan(pose.visemeU);
    expect(pose.visemeFf).toBeGreaterThan(0);
    expect(pose.visemeSs).toBeGreaterThan(0);
  });

  it("clamps invalid analyser values to safe finite weights", () => {
    const pose = resolveTutorMouthPose({
      level: Number.POSITIVE_INFINITY,
      low: Number.NaN,
      mid: -1,
      high: 2,
    });

    expect(Object.values(pose).every(Number.isFinite)).toBe(true);
    expect(Object.values(pose).every((value) => value >= 0 && value <= 1)).toBe(
      true,
    );
  });
});
