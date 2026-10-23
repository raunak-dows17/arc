import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentProfile } from "../../domain/entities/agent-profile.js";
import { AgentSession } from "../../domain/entities/agent-session.js";
import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import type {
  SessionStorePort,
  SessionSummary,
} from "../../domain/ports/session-store.port.js";
import type {
  RunAgentTurnInput,
  RunAgentTurnUseCase,
} from "../../application/usecases/run-agent-turn.usecase.js";
import type { TelegramApi } from "./telegram.api.js";
import {
  TelegramChatService,
  type TelegramSessionStatePort,
} from "./telegram.chat.service.js";

class MemorySessions implements SessionStorePort {
  readonly sessions = new Map<string, AgentSession>();

  async save(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async load(id: string): Promise<AgentSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async latest(): Promise<AgentSession | null> {
    return null;
  }

  async list(): Promise<SessionSummary[]> {
    return [];
  }
}

const profile = AgentProfile.create({
  id: "arc",
  name: "ARC",
  description: "test profile",
  systemPrompt: "",
  tools: "*",
  skills: "*",
  maxSteps: 12,
  canSpawn: true,
  memoryWrite: true,
  readOnly: false,
  builtIn: true,
});

const profiles: AgentProfileRepositoryPort = {
  async get(id) {
    return id === "arc" ? profile : null;
  },
  async list() {
    return [profile];
  },
  async reload() {
    return;
  },
};

class MemoryTelegramState implements TelegramSessionStatePort {
  sessions: Record<string, string> = {};

  async load(): Promise<Record<string, string>> {
    return { ...this.sessions };
  }

  async save(sessions: Record<string, string>): Promise<void> {
    this.sessions = { ...sessions };
  }
}

function fakeApi() {
  const sent: string[] = [];
  const actions: string[] = [];
  const api = {
    async sendMessage(_chatId: string | number, text: string) {
      sent.push(text);
    },
    async sendChatAction(_chatId: string | number, action: string) {
      actions.push(action);
    },
  } as unknown as TelegramApi;
  return { api, sent, actions };
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("TelegramChatService", () => {
  it("runs a remote turn on the telegram approval channel and persists the session", async () => {
    const sessions = new MemorySessions();
    const state = new MemoryTelegramState();
    const { api, sent, actions } = fakeApi();
    let captured: RunAgentTurnInput | undefined;
    const runAgentTurn = {
      async execute(input: RunAgentTurnInput) {
        captured = input;
        input.session.addAssistantMessage("remote answer");
        return "remote answer";
      },
    } as unknown as RunAgentTurnUseCase;

    const chat = new TelegramChatService({
      api,
      sessions,
      profiles,
      runAgentTurn,
      state,
      defaultProfileId: "arc",
      logger,
    });

    await chat.handleMessage("123", "hello");
    await chat.drain();

    assert.equal(captured?.channel, "telegram");
    assert.equal(captured?.prompt, "hello");
    assert.equal(sent.at(-1), "remote answer");
    assert.deepEqual(actions, ["typing"]);
    assert.ok(captured?.session.id);
    assert.equal(chat.chatIdForSession(captured?.session.id ?? ""), "123");
    assert.equal(state.sessions["123"], captured?.session.id);
    assert.ok(sessions.sessions.has(captured?.session.id ?? ""));
  });

  it("starts a fresh session with /new and keeps the chat mapping", async () => {
    const sessions = new MemorySessions();
    const state = new MemoryTelegramState();
    const { api, sent } = fakeApi();
    const runAgentTurn = {
      async execute(input: RunAgentTurnInput) {
        return `answer for ${input.session.id}`;
      },
    } as unknown as RunAgentTurnUseCase;

    const chat = new TelegramChatService({
      api,
      sessions,
      profiles,
      runAgentTurn,
      state,
      defaultProfileId: "arc",
      logger,
    });

    await chat.handleMessage("123", "/new");
    assert.match(sent.at(-1) ?? "", /New ARC session started/);
    const firstSession = state.sessions["123"];
    assert.ok(firstSession);

    await chat.handleMessage("123", "second conversation");
    await chat.drain();
    assert.equal(state.sessions["123"], firstSession);
    assert.match(sent.at(-1) ?? "", new RegExp(`answer for ${firstSession}`));

    await chat.handleMessage("123", "/new");
    const secondSession = state.sessions["123"];
    assert.notEqual(secondSession, firstSession);
    assert.ok(secondSession);
    assert.equal(chat.chatIdForSession(secondSession ?? ""), "123");
  });

  it("reports status and handles /stop without an active turn", async () => {
    const sessions = new MemorySessions();
    const state = new MemoryTelegramState();
    const { api, sent } = fakeApi();
    const runAgentTurn = {
      async execute() {
        return "ok";
      },
    } as unknown as RunAgentTurnUseCase;

    const chat = new TelegramChatService({
      api,
      sessions,
      profiles,
      runAgentTurn,
      state,
      defaultProfileId: "arc",
      logger,
    });

    await chat.handleMessage("123", "/status");
    assert.match(sent.at(-1) ?? "", /ARC status/);
    assert.match(sent.at(-1) ?? "", /Profile: arc/);

    await chat.handleMessage("123", "/stop");
    assert.match(sent.at(-1) ?? "", /no active turn/i);
  });
});
