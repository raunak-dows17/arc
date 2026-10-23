import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type {
  EmailBatch,
  IncomingEmail,
} from "../../domain/entities/incoming-email.js";
import { EmailSourceError } from "../../domain/errors/agent.errors.js";
import type {
  EmailSourcePort,
  FetchUnreadOptions,
} from "../../domain/ports/email.port.js";
import { htmlToText } from "../../shared/html.js";

export interface ImapMessageLike {
  uid: number;
  source?: Buffer;
}

/**
 * The small surface ARC needs from an IMAP client. Keeping this narrow makes
 * the Gmail adapter testable without a live mailbox and prevents accidental
 * calls to flag-changing methods.
 */
export interface ImapClientLike {
  connect(): Promise<void>;
  mailboxOpen(
    path: string,
    options?: { readOnly?: boolean },
  ): Promise<{ uidValidity: bigint }>;
  search(
    query: {
      unseen?: boolean;
      since?: Date;
      uid?: string;
    },
    options?: { uid?: boolean },
  ): Promise<number[] | false | undefined>;
  fetch(
    range: number[],
    query: {
      uid?: boolean;
      source?: boolean | { maxLength?: number };
    },
    options?: { uid?: boolean },
  ): AsyncIterable<ImapMessageLike>;
  close(): void;
  logout(): Promise<void>;
}

export interface GmailImapEmailSourceOptions {
  user: string;
  password: string;
  host?: string;
  port?: number;
  secure?: boolean;
  mailbox?: string;
  lookbackDays?: number;
  maxMessages?: number;
  maxSourceBytes?: number;
  snippetChars?: number;
  createClient?: () => ImapClientLike;
  parseSource?: (source: Buffer) => Promise<ParsedMail>;
  now?: () => number;
}

/**
 * Read-only Gmail IMAP source. The mailbox is opened with EXAMINE (readOnly),
 * and message bodies are fetched with BODY.PEEK semantics by imapflow, so ARC
 * never marks mail as seen. There is intentionally no method for sending,
 * deleting, moving, or flagging messages.
 */
export class GmailImapEmailSource implements EmailSourcePort {
  private readonly host: string;
  private readonly port: number;
  private readonly secure: boolean;
  private readonly mailbox: string;
  private readonly lookbackDays: number;
  private readonly maxMessages: number;
  private readonly maxSourceBytes: number;
  private readonly snippetChars: number;
  private readonly createClient: () => ImapClientLike;
  private readonly parseSource: (source: Buffer) => Promise<ParsedMail>;
  private readonly now: () => number;

  constructor(private readonly options: GmailImapEmailSourceOptions) {
    this.host = options.host ?? "imap.gmail.com";
    this.port = options.port ?? 993;
    this.secure = options.secure ?? true;
    this.mailbox = options.mailbox ?? "INBOX";
    this.lookbackDays = options.lookbackDays ?? 2;
    this.maxMessages = options.maxMessages ?? 10;
    this.maxSourceBytes = options.maxSourceBytes ?? 1_024 * 1_024;
    this.snippetChars = options.snippetChars ?? 800;
    this.now = options.now ?? Date.now;
    this.parseSource = options.parseSource ?? ((source) => simpleParser(source));
    this.createClient =
      options.createClient ??
      (() =>
        new ImapFlow({
          host: this.host,
          port: this.port,
          secure: this.secure,
          auth: {
            user: options.user,
            pass: options.password,
          },
          logger: false,
        }) as unknown as ImapClientLike);
  }

  async fetchUnread(
    options: FetchUnreadOptions = {},
  ): Promise<EmailBatch> {
    const signal = options.signal;
    signal?.throwIfAborted();

    const client = this.createClient();
    const onAbort = (): void => client.close();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await client.connect();
      signal?.throwIfAborted();

      const mailbox = await client.mailboxOpen(this.mailbox, {
        readOnly: true,
      });
      const uidValidity = String(mailbox.uidValidity);
      const since = new Date(
        this.now() - Math.max(1, this.lookbackDays) * 24 * 60 * 60 * 1_000,
      );
      const query: { unseen: true; since: Date; uid?: string } = {
        unseen: true,
        since,
      };
      if (
        options.afterUid &&
        options.afterUid > 0 &&
        (!options.expectedUidValidity ||
          options.expectedUidValidity === uidValidity)
      ) {
        query.uid = `${options.afterUid + 1}:*`;
      }

      const found = await client.search(query, { uid: true });
      signal?.throwIfAborted();
      if (!found || found.length === 0) {
        return { uidValidity, messages: [] };
      }

      const uids = [...new Set(found)]
        .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
        .sort((left, right) => left - right)
        .slice(-Math.max(1, this.maxMessages));
      if (uids.length === 0) {
        return { uidValidity, messages: [] };
      }

      const messages: IncomingEmail[] = [];
      for await (const raw of client.fetch(
        uids,
        {
          uid: true,
          source: { maxLength: this.maxSourceBytes },
        },
        { uid: true },
      )) {
        signal?.throwIfAborted();
        if (!raw.source) {
          continue;
        }
        messages.push(await this.parseMessage(raw));
      }

      return { uidValidity, messages };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw new EmailSourceError(
        `Could not read Gmail IMAP mailbox "${this.mailbox}": ${errorMessage(error)}`,
        { cause: error },
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await client.logout().catch(() => undefined);
    }
  }

  private async parseMessage(raw: ImapMessageLike): Promise<IncomingEmail> {
    const parsed = await this.parseSource(raw.source as Buffer);
    const text = normalizeText(
      parsed.text?.trim() ||
        (typeof parsed.html === "string" ? htmlToText(parsed.html) : ""),
    );
    const received = parsed.date;
    return {
      uid: raw.uid,
      from: normalizeText(formatAddress(parsed.from)) || "unknown sender",
      subject: normalizeText(parsed.subject ?? "") || "(no subject)",
      receivedAt:
        received instanceof Date && !Number.isNaN(received.getTime())
          ? received.toISOString()
          : new Date(this.now()).toISOString(),
      snippet: text.slice(0, Math.max(100, this.snippetChars)),
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    };
  }
}

function formatAddress(
  address: ParsedMail["from"],
): string {
  const values = address?.value ?? [];
  if (values.length === 0) {
    return "unknown sender";
  }
  return values
    .map((entry) => {
      const email = entry.address?.trim() ?? "";
      const name = entry.name?.trim() ?? "";
      if (name && email) {
        return `${name} <${email}>`;
      }
      return name || email || "unknown sender";
    })
    .join(", ");
}

function normalizeText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
