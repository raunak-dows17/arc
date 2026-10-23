import { TelegramError } from "../../domain/errors/agent.errors.js";

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramGetUpdatesOptions {
  offset: number;
  timeoutSec: number;
  signal?: AbortSignal;
}

export interface TelegramApiOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Minimal Telegram Bot API client. Only the methods ARC needs are exposed;
 * there is no file upload, group management, or arbitrary method escape hatch.
 * The bot token is kept out of error messages and logs.
 */
export class TelegramApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: TelegramApiOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(
      /\/+$/,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async getUpdates(
    options: TelegramGetUpdatesOptions,
  ): Promise<TelegramUpdate[]> {
    const url = new URL(`${this.baseUrl}/bot${this.options.token}/getUpdates`);
    url.searchParams.set("offset", String(Math.max(0, options.offset)));
    url.searchParams.set("timeout", String(options.timeoutSec));
    url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

    const response = await this.request<TelegramUpdate[]>(
      url,
      { method: "GET" },
      options.timeoutSec * 1_000 + 15_000,
      options.signal,
    );
    return Array.isArray(response) ? response : [];
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    const url = new URL(`${this.baseUrl}/bot${this.options.token}/sendMessage`);
    await this.request<unknown>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  }

  async sendChatAction(
    chatId: string | number,
    action = "typing",
  ): Promise<void> {
    const url = new URL(
      `${this.baseUrl}/bot${this.options.token}/sendChatAction`,
    );
    await this.request<unknown>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    const url = new URL(`${this.baseUrl}/bot${this.options.token}/getMe`);
    return this.request<{ id: number; username?: string }>(url, {
      method: "GET",
    });
  }

  private async request<T>(
    url: URL,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeout])
      : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (callerSignal?.aborted) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new TelegramError("Telegram request timed out.");
      }
      throw new TelegramError(
        `Could not reach Telegram: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    let data: TelegramResponse<T>;
    try {
      data = (await response.json()) as TelegramResponse<T>;
    } catch (error) {
      throw new TelegramError(
        `Telegram returned an unreadable response (HTTP ${response.status}).`,
        { cause: error },
      );
    }

    if (!response.ok || data.ok !== true) {
      const description = data.description ?? `HTTP ${response.status}`;
      throw new TelegramError(`Telegram API error: ${description}`);
    }
    return data.result as T;
  }
}

export function splitTelegramMessage(
  text: string,
  limit = 4_000,
): string[] {
  const safeLimit = Math.max(100, Math.min(4_096, limit));
  if (text.length <= safeLimit) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > safeLimit) {
    let splitAt = remaining.lastIndexOf("\n", safeLimit);
    if (splitAt < Math.floor(safeLimit * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", safeLimit);
    }
    if (splitAt < Math.floor(safeLimit * 0.5)) {
      splitAt = safeLimit;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
