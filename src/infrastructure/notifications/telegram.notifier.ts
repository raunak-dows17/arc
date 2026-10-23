import type { NotificationPort } from "../../domain/ports/email.port.js";
import {
  splitTelegramMessage,
  type TelegramApi,
} from "../telegram/telegram.api.js";

export class TelegramNotifier implements NotificationPort {
  constructor(
    private readonly api: TelegramApi,
    private readonly chatId: string | number,
    private readonly maxChars = 4_000,
  ) {}

  async notify(message: string): Promise<void> {
    for (const chunk of splitTelegramMessage(message, this.maxChars)) {
      await this.api.sendMessage(this.chatId, chunk);
    }
  }
}

export class ConsoleNotifier implements NotificationPort {
  constructor(
    private readonly logger: {
      info(message: string): void;
    },
  ) {}

  async notify(message: string): Promise<void> {
    this.logger.info(message);
  }
}
