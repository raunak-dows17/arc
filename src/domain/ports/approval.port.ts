export type ApprovalChannel = "cli" | "telegram" | "scheduler";

export type ApprovalRisk = "read" | "workspace-write" | "network" | "shell";

/**
 * "always" asks for every invocation. "session" may be granted once for the
 * rest of the current session; it is intended for repeated read-only network
 * access, never for shell commands.
 */
export type ApprovalMode = "always" | "session";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: unknown;
  risk: ApprovalRisk;
  reason: string;
  channel: ApprovalChannel;
  sessionId: string;
  turnId?: string;
  mode: ApprovalMode;
  /** Unix epoch milliseconds. */
  expiresAt: number;
}

export interface ApprovalDecision {
  approved: boolean;
  decidedBy: string;
  reason?: string;
  /** Only honoured by the approval service for tools in "session" mode. */
  rememberForSession?: boolean;
}

/**
 * A human approval boundary. Implementations must fail closed when no human is
 * available; background schedulers must never approve their own actions.
 */
export interface ApprovalPort {
  request(
    request: Omit<ApprovalRequest, "id" | "expiresAt">,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision>;
}
