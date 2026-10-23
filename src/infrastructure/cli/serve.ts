import path from "node:path";
import type { AgentProfileRepositoryPort } from "../../domain/ports/profile-repository.port.js";
import type { DecisionModelPort } from "../../domain/ports/decision-model.port.js";
import type { SecretStorePort } from "../../domain/ports/secret-store.port.js";
import type { SessionStorePort } from "../../domain/ports/session-store.port.js";
import { EmailTriageService } from "../../application/services/email-triage.service.js";
import { EmailWatcherService } from "../../application/services/email-watcher.service.js";
import type { RunAgentTurnUseCase } from "../../application/usecases/run-agent-turn.usecase.js";
import { GmailImapEmailSource } from "../email/gmail-imap.email-source.js";
import { JsonEmailStateStore } from "../email/json-email-state.store.js";
import { ConsoleNotifier, TelegramNotifier } from "../notifications/telegram.notifier.js";
import { SECRET_ACCOUNTS } from "../../shared/secret-accounts.js";
import { errorMessage } from "../../shared/text.js";
import type { AppConfig } from "../config/env.js";
import type { TerminalRenderer } from "./terminal.renderer.js";
import { TelegramApi } from "../telegram/telegram.api.js";
import { TelegramApprovalPrompt } from "../telegram/telegram.approval.prompt.js";
import { TelegramBotService } from "../telegram/telegram.bot.service.js";
import { TelegramChatService } from "../telegram/telegram.chat.service.js";
import {
  JsonTelegramOffsetStore,
  JsonTelegramSessionStore,
} from "../telegram/json-telegram-state.store.js";

export interface ServeDependencies {
  config: AppConfig;
  renderer: TerminalRenderer;
  secretStore: SecretStorePort;
  decisionModel: DecisionModelPort;
  runAgentTurn: RunAgentTurnUseCase;
  sessions: SessionStorePort;
  profiles: AgentProfileRepositoryPort;
  telegramApi?: TelegramApi;
  telegramApprovals?: TelegramApprovalPrompt;
}

/**
 * Always-on mode: Telegram remote chat and/or read-only email notifications.
 * The process stays alive until Ctrl+C/SIGTERM and then closes both loops.
 */
export async function runServeMode(deps: ServeDependencies): Promise<void> {
  const { config, renderer } = deps;
  if (!config.email.enabled && !config.telegram.enabled) {
    throw new Error(
      "Nothing to serve. Set ARC_EMAIL_ENABLED=true and/or ARC_TELEGRAM_ENABLED=true.",
    );
  }

  const abort = new AbortController();
  const onSignal = (): void => abort.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const tasks: Promise<void>[] = [];
  let chat: TelegramChatService | undefined;

  try {
    if (config.telegram.enabled) {
      if (!deps.telegramApi || !deps.telegramApprovals) {
        throw new Error(
          "Telegram is enabled but the bot token is missing. Run: arc secrets set telegram.bot-token",
        );
      }
      chat = new TelegramChatService({
        api: deps.telegramApi,
        sessions: deps.sessions,
        profiles: deps.profiles,
        runAgentTurn: deps.runAgentTurn,
        state: new JsonTelegramSessionStore(
          path.join(config.arcHome, "telegram-sessions.json"),
        ),
        defaultProfileId: config.agent.defaultProfileId,
        logger: renderer,
      });
      deps.telegramApprovals.setChatResolver((sessionId) =>
        chat?.chatIdForSession(sessionId),
      );

      const bot = new TelegramBotService({
        api: deps.telegramApi,
        allowedChatIds: new Set(config.telegram.allowedChatIds),
        chat,
        approvals: deps.telegramApprovals,
        offsetStore: new JsonTelegramOffsetStore(
          path.join(config.arcHome, "telegram-offset.json"),
        ),
        logger: renderer,
        pollTimeoutSec: config.telegram.pollTimeoutSec,
      });
      tasks.push(
        bot.start(abort.signal).catch((error: unknown) => {
          renderer.error(`Telegram bot stopped: ${errorMessage(error)}`);
          abort.abort();
        }),
      );
    }

    if (config.email.enabled) {
      const password = await deps.secretStore.get(
        SECRET_ACCOUNTS.gmailAppPassword,
      );
      if (!password) {
        throw new Error(
          "Gmail is enabled but no app password is stored. Run: arc secrets set gmail.app-password",
        );
      }

      const source = new GmailImapEmailSource({
        user: config.email.address,
        password: password.replace(/\s+/g, ""),
        host: config.email.imapHost,
        port: config.email.imapPort,
        mailbox: config.email.mailbox,
        lookbackDays: config.email.lookbackDays,
        maxMessages: config.email.maxMessages,
        snippetChars: config.email.snippetChars,
      });
      const triage = new EmailTriageService(deps.decisionModel, {
        threshold: config.email.triageThreshold,
      });
      const notifier =
        deps.telegramApi && config.telegram.notifyChatId
          ? new TelegramNotifier(
              deps.telegramApi,
              config.telegram.notifyChatId,
            )
          : new ConsoleNotifier(renderer);
      const watcher = new EmailWatcherService(
        {
          source,
          triage,
          stateStore: new JsonEmailStateStore(
            path.join(config.arcHome, "email-state.json"),
          ),
          notifier,
        },
        {
          pollIntervalMs: config.email.pollIntervalMs,
          maxMessagesPerPoll: config.email.maxMessages,
          notifyOnTriageFailure: config.email.notifyOnTriageFailure,
          logger: renderer,
        },
      );
      tasks.push(watcher.start(abort.signal));
    }

    renderer.info(
      [
        "ARC serve is running.",
        config.telegram.enabled
          ? `Telegram chat: ${config.telegram.allowedChatIds.length} allowed chat(s).`
          : "Telegram: disabled.",
        config.email.enabled
          ? `Gmail: ${config.email.address} (${config.email.mailbox}, read-only).`
          : "Gmail: disabled.",
        "Press Ctrl+C to stop.",
      ].join("\n"),
    );

    await waitForAbort(abort.signal);
  } finally {
    abort.abort();
    chat?.cancelAll();
    deps.telegramApprovals?.cancelAll("ARC is shutting down.");
    await Promise.allSettled(tasks);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    renderer.info("ARC serve stopped.");
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
