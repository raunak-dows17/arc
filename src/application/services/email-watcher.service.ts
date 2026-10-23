import type {
  EmailTriageResult,
  IncomingEmail,
} from "../../domain/entities/incoming-email.js";
import type {
  EmailSourcePort,
  EmailStateStorePort,
  EmailTriagePort,
  NotificationPort,
} from "../../domain/ports/email.port.js";
import { errorMessage, truncateText } from "../../shared/text.js";

export interface EmailWatcherLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface EmailWatcherOptions {
  pollIntervalMs: number;
  maxMessagesPerPoll?: number;
  notifyOnTriageFailure?: boolean;
  logger: EmailWatcherLogger;
}

export interface EmailPollResult {
  fetched: number;
  notified: number;
  skipped: number;
  failed: number;
}

/**
 * Polls unread mail without changing its read state. Deduplication uses
 * UIDVALIDITY plus the last processed UID because the mailbox stays unread and
 * therefore keeps returning the same messages on every poll.
 */
export class EmailWatcherService {
  private readonly maxMessagesPerPoll: number;
  private readonly notifyOnTriageFailure: boolean;

  constructor(
    private readonly deps: {
      source: EmailSourcePort;
      triage: EmailTriagePort;
      stateStore: EmailStateStorePort;
      notifier: NotificationPort;
    },
    private readonly options: EmailWatcherOptions,
  ) {
    this.maxMessagesPerPoll = options.maxMessagesPerPoll ?? 10;
    this.notifyOnTriageFailure = options.notifyOnTriageFailure ?? true;
  }

  async pollOnce(signal?: AbortSignal): Promise<EmailPollResult> {
    signal?.throwIfAborted();
    const previous = await this.deps.stateStore.load();
    const batch = await this.deps.source.fetchUnread({
      ...(previous
        ? {
            afterUid: previous.lastNotifiedUid,
            expectedUidValidity: previous.uidValidity,
          }
        : {}),
      ...(signal ? { signal } : {}),
    });

    const sameMailbox =
      previous !== null && previous.uidValidity === batch.uidValidity;
    let lastProcessedUid = sameMailbox ? previous.lastNotifiedUid : 0;
    const pending = batch.messages
      .filter((email) => email.uid > lastProcessedUid)
      .sort((left, right) => left.uid - right.uid)
      .slice(0, Math.max(1, this.maxMessagesPerPoll));

    const result: EmailPollResult = {
      fetched: batch.messages.length,
      notified: 0,
      skipped: 0,
      failed: 0,
    };

    for (const email of pending) {
      signal?.throwIfAborted();
      const triage = await this.classify(email, signal);

      if (!triage.needsAttention) {
        result.skipped += 1;
        lastProcessedUid = email.uid;
        await this.persist(batch.uidValidity, lastProcessedUid);
        continue;
      }

      try {
        await this.deps.notifier.notify(formatNotification(email, triage));
        result.notified += 1;
        lastProcessedUid = email.uid;
        await this.persist(batch.uidValidity, lastProcessedUid);
      } catch (error) {
        result.failed += 1;
        this.options.logger.error(
          `Could not send notification for email UID ${email.uid}: ${errorMessage(error)}`,
        );
        // Do not advance past a failed notification; the next poll retries it.
        break;
      }
    }

    if (pending.length === 0 && !sameMailbox) {
      await this.persist(batch.uidValidity, lastProcessedUid);
    }

    return result;
  }

  async start(signal: AbortSignal): Promise<void> {
    this.options.logger.info(
      `Email watcher started (every ${Math.round(this.options.pollIntervalMs / 1_000)}s, read-only).`,
    );
    while (!signal.aborted) {
      try {
        const result = await this.pollOnce(signal);
        if (result.fetched > 0) {
          this.options.logger.info(
            `Email poll: ${result.fetched} unread, ${result.notified} notified, ${result.skipped} skipped, ${result.failed} failed.`,
          );
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        this.options.logger.error(
          `Email watcher poll failed: ${errorMessage(error)}`,
        );
      }
      await sleep(this.options.pollIntervalMs, signal);
    }
    this.options.logger.info("Email watcher stopped.");
  }

  private async classify(
    email: IncomingEmail,
    signal?: AbortSignal,
  ): Promise<EmailTriageResult> {
    try {
      return await this.deps.triage.triage(email, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.options.logger.warn(
        `Tev1 email triage failed for UID ${email.uid}: ${errorMessage(error)}`,
      );
      return {
        needsAttention: this.notifyOnTriageFailure,
        category: "unknown",
        importance: 5,
        confidence: 0,
        fallback: true,
      };
    }
  }

  private async persist(uidValidity: string, lastNotifiedUid: number) {
    await this.deps.stateStore.save({
      uidValidity,
      lastNotifiedUid,
      updatedAt: new Date().toISOString(),
    });
  }
}

export function formatNotification(
  email: IncomingEmail,
  triage: EmailTriageResult,
): string {
  const category = triage.fallback
    ? "triage unavailable"
    : `${triage.category}, importance ${triage.importance.toFixed(0)}/10`;
  return truncateText(
    [
      `📬 Email needs attention [${category}]`,
      `From: ${email.from}`,
      `Subject: ${email.subject}`,
      `Received: ${email.receivedAt}`,
      "",
      email.snippet || "(no text preview)",
      "",
      "Read-only: ARC did not mark this message as read.",
    ].join("\n"),
    3_800,
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, Math.max(1, ms));
    const onAbort = (): void => done();
    signal.addEventListener("abort", onAbort, { once: true });

    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
  });
}
