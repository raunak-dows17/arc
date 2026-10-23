import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import type { SessionStorePort } from "../../domain/ports/session-store.port.js";
import { AgentSession } from "../../domain/entities/agent-session.js";
import { createSessionId } from "../../shared/id.js";
import { errorMessage, truncateText } from "../../shared/text.js";
import type { RunAgentTurnUseCase } from "../../application/usecases/run-agent-turn.usecase.js";
import {
  splitTelegramMessage,
  type TelegramApi,
} from "./telegram.api.js";

export interface TelegramSessionStatePort {
  load(): Promise<Record<string, string>>;
  save(sessions: Record<string, string>): Promise<void>;
}

export interface TelegramChatLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TelegramChatServiceDeps {
  api: TelegramApi;
  sessions: SessionStorePort;
  profiles: AgentProfileRepositoryPort;
  runAgentTurn: RunAgentTurnUseCase;
  state: TelegramSessionStatePort;
  defaultProfileId: string;
  logger: TelegramChatLogger;
}

/**
 * Maps one Telegram chat to one ARC conversation and runs turns sequentially.
 * Telegram updates are dispatched without blocking the polling loop, so an
 * approval reply can arrive while the tool call is waiting.
 */
export class TelegramChatService {
  private state: Record<string, string> | null = null;
  private readonly sessionChats = new Map<string, string>();
  private readonly active = new Map<string, AbortController>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TelegramChatServiceDeps) {}

  async initialize(): Promise<void> {
    if (this.state !== null) {
      return;
    }
    this.state = await this.deps.state.load();
    for (const [chatId, sessionId] of Object.entries(this.state)) {
      this.sessionChats.set(sessionId, chatId);
    }
    this.deps.logger.info(
      `Telegram chat ready for ${Object.keys(this.state).length} saved chat(s).`,
    );
  }

  async handleMessage(chatId: string, text: string): Promise<void> {
    await this.initialize();
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.startsWith("/")) {
      await this.handleCommand(chatId, trimmed);
      return;
    }
    this.enqueue(chatId, trimmed);
  }

  chatIdForSession(sessionId: string): string | undefined {
    return this.sessionChats.get(sessionId);
  }

  cancelActive(chatId: string): boolean {
    const controller = this.active.get(chatId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
  }

  /** Wait for queued turns to finish; useful for tests and graceful shutdown. */
  async drain(): Promise<void> {
    await this.tail;
  }

  private enqueue(chatId: string, text: string): void {
    const run = (): Promise<void> => this.runChatTurn(chatId, text);
    const next = this.tail.then(run, run);
    this.tail = next.catch((error: unknown) => {
      this.deps.logger.error(
        `Telegram turn failed: ${errorMessage(error)}`,
      );
    });
  }

  private async handleCommand(
    chatId: string,
    commandLine: string,
  ): Promise<void> {
    const [command = "", argument = ""] = commandLine.split(/\s+/, 2);
    switch (command.toLowerCase()) {
      case "/start":
      case "/help":
        await this.sendText(chatId, helpText());
        return;
      case "/new":
      case "/reset":
        await this.startNewSession(chatId, argument.trim());
        return;
      case "/status":
        await this.sendStatus(chatId);
        return;
      case "/stop":
        await this.sendText(
          chatId,
          this.cancelActive(chatId)
            ? "Cancelling the current turn…"
            : "There is no active turn to cancel.",
        );
        return;
      default:
        await this.sendText(
          chatId,
          `Unknown command "${command}".\n\n${helpText()}`,
        );
    }
  }

  private async startNewSession(
    chatId: string,
    requestedProfile: string,
  ): Promise<void> {
    await this.initialize();
    const profileId = requestedProfile || this.deps.defaultProfileId;
    const profile = await this.deps.profiles.get(profileId);
    if (!profile) {
      await this.sendText(
        chatId,
        `Unknown profile "${profileId}". Use /status to see the current profile or start ARC on the desktop to list profiles.`,
      );
      return;
    }

    const session = AgentSession.create(createSessionId(), {
      agentId: profile.id,
    });
    await this.deps.sessions.save(session);
    this.state = this.state ?? {};
    this.state[chatId] = session.id;
    await this.deps.state.save(this.state);
    this.sessionChats.set(session.id, chatId);
    await this.sendText(
      chatId,
      `New ARC session started.\nSession: ${session.id}\nProfile: ${profile.id}`,
    );
  }

  private async sendStatus(chatId: string): Promise<void> {
    const session = await this.sessionFor(chatId);
    const profile = await this.deps.profiles.get(session.agentId);
    await this.sendText(
      chatId,
      [
        "ARC status",
        `Session: ${session.id}`,
        `Profile: ${profile?.id ?? session.agentId}`,
        `Status: ${session.status}`,
        `Messages: ${session.messages.length}`,
        `Model calls: ${session.usage.modelCalls}`,
        `Tokens: ${session.usage.promptTokens} in / ${session.usage.completionTokens} out`,
      ].join("\n"),
    );
  }

  private async runChatTurn(chatId: string, prompt: string): Promise<void> {
    const session = await this.sessionFor(chatId);
    const profile =
      (await this.deps.profiles.get(session.agentId)) ??
      (await this.deps.profiles.get(this.deps.defaultProfileId));
    if (!profile) {
      await this.sendText(
        chatId,
        `ARC profile "${session.agentId}" is not available. Start ARC on the desktop to fix the profile configuration.`,
      );
      return;
    }

    const controller = new AbortController();
    this.active.set(chatId, controller);
    try {
      await this.deps.api
        .sendChatAction(chatId, "typing")
        .catch(() => undefined);
      const answer = await this.deps.runAgentTurn.execute({
        session,
        profile,
        prompt,
        signal: controller.signal,
        channel: "telegram",
        callbacks: {
          onToolCall: () => {
            void this.deps.api
              .sendChatAction(chatId, "typing")
              .catch(() => undefined);
          },
        },
      });
      await this.sendText(chatId, answer || "(no answer)");
    } catch (error) {
      if (controller.signal.aborted) {
        await this.sendText(chatId, "Turn cancelled.");
      } else {
        await this.sendText(
          chatId,
          `ARC error: ${truncateText(errorMessage(error), 1_500)}`,
        );
      }
    } finally {
      if (this.active.get(chatId) === controller) {
        this.active.delete(chatId);
      }
      try {
        await this.deps.sessions.save(session);
      } catch (error) {
        this.deps.logger.error(
          `Could not save Telegram session ${session.id}: ${errorMessage(error)}`,
        );
      }
    }
  }

  private async sessionFor(chatId: string): Promise<AgentSession> {
    await this.initialize();
    const existingId = this.state?.[chatId];
    if (existingId) {
      const loaded = await this.deps.sessions.load(existingId);
      if (loaded) {
        this.sessionChats.set(loaded.id, chatId);
        return loaded;
      }
    }

    const session = AgentSession.create(createSessionId(), {
      agentId: this.deps.defaultProfileId,
    });
    await this.deps.sessions.save(session);
    this.state = this.state ?? {};
    this.state[chatId] = session.id;
    await this.deps.state.save(this.state);
    this.sessionChats.set(session.id, chatId);
    return session;
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    for (const chunk of splitTelegramMessage(text)) {
      await this.deps.api.sendMessage(chatId, chunk);
    }
  }
}

function helpText(): string {
  return [
    "ARC — remote chat",
    "",
    "Send a message to talk to your local agent.",
    "/new [profile] — start a fresh conversation",
    "/status — show the current session",
    "/stop — cancel the active turn",
    "/help — show this help",
    "",
    "Email notifications are read-only. ARC never sends, replies, deletes, or marks mail as read.",
    "Telegram chat is not end-to-end encrypted. Do not paste secrets here.",
  ].join("\n");
}
