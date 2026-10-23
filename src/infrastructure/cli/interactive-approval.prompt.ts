import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalRequest,
} from "../../domain/ports/approval.port.js";
import type { ApprovalPromptPort } from "../../application/services/approval.service.js";

export type ApprovalHandler = (
  request: ApprovalRequest,
) => Promise<ApprovalDecision>;

/**
 * Bridges the application approval service to the terminal. The REPL installs
 * a handler while it owns stdin; outside an interactive session the prompt
 * fails closed.
 */
export class InteractiveApprovalPrompt implements ApprovalPromptPort {
  private handler: ApprovalHandler | null = null;

  setHandler(handler: ApprovalHandler | null): void {
    this.handler = handler;
  }

  async ask(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.handler) {
      return {
        approved: false,
        decidedBy: "policy",
        reason:
          "No interactive approval channel is available. Start ARC in a terminal to approve this action.",
      };
    }
    return this.handler(request);
  }
}

export interface ParsedApprovalAnswer {
  approved: boolean;
  rememberForSession: boolean;
}

/**
 * Parse the CLI answer. "s" is only accepted for session-scoped network
 * grants; shell commands always require a fresh "y".
 */
export function parseApprovalAnswer(
  answer: string,
  mode: ApprovalMode,
): ParsedApprovalAnswer {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return { approved: true, rememberForSession: false };
  }
  if (
    mode === "session" &&
    (normalized === "s" || normalized === "session")
  ) {
    return { approved: true, rememberForSession: true };
  }
  return { approved: false, rememberForSession: false };
}
