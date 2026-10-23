import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedMail } from "mailparser";
import {
  GmailImapEmailSource,
  type ImapClientLike,
  type ImapMessageLike,
} from "./gmail-imap.email-source.js";

class FakeImapClient implements ImapClientLike {
  connectCalls = 0;
  mailboxOpenCall:
    | { path: string; options?: { readOnly?: boolean } }
    | undefined;
  searchCall:
    | {
        query: { unseen?: boolean; since?: Date; uid?: string };
        options?: { uid?: boolean };
      }
    | undefined;
  fetchCall:
    | {
        range: number[];
        query: { uid?: boolean; source?: boolean | { maxLength?: number } };
        options?: { uid?: boolean };
      }
    | undefined;
  logoutCalls = 0;
  closeCalls = 0;
  searchResult: number[] | false = [3, 5];
  messages: ImapMessageLike[] = [];

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  async mailboxOpen(
    path: string,
    options?: { readOnly?: boolean },
  ): Promise<{ uidValidity: bigint }> {
    this.mailboxOpenCall = { path, ...(options ? { options } : {}) };
    return { uidValidity: 42n };
  }

  async search(
    query: { unseen?: boolean; since?: Date; uid?: string },
    options?: { uid?: boolean },
  ): Promise<number[] | false> {
    this.searchCall = { query, ...(options ? { options } : {}) };
    return this.searchResult;
  }

  async *fetch(
    range: number[],
    query: { uid?: boolean; source?: boolean | { maxLength?: number } },
    options?: { uid?: boolean },
  ): AsyncIterable<ImapMessageLike> {
    this.fetchCall = {
      range,
      query,
      ...(options ? { options } : {}),
    };
    for (const message of this.messages) {
      yield message;
    }
  }

  close(): void {
    this.closeCalls += 1;
  }

  async logout(): Promise<void> {
    this.logoutCalls += 1;
  }
}

function parsedMail(overrides: Partial<ParsedMail> = {}): ParsedMail {
  return {
    attachments: [],
    headers: new Map(),
    headerLines: [],
    from: {
      value: [{ name: "Billing", address: "billing@example.com" }],
      html: "",
      text: "",
    },
    subject: "Payment failed",
    date: new Date("2026-10-23T12:00:00.000Z"),
    text: "  We could not\n\n\ncharge your card.  ",
    messageId: "<message-1@example.com>",
    ...overrides,
  } as ParsedMail;
}

describe("GmailImapEmailSource", () => {
  it("opens the mailbox read-only and fetches with PEEK-style source queries", async () => {
    const client = new FakeImapClient();
    client.messages = [{ uid: 3, source: Buffer.from("raw") }];
    const source = new GmailImapEmailSource({
      user: "user@example.com",
      password: "app-password",
      createClient: () => client,
      parseSource: async () => parsedMail(),
      now: () => Date.parse("2026-10-23T12:00:00.000Z"),
      lookbackDays: 2,
      maxMessages: 10,
      snippetChars: 100,
    });

    const batch = await source.fetchUnread({
      afterUid: 2,
      expectedUidValidity: "42",
    });

    assert.equal(client.connectCalls, 1);
    assert.deepEqual(client.mailboxOpenCall, {
      path: "INBOX",
      options: { readOnly: true },
    });
    assert.equal(client.searchCall?.query.unseen, true);
    assert.equal(client.searchCall?.query.uid, "3:*");
    assert.equal(client.searchCall?.options?.uid, true);
    assert.equal(client.fetchCall?.query.uid, true);
    assert.deepEqual(client.fetchCall?.query.source, { maxLength: 1_024 * 1_024 });
    assert.equal(client.fetchCall?.options?.uid, true);
    assert.equal(batch.uidValidity, "42");
    assert.equal(batch.messages.length, 1);
    assert.equal(batch.messages[0]?.uid, 3);
    assert.equal(batch.messages[0]?.from, "Billing <billing@example.com>");
    assert.equal(batch.messages[0]?.subject, "Payment failed");
    assert.equal(
      batch.messages[0]?.snippet,
      "We could not\n\ncharge your card.",
    );
    assert.equal(client.logoutCalls, 1);
  });

  it("does not apply a stale UID cursor after UIDVALIDITY changes", async () => {
    const client = new FakeImapClient();
    client.searchResult = [];
    const source = new GmailImapEmailSource({
      user: "user@example.com",
      password: "app-password",
      createClient: () => client,
      parseSource: async () => parsedMail(),
    });

    const batch = await source.fetchUnread({
      afterUid: 50,
      expectedUidValidity: "old-uidvalidity",
    });

    assert.equal(client.searchCall?.query.uid, undefined);
    assert.equal(batch.messages.length, 0);
    assert.equal(client.logoutCalls, 1);
  });

  it("returns an empty batch when no unread messages match", async () => {
    const client = new FakeImapClient();
    client.searchResult = false;
    const source = new GmailImapEmailSource({
      user: "user@example.com",
      password: "app-password",
      createClient: () => client,
      parseSource: async () => parsedMail(),
    });

    const batch = await source.fetchUnread();

    assert.equal(batch.uidValidity, "42");
    assert.deepEqual(batch.messages, []);
    assert.equal(client.fetchCall, undefined);
    assert.equal(client.logoutCalls, 1);
  });
});
