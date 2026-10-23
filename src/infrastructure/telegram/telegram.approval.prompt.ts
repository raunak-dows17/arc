import type { ApprovalPromptPort } from "../../application/services/approval.service.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
} from "../../domain/ports/approval.port.js";
import type { TelegramApi } from "./telegram.api.js";

interface PendingApproval {
  chatId: string;
  mode: ApprovalRequest["mode"];
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

export interface TelegramApprovalPromptOptions {
  defaultChatId?: string;
  now?: () => number;
}

/**
 * Sends approval requests to a private Telegram chat and waits for a text
 * reply. The polling loop stays free to receive the reply because the chat
 * turn runs on its own queue. Every failure path denies.
 */
export class TelegramApprovalPrompt implements ApprovalPromptPort {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly now: () => number;
  private chatResolver: ((sessionId: string) => string | undefined) | null =
    null;

  constructor(
    private readonly api: TelegramApi,
    private readonly options: TelegramApprovalPromptOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  setChatResolver(
    resolver: (sessionId: string) => string | undefined,
  ): void {
    this.chatResolver = resolver;
  }

  async ask(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (request.channel !== "telegram") {
      return {
        approved: false,
        decidedBy: "policy",
        reason:
          "This approval request is not addressed to the Telegram channel.",
      };
    }

    const chatId =
      this.chatResolver?.(request.sessionId) ?? this.options.defaultChatId;
    if (!chatId) {
      return {
        approved: false,
        decidedBy: "policy",
        reason:
          "No Telegram chat is associated with this session. Start a chat with ARC first.",
      };
    }

    const delay = Math.max(1_000, request.expiresAt - this.now());
    if (delay <= 1_000) {
      return {
        approved: false,
        decidedBy: "timeout",
        reason: "The approval request expired before it could be sent.",
      };
    }

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(request.id)) {
          void this.send(
            chatId,
            `⌛ Approval ${request.id} expired. The action was denied.`,
          );
        }
        resolve({
          approved: false,
          decidedBy: "timeout",
          reason: "No approval reply arrived before the request expired.",
        });
      }, delay);

      this.pending.set(request.id, {
        chatId,
        mode: request.mode,
        resolve,
        timer,
      });

      void this.api
        .sendMessage(chatId, formatApprovalRequest(request))
        .catch((error: unknown) => {
          if (this.pending.delete(request.id)) {
            clearTimeout(timer);
            resolve({
              approved: false,
              decidedBy: "error",
              reason: `Could not deliver the approval request: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        });
    });
  }

  /**
   * Returns true when the text was an approval reply, even if it was malformed
   * or used a session grant that is not allowed. Unknown text is left for the
   * normal chat handler.
   */
  handleReply(chatId: string, text: string): boolean {
    const match = text
      .trim()
      .match(/^(yes|no|session)\s+([A-Za-z0-9-]+)$/i);
    if (!match) {
      return false;
    }

    const action = (match[1] ?? "").toLowerCase();
    const id = match[2] ?? "";
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }
    if (pending.chatId !== chatId) {
      return false;
    }
    if (action === "session" && pending.mode !== "session") {
      void this.send(
        chatId,
        "This action cannot be remembered. Reply yes <id> to allow it once or no <id> to deny it.",
      );
      return true;
    }

    this.pending.delete(id);
    clearTimeout(pending.timer);
    const approved = action === "yes" || action === "session";
    pending.resolve({
      approved,
      decidedBy: "user",
      ...(action === "session" ? { rememberForSession: true } : {}),
      ...(approved ? {} : { reason: "The user declined this action." }),
    });
    void this.send(
      chatId,
      approved
        ? `✅ Approved ${id}${action === "session" ? " for this session" : " once"}.`
        : `⛔ Denied ${id}.`,
    );
    return true;
  }

  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        approved: false,
        decidedBy: "cancelled",
        reason,
      });
      this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private async send(chatId: string, text: string): Promise<void> {
    await this.api.sendMessage(chatId, text).catch(() => undefined);
  }
}

export function formatApprovalRequest(request: ApprovalRequest): string {
  const args = safeJson(request.args);
  const lines = [
    "🔐 ARC approval required",
    `Tool: ${request.toolName}`,
    `Risk: ${request.risk}`,
    `Reason: ${request.reason}`,
    `Request: ${request.id}`,
    "",
    "Arguments:",
    args,
    "",
    `Reply: yes ${request.id}  — allow once`,
    `Reply: no ${request.id}  — deny`,
  ];
  if (request.mode === "session") {
    lines.push(
      `Reply: session ${request.id}  — allow for this session`,
    );
  } else if (request.risk === "shell") {
    lines.push("Shell commands always require a fresh approval.");
  }
  return lines.join("\n").slice(0, 3_900);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1_500);
  } catch {
    return "(arguments could not be displayed)";
  }
}
