const AIMAUTA_AGENT_NAME = "aimauta-socratic-tutor";
const AIMAUTA_AGENT_NAME_ATTRIBUTE = "lk.agent.name";
const TAVUS_AVATAR_IDENTITY = "tavus-avatar-agent";
const PUBLISH_ON_BEHALF_ATTRIBUTE = "lk.publish_on_behalf";

type VoiceAgentParticipant = {
  isAgent: boolean;
  identity: string;
  attributes: Readonly<Record<string, string>>;
};

/**
 * A remote participant controls tutor audio only when all three independent
 * LiveKit identity signals match the explicitly dispatched agent.
 */
export function isExpectedVoiceAgent(
  participant?: VoiceAgentParticipant,
): boolean {
  return (
    participant?.isAgent === true &&
    participant.identity.startsWith("agent-") &&
    participant.attributes[AIMAUTA_AGENT_NAME_ATTRIBUTE] === AIMAUTA_AGENT_NAME
  );
}

/**
 * Tavus joins with a server-issued agent token and may publish only on behalf
 * of the dispatched LiveKit agent. It never controls session data messages.
 */
export function isExpectedTavusAvatar(
  participant?: VoiceAgentParticipant,
): boolean {
  return (
    participant?.isAgent === true &&
    participant.identity === TAVUS_AVATAR_IDENTITY &&
    participant.attributes[PUBLISH_ON_BEHALF_ATTRIBUTE]?.startsWith(
      "agent-",
    ) === true
  );
}

export function isExpectedTutorMediaParticipant(
  participant?: VoiceAgentParticipant,
): boolean {
  return (
    isExpectedVoiceAgent(participant) ||
    isExpectedTavusAvatar(participant)
  );
}
