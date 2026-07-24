import { timingSafeEqual } from "node:crypto";

export class InternalAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InternalAuthConfigurationError";
  }
}

export function isAuthorizedAgentRequest(request: Request): boolean {
  const expected = process.env.AIMAUTA_AGENT_SECRET;
  if (!expected || expected.length < 32) {
    throw new InternalAuthConfigurationError(
      "AIMAUTA_AGENT_SECRET debe tener al menos 32 caracteres."
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }

  const received = authorization.slice(prefix.length);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
