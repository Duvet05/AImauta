import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  accessTokenConstructor: vi.fn(),
  addGrant: vi.fn(),
  createDispatch: vi.fn(),
  createRoom: vi.fn(),
  deleteDispatch: vi.fn(),
  listDispatch: vi.fn(),
  listRooms: vi.fn(),
  toJwt: vi.fn(),
  updateRoomMetadata: vi.fn()
}));

vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {
    constructor(...args: unknown[]) {
      sdk.accessTokenConstructor(...args);
    }

    addGrant(grant: unknown) {
      sdk.addGrant(grant);
    }

    toJwt() {
      return sdk.toJwt();
    }
  },
  AgentDispatchClient: class {
    listDispatch(room: string) {
      return sdk.listDispatch(room);
    }

    createDispatch(room: string, agentName: string, options: unknown) {
      return sdk.createDispatch(room, agentName, options);
    }

    deleteDispatch(dispatchId: string, room: string) {
      return sdk.deleteDispatch(dispatchId, room);
    }
  },
  RoomAgentDispatch: class {
    constructor(readonly options: unknown) {}
  },
  RoomServiceClient: class {
    listRooms(names: string[]) {
      return sdk.listRooms(names);
    }

    createRoom(options: unknown) {
      return sdk.createRoom(options);
    }

    updateRoomMetadata(room: string, metadata: string) {
      return sdk.updateRoomMetadata(room, metadata);
    }
  },
  TrackSource: { MICROPHONE: 2 }
}));

import { issueLearningSession } from "@/lib/learning-session";
import { createVoiceAccess } from "@/lib/livekit-server";

const bookId = "fichas-matematica-1-secundaria";

beforeAll(() => {
  process.env.AIMAUTA_SESSION_SECRET =
    "test-only-session-secret-with-at-least-32-characters";
  process.env.LIVEKIT_URL = "wss://aimauta-test.livekit.cloud";
  process.env.LIVEKIT_API_URL = "https://aimauta-test.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret";
});

afterAll(() => {
  delete process.env.AIMAUTA_SESSION_SECRET;
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();
  sdk.listRooms.mockResolvedValue([]);
  sdk.listDispatch.mockResolvedValue([]);
  sdk.createRoom.mockResolvedValue({});
  sdk.createDispatch.mockResolvedValue({});
  sdk.deleteDispatch.mockResolvedValue(undefined);
  sdk.toJwt.mockResolvedValue("student-jwt");
});

describe("acceso LiveKit", () => {
  it("crea una sala AImauta, despacha el agente nombrado y limita el JWT", async () => {
    const session = issueLearningSession({ bookId, page: 17 });
    const access = await createVoiceAccess(session.token);

    expect(sdk.listRooms).toHaveBeenCalledWith([
      `aimauta-${session.state.sessionId}`
    ]);
    expect(sdk.createRoom).toHaveBeenCalledOnce();
    const room = sdk.createRoom.mock.calls[0]?.[0] as {
      name: string;
      maxParticipants: number;
      metadata: string;
      agents: Array<{
        options: { agentName: string; metadata: string };
      }>;
    };
    expect(room).toMatchObject({
      name: `aimauta-${session.state.sessionId}`,
      maxParticipants: 3
    });
    expect(room.agents[0]?.options.agentName).toBe(
      "aimauta-socratic-tutor"
    );
    expect(JSON.parse(room.metadata)).toMatchObject({
      app: "aimauta",
      session_id: session.state.sessionId,
      page: 17,
      stage: "practice",
      mode: "socratic"
    });
    expect(JSON.parse(room.metadata)).not.toHaveProperty("session_token");
    expect(JSON.parse(room.agents[0]?.options.metadata as string)).toMatchObject({
      app: "aimauta",
      session_id: session.state.sessionId,
      session_token: session.token
    });
    expect(sdk.addGrant).toHaveBeenCalledWith({
      room: `aimauta-${session.state.sessionId}`,
      roomJoin: true,
      canPublish: true,
      canPublishSources: [2],
      canSubscribe: true,
      canPublishData: true
    });
    expect(access).toMatchObject({
      token: "student-jwt",
      serverUrl: "wss://aimauta-test.livekit.cloud",
      roomName: `aimauta-${session.state.sessionId}`,
      expiresIn: 900,
      maxSessionSeconds: 600
    });
  });

  it("vuelve a despachar el agente cuando una sala viva solo tiene jobs terminados", async () => {
    sdk.listRooms.mockResolvedValue([{ name: "existing" }]);
    sdk.listDispatch.mockResolvedValue([
      {
        id: "stale-dispatch",
        agentName: "aimauta-socratic-tutor",
        state: { jobs: [{ state: { status: 2 } }] }
      }
    ]);
    const session = issueLearningSession({ bookId, page: 17 });

    await createVoiceAccess(session.token);

    const roomName = `aimauta-${session.state.sessionId}`;
    expect(sdk.createRoom).not.toHaveBeenCalled();
    expect(sdk.updateRoomMetadata).toHaveBeenCalledWith(
      roomName,
      expect.any(String)
    );
    expect(sdk.deleteDispatch).toHaveBeenCalledWith(
      "stale-dispatch",
      roomName
    );
    expect(sdk.createDispatch).toHaveBeenCalledWith(
      roomName,
      "aimauta-socratic-tutor",
      {
        metadata: expect.stringContaining(session.token)
      }
    );
  });

  it("no duplica un dispatch pendiente o en ejecución", async () => {
    sdk.listRooms.mockResolvedValue([{ name: "existing" }]);
    sdk.listDispatch.mockResolvedValue([
      {
        id: "active-dispatch",
        agentName: "aimauta-socratic-tutor",
        state: { jobs: [{ state: { status: 1 } }] }
      }
    ]);
    const session = issueLearningSession({ bookId, page: 17 });

    await createVoiceAccess(session.token);

    expect(sdk.deleteDispatch).not.toHaveBeenCalled();
    expect(sdk.createDispatch).not.toHaveBeenCalled();
  });
});
