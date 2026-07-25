import { describe, expect, it } from "vitest";

import {
  isExpectedTavusAvatar,
  isExpectedTutorMediaParticipant,
  isExpectedVoiceAgent,
} from "@/lib/livekit-participant";

const expectedAgent = {
  isAgent: true,
  identity: "agent-worker-123",
  attributes: {
    "lk.agent.name": "aimauta-socratic-tutor",
  },
};

describe("isExpectedVoiceAgent", () => {
  it("accepts only the explicitly dispatched AImauta agent", () => {
    expect(isExpectedVoiceAgent(expectedAgent)).toBe(true);
  });

  it("rejects missing participants and ordinary room users", () => {
    expect(isExpectedVoiceAgent()).toBe(false);
    expect(
      isExpectedVoiceAgent({
        ...expectedAgent,
        isAgent: false,
        identity: "student-session",
      }),
    ).toBe(false);
  });

  it("rejects agent identities without the reserved prefix", () => {
    expect(
      isExpectedVoiceAgent({
        ...expectedAgent,
        identity: "teacher-worker-123",
      }),
    ).toBe(false);
  });

  it("rejects an agent registered under a different dispatch name", () => {
    expect(
      isExpectedVoiceAgent({
        ...expectedAgent,
        attributes: { "lk.agent.name": "another-agent" },
      }),
    ).toBe(false);
  });
});

describe("isExpectedTavusAvatar", () => {
  const expectedAvatar = {
    isAgent: true,
    identity: "tavus-avatar-agent",
    attributes: {
      "lk.publish_on_behalf": "agent-worker-123",
    },
  };

  it("acepta solo el participante Tavus emitido por el agente", () => {
    expect(isExpectedTavusAvatar(expectedAvatar)).toBe(true);
    expect(isExpectedTutorMediaParticipant(expectedAvatar)).toBe(true);
    expect(isExpectedTutorMediaParticipant(expectedAgent)).toBe(true);
  });

  it("rechaza imitaciones sin identidad y delegación exactas", () => {
    expect(
      isExpectedTavusAvatar({
        ...expectedAvatar,
        isAgent: false,
      }),
    ).toBe(false);
    expect(
      isExpectedTavusAvatar({
        ...expectedAvatar,
        identity: "tavus-avatar-agent-copy",
      }),
    ).toBe(false);
    expect(
      isExpectedTavusAvatar({
        ...expectedAvatar,
        attributes: {
          "lk.publish_on_behalf": "student-session-123",
        },
      }),
    ).toBe(false);
  });
});
