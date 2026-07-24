import { describe, expect, it } from "vitest";

import { isExpectedVoiceAgent } from "@/lib/livekit-participant";

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
