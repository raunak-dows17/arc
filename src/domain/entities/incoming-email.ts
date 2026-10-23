/**
 * A minimal, already-parsed view of an unread email. The body is deliberately
 * reduced to a short snippet so the full message never reaches Telegram, the
 * audit log, or a model prompt by accident.
 */
export interface IncomingEmail {
  /** IMAP UID. UIDs are stable only while UIDVALIDITY is unchanged. */
  uid: number;
  from: string;
  subject: string;
  /** ISO-8601 timestamp from the message headers. */
  receivedAt: string;
  snippet: string;
  messageId?: string;
}

export interface EmailBatch {
  /** Mailbox UIDVALIDITY, serialized as a string because it can be a bigint. */
  uidValidity: string;
  messages: readonly IncomingEmail[];
}

export type EmailCategory =
  | "urgent"
  | "action"
  | "informational"
  | "newsletter"
  | "spam"
  | "unknown";

export interface EmailTriageResult {
  needsAttention: boolean;
  category: EmailCategory;
  /** 0–10, where 10 is critical. */
  importance: number;
  confidence: number;
  /** True when Tev1 failed and ARC used its conservative fallback. */
  fallback: boolean;
}
