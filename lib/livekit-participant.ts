const AIMAUTA_AGENT_NAME = "aimauta-socratic-tutor";
const AIMAUTA_AGENT_NAME_ATTRIBUTE = "lk.agent.name";

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
