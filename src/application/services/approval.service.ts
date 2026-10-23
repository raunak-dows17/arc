import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
} from "../../domain/ports/approval.port.js";
import { ApprovalError } from "../../domain/errors/agent.errors.js";

export interface ApprovalPromptPort {
  ask(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface ApprovalServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Fails closed. A prompt may approve or deny; a timeout, abort, or prompt error
 * becomes a denial so unattended agents can never self-approve.
 */
export class ApprovalService implements ApprovalPort {
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly prompt: ApprovalPromptPort,
    options: ApprovalServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async request(
    request: Omit<ApprovalRequest, "id" | "expiresAt">,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    if (signal?.aborted) {
      return {
        approved: false,
        decidedBy: "abort",
        reason: "The turn was cancelled before approval.",
      };
    }

    const expiresAt = this.now() + this.ttlMs;
    const fullRequest: ApprovalRequest = {
      ...request,
      id: randomUUID(),
      expiresAt,
    };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ApprovalDecision>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          approved: false,
          decidedBy: "timeout",
          reason: `Approval expired after ${this.ttlMs} ms.`,
        });
      }, this.ttlMs);
      timer.unref();
    });

    let abortListener: (() => void) | undefined;
    const aborted = new Promise<ApprovalDecision>((resolve) => {
      if (!signal) {
        return;
      }
      abortListener = () => {
        resolve({
          approved: false,
          decidedBy: "abort",
          reason: "The turn was cancelled before approval.",
        });
      };
      signal.addEventListener("abort", abortListener, { once: true });
    });

    try {
      return await Promise.race([this.prompt.ask(fullRequest), timeout, aborted]);
    } catch (error) {
      if (error instanceof ApprovalError) {
        return {
          approved: false,
          decidedBy: "error",
          reason: error.message,
        };
      }
      return {
        approved: false,
        decidedBy: "error",
        reason:
          error instanceof Error
            ? `Approval prompt failed: ${error.message}`
            : "Approval prompt failed.",
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  }
}

/** Safe default until a CLI/Telegram prompt is wired in. */
export class DenyAllApprovalPrompt implements ApprovalPromptPort {
  async ask(request: ApprovalRequest): Promise<ApprovalDecision> {
    return {
      approved: false,
      decidedBy: "policy",
      reason: `No approval channel is available for ${request.toolName}.`,
    };
  }
}
