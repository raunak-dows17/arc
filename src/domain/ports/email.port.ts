import type {
  EmailBatch,
  EmailTriageResult,
  IncomingEmail,
} from "../entities/incoming-email.js";

export interface FetchUnreadOptions {
  /** Only return UIDs greater than this value when UIDVALIDITY still matches. */
  afterUid?: number;
  /** The UIDVALIDITY the afterUid belongs to. A mismatch resets the filter. */
  expectedUidValidity?: string;
  signal?: AbortSignal;
}

/**
 * Read-only mailbox access. Implementations must never mark messages seen,
 * delete them, move them, or change flags.
 */
export interface EmailSourcePort {
  fetchUnread(options?: FetchUnreadOptions): Promise<EmailBatch>;
}

export interface EmailWatchState {
  uidValidity: string;
  lastNotifiedUid: number;
  updatedAt: string;
}

export interface EmailStateStorePort {
  load(): Promise<EmailWatchState | null>;
  save(state: EmailWatchState): Promise<void>;
}

export interface EmailTriagePort {
  triage(
    email: IncomingEmail,
    signal?: AbortSignal,
  ): Promise<EmailTriageResult>;
}

/** A deliberately narrow outbound notification boundary. */
export interface NotificationPort {
  notify(message: string): Promise<void>;
}
