import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EmailBatch,
  EmailTriageResult,
  IncomingEmail,
} from "../../domain/entities/incoming-email.js";
import type {
  EmailSourcePort,
  EmailStateStorePort,
  EmailTriagePort,
  EmailWatchState,
  FetchUnreadOptions,
  NotificationPort,
} from "../../domain/ports/email.port.js";
import { EmailWatcherService } from "./email-watcher.service.js";

const email = (uid: number, subject: string): IncomingEmail => ({
  uid,
  from: "Sender <sender@example.com>",
  subject,
  receivedAt: "2026-10-23T12:00:00.000Z",
  snippet: "A short preview.",
});

class FakeSource implements EmailSourcePort {
  readonly calls: FetchUnreadOptions[] = [];
  private readonly batches: EmailBatch[];
  private lastBatch: EmailBatch = { uidValidity: "0", messages: [] };

  constructor(...batches: EmailBatch[]) {
    this.batches = batches;
  }

  async fetchUnread(options: FetchUnreadOptions = {}): Promise<EmailBatch> {
    this.calls.push(options);
    const batch = this.batches.shift() ?? this.lastBatch;
    this.lastBatch = batch;
    if (
      options.afterUid !== undefined &&
      options.expectedUidValidity === batch.uidValidity
    ) {
      return {
        ...batch,
        messages: batch.messages.filter(
          (message) => message.uid > (options.afterUid ?? 0),
        ),
      };
    }
    return batch;
  }
}

class MemoryState implements EmailStateStorePort {
  state: EmailWatchState | null = null;

  async load(): Promise<EmailWatchState | null> {
    return this.state;
  }

  async save(state: EmailWatchState): Promise<void> {
    this.state = state;
  }
}

class MemoryNotifier implements NotificationPort {
  readonly messages: string[] = [];
  fail = false;

  async notify(message: string): Promise<void> {
    if (this.fail) {
      throw new Error("notification down");
    }
    this.messages.push(message);
  }
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function triageFor(
  result: (email: IncomingEmail) => EmailTriageResult,
): EmailTriagePort {
  return {
    async triage(email) {
      return result(email);
    },
  };
}

const attention: EmailTriageResult = {
  needsAttention: true,
  category: "action",
  importance: 8,
  confidence: 0.9,
  fallback: false,
};

const quiet: EmailTriageResult = {
  needsAttention: false,
  category: "newsletter",
  importance: 1,
  confidence: 0.9,
  fallback: false,
};

describe("EmailWatcherService", () => {
  it("notifies once, advances state, and deduplicates unread mail", async () => {
    const source = new FakeSource({
      uidValidity: "1",
      messages: [email(1, "Newsletter"), email(2, "Payment failed")],
    });
    const state = new MemoryState();
    const notifier = new MemoryNotifier();
    const watcher = new EmailWatcherService(
      {
        source,
        triage: triageFor((message) =>
          message.uid === 2 ? attention : quiet,
        ),
        stateStore: state,
        notifier,
      },
      { pollIntervalMs: 60_000, logger },
    );

    const first = await watcher.pollOnce();
    assert.deepEqual(first, {
      fetched: 2,
      notified: 1,
      skipped: 1,
      failed: 0,
    });
    assert.equal(notifier.messages.length, 1);
    assert.match(notifier.messages[0] ?? "", /Payment failed/);
    assert.match(notifier.messages[0] ?? "", /Read-only/);
    assert.equal(state.state?.uidValidity, "1");
    assert.equal(state.state?.lastNotifiedUid, 2);
    assert.equal(source.calls[0]?.afterUid, undefined);

    const second = await watcher.pollOnce();
    assert.deepEqual(second, {
      fetched: 0,
      notified: 0,
      skipped: 0,
      failed: 0,
    });
    assert.equal(source.calls[1]?.afterUid, 2);
    assert.equal(source.calls[1]?.expectedUidValidity, "1");
    assert.equal(notifier.messages.length, 1);
  });

  it("resets the UID cursor when UIDVALIDITY changes", async () => {
    const state = new MemoryState();
    state.state = {
      uidValidity: "old",
      lastNotifiedUid: 99,
      updatedAt: "2026-10-23T00:00:00.000Z",
    };
    const source = new FakeSource({
      uidValidity: "new",
      messages: [email(1, "New mailbox message")],
    });
    const notifier = new MemoryNotifier();
    const watcher = new EmailWatcherService(
      {
        source,
        triage: triageFor(() => attention),
        stateStore: state,
        notifier,
      },
      { pollIntervalMs: 60_000, logger },
    );

    const result = await watcher.pollOnce();

    assert.equal(result.notified, 1);
    assert.equal(source.calls[0]?.afterUid, 99);
    assert.equal(source.calls[0]?.expectedUidValidity, "old");
    assert.equal(state.state?.uidValidity, "new");
    assert.equal(state.state?.lastNotifiedUid, 1);
  });

  it("uses a conservative fallback when Tev1 fails", async () => {
    const source = new FakeSource({
      uidValidity: "1",
      messages: [email(3, "Unclassified")],
    });
    const notifier = new MemoryNotifier();
    const watcher = new EmailWatcherService(
      {
        source,
        triage: {
          async triage() {
            throw new Error("model offline");
          },
        },
        stateStore: new MemoryState(),
        notifier,
      },
      { pollIntervalMs: 60_000, logger },
    );

    const result = await watcher.pollOnce();

    assert.equal(result.notified, 1);
    assert.match(notifier.messages[0] ?? "", /triage unavailable/);
  });

  it("does not advance past a failed notification", async () => {
    const source = new FakeSource({
      uidValidity: "1",
      messages: [email(4, "Important")],
    });
    const state = new MemoryState();
    const notifier = new MemoryNotifier();
    notifier.fail = true;
    const watcher = new EmailWatcherService(
      {
        source,
        triage: triageFor(() => attention),
        stateStore: state,
        notifier,
      },
      { pollIntervalMs: 60_000, logger },
    );

    const result = await watcher.pollOnce();

    assert.equal(result.failed, 1);
    assert.equal(state.state, null);
  });
});
