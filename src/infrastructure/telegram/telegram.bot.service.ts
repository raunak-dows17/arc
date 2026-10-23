import { errorMessage } from "../../shared/text.js";
import type { TelegramApprovalPrompt } from "./telegram.approval.prompt.js";
import type { TelegramChatService } from "./telegram.chat.service.js";
import type { TelegramApi, TelegramUpdate } from "./telegram.api.js";

export interface TelegramOffsetStorePort {
  load(): Promise<number>;
  save(offset: number): Promise<void>;
}

export interface TelegramBotLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TelegramBotServiceDeps {
  api: TelegramApi;
  allowedChatIds: ReadonlySet<string>;
  chat: TelegramChatService;
  approvals: TelegramApprovalPrompt;
  offsetStore: TelegramOffsetStorePort;
  logger: TelegramBotLogger;
  pollTimeoutSec?: number;
}

/**
 * Long-polls Telegram. Update handling is deliberately non-blocking so an
 * approval reply can be processed while a chat turn is waiting for it.
 */
export class TelegramBotService {
  private readonly pollTimeoutSec: number;

  constructor(private readonly deps: TelegramBotServiceDeps) {
    this.pollTimeoutSec = deps.pollTimeoutSec ?? 30;
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.deps.allowedChatIds.size === 0) {
      throw new Error(
        "Telegram is enabled but ARC_TELEGRAM_ALLOWED_CHAT_IDS is empty.",
      );
    }
    await this.deps.chat.initialize();
    let offset = await this.deps.offsetStore.load();
    this.deps.logger.info(
      `Telegram bot polling (${this.deps.allowedChatIds.size} allowed chat(s)).`,
    );

    while (!signal.aborted) {
      try {
        const updates = await this.deps.api.getUpdates({
          offset,
          timeoutSec: this.pollTimeoutSec,
          signal,
        });
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          try {
            await this.handleUpdate(update);
          } catch (error) {
            this.deps.logger.error(
              `Telegram update ${update.update_id} failed: ${errorMessage(error)}`,
            );
          }
        }
        if (updates.length > 0) {
          await this.deps.offsetStore.save(offset).catch((error: unknown) => {
            this.deps.logger.warn(
              `Could not save Telegram offset: ${errorMessage(error)}`,
            );
          });
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        this.deps.logger.warn(
          `Telegram polling failed: ${errorMessage(error)}`,
        );
        await sleep(5_000, signal);
      }
    }
    this.deps.logger.info("Telegram bot stopped.");
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) {
      return;
    }
    const chatId = String(message.chat.id);
    if (!this.deps.allowedChatIds.has(chatId)) {
      this.deps.logger.warn(
        `Ignored Telegram message from unauthorized chat ${chatId}.`,
      );
      return;
    }

    const text = message.text?.trim();
    if (!text) {
      await this.deps.api
        .sendMessage(chatId, "ARC currently accepts text messages only.")
        .catch(() => undefined);
      return;
    }

    if (text.toLowerCase() === "/stop") {
      const cancelled = this.deps.chat.cancelActive(chatId);
      this.deps.approvals.cancelAll("The turn was cancelled from Telegram.");
      await this.deps.api
        .sendMessage(
          chatId,
          cancelled ? "Cancelling the current turn…" : "No active turn to cancel.",
        )
        .catch(() => undefined);
      return;
    }

    if (this.deps.approvals.handleReply(chatId, text)) {
      return;
    }

    void this.deps.chat.handleMessage(chatId, text).catch((error: unknown) => {
      this.deps.logger.error(
        `Telegram chat handler failed: ${errorMessage(error)}`,
      );
    });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = (): void => done();
    signal.addEventListener("abort", onAbort, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
  });
}
