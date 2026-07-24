import {
  AccessToken,
  AgentDispatchClient,
  RoomAgentDispatch,
  RoomServiceClient,
  TrackSource
} from "livekit-server-sdk";

import { getBook } from "@/lib/catalog";
import { getPageActivity } from "@/lib/curriculum";
import { verifyLearningSession } from "@/lib/learning-session";
import { consumeRateLimit } from "@/lib/rate-limit";

const VOICE_TOKEN_TTL_SECONDS = 15 * 60;
const VOICE_SESSION_MAX_SECONDS = 10 * 60;
const AIMAUTA_AGENT_NAME = "aimauta-socratic-tutor";

export class VoiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceConfigurationError";
  }
}

export class VoiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}

type LiveKitConfiguration = {
  websocketUrl: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

function configuration(): LiveKitConfiguration {
  const websocketUrl = process.env.LIVEKIT_URL ?? "";
  const apiUrl =
    process.env.LIVEKIT_API_URL ??
    websocketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";

  if (!websocketUrl || !apiUrl || !apiKey || !apiSecret) {
    throw new VoiceConfigurationError(
      "LiveKit todavía no está configurado para este entorno."
    );
  }
  let wsUrl: URL;
  let apiHttpUrl: URL;
  try {
    wsUrl = new URL(websocketUrl);
    apiHttpUrl = new URL(apiUrl);
  } catch {
    throw new VoiceConfigurationError("Las URL de LiveKit son inválidas.");
  }
  if (
    !["ws:", "wss:"].includes(wsUrl.protocol) ||
    !["http:", "https:"].includes(apiHttpUrl.protocol) ||
    wsUrl.username ||
    wsUrl.password ||
    apiHttpUrl.username ||
    apiHttpUrl.password ||
    (wsUrl.protocol === "ws:" && !isLoopback(wsUrl)) ||
    (apiHttpUrl.protocol === "http:" && !isLoopback(apiHttpUrl)) ||
    (!isLoopback(wsUrl) &&
      !isLoopback(apiHttpUrl) &&
      wsUrl.hostname !== apiHttpUrl.hostname)
  ) {
    throw new VoiceConfigurationError(
      "Las URL de LiveKit son inválidas o no usan transporte seguro."
    );
  }

  return { websocketUrl, apiUrl, apiKey, apiSecret };
}

export async function createVoiceAccess(sessionToken: string): Promise<{
  token: string;
  serverUrl: string;
  roomName: string;
  participantIdentity: string;
  expiresIn: number;
  maxSessionSeconds: number;
}> {
  const session = verifyLearningSession(sessionToken);
  consumeRateLimit({
    scope: "voice-access",
    key: session.sessionId,
    limit: 6,
    windowMs: 60_000
  });
  const activity = getPageActivity(session.bookId, session.page);
  if (!activity.tutorAvailable) {
    throw new VoiceUnavailableError(
      activity.stage === "assessment" && activity.unitId !== null
        ? "El tutor de voz está en pausa durante Evaluamos."
        : "El tutor de voz no está habilitado en esta página."
    );
  }

  const book = getBook(session.bookId);
  if (!book) {
    throw new VoiceUnavailableError("Material no encontrado.");
  }

  const config = configuration();
  const roomName = `aimauta-${session.sessionId}`;
  const participantIdentity = `student-${session.sessionId}`;
  const roomMetadata = JSON.stringify({
    v: 1,
    app: "aimauta",
    session_id: session.sessionId,
    book_id: session.bookId,
    page: session.page,
    total_pages: book.pages,
    subject: book.subject,
    grade: book.grade,
    language: "es-PE",
    stage: session.stage,
    mode: "socratic"
  });
  const dispatchMetadata = JSON.stringify({
    v: 1,
    app: "aimauta",
    session_id: session.sessionId,
    session_token: sessionToken
  });

  const roomService = new RoomServiceClient(
    config.apiUrl,
    config.apiKey,
    config.apiSecret
  );
  const dispatchService = new AgentDispatchClient(
    config.apiUrl,
    config.apiKey,
    config.apiSecret
  );
  const existingRooms = await roomService.listRooms([roomName]);
  if (existingRooms.length === 0) {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 60,
      departureTimeout: 20,
      maxParticipants: 3,
      metadata: roomMetadata,
      agents: [
        new RoomAgentDispatch({
          agentName: AIMAUTA_AGENT_NAME,
          metadata: dispatchMetadata
        })
      ]
    });
  } else {
    await roomService.updateRoomMetadata(roomName, roomMetadata);
    const dispatches = await dispatchService.listDispatch(roomName);
    const namedDispatches = dispatches.filter(
      (dispatch) => dispatch.agentName === AIMAUTA_AGENT_NAME
    );
    const hasActiveDispatch = namedDispatches.some((dispatch) => {
      const jobs = dispatch.state?.jobs ?? [];
      return (
        jobs.length === 0 ||
        jobs.some((job) => {
          const status = job.state?.status;
          return status === undefined || status === 0 || status === 1;
        })
      );
    });

    if (!hasActiveDispatch) {
      for (const dispatch of namedDispatches) {
        await dispatchService.deleteDispatch(dispatch.id, roomName);
      }
      await dispatchService.createDispatch(roomName, AIMAUTA_AGENT_NAME, {
        metadata: dispatchMetadata
      });
    }
  }

  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantIdentity,
    ttl: VOICE_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      v: 1,
      app: "aimauta",
      session_id: session.sessionId
    })
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: true
  });

  return {
    token: await accessToken.toJwt(),
    serverUrl: config.websocketUrl,
    roomName,
    participantIdentity,
    expiresIn: VOICE_TOKEN_TTL_SECONDS,
    maxSessionSeconds: VOICE_SESSION_MAX_SECONDS
  };
}
